// extension/tests/test-idn-punycode.cjs
// Direct unit coverage of the punycode decoder (punycodeDecode / idnToUnicode)
// used to recover the Unicode hostname from an ACE (xn--...) label before the
// domain-keyword layer matches native-script stems. Uses real punycode strings
// produced by Node's own WHATWG URL implementation for round-trip confidence.
'use strict';
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { idnToUnicode, punycodeDecode } = sandbox;
  const runner = createRunner('test-idn-punycode');

  // Real xn-- hostnames, as produced by `new URL(...)`.hostname for these inputs.
  runner.equal(idnToUnicode('xn--m1abbbg.com'), 'порно.com', 'decodes Cyrillic "порно.com"');
  runner.equal(idnToUnicode('xn--fiqs8s.com'), '中国.com', 'decodes Chinese "中国.com"');
  runner.equal(idnToUnicode('xn--wgv71a.jp'), '日本.jp', 'decodes Japanese "日本.jp"');
  runner.equal(idnToUnicode('xn--mnchen-3ya.de'), 'münchen.de', 'decodes German umlaut "münchen.de"');
  runner.equal(idnToUnicode('xn--kln-sna.de'), 'köln.de', 'decodes German umlaut "köln.de"');

  // Multi-label hostnames: only the xn-- labels decode, ASCII labels pass through.
  runner.equal(idnToUnicode('www.xn--fiqs8s.com'), 'www.中国.com', 'only the ACE label decodes, "www" untouched');

  // Non-IDN hostnames are returned unchanged (no xn-- label present).
  runner.equal(idnToUnicode('github.com'), 'github.com', 'plain ASCII hostname passes through unchanged');
  runner.equal(idnToUnicode('sub.example.co.uk'), 'sub.example.co.uk', 'plain multi-label hostname unchanged');

  // Malformed / non-decodable punycode must not throw — falls back to the raw label.
  runner.ok(typeof idnToUnicode('xn--') === 'string', 'degenerate "xn--" label does not throw');
  runner.ok(typeof idnToUnicode('xn--!!!invalid') === 'string', 'invalid punycode payload does not throw');

  // punycodeDecode() directly (label with the "xn--" prefix already stripped).
  runner.equal(punycodeDecode('m1abbbg'), 'порно', 'punycodeDecode: raw label → порно');
  runner.equal(punycodeDecode('fiqs8s'), '中国', 'punycodeDecode: raw label → 中国');
  // The decoder is permissive: garbage input yields a garbage string rather
  // than null (verified identical in the pre-split monolith). The safety
  // property that matters is that it never THROWS on hostile input.
  runner.ok(
    (() => { try { const r = punycodeDecode('!!!not-valid-digits'); return r === null || typeof r === 'string'; } catch { return false; } })(),
    'punycodeDecode never throws on invalid input (returns string or null)'
  );

  return runner.summary();
}

module.exports = { run };
