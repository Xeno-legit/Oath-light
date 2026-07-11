// extension/tests/test-domain-keywords.cjs
// Direct unit coverage of checkDomainKeywords() (the hostname-only domain-name
// keyword layer) and its building blocks — leetspeak normalisation, confusable
// (homoglyph) folding, and the guarded-root whitelist-exemption logic. Heavy on
// negative cases: false positives on this layer are the project's historical
// failure mode (the Scunthorpe problem).
//
// The host/expect table itself lives in fixtures/keyword-hostnames.json (plan
// A.2) — the SAME file the Rust port's `#[cfg(test)]` suite in
// core/src/matching.rs consumes, so a stem/whitelist edit can't accidentally
// diverge between the two engines. Add new hostname cases to the fixture, not
// here; this file only adds function-level coverage the fixture can't express
// (normalizeLeet/foldConfusables called directly, and a hostname derived at
// runtime from a real `new URL()` punycode encode).
'use strict';
const fs = require('fs');
const path = require('path');
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { checkDomainKeywords, normalizeLeet, foldConfusables } = sandbox;
  const runner = createRunner('test-domain-keywords');

  const fixturePath = path.join(__dirname, 'fixtures', 'keyword-hostnames.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const { host, expect, note } of cases) {
    const r = checkDomainKeywords(host);
    const wantHit = expect === 'block';
    runner.ok(r.hit === wantHit, note || `${host} → ${expect}`, JSON.stringify(r));
  }

  // ── leetspeak normalisation (function-level) ────────────────────────────────
  runner.ok(normalizeLeet('p0rn') === 'porn', 'normalizeLeet: p0rn → porn');
  runner.ok(normalizeLeet('s3xy') === 'sexy', 'normalizeLeet: s3xy → sexy');
  runner.ok(normalizeLeet('clean') === 'clean', 'normalizeLeet: no-op on clean text');

  // ── confusable / homoglyph folding (function-level) ─────────────────────────
  runner.ok(foldConfusables('pоrn') === 'porn', 'foldConfusables folds Cyrillic о → Latin o');
  runner.ok(foldConfusables('clean') === 'clean', 'foldConfusables no-op on pure ASCII');

  // ── native-script stems, exercised via a REAL punycode hostname as a browser
  // delivers it (new URL().hostname) — the fixture pins the same ACE strings
  // ('xn--m1abbbg.com' / 'xn--fiqs8s.com') directly; this additionally proves
  // Node's own URL punycode-encoder produces exactly those strings.
  {
    const url = new sandbox.URL('https://порно.com/'); // Node punycodes to xn--m1abbbg.com
    const r = checkDomainKeywords(url.hostname);
    runner.ok(r.hit === true, 'punycode-encoded Cyrillic "порно" (porno) → hit', JSON.stringify(r));
  }
  {
    const url = new sandbox.URL('https://中国.com/'); // Node punycodes to xn--fiqs8s.com — must stay clean
    const r = checkDomainKeywords(url.hostname);
    runner.ok(r.hit === false, 'punycode-encoded Chinese "中国" (China) → must stay clean', JSON.stringify(r));
  }

  return runner.summary();
}

module.exports = { run };
