// extension/tests/test-load-order.cjs — regression test for the monolith split.
// Asserts that (a) evaluating the files in BOTH browsers' declared orders
// throws nothing (no ReferenceError from a definition landing after its use),
// (b) top-level init completes with the stubbed chrome and the key public
// functions exist afterwards, and (c) manifest.json's background block stays in
// sync with the on-disk bg/ files and the harness's expected order — the three
// places (manifest scripts array, background.js importScripts call, harness
// BG_FILES) must never drift apart.
'use strict';
const fs = require('fs');
const path = require('path');
const { buildSandbox, BG_FILES, ENTRY_FILE, EXT_ROOT, readExt } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

// Functions the rest of the extension (and the tests) rely on being global.
const REQUIRED_GLOBALS = [
  'shouldBlockUrl',
  'checkDomainKeywords',
  'idnToUnicode',
  'foldConfusables',
  'checkSearchEngineSafeSearch',
  'handleBlock',
  'loadBlocklists',
];

function run() {
  const runner = createRunner('test-load-order');

  for (const mode of ['firefox', 'chrome']) {
    let built = null;
    let threw = null;
    try {
      built = buildSandbox({ mode });
    } catch (e) {
      threw = e;
    }
    runner.ok(threw === null, `${mode}: all scripts evaluate without throwing`, String(threw));
    if (!built) continue;

    const expectedOrder = [...BG_FILES, ENTRY_FILE].join(' → ');
    // Chrome mode loads ENTRY first, which then importScripts the bg/ files —
    // so the *evaluation completion* order differs, but every file must load.
    runner.equal(
      built.filesLoaded.length,
      BG_FILES.length + 1,
      `${mode}: all ${BG_FILES.length + 1} files loaded (${expectedOrder})`
    );

    for (const name of REQUIRED_GLOBALS) {
      runner.ok(
        typeof built.sandbox[name] === 'function',
        `${mode}: global ${name}() defined after load`,
        `typeof = ${typeof built.sandbox[name]}`
      );
    }
  }

  // Manifest consistency: background.scripts must be exactly BG_FILES then
  // background.js, and service_worker must stay background.js.
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
  runner.equal(manifest.background.service_worker, ENTRY_FILE, 'manifest: service_worker is background.js');
  runner.equal(
    JSON.stringify(manifest.background.scripts),
    JSON.stringify([...BG_FILES, ENTRY_FILE]),
    'manifest: background.scripts matches harness order (bg/* then background.js)'
  );

  // background.js's importScripts call must list the same files in the same
  // order as the manifest — the Chrome and Firefox paths must agree.
  const entrySrc = readExt(ENTRY_FILE);
  // Require a quote inside the parens so a bare "importScripts()" mention in a
  // comment can't shadow the real call.
  const m = entrySrc.match(/importScripts\((\s*['"][^)]*)\)/);
  runner.ok(!!m, 'background.js contains an importScripts(...) call');
  if (m) {
    const listed = m[1].match(/'[^']+'|"[^"]+"/g).map((s) => s.slice(1, -1));
    runner.equal(
      JSON.stringify(listed),
      JSON.stringify(BG_FILES),
      'background.js importScripts order matches manifest bg/ order'
    );
  }

  // Every bg/ file on disk is actually declared (no orphan module silently
  // never loaded in the browser). BG_FILES also carries non-bg/ entries — the
  // shared design-system copies loaded into the worker, e.g. strings.js — so
  // filter to the bg/ ones before comparing against the directory listing.
  const onDisk = fs.readdirSync(path.join(EXT_ROOT, 'bg')).filter((f) => f.endsWith('.js')).sort();
  runner.equal(
    JSON.stringify(onDisk),
    JSON.stringify(BG_FILES.filter((f) => f.startsWith('bg/')).map((f) => f.replace('bg/', '')).sort()),
    'every bg/*.js on disk is declared in the load order'
  );

  // The worker's strings copy must be the design-system source verbatim — the
  // same invariant scripts/ci/check-design-system-sync.mjs enforces repo-wide,
  // asserted here too so the extension suite alone catches a hand-edited copy.
  runner.equal(
    readExt('strings.js'),
    fs.readFileSync(path.join(EXT_ROOT, '..', 'design-system', 'strings.js'), 'utf8'),
    'extension/strings.js is byte-identical to design-system/strings.js'
  );

  return runner.summary();
}

module.exports = { run };
