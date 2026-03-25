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
  
  // Whitelist of domains to never check content (except search queries)
  // IMPORTANT: Only truly safe domains go here — NOT graylist domains
  // Graylist domains (reddit, twitter, youtube, etc.) need content monitoring
  const WHITELIST_DOMAINS = [
    'github.com',
    'stackoverflow.com',
    'linkedin.com',
    'microsoft.com',
    'openai.com',
    'anthropic.com',
    'claude.ai',
    'chatgpt.com',
    'wikipedia.org',
    'khanacademy.org',
    'coursera.org'
  ];
  
  // Search engines - we check these for NSFW queries
  const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com'];
  
  // Check if current domain is a search engine
  const hostname = window.location.hostname.toLowerCase();
  const isSearchEngine = SEARCH_ENGINES.some(se => 
    hostname === se || hostname.endsWith('.' + se)
  );
  
  // Check if current domain is whitelisted (and not a search engine)
  if (!isSearchEngine) {
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        return; // Don't check content on whitelisted domains
      }
    }
  }
  
  // Check page content for blocked keywords
  function checkPageContent() {
    const title = document.title || '';
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent)
      .join(' ');
    
    const textContent = (title + ' ' + metaDescription + ' ' + headings).toLowerCase();
    
    // Check for explicit NSFW patterns
    const explicitPatterns = [
      'free porn', 'porn videos', 'sex videos', 'nude videos',
      'adult videos', 'xxx videos', 'porn site', 'sex site',
      'adult site', 'hentai site', 'porn hub', 'sex tube', 'xxx tube'
    ];
    
    for (const pattern of explicitPatterns) {
      if (textContent.includes(pattern)) {
        blockPage('keyword_content', pattern);
        return;
      }
    }
    
    // Check for multiple NSFW indicators
    const nsfwIndicators = ['porn', 'sex', 'nude', 'xxx', 'adult', 'nsfw', 'hentai'];
    let indicatorCount = 0;
    let foundIndicators = [];
    
    for (const indicator of nsfwIndicators) {
      if (textContent.includes(indicator)) {
        indicatorCount++;
        foundIndicators.push(indicator);
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
  
  // Run check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPageContent);
  } else {
    checkPageContent();
  }
  
  // ============================================================================
  // SPA URL MONITORING (for sites like Reddit that use client-side routing)
  // ============================================================================
  
  let lastUrl = window.location.href;
  
  async function checkCurrentUrl() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'checkUrl',
        url: currentUrl
      });
      
      if (response && response.blocked) {
        const blockedUrl = chrome.runtime.getURL('blocked.html') + 
          `?reason=${response.reason}&match=${encodeURIComponent(response.match)}`;
        window.location.replace(blockedUrl);
      }
    } catch (error) {
      // Silently handle — background script may have restarted
    }
  }
  
  // Method 1: Listen for popstate events (back/forward navigation)
  window.addEventListener('popstate', checkCurrentUrl);
  
  // Method 2: Intercept pushState and replaceState (SPA navigation)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    checkCurrentUrl();
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    checkCurrentUrl();
  };
  
  // No polling interval — pushState/popstate hooks + background.js
  // onHistoryStateUpdated listener are sufficient coverage.
  
  // Check URL immediately on script load
  checkCurrentUrl();
})();
