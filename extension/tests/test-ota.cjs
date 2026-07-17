// extension/tests/test-ota.cjs — OTA blocklist update consumer (plan item 3.5).
// Exercises bg/ota.js's REAL verification + policy pipeline against a throwaway
// Ed25519 keypair (via the same vendored noble the extension ships), with
// injected fake fetch/storage — no network, no chrome. Covers the four things
// the plan calls out: signature verify (good + bad), version-rollback
// rejection, whitelist-collision rejection, and corrupt-storage fallback.
//
// `run()` is async: noble's verify is async, and driving runOtaCheck end-to-end
// is the most valuable assertion here. run-all.cjs awaits it.
'use strict';
const path = require('path');
const crypto = require('crypto');
const { createRunner } = require('./_assert.cjs');

const OTA = require(path.join(__dirname, '..', 'bg', 'ota.js'));
const noble = require(path.join(__dirname, '..', 'bg', 'noble-ed25519.js'));

// noble's async sign/verify resolve sha512 via node crypto automatically, but
// pinning the sync hook removes any cross-Node-version WebCrypto guesswork and
// lets us sign synchronously while setting up fixtures.
noble.utils.sha512Sync = (...m) =>
  new Uint8Array(crypto.createHash('sha512').update(Buffer.concat(m.map((x) => Buffer.from(x)))).digest());

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// A minimal chrome.storage.local-shaped stub.
function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (obj) => {
      Object.assign(store, obj);
    },
  };
}

// Build a signed manifest + the matching list-file bytes for a set of
// { name -> jsonValue } files, signed with `seedHex`.
function buildRelease(version, files, seedHex) {
  const assets = {}; // name -> Uint8Array
  const manifestFiles = {};
  for (const [name, value] of Object.entries(files)) {
    const bytes = enc(value);
    assets[name] = bytes;
    manifestFiles[name] = { sha256: sha256Hex(Buffer.from(bytes)), size: bytes.length };
  }
  const manifestBytes = enc({ version, created: '2026-07-12T00:00:00Z', files: manifestFiles });
  return { manifestBytes, assets, seedHex };
}

// A fetchBytes(url, cap) built over a release: serves the manifest, its sig, and
// each named asset. `tamper` optionally mutates the manifest bytes served.
function makeFetch(release, sigHex, opts = {}) {
  return async (url, cap) => {
    let bytes;
    if (url.endsWith('lists-manifest.json.sig')) bytes = new TextEncoder().encode(sigHex + '\n');
    else if (url.endsWith('lists-manifest.json')) bytes = opts.manifestBytes || release.manifestBytes;
    else {
      const name = url.split('/').pop();
      bytes = release.assets[name];
      if (!bytes) throw new Error(`404 ${name}`);
    }
    if (bytes.length > cap) throw new Error('over cap');
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  };
}

async function run() {
  const runner = createRunner('test-ota');
  const WHITELIST = ['github.com', 'google.com', 'wikipedia.org'];

  // A throwaway signing key (NOT the baked production key — this proves the
  // scheme with a key we control, independent of what's baked in).
  const seed = crypto.randomBytes(32);
  const seedHex = bytesToHex(seed);
  const pubHex = bytesToHex(await noble.getPublicKey(seed));
  const wrongPubHex = bytesToHex(await noble.getPublicKey(crypto.randomBytes(32)));

  const cleanFiles = {
    'domains_part1.json': { domains: ['badsite.example', 'anotherbad.example'] },
    'keywords.json': { keywords: ['pornword'] },
  };

  // ── 1. signature verify: good sig against the right key ──────────────────
  {
    const rel = buildRelease(2, cleanFiles, seedHex);
    const sig = bytesToHex(await noble.sign(rel.manifestBytes, seed));
    runner.ok(
      await OTA.verifyManifestSig(rel.manifestBytes, sig, noble, [pubHex]),
      'valid signature verifies against the signing pubkey',
    );
    runner.ok(
      !(await OTA.verifyManifestSig(rel.manifestBytes, sig, noble, [wrongPubHex])),
      'valid signature is REJECTED against a different pubkey',
    );
    // Tampered manifest, same sig → reject.
    const tampered = Uint8Array.from(rel.manifestBytes);
    tampered[40] ^= 0x01;
    runner.ok(
      !(await OTA.verifyManifestSig(tampered, sig, noble, [pubHex])),
      'tampered manifest fails signature verification',
    );
    // Garbage sig → reject, no throw.
    runner.ok(
      !(await OTA.verifyManifestSig(rel.manifestBytes, 'zz'.repeat(64), noble, [pubHex])),
      'malformed signature hex is rejected without throwing',
    );
  }

  // ── 2. end-to-end runOtaCheck applies a clean, newer, signed update ───────
  {
    const rel = buildRelease(5, cleanFiles, seedHex);
    const sig = bytesToHex(await noble.sign(rel.manifestBytes, seed));
    const storage = fakeStorage();
    // pubkeys injected so the pipeline verifies against OUR throwaway key —
    // this drives the full fetch → verify → hash-check → apply path.
    const res = await OTA.runOtaCheck({
      fetchBytes: makeFetch(rel, sig),
      storage,
      noble,
      whitelist: WHITELIST,
      pubkeys: [pubHex],
    });
    runner.equal(res.result, 'applied', 'a clean, newer, correctly-signed update is applied end-to-end');
    runner.equal(res.installedVersion, 5, 'installed version advances to the applied manifest version');
    const applied = storage._store.ppOtaLists;
    runner.ok(applied && applied.version === 5, 'the applied list set is stored under ppOtaLists');
    runner.ok(
      applied && applied.domains.includes('badsite.example') && applied.domains.length === 2,
      'stored domains come from the downloaded, hash-verified list files',
    );

    // A second run at the SAME version is a no-op (monotonic gate).
    const res2 = await OTA.runOtaCheck({
      fetchBytes: makeFetch(rel, sig),
      storage,
      noble,
      whitelist: WHITELIST,
      pubkeys: [pubHex],
    });
    runner.equal(res2.result, 'not-newer', 're-running the same version is refused (not-newer)');

    // Wrong signing key → bad-signature, nothing applied over the good set.
    const relWrong = buildRelease(6, cleanFiles, seedHex);
    const sigWrong = bytesToHex(await noble.sign(relWrong.manifestBytes, seed));
    const res3 = await OTA.runOtaCheck({
      fetchBytes: makeFetch(relWrong, sigWrong),
      storage,
      noble,
      whitelist: WHITELIST,
      pubkeys: [wrongPubHex],
    });
    runner.equal(res3.result, 'bad-signature', 'a newer manifest signed by the wrong key is refused');
    runner.equal(storage._store.ppOtaLists.version, 5, 'the previously-applied v5 set is left intact');
  }

  // ── 2b. an update that collides with the whitelist is refused wholesale ───
  {
    const dirty = {
      'domains_part1.json': { domains: ['badsite.example', 'github.com'] }, // github.com is whitelisted
      'keywords.json': { keywords: [] },
    };
    const rel = buildRelease(9, dirty, seedHex);
    const sig = bytesToHex(await noble.sign(rel.manifestBytes, seed));
    const storage = fakeStorage();
    const res = await OTA.runOtaCheck({
      fetchBytes: makeFetch(rel, sig),
      storage,
      noble,
      whitelist: WHITELIST,
      pubkeys: [pubHex],
    });
    runner.ok(String(res.result).startsWith('whitelist-collision'), 'a whitelist-colliding update is refused wholesale');
    runner.equal(storage._store.ppOtaLists, undefined, 'nothing is applied when the safety floor trips');
  }

  // ── 2c. a hash mismatch (corrupted asset) is refused ─────────────────────
  {
    const rel = buildRelease(9, cleanFiles, seedHex);
    const sig = bytesToHex(await noble.sign(rel.manifestBytes, seed));
    // Corrupt one asset's bytes AFTER the manifest (with its sha256) was signed,
    // keeping the SAME byte length so this exercises the sha256 check, not the
    // cheaper size check (last char flipped: ...example → ...examplf).
    rel.assets['domains_part1.json'] = enc({ domains: ['badsite.example', 'anotherbad.examplf'] });
    const storage = fakeStorage();
    const res = await OTA.runOtaCheck({
      fetchBytes: makeFetch(rel, sig),
      storage,
      noble,
      whitelist: WHITELIST,
      pubkeys: [pubHex],
    });
    runner.ok(String(res.result).startsWith('assemble-failed'), 'a list file failing its manifest sha256 is refused');
  }

  // ── 3. version monotonicity (anti-rollback) ──────────────────────────────
  {
    runner.ok(OTA.versionIsAcceptable(1, 0), 'first install (v1 over nothing) is acceptable');
    runner.ok(OTA.versionIsAcceptable(9, 8), 'a strictly newer version is acceptable');
    runner.ok(!OTA.versionIsAcceptable(8, 8), 'the same version is refused (no re-apply)');
    runner.ok(!OTA.versionIsAcceptable(3, 8), 'an older version is refused (rollback attack)');
  }

  // ── 4. whitelist-collision rejection (safety floor) ──────────────────────
  {
    // exact collision
    runner.equal(
      OTA.whitelistCollision(['github.com', 'x.example'], WHITELIST),
      'github.com',
      'an update blocking a whitelisted domain exactly is caught',
    );
    // parent-walk collision: blocking google.com would block whitelisted google.com's children
    runner.ok(
      OTA.whitelistCollision(['google.com'], ['docs.google.com']) !== null,
      'a parent-domain collision is caught by the walk',
    );
    // clean set → no collision
    runner.equal(
      OTA.whitelistCollision(['totally-unrelated.example'], WHITELIST),
      null,
      'a clean update reports no collision',
    );
  }

  // ── 5. parseManifest structural validation ───────────────────────────────
  {
    const good = OTA.parseManifest(enc({ version: 2, files: { 'domains_part1.json': { sha256: 'a'.repeat(64), size: 10 } } }));
    runner.ok(good.ok, 'a well-formed manifest parses');
    runner.ok(!OTA.parseManifest(enc({ version: 0, files: {} })).ok, 'version 0 / empty files rejected');
    runner.ok(
      !OTA.parseManifest(enc({ version: 1, files: { '../evil.json': { sha256: 'a'.repeat(64), size: 1 } } })).ok,
      'path-traversal asset name rejected',
    );
    runner.ok(
      !OTA.parseManifest(enc({ version: 1, files: { 'mystery.json': { sha256: 'a'.repeat(64), size: 1 } } })).ok,
      'unknown list kind rejected',
    );
    runner.ok(!OTA.parseManifest(new TextEncoder().encode('not json')).ok, 'non-JSON rejected without throwing');
  }

  // ── 6. corrupt / missing storage falls back (loadStoredOta returns null) ──
  {
    runner.equal(await OTA.loadStoredOta(fakeStorage({}), WHITELIST), null, 'empty storage → null (use bundled)');
    runner.equal(
      await OTA.loadStoredOta(fakeStorage({ ppOtaLists: { version: 'nope', domains: 5 } }), WHITELIST),
      null,
      'corrupt stored record → null (use bundled)',
    );
    // A stored set that somehow contains a whitelist collision is refused on read too.
    runner.equal(
      await OTA.loadStoredOta(
        fakeStorage({ ppOtaLists: { version: 3, domains: ['github.com'], keywords: [] } }),
        WHITELIST,
      ),
      null,
      'stored set colliding with the whitelist is refused on read (safety floor holds)',
    );
    // A valid stored set loads.
    const okRec = await OTA.loadStoredOta(
      fakeStorage({ ppOtaLists: { version: 3, domains: ['badsite.example'], keywords: ['w'] } }),
      WHITELIST,
    );
    runner.ok(okRec && okRec.version === 3 && okRec.domains.length === 1, 'a valid stored set loads');
  }

  return runner.summary();
}

module.exports = { run };
