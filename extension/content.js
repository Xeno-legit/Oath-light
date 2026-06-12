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
        window.location.replace(chrome.runtime.getURL('blocked.html'));
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
  const DOM_LABEL_RULES = {
    'newgrounds.com': {
      // Newgrounds rates adult work "A". Cards carry .rating-a / data-rating="a".
      markers: '.rating-a, [data-rating="a"], [data-rating="A"]',
      item: '.item-portalsubmission, .portalsubmission-cell, .item-audiosubmission, [class*="submission"], li',
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
    'furaffinity.net': {
      // FA gallery figures carry r-general / r-mature / r-adult.
      markers: 'figure.r-adult, figure.r-mature, .r-adult, .r-mature',
      item: 'figure, .gallery-item, li',
      // Submission pages show a rating box (Adult / Mature).
      pagePath: /^\/view\/\d+/i,
      pageLabel: () => {
        if (document.querySelector('.rating-box.adult, .rating-box.mature')) return true;
        const box = document.querySelector('.rating-box, .rating');
        return box ? /\b(adult|mature)\b/i.test(box.textContent || '') : false;
      }
    },
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
    // ── Best-effort selectors — verify against live DOM before trusting ──────
    'inkbunny.net': {
      markers: '[class*="rating_e"], [class*="rating_m"], .rating-explicit, .rating-mature',
      item: '.widget_imageFromSubmission, .submissionthumb, .thumbnail_container, li, td'
    },
    'sofurry.com': {
      markers: '[class*="rating-adult"], [class*="rating-mature"], [data-rating="adult"], [data-rating="mature"]',
      item: '.items_list .item, .sf-item, .watch-item, li'
    },
    'weasyl.com': {
      // Furry art ratings (general/mature/explicit) — DOM-label like FurAffinity.
      markers: '[class*="rating-explicit"], [class*="rating-mature"], .r-explicit, .r-mature',
      item: '.thumb-bounds, .item, figure, li',
      pagePath: /^\/(submission|character|journal)\//i,
      pageLabel: () => {
        const r = document.querySelector('.rating, [class*="rating"]');
        return r ? /\b(mature|explicit|adult)\b/i.test(r.textContent || '') : false;
      }
    },
    'itch.io': {
      // Adult games show a content-warning gate before the page; browse grids tag
      // adult cells. Best-effort selectors — verify on live DOM.
      markers: '.game_cell.nsfw, [data-nsfw="true"]',
      item: '.game_cell',
      pageLabel: () => {
        const w = document.querySelector('.content_warning, .content_warning_inner, .game_warning');
        return w ? /adult|nsfw|explicit|sexual|mature/i.test(w.textContent || '') : false;
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
      // 1) Age-gate → block the whole tab.
      const nodes = document.querySelectorAll('[class*="nsfw" i], [class*="gate" i], [class*="ageGate" i], section, main');
      for (const el of nodes) {
        if (GATE_RE.test(el.textContent || '')) {
          blocked = true;
          try { document.documentElement.style.display = 'none'; } catch (_) {}
          try {
            chrome.runtime.sendMessage({
              action: 'notifyBlock', url: window.location.href,
              reason: 'discord_nsfw', match: 'Discord age-restricted channel/server'
            });
          } catch (_) {}
          return;
        }
      }
      // 2) Hide NSFW channels in the sidebar (best-effort).
      let chans;
      try { chans = document.querySelectorAll('a[aria-label*="age-restricted" i], a[aria-label*="nsfw" i], [class*="nsfw" i] a'); }
      catch (_) { chans = []; }
      for (const c of chans) {
        const item = c.closest('li, [class*="containerDefault"], [class*="wrapper"]') || c;
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

  function initContentScript() {
    // Inject the MAIN-world interceptor as early as possible — before page scripts
    // boot their data fetches.
    injectGraylistInterceptor();
    setupGraylistStatsRelay();
    setupDomLabelFiltering();
    setupDiscordFiltering();

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

