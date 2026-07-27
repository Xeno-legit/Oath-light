// ════════════════════════════════════════════════════════════════════════════
// Oath Light — Graylist V2  (MAIN-world API / network-layer interception)
// ════════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
// ---------------
// Graylist V1 hid each site's NSFW UI with CSS and force-toggled switches. That
// rots constantly: selectors break on every redesign, and the real preference
// now lives server-side (Reddit/X), so a client toggle can't enforce anything.
//
// V2 flips the model: instead of hiding the lever, we BECOME the filter. We patch
// `fetch` and read the site's OWN per-item NSFW label in the JSON it downloads,
// then strip the flagged items BEFORE the page ever renders them.
//
//   • Ground-truth, not a heuristic — it's the exact boolean the site uses to
//     decide whether to blur (over_18, possibly_sensitive, xRestrict, sensitive,
//     bluesky labels, booru rating, tumblr is_nsfw).
//   • Survives UI redesigns — third-party API clients depend on these fields, so
//     they stay backward-compatible for years. `over_18` hasn't moved in ~15 yrs.
//
// WHY MAIN WORLD / EXTERNAL SCRIPT
// --------------------------------
// Content scripts run in an ISOLATED world; patching `fetch` there does nothing
// to the page. This file is injected by content.js as a <script src> pointing at
// a web_accessible_resource, so it runs in the page's MAIN world. An *external*
// WAR script (not inline) is used deliberately — it bypasses strict page CSP that
// would block an inline <script> (reddit/x both ship such CSP).
//
// See docs/ARCHITECTURE.md §2.3 for the full rationale and the per-site triage.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Guard against double-injection (SPA re-inject, multiple frames sharing a realm).
  if (window.__oathLightGraylistV2) return;
  window.__oathLightGraylistV2 = true;

  // Strictness, passed down from the isolated content script via the <script> tag's
  // dataset. 'standard' = best-effort in-site filtering (current behaviour); 'strict'
  // is reserved for whole-site blocking handled upstream in background.js.
  // (Filtering runs the same in both modes today; the field is here for forward-compat.)
  // eslint-disable-next-line no-unused-vars
  let MODE = 'standard';
  try {
    const cur = document.currentScript;
    if (cur && cur.dataset && cur.dataset.mode) MODE = cur.dataset.mode;
  } catch (_) {}

  // ── Label vocabularies ────────────────────────────────────────────────────
  // Booru `rating` values that are NSFW. danbooru: g/s/q/e · gelbooru: safe/questionable/explicit.
  const BOORU_NSFW = new Set(['q', 'e', 'questionable', 'explicit']);

  // Minds adult test — shared by S.minds for both the raw object and its parsed
  // `legacy` blob. Hoisted (function declaration) so S.minds can call it.
  function mindsFlagged(o) {
    if (!o || typeof o !== 'object') return false;
    if (Array.isArray(o.nsfw) && o.nsfw.length > 0) return true;
    if (o.mature === true || o.mature === 1) return true;
    // rating: 1 = open, 2 = mature. Report §7.1: the adult posts set ONLY rating:2
    // (nsfw:[], mature:false), so nsfw/mature alone miss them — honour rating too.
    const r = typeof o.rating === 'string' ? parseInt(o.rating, 10) : o.rating;
    if (typeof r === 'number' && r >= 2) return true;
    // Tag/hashtag fallback for under-tagged posts (mirrors the Fanbox fix).
    const tags = o.tags || o.hashtags;
    if (Array.isArray(tags)) {
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        const s = typeof t === 'string' ? t : (t && (t.name || t.value || t.tag));
        if (s && /\b(?:nsfw|porn|sex|nude|naked|hentai|erotica?|xxx|18\+|onlyfans|boobs|milf|fetish|bdsm|lewd|hot|busty)\b/i.test(s)) return true;
      }
    }
    return false;
  }

  // ── Signals ───────────────────────────────────────────────────────────────
  // A "signal" returns true if THIS object node directly carries an NSFW label.
  // (Used both directly and via subtree-walks below.)
  const S = {
    // Reddit: classic listing `over_18` + GraphQL `isNsfw`.
    reddit:   o => o.over_18 === true || o.isNsfw === true,
    // X / Twitter: tweet `possibly_sensitive` (lives on `legacy` in GraphQL).
    x:        o => o.possibly_sensitive === true,
    // Pixiv: xRestrict 0 = all-ages, 1 = R-18, 2 = R-18G. number or numeric string.
    pixiv:    o => typeof o.xRestrict === 'number'
                     ? o.xRestrict >= 1
                     : (typeof o.xRestrict === 'string' && o.xRestrict !== '' && o.xRestrict !== '0'),
    // Mastodon (every instance) + Tumblr neue post format both use `sensitive`.
    sensitive: o => o.sensitive === true,
    // Tumblr post objects. Legacy flags + the CURRENT model: community labels
    // (introduced 2022) — { hasCommunityLabel, categories:
    // [mature|sexual_themes|drug_use|violence] }. Any community label = strip.
    // NOTE casing: the www.tumblr.com web API returns camelCase
    // (communityLabels/hasCommunityLabel/isNsfw); the public api.tumblr.com uses
    // snake_case (community_labels/has_community_label/is_nsfw). Handle BOTH —
    // checking only snake_case was a silent no-op on the web app (0/16 stripped).
    tumblr:   o => o.is_nsfw === true || o.isNsfw === true || o.is_adult === true ||
                   (o.community_labels && o.community_labels.has_community_label === true) ||
                   (o.communityLabels && o.communityLabels.hasCommunityLabel === true),
    // Boorus.
    booru:    o => typeof o.rating === 'string' && BOORU_NSFW.has(o.rating.toLowerCase()),
    // Imgur: gallery/album/image `nsfw` boolean (may be null when unrated).
    imgur:    o => o.nsfw === true,
    // NexusMods: mod object `contains_adult_content` (REST) / `adultContent` (GraphQL v2).
    nexus:    o => o.contains_adult_content === true || o.containsAdultContent === true || o.adultContent === true,
    // ── Best-effort (field names from public APIs — verify against live data) ──
    // Vimeo: video `content_rating` array (e.g. ["safe"] / ["nudity","drugs"]).
    vimeo:    o => Array.isArray(o.content_rating) && o.content_rating.some(r => /nudity|mature|explicit|unrated/i.test(r)),
    // Dailymotion: video `explicit` boolean (Graph API).
    dailymotion: o => o.explicit === true,
    // Odysee / LBRY: `mature` flag, or a "mature" tag in claim metadata.
    odysee:   o => o.mature === true ||
                   (Array.isArray(o.tags) && o.tags.indexOf('mature') !== -1) ||
                   (o.value && Array.isArray(o.value.tags) && o.value.tags.indexOf('mature') !== -1),
    // Patreon: post/campaign `is_nsfw` (JSON:API — lives under `attributes`).
    patreon:  o => o.is_nsfw === true,
    // Gumroad: product `is_adult` / `adult` / `nsfw`.
    gumroad:  o => o.is_adult === true || o.adult === true || o.nsfw === true,
    // Minds: GraphQL feed buries EVERY field inside `legacy`, a unicode-escaped
    // JSON *string* the walker can't see into — so the old `nsfw`/`mature` test
    // was a no-op on the search/feed (report §7.1). Parse `legacy` first, then run
    // the shared adult test (nsfw[] / mature / rating>=2 / adult tags) on both the
    // raw node and the parsed blob.
    minds:    o => {
      if (mindsFlagged(o)) return true;
      if (typeof o.legacy === 'string' && o.legacy.length > 1) {
        try { if (mindsFlagged(JSON.parse(o.legacy))) return true; } catch (_) {}
      }
      return false;
    },
    // Itaku: `maturity_rating` of 'SFW' | 'Questionable' | 'NSFW'.
    itaku:    o => typeof o.maturity_rating === 'string' && /nsfw|questionable/i.test(o.maturity_rating),
    // PeerTube videos + Lemmy posts/communities — both use a `nsfw` boolean.
    nsfwBool: o => o.nsfw === true,
    // Mangadex: `attributes.contentRating` (safe/suggestive/erotica/pornographic).
    mangadex: o => typeof o.contentRating === 'string' &&
                   (o.contentRating.toLowerCase() === 'erotica' || o.contentRating.toLowerCase() === 'pornographic'),
    // ArtStation: project `adult_content` / `hide_as_adult`.
    artstation: o => o.adult_content === true || o.hide_as_adult === true,
    // Flickr: `safety_level` 1=safe, 2=moderate, 3=restricted.
    flickr:   o => o.safety_level === 2 || o.safety_level === 3 || o.safety_level === '2' || o.safety_level === '3',
    // Sketchfab: model `isAgeRestricted` — staff-moderated bool present on EVERY
    // model object (verified live on /v3/models + /v3/search). Ground-truth.
    sketchfab: o => o.isAgeRestricted === true,
    // 500px: photo `notSafeForWork` bool — present on every photo node (verified
    // live off rendered card props). NOTE: target this, NOT the sibling `showNude`,
    // which is the *viewer's* preference, not the photo's label.
    px500:    o => o.notSafeForWork === true,
    // GameBanana (apiv11 JSON, _aRecords[]). Its visibility enum reserves
    // 'hide'/'warn' for SEXUAL/explicit content — gore & flashing-lights mods stay
    // 'show' (verified live), so visibility is a clean anti-porn signal in LISTINGS
    // (which omit the detailed ratings). Detail objects also carry _aContentRatings
    // (code→label map); match the sexual codes there for precision. Non-sexual codes
    // (bg=Blood/Gore, ps=Flashing Lights, etc.) are intentionally NOT matched.
    gamebanana: o => {
      const v = o._sInitialVisibility;
      if (v === 'hide' || v === 'warn') return true;
      const cr = o._aContentRatings;
      if (cr && typeof cr === 'object') {
        for (const k in cr) if (k==='nu'||k==='pn'||k==='sa'||k==='sc'||k==='st'||k==='su') return true;
      }
      return false;
    },
    // Wattpad: story `mature` boolean — the platform's official adult rating,
    // present on story objects in both /v4/ and /api/v3/ JSON (verified live:
    // mature=1 search returns mature:true). Strips mature stories from
    // search/browse/tag/home story arrays.
    wattpad:  o => o.mature === true,
    // Fanbox (Pixiv's creator platform, api.fanbox.cc). `hasAdultContent` is the
    // R-18 flag on BOTH creator objects (creator.listRecommended → body.creators[])
    // and post objects (post.list*/getOfficial → body.items[]). Verified live.
    // TAG FALLBACK: hasAdultContent is set at the CREATOR level, so R-18 posts by
    // creators who didn't flag their whole Fanbox as adult leak through tag-search
    // with hasAdultContent:false (verified: post.listTagged?tag=R-18 → 38/38 false,
    // titles blatantly adult). Catch those via their own adult `tags`.
    fanbox:   o => {
      if (o.hasAdultContent === true) return true;
      if (Array.isArray(o.tags)) {
        for (let i = 0; i < o.tags.length; i++) {
          const t = o.tags[i];
          const s = typeof t === 'string' ? t : (t && (t.name || t.tag));
          if (s && /r-?18|18禁|成人向|nsfw|エロ/i.test(s)) return true;
        }
      }
      return false;
    }
  };

  // ── Per-host rules ────────────────────────────────────────────────────────
  // First matching rule wins. Specific host rules come first; the path-based
  // Mastodon rule (which can't be enumerated by host) comes last.
  const BOORU_HOSTS = new Set([
    'danbooru.donmai.us', 'safebooru.donmai.us', 'gelbooru.com',
    'konachan.com', 'konachan.net', 'yande.re', 'tbib.org'
  ]);
  // Distinctive Mastodon REST endpoints that return arrays of statuses.
  const MASTO_PATHS = [
    '/api/v1/timelines', '/api/v1/notifications', '/api/v1/favourites',
    '/api/v1/bookmarks', '/api/v1/trends/statuses', '/api/v2/search',
    '/api/v1/accounts/' // ".../statuses" feeds
  ];

  const RULES = [
    { id: 'reddit',
      test: (h) => h === 'reddit.com' || h.endsWith('.reddit.com'),
      signals: [S.reddit] },

    { id: 'x',
      test: (h) => h === 'x.com' || h.endsWith('.x.com') ||
                   h === 'twitter.com' || h.endsWith('.twitter.com'),
      signals: [S.x] },

    { id: 'pixiv',
      test: (h, p) => (h === 'pixiv.net' || h.endsWith('.pixiv.net')) && p.indexOf('/ajax/') !== -1,
      signals: [S.pixiv] },

    { id: 'tumblr',
      test: (h, p) => (h === 'tumblr.com' || h.endsWith('.tumblr.com')) && p.indexOf('/api/') !== -1,
      signals: [S.tumblr, S.sensitive] },

    { id: 'booru',
      test: (h) => BOORU_HOSTS.has(h),
      signals: [S.booru] },

    { id: 'imgur',
      test: (h) => h === 'imgur.com' || h.endsWith('.imgur.com'),
      signals: [S.imgur] },

    { id: 'nexusmods',
      test: (h) => h === 'nexusmods.com' || h.endsWith('.nexusmods.com'),
      signals: [S.nexus] },

    // ── Best-effort hosts (verify fields on live responses) ──────────────────
    { id: 'vimeo',
      test: (h) => h === 'vimeo.com' || h.endsWith('.vimeo.com'),
      signals: [S.vimeo] },

    { id: 'dailymotion',
      test: (h) => h.indexOf('dailymotion') !== -1,
      signals: [S.dailymotion] },

    { id: 'odysee',
      test: (h) => h.indexOf('odysee') !== -1 || h.indexOf('lbry') !== -1,
      signals: [S.odysee] },

    { id: 'patreon',
      test: (h) => h === 'patreon.com' || h.endsWith('.patreon.com'),
      signals: [S.patreon] },

    { id: 'gumroad',
      test: (h) => h === 'gumroad.com' || h.endsWith('.gumroad.com'),
      signals: [S.gumroad] },

    { id: 'minds',
      test: (h) => h === 'minds.com' || h.endsWith('.minds.com'),
      signals: [S.minds] },

    { id: 'itaku',
      test: (h) => h === 'itaku.ee' || h.endsWith('.itaku.ee'),
      signals: [S.itaku] },

    // PeerTube — any instance, by its distinctive video REST paths.
    { id: 'peertube',
      test: (h, p) => p.indexOf('/api/v1/videos') !== -1 ||
                      p.indexOf('/api/v1/search/videos') !== -1 ||
                      p.indexOf('/api/v1/video-channels/') !== -1,
      signals: [S.nsfwBool] },

    // Lemmy — any instance, by its v3 API paths.
    { id: 'lemmy',
      test: (h, p) => ['/api/v3/post', '/api/v3/comment', '/api/v3/community', '/api/v3/search', '/api/v3/user']
                        .some(x => p.indexOf(x) !== -1),
      signals: [S.nsfwBool] },

    { id: 'mangadex',
      test: (h) => h.indexOf('mangadex') !== -1,
      signals: [S.mangadex] },

    { id: 'artstation',
      test: (h) => h === 'artstation.com' || h.endsWith('.artstation.com'),
      signals: [S.artstation] },

    { id: 'flickr',
      test: (h) => h.indexOf('flickr') !== -1,
      signals: [S.flickr] },

    // Sketchfab — model JSON from api.sketchfab.com (also covers any sketchfab.com
    // host that fetches model lists). Strips age-restricted models from results[].
    { id: 'sketchfab',
      test: (h) => h.indexOf('sketchfab.com') !== -1,
      signals: [S.sketchfab] },

    // 500px — GraphQL at api.500px.com (relay edges[].node). Strips notSafeForWork
    // photos. (Image CDNs live on 500px.ORG, so .com matching won't touch them.)
    { id: '500px',
      test: (h) => h.indexOf('500px.com') !== -1,
      signals: [S.px500] },

    // GameBanana — apiv11 JSON feeds (browse / search / subfeeds). Strips mods
    // GameBanana itself gates as sexual/explicit (visibility hide|warn) + any
    // detail object carrying a sexual content-rating code.
    { id: 'gamebanana',
      test: (h) => h === 'gamebanana.com' || h.endsWith('.gamebanana.com'),
      signals: [S.gamebanana] },

    // Wattpad — story-list JSON (search / browse / tags / home). Excludes the
    // reader's part/text endpoints (single nested objects a blind scrub could
    // corrupt); listing feeds return story arrays and drop cleanly.
    { id: 'wattpad',
      test: (h, p) => (h === 'wattpad.com' || h.endsWith('.wattpad.com')) &&
                      p.indexOf('/parts') === -1 && p.indexOf('storytext') === -1,
      signals: [S.wattpad] },

    // Fanbox — api.fanbox.cc JSON (creator & post feeds). Strips R-18 creators
    // and posts (hasAdultContent) from body.creators[] / body.items[].
    { id: 'fanbox',
      test: (h) => h === 'fanbox.cc' || h.endsWith('.fanbox.cc'),
      signals: [S.fanbox] },

    // Mastodon — any instance, matched purely by its stable REST paths.
    // (Also carries S.nsfwBool so PeerTube videos sharing /api/v1/accounts/ are caught.)
    { id: 'mastodon',
      test: (h, p) => MASTO_PATHS.some(mp => p.indexOf(mp) !== -1),
      signals: [S.sensitive, S.nsfwBool] }
  ];

  // Cheap pre-filter: avoid constructing a URL object for the ~99.9% of requests
  // that can't possibly match. One substring scan over the raw URL string.
  const QUICK = [
    'reddit.com', 'x.com', 'twitter.com', 'pixiv.net', 'tumblr.com',
    '/api/v1/timelines', '/api/v1/notifications', '/api/v1/favourites',
    '/api/v1/bookmarks', '/api/v1/trends', '/api/v2/search', '/api/v1/accounts/',
    'donmai.us', 'gelbooru.com', 'konachan.', 'yande.re', 'tbib.org',
    'imgur.com', 'nexusmods.com',
    'vimeo.com', 'dailymotion', 'odysee', 'lbry', 'patreon.com', 'gumroad.com',
    'minds.com', 'itaku.ee',
    '/api/v1/videos', '/api/v1/video-channels', '/api/v3/post', '/api/v3/comment',
    '/api/v3/community', '/api/v3/search', 'mangadex', 'artstation.com', 'flickr',
    'sketchfab.com', '500px.com', 'gamebanana.com', 'wattpad.com', 'fanbox.cc'
  ];
  function quickMatch(s) {
    for (let i = 0; i < QUICK.length; i++) if (s.indexOf(QUICK[i]) !== -1) return true;
    return false;
  }

  function ruleFor(urlStr) {
    if (!urlStr || !quickMatch(urlStr)) return null;
    let u;
    try { u = new URL(urlStr, location.href); } catch (_) { return null; }
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    for (let i = 0; i < RULES.length; i++) {
      if (RULES[i].test(h, p, u)) return RULES[i];
    }
    return null;
  }

  // ── The scrubber ──────────────────────────────────────────────────────────
  // subtreeFlagged: does this node (or anything beneath it) carry an NSFW signal?
  // Needed because sites like X bury `possibly_sensitive` several levels under the
  // array element (entry → content → … → legacy). Depth-capped for safety/perf.
  function subtreeFlagged(node, signals, depth) {
    if (node == null || depth > 8) return false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (subtreeFlagged(node[i], signals, depth + 1)) return true;
      }
      return false;
    }
    if (typeof node === 'object') {
      for (let i = 0; i < signals.length; i++) {
        try { if (signals[i](node)) return true; } catch (_) {}
      }
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object' && subtreeFlagged(v, signals, depth + 1)) return true;
      }
      return false;
    }
    return false;
  }

  // signalsDirect: is THIS object node itself flagged (no descent)?
  function signalsDirect(node, signals) {
    for (let i = 0; i < signals.length; i++) {
      try { if (signals[i](node)) return true; } catch (_) {}
    }
    return false;
  }

  // scrub: walk the parsed JSON DEPTH-FIRST and remove flagged items.
  //   • Arrays  → scrub each element first, THEN drop it if its (now-cleaned)
  //               subtree is still flagged. Depth-first is essential: it removes
  //               at the FINEST array level. e.g. X buries the flag under
  //               instructions[] → entries[] → … ; a shallow check would nuke the
  //               whole instructions batch (and the safe tweets in it), whereas
  //               cleaning entries[] first lets the batch survive.
  //   • Objects → drop any child value that is itself directly flagged. This is
  //               for id→item MAPS (e.g. pixiv `{ "123": {xRestrict} }`) where the
  //               item is an object VALUE, not an array element.
  //
  //   CRUCIAL: that object-map deletion is SUPPRESSED everywhere inside an array
  //   element's subtree (`insideArrayItem`). Otherwise a flag living on a named
  //   child object — reddit `child.data.over_18`, mangadex/patreon `attributes.*`,
  //   bluesky `feed[].post.labels`, X `…result.legacy.possibly_sensitive` — would
  //   delete only that child and ORPHAN the row, leaving the item in the list
  //   (broken, and on mangadex the cover art still renders). By suppressing it we
  //   let the enclosing array drop the WHOLE element via subtreeFlagged.
  //
  //   The flag is PROPAGATED down through the element's nested objects (so X's
  //   3-levels-deep `legacy` is protected too) and is RE-SET only when we descend
  //   into a nested ARRAY — that inner array gets its own removal scope, which is
  //   how the deepest array still wins: X's entries[] drops its flagged entries,
  //   and the now-clean instructions batch survives. Map deletion therefore fires
  //   only for genuine id→item maps that sit OUTSIDE any array (e.g. pixiv).
  //
  // ctx.n accumulates how many items were stripped (per-call, no global races).
  function scrub(node, signals, depth, ctx, insideArrayItem) {
    if (node == null || typeof node !== 'object' || depth > 12) return node;

    if (Array.isArray(node)) {
      const kept = [];
      for (let i = 0; i < node.length; i++) {
        // Each element opens a fresh array-item scope (suppress map-delete within it).
        const scrubbed = scrub(node[i], signals, depth + 1, ctx, true);
        if (scrubbed && typeof scrubbed === 'object' && subtreeFlagged(scrubbed, signals, 0)) {
          ctx.n++;
          continue;
        }
        kept.push(scrubbed);
      }
      return kept;
    }

    for (const k in node) {
      const v = node[k];
      if (!insideArrayItem && v && typeof v === 'object' && !Array.isArray(v) && signalsDirect(v, signals)) {
        delete node[k];
        ctx.n++;
        continue;
      }
      // Propagate the array-item scope into nested objects; a nested array resets it.
      node[k] = scrub(v, signals, depth + 1, ctx, insideArrayItem);
    }
    return node;
  }

  // ── Stats relay ───────────────────────────────────────────────────────────
  // We can't touch chrome.storage from the MAIN world, so hand the count to the
  // isolated content script via postMessage; it forwards to the background worker.
  function report(id, n) {
    try { window.postMessage({ __oathLight: 'graylist-filter', site: id, count: n }, '*'); } catch (_) {}
    try { console.debug('[Oath Light] Graylist V2 stripped', n, 'NSFW item(s) from', id); } catch (_) {}
  }

  // §3.3 — some graylist feeds arrive with a non-JSON content-type (text/html,
  // text/plain, or none) even though the body IS JSON. Treat a response as worth
  // reading if the type says json OR it's a texty/empty type; never text-read
  // images/video/binary. parseScrubbable() then only parses when the body really
  // starts with { or [ (so a true HTML SSR document is left untouched — that case
  // is handled by the content.js DOM backstop, not here).
  function ctMaybeText(ct) {
    ct = (ct || '').toLowerCase();
    return ct.indexOf('json') !== -1 || ct === '' || ct.indexOf('text/') !== -1 ||
           ct.indexOf('javascript') !== -1 || ct.indexOf('ndjson') !== -1;
  }
  function parseScrubbable(txt, ct) {
    if (typeof txt !== 'string') return undefined;
    if ((ct || '').toLowerCase().indexOf('json') === -1) {
      const t = txt.replace(/^﻿/, '').replace(/^\s+/, '');
      const c0 = t.charCodeAt(0);
      if (c0 !== 123 && c0 !== 91) return undefined;   // not { or [
    }
    try { return JSON.parse(txt); } catch (_) { return undefined; }
  }

  // ── fetch patch ───────────────────────────────────────────────────────────
  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (input, init) {
      let urlStr = '';
      try { urlStr = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (_) {}
      const rule = urlStr ? ruleFor(urlStr) : null;

      const promise = realFetch.apply(this, arguments);
      if (!rule) return promise;

      return promise.then(resp => {
        try {
          if (!resp || resp.status === 204 || !resp.ok) return resp;
          const ct = resp.headers.get('content-type') || '';
          if (!ctMaybeText(ct)) return resp;   // images/video/binary — never text-read

          // Clone so the original body stream stays intact if we bail out.
          return resp.clone().text().then(txt => {
            const data = parseScrubbable(txt, ct);
            if (data === undefined) return resp;

            const ctx = { n: 0 };
            const cleaned = scrub(data, rule.signals, 0, ctx);
            if (ctx.n === 0) return resp;

            report(rule.id, ctx.n);
            const headers = new Headers(resp.headers);
            headers.delete('content-length');   // body length changed
            headers.delete('content-encoding');  // body is now plain JSON text
            return new Response(JSON.stringify(cleaned), {
              status: resp.status,
              statusText: resp.statusText,
              headers
            });
          }).catch(() => resp);
        } catch (_) {
          return resp;
        }
      });
    };
    // Keep the patched fetch looking native to feature-detectors.
    try { window.fetch.toString = () => 'function fetch() { [native code] }'; } catch (_) {}
  }

  // ── XMLHttpRequest patch ────────────────────────────────────────────────────
  // Many SPAs load their feeds with XHR, not fetch (DeviantArt, Tumblr, NexusMods…).
  // The fetch patch alone leaves those completely unfiltered. We can't replace the
  // native responseText/response (read-only prototype getters), so on a matching
  // request we shadow them with per-INSTANCE getters that lazily scrub the body the
  // first time the page reads it at readyState 4 — order-independent of the page's
  // own load handler, since it's the GETTER that returns cleaned data.
  const RealXHR = window.XMLHttpRequest;
  if (RealXHR && RealXHR.prototype) {
    const rtDesc = Object.getOwnPropertyDescriptor(RealXHR.prototype, 'responseText');
    const rDesc  = Object.getOwnPropertyDescriptor(RealXHR.prototype, 'response');
    const realOpen = RealXHR.prototype.open;
    const realSend = RealXHR.prototype.send;
    if (rtDesc && rtDesc.get && rDesc && rDesc.get && typeof realOpen === 'function' && typeof realSend === 'function') {

      RealXHR.prototype.open = function (method, url) {
        try { this.__ppRule = url ? ruleFor(String(url)) : null; } catch (_) { this.__ppRule = null; }
        return realOpen.apply(this, arguments);
      };

      RealXHR.prototype.send = function () {
        const rule = this.__ppRule;
        if (rule) {
          const self = this;
          let done = false, cachedText;
          function ctOf() { try { return self.getResponseHeader('content-type') || ''; } catch (_) { return ''; } }
          // Text path (responseType '' | 'text'): scrub the raw text once at rs=4.
          // Uses the shared §3.3 helpers so mislabeled-JSON feeds are scrubbed too.
          function getText() {
            const raw = rtDesc.get.call(self);
            if (self.readyState !== 4) return raw;          // never cache a partial body
            if (done) return cachedText;
            done = true; cachedText = raw;
            try {
              const ct = ctOf();
              if (self.status >= 200 && self.status < 300 && typeof raw === 'string' && ctMaybeText(ct)) {
                const data = parseScrubbable(raw, ct);
                if (data !== undefined) {
                  const c = { n: 0 };
                  const cleaned = scrub(data, rule.signals, 0, c);
                  if (c.n > 0) { report(rule.id, c.n); cachedText = JSON.stringify(cleaned); }
                }
              }
            } catch (_) {}
            return cachedText;
          }
          try {
            Object.defineProperty(this, 'responseText', { configurable: true, get: function () { try { return getText(); } catch (_) { return rtDesc.get.call(this); } } });
          } catch (_) {}
          try {
            Object.defineProperty(this, 'response', {
              configurable: true,
              get: function () {
                const rt = this.responseType;
                if (rt === '' || rt === 'text') { try { return getText(); } catch (_) { return rDesc.get.call(this); } }
                if (rt === 'json' && this.readyState === 4) {
                  // `response` is already a parsed object; scrub a clone.
                  try {
                    const obj = rDesc.get.call(this);
                    if (obj && typeof obj === 'object') {
                      const c = { n: 0 };
                      const cleaned = scrub(JSON.parse(JSON.stringify(obj)), rule.signals, 0, c);
                      if (c.n > 0) report(rule.id, c.n);
                      return cleaned;
                    }
                  } catch (_) {}
                }
                return rDesc.get.call(this);
              }
            });
          } catch (_) {}
        }
        return realSend.apply(this, arguments);
      };
      try { RealXHR.prototype.open.toString = () => 'function open() { [native code] }'; } catch (_) {}
      try { RealXHR.prototype.send.toString = () => 'function send() { [native code] }'; } catch (_) {}
    }
  }
})();
