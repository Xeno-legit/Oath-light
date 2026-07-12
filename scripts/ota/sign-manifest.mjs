// scripts/ota/sign-manifest.mjs — the OTA publisher-side signer (plan item
// 3.5). One script, three jobs, all using the SAME vendored Ed25519
// implementation every consumer verifies against (extension/bg/noble-ed25519.js
// — CommonJS, required below), so the signer can never drift from the
// verifiers:
//
//   node scripts/ota/sign-manifest.mjs --gen-key
//       Generate a fresh Ed25519 keypair. Prints the 32-byte PUBLIC key as hex
//       (bake it into desktop-app/core/src/ota.rs's OTA_PUBKEY_* consts and the
//       extension reads the same const) and the 32-byte PRIVATE seed as hex on
//       stderr (store it ONLY as the CI `OTA_SIGNING_KEY` secret + an offline
//       backup — never commit it). See docs/OTA_KEYS.md.
//
//   node scripts/ota/sign-manifest.mjs --build <lists-dir> <out-dir> [--version N]
//       Hash every list file in <lists-dir> (domains_part*.json, domains_ai.json,
//       keywords.json), write <out-dir>/lists-manifest.json, and — if
//       OTA_SIGNING_KEY is set in the environment — sign it, writing
//       <out-dir>/lists-manifest.json.sig (128 lowercase hex chars). This is
//       what .github/workflows/release-lists.yml runs.
//
//   node scripts/ota/sign-manifest.mjs --sign <manifest.json>
//       Sign an existing manifest file in place (writes <manifest>.sig next to
//       it). Requires OTA_SIGNING_KEY. Handy for re-signing.
//
// The signature is raw Ed25519 (RFC 8032, NO prehash) over the manifest file's
// exact bytes — deliberately not minisign, whose Blake2b-512 prehash the
// vendored single-file noble build can't verify. See core/src/ota.rs's module
// doc for the full scheme rationale.
'use strict';

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import * as nodeCrypto from 'node:crypto';

const { createHash } = nodeCrypto;

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const noble = require(join(REPO_ROOT, 'extension', 'bg', 'noble-ed25519.js'));

// noble v1.7.5's async sign/verify need a sha512 implementation. In Node it
// resolves node crypto automatically; this belt-and-suspenders sync hook makes
// signSync/verifySync available too and removes any WebCrypto-availability
// guesswork across Node versions.
noble.utils.sha512Sync = (...m) =>
  new Uint8Array(nodeCrypto.createHash('sha512').update(Buffer.concat(m.map((x) => Buffer.from(x)))).digest());

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('invalid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A manifest file entry is a list file iff its name matches what every consumer
// (core/src/ota.rs::is_known_list_kind) will accept: keywords.json, or a
// domains*.json. Keep this in lockstep with that Rust function.
function isListFile(name) {
  return name === 'keywords.json' || (name.startsWith('domains') && name.endsWith('.json'));
}

async function genKey() {
  // 32-byte random seed = the Ed25519 private key in noble's model.
  const seed = nodeCrypto.randomBytes(32);
  const pub = await noble.getPublicKey(seed);
  process.stderr.write(`PRIVATE (OTA_SIGNING_KEY secret — store offline, never commit):\n${bytesToHex(seed)}\n\n`);
  process.stdout.write(`${bytesToHex(pub)}\n`);
  process.stderr.write('\nPublic key printed to stdout — bake it into core/src/ota.rs OTA_PUBKEY_*_HEX.\n');
}

function buildManifest(listsDir, version) {
  const files = {};
  for (const name of readdirSync(listsDir).sort()) {
    if (!isListFile(name)) continue;
    const bytes = readFileSync(join(listsDir, name));
    files[name] = { sha256: sha256Hex(bytes), size: bytes.length };
  }
  if (Object.keys(files).length === 0) {
    throw new Error(`no list files (domains*.json / keywords.json) found in ${listsDir}`);
  }
  return { version, created: new Date().toISOString(), files };
}

async function signBytes(bytes) {
  const keyHex = process.env.OTA_SIGNING_KEY;
  if (!keyHex) return null; // manifest-only mode (no secret available, e.g. a PR build)
  const seed = hexToBytes(keyHex);
  if (seed.length !== 32) throw new Error('OTA_SIGNING_KEY must be a 32-byte (64 hex char) seed');
  const sig = await noble.sign(new Uint8Array(bytes), seed);
  return bytesToHex(sig); // 128 lowercase hex chars
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') out.version = parseInt(argv[++i], 10);
    else if (argv[i].startsWith('--')) out[argv[i].slice(2)] = true;
    else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['gen-key']) {
    await genKey();
    return;
  }

  if (args.build) {
    const [listsDir, outDir] = args._;
    if (!listsDir || !outDir) throw new Error('usage: --build <lists-dir> <out-dir> [--version N]');
    const version = Number.isInteger(args.version) && args.version > 0 ? args.version : 1;
    const manifest = buildManifest(listsDir, version);
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
    writeFileSync(join(outDir, 'lists-manifest.json'), bytes);
    const sig = await signBytes(bytes);
    if (sig) {
      writeFileSync(join(outDir, 'lists-manifest.json.sig'), sig + '\n');
      process.stderr.write(`Wrote signed manifest v${version} (${Object.keys(manifest.files).length} files).\n`);
    } else {
      process.stderr.write(`Wrote UNSIGNED manifest v${version} (OTA_SIGNING_KEY not set — PR/dry-run build).\n`);
    }
    return;
  }

  if (args.sign) {
    const [manifestPath] = args._;
    if (!manifestPath) throw new Error('usage: --sign <manifest.json>');
    const bytes = readFileSync(manifestPath);
    const sig = await signBytes(bytes);
    if (!sig) throw new Error('OTA_SIGNING_KEY not set — nothing to sign with');
    writeFileSync(manifestPath + '.sig', sig + '\n');
    process.stderr.write(`Signed ${basename(manifestPath)} -> ${basename(manifestPath)}.sig\n`);
    return;
  }

  process.stderr.write(
    'usage:\n' +
      '  --gen-key\n' +
      '  --build <lists-dir> <out-dir> [--version N]\n' +
      '  --sign <manifest.json>\n',
  );
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`sign-manifest: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});
