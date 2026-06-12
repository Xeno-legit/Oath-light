// ════════════════════════════════════════════════════════════════════════════
// Pure Path — Graylist V2  (MAIN-world API / network-layer interception)
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
// See BLOCKING_STRATEGY.md §2 + §3 for the full rationale and the per-site triage.
// ════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Guard against double-injection (SPA re-inject, multiple frames sharing a realm).
  if (window.__purePathGraylistV2) return;
  window.__purePathGraylistV2 = true;

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
  // Bluesky self-labels / moderation labels that mark adult content.
  const BSKY_NSFW = new Set(['porn', 'sexual', 'nudity', 'sexual-figurative', 'graphic-media']);
  // Booru `rating` values that are NSFW. danbooru: g/s/q/e · gelbooru: safe/questionable/explicit.
  const BOORU_NSFW = new Set(['q', 'e', 'questionable', 'explicit']);

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
    // Tumblr post objects.
    tumblr:   o => o.is_nsfw === true || o.is_adult === true,
    // Boorus.
    booru:    o => typeof o.rating === 'string' && BOORU_NSFW.has(o.rating.toLowerCase()),
    // Bluesky: labels array of {val} (or bare strings) on the post / author.
    bsky:     o => Array.isArray(o.labels) && o.labels.some(l =>
                     BSKY_NSFW.has(typeof l === 'string' ? l : (l && l.val))),
    // Imgur: gallery/album/image `nsfw` boolean (may be null when unrated).
    imgur:    o => o.nsfw === true,
    // NexusMods: mod object `contains_adult_content` (REST) / `adultContent` (GraphQL v2).
    nexus:    o => o.contains_adult_content === true || o.containsAdultContent === true || o.adultContent === true,
    // DeviantArt: deviation `is_mature` (API) / `isMature` (Eclipse).
    deviant:  o => o.is_mature === true || o.isMature === true,
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
    // Minds: activity `nsfw` is an array of category ids (non-empty = flagged).
    minds:    o => (Array.isArray(o.nsfw) && o.nsfw.length > 0) || o.mature === true,
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
    flickr:   o => o.safety_level === 2 || o.safety_level === 3 || o.safety_level === '2' || o.safety_level === '3'
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

    { id: 'bluesky',
      test: (h, p) => p.indexOf('/xrpc/') !== -1 && h.indexOf('bsky.') !== -1,
      signals: [S.bsky] },

    { id: 'booru',
      test: (h) => BOORU_HOSTS.has(h),
      signals: [S.booru] },

    { id: 'imgur',
      test: (h) => h === 'imgur.com' || h.endsWith('.imgur.com'),
      signals: [S.imgur] },

    { id: 'nexusmods',
      test: (h) => h === 'nexusmods.com' || h.endsWith('.nexusmods.com'),
      signals: [S.nexus] },

    { id: 'deviantart',
      test: (h) => h === 'deviantart.com' || h.endsWith('.deviantart.com'),
      signals: [S.deviant] },

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

    // Mastodon — any instance, matched purely by its stable REST paths.
    // (Also carries S.nsfwBool so PeerTube videos sharing /api/v1/accounts/ are caught.)
    { id: 'mastodon',
      test: (h, p) => MASTO_PATHS.some(mp => p.indexOf(mp) !== -1),
      signals: [S.sensitive, S.nsfwBool] }
  ];

  // Cheap pre-filter: avoid constructing a URL object for the ~99.9% of requests
  // that can't possibly match. One substring scan over the raw URL string.
  const QUICK = [
    'reddit.com', 'x.com', 'twitter.com', 'pixiv.net', 'tumblr.com', 'bsky.',
    '/xrpc/', '/api/v1/timelines', '/api/v1/notifications', '/api/v1/favourites',
    '/api/v1/bookmarks', '/api/v1/trends', '/api/v2/search', '/api/v1/accounts/',
    'donmai.us', 'gelbooru.com', 'konachan.', 'yande.re', 'tbib.org',
    'imgur.com', 'nexusmods.com', 'deviantart.com',
    'vimeo.com', 'dailymotion', 'odysee', 'lbry', 'patreon.com', 'gumroad.com',
    'minds.com', 'itaku.ee',
    '/api/v1/videos', '/api/v1/video-channels', '/api/v3/post', '/api/v3/comment',
    '/api/v3/community', '/api/v3/search', 'mangadex', 'artstation.com', 'flickr'
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
  //   • Objects → drop any child value that is itself directly flagged (catches
  //               id→item maps, e.g. pixiv), then recurse into the rest.
  // ctx.n accumulates how many items were stripped (per-call, no global races).
  function scrub(node, signals, depth, ctx) {
    if (node == null || typeof node !== 'object' || depth > 12) return node;

    if (Array.isArray(node)) {
      const kept = [];
      for (let i = 0; i < node.length; i++) {
        const scrubbed = scrub(node[i], signals, depth + 1, ctx);
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
      if (v && typeof v === 'object' && !Array.isArray(v) && signalsDirect(v, signals)) {
        delete node[k];
        ctx.n++;
        continue;
      }
      node[k] = scrub(v, signals, depth + 1, ctx);
    }
    return node;
  }

  // ── Stats relay ───────────────────────────────────────────────────────────
  // We can't touch chrome.storage from the MAIN world, so hand the count to the
  // isolated content script via postMessage; it forwards to the background worker.
  function report(id, n) {
    try { window.postMessage({ __purePath: 'graylist-filter', site: id, count: n }, '*'); } catch (_) {}
    try { console.debug('[Pure Path] Graylist V2 stripped', n, 'NSFW item(s) from', id); } catch (_) {}
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
          if (ct.indexOf('json') === -1) return resp;

          // Clone so the original body stream stays intact if we bail out.
          return resp.clone().text().then(txt => {
            let data;
            try { data = JSON.parse(txt); } catch (_) { return resp; }

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
})();
