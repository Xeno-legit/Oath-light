// Content script for Pure Path
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
  
  // ============================================================================
  // SAFESEARCH UI HIDING — ALWAYS ON
  // Prevents the user from disabling SafeSearch on any search engine.
  // Runs unconditionally on all search engine pages (all tabs/sections).
  // ============================================================================
  
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
  
  // ============================================================================
  // GRAYLIST FILTER ENFORCEMENT
  // Hides NSFW settings UI and force-blocks NSFW content on gray-area domains.
  // Users cannot re-enable NSFW content; clicking hidden areas shows a popup.
  // ============================================================================

  // ── Shared CSS blocks (DRY) ─────────────────────────────────────
  const MASTODON_HIDE_UI = `
    label:has(input[name*="sensitive"]), [class*="sensitive-toggle"],
    div[class*="setting"]:has([class*="media"]):has([class*="sensitive"]),
    label:has(input[name*="display_media"]),
    .column-settings__row:has([name*="other"]),
    button[class*="show-filter"]
  `;
  const MASTODON_HIDE_CONTENT = `
    [class*="sensitive-content"],
    div[class*="media-gallery"]:has([class*="sensitive"]),
    div[class*="spoiler-button"]
  `;
  const DISCORD_DIR_UI = `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"], input[name*="nsfw"]`;
  const DISCORD_DIR_CONTENT = `[class*="nsfw-server"], div:has([class*="nsfw-badge"])`;

  // Domain → { hideUI, hideContent, rawCSS (optional — injected verbatim) }
  // Only entries that actually DO something are included.
  const GRAYLIST_FILTERS = {
    // ── RELIABLE FILTERS ────────────────────────────────────────────
    'reddit.com': {
      hideUI: `
        label:has(input[name*="mature"]), label:has(input[name*="over18"]),
        [data-testid="feed-settings-mature"], [class*="nsfw-toggle"],
        div[class*="Setting"]:has([class*="nsfw"]),
        [data-testid="is-nsfw-shown"], [data-testid="safe-browsing-mode"],
        [data-testid="nsfw-posts-and-comments"], [data-testid="is-nsfw"],
        settings-profile-nsfw-modal, settings-preferences-nsfw-modal,
        rpl-modal-card#nsfw-rpl-modal-card
      `,
      hideContent: `
        .nsfw-image, .prompt-18plus,
        shreddit-post[is-nsfw], shreddit-post[is-over-18],
        shreddit-post[nsfw], shreddit-post[over18],
        div[data-testid="post-container"]:has(.nsfw-stamp),
        .thing.over18, .listing-item:has(.nsfw-icon)
      `
    },
    'twitter.com': {
      hideUI: `
        section[aria-label="Section details"]:has(input[aria-describedby="CHECKBOX_2_LABEL"]),
        label:has(input[type="checkbox"][aria-describedby="CHECKBOX_2_LABEL"]),
        a[href="/settings/content_you_see"], a[href*="content_you_see"],
        a[href="/settings/explore"][data-testid="pivot"],
        a[href="/settings/search"][data-testid="pivot"],
        dialog:has(input[type="checkbox"]):has([class*="r-"]),
        [data-testid="settingsContentYouSee"]
      `,
      hideContent: `[data-testid="sensitiveMediaInterstitial"]`
    },
    'x.com': {
      hideUI: `
        section[aria-label="Section details"]:has(input[aria-describedby="CHECKBOX_2_LABEL"]),
        label:has(input[type="checkbox"][aria-describedby="CHECKBOX_2_LABEL"]),
        a[href="/settings/content_you_see"], a[href*="content_you_see"],
        a[href="/settings/explore"][data-testid="pivot"],
        a[href="/settings/search"][data-testid="pivot"],
        dialog:has(input[type="checkbox"]):has([class*="r-"]),
        [data-testid="settingsContentYouSee"]
      `,
      hideContent: `[data-testid="sensitiveMediaInterstitial"]`
    },
    'bsky.app': {
      hideUI: `
        a[href="/settings/moderation"],
        div[data-testid*="content-filter"], div[data-testid*="ContentFilter"],
        [class*="contentFilter"], [class*="moderation-setting"],
        button:has([class*="filter-toggle"])
      `,
      hideContent: `
        [data-testid*="content-warning"], [class*="contentWarning"],
        div[class*="adult-content"], div[class*="suggestive"]
      `
    },
    'bluesky.social': {
      hideUI: `
        a[href="/settings/moderation"],
        div[data-testid*="content-filter"], div[data-testid*="ContentFilter"],
        [class*="contentFilter"], [class*="moderation-setting"]
      `,
      hideContent: `[data-testid*="content-warning"], [class*="contentWarning"]`
    },
    'pixiv.net': {
      hideUI: `
        label:has(input[name*="r18"]), label:has(input[name*="R18"]),
        div:has(> input[name*="restrict"]):has(label),
        [class*="r18-toggle"], [class*="R18Toggle"],
        .settings-section:has([name*="r18"])
      `,
      hideContent: `
        .rp, [class*="r-18"], a[href*="mode=r18"],
        div[data-gtm-value*="R-18"], div[class*="mature-content"]
      `
    },
    'deviantart.com': {
      hideUI: `
        label:has(input[name*="mature"]), [class*="mature-toggle"],
        div[class*="_setting"]:has([class*="mature"]),
        a[href*="/settings/browsing"]
      `,
      hideContent: `
        [class*="mature-tag"], [data-mature="true"],
        div[class*="_deviation"]:has([class*="mature"])
      `
    },
    'newgrounds.com': {
      hideUI: `
        label:has(input[name*="rating"]):has(input[value="a"]),
        label:has(input[name*="rating_a"]),
        [class*="content-setting"]:has([class*="rating"]),
        input[name*="rating_a"], input[name*="rating"][value="a"],
        li:has(input.suitable-a),
        li:has(input[value="a"][name*="suitabilit"]),
        #ignore-filter-link, #ignore-warning
      `,
      hideContent: `.rating-a, .item-A, [class*="rated-a"], a[class*="rated-a"], div:has(> .rating-a)`,
      rawCSS: `
        /* Nuke the A rating icon everywhere: search sidebar, browse filters, settings */
        .suitable-a, label[for*="_a"].suitable-a,
        li:has(> input.suitable-a),
        li:has(> input[value="a"][name*="suitabilit"]),
        [role="listitem"]:has(.suitable-a),
        .checkboxes li:last-child:has(input[value="a"]),
        /* Hide the entire content settings row on the settings page */
        #settings_content, .settings-content,
        form[action*="settings"] .content-ratings,
        form[action*="settings"] fieldset:has(input.suitable-a) {
          display: none !important;
          visibility: hidden !important;
          width: 0 !important; height: 0 !important;
          overflow: hidden !important;
          position: absolute !important;
          clip: rect(0,0,0,0) !important;
        }
      `
    },
    'nexusmods.com': {
      hideUI: `
        label:has(input[name*="adult"]), [class*="adult-toggle"],
        div[class*="setting"]:has([class*="adult-content"]),
        a[href*="content+blocking"]
      `,
      hideContent: `[class*="adult-content"], div[class*="mod-tile"]:has([class*="adult"])`
    },
    'patreon.com': {
      hideUI: `
        label:has(input[name*="nsfw"]), label:has(input[name*="18plus"]),
        [class*="nsfw-toggle"], [data-tag*="nsfw-setting"],
        div[class*="setting"]:has([class*="nsfw"])
      `,
      hideContent: `[class*="nsfw-label"], div[class*="post"]:has([class*="nsfw-warning"])`
    },
    'vimeo.com': {
      hideUI: `
        label:has(input[name*="mature"]), [class*="mature-filter"],
        div[class*="setting"]:has([class*="mature"])
      `
    },
    'tumblr.com': {
      hideUI: `
        label:has(input[name*="filtering"]), label:has(input[name*="sensitive"]),
        [class*="content-filter-toggle"], [class*="sensitive-toggle"],
        div[class*="setting"]:has([class*="filtering"]),
        a[href*="/settings/account"]:has([class*="filter"])
      `,
      hideContent: `
        [class*="sensitive-media"],
        div[class*="post"]:has([class*="mature-content"]),
        [data-has-cw="true"]
      `
    },
    'furaffinity.net': {
      hideUI: `
        select[name*="rating"], input[name*="rating"],
        label:has(input[name*="sfw"]), label:has(input[name*="mature"]),
        label:has(input[name*="adult"]),
        [class*="content-filter"], #rating-selector,
        form[action*="controls/settings"]:has([name*="rating"])
      `,
      hideContent: `
        [class*="rating-adult"], [class*="rating-mature"],
        figure:has(img[class*="mature"]), figure:has(img[class*="adult"])
      `
    },
    'dailymotion.com': {
      hideUI: `
        [class*="family-filter"], [class*="FamilyFilter"],
        button[class*="family"], label:has(input[name*="family_filter"]),
        div[class*="setting"]:has([class*="family"])
      `
    },
    'archiveofourown.org': {
      // AO3 needs rawCSS because the selectors already contain their own declaration blocks
      rawCSS: `
        .blurb:has(.rating-explicit)  { display: none !important; }
        .blurb:has(.rating-mature)    { display: none !important; }
        .blurb:has(.rating-notrated)  { display: none !important; }
        li.work:has(.rating-explicit) { display: none !important; }
        li.work:has(.rating-mature)   { display: none !important; }
        li.work:has(.rating-notrated) { display: none !important; }
      `
    },
    'gumroad.com': {
      hideUI: `label:has(input[name*="adult"]), [class*="adult-toggle"], div[class*="setting"]:has([class*="adult"])`
    },

    // ── NOT SO RELIABLE FILTERS ─────────────────────────────────────
    'bitchute.com': {
      hideUI: `select[name*="sensitivity"], [class*="sensitivity-dropdown"], div[class*="setting"]:has([name*="sensitivity"])`
    },
    'discord.com': {
      hideUI: `
        div[class*="sensitiveContent"], [class*="explicit-filter"],
        label:has(input[name*="explicit_content_filter"]),
        div[class*="setting"]:has([class*="nsfw"]),
        div[class*="setting"]:has([class*="sensitive"]),
        [class*="contentFilterOption"]
      `
    },
    'disboard.org': {
      hideUI: `${DISCORD_DIR_UI}, [class*="nsfw-filter"]`,
      hideContent: `[class*="nsfw-server"], div[class*="server-card"]:has([class*="nsfw"])`
    },
    'discadia.com': {
      hideUI: DISCORD_DIR_UI,
      hideContent: DISCORD_DIR_CONTENT
    },
    'discord.me': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"]`,
      hideContent: `[class*="nsfw-server"]`
    },
    'discordlist.io': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"]`,
      hideContent: `[class*="nsfw-server"], [class*="nsfw-content"]`
    },
    'top.gg': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-filter"]`,
      hideContent: `[class*="nsfw-tag"], div:has([class*="nsfw-badge"])`
    },
    'fanfiction.net': {
      hideUI: `select[name*="rating"], option[value="M"], [class*="rating-filter"]`,
      hideContent: `[class*="rating-M"], div:has([class*="mature-rating"])`
    },
    'snapchat.com': {
      hideUI: `label:has(input[name*="sensitive"]), [class*="sensitive-toggle"], div[class*="setting"]:has([class*="restrict"])`
    },
    'gab.com': {
      hideUI: `[class*="keyword-filter"], form:has(input[name*="filter"]), a[href*="/settings/filters"]`
    },
    'telegram.org': {
      hideUI: `label:has(input[name*="sensitive"]), [class*="sensitive-toggle"], div[class*="setting"]:has([class*="filtering"])`
    },
    'odysee.com': {
      hideUI: `label:has(input[name*="mature"]), [class*="mature-toggle"], div[class*="setting"]:has([class*="mature"]), [class*="show-mature"]`,
      hideContent: `[class*="mature-content"], div:has([class*="mature-tag"])`
    },
    'mewe.com': {
      hideUI: `label:has(input[name*="content-filter"]), [class*="content-filter"], div[class*="setting"]:has([class*="filtering"])`
    },
    'minds.com': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"], div[class*="setting"]:has([class*="nsfw"])`,
      hideContent: `[class*="nsfw-content"], div:has([class*="nsfw-overlay"])`
    },
    'inkbunny.net': {
      hideUI: `label:has(input[name*="adult"]), [class*="adult-toggle"], select[name*="rating"], input[name*="rating"], div[class*="setting"]:has([class*="adult"])`,
      hideContent: `[class*="adult-content"], [class*="rating-adult"]`
    },
    'itaku.ee': {
      hideUI: `label:has(input[name*="mature"]), label:has(input[name*="explicit"]), [class*="content-visibility"], [class*="nsfw-toggle"], div[class*="setting"]:has([class*="mature"])`,
      hideContent: `[class*="mature-content"], [class*="explicit-content"]`
    },
    'sofurry.com': {
      hideUI: `select[name*="contentlevel"], [class*="content-pref"], label:has(input[name*="adult"]), label:has(input[name*="mature"]), div[class*="setting"]:has([class*="content"])`,
      hideContent: `[class*="adult-content"], [class*="mature-content"]`
    },
    'pillowfort.io': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"], div[class*="setting"]:has([class*="nsfw"])`,
      hideContent: `[class*="nsfw-post"], div[class*="post"]:has([class*="nsfw"])`
    },
    'speakbits.com': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"], div[class*="setting"]:has([class*="nsfw"])`,
      hideContent: `[class*="nsfw-content"], div:has([class*="nsfw-flag"])`
    },
    'gamebanana.com': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"]`,
      hideContent: `[class*="nsfw-content"], [class*="mature-content"]`
    },
    'ko-fi.com': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"]`
    },
    'buymeacoffee.com': {
      hideUI: `label:has(input[name*="nsfw"]), [class*="nsfw-toggle"]`
    },
    'subscribestar.com': {
      hideUI: `label:has(input[name*="18"]), [class*="age-toggle"], div[class*="setting"]:has([class*="adult"])`
    },

    // ── MASTODON / FEDIVERSE (shared CSS) ───────────────────────────
    'mastodon.social': { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT },
    'mastodon.online':  { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT },
    'fosstodon.org':    { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT },
    'mas.to':           { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT },
    'mstdn.social':     { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT },
    'techhub.social':   { hideUI: MASTODON_HIDE_UI, hideContent: MASTODON_HIDE_CONTENT }
  };

  // ── FAST DOMAIN LOOKUP ──────────────────────────────────────────
  // Pre-build a Set for O(1) "is this a graylist site?" check so that
  // content.js exits immediately on the ~99.9% of pages that aren't graylist.
  const GRAYLIST_DOMAIN_SET = new Set(Object.keys(GRAYLIST_FILTERS));

  function matchGraylistDomain() {
    if (GRAYLIST_DOMAIN_SET.has(hostname)) return hostname;
    // Check parent domains (e.g., "www.reddit.com" → "reddit.com")
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (GRAYLIST_DOMAIN_SET.has(parent)) return parent;
    }
    return null;
  }

  // ── CHEEKY POPUP ────────────────────────────────────────────────
  const CHEEKY_MESSAGES = [
    "Oh, Looking for the NSFW filter? pfff... You thought we didn't think of that....? 😏",
    "Nice try! The NSFW filter settings have left the building 🚪👋",
    "Looking for something? Whatever it was, it's gone now 🕳️",
    "NSFW toggle? Never heard of her 💅",
    "404: NSFW Settings Not Found (and never will be) 🔒",
    "Pure Path says: No touchy the filter! 🛡️",
    "You really thought you could sneak past us? Cute. 😊",
    "The filter toggle has been... ✨ vaporized ✨",
    "Womp womp..."
  ];

  let cheekyCooldown = false;

  function showCheekyPopup() {
    if (cheekyCooldown) return;
    cheekyCooldown = true;
    setTimeout(() => { cheekyCooldown = false; }, 5000);

    const msg = CHEEKY_MESSAGES[Math.floor(Math.random() * CHEEKY_MESSAGES.length)];

    // Remove any existing popup
    const existing = document.getElementById('pure-path-cheeky-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'pure-path-cheeky-popup';
    let iconHtml = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const iconUrl = chrome.runtime.getURL('icons/icon48.png');
        iconHtml = `<img src="${iconUrl}" style="width: 42px; height: 42px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); background: rgba(255,255,255,0.2); padding: 3px;" alt="Pure Path Logo">`;
      }
    } catch (e) {
      // If extension context is invalidated, fallback to an emoji
      iconHtml = `<div style="font-size: 36px; line-height: 1;">🛡️</div>`;
    }
    
    popup.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;">
        ${iconHtml}
        <div>${msg}</div>
      </div>
    `;

    popup.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      width: 240px; padding: 16px 20px;
      background: linear-gradient(135deg, #818cf8, #6366f1);
      color: #fff; font-family: 'Inter', 'Segoe UI', sans-serif;
      font-size: 14px; font-weight: 600; line-height: 1.4;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(99,102,241,0.4), 0 4px 12px rgba(0,0,0,0.15);
      opacity: 0; transform: translateX(80px) scale(0.9);
      transition: all 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: none;
    `;

    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      popup.style.opacity = '1';
      popup.style.transform = 'translateX(0) scale(1)';
    });

    setTimeout(() => {
      popup.style.opacity = '0';
      popup.style.transform = 'translateX(80px) scale(0.9)';
      setTimeout(() => popup.remove(), 500);
    }, 4000);
  }

  // ── CSS INJECTION ───────────────────────────────────────────────
  const NUKE_DECL = `
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    opacity: 0 !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
    position: absolute !important;
    clip: rect(0,0,0,0) !important;
  `;

  function injectGraylistFilterCSS() {
    if (document.getElementById('pure-path-graylist-lock')) return;

    const matchedKey = matchGraylistDomain();
    if (!matchedKey) return;

    const config = GRAYLIST_FILTERS[matchedKey];
    let css = `/* ═══ Pure Path: Graylist enforcement for ${matchedKey} ═══ */\n`;

    if (config.hideUI) {
      css += `${config.hideUI} { ${NUKE_DECL} }\n`;
    }
    if (config.hideContent) {
      css += `${config.hideContent} { ${NUKE_DECL} }\n`;
    }
    if (config.rawCSS) {
      css += config.rawCSS + '\n';
    }

    if (css.length < 80) return; // Only the comment — nothing to inject

    const style = document.createElement('style');
    style.id = 'pure-path-graylist-lock';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    if (config.hideUI) {
      setupCheekyClickDetection(config.hideUI);
    }

    console.log(`🔒 Pure Path: Graylist filters enforced on ${matchedKey}`);
  }

  // ── SHARED DOM UTILITIES ─────────────────────────────────────────
  function querySelectorAllDeep(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));
    const allEls = root.querySelectorAll('*');
    for (const el of allEls) {
      if (el.shadowRoot) {
        results.push(...querySelectorAllDeep(selector, el.shadowRoot));
      }
    }
    return results;
  }

  function getAllShadowRoots(root = document) {
    const roots = [];
    const allEls = root.querySelectorAll('*');
    for (const el of allEls) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        roots.push(...getAllShadowRoots(el.shadowRoot));
      }
    }
    return roots;
  }

  // ── CHEEKY CLICK DETECTION ──────────────────────────────────────
  // Places invisible overlay divs on top of hidden NSFW toggle areas
  // so that clicking where the toggle WOULD be triggers the popup.

  function setupCheekyClickDetection(uiSelectors) {
    const selectorList = uiSelectors
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('/*'));

    // Validate selectors once upfront — drop invalid ones
    const validSelectors = [];
    for (const sel of selectorList) {
      try { document.querySelector(sel); validSelectors.push(sel); } catch (_) {}
    }
    if (validSelectors.length === 0) return;

    function scanAndIntercept() {
      for (const sel of validSelectors) {
        try {
          const elements = querySelectorAllDeep(sel);
          for (const el of elements) {
            if (el.dataset.purePathIntercepted) continue;
            el.dataset.purePathIntercepted = 'true';

            // Strategy: listen on the parent for clicks in the area where the
            // hidden element lives.  Since the element itself is display:none,
            // clicks can never target it — so instead we intercept ALL clicks
            // on the parent container while on a settings-like page.
            const parent = el.parentElement;
            if (parent && !parent.dataset.purePathWatch) {
              parent.dataset.purePathWatch = 'true';
              parent.addEventListener('click', (e) => {
                if (!e.isTrusted) return;
                // If the hidden element is still display:none, the click
                // must have hit the parent area — trigger the popup.
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') {
                  e.preventDefault();
                  e.stopPropagation();
                  showCheekyPopup();
                  return;
                }
                // Fallback: direct hit on the element
                if (el.contains(e.target) || e.target === el) {
                  e.preventDefault();
                  e.stopPropagation();
                  showCheekyPopup();
                }
              }, true);
            }
          }
        } catch (_) {}
      }
    }

    // Initial scan
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scanAndIntercept);
    } else {
      scanAndIntercept();
    }

    // Re-scan periodically for SPA-injected elements
    setInterval(scanAndIntercept, 800);

    // Global settings-page keyword click listener
    document.addEventListener('click', (e) => {
      const currentPath = window.location.pathname.toLowerCase();
      const isSettingsPage = ['settings', 'preferences', 'filter', 'privacy', 'safety', 'moderation']
        .some(s => currentPath.includes(s));
      if (!isSettingsPage) return;

      const clickedText = (e.target.textContent || '').toLowerCase();
      const filterKeywords = ['nsfw', 'mature', 'adult', 'explicit', 'sensitive', 'r-18', 'r18', '18+', 'content filter', 'family filter'];
      if (filterKeywords.some(kw => clickedText.includes(kw))) {
        showCheekyPopup();
      }
    }, true);
  }

  // ============================================================================
  // SPA URL MONITORING (delegates URL checking to background.js)
  // ============================================================================
  
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
    // Re-inject if the style was removed (SPA full re-render)
    if (!document.getElementById('pure-path-graylist-lock')) {
      injectGraylistFilterCSS();
    }
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
  
  // ============================================================================
  // SHADOW DOM ENFORCEMENT + SITE-SPECIFIC TOGGLE ENFORCEMENT
  // Runs independently of click detection — ensures CSS is injected into all
  // shadow roots and that NSFW toggles are always forced to safe state.
  // ============================================================================

  function enforceShadowDOM() {
    const cssElement = document.getElementById('pure-path-graylist-lock');
    if (cssElement) {
      const cssText = cssElement.textContent;

      // Create a reusable stylesheet for shadow DOMs
      if (!window._purePathSheet) {
        try {
          window._purePathSheet = new CSSStyleSheet();
          window._purePathSheet.replaceSync(cssText);
        } catch (e) {
          window._purePathSheet = 'fallback'; // For very old browsers
        }
      }

      const shadowRoots = getAllShadowRoots();
      for (const sr of shadowRoots) {
        if (!sr._purePathInjected) {
          sr._purePathInjected = true;
          if (window._purePathSheet !== 'fallback') {
            sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, window._purePathSheet];
          } else if (!sr.getElementById('pure-path-graylist-lock')) {
            const style = document.createElement('style');
            style.id = 'pure-path-graylist-lock';
            style.textContent = cssText;
            sr.appendChild(style);
          }
        }
      }
    }

    // ── REDDIT TOGGLE ENFORCEMENT ──────────────────────────────────────
    if (matchGraylistDomain() === 'reddit.com') {
      enforceRedditToggles();
    }

    // ── X / TWITTER TOGGLE ENFORCEMENT ─────────────────────────────────
    const xDomain = matchGraylistDomain();
    if (xDomain === 'x.com' || xDomain === 'twitter.com') {
      enforceTwitterToggles();
    }

    // ── NEWGROUNDS RATING ENFORCEMENT ──────────────────────────────────
    if (matchGraylistDomain() === 'newgrounds.com') {
      enforceNewgroundsRatings();
    }
  }

  // ── REDDIT: Force all NSFW toggles to safe state ──────────────────
  function enforceRedditToggles() {
    // Auto-confirm the "Mark as safe" modal
    const nsfwModals = querySelectorAllDeep('rpl-modal-card#nsfw-rpl-modal-card');
    for (const modalWrapper of nsfwModals) {
      const checkbox = querySelectorAllDeep('faceplate-checkbox-input', modalWrapper)[0];
      if (checkbox && !checkbox.hasAttribute('checked') && checkbox.getAttribute('aria-checked') !== 'true') {
        checkbox.click();
      }
      const confirmBtn = querySelectorAllDeep('button[slot="primary-button"]', modalWrapper)[0];
      if (confirmBtn && !confirmBtn.hasAttribute('disabled')) {
        confirmBtn.click();
      }
    }

    // Force NSFW toggles OFF — check actual state every cycle, not a flag
    const togglesToDisable = [
      '[data-testid="is-nsfw-shown"] faceplate-switch-input',
      '[data-testid="nsfw-posts-and-comments"] faceplate-switch-input',
      '[data-testid="is-nsfw"] faceplate-switch-input',
      '[data-testid="feed-settings-mature"] input',
      'input[name*="mature"]'
    ];
    for (const sel of togglesToDisable) {
      const els = querySelectorAllDeep(sel);
      for (const el of els) {
        if (el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true' || el.checked) {
          console.log("🔒 Pure Path: Forcing filter off.");
          el.click();
        }
      }
    }

    // Safe browsing mode (Blur images) should be ON
    const blurToggles = querySelectorAllDeep('[data-testid="safe-browsing-mode"] faceplate-switch-input');
    for (const el of blurToggles) {
      if (!el.hasAttribute('checked') && el.getAttribute('aria-checked') !== 'true') {
        console.log("🔒 Pure Path: Forcing blur on.");
        el.click();
      }
    }
  }

  // ── X/TWITTER: Force sensitive content toggles to safe state ──────
  function enforceTwitterToggles() {
    // 1. Force-UNCHECK "Display media that may contain sensitive content"
    const sensitiveCheckbox = document.querySelector('input[type="checkbox"][aria-describedby="CHECKBOX_2_LABEL"]');
    if (sensitiveCheckbox && sensitiveCheckbox.checked) {
      console.log('🔒 Pure Path: Forcing X "Display sensitive media" OFF.');
      sensitiveCheckbox.click();
    }

    // 2. Force-CHECK "Hide sensitive content" in Search Settings dialog
    const searchDialogs = document.querySelectorAll('div[role="dialog"]');
    for (const dialog of searchDialogs) {
      const heading = dialog.querySelector('h2');
      if (!heading || !heading.textContent.includes('Search settings')) continue;
      const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');
      for (const cb of checkboxes) {
        const labelText = cb.closest('label')?.textContent || '';
        if (labelText.includes('Hide sensitive content') && !cb.checked) {
          console.log('🔒 Pure Path: Forcing X "Hide sensitive content" ON.');
          cb.click();
        }
      }
    }

    // 3. Force-close any open Search/Explore settings dialogs
    for (const dialog of searchDialogs) {
      const closeBtn = dialog.querySelector('button[aria-label="Close"]') || dialog.querySelector('[data-testid="app-bar-close"]');
      if (closeBtn && !dialog.dataset.purePathClosed) {
        dialog.dataset.purePathClosed = 'true';
        setTimeout(() => closeBtn.click(), 200);
      }
    }
  }

  // ── NEWGROUNDS: Force A-rating checkbox to unchecked ──────────────
  function enforceNewgroundsRatings() {
    // Uncheck any "A" rating checkboxes that are checked
    const aRatingInputs = document.querySelectorAll(
      'input.suitable-a, input[value="a"][name*="suitabilit"], input[name*="rating_a"], input[name*="rating"][value="a"]'
    );
    for (const input of aRatingInputs) {
      if (input.checked) {
        console.log('🔒 Pure Path: Forcing Newgrounds A-rating OFF.');
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  // ============================================================================
  // NEWGROUNDS "CONTENT FILTERED" BYPASS BLOCKER
  // Detects the "show it to me anyway" page and immediately redirects to blocked.html.
  // Runs at the TOP LEVEL so it fires before anything else on the page.
  // ============================================================================

  function blockNewgroundsBypassPage() {
    if (matchGraylistDomain() !== 'newgrounds.com') return;
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

  function initContentScript() {
    // FIRST: check for Newgrounds bypass page before doing anything else
    blockNewgroundsBypassPage();

    if (isSearchEngine) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideSafeSearchUI);
      } else {
        hideSafeSearchUI();
      }
    }

    // Only run graylist logic if this domain is actually in the map
    if (matchGraylistDomain()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectGraylistFilterCSS);
      } else {
        injectGraylistFilterCSS();
      }

      // Start the enforcement loop for shadow DOM + toggle enforcement
      // Runs independently of cheeky click detection
      const startEnforcement = () => {
        enforceShadowDOM();
        setInterval(enforceShadowDOM, 800);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEnforcement);
      } else {
        startEnforcement();
      }
    }
    
    setupSpaMonitoring();
  }
  
  initContentScript();
})();

