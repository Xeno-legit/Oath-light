(function() {
  'use strict';
  
  // Don't run on extension pages or chrome URLs
  if (window.location.protocol === 'chrome-extension:' || 
      window.location.protocol === 'moz-extension:' ||
      window.location.protocol === 'chrome:' ||
      window.location.protocol === 'about:' ||
      window.location.protocol === 'edge:') {
    return;
  }
  
  // Search engines - we enforce SafeSearch on these
  const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'];
  
  // Check if current domain is a search engine
  const hostname = window.location.hostname.toLowerCase();
  const isSearchEngine = SEARCH_ENGINES.some(se => 
    hostname === se || hostname.endsWith('.' + se)
  );
  
  // SAFESEARCH UI HIDING — ALWAYS ON
  // Prevents the user from disabling SafeSearch on any search engine.
  // Runs unconditionally on all search engine pages (all tabs/sections).
  
  function hideSafeSearchUI() {
    if (!isSearchEngine) return;
    if (document.getElementById('pure-path-safesearch-lock')) return;
    
    const style = document.createElement('style');
    style.id = 'pure-path-safesearch-lock';
    style.textContent = `
      /* ===== GOOGLE ===== */
      #base_safesearch_button,
      [data-safesearch-toggle],
      [jscontroller][data-safesearch],
      g-menu-item:has([data-safesearch]),
      a[href*="safesearch"],
      [data-a11y-title*="SafeSearch"],
      [aria-label*="SafeSearch"],
      [data-enable-safesearch-toggle],
      .safesearch-toggle,
      #safesearch-toggle {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
        clip: rect(0,0,0,0) !important;
      }
      
      /* ===== BING ===== */
      #b_safesearch,
      [data-tag="safesearch"],
      #sp_safesearch,
      a[href*="safesearch"],
      .b_dropdown:has([data-tag="safesearch"]) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      
      /* ===== DUCKDUCKGO ===== */
      [name="kp"],
      .dropdown--safe-search,
      label[for="kp"],
      .js-safe-search-setting {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      
      /* ===== YAHOO ===== */
      #safesearch-setting,
      .safesearch,
      [data-rapid_p*="safesearch"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  
  // SPA URL MONITORING (delegates URL checking to background.js)
  
  let lastUrl = window.location.href;
  
  function setupSpaMonitoring() {
    window.addEventListener('popstate', onSpaNavigation);
    
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      onSpaNavigation();
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      onSpaNavigation();
    };
    
    checkCurrentUrl();
  }
  
  function onSpaNavigation() {
    checkCurrentUrl();
  }
  
  async function checkCurrentUrl() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'checkUrl', url: currentUrl });
      if (response && response.blocked && response.blockedUrl) {
        window.location.replace(response.blockedUrl);
      }
    } catch (_) {
      // Background script may have restarted
    }
  }
  
  // INITIALIZATION
  
  // NEWGROUNDS "CONTENT FILTERED" BYPASS BLOCKER
  // Detects the "show it to me anyway" page and immediately redirects to blocked.html.
  // Runs at the TOP LEVEL so it fires before anything else on the page.

  function blockNewgroundsBypassPage() {
    if (hostname !== 'newgrounds.com' && !hostname.endsWith('.newgrounds.com')) return;
    if (window._purePathBlockedNG) return;

    function doBlock() {
      // Check for the bypass link or the page title
      const bypassLink = document.getElementById('ignore-filter-link');
      const title = document.title;
      const hasFilterPage = bypassLink || title === 'Content Filtered';
      if (!hasFilterPage) return;

      window._purePathBlockedNG = true;
      // Hide everything immediately
      document.documentElement.style.display = 'none';
      try {
        // TEMP (testing): blocked.html hangs Playwright; route to a light page.
        console.log('[PurePath][TEST] BLOCK newgrounds bypass page', window.location.href);
        window.location.replace('about:blank');
      } catch (e) {
        // Fallback: nuke the page entirely
        document.documentElement.innerHTML = '<html><body style="background:#0f172a;"></body></html>';
      }
    }

    // Run immediately if DOM is ready
    if (document.readyState !== 'loading') {
      doBlock();
    }
    // Also run on DOMContentLoaded in case we beat the DOM
    document.addEventListener('DOMContentLoaded', doBlock);
    // Failsafe: poll for a short burst in case the element loads late
    let checks = 0;
    const interval = setInterval(() => {
      if (window._purePathBlockedNG || checks++ > 15) {
        clearInterval(interval);
        return;
      }
      doBlock();
    }, 200);
  }

  // GRAYLIST V2 — MAIN-world API interception
  // Injects graylist-inject.js into the page's MAIN world so it can patch fetch
  // and strip the items the SITE ITSELF labelled NSFW (over_18, possibly_sensitive,
  // xRestrict, sensitive, bsky labels, booru rating…) before they ever render.
  // Runs on every page (Mastodon instances can't be enumerated by host); the
  // injected script self-gates on the request URL, so it's near-free elsewhere.
  // External WAR <script> is required: it bypasses strict page CSP that would
  // block an inline script (reddit/x both ship such CSP).
  // (This is the sole graylist mechanism now — the old per-site CSS UI/content
  // hiding + toggle-forcing + cheeky popup were removed in favour of it.)
  function injectGraylistInterceptor() {
    if (window.__purePathGraylistInjected) return;
    window.__purePathGraylistInjected = true;
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('graylist-inject.js');
      s.dataset.mode = 'standard';
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch (_) {
      // Extension context invalidated or CSP-blocked — nothing else to fall back to.
    }
  }

  // Relay the MAIN-world script's "I stripped N items" notice to the background
  // worker (the MAIN world can't reach chrome.storage itself).
  function setupGraylistStatsRelay() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.__purePath !== 'graylist-filter' || typeof d.count !== 'number') return;
      try {
        chrome.runtime.sendMessage({ action: 'graylistFiltered', count: d.count, site: d.site });
      } catch (_) {}
    });
  }

  // GRAYLIST V2 — DOM-LABEL FILTERING (server-rendered sites with no JSON feed)
  // Some graylist sites render their feed as HTML on the server, so there's no
  // fetched JSON for the MAIN-world interceptor to clean. But these sites stamp
  // each item with their OWN rating marker (a class / data-attr) — the SSR
  // equivalent of an API NSFW field, and just as stable. We read that marker and
  // remove the flagged item. This is NOT the V1 "hide the settings UI" approach
  // (that rotted); it keys on the per-ITEM rating label, the site's ground truth.
  //
  // Each rule:
  //   markers / item  — find every `markers` element, hide the nearest `item`
  //                     ancestor (or the marker itself). Cleans LISTINGS.
  //   textScan        — for sites that print the rating as text with no class.
  //   pagePath/pageLabel — CONTENT-PAGE guard. Item-hiding only filters feeds;
  //                     if the user opens an adult item directly (e.g. their
  //                     "show adult" preference is already enabled server-side,
  //                     so nothing is hidden and no interstitial appears), the
  //                     page just renders. `pageLabel()` reads the page's OWN
  //                     rating declaration on a content URL (`pagePath`) and, if
  //                     adult, hard-blocks the whole tab via blocked.html. This
  //                     is the ground-truth fix for the "preference already on"
  //                     leak — we don't touch their toggle, we kill the page.
  // Patreon helpers (used by the 'patreon.com' rule's pageLabel). Reserved
  // top-level routes that must never be treated as a creator vanity slug.
  const PATREON_NON_CREATOR = new Set([
    'home', 'explore', 'search', 'messages', 'settings', 'notifications',
    'login', 'signup', 'logout', 'posts', 'post', 'dashboard', 'c', 'cw',
    'checkout', 'create', 'about', 'careers', 'press', 'apps', 'app', 'api',
    'sitemap', 'collection', 'collections', 'feature', 'privacy', 'policy',
    'terms', 'support', 'help', 'pricing', 'product', 'creators', 'media'
  ]);
  // Memoise the (potentially large) SSR scan per-URL so the MutationObserver's
  // re-scans during scroll don't re-parse the payload every burst.
  let _ppPatreonMemo = { url: '', val: false };

  const DOM_LABEL_RULES = {
    'newgrounds.com': {
      // Newgrounds rates work E/T/M/A. Adult ("a") and Mature ("m") cards carry a
      // rating marker whose class TOKEN ends in `rated-a` / `rated-m`, but the
      // prefix differs by page type — front page uses `background-color-rated-a`
      // + `<span class="rated-a">`; the browse grid uses an icon
      // `nohue-ngicon-small-rated-a`. A substring match on `rated-a`/`rated-m`
      // covers every variant (rated-t / rated-e stay untouched). Hiding a+m
      // matches the page-block, which blocks both.
      markers: '[class*="rated-a"], [class*="rated-m"], [data-rating="a"], [data-rating="A"], [data-rating="m"], [data-rating="M"]',
      item: 'a[href*="/view/"], .item-portalsubmission, .portalsubmission-cell, .item-audiosubmission, [class*="submission"], li',
      // Submission pages stamp the content's own rating in <meta name="rating">.
      pagePath: /^\/(portal\/view|art\/view|audio\/listen)\//i,
      pageLabel: () => {
        const m = document.querySelector('meta[name="rating"]');
        const v = m ? (m.getAttribute('content') || '').trim().toLowerCase() : '';
        return v === 'adult' || v === 'mature';
      }
    },
    'archiveofourown.org': {
      // AO3 ratings live as a class on the work blurb.
      markers: '.rating-explicit, .rating-mature, .rating-notrated',
      item: 'li.work, li.blurb, .blurb',
      // A work page carries its rating in dd.rating.tags.
      pagePath: /^\/works\/\d+/i,
      pageLabel: () => {
        const tags = document.querySelectorAll('dd.rating.tags a.tag, dd.rating a.tag');
        for (const t of tags) if (/\b(explicit|mature)\b/i.test(t.textContent || '')) return true;
        return false;
      }
    },
    // NOTE: furaffinity.net / inkbunny.net / sofurry.com / weasyl.com were moved to
    // the curated BLACKLIST (blocked outright) — too unreliable to DOM-filter.
    'fanfiction.net': {
      // FF.net prints "Rated: Fiction M" as text in the gray meta bar — no class.
      textScan: { item: '.z-list, .z-list.zhover', re: /Rated:\s*(?:Fiction\s*)?(?:M|MA)\b/i },
      // Story pages repeat the rating in the #profile_top header.
      pagePath: /^\/s\/\d+/i,
      pageLabel: () => {
        const top = document.getElementById('profile_top');
        return top ? /Rated:\s*(?:Fiction\s*)?(?:M|MA)\b/i.test(top.textContent || '') : false;
      }
    },
    'scribblehub.com': {
      // ScribbleHub openly hosts explicit web-fiction. Its OWN genre tags are the
      // ground truth: every series/card links its genres to /genre/<slug>/. We key
      // on the unambiguously-adult genre anchors (smut/adult/ecchi/mature/hentai/
      // lolicon/shotacon) — present identically on listing cards AND series pages —
      // so one selector drives both layers. Matching the href (not free text)
      // avoids false-hiding a card whose description merely says "mature".
      markers: 'a.fic_genre[href*="/genre/smut/"], a.fic_genre[href*="/genre/adult/"], a.fic_genre[href*="/genre/ecchi/"], a.fic_genre[href*="/genre/mature/"], a.fic_genre[href*="/genre/hentai/"], a.fic_genre[href*="/genre/lolicon/"], a.fic_genre[href*="/genre/shotacon/"]',
      item: '.search_main_box',
      pageLabel: () => {
        const p = (window.location.pathname || '').toLowerCase();
        // (a) Whole adult-genre browse pages (the entire grid is explicit) —
        //     hard-block like itch.io /games/nsfw. ('mature' is intentionally
        //     excluded here: it's broad enough to include non-sexual dark themes;
        //     its explicit cards are still removed by item-hiding above.)
        if (/^\/genre\/(smut|adult|ecchi|hentai|lolicon|shotacon)\//.test(p)) return true;
        // (b) A series page tagged with an explicit genre → block the whole tab
        //     (covers users who opened an adult series directly / have mature on).
        if (/^\/series\/\d+/.test(p)) {
          return !!document.querySelector('a.fic_genre[href*="/genre/smut/"], a.fic_genre[href*="/genre/adult/"], a.fic_genre[href*="/genre/ecchi/"], a.fic_genre[href*="/genre/hentai/"], a.fic_genre[href*="/genre/lolicon/"], a.fic_genre[href*="/genre/shotacon/"]');
        }
        return false;
      }
    },
    'itch.io': {
      // Adult games show a content-warning gate before the page; browse grids tag
      // adult cells. Best-effort selectors — verify on live DOM.
      markers: '.game_cell.nsfw, [data-nsfw="true"]',
      item: '.game_cell',
      pageLabel: () => {
        // (a) Adult BROWSE listings have NO per-cell DOM marker (the whole grid is
        //     adult), so item-hiding can't touch them — hard-block the page by path.
        //     Covers /games/nsfw and adult tag/genre browse (tag-nsfw, tag-adult,
        //     tag-hentai, tag-eroge, tag-porn, tag-erotic, tag-lewd, tag-sex, r18…).
        const p = (window.location.pathname || '').toLowerCase();
        if (/^\/games\/nsfw(?:\/|$)/.test(p)) return true;
        const m = p.match(/^\/games\/(?:tag|genre)-([a-z0-9-]+)/);
        if (m && /(?:^|-)(?:nsfw|adult|adults?-only|hentai|eroge|porn|porno|erotic|erotica|lewd|sex|sexual|r18|18-?plus|futanari)(?:$|-)/.test(m[1])) return true;
        // (b) Individual adult game page: itch's own content-warning gate.
        const w = document.querySelector('.content_warning, .content_warning_inner, .game_warning');
        return w ? /adult|nsfw|explicit|sexual|mature/i.test(w.textContent || '') : false;
      }
    },
    'patreon.com': {
      // Patreon labels adult content cleanly (the OPPOSITE of the under-tagged
      // blacklist sites) — but it's a Next.js app that SERVER-RENDERS the first
      // paint, so the MAIN-world JSON interceptor (graylist-inject.js) only ever
      // sees subsequent client fetches; the initial explore/feed/creator HTML
      // slips past it. We close that transport gap here at the DOM, keyed on
      // Patreon's OWN ground-truth markers:
      //   LISTINGS — every adult creator/post card carries data-tag="nsfw-chip"
      //     (verified 1:1 with cards on /explore and /home). Hide the card.
      //   CREATOR PAGE — a direct visit to an adult creator (/<vanity> →
      //     redirects to /cw/<vanity>) renders NO chip; the campaign's is_nsfw
      //     flag lives only in the SSR payload. We scope it to THIS creator —
      //     recommended adult creators ALSO embed is_nsfw:true on a SFW page —
      //     by tying the flag to the campaign whose checkout/vanity URL is the
      //     current slug, then hard-block the tab (pageLabel below).
      // Class names are CSS-Modules (`Component-module__hash__local`): the
      // component PREFIX is stable across builds, the hash is not — so we
      // substring-match the prefix, never the hash, never the `sc-*` styled
      // component names.
      markers: '[data-tag="nsfw-chip"]',
      item: '[class*="CreatorTile-module__"], [class*="ClickArea-module__"], [class*="PostCard"], [class*="-module__card"], li, [role="listitem"]',
      pageLabel: () => {
        const path = window.location.pathname || '';
        const m = path.match(/^\/(?:cw\/)?([^\/?#]+)/);
        if (!m) return false;
        const slug = m[1].toLowerCase();
        if (PATREON_NON_CREATOR.has(slug)) return false;
        const href = window.location.href;
        if (_ppPatreonMemo.url === href) return _ppPatreonMemo.val;
        let blob = '';
        const sc = document.querySelectorAll('script');
        for (const s of sc) { const t = s.textContent; if (t && t.indexOf('is_nsfw') !== -1) blob += t + '\n'; }
        let val = false;
        if (blob) {
          const low = blob.toLowerCase();
          // The current creator's campaign object pairs is_nsfw with its
          // checkout/vanity URL; look back a short window from that URL for an
          // is_nsfw:true (escaped JSON: is_nsfw\":true). Scoping to the slug
          // excludes recommended adult creators elsewhere on the page.
          const needles = ['checkout/' + slug + '\\"', 'checkout/' + slug + '"', 'patreon.com/' + slug + '\\"'];
          for (const n of needles) {
            let i = low.indexOf(n.toLowerCase());
            while (i !== -1 && !val) {
              if (/is_nsfw\\?"\s*:\s*true/.test(blob.slice(Math.max(0, i - 700), i))) val = true;
              i = low.indexOf(n.toLowerCase(), i + 1);
            }
            if (val) break;
          }
        }
        _ppPatreonMemo = { url: href, val: val };
        return val;
      }
    },
    // Steam — page-level block only (no JSON feed; mostly age-gated SSR pages).
    'steampowered.com': {
      pagePath: /^\/(agecheck|app|sub|bundle)\//i,
      pageLabel: () => {
        // The age-check interstitial only appears for mature titles.
        if (/\/agecheck\//i.test(window.location.pathname)) return true;
        if (document.querySelector('#app_agegate, .agegate_birthday_selector, #agegate_box, #app_agegate_btn')) return true;
        const m = document.querySelector('#game_area_mature_content, .mature_content_notice, .agegate_text_container');
        return m ? /adult|mature|sexual|nudity|not be appropriate/i.test(m.textContent || '') : false;
      }
    },
    'steamcommunity.com': {
      // Mature-content overlay on screenshots/artwork/workshop (best-effort).
      pageLabel: () => !!document.querySelector('.mature_content, .maturecontent, #BlurNSFWImage')
    }
  };

  const DOM_LABEL_DOMAIN_SET = new Set(Object.keys(DOM_LABEL_RULES));

  function matchDomLabelDomain() {
    if (DOM_LABEL_DOMAIN_SET.has(hostname)) return hostname;
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (DOM_LABEL_DOMAIN_SET.has(parent)) return parent;
    }
    return null;
  }

  function hideItem(el) {
    if (!el || el.dataset.purePathHidden) return false;
    el.dataset.purePathHidden = '1';
    el.style.setProperty('display', 'none', 'important');
    return true;
  }

  function applyDomLabel(rule) {
    let removed = 0;
    if (rule.markers) {
      let marks;
      try { marks = document.querySelectorAll(rule.markers); } catch (_) { marks = []; }
      for (const m of marks) {
        const item = (rule.item && m.closest(rule.item)) || m;
        if (hideItem(item)) removed++;
      }
    }
    if (rule.textScan) {
      let items;
      try { items = document.querySelectorAll(rule.textScan.item); } catch (_) { items = []; }
      for (const it of items) {
        if (it.dataset.purePathHidden) continue;
        if (rule.textScan.re.test(it.textContent || '')) {
          if (hideItem(it)) removed++;
        }
      }
    }
    if (removed > 0) {
      try {
        chrome.runtime.sendMessage({ action: 'graylistFiltered', count: removed, site: 'dom:' + hostname });
      } catch (_) {}
    }
  }

  // Page-level ground-truth block: if we're on a content page whose own rating
  // declares it adult, hard-block the whole tab (closes the "preference already
  // enabled server-side" leak that item-hiding can't reach).
  let pageLabelBlocked = false;
  function checkPageLabel(key, rule) {
    if (pageLabelBlocked || !rule.pageLabel) return;
    if (rule.pagePath && !rule.pagePath.test(window.location.pathname)) return;
    let hit = false;
    try { hit = !!rule.pageLabel(); } catch (_) {}
    if (!hit) return;
    pageLabelBlocked = true;
    // Hide instantly in case the redirect lags a frame.
    try { document.documentElement.style.display = 'none'; } catch (_) {}
    try {
      chrome.runtime.sendMessage({
        action: 'notifyBlock',
        url: window.location.href,
        reason: 'graylist_page_label',
        match: key + ' adult-rated page'
      });
    } catch (_) {}
  }

  function setupDomLabelFiltering() {
    const key = matchDomLabelDomain();
    if (!key) return;
    const rule = DOM_LABEL_RULES[key];

    const run = () => { checkPageLabel(key, rule); applyDomLabel(rule); };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }

    // Catch lazy-load / infinite scroll / SPA pagination. Debounced so a burst of
    // mutations triggers a single re-scan.
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; run(); }, 250);
    });
    const start = () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // DISCORD — block NSFW channels/servers, keep the platform.
  // Discord is a SPA driven by a WebSocket gateway (not fetch), so the JSON
  // interceptor can't reach its data. Instead we work at the DOM:
  //   1. Age-gate block — when an age-restricted channel/server is opened, Discord
  //      renders its OWN gate ("This channel is marked as age-restricted…"). We
  //      detect that ground-truth text and hard-block the tab before the user can
  //      click through. This is the reliable enforcement point.
  //   2. Sidebar hiding (best-effort) — hide channels Discord tags NSFW so they're
  //      not one click away.
  // KNOWN GAP: a user who has already enabled "Display age-restricted content"
  // sees NSFW channels with no gate; catching that needs the (hashed, fragile)
  // header NSFW marker — deferred. Verify selectors against live DOM.
  function setupDiscordFiltering() {
    if (!(hostname === 'discord.com' || hostname.endsWith('.discord.com'))) return;

    // Gate-specific phrasing (NOT the Settings "Display age-restricted content"
    // toggle, so the settings page is never falsely blocked).
    const GATE_RE = /marked as age[- ]restricted|age[- ]restricted (?:channel|community|server)|must be (?:18|over 18|eighteen)\b/i;
    let blocked = false;

    function scan() {
      if (blocked) return;

      function hardBlock(match) {
        blocked = true;
        try { document.documentElement.style.display = 'none'; } catch (_) {}
        try {
          chrome.runtime.sendMessage({
            action: 'notifyBlock', url: window.location.href,
            reason: 'discord_nsfw', match: match
          });
        } catch (_) {}
      }

      // 0) WHOLE-SERVER block. A server with several age-restricted channels is an
      //    NSFW server — block every page in it. This is the only thing that also
      //    neutralises channels the server left UNFLAGGED (non-compliant with
      //    Discord policy): once the server is known-NSFW we don't rely on per-
      //    channel signals at all. Threshold is intentionally low (anti-addiction
      //    bias); a normal server with one 18+ corner stays channel-filtered.
      const NSFW_SERVER_THRESHOLD = 2; // block the server at 2+ age-restricted channels (more than one)
      const guild = window.location.pathname.match(/^\/channels\/(\d+)\b/);
      if (guild) {
        const rows = new Set();
        document.querySelectorAll('[aria-label*="age-restricted" i]').forEach(ic => {
          rows.add(ic.closest('li, [class*="containerDefault"]') || ic);
        });
        if (rows.size >= NSFW_SERVER_THRESHOLD) {
          hardBlock('NSFW Discord server (' + rows.size + ' age-restricted channels)');
          return;
        }
      }

      // 1a) Age-gate TEXT → block. Covers users who have NOT enabled "Display
      //     age-restricted content" (Discord renders its own gate then).
      const nodes = document.querySelectorAll('[class*="nsfw" i], [class*="gate" i], [class*="ageGate" i], section, main');
      for (const el of nodes) {
        if (GATE_RE.test(el.textContent || '')) { hardBlock('Discord age-restricted channel/server'); return; }
      }

      // 1b) OPEN channel is age-restricted → block even when the user HAS opted in
      //     and Discord shows no gate (the documented opt-in leak). Discord tags
      //     every age-restricted channel row with an icon whose aria-label is
      //     "Text (Age-Restricted) icon" — a <div>, not an <a>. Map the open
      //     channel id (URL) to its sidebar row and check for that icon.
      const open = window.location.pathname.match(/\/channels\/\d+\/(\d+)/);
      if (open) {
        const a = document.querySelector('a[href$="/' + open[1] + '"]');
        const row = a && a.closest('li, [class*="containerDefault"]');
        if (row && row.querySelector('[aria-label*="age-restricted" i]')) {
          hardBlock('Discord age-restricted channel (opted-in)');
          return;
        }
      }

      // 2) Hide age-restricted channels in the sidebar. The marker is the icon
      //    <div aria-label="… (Age-Restricted) …"> (NOT an <a>), so match ANY
      //    element carrying it; keep the literal-"nsfw" name as a fallback.
      let marks;
      try { marks = document.querySelectorAll('[aria-label*="age-restricted" i], a[aria-label*="nsfw" i], [class*="nsfw" i] a'); }
      catch (_) { marks = []; }
      for (const mk of marks) {
        const item = mk.closest('li, [class*="containerDefault"], [class*="wrapper"]') || mk;
        hideItem(item);
      }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    else scan();

    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; scan(); }, 300);
    });
    const start = () => { if (document.body) observer.observe(document.body, { childList: true, subtree: true }); };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // FOCUS-SCHEDULE REMINDER POP-UPS
  // The background worker fires these during the user's "vulnerable hours". We
  // render a small, self-contained card inside a shadow root (so page CSS can't
  // touch it) anchored bottom-right of the TOP frame only.
  const PP_REMINDER_HOST_ID = 'pure-path-reminder';

  function setupReminderListener() {
    if (window.top !== window) return; // top frame only — avoid one card per iframe
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'showReminder') {
        try { showReminderOverlay(msg); } catch (_) {}
        if (sendResponse) sendResponse({ ok: true });
      }
      return false;
    });
  }

  function showReminderOverlay(msg) {
    const render = (dark) => renderReminderCard(msg, dark);
    try {
      chrome.storage.local.get(['display', 'theme'], (r) => {
        const d = (r && r.display && typeof r.display === 'object') ? r.display : (r || {});
        render((d.theme || 'dark') !== 'light');
      });
    } catch (_) {
      render(true);
    }
  }

  function renderReminderCard({ title, body, kind }, dark) {
    if (!document.body && !document.documentElement) return;
    // Replace any existing card so reminders never stack.
    const prev = document.getElementById(PP_REMINDER_HOST_ID);
    if (prev) prev.remove();

    const host = document.createElement('div');
    host.id = PP_REMINDER_HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 20px; bottom: 20px;';
    const root = host.attachShadow({ mode: 'open' });

    const bg = dark ? 'rgba(17,24,39,0.92)' : 'rgba(255,255,255,0.94)';
    const fg = dark ? '#f3f4f6' : '#111827';
    const sub = dark ? '#9ca3af' : '#4b5563';
    const border = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
    const accent = kind === 'checkin' ? '#34d399' : '#818cf8';

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          position: relative;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          width: 320px; max-width: calc(100vw - 40px);
          background: ${bg}; color: ${fg};
          border: 1px solid ${border}; border-radius: 16px;
          box-shadow: 0 18px 50px rgba(0,0,0,0.35);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          overflow: hidden; transform: translateY(16px); opacity: 0;
          transition: transform .42s cubic-bezier(.16,1,.3,1), opacity .42s ease;
        }
        .card.in { transform: translateY(0); opacity: 1; }
        .accent { height: 4px; background: linear-gradient(90deg, ${accent}, transparent); }
        .body { padding: 16px 18px; display: flex; gap: 12px; }
        .dot { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; background: ${accent}; box-shadow: 0 0 0 4px ${accent}22; }
        .txt { flex: 1; min-width: 0; }
        .brand { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: ${accent}; font-weight: 700; }
        .title { font-size: 15px; font-weight: 700; margin: 3px 0 4px; }
        .msg { font-size: 13.5px; line-height: 1.5; color: ${sub}; }
        .close { position: absolute; top: 10px; right: 10px; width: 24px; height: 24px; border: 0; background: transparent; color: ${sub}; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 8px; }
        .close:hover { background: ${border}; color: ${fg}; }
      </style>
      <div class="card">
        <div class="accent"></div>
        <button class="close" aria-label="Dismiss">&times;</button>
        <div class="body">
          <div class="dot"></div>
          <div class="txt">
            <div class="brand">Pure Path</div>
            <div class="title"></div>
            <div class="msg"></div>
          </div>
        </div>
      </div>`;
    // Inject text via textContent — never interpolate the message into HTML.
    root.querySelector('.title').textContent = title || 'Pure Path';
    root.querySelector('.msg').textContent = body || '';

    (document.body || document.documentElement).appendChild(host);
    const card = root.querySelector('.card');
    requestAnimationFrame(() => card.classList.add('in'));

    let removed = false;
    const dismiss = () => {
      if (removed) return;
      removed = true;
      card.classList.remove('in');
      setTimeout(() => host.remove(), 450);
    };
    root.querySelector('.close').addEventListener('click', dismiss);
    setTimeout(dismiss, 12000);
  }

  function initContentScript() {
    // Inject the MAIN-world interceptor as early as possible — before page scripts
    // boot their data fetches.
    injectGraylistInterceptor();
    setupGraylistStatsRelay();
    setupDomLabelFiltering();
    setupDiscordFiltering();
    setupReminderListener();

    // FIRST: check for Newgrounds bypass page before doing anything else
    blockNewgroundsBypassPage();

    if (isSearchEngine) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideSafeSearchUI);
      } else {
        hideSafeSearchUI();
      }
    }

    
    setupSpaMonitoring();
  }
  
  initContentScript();
})();

