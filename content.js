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
    'porn', 'sex', 'nude', 'xxx', 'adult', 'nsfw', 'hentai'
  ].map(w => ({ word: w, regex: buildWordBoundaryRegex(w) }));
  
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
      document.addEventListener('DOMContentLoaded', checkPageContent);
    } else {
      checkPageContent();
    }
    
    // Set up SPA navigation monitoring
    setupSpaMonitoring();
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
    // Don't leak the original URL in the blocked page query params
    const blockedUrl = chrome.runtime.getURL('blocked.html') + 
      `?reason=${reason}&match=${encodeURIComponent(match)}`;
    window.location.replace(blockedUrl);
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
  // onHistoryStateUpdated listener are sufficient coverage.
  
  // Start the content script
  initContentScript();
})();
