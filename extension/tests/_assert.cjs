// extension/tests/_assert.cjs — tiny shared pass/fail counter used by every
// test-*.cjs file. Not itself a test file (doesn't match the test-*.cjs glob
// run-all.cjs uses to discover suites).
'use strict';

function createRunner(name) {
  let pass = 0;
  let fail = 0;
  const failures = [];

  function ok(cond, label, extra) {
    if (cond) {
      pass++;
    } else {
      fail++;
      failures.push({ label, extra });
    }
  }

  function equal(actual, expected, label) {
    ok(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  function summary() {
    return { name, pass, fail, failures };
  }

  return { ok, equal, summary };
}

module.exports = { createRunner };
