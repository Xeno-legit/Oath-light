#!/usr/bin/env node
// Generate a fresh production OTA keypair set — active + spare — and print all
// four values, each unambiguously labelled with where it goes.
//
//   node scripts/ota/new-keys.mjs
//
// WHY THIS EXISTS, rather than running --gen-key twice:
// `--gen-key` prints the PUBLIC key to stdout and the PRIVATE seed to stderr.
// In a terminal both land in the same scrollback, in the same font, both 64 hex
// characters. The two failure modes that follow are silent and expensive:
//
//   • Paste the PUBLIC key into the GitHub secret → CI signs with garbage, or
//     doesn't sign at all. You discover it at the first release.
//   • Let a PRIVATE seed reach disk or a commit → the signing key is public and
//     anyone can push a blocklist update to every client.
//
// So this prints one block, says which is which, and writes NOTHING anywhere.
//
//   --check-only   print the format with placeholder values and exit (safe to
//                  run in a transcript or share on screen)
import nodeCrypto from 'node:crypto';

const argv = process.argv.slice(2);
const demo = argv.includes('--check-only');

function derivePublic(seed) {
  // Wrap the raw 32-byte seed in the PKCS#8 prefix Node expects, then take the
  // trailing 32 bytes of the SPKI export — the raw Ed25519 public key.
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed
  ]);
  const key = nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = nodeCrypto.createPublicKey(key).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - 32));
}

function pair() {
  if (demo) {
    return { seed: '<64-hex PRIVATE seed>', pub: '<64-hex public key>' };
  }
  const seed = nodeCrypto.randomBytes(32);
  return { seed: seed.toString('hex'), pub: derivePublic(seed).toString('hex') };
}

const active = pair();
const spare = pair();

const line = '─'.repeat(72);
console.log(`
${line}
  OATH LIGHT — NEW OTA SIGNING KEYS${demo ? '   (--check-only: placeholders, not real keys)' : ''}
${line}

  Four values. Each goes to exactly one place. Do not mix them up.

┌─ 1. ACTIVE PUBLIC ─────────────────── goes IN THE REPO (safe, committed) ─┐

    ${active.pub}

    → OTA_PUBKEY_ACTIVE_HEX in desktop-app/core/src/ota.rs
    → first entry of OTA_PUBKEYS_HEX in extension/bg/ota.js

┌─ 2. SPARE PUBLIC ──────────────────── goes IN THE REPO (safe, committed) ─┐

    ${spare.pub}

    → OTA_PUBKEY_SPARE_HEX in desktop-app/core/src/ota.rs
    → second entry of OTA_PUBKEYS_HEX in extension/bg/ota.js

┌─ 3. ACTIVE PRIVATE ───────────── goes IN GITHUB SECRETS. NEVER IN A FILE ─┐

    ${active.seed}

    → GitHub → your repo → Settings → Secrets and variables → Actions
      → New repository secret
         Name:   OTA_SIGNING_KEY
         Secret: the value above
    Paste it straight from this terminal into the browser. Do not save it first.

┌─ 4. SPARE PRIVATE ──────────── goes OFFLINE ONLY. NEVER IN CI, NEVER HERE ─┐

    ${spare.seed}

    → paper, hardware token, or a password manager. Nowhere else.
    The spare exists to be the key that is still trustworthy after the active
    one leaks — putting it in CI alongside the active one destroys that.

${line}
  AFTER YOU HAVE PASTED THEM
${line}

  1. Bake public keys 1 and 2 into BOTH files above — byte-identical, or a
     manifest one client accepts the other rejects.
  2. Verify:  OTA_SIGNING_KEY=<active private> node scripts/ota/check-seed.mjs
     Expect:  MATCH — this is the ACTIVE seed.
  3. Rebuild the extension zips — bg/ota.js changed, so the shipped artifacts
     are stale until you do:  python scripts/build-extension-zips.py
  4. Rebuild the desktop app.
  5. Clear this terminal's scrollback. The two private seeds are in it.

${line}
`);
