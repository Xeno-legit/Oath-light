// extension/tests/test-safesearch.cjs
// Direct unit coverage of checkSearchEngineSafeSearch() (Tier-1/Tier-2 search
// engine enforcement) and matchSearchQueryPorn() (the nuclear search-query
// keyword filter shared by Reddit/Patreon/graylist search). Includes generous
// innocent-query negative cases — "chicken breast recipe" and friends — since
// an over-eager keyword filter is exactly the false-positive failure mode this
// project has already been burned by once.
'use strict';
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { checkSearchEngineSafeSearch, matchSearchQueryPorn } = sandbox;
  const runner = createRunner('test-safesearch');

  // ── Tier 1 — always forces the strict SafeSearch param, on any query ────────
  {
    const r = checkSearchEngineSafeSearch('https://www.google.com/search?q=chicken+breast+recipe', 'www.google.com');
    runner.ok(r && r.safesearch === true, 'Google innocent query still gets SafeSearch forced (Tier 1, always-on)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.bing.com/search?q=weather+forecast', 'www.bing.com');
    runner.ok(r && r.safesearch === true, 'Bing innocent query still gets SafeSearch forced', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.google.de/search?q=test&udm=2', 'www.google.de');
    runner.ok(r && r.safesearch === true, 'regional Google TLD (google.de) also forced', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.google.com/search?q=cats&safe=active', 'www.google.com');
    runner.ok(!r, 'already-safe query returns null (no redundant redirect)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.google.com/search?q=cats&safe=off', 'www.google.com');
    runner.ok(r && r.blocked === true && r.reason === 'safesearch_bypass', 'explicit safe=off bypass attempt is BLOCKED, not just re-forced', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://mail.google.com/mail/u/0/', 'mail.google.com');
    runner.ok(!r, 'non-search Google subdomain (mail.) is not touched at all', JSON.stringify(r));
  }

  // ── Tier 2 — porn query text → BLOCK; innocent query → allowed/param-forced ─
  {
    const r = checkSearchEngineSafeSearch('https://yandex.com/search/?text=porn', 'yandex.com');
    runner.ok(r && r.blocked === true, 'Yandex porn-keyword query is blocked outright', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://yandex.com/search/?text=weather', 'yandex.com');
    runner.ok(r && r.safesearch === true, 'Yandex innocent query still gets family param forced', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://yandex.com/images/search?text=cats', 'yandex.com');
    runner.ok(r && r.blocked === true && r.reason === 'search_media_uncovered', 'Yandex image-search SURFACE is blocked regardless of query text', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://search.brave.com/search?q=naked+women', 'search.brave.com');
    runner.ok(r && r.blocked === true, 'Brave porn-keyword query blocked', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.ecosia.org/search?q=chicken+breast+recipe', 'www.ecosia.org');
    runner.ok(!r || r.blocked !== true, 'Ecosia innocent recipe query is NOT blocked', JSON.stringify(r));
  }

  // ── non-engine hostnames are simply not matched ─────────────────────────────
  {
    const r = checkSearchEngineSafeSearch('https://example.com/search?q=anything', 'example.com');
    runner.ok(!r, 'unrelated hostname returns null (not a recognised search engine)', JSON.stringify(r));
  }

  // ── matchSearchQueryPorn — the shared nuclear keyword filter, direct ────────
  runner.ok(matchSearchQueryPorn('chicken breast recipe') === null, '"chicken breast recipe" is NOT flagged (breast != breasts)');
  runner.ok(matchSearchQueryPorn('essex university open day') === null, '"essex" whole word does not trip bare "sex"');
  runner.ok(matchSearchQueryPorn('massachusetts institute of technology') === null, '"massachusetts" does not trip "ass"');
  runner.ok(matchSearchQueryPorn('grape jelly recipe') === null, '"grape" does not trip "rape"');
  runner.ok(matchSearchQueryPorn('scunthorpe town centre') === null, 'the original Scunthorpe problem, as a search query');
  runner.ok(matchSearchQueryPorn('classic rock playlist') === null, '"classic" does not trip "ass"');
  runner.ok(matchSearchQueryPorn('') === null, 'empty query is not flagged');
  runner.ok(matchSearchQueryPorn(null) === null, 'null query is not flagged');
  runner.ok(matchSearchQueryPorn('best hiking boots 2024') === null, 'plain innocent query');

  runner.ok(matchSearchQueryPorn('free porn videos') !== null, 'unambiguous hard-porn query IS flagged');
  runner.ok(matchSearchQueryPorn('lingerie try on haul') !== null, 'suggestive soft-porn query IS flagged');
  runner.ok(matchSearchQueryPorn('p o r n') !== null, 'spelled-out obfuscation ("p o r n") is de-spaced and flagged');
  runner.ok(matchSearchQueryPorn('h3ntai') !== null, 'leet obfuscation ("h3ntai") is flagged');
  // KNOWN GAP (pre-existing, verified identical in the pre-split monolith):
  // run-together compound words like "milfhunter" are NOT flagged — the
  // de-space pass catches "m i l f" spacing, not concatenation. Pinned here as
  // current behavior; if the matcher ever learns this, flip the assertion.
  runner.ok(matchSearchQueryPorn('milfhunter compilation') === null, 'run-together compound ("milfhunter") is NOT flagged — documented gap');
  runner.ok(matchSearchQueryPorn('the rapist near me') === null, '"the rapist" (two words) must not trip guarded "rape" run-together rule');

  return runner.summary();
}

module.exports = { run };
