// extension/tests/test-safesearch.cjs
// Direct unit coverage of checkSearchEngineSafeSearch() (Tier-1/Tier-2 search
// engine enforcement) and matchSearchQueryPorn() (the nuclear search-query
// keyword filter shared by Reddit/Patreon/graylist search). Includes generous
// innocent-query negative cases — "chicken breast recipe" and friends — since
// an over-eager keyword filter is exactly the false-positive failure mode this
// project has already been burned by once.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildSandbox, EXT_ROOT } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox, dnrCalls } = buildSandbox({ mode: 'firefox' });
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

  // ── Ecosia param enforcement (plan 3.4 — safesearch=2 is the strict value) ──
  {
    const r = checkSearchEngineSafeSearch('https://www.ecosia.org/search?q=weather', 'www.ecosia.org');
    runner.ok(r && r.safesearch === true && r.redirectUrl && r.redirectUrl.includes('safesearch=2'),
      'Ecosia query without safesearch=2 gets the strict param forced (redirect)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.ecosia.org/search?q=weather&safesearch=2', 'www.ecosia.org');
    runner.ok(!r, 'Ecosia already-strict query returns null (no redundant redirect)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.ecosia.org/search?q=porn', 'www.ecosia.org');
    runner.ok(r && r.blocked === true, 'Ecosia porn-keyword query is blocked outright (Tier 2)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://www.ecosia.org/search?q=cats&safesearch=0', 'www.ecosia.org');
    runner.ok(r && r.blocked === true && r.reason === 'safesearch_bypass',
      'Ecosia safesearch=0 bypass attempt is BLOCKED, not just re-forced', JSON.stringify(r));
  }

  // ── direct image-CDN access (plan 3.4 — isDirectImageCdn via the same entry) ─
  // The raw thumbnail servers BEHIND the engines' image search: pasting a
  // thumbnail / "view image" URL into the address bar must block.
  {
    const r = checkSearchEngineSafeSearch('https://th.bing.com/th?id=OIP.abc123', 'th.bing.com');
    runner.ok(r && r.blocked === true && r.reason === 'search_media_uncovered',
      'Bing thumbnail CDN th.bing.com/th?id=… blocks', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://tse1.mm.bing.net/th?id=OIP.abc123&pid=Api', 'tse1.mm.bing.net');
    runner.ok(r && r.blocked === true && r.reason === 'search_media_uncovered',
      'Bing thumbnail farm tse1.mm.bing.net/th?id=… blocks', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://im0-tub-ru.yandex.net/i?id=abc123&n=13', 'im0-tub-ru.yandex.net');
    runner.ok(r && r.blocked === true && r.reason === 'search_media_uncovered',
      'Yandex thumbnail farm im0-tub-ru.yandex.net/i?id=… blocks', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://avatars.mds.yandex.net/get-images-cbir/123456/abc/orig', 'avatars.mds.yandex.net');
    runner.ok(r && r.blocked === true && r.reason === 'search_media_uncovered',
      'Yandex full-size store avatars.mds.yandex.net/get-images-… blocks', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://avatars.mds.yandex.net/get-music-content/123456/cover/200x200', 'avatars.mds.yandex.net');
    runner.ok(!r, 'avatars.mds.yandex.net non-image namespace (get-music-content) is NOT blocked (path-gated)', JSON.stringify(r));
  }
  {
    const r = checkSearchEngineSafeSearch('https://some.bing.net/api/x', 'some.bing.net');
    runner.ok(!r, 'unrelated *.bing.net infrastructure path (not /th) is NOT blocked (path-gated)', JSON.stringify(r));
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

  // ── YouTube Restricted Mode toggle (plan 3.4 — opt-in, DEFAULT OFF) ─────────
  // applyYouTubeRestrictRuleset (bg/blocklists.js) drives the static DNR
  // ruleset from blockingSettings.youtubeRestrict. blockingSettings is a
  // top-level `let` shared across the sandbox's global lexical scope, so we
  // set it exactly where the native-bridge set_blocking handler does, via a
  // script evaluated in the same context. The harness's chrome stub records
  // every updateEnabledRulesets call in dnrCalls.
  {
    // Default OFF: nothing pushed from the desktop yet → applying must DISABLE.
    const before = dnrCalls.length;
    vm.runInContext('applyYouTubeRestrictRuleset();', sandbox, { filename: 'test:yt-default' });
    const call = dnrCalls[dnrCalls.length - 1];
    runner.ok(dnrCalls.length === before + 1 &&
      call && Array.isArray(call.disableRulesetIds) && call.disableRulesetIds.includes('pp_youtube_restrict') &&
      !call.enableRulesetIds,
      'no settings pushed (default) → ruleset DISABLED (opt-in stays off)', JSON.stringify(call));
  }
  {
    vm.runInContext('blockingSettings = { youtubeRestrict: true }; applyYouTubeRestrictRuleset();', sandbox, { filename: 'test:yt-on' });
    const call = dnrCalls[dnrCalls.length - 1];
    runner.ok(call && Array.isArray(call.enableRulesetIds) && call.enableRulesetIds.includes('pp_youtube_restrict') &&
      !call.disableRulesetIds,
      'youtubeRestrict:true → updateEnabledRulesets enableRulesetIds [pp_youtube_restrict]', JSON.stringify(call));
  }
  {
    vm.runInContext('blockingSettings = { youtubeRestrict: false }; applyYouTubeRestrictRuleset();', sandbox, { filename: 'test:yt-off' });
    const call = dnrCalls[dnrCalls.length - 1];
    runner.ok(call && Array.isArray(call.disableRulesetIds) && call.disableRulesetIds.includes('pp_youtube_restrict') &&
      !call.enableRulesetIds,
      'youtubeRestrict:false → updateEnabledRulesets disableRulesetIds [pp_youtube_restrict]', JSON.stringify(call));
  }

  // ── DNR static ruleset shape (plan 3.4 — Startpage cookie-strip + YT header) ─
  // The Startpage SafeSearch mechanism and the YouTube-Restrict header rule are
  // declarative JSON; runtime behavior can't be exercised in Node, so pin the
  // shape: valid rule arrays, required fields, and manifest registration with
  // the correct enabled defaults.
  {
    const rulesetFiles = ['dnr/safesearch.json', 'dnr/youtube-restrict.json'];
    for (const rel of rulesetFiles) {
      let rules = null;
      try {
        rules = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, rel), 'utf8'));
      } catch (e) {
        runner.ok(false, `${rel} parses as JSON`, String(e));
        continue;
      }
      runner.ok(Array.isArray(rules) && rules.length > 0, `${rel} is a non-empty rule array`, JSON.stringify(rules));
      const ids = new Set();
      let shapeOk = true;
      for (const rule of rules) {
        if (!(Number.isInteger(rule.id) && rule.id > 0 &&
              Number.isInteger(rule.priority) && rule.priority > 0 &&
              rule.action && typeof rule.action === 'object' &&
              rule.condition && typeof rule.condition === 'object')) { shapeOk = false; break; }
        if (ids.has(rule.id)) { shapeOk = false; break; }
        ids.add(rule.id);
      }
      runner.ok(shapeOk, `${rel}: every rule has unique integer id + priority/action/condition`, JSON.stringify(rules));
    }
    // The YT ruleset must actually stamp the strict header — that IS the feature.
    const ytRules = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'dnr/youtube-restrict.json'), 'utf8'));
    const stampsHeader = ytRules.some((r) =>
      r.action && r.action.type === 'modifyHeaders' &&
      (r.action.requestHeaders || []).some((h) =>
        h.header === 'YouTube-Restrict' && h.operation === 'set' && h.value === 'Strict'));
    runner.ok(stampsHeader, 'youtube-restrict.json sets the YouTube-Restrict: Strict request header');

    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
    const resources = (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources) || [];
    const byId = {};
    for (const rr of resources) byId[rr.id] = rr;
    runner.ok(byId.pp_safesearch_static && byId.pp_safesearch_static.enabled === true &&
      byId.pp_safesearch_static.path === 'dnr/safesearch.json',
      'manifest registers pp_safesearch_static → dnr/safesearch.json, enabled:true', JSON.stringify(resources));
    runner.ok(byId.pp_youtube_restrict && byId.pp_youtube_restrict.enabled === false &&
      byId.pp_youtube_restrict.path === 'dnr/youtube-restrict.json',
      'manifest registers pp_youtube_restrict → dnr/youtube-restrict.json, enabled:false (opt-in default OFF)', JSON.stringify(resources));
    runner.ok(Array.isArray(manifest.permissions) && manifest.permissions.includes('declarativeNetRequest'),
      'manifest requests the declarativeNetRequest permission the rulesets need');
  }

  return runner.summary();
}

module.exports = { run };
