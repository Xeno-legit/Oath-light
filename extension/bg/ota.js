// extension/bg/ota.js — over-the-air blocklist updates for the EXTENSION-only
// install (plan item 3.5, Task 3: users who run the extension without the
// desktop app). When the desktop app IS connected it owns OTA and pushes lists
// over the native bridge; this path is the standalone fallback so a browser-only
// user still gets list freshness.
//
// The scheme is identical to the desktop's (desktop-app/core/src/ota.rs and
// src-tauri/src/ota.rs): fetch a signed `lists-manifest.json` + `.sig` from the
// GitHub "latest release" assets, verify a raw-Ed25519 signature over the
// manifest bytes with the vendored @noble/ed25519 (extension/bg/noble-ed25519.js,
// exposed as globalThis.nobleEd25519), enforce version-monotonicity (no
// rollback) and the whitelist safety floor, then download + hash-check each
// changed list file and store it under `ppOtaLists` in chrome.storage.local.
// bg/blocklists.js prefers a valid stored OTA set over the bundled copies at
// load; a corrupt/missing/failed-verification set silently falls back to the
// bundled lists, which are never deleted.
//
// Every policy rule here is the JS twin of `purepath_core::ota`; the two are
// pinned against each other by extension/tests/test-ota.cjs and that module's
// Rust #[test]s. Keep them in lockstep — a rule that changes in one MUST change
// in the other.
//
// Testability: the verification/policy functions take their dependencies
// (noble, the whitelist, fetch, storage) as arguments rather than reaching for
// globals, so test-ota.cjs can exercise them directly in Node with a throwaway
// keypair. The service-worker glue at the bottom wires in the real globals.

'use strict';

// ── constants (must match core/src/ota.rs) ──────────────────────────────────

// The two baked signing public keys (active first). A signature from EITHER is
// accepted, so the active key can be rotated by promoting the spare without
// stranding clients. Keep these byte-identical to OTA_PUBKEY_*_HEX in
// desktop-app/core/src/ota.rs.
const OTA_PUBKEYS_HEX = [
  '4522971bcbc8b48009e98ffa8dec7fa26d225ae9fd46c94449a88f61a65c85c9', // active
  '9900bb2b4e3b884c6e2dd0cdfa1b1bdcd075a9077bb79680ad4e63b672fb6c3d', // spare
];

// GitHub "latest release" asset base — the same repo slug the desktop uses.
// TODO(owner): if the project moves repos before Alpha, update this AND
// desktop-app/src-tauri/src/ota.rs's OTA_RELEASE_BASE together.
const OTA_RELEASE_BASE = 'https://github.com/Xeno-legit/Pure-Path/releases/latest/download';
const MANIFEST_ASSET = 'lists-manifest.json';
const MANIFEST_SIG_ASSET = 'lists-manifest.json.sig';

// chrome.storage.local key holding the applied OTA set:
// { version, domains: [...], keywords: [...], appliedAt }.
const OTA_STORAGE_KEY = 'ppOtaLists';
// Small bookkeeping record: { lastCheck, lastResult, installedVersion }.
const OTA_META_KEY = 'ppOtaMeta';

// Caps mirror core's OTA_MAX_* — an update over these is treated as hostile.
const OTA_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const OTA_MAX_MANIFEST_BYTES = 1024 * 1024;
const OTA_MAX_SIG_BYTES = 4096;

const OTA_ALARM = 'ppOtaWeeklyCheck';
const OTA_PERIOD_MINUTES = 7 * 24 * 60; // weekly

// ── pure helpers ─────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const clean = String(hex || '').trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(bytes) {
  // Web Crypto is present in the MV3 service worker and in Node's global
  // `crypto`. Returns lowercase hex, matching the manifest's sha256 fields.
  const digest = await (globalThis.crypto || require('crypto').webcrypto).subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A manifest file name this client knows how to consume — the JS twin of
// core::ota::is_known_list_kind + is_safe_asset_name (path-safety matters: the
// name is only ever used as a storage key here, never a filesystem path, but we
// keep the same discipline so the two engines accept exactly the same set).
function isSafeAssetName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 64 &&
    name.endsWith('.json') &&
    !name.includes('..') &&
    /^[a-z0-9_.-]+$/.test(name)
  );
}
function isKnownListKind(name) {
  return name === 'keywords.json' || (name.startsWith('domains') && name.endsWith('.json'));
}

// Parse + structurally validate a manifest (mirror of core::ota::parse_manifest).
// Returns { ok:true, manifest } or { ok:false, error }.
function parseManifest(bytes) {
  let m;
  try {
    m = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return { ok: false, error: 'manifest JSON invalid' };
  }
  if (!m || typeof m !== 'object') return { ok: false, error: 'manifest not an object' };
  if (!Number.isInteger(m.version) || m.version < 1) return { ok: false, error: 'manifest version must be >= 1' };
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return { ok: false, error: 'manifest lists no files' };
  const names = Object.keys(m.files);
  if (names.length === 0) return { ok: false, error: 'manifest lists no files' };
  let total = 0;
  for (const name of names) {
    if (!isSafeAssetName(name)) return { ok: false, error: `unsafe asset name: ${name}` };
    if (!isKnownListKind(name)) return { ok: false, error: `unknown list kind: ${name}` };
    const entry = m.files[name];
    if (!entry || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      return { ok: false, error: `malformed sha256 for ${name}` };
    }
    if (!Number.isInteger(entry.size) || entry.size < 0) return { ok: false, error: `bad size for ${name}` };
    total += entry.size;
  }
  if (total > OTA_MAX_TOTAL_BYTES) return { ok: false, error: 'manifest total size over cap' };
  return { ok: true, manifest: m };
}

// Anti-rollback: strictly greater than what's installed (0 = nothing installed).
function versionIsAcceptable(newVersion, installed) {
  return Number.isInteger(newVersion) && newVersion > (installed || 0);
}

// The whitelist safety floor: return the first whitelisted domain an update
// would block (exact OR by the parent walk), or null if clean. Mirror of
// core::ota::whitelist_collision + lists::is_domain_listed. `domains` is an
// array of lowercased blocklist entries; `whitelist` is WHITELIST_DOMAINS.
function whitelistCollision(domains, whitelist) {
  const set = new Set(domains.map((d) => String(d).toLowerCase()));
  for (const w of whitelist) {
    if (set.has(w)) return w;
    // parent walk: does the set contain a parent of `w` (excluding the bare TLD)?
    const parts = w.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (set.has(parts.slice(i).join('.'))) return w;
    }
  }
  return null;
}

// Verify a raw-Ed25519 signature over the manifest bytes against either baked
// pubkey. `noble` is the vendored @noble/ed25519 module; `pubkeysHex` defaults
// to the baked pair. Returns a boolean. Never throws (a malformed sig/pubkey is
// just "not valid").
async function verifyManifestSig(manifestBytes, sigHex, noble, pubkeysHex = OTA_PUBKEYS_HEX) {
  const sig = hexToBytes(sigHex);
  if (!sig || sig.length !== 64) return false;
  const msg = manifestBytes instanceof Uint8Array ? manifestBytes : new Uint8Array(manifestBytes);
  for (const pkHex of pubkeysHex) {
    const pk = hexToBytes(pkHex);
    if (!pk || pk.length !== 32) continue;
    try {
      if (await noble.verify(sig, msg, pk)) return true;
    } catch (e) {
      // fall through to the next key / return false
    }
  }
  return false;
}

// Given a fetched+verified manifest and a fetcher for each asset's bytes,
// download every list file, hash-check it, and assemble { domains, keywords }.
// `fetchAsset(name)` -> Promise<Uint8Array>. Rejects (returns {ok:false}) on any
// hash mismatch, size mismatch, or unparseable list file.
async function assembleLists(manifest, fetchAsset) {
  const domains = [];
  let keywords = [];
  for (const name of Object.keys(manifest.files)) {
    const entry = manifest.files[name];
    let bytes;
    try {
      bytes = await fetchAsset(name);
    } catch (e) {
      return { ok: false, error: `fetch failed for ${name}` };
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== entry.size) {
      return { ok: false, error: `size mismatch for ${name}` };
    }
    if ((await sha256Hex(bytes)) !== entry.sha256) return { ok: false, error: `sha256 mismatch for ${name}` };
    let json;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return { ok: false, error: `list JSON invalid for ${name}` };
    }
    if (name === 'keywords.json') {
      if (!Array.isArray(json.keywords)) return { ok: false, error: 'keywords.json malformed' };
      keywords = json.keywords.map((k) => String(k).toLowerCase());
    } else {
      if (!Array.isArray(json.domains)) return { ok: false, error: `${name} malformed` };
      for (const d of json.domains) domains.push(String(d).toLowerCase());
    }
  }
  return { ok: true, domains, keywords };
}

// ── orchestration (uses injected deps, so it's testable without chrome/network) ──

// One full update cycle. `deps` = { fetchBytes(url, cap)->Uint8Array, storage
// (chrome.storage.local-like), noble, whitelist }. Returns a result object;
// never throws. Applies (writes storage) only on full success.
async function runOtaCheck(deps) {
  const { fetchBytes, storage, noble, whitelist } = deps;
  // `pubkeys` is injectable only so the test suite can drive the full apply
  // path with a key it controls; real callers (otaDeps) never set it, so the
  // baked OTA_PUBKEYS_HEX are what actually gate production updates.
  const pubkeys = deps.pubkeys || OTA_PUBKEYS_HEX;
  const meta = (await storage.get([OTA_META_KEY]))[OTA_META_KEY] || {};
  const installedVersion = meta.installedVersion || 0;

  let manifestBytes, sigText;
  try {
    manifestBytes = await fetchBytes(`${OTA_RELEASE_BASE}/${MANIFEST_ASSET}`, OTA_MAX_MANIFEST_BYTES);
    sigText = new TextDecoder().decode(await fetchBytes(`${OTA_RELEASE_BASE}/${MANIFEST_SIG_ASSET}`, OTA_MAX_SIG_BYTES));
  } catch (e) {
    return await finish(storage, meta, 'fetch-failed');
  }

  if (!(await verifyManifestSig(manifestBytes, sigText, noble, pubkeys))) {
    return await finish(storage, meta, 'bad-signature');
  }
  const parsed = parseManifest(manifestBytes);
  if (!parsed.ok) return await finish(storage, meta, `bad-manifest:${parsed.error}`);
  const manifest = parsed.manifest;

  if (!versionIsAcceptable(manifest.version, installedVersion)) {
    return await finish(storage, meta, 'not-newer');
  }

  const assembled = await assembleLists(manifest, (name) =>
    fetchBytes(`${OTA_RELEASE_BASE}/${name}`, OTA_MAX_TOTAL_BYTES),
  );
  if (!assembled.ok) return await finish(storage, meta, `assemble-failed:${assembled.error}`);

  const collision = whitelistCollision(assembled.domains, whitelist);
  if (collision) return await finish(storage, meta, `whitelist-collision:${collision}`);

  await storage.set({
    [OTA_STORAGE_KEY]: {
      version: manifest.version,
      domains: assembled.domains,
      keywords: assembled.keywords,
      appliedAt: Date.now(),
    },
  });
  return await finish(storage, meta, 'applied', manifest.version);
}

async function finish(storage, meta, result, newInstalledVersion) {
  const updated = {
    ...meta,
    lastCheck: Date.now(),
    lastResult: result,
    installedVersion: newInstalledVersion != null ? newInstalledVersion : meta.installedVersion || 0,
  };
  await storage.set({ [OTA_META_KEY]: updated });
  return { result, installedVersion: updated.installedVersion };
}

// Read a previously-applied, still-valid OTA set from storage. Returns
// { domains, keywords, version } or null. The whitelist floor is re-checked on
// read too, so even a set that somehow landed in storage without passing it
// (older code, manual edit) can never block a whitelisted domain — the
// bundled lists are used instead (caller falls back).
async function loadStoredOta(storage, whitelist) {
  const rec = (await storage.get([OTA_STORAGE_KEY]))[OTA_STORAGE_KEY];
  if (!rec || !Array.isArray(rec.domains) || !Array.isArray(rec.keywords) || !Number.isInteger(rec.version)) {
    return null;
  }
  if (whitelistCollision(rec.domains, whitelist)) return null;
  return { domains: rec.domains, keywords: rec.keywords, version: rec.version };
}

// ── service-worker glue (real globals; skipped under the Node test harness) ───

// A size-capped fetch returning raw bytes. Rejects if the body exceeds `cap`.
async function fetchBytesReal(url, cap) {
  const resp = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length > cap) throw new Error('asset over size cap');
  return buf;
}

function otaDeps() {
  return {
    fetchBytes: fetchBytesReal,
    storage: chrome.storage.local,
    noble: globalThis.nobleEd25519,
    // WHITELIST_DOMAINS is defined by bg/matching.js, loaded before this file.
    whitelist: typeof WHITELIST_DOMAINS !== 'undefined' ? WHITELIST_DOMAINS : [],
  };
}

// Register the weekly alarm + its handler. Idempotent (chrome.alarms.create
// with the same name just resets the period), so it's safe to call on both
// install and startup, mirroring bg/reminders.js's armReminderAlarm pattern.
function armOtaAlarm() {
  try {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(OTA_ALARM, { periodInMinutes: OTA_PERIOD_MINUTES });
  } catch (e) {
    // Non-fatal: a browser that can't schedule alarms simply keeps running on
    // its last-good (or bundled) lists — the safety floor holds.
    console.error('Pure Path OTA: alarm arm failed', e);
  }
}

// Exposed for bg/blocklists.js (prefer-OTA-over-bundled) and the test suite.
const PurePathOTA = {
  parseManifest,
  versionIsAcceptable,
  whitelistCollision,
  verifyManifestSig,
  assembleLists,
  runOtaCheck,
  loadStoredOta,
  armOtaAlarm,
  otaDeps,
  OTA_ALARM,
  OTA_STORAGE_KEY,
  OTA_META_KEY,
  OTA_PUBKEYS_HEX,
};

// Both worlds: attach to the service-worker/global scope, and export for Node.
if (typeof globalThis !== 'undefined') globalThis.PurePathOTA = PurePathOTA;
if (typeof module === 'object' && module.exports) module.exports = PurePathOTA;

// ── self-registration (same shape as bg/reminders.js) ────────────────────────
// Arm the weekly alarm on install + startup, and run the alarm's check when it
// fires. Guarded so the file is inert under the Node test harness (no
// chrome.runtime there) — tests drive runOtaCheck() directly with fake deps.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(armOtaAlarm);
  chrome.runtime.onStartup.addListener(armOtaAlarm);
  if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === OTA_ALARM) runOtaCheck(otaDeps()).catch(() => {});
    });
  }
}
