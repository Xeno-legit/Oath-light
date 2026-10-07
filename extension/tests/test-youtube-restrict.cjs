// extension/tests/test-youtube-restrict.cjs — the YouTube Restricted Mode
// switch.
//
// The feature used to be reachable from two places: the DNR ruleset keyed off
// `blockingSettings.youtubeRestrict` (a field the desktop app fills with
// `true` and pushes over the native bridge) and the graylist PREF cookie,
// which was written on every youtube.com navigation with no switch at all.
// Together that made the feature effectively always-on.
//
// It is now owned end-to-end by the extension: chrome.storage
// `ppYouTubeRestrict`, absent = OFF, flipped from the Blocklist Manager page.
// This suite pins the three properties that make that true:
//   1. OFF is the default on a fresh install, and the key going away returns
//      it to OFF.
//   2. NOTHING the desktop app pushes can arm it — its `youtubeRestrict`
//      field is simply never read by the background.
//   3. Turning it off actually stops both enforcement sites (the DNR header
//      rule AND the greylist PREF cookie) while leaving every other graylist
//      site's cookie untouched.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildSandbox, EXT_ROOT } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

const read = (rel) => fs.readFileSync(path.join(EXT_ROOT, rel), 'utf8');

// Last recorded updateEnabledRulesets() call, or undefined.
const lastDnr = (dnrCalls) => dnrCalls[dnrCalls.length - 1];
const isDisable = (c) => !!c && Array.isArray(c.disableRulesetIds) &&
  c.disableRulesetIds.includes('pp_youtube_restrict') && !c.enableRulesetIds;
const isEnable = (c) => !!c && Array.isArray(c.enableRulesetIds) &&
  c.enableRulesetIds.includes('pp_youtube_restrict') && !c.disableRulesetIds;

async function run() {
  const { sandbox, store, dnrCalls, changeListeners, listenerErrors } = buildSandbox({ mode: 'firefox' });
  const runner = createRunner('test-youtube-restrict');
  // Let every pending chrome.* promise continuation settle. Several paths here
  // are fire-and-forget in the product (the listener does not await the cookie
  // work), so asserting immediately after a write would race it.
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  // ── 1. default OFF on a fresh install ──────────────────────────────────────
  {
    // Note on the count: bg/blocklists.js also kicks off a fire-and-forget
    // loadBlockingSettings() at module evaluation, and its microtask lands
    // during our first `await`. Assert direction (at least one call, and it
    // disables) rather than an exact count.
    const before = dnrCalls.length;
    await sandbox.loadBlockingSettings();
    runner.ok(dnrCalls.length > before && isDisable(lastDnr(dnrCalls)),
      'fresh storage → loadBlockingSettings disables pp_youtube_restrict',
      JSON.stringify(lastDnr(dnrCalls)));
    runner.equal(sandbox.isYouTubeRestrictOn(), false, 'fresh storage → isYouTubeRestrictOn() === false');
  }

  // ── 2. storage round-trip: the switch is the only arm/disarm path ─────────
  {
    store.ppYouTubeRestrict = true;
    await sandbox.loadBlockingSettings();
    runner.ok(isEnable(lastDnr(dnrCalls)), 'ppYouTubeRestrict:true → ruleset ENABLED',
      JSON.stringify(lastDnr(dnrCalls)));
    runner.equal(sandbox.isYouTubeRestrictOn(), true, 'ppYouTubeRestrict:true → isYouTubeRestrictOn() === true');
  }
  {
    store.ppYouTubeRestrict = false;
    await sandbox.loadBlockingSettings();
    runner.ok(isDisable(lastDnr(dnrCalls)), 'ppYouTubeRestrict:false → ruleset DISABLED',
      JSON.stringify(lastDnr(dnrCalls)));
  }
  {
    // Absent key must mean OFF — that is what every fresh install has, and it
    // is also how a user returns to default.
    delete store.ppYouTubeRestrict;
    await sandbox.loadBlockingSettings();
    runner.ok(isDisable(lastDnr(dnrCalls)), 'key deleted → ruleset DISABLED (absent = off)',
      JSON.stringify(lastDnr(dnrCalls)));
    runner.equal(sandbox.isYouTubeRestrictOn(), false, 'key deleted → isYouTubeRestrictOn() === false');
  }

  // ── 3. the desktop app cannot arm it ───────────────────────────────────────
  // store.js hardcodes `youtubeRestrict: true` and pushes it as part of the
  // blocking settings. Reading it back must not turn the feature on.
  {
    delete store.ppYouTubeRestrict;
    store.ppBlocking = { youtubeRestrict: true, redirectLinkOn: true, redirectUrl: 'https://example.com/' };
    await sandbox.loadBlockingSettings();
    runner.equal(sandbox.isYouTubeRestrictOn(), false,
      'app push {youtubeRestrict:true} does NOT arm the switch');
    runner.ok(isDisable(lastDnr(dnrCalls)),
      'app push {youtubeRestrict:true} does NOT enable the ruleset', JSON.stringify(lastDnr(dnrCalls)));
    // The rest of blockingSettings must still load — the redirect link is
    // unrelated and must not be collateral damage. (`blockingSettings` is a
    // top-level `let`, so it lives in the context's lexical scope, not on the
    // sandbox object — read it the way the other suites do.)
    const redirectOn = vm.runInContext(
      '!!(blockingSettings && blockingSettings.redirectLinkOn)', sandbox,
      { filename: 'test:yt-redirect' });
    runner.ok(redirectOn === true,
      'app push still populates blockingSettings (redirect link unaffected)');
    delete store.ppBlocking;
    await sandbox.loadBlockingSettings();
  }

  // Static guard: no background file may ever read the app's field again.
  {
    const bgSrc = ['bg/blocklists.js', 'bg/graylist.js', 'bg/native-bridge.js', 'background.js']
      .map(read).join('\n');
    runner.ok(!/blockingSettings[^\n]*\.youtubeRestrict\b/.test(bgSrc),
      'no background file reads blockingSettings.youtubeRestrict');
    runner.ok(/ppYouTubeRestrict/.test(read('bg/blocklists.js')),
      'bg/blocklists.js reads the extension-owned ppYouTubeRestrict key');
  }

  // ── 4. the graylist PREF cookie obeys the same switch ──────────────────────
  const cookieCalls = [];
  sandbox.chrome.cookies.set = (details) => { cookieCalls.push(details); return Promise.resolve(); };

  {
    delete store.ppYouTubeRestrict;
    await sandbox.loadBlockingSettings();
    cookieCalls.length = 0;
    await sandbox.enforceGraylistCookies('youtube.com');
    runner.equal(cookieCalls.length, 0,
      'switch OFF → no YouTube PREF cookie written', JSON.stringify(cookieCalls));
  }
  {
    // Turning YouTube off must not loosen any OTHER graylist site — the rest
    // of the enforcement map is unconditional by design.
    cookieCalls.length = 0;
    await sandbox.enforceGraylistCookies('reddit.com');
    runner.ok(cookieCalls.length > 0 && cookieCalls.every((c) => c.name === 'over18'),
      'switch OFF → reddit over18 cookie still enforced (unrelated graylist untouched)',
      JSON.stringify(cookieCalls));

    cookieCalls.length = 0;
    await sandbox.enforceGraylistCookies('pixiv.net');
    runner.ok(cookieCalls.length > 0 && cookieCalls.every((c) => c.name === 'R18'),
      'switch OFF → pixiv R18 cookie still enforced', JSON.stringify(cookieCalls));
  }
  {
    store.ppYouTubeRestrict = true;
    await sandbox.loadBlockingSettings();
    cookieCalls.length = 0;
    await sandbox.enforceGraylistCookies('youtube.com');
    runner.equal(cookieCalls.length, 2,
      'switch ON → both youtube.com and .youtube.com PREF cookies written',
      JSON.stringify(cookieCalls));
    runner.ok(cookieCalls.every((c) => c.name === 'PREF' && c.value === 'f2=8000000'),
      'switch ON → PREF cookie carries the Restricted Mode bit f2=8000000',
      JSON.stringify(cookieCalls));
    delete store.ppYouTubeRestrict;
    await sandbox.loadBlockingSettings();
  }

  // ── 5. a storage WRITE flips both enforcement sites, live ──────────────────
  // Sections 1–4 drive loadBlockingSettings() directly. This one goes through
  // the real chrome.storage.onChanged registry the way the Blocklist Manager
  // page does — the only path a user's click actually takes.
  const cookieSet = [];
  const cookieRemoved = [];
  sandbox.chrome.cookies.set = (d) => { cookieSet.push(d); return Promise.resolve(); };
  sandbox.chrome.cookies.getAll = () => Promise.resolve([
    { domain: '.youtube.com', name: 'PREF', path: '/' },
    { domain: 'youtube.com', name: 'PREF', path: '/' },
  ]);
  sandbox.chrome.cookies.remove = (d) => { cookieRemoved.push(d); return Promise.resolve(null); };

  runner.ok(changeListeners.length >= 1,
    'the background registered a chrome.storage.onChanged listener');

  {
    cookieSet.length = 0;
    cookieRemoved.length = 0;
    const before = dnrCalls.length;
    await sandbox.chrome.storage.local.set({ ppYouTubeRestrict: true });
    await drain();
    runner.equal(sandbox.isYouTubeRestrictOn(), true, 'write true → flag flips via onChanged');
    runner.ok(dnrCalls.length > before && isEnable(lastDnr(dnrCalls)),
      'write true → ruleset enabled', JSON.stringify(lastDnr(dnrCalls)));
    runner.ok(cookieSet.length > 0 && cookieSet.every((c) => c.name === 'PREF' && c.value === 'f2=8000000'),
      'write true → Restricted Mode cookie applied immediately (no page reload needed)',
      JSON.stringify(cookieSet));
    runner.equal(cookieRemoved.length, 0, 'write true → nothing removed');
  }

  {
    cookieSet.length = 0;
    cookieRemoved.length = 0;
    const before = dnrCalls.length;
    await sandbox.chrome.storage.local.set({ ppYouTubeRestrict: false });
    await drain();
    runner.equal(sandbox.isYouTubeRestrictOn(), false, 'write false → flag flips back');
    runner.ok(dnrCalls.length > before && isDisable(lastDnr(dnrCalls)),
      'write false → ruleset disabled', JSON.stringify(lastDnr(dnrCalls)));
    runner.ok(cookieRemoved.length >= 2,
      'write false → the stale PREF cookie is removed, so the switch takes effect NOW rather than next restart',
      JSON.stringify(cookieRemoved));
    runner.equal(cookieSet.length, 0, 'write false → cookie not re-written');
  }

  {
    // Unrelated writes share the same listener; none of them may disturb it.
    await sandbox.chrome.storage.local.set({ stats: { totalBlocks: 1 }, display: { theme: 'dark' } });
    runner.equal(sandbox.isYouTubeRestrictOn(), false,
      'unrelated storage writes leave the flag alone');
    runner.ok(listenerErrors.length === 0,
      'no chrome.storage.onChanged listener threw', String(listenerErrors[0] && listenerErrors[0].stack));
  }

  {
    // Removing the key is the "back to default" path (absent === off).
    await sandbox.chrome.storage.local.remove('ppYouTubeRestrict');
    await drain();
    runner.equal(sandbox.isYouTubeRestrictOn(), false, 'key removed → flag back to default OFF');
    runner.ok(isDisable(lastDnr(dnrCalls)), 'key removed → ruleset disabled', JSON.stringify(lastDnr(dnrCalls)));
    await sandbox.loadBlockingSettings();
  }

  // ── 6. the enforcement primitives themselves are intact ────────────────────
  // Making a feature switchable must not have quietly emptied it.
  {
    const ytRules = JSON.parse(read('dnr/youtube-restrict.json'));
    const stampsHeader = ytRules.some((r) =>
      r.action && r.action.type === 'modifyHeaders' &&
      (r.action.requestHeaders || []).some((h) =>
        h.header === 'YouTube-Restrict' && h.operation === 'set' && h.value === 'Strict'));
    runner.ok(stampsHeader, 'youtube-restrict.json still stamps YouTube-Restrict: Strict');

    const manifest = JSON.parse(read('manifest.json'));
    const rr = ((manifest.declarative_net_request || {}).rule_resources || [])
      .find((r) => r.id === 'pp_youtube_restrict');
    runner.ok(rr && rr.enabled === false && rr.path === 'dnr/youtube-restrict.json',
      'manifest registers pp_youtube_restrict → dnr/youtube-restrict.json, enabled:false (default OFF)',
      JSON.stringify(rr));
    runner.ok(Array.isArray(manifest.permissions) && manifest.permissions.includes('declarativeNetRequest'),
      'manifest still requests the declarativeNetRequest permission');
  }

  // ── 7. the switch is actually wired into the Blocklist Manager page ────────
  {
    const html = read('blocklists.html');
    runner.ok(html.includes('id="ytRestrictToggle"'), 'blocklists.html renders the switch');
    runner.ok(/id="ytRestrictToggle"[^>]*role="switch"|role="switch"[^>]*id="ytRestrictToggle"/.test(html.replace(/\n/g, ' ')),
      'the switch carries role="switch" (screen readers announce it as a toggle)');
    runner.ok(html.includes('aria-checked'), 'the switch carries aria-checked state');
    runner.ok(html.includes('aria-labelledby="ytRestrictTitle"'),
      'the switch is aria-labelledby its own title');
    runner.ok(html.includes('aria-describedby="ytRestrictDesc"'),
      'the switch is aria-describedby its own description');

    const page = read('blocklists.js');
    runner.ok(page.includes('ppYouTubeRestrict'), 'blocklists.js writes the ppYouTubeRestrict key');
    runner.ok(page.includes('initYouTubeRestrict()'), 'blocklists.js initialises the switch on load');
    runner.ok(page.includes('chrome.storage.onChanged'), 'blocklists.js follows flips from other surfaces');
    runner.ok(page.includes('syncYouTubeGraylistRow'),
      'blocklists.js keeps the graylist youtube.com row in step with the switch (no stale "forced" copy)');
    // The HTML states the OFF default inline, so the page is correct before JS runs.
    runner.ok(html.includes('Off — YouTube shows its normal, unfiltered feed.'),
      'the switch row ships stating its default (OFF) as no-JS fallback copy');
  }

  // ── 8. the graylist still lists youtube.com (the row must not vanish) ──────
  {
    const sites = read('graylist-sites.js');
    runner.ok(/url:\s*'youtube\.com',\s*kind:\s*'enforce'/.test(sites),
      'graylist-sites.js still declares youtube.com as an enforce site');
  }

  return runner.summary();
}

module.exports = { run };
