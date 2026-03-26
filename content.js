// Content script for Pure Path
(function() {
  'use strict';
  
  // Don't run on extension pages or chrome URLs
  if (window.location.protocol === 'chrome-extension:' || 
      window.location.protocol === 'chrome:' ||
      window.location.protocol === 'about:' ||
      window.location.protocol === 'edge:') {
    return;
  }
  
  // Search engines - we check these for NSFW queries
  const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'];
  
  // Check if current domain is a search engine
  const hostname = window.location.hostname.toLowerCase();
  const isSearchEngine = SEARCH_ENGINES.some(se => 
    hostname === se || hostname.endsWith('.' + se)
  );
  
  // ============================================================================
  // GRAYLIST DOMAINS — need special DOM-based NSFW tag detection
  // ============================================================================
  
  const GRAYLIST_DOMAINS = [
    'reddit.com', 'discord.com', 'twitter.com', 'x.com',
    'tumblr.com', 'newgrounds.com', 'deviantart.com',
    'instagram.com', 'facebook.com', 'pinterest.com',
    'imgur.com', 'twitch.tv', 'youtube.com',
    'tiktok.com', 'snapchat.com', 'telegram.org', 'web.telegram.org',
    'mastodon.social', 'bsky.app', 'flickr.com', 'vimeo.com',
    'dailymotion.com', 'soundcloud.com', 'patreon.com',
    'ko-fi.com', 'gumroad.com', 'itch.io',
    'artstation.com', 'pixiv.net', 'furaffinity.net'
  ];
  
  const isGraylist = GRAYLIST_DOMAINS.some(d => 
    hostname === d || hostname.endsWith('.' + d)
  );
  
  // ============================================================================
  // PRE-COMPILED WORD-BOUNDARY REGEX FOR CONTENT SCANNING (Section B)
  // Built once per page load, not per-check. Uses lookbehind/lookahead
  // instead of \b to avoid false positives (e.g. 'sex' in 'Middlesex').
  // ============================================================================
  
  function buildWordBoundaryRegex(keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i');
  }
  
  // Explicit multi-word patterns (always block on first match)
  const EXPLICIT_PATTERNS = [
    'free porn', 'porn videos', 'sex videos', 'nude videos',
    'adult videos', 'xxx videos', 'porn site', 'sex site',
    'adult site', 'hentai site', 'porn hub', 'sex tube', 'xxx tube'
  ].map(p => ({ pattern: p, regex: buildWordBoundaryRegex(p) }));
  
  // Single-word NSFW indicators (block if 3+ found — word-boundary protected)
  const NSFW_INDICATORS = [
    'porn', 'sex', 'nude', 'xxx', 'adult', 'nsfw', 'hentai', 'ecchi'
  ].map(w => ({ word: w, regex: buildWordBoundaryRegex(w) }));
  
  // ============================================================================
  // PLATFORM-SPECIFIC NSFW TAG DETECTION (Section H)
  // Detects built-in NSFW indicators on graylist platforms.
  // Each platform has its own DOM patterns for marking content as NSFW/18+.
  // If enough NSFW tags are detected, the page is blocked.
  // ============================================================================
  
  // NSFW tag threshold — block if this many or more NSFW indicators are found
  const NSFW_TAG_THRESHOLD = 1;

  const PLATFORM_NSFW_DETECTORS = {
    // -----------------------------------------------------------------------
    // REDDIT — detects NSFW badge, 18+ tags, mature content warnings
    // Reddit uses multiple indicators: the "NSFW" flair tag, the 18+ icon,
    // age-gate overlays, and specific class names for NSFW content.
    // -----------------------------------------------------------------------
    'reddit.com': {
      selectors: [
        // New Reddit (shreddit web components)
        'shreddit-subreddit-header-nsfw-indicator',     // NSFW pill on subreddit header
        '[slot="nsfw-badge"]',                           // NSFW badge slot
        'faceplate-tracker[noun="nsfw_badge"]',          // Tracked NSFW badge
        
        // Old & New Reddit shared
        '[data-testid="subreddit-nsfw-indicator"]',      // Test-ID NSFW indicator
        '.icon-nsfw',                                     // NSFW icon class
        '.nsfw-stamp',                                    // NSFW stamp
        
        // Community label / age-gate
        '.community-nsfw-indicator',                      // Community NSFW marker
        '[aria-label="NSFW"]',                            // Accessibility NSFW label
        
        // Post-level NSFW flairs
        '.Post [data-click-id="nsfw_badge"]',             // NSFW badge on posts
        'span.nsfw-badge',                                // Generic NSFW badge span
      ],
      // Text patterns to look for in visible elements
      textPatterns: ['NSFW', '18+', 'Over 18', 'over18', 'This community is NSFW'],
      // Check the page title for NSFW indicators
      titlePatterns: ['NSFW', 'nsfw', '18+'],
    },

    // -----------------------------------------------------------------------
    // TWITTER / X — sensitive content warnings
    // -----------------------------------------------------------------------
    'twitter.com': {
      selectors: [
        '[data-testid="sensitiveMediaWarning"]',
        '[aria-label="Sensitive content"]',
      ],
      textPatterns: ['Sensitive content', 'This media may contain sensitive material'],
      titlePatterns: [],
    },
    'x.com': {
      selectors: [
        '[data-testid="sensitiveMediaWarning"]',
        '[aria-label="Sensitive content"]',
      ],
      textPatterns: ['Sensitive content', 'This media may contain sensitive material'],
      titlePatterns: [],
    },

    // -----------------------------------------------------------------------
    // TUMBLR — mature content flags
    // -----------------------------------------------------------------------
    'tumblr.com': {
      selectors: [
        '.mature-content',
        '[data-mature="true"]',
        '.community-label-cover',
      ],
      textPatterns: ['This Tumblr may contain sensitive media', 'mature content'],
      titlePatterns: [],
    },

    // -----------------------------------------------------------------------
    // DEVIANTART — mature content tag
    // -----------------------------------------------------------------------
    'deviantart.com': {
      selectors: [
        '.mature-content-warning',
        '[data-hook="mature_warning"]',
      ],
      textPatterns: ['Mature Content', 'This deviation contains mature content'],
      titlePatterns: [],
    },

    // -----------------------------------------------------------------------
    // IMGUR — mature / NSFW tags
    // -----------------------------------------------------------------------
    'imgur.com': {
      selectors: [
        '.post-nsfw',
        '.mature-gate',
        '[data-mature="true"]',
      ],
      textPatterns: ['This post may contain erotic', 'NSFW', 'Mature'],
      titlePatterns: ['NSFW', 'nsfw'],
    },

    // -----------------------------------------------------------------------
    // PIXIV — R-18 tags
    // -----------------------------------------------------------------------
    'pixiv.net': {
      selectors: [
        '[title="R-18"]',
        '[title="R-18G"]',
        '.r-18',
        '.sensored',
      ],
      textPatterns: ['R-18', 'R-18G'],
      titlePatterns: ['R-18'],
    },

    // -----------------------------------------------------------------------
    // DISCORD — NSFW channel indicators (web app)
    // -----------------------------------------------------------------------
    'discord.com': {
      selectors: [
        '[aria-label*="NSFW"]',
        '.channelNsfw',
        '#nsfwGate',
      ],
      textPatterns: ['NSFW channel', 'Age-restricted channel', 'This channel is NSFW'],
      titlePatterns: ['NSFW'],
    },

    // -----------------------------------------------------------------------
    // NEWGROUNDS — adult/mature flags
    // -----------------------------------------------------------------------
    'newgrounds.com': {
      selectors: [
        '.mature-content-warning',
        '#mature_warning',
      ],
      textPatterns: ['Adult Content', 'Mature Content', 'This submission contains Adult'],
      titlePatterns: [],
    },

    // -----------------------------------------------------------------------
    // PATREON — NSFW creator tags
    // -----------------------------------------------------------------------
    'patreon.com': {
      selectors: [
        '[data-tag="nsfw"]',
        '.nsfw-warning',
      ],
      textPatterns: ['18+', 'NSFW', 'adult content', 'This page may contain sensitive'],
      titlePatterns: ['NSFW', '18+'],
    },
    
    // -----------------------------------------------------------------------
    // FURAFFINITY — mature/adult ratings
    // -----------------------------------------------------------------------
    'furaffinity.net': {
      selectors: [
        '.rating-box.adult',
        '.rating-box.mature',
        '[alt="Adult rating"]',
        '[alt="Mature rating"]',
      ],
      textPatterns: ['Adult rating', 'Mature rating'],
      titlePatterns: [],
    },
  };
  
  // Check platform NSFW tags on graylist domains
  function checkPlatformNsfwTags() {
    if (!isGraylist) return false;
    
    // Find matching detector for this domain
    let detector = null;
    for (const [domain, det] of Object.entries(PLATFORM_NSFW_DETECTORS)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        detector = det;
        break;
      }
    }
    
    let nsfwSignals = 0;
    let matchedSignals = [];
    
    // ----- 1. Check page title for NSFW indicators -----
    const pageTitle = (document.title || '').toLowerCase();
    
    if (detector && detector.titlePatterns) {
      for (const pattern of detector.titlePatterns) {
        if (pageTitle.includes(pattern.toLowerCase())) {
          nsfwSignals++;
          matchedSignals.push(`title:${pattern}`);
        }
      }
    }
    
    // ----- 2. URL path keyword check (subreddit names, etc.) -----
    const pathname = window.location.pathname.toLowerCase();
    const nsfwPathWords = ['nsfw', 'porn', 'xxx', 'hentai', 'nude', 'sex', 'adult', 'gonewild', 'rule34'];
    for (const word of nsfwPathWords) {
      if (pathname.includes(word)) {
        nsfwSignals += 2; // URL-level signals are strong
        matchedSignals.push(`path:${word}`);
      }
    }
    
    // ----- 3. INTERNAL SEARCH QUERY DETECTION -----
    // Graylist platforms have their own search. Check query params for NSFW terms.
    // This catches reddit.com/search/?q=nsfw, twitter.com/search?q=porn, etc.
    const INTERNAL_SEARCH_PARAMS = {
      'reddit.com':      'q',
      'twitter.com':     'q',
      'x.com':           'q',
      'tumblr.com':      'q',
      'youtube.com':     'search_query',
      'dailymotion.com': 'query',
      'vimeo.com':       'q',
      'flickr.com':      'text',
      'deviantart.com':  'q',
      'pinterest.com':   'q',
      'tiktok.com':      'q',
      'soundcloud.com':  'q',
      'imgur.com':       'q',
      'pixiv.net':       'word',
      'itch.io':         'q',
    };
    
    try {
      const urlParams = new URLSearchParams(window.location.search);
      for (const [domain, param] of Object.entries(INTERNAL_SEARCH_PARAMS)) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          const query = (urlParams.get(param) || '').toLowerCase();
          if (query) {
            // Check if the search query itself contains NSFW terms
            // Split into hard (block immediately) and soft (force SafeSearch)
            const hardSearchTerms = [
              'porn', 'xxx', 'hentai', 'dick', 'cock', 'fuck', 'blowjob',
              'cumshot', 'creampie', 'camgirl', 'ecchi'
            ];
            const softSearchTerms = [
              'nsfw', 'nude', 'nudes', 'sex', 'adult', 'gonewild', 'rule34', 'r34',
              'onlyfans', 'boobs', 'tits', 'ass', 'pussy', 'naked', 'topless',
              'erotic', 'milf', 'bondage', 'fetish', 'stripper', 'escort'
            ];
            
            for (const term of hardSearchTerms) {
              const regex = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i');
              if (regex.test(query)) {
                nsfwSignals += 3; // Hard term = block
                matchedSignals.push(`search:hard=${term}`);
              }
            }
            
            for (const term of softSearchTerms) {
              const regex = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i');
              if (regex.test(query)) {
                // Soft term -> Force "Safe Search" by hiding all NSFW elements via CSS
                forceGraylistSafeSearch(detector);
              }
            }
          }
          break;
        }
      }
    } catch (e) { /* URLSearchParams not available or malformed URL */ }
    
    // ----- 4. Check platform-specific DOM selectors -----
    if (detector && detector.selectors) {
      for (const selector of detector.selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            nsfwSignals += elements.length;
            matchedSignals.push(`selector:${selector}(x${elements.length})`);
          }
        } catch (e) {
          // Invalid selector — skip
        }
      }
    }
    
    // ----- 5. Scan visible text for NSFW text patterns -----
    if (detector && detector.textPatterns) {
      // Efficiently scan a limited DOM region (headers, labels, badges — not full body)
      const scanTargets = document.querySelectorAll(
        'h1, h2, h3, h4, [role="heading"], [role="banner"], ' +
        '[class*="badge"], [class*="tag"], [class*="flair"], [class*="label"], ' +
        '[class*="nsfw"], [class*="NSFW"], [class*="mature"], [class*="adult"], ' +
        '[data-testid], [aria-label], header, nav, .sidebar, aside'
      );
      
      const scannedText = Array.from(scanTargets)
        .map(el => (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))
        .join(' ');
      
      for (const pattern of detector.textPatterns) {
        if (scannedText.includes(pattern)) {
          nsfwSignals++;
          matchedSignals.push(`text:${pattern}`);
        }
      }
    }
    
    // ----- 6. NSFW CONTENT DENSITY DETECTION -----
    // Count how many posts/items on the page are tagged NSFW.
    // If the feed has 5+ NSFW-tagged items, the page is clearly NSFW content.
    const NSFW_ITEM_SELECTORS = [
      // Reddit — post-level NSFW flairs and spoiler overlays
      'faceplate-tracker[noun="nsfw_badge"]',
      '[data-click-id="nsfw_badge"]',
      'span.nsfw-badge',
      '[slot="nsfw-badge"]',
      // Reddit "View spoiler" overlays on NSFW thumbnails
      'button[aria-label="View spoiler"]',
      '[data-click-id="media_spoiler"]',
      // Reddit shreddit NSFW indicators on posts
      'shreddit-post[nsfw]',
      'shreddit-post[is-nsfw]',
      // Generic — elements containing "NSFW" text in class or data attributes
      '[class*="nsfw-tag"]',
      '[class*="nsfw-flair"]',
      '[data-nsfw="true"]',
      '[data-mature="true"]',
      // Tumblr
      '.community-label-cover',
      // Twitter/X sensitive media
      '[data-testid="sensitiveMediaWarning"]',
    ];
    
    let nsfwItemCount = 0;
    for (const selector of NSFW_ITEM_SELECTORS) {
      try {
        nsfwItemCount += document.querySelectorAll(selector).length;
      } catch (e) { /* skip invalid selectors */ }
    }
    
    // Also count elements whose visible text is exactly "NSFW" (case-insensitive)
    // This catches Reddit's NSFW text badges that don't have specific selectors
    try {
      const allSmallText = document.querySelectorAll(
        'span, div, p, label, a, faceplate-tracker'
      );
      for (const el of allSmallText) {
        const text = (el.textContent || '').trim();
        // Exact match "NSFW" or "nsfw" (not substring of longer text)
        if (text === 'NSFW' || text === 'nsfw') {
          nsfwItemCount++;
        }
      }
    } catch (e) { /* skip */ }
    
    if (nsfwItemCount >= 5) {
      nsfwSignals += nsfwItemCount;
      matchedSignals.push(`density:${nsfwItemCount}_nsfw_items`);
    } else if (nsfwItemCount >= 2) {
      nsfwSignals += nsfwItemCount;
      matchedSignals.push(`density:${nsfwItemCount}_nsfw_items`);
    }
    
    // ----- 7. Generic NSFW meta tag detection (works on any graylist) -----
    const metaRating = document.querySelector('meta[name="rating"]')?.content?.toLowerCase();
    if (metaRating && (metaRating === 'adult' || metaRating === 'mature' || metaRating === 'rta-5042-1996-1400-1577-0')) {
      nsfwSignals += 3; // Meta rating is strong signal
      matchedSignals.push(`meta:rating=${metaRating}`);
    }
    
    // ----- 8. Check for age verification / NSFW consent gates -----
    const ageGateSelectors = [
      '#age-gate', '#nsfw-gate', '.age-gate', '.nsfw-gate',
      '[data-testid="age-gate"]', '.over-18-modal', '.mature-gate'
    ];
    for (const selector of ageGateSelectors) {
      try {
        if (document.querySelector(selector)) {
          nsfwSignals += 3; // Age gates are strong signals
          matchedSignals.push(`agegate:${selector}`);
        }
      } catch (e) { /* skip */ }
    }

    // ----- Decision: block if threshold met -----
    if (nsfwSignals >= NSFW_TAG_THRESHOLD) {
      console.log(`🚫 Pure Path: NSFW tags detected (${nsfwSignals} signals): ${matchedSignals.join(', ')}`);
      blockPage('graylist_nsfw_tags', matchedSignals.slice(0, 3).join(', '));
      return true;
    }
    
    return false;
  }
  
  // ============================================================================
  // UNIFIED WHITELIST CHECK (Section C)
  // Delegates to background.js — single source of truth for whitelisted domains.
  // ============================================================================
  
  function initContentScript() {
    // If it's a search engine, always run content checks (for NSFW query detection)
    if (isSearchEngine) {
      runContentChecks();
      return;
    }
    
    // Ask background if this domain is safe (whitelist check)
    try {
      chrome.runtime.sendMessage({ action: 'isDomainSafe', hostname }, (response) => {
        if (chrome.runtime.lastError) {
          // Background may be sleeping — run checks as fallback
          runContentChecks();
          return;
        }
        if (response && response.safe) {
          return; // Whitelisted — don't scan content
        }
        runContentChecks();
      });
    } catch (error) {
      // Extension context invalidated — silently exit
    }
  }
  
  function runContentChecks() {
    // Check page content when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        checkPageContent();
        // Run graylist NSFW tag check after initial DOM load
        if (isGraylist) {
          setTimeout(checkPlatformNsfwTags, 500);
        }
      });
    } else {
      checkPageContent();
      // Run graylist NSFW tag check
      if (isGraylist) {
        setTimeout(checkPlatformNsfwTags, 500);
      }
    }
    
    // ALWAYS hide SafeSearch UI on search engines (user cannot toggle it off)
    if (isSearchEngine) {
      hideSafeSearchUI();
    }
    
    // Set up SPA navigation monitoring
    setupSpaMonitoring();
    
    // For graylist sites: set up a MutationObserver to catch dynamically loaded
    // NSFW indicators (e.g. Reddit loads content after initial page load)
    if (isGraylist) {
      setupGraylistObserver();
    }
  }
  
  // ============================================================================
  // GRAYLIST MUTATION OBSERVER
  // Watches for dynamically added NSFW indicators on SPA graylist sites.
  // Uses a debounced approach to avoid excessive checks.
  // ============================================================================
  
  let observerDebounceTimer = null;
  let observerCheckCount = 0;
  const MAX_OBSERVER_CHECKS = 20; // Stop observing after 20 checks to save CPU
  
  function setupGraylistObserver() {
    const observer = new MutationObserver((mutations) => {
      if (observerCheckCount >= MAX_OBSERVER_CHECKS) {
        observer.disconnect();
        return;
      }
      
      // Debounce: wait 300ms after last mutation before checking
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(() => {
        observerCheckCount++;
        checkPlatformNsfwTags();
      }, 300);
    });
    
    // Observe only subtree additions (not attribute changes) for performance
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  
  // ============================================================================
  // PAGE CONTENT SCANNING — word-boundary protected (Section B)
  // ============================================================================
  
  function checkPageContent() {
    const title = document.title || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent)
      .join(' ');
    
    const textContent = title + ' ' + metaDescription + ' ' + headings;
    
    // Check for explicit NSFW patterns (multi-word — low false positive risk)
    for (const { pattern, regex } of EXPLICIT_PATTERNS) {
      if (regex.test(textContent)) {
        blockPage('keyword_content', pattern);
        return;
      }
    }
    
    // Check for multiple NSFW indicators (word-boundary protected)
    let indicatorCount = 0;
    let foundIndicators = [];
    
    for (const { word, regex } of NSFW_INDICATORS) {
      if (regex.test(textContent)) {
        indicatorCount++;
        foundIndicators.push(word);
      }
    }
    
    // Block if 3 or more NSFW indicators in content
    if (indicatorCount >= 3) {
      blockPage('keyword_content', foundIndicators.join(', '));
    }
  }
  
  function blockPage(reason, match) {
    // Delegate to background script — it handles stats + redirect (Section G fixed)
    try {
      chrome.runtime.sendMessage({
        action: 'notifyBlock',
        url: window.location.href,
        reason: reason,
        match: match
      });
    } catch (error) {
      // Fallback if background is unavailable
      const blockedUrl = chrome.runtime.getURL('blocked.html') + 
        `?reason=${reason}&match=${encodeURIComponent(match)}`;
      window.location.replace(blockedUrl);
    }
  }
  
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
      /* SafeSearch button/toggle in search settings */
      #base_safesearch_button,
      [data-safesearch-toggle],
      [jscontroller][data-safesearch],
      /* SafeSearch menu items */
      g-menu-item:has([data-safesearch]),
      /* Search settings link that leads to SafeSearch config page */
      a[href*="safesearch"],
      /* Google settings gear -> SafeSearch option */
      [data-a11y-title*="SafeSearch"],
      [aria-label*="SafeSearch"],
      /* Google Images/Video SafeSearch controls */
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
  // GRAYLIST SAFESEARCH ENFORCEMENT
  // ============================================================================
  
  function forceGraylistSafeSearch(detector) {
    if (document.getElementById('pure-path-graylist-safesearch')) return;
    
    let css = '';
    
    // Hide parent containers of any NSFW indicator
    if (detector && detector.selectors && detector.selectors.length > 0) {
      const selectors = detector.selectors.join(', ');
      css += `
        /* Hide post containers if they contain an NSFW indicator inside */
        article:has(${selectors}), 
        div:has(> ${selectors}),
        .Post:has(${selectors}),
        shreddit-post:has(${selectors}),
        [data-testid="post-container"]:has(${selectors}),
        /* Tumblr/Twitter specific */
        [data-testid="cellInnerDiv"]:has(${selectors}),
        .y7Mrt:has(${selectors}) {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          position: absolute !important;
        }
      `;
    }
    
    // Hide UI toggles for Safe Search on graylist platforms
    css += `
      shreddit-async-loader[bundlename="safe_search_toggle"],
      #safe-search-toggle,
      [aria-label="Search settings"],
      [data-testid="safe_search_toggle"] {
        display: none !important;
      }
    `;
    
    const style = document.createElement('style');
    style.id = 'pure-path-graylist-safesearch';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    console.log('🔒 Pure Path: Graylist SafeSearch locked for soft query.');
  }
  
  // ============================================================================
  // SPA URL MONITORING (for sites like Reddit that use client-side routing)
  // ============================================================================
  
  let lastUrl = window.location.href;
  
  function setupSpaMonitoring() {
    // Method 1: Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', onSpaNavigation);
    
    // Method 2: Intercept pushState and replaceState (SPA navigation)
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
    
    // Check URL immediately on script load
    checkCurrentUrl();
  }
  
  function onSpaNavigation() {
    checkCurrentUrl();
    // Re-scan page content after SPA nav with delay for DOM to update (Section E)
    setTimeout(checkPageContent, 800);
    // Re-check platform NSFW tags on graylist after SPA nav
    if (isGraylist) {
      // Reset observer check count on new navigation
      observerCheckCount = 0;
      setTimeout(checkPlatformNsfwTags, 1000);
    }
  }
  
  async function checkCurrentUrl() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    
    try {
      // Delegate to background's handleBlock via checkUrl message (Section G)
      // handleBlock deduplicates and handles stats + redirect
      await chrome.runtime.sendMessage({
        action: 'checkUrl',
        url: currentUrl
      });
    } catch (error) {
      // Silently handle — background script may have restarted
    }
  }
  
  // No polling interval — pushState/popstate hooks + background.js
  // onHistoryStateUpdated listener + MutationObserver are sufficient coverage.
  
  // Start the content script
  initContentScript();
})();
