// extension/tests/test-domain-keywords.cjs
// Direct unit coverage of checkDomainKeywords() (the hostname-only domain-name
// keyword layer) and its building blocks — leetspeak normalisation, confusable
// (homoglyph) folding, and the guarded-root whitelist-exemption logic. Heavy on
// negative cases: false positives on this layer are the project's historical
// failure mode (the Scunthorpe problem).
'use strict';
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { checkDomainKeywords, normalizeLeet, foldConfusables } = sandbox;
  const runner = createRunner('test-domain-keywords');

  function hit(host, label) {
    const r = checkDomainKeywords(host);
    runner.ok(r.hit === true, label || `${host} → hit`, JSON.stringify(r));
  }
  function clean(host, label) {
    const r = checkDomainKeywords(host);
    runner.ok(r.hit === false, label || `${host} → clean`, JSON.stringify(r));
  }

  // ── strong stems: match anywhere, no whitelist escape ──────────────────────
  hit('pornhub.com');
  hit('videos.xvideos.com', 'subdomain still hits');
  hit('sex4arabs.com', 'the canonical "list misses it, keyword catches it" case');
  hit('chaturbate.com');
  hit('sharmota.tv', 'Arabizi multilingual stem');
  hit('caonima.cc', 'pinyin multilingual stem');

  // ── adult TLDs ──────────────────────────────────────────────────────────────
  hit('foo.xxx');
  hit('bar.porn');
  hit('baz.adult');
  clean('proxy.xxxiii.com', 'xxxiii (roman numeral) is not the .xxx TLD');

  // ── compounds: collision-heavy roots ONLY match in explicit context ─────────
  hit('bigtits.com');
  hit('asshole.net');
  hit('wetpussy.xxx');
  clean('cumulative.com', 'cum is compound-only');
  clean('document.net', 'cum is compound-only');
  clean('classroom.com', 'ass is compound-only');
  clean('octopus.energy', 'pus(sy) must not trip — real UK energy company');
  clean('platypus.com');
  clean('massachusetts.gov');

  // ── guarded roots: block standalone, allow when whitelist-covered ──────────
  hit('sex.com', 'guarded root standalone → block');
  hit('anal.com');
  hit('milf.com');
  hit('rape.org');
  hit('cunt.net');
  clean('essex.gov.uk', 'sex → essex (whitelist-covered)');
  clean('www.essex.ac.uk', 'University of Essex');
  clean('sussex.ac.uk');
  clean('middlesex.edu');
  clean('analytics.google.com', 'anal → analytics');
  clean('canalplus.com', 'anal → canal covers it');
  clean('peacock.com', 'cock → peacock (NBC streaming)');
  clean('cockpit.io');
  clean('hitchcock.com');
  clean('dickens.org', 'dick → Dickens');
  clean('grapefruit.com', 'rape → grapefruit');
  clean('scunthorpe.gov.uk', 'the original Scunthorpe problem');
  clean('milford.com', 'milf → Milford');

  // ── AI-erotica compounds (plan 3.3): KEYWORD_COMPOUNDS_AI_EROTICA ───────────
  // Compound-only, zero whitelist escape — representative sample of the
  // aigirlfriend/nsfwgpt family (both word orders, plus the virtual* variants).
  hit('aigirlfriend.com');
  hit('mygirlfriendai.app', 'girlfriendai inside a longer host still hits');
  hit('virtualgirlfriend.io');
  hit('aiboyfriend.chat');
  hit('virtualboyfriend.app');
  hit('nsfwgpt.xyz');
  hit('gptnsfw.com');
  hit('aiwaifu.chat');
  hit('waifuai.net');
  hit('lewdai.app');
  hit('nudeai.io');
  hit('ainude.top');
  hit('hentaiai.com', 'also reachable via the bare hentai stem — pinned as a compound too');

  // guarded root 'aicompanion' (plan 3.3): blocks standalone, escapes only via
  // the "-ai"-final-word + companion whitelist entries.
  hit('aicompanion.com', 'guarded root aicompanion standalone → block');
  hit('myaicompanion.app', 'aicompanion inside an unexcused longer host → block');
  clean('bonsaicompanion.com', 'bonsai + companion (gardening) — whitelist trap');
  clean('samuraicompanion.com', 'samurai + companion (game guide) — whitelist trap');
  clean('acaicompanion.com', 'acai + companion (nutrition) — whitelist trap');

  // tavernai was deliberately DROPPED as a compound (sits inside real Greek
  // restaurant names; tavernai.net is an exact entry in domains_ai.json
  // instead). None of these hostnames are exact-listed in any blocklist, so
  // this isolates the keyword layer.
  clean('tavernaithaki.com', 'Taverna Ithaki — real Greek restaurant name containing "tavernai"');
  clean('tavernaithaki.gr');
  clean('tavern.com', 'bare tavern is not a keyword');
  clean('openai.com', 'legit AI tooling must not keyword-block');
  clean('companionlife.com', 'bare "companion" is deliberately NOT a root — real insurance brand');

  // ── deep multilingual false-positive traps (the highest-value FP corpus) ───
  clean('reputable.com', 'puta → reputable');
  clean('computation.org', 'puta → computation');
  clean('grandiose.com', 'randi → grandiose');
  clean('parachute.com', 'chut → parachute');
  clean('chutney.co.uk');
  clean('trapezoid.com', 'rape → trapezoid');
  clean('cockatiel-care.com', 'cock → cockatiel');
  clean('kundera-books.com', 'kunda → Milan Kundera');
  clean('mobydick.com', 'dick → Moby-Dick');
  clean('sexsmith.ca', 'sex → real Alberta town');
  clean('excluder.com', 'luder (demoted-strong) → excluder');
  clean('tittensor.co.uk', 'titten → Staffordshire village');
  clean('cockermouth.gov.uk', 'cock → covered by "cocker"');
  clean('clitheroe.gov.uk', 'no stem at all — real Lancashire town');
  clean('penistone.gov.uk', 'no stem at all — real town');
  clean('arsenal.com', 'no "anal" substring in arsenal');

  // ── control: unrelated / must-allow domains ─────────────────────────────────
  clean('github.com');
  clean('wikipedia.org');
  clean('nofap.com', 'recovery resource — must never be blocked');
  clean('furaffinity.net', 'graylist, not keyword-blocked');
  clean('example.com');

  // ── leetspeak normalisation ─────────────────────────────────────────────────
  hit('p0rnhub.com', '0→o');
  hit('s3x.com', '3→e → sex');
  hit('h3nta1.tv', 'hentai');
  hit('xh4mster.com', '4→a → xhamster');
  clean('e55ex.com', 'leet → essex must stay covered');
  clean('cl4ssic.com', 'leet must not create new collisions');
  runner.ok(normalizeLeet('p0rn') === 'porn', 'normalizeLeet: p0rn → porn');
  runner.ok(normalizeLeet('s3xy') === 'sexy', 'normalizeLeet: s3xy → sexy');
  runner.ok(normalizeLeet('clean') === 'clean', 'normalizeLeet: no-op on clean text');

  // ── confusable / homoglyph folding ──────────────────────────────────────────
  hit('xn--sex-nfd.com', 'punycode for "sexх" (trailing Cyrillic kha) — Latin "sex" already hits before folding');
  runner.ok(foldConfusables('pоrn') === 'porn', 'foldConfusables folds Cyrillic о → Latin o');
  runner.ok(foldConfusables('clean') === 'clean', 'foldConfusables no-op on pure ASCII');

  // ── native-script stems (via real punycode hostnames, as a browser delivers) ─
  {
    const url = new sandbox.URL('https://порно.com/'); // Node punycodes to xn--m1abbbg.com
    hit(url.hostname, 'punycode-encoded Cyrillic "порно" (porno) → hit');
  }
  {
    const url = new sandbox.URL('https://中国.com/'); // Node punycodes to xn--fiqs8s.com — must stay clean
    clean(url.hostname, 'punycode-encoded Chinese "中国" (China) → must stay clean');
  }

  return runner.summary();
}

module.exports = { run };
