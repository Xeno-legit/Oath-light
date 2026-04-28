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
  // SPA URL MONITORING (delegates URL checking to background.js)
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
  }
  
  async function checkCurrentUrl() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    
    try {
      // Delegate to background's handleBlock via checkUrl message
      await chrome.runtime.sendMessage({
        action: 'checkUrl',
        url: currentUrl
      });
    } catch (error) {
      // Silently handle — background script may have restarted
    }
  }
  
  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  function initContentScript() {
    // ALWAYS hide SafeSearch UI on search engines (user cannot toggle it off)
    if (isSearchEngine) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideSafeSearchUI);
      } else {
        hideSafeSearchUI();
      }
    }
    
    // Set up SPA navigation monitoring (delegates to background for domain checks)
    setupSpaMonitoring();
  }
  
  // Start the content script
  initContentScript();
})();
