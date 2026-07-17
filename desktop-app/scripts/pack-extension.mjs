// Packs the Oath Light browser extension into a signed CRX3 and writes the
// self-hosted update manifest the desktop app serves from localhost.
//
//   in:   ../../extension            (the unpacked MV3 extension)
//         ../oathlight-extension-key.pem   (RSA private key — the ID is derived
//                                          from its public half; NEVER regenerate)
//   out:  ../src-tauri/resources/oathlight.crx
//         ../src-tauri/resources/update_manifest.xml
//
// The CRX's ID is derived from the signing key and MUST equal the EXTENSION_ID
// pinned in src-tauri/src/browsers.rs and the `key` in extension/manifest.json.
// This script asserts all three agree and refuses to emit a mismatched package —
// a mismatch means the browser would reject the force-installed extension.
//
// Wired into the Tauri build via `beforeBuildCommand` / `beforeDevCommand`
// (see tauri.conf.json), so every `tauri build` / `tauri dev` repacks. Run
// standalone with:  node scripts/pack-extension.mjs
//
// Dependency-free on purpose (std zlib + crypto only): matches the extension's
// "no build step" philosophy and keeps the release pipeline from depending on
// an npm tree. The ZIP and CRX3 containers are built by hand below.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url)); // desktop-app/scripts
const desktopApp = join(here, '..');
const repoRoot = join(desktopApp, '..');

const EXTENSION_DIR = join(repoRoot, 'extension');
const KEY_PATH = join(desktopApp, 'oathlight-extension-key.pem');
const OUT_DIR = join(desktopApp, 'src-tauri', 'resources');
const CRX_PATH = join(OUT_DIR, 'oathlight.crx');
const XML_PATH = join(OUT_DIR, 'update_manifest.xml');

// The single source of truth lives in browsers.rs; duplicated here only as an
// assertion target so a wrong key or corrupted manifest fails the build loudly.
const EXPECTED_ID = 'lknpaoecooklfjgenmjpkdkahgoofank';

// Update URL the app serves and the policy points browsers at. MUST match
// CHROMIUM_UPDATE_URL / the update server port in the Rust app.
const UPDATE_CODEBASE = 'http://127.0.0.1:17244/oathlight.crx';

// Never ship these into the packed extension: `_metadata` is a Chrome-generated
// artifact from unpacked loading, `tests` is dev-only.
const EXCLUDE_TOP = new Set(['_metadata', 'tests']);

// --- file collection --------------------------------------------------------

/** Recursively list files under `dir`, returned as forward-slash paths relative
 *  to it, sorted for a deterministic archive. Top-level excludes are dropped. */
function collectFiles(dir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const full = join(abs, name);
      const rel = relative(dir, full).split(sep).join('/');
      if (rel.split('/').length === 1 && EXCLUDE_TOP.has(name)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(dir);
  out.sort();
  return out;
}

// --- ZIP (store/deflate, hand-rolled) ---------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a minimal ZIP (per-file DEFLATE, or STORE when deflate isn't smaller).
 *  Chrome only needs a well-formed local-header + central-directory + EOCD set;
 *  no data descriptors, ASCII names, DOS time zeroed. */
function buildZip(rootDir, files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const rel of files) {
    const data = readFileSync(join(rootDir, rel));
    const nameBuf = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const method = useDeflate ? 8 : 0;
    const body = useDeflate ? deflated : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0, 12);            // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);  // compressed size
    local.writeUInt32LE(data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra length
    locals.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);              // version made by
    cen.writeUInt16LE(20, 6);              // version needed
    cen.writeUInt16LE(0, 8);               // flags
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);              // mod time
    cen.writeUInt16LE(0, 14);              // mod date
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);              // extra length
    cen.writeUInt16LE(0, 32);              // comment length
    cen.writeUInt16LE(0, 34);              // disk number start
    cen.writeUInt16LE(0, 36);              // internal attrs
    cen.writeUInt32LE(0, 38);              // external attrs
    cen.writeUInt32LE(offset, 42);         // local header offset
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(locals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // disk with CD
  eocd.writeUInt16LE(files.length, 8);     // entries this disk
  eocd.writeUInt16LE(files.length, 10);    // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16); // CD offset
  eocd.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// --- protobuf helpers (just enough for the CRX3 header) ---------------------

function varint(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

/** length-delimited protobuf field: tag (field<<3 | 2) then varint len then bytes */
function lenField(fieldNo, payload) {
  const tag = varint((fieldNo << 3) | 2);
  return Buffer.concat([tag, varint(payload.length), payload]);
}

// --- CRX3 ID derivation -----------------------------------------------------

/** Chrome extension ID: first 16 bytes of sha256(SPKI DER), each nibble mapped
 *  0..15 -> 'a'..'p' (mpdecimal). */
function crxId(spkiDer) {
  const hash = crypto.createHash('sha256').update(spkiDer).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

// --- main -------------------------------------------------------------------

function main() {
  const manifest = JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  if (!version) throw new Error('extension/manifest.json has no version');

  // Load the private key and derive its public SPKI DER. Nothing about the
  // private key is ever printed or written — only the public key, signature,
  // and derived ID (all public) leave this process.
  const privateKey = crypto.createPrivateKey(readFileSync(KEY_PATH));
  const spkiDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  // Cross-check the packing key against the manifest's pinned public key.
  const manifestKeyDer = Buffer.from(manifest.key, 'base64');
  if (!manifestKeyDer.equals(spkiDer)) {
    throw new Error(
      'signing key does not match extension/manifest.json "key" — the packed ' +
      'CRX would install under a different ID than the one pinned everywhere.'
    );
  }

  const id = crxId(spkiDer);
  if (id !== EXPECTED_ID) {
    throw new Error(`derived extension ID ${id} != expected ${EXPECTED_ID}`);
  }

  // ZIP the extension.
  const files = collectFiles(EXTENSION_DIR);
  const zip = buildZip(EXTENSION_DIR, files);

  // CRX3 signed-header: SignedData{ crx_id = sha256(spki)[:16] }.
  const crxIdBytes = crypto.createHash('sha256').update(spkiDer).digest().subarray(0, 16);
  const signedHeaderData = lenField(1, crxIdBytes); // SignedData.crx_id

  // Signature is over: "CRX3 SignedData\0" | uint32le(len) | signedHeaderData | zip
  const prefix = Buffer.from('CRX3 SignedData\x00', 'latin1');
  const lenLE = Buffer.alloc(4);
  lenLE.writeUInt32LE(signedHeaderData.length, 0);
  const signedPayload = Buffer.concat([prefix, lenLE, signedHeaderData, zip]);

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedPayload);
  const signature = signer.sign(privateKey); // PKCS#1 v1.5

  // AsymmetricKeyProof{ public_key=spki (1), signature (2) }
  const proof = Buffer.concat([lenField(1, spkiDer), lenField(2, signature)]);
  // CrxFileHeader{ sha256_with_rsa=proof (2), signed_header_data (10000) }
  const header = Buffer.concat([lenField(2, proof), lenField(10000, signedHeaderData)]);

  const magic = Buffer.from('Cr24', 'latin1');
  const ver = Buffer.alloc(4);
  ver.writeUInt32LE(3, 0);
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(header.length, 0);
  const crx = Buffer.concat([magic, ver, headerLen, header, zip]);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CRX_PATH, crx);

  const xml =
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n` +
    `  <app appid='${id}'>\n` +
    `    <updatecheck codebase='${UPDATE_CODEBASE}' version='${version}' />\n` +
    `  </app>\n` +
    `</gupdate>\n`;
  writeFileSync(XML_PATH, xml);

  console.log(`[pack-extension] ID ${id} (matches pin) v${version}`);
  console.log(`[pack-extension] ${files.length} files, crx ${crx.length} bytes -> ${relative(desktopApp, CRX_PATH)}`);
  console.log(`[pack-extension] update manifest -> ${relative(desktopApp, XML_PATH)}`);
}

main();
