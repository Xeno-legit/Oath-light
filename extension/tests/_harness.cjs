// extension/tests/_harness.cjs — shared sandbox builder for every test-*.cjs
// file. Not itself a test file.
//
// Loads the REAL extension source (bg/*.js + background.js) into a Node `vm`
// context with a minimal chrome-API stub, in the same load order the browser
// uses, so the pure matching functions (shouldBlockUrl, checkDomainKeywords,
// idnToUnicode, checkSearchEngineSafeSearch, ...) can be exercised directly —
// no mocking of the functions themselves, only of the chrome.* host APIs.
//
// Two modes mirror the two entries in manifest.json's "background" block:
//   'firefox' — evaluate bg/blocklists.js, bg/matching.js, bg/graylist.js,
//               bg/native-bridge.js, bg/reminders.js, then background.js, each
//               as a separate script sharing ONE global scope (exactly what
//               Firefox's `background.scripts` array does — sequential classic
//               scripts, no importScripts). `importScripts` is left undefined,
//               matching a real Firefox global.
//   'chrome'  — evaluate ONLY background.js, first installing a real
//               `importScripts` stub that itself loads the bg/ files (in the
//               exact argument order background.js passes). This exercises the
//               Chrome MV3 classic-service-worker path for real, including the
//               `typeof importScripts === 'function'` guard at the top of
//               background.js.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT_ROOT = path.join(__dirname, '..');

// Must match manifest.json's background.scripts order (Firefox), minus the
// trailing background.js entry (added separately below).
const BG_FILES = [
  'bg/blocklists.js',
  'bg/matching.js',
  'bg/graylist.js',
  'bg/native-bridge.js',
  'bg/reminders.js',
];
const ENTRY_FILE = 'background.js';

function readExt(relPath) {
  return fs.readFileSync(path.join(EXT_ROOT, relPath), 'utf8');
}

// ── minimal chrome stub (modeled on the proven harness in
//    "MD files/cjs files/test-adversarial-fixes.cjs") ────────────────────────
function makeChromeStub() {
  const noop = () => {};
  const listener = { addListener: noop, removeListener: noop, hasListener: () => false };
  const store = {}; // backing store for chrome.storage.local
  const dnrCalls = []; // recorded declarativeNetRequest.updateEnabledRulesets args

  const asyncGet = (keys) => {
    const r = {};
    const list = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
    for (const k of list) if (Object.prototype.hasOwnProperty.call(store, k)) r[k] = store[k];
    return Promise.resolve(r);
  };
  const asyncSet = (obj) => { Object.assign(store, obj); return Promise.resolve(); };
  const asyncRemove = (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete store[k];
    return Promise.resolve();
  };

  const chrome = {
    runtime: {
      onInstalled: listener, onStartup: listener, onMessage: listener, onConnect: listener,
      getURL: (p) => 'chrome-extension://test/' + p,
      getManifest: () => ({ version: 'test' }),
      id: 'test',
      lastError: null,
      connectNative: () => ({ onMessage: listener, onDisconnect: listener, postMessage: noop, disconnect: noop }),
      sendMessage: noop,
    },
    storage: {
      local: { get: asyncGet, set: asyncSet, remove: asyncRemove },
      onChanged: listener,
    },
    tabs: {
      onRemoved: listener, onUpdated: listener,
      get: () => Promise.resolve({ url: '' }),
      update: () => Promise.resolve(),
    },
    webNavigation: { onBeforeNavigate: listener, onHistoryStateUpdated: listener, onCommitted: listener },
    cookies: { set: () => Promise.resolve(), get: () => Promise.resolve(null), remove: () => Promise.resolve() },
    alarms: { create: noop, get: () => Promise.resolve(null), onAlarm: listener, clear: noop },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
    // DNR stub — records updateEnabledRulesets calls so the YouTube-Restrict
    // opt-in toggle (bg/blocklists.js applyYouTubeRestrictRuleset) is testable.
    declarativeNetRequest: {
      updateEnabledRulesets: (opts) => { dnrCalls.push(opts); return Promise.resolve(); },
      updateDynamicRules: () => Promise.resolve(),
      getEnabledRulesets: () => Promise.resolve([]),
    },
  };
  return { chrome, store, dnrCalls };
}

function makeSandbox() {
  const { chrome, store, dnrCalls } = makeChromeStub();
  const sandbox = {
    chrome, console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Set, Map, Promise,
    crypto: (typeof crypto !== 'undefined') ? crypto : undefined,
    fetch: () => Promise.reject(new Error('no fetch in test sandbox')),
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, store, dnrCalls };
}

// Evaluate the Firefox `background.scripts` order: each bg/ file then
// background.js, as separate classic scripts sharing one global scope.
// `importScripts` stays undefined, exactly like a real Firefox background page.
function loadFirefoxOrder(sandbox, filesLoaded) {
  for (const rel of [...BG_FILES, ENTRY_FILE]) {
    const code = readExt(rel);
    vm.runInContext(code, sandbox, { filename: rel });
    if (filesLoaded) filesLoaded.push(rel);
  }
}

// Evaluate the Chrome classic-service-worker path: install a real
// importScripts() on the sandbox, then run ONLY background.js — its own
// top-of-file `importScripts('bg/blocklists.js', ...)` call does the rest.
function loadChromeOrder(sandbox, filesLoaded) {
  sandbox.importScripts = function (...files) {
    for (const rel of files) {
      const code = readExt(rel);
      vm.runInContext(code, sandbox, { filename: rel });
      if (filesLoaded) filesLoaded.push(rel);
    }
  };
  const code = readExt(ENTRY_FILE);
  vm.runInContext(code, sandbox, { filename: ENTRY_FILE });
  if (filesLoaded) filesLoaded.push(ENTRY_FILE);
}

// mode: 'firefox' (default) or 'chrome'.
// Returns { sandbox, store, filesLoaded, dnrCalls }.
function buildSandbox(opts) {
  const mode = (opts && opts.mode) || 'firefox';
  const { sandbox, store, dnrCalls } = makeSandbox();
  const filesLoaded = [];
  if (mode === 'chrome') loadChromeOrder(sandbox, filesLoaded);
  else loadFirefoxOrder(sandbox, filesLoaded);
  return { sandbox, store, filesLoaded, dnrCalls };
}

module.exports = { buildSandbox, makeSandbox, BG_FILES, ENTRY_FILE, EXT_ROOT, readExt };
