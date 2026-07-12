// extension/tests/run-all.cjs — the single test entry point (this exact path is
// what CI runs: `node extension/tests/run-all.cjs`). Discovers every
// test-*.cjs file in this directory, calls its exported run(), aggregates the
// summaries, and exits non-zero if anything failed.
'use strict';
const fs = require('fs');
const path = require('path');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => /^test-.*\.cjs$/.test(f))
  .sort();

if (files.length === 0) {
  console.error('run-all: no test-*.cjs files found — refusing to pass an empty suite');
  process.exit(2);
}

let totalPass = 0;
let totalFail = 0;
const failedSuites = [];

// `run()` may be sync (returns a summary object) or async (returns a Promise of
// one) — `await` on a plain object is a no-op, so both work uniformly and no
// existing sync suite needs to change. test-ota.cjs is async (it drives the
// OTA fetch/verify pipeline with fake deps and awaits real Ed25519 crypto).
(async () => {
  for (const f of files) {
    let summary;
    try {
      const mod = require(path.join(__dirname, f));
      if (typeof mod.run !== 'function') throw new Error('does not export run()');
      summary = await mod.run();
    } catch (e) {
      // A suite that can't even load/run is a hard failure, not a skip.
      console.error(`\n[CRASH] ${f}: ${e && e.stack ? e.stack : e}`);
      totalFail += 1;
      failedSuites.push({ file: f, crashed: true });
      continue;
    }
    totalPass += summary.pass;
    totalFail += summary.fail;
    const status = summary.fail === 0 ? 'PASS' : 'FAIL';
    console.log(`\n[${status}] ${f} — ${summary.pass} passed, ${summary.fail} failed`);
    if (summary.fail > 0) {
      failedSuites.push({ file: f, failures: summary.failures });
      for (const { label, extra } of summary.failures) {
        console.log(`    ✗ ${label}${extra ? ` — ${extra}` : ''}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed across ${files.length} suites`);
  if (totalFail > 0) {
    console.log(`Failing suites: ${failedSuites.map((s) => s.file).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
})();
