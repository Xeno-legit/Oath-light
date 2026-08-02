#!/usr/bin/env node
// Answer one question — "does the private seed I still hold match a public key
// baked into the shipped clients?" — without ever printing the seed.
//
//   OTA_SIGNING_KEY=<64-hex active seed> node scripts/ota/check-seed.mjs
//
// Prints a verdict only. Run it before trusting the OTA pipeline, and before
// setting the GitHub Actions secret, so you find a lost seed while regenerating
// is still cheap: once a release ships, clients trust these public keys and a
// seed nobody has can never sign an update for them.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RS = path.join(HERE, '..', '..', 'desktop-app', 'core', 'src', 'ota.rs');

const seedHex = (process.env.OTA_SIGNING_KEY || '').trim().toLowerCase();
if (!/^[0-9a-f]{64}$/.test(seedHex)) {
  console.error('OTA_SIGNING_KEY must be set to a 32-byte (64 hex char) seed.');
  console.error('Nothing was read from disk. Set it in your shell, do not commit it.');
  process.exit(2);
}

// Derive the Ed25519 public key from the seed, using the same vendored noble
// module the publisher script signs with, so this matches the real pipeline.
const { default: nobleUrl } = { default: path.join(HERE, 'sign-manifest.mjs') };
let derive;
try {
  const noble = await import('@noble/ed25519');
  derive = async (seed) => noble.getPublicKeyAsync
    ? await noble.getPublicKeyAsync(seed)
    : await noble.getPublicKey(seed);
} catch {
  // Fall back to Node's own Ed25519 (available since 12.x) — no dependency needed.
  const { createPrivateKey, createPublicKey } = await import('node:crypto');
  derive = async (seed) => {
    // Wrap the raw 32-byte seed in the PKCS#8 prefix Node expects.
    const pkcs8 = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seed)
    ]);
    const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
    return new Uint8Array(spki.subarray(spki.length - 32));
  };
}

const pub = Buffer.from(await derive(Buffer.from(seedHex, 'hex'))).toString('hex');
const rs = readFileSync(RS, 'utf8').toLowerCase();
const baked = [...rs.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
const active = baked[0];
const spare = baked[1];

const fp = (h) => h.slice(0, 8) + '…' + h.slice(-4);
console.log('derived public key :', fp(pub));
console.log('baked active       :', active ? fp(active) : '(none found)');
console.log('baked spare        :', spare ? fp(spare) : '(none found)');
console.log('');

if (pub === active) {
  console.log('MATCH — this is the ACTIVE seed. Set it as the OTA_SIGNING_KEY repo secret.');
  process.exit(0);
}
if (pub === spare) {
  console.log('MATCH — this is the SPARE seed. Keep it OFFLINE; it must never go into CI.');
  process.exit(0);
}
console.log('NO MATCH — this seed signs for neither baked key.');
console.log('Either it is the wrong seed, or the baked keys need regenerating (docs/OTA_KEYS.md).');
process.exit(1);
