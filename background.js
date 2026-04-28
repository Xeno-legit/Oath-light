// Background service worker for Pure Path
let isExtensionEnabled = true;
let passwordHash = null;
let blocklistDomains = [];
let blocklistSet = new Set(); // O(1) domain lookup

let defaultDomains = [];

// Deduplication maps: prevents multi-firing stats while allowing re-blocks
const tabLastChecked = new Map();
const tabLastCheckedTime = new Map();

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Pure Path installed');

  // Load defaults into memory for sync reference
  await loadDefaultListsIntoMemory();

  // On first install or update, load blocklists from JSON and save to storage
  if (details.reason === 'install' || details.reason === 'update') {
    await initializeBlocklistsFromJSON();
  }

  // Load blocklists from storage
  await loadBlocklistsFromStorage();

  // Initialize stats if first install
  const result = await chrome.storage.local.get(['stats']);
  if (!result.stats) {
    await chrome.storage.local.set({ stats: { totalBlocks: 0, installDate: new Date().toISOString() } });
  }

  // Check if password is set
  const { passwordHash: storedHash } = await chrome.storage.local.get(['passwordHash']);
  if (!storedHash) {
    // Open setup page
    chrome.tabs.create({ url: 'setup.html' });
  }
});

// Load blocklists on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Pure Path starting up');
  await loadDefaultListsIntoMemory();
  await loadBlocklistsFromStorage();
});

// Cache default lists into variables to send to Desktop app
async function loadDefaultListsIntoMemory() {
  try {
    const dRes = await fetch(chrome.runtime.getURL('blocklists/domains.json'));
    const dData = await dRes.json();
    defaultDomains = dData.domains || [];
  } catch(e) {
    console.error('❌ Error caching default lists:', e);
  }
}

// Initialize blocklists from JSON files (only on install/update)
async function initializeBlocklistsFromJSON() {
  try {
    console.log('📋 Pure Path: Initializing blocklists from JSON files...');
    
    // Ensure we have default domains loaded
    if (!defaultDomains || defaultDomains.length === 0) {
      console.log('🔄 defaultDomains empty, fetching now...');
      await loadDefaultListsIntoMemory();
    }
    
    if (!defaultDomains || defaultDomains.length === 0) {
      throw new Error('Could not load domains from JSON file');
    }

    // Save to storage
    await chrome.storage.local.set({
      blocklistDomains: defaultDomains
    });

    console.log(`✅ Pure Path: Initialized ${defaultDomains.length} domains in storage`);
  } catch (error) {
    console.error('❌ Pure Path: Error initializing blocklists from JSON:', error);
  }
}

// Load blocklists from Chrome storage
async function loadBlocklistsFromStorage() {
  try {
    console.log('📋 Pure Path: Loading blocklists from storage...');
    const result = await chrome.storage.local.get(['blocklistDomains']);

    if (result.blocklistDomains && result.blocklistDomains.length > 0) {
      blocklistDomains = result.blocklistDomains;
      // Build the Set for O(1) lookups — more memory efficient for-loop
      blocklistSet = new Set();
      for (let i = 0; i < blocklistDomains.length; i++) {
        blocklistSet.add(blocklistDomains[i].toLowerCase());
      }
      console.log(`✅ Pure Path: Loaded ${blocklistDomains.length} domains from storage`);
    } else {
      // If not in storage, initialize from JSON
      console.log('⚠️ Pure Path: Blocklists empty or not found in storage, initializing from JSON...');
      await initializeBlocklistsFromJSON();
      
      // Load again after initialization
      const retryResult = await chrome.storage.local.get(['blocklistDomains']);
      if (retryResult.blocklistDomains && retryResult.blocklistDomains.length > 0) {
          blocklistDomains = retryResult.blocklistDomains;
          blocklistSet = new Set();
          for (let i = 0; i < blocklistDomains.length; i++) {
            blocklistSet.add(blocklistDomains[i].toLowerCase());
          }
          console.log(`✅ Pure Path: Successfully initialized ${blocklistDomains.length} domains`);
      } else {
          console.error('❌ Pure Path: Failed to load blocklists even after initialization');
      }
    }
  } catch (error) {
    console.error('❌ Pure Path: Error loading blocklists from storage:', error);
  }
}

// Load blocklists from JSON files (legacy function, kept for compatibility)
async function loadBlocklists() {
  await loadBlocklistsFromStorage();
}

// ============================================================================
// WHITELIST - Completely safe domains (never block)
// ============================================================================

const WHITELIST_DOMAINS = [
  // Search engines & AI
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'gemini.google.com',
  'bard.google.com',
  'openai.com',
  'anthropic.com',
  'claude.ai',
  'chatgpt.com',

  // Development & Tech
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
  'stackexchange.com',
  'microsoft.com',
  'apple.com',
  'developer.mozilla.org',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'hub.docker.com',
  'vercel.com',
  'netlify.com',
  'heroku.com',
  'aws.amazon.com',
  'cloud.google.com',
  'azure.microsoft.com',
  'bitbucket.org',
  'codepen.io',
  'replit.com',
  'figma.com',

  // Cloud & Productivity
  'notion.so',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'onedrive.live.com',
  'office.com',
  'slack.com',
  'zoom.us',
  'teams.microsoft.com',

  // Social Media (mainstream safe)
  'linkedin.com',

  // Education & Reference
  'wikipedia.org',
  'wikihow.com',
  'khanacademy.org',
  'coursera.org',
  'udemy.com',
  'edx.org',
  'mit.edu',
  'stanford.edu',
  'harvard.edu',
  'w3schools.com',
  'freecodecamp.org',
  'codecademy.com',
  'brilliant.org',
  'merriam-webster.com',
  'dictionary.com',
  'wolframalpha.com',
  'quora.com',

  // E-commerce
  'amazon.com',
  'ebay.com',
  'walmart.com',
  'target.com',

  // News & Media
  'bbc.com',
  'cnn.com',
  'nytimes.com',
  'theguardian.com',
  'reuters.com',
  'washingtonpost.com',
  'wsj.com',
  'apnews.com',
  'aljazeera.com',
  'forbes.com',
  'techcrunch.com',
  'arstechnica.com',
  'theverge.com',
  'wired.com',

  // Banking & Finance
  'paypal.com',
  'stripe.com',
  'chase.com',
  'bankofamerica.com',

  // Health
  'webmd.com',
  'mayoclinic.org',
  'nih.gov',
  'who.int',

  // Government
  'nasa.gov',
  'irs.gov',

  // Entertainment (safe)
  'spotify.com',
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'crunchyroll.com',
  'store.steampowered.com',
  'epicgames.com'
];

// ============================================================================
// SEARCH ENGINE SAFESEARCH ENFORCEMENT
// ============================================================================

const SEARCH_ENGINES = [
  { domain: 'google.com', queryParam: 'q', safeParam: 'active' },
  { domain: 'bing.com', queryParam: 'q', safeParam: 'strict' },
  { domain: 'duckduckgo.com', queryParam: 'q', safeParam: '1' },
  { domain: 'yahoo.com', queryParam: 'p', safeParam: 'r' }
];

// ============================================================================
// SAFESEARCH ENFORCEMENT (always-on)
// ============================================================================

function checkSearchEngineSafeSearch(url, hostname) {
  const searchEngine = SEARCH_ENGINES.find(se =>
    hostname === se.domain || hostname.endsWith('.' + se.domain)
  );

  if (!searchEngine) return null;

  try {
    const urlObj = new URL(url);

    // Block attempts to disable SafeSearch
    const hasSafeSearchOff = url.includes('safe=off') || url.includes('safesearch=off') || url.includes('safe=0');
    if (hasSafeSearchOff) {
      console.log('🚫 SafeSearch disabled - blocking bypass attempt');
      return {
        blocked: true,
        reason: 'safesearch_bypass',
        match: 'SafeSearch disabled',
        severity: 'bypass_attempt'
      };
    }

    // ALWAYS enforce SafeSearch on search engines (regardless of query)
    const currentUrl = new URL(url);
    let paramName = 'safe';
    if (searchEngine.domain.includes('bing.com')) paramName = 'adlt';
    if (searchEngine.domain.includes('duckduckgo.com')) paramName = 'kp';
    if (searchEngine.domain.includes('yahoo.com')) paramName = 'vm';

    if (currentUrl.searchParams.get(paramName) !== searchEngine.safeParam) {
      currentUrl.searchParams.set(paramName, searchEngine.safeParam);
      return {
        safesearch: true,
        redirectUrl: currentUrl.toString(),
        reason: 'safesearch_always_on',
        match: 'SafeSearch enforced'
      };
    }
  } catch (error) {
    console.error('❌ Error checking search engine:', error);
  }

  return null;
}

// ============================================================================
// GRAYLIST ENFORCEMENT — Cookies & URL rewrites for gray-area domains
// Forces maximum restriction on sites that have NSFW filters.
// ============================================================================

// Pre-built Map: base domain → array of cookie configs (O(1) lookup)
const GRAYLIST_COOKIE_MAP = new Map([
  ['reddit.com', [
    { domain: 'reddit.com',  name: 'over18', value: '0', path: '/' },
    { domain: '.reddit.com', name: 'over18', value: '0', path: '/' }
  ]],
  ['pixiv.net', [
    { domain: 'pixiv.net',  name: 'R18', value: '0', path: '/' },
    { domain: '.pixiv.net', name: 'R18', value: '0', path: '/' }
  ]],
  ['twitter.com', [
    { domain: 'twitter.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.twitter.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]],
  ['x.com', [
    { domain: 'x.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.x.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]]
]);

// Pre-built Map: base domain → enforce(urlObj) function
const GRAYLIST_URL_REWRITE_MAP = new Map([
  ['archiveofourown.org', (urlObj) => {
    const p = urlObj.pathname;
    if (p.includes('/works') || p.includes('/tags') || p.includes('/search')) {
      let changed = false;
      const params = urlObj.searchParams;
      if (!params.getAll('work_search[excl_tag_names][]').includes('Explicit')) {
        params.append('work_search[excl_tag_names][]', 'Explicit');
        changed = true;
      }
      if (!params.getAll('work_search[excl_tag_names][]').includes('Mature')) {
        params.append('work_search[excl_tag_names][]', 'Mature');
        changed = true;
      }
      return changed ? urlObj.toString() : null;
    }
    return null;
  }],
  ['dailymotion.com', (urlObj) => {
    if (urlObj.searchParams.get('family_filter') !== 'true') {
      urlObj.searchParams.set('family_filter', 'true');
      return urlObj.toString();
    }
    return null;
  }]
]);

// Fast set of all graylist domains that need any enforcement
const GRAYLIST_ENFORCE_DOMAINS = new Set([
  ...GRAYLIST_COOKIE_MAP.keys(),
  ...GRAYLIST_URL_REWRITE_MAP.keys()
]);

// Match hostname to a graylist enforcement domain (or null)
function matchGraylistEnforceDomain(hostname) {
  if (GRAYLIST_ENFORCE_DOMAINS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (GRAYLIST_ENFORCE_DOMAINS.has(parent)) return parent;
  }
  return null;
}

// Set restrictive cookies — only called for matching domains
async function enforceGraylistCookies(baseDomain) {
  const cookies = GRAYLIST_COOKIE_MAP.get(baseDomain);
  if (!cookies) return;
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.replace(/^\./, '');
    try {
      await chrome.cookies.set({
        url: `https://${cleanDomain}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: true,
        sameSite: 'lax'
      });
    } catch (e) {
      // chrome.cookies may not be available
    }
  }
}

// Rewrite URL with safe-mode params — only called for matching domains
function enforceGraylistUrlRewrite(url, baseDomain) {
  const enforce = GRAYLIST_URL_REWRITE_MAP.get(baseDomain);
  if (!enforce) return null;
  try {
    return enforce(new URL(url));
  } catch (_) {
    return null;
  }
}

// ============================================================================
// URL BLOCKING LOGIC — Domain-only blocking
// ============================================================================

function shouldBlockUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // ========================================================================
    // STEP 1: Check search engine SafeSearch enforcement
    // ========================================================================
    const searchCheck = checkSearchEngineSafeSearch(url, hostname);
    if (searchCheck && (searchCheck.blocked || searchCheck.safesearch)) {
      return searchCheck;
    }

    // ========================================================================
    // STEP 2: Check WHITELIST (never block these)
    // ========================================================================
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        return { blocked: false, tier: 'whitelist', hostname };
      }
    }

    // ========================================================================
    // STEP 3: Check BLACKLIST (explicit NSFW domains from blocklist)
    // ========================================================================
    if (!blocklistSet || blocklistSet.size === 0) {
      return { blocked: false, tier: 'unknown', hostname };
    }

    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const domainToCheck = parts.slice(i).join('.');
      if (blocklistSet.has(domainToCheck)) {
        return { blocked: true, reason: 'blacklist_domain', match: domainToCheck, tier: 'blacklist', hostname };
      }
    }

    return { blocked: false, tier: 'unknown', hostname };

  } catch (error) {
    console.error('❌ Error checking URL:', error);
    return { blocked: false };
  }
}

// ============================================================================
// SHARED BLOCK HANDLER — single source of truth for blocking + stats
// Deduplicates across the 3 navigation listeners per tabId+URL pair.
// ============================================================================

function isIgnoredUrl(url) {
  return url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://');
}

async function recordBlockAndRedirect(tabId, url, reason, match) {
  const lastUrl = tabLastChecked.get(tabId);
  const lastTime = tabLastCheckedTime.get(tabId) || 0;
  const now = Date.now();

  // Deduplicate stats: skip if same URL within 2 seconds
  const isDuplicateStat = (lastUrl === url && (now - lastTime) < 2000);

  if (!isDuplicateStat) {
    tabLastChecked.set(tabId, url);
    tabLastCheckedTime.set(tabId, now);

    const { stats: s } = await chrome.storage.local.get(['stats']);
    const updatedStats = s || { totalBlocks: 0, installDate: new Date().toISOString() };
    updatedStats.totalBlocks = (updatedStats.totalBlocks || 0) + 1;
    updatedStats.lastBlockDate = new Date().toISOString();
    await chrome.storage.local.set({ stats: updatedStats });

    if (typeof NativeMessagingBridge !== 'undefined') {
      NativeMessagingBridge.sendStatsUpdate();
    }
  }

  const blockedPrefix = chrome.runtime.getURL('blocked.html');
  if (url.startsWith(blockedPrefix)) return;

  const blockedUrl = blockedPrefix + `?reason=${reason}&match=${encodeURIComponent(match)}`;
  
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && !tab.url.startsWith(blockedPrefix)) {
      await chrome.tabs.update(tabId, { url: blockedUrl });
    }
  } catch (e) {
    chrome.tabs.update(tabId, { url: blockedUrl }).catch(() => {});
  }
}

async function handleBlock(tabId, url) {
  const { passwordHash: storedHash } = await chrome.storage.local.get(['passwordHash']);
  if (!storedHash) return; // Not set up yet

  const result = shouldBlockUrl(url);

  // Handle silent SafeSearch enforcement
  if (result && result.safesearch) {
    if (url !== result.redirectUrl) {
      console.log(`Forcing SafeSearch: ${result.match}`);
      chrome.tabs.update(tabId, { url: result.redirectUrl });
    }
    return;
  }

  if (!result || !result.blocked) {
    // Not blocked — check if this is a graylist enforcement domain
    // Reuse hostname from shouldBlockUrl result to avoid re-parsing
    const hn = result?.hostname;
    if (hn) {
      const baseDomain = matchGraylistEnforceDomain(hn);
      if (baseDomain) {
        // Set restrictive cookies (fire-and-forget)
        enforceGraylistCookies(baseDomain);
        // Rewrite URL with safe-mode params
        const rewrittenUrl = enforceGraylistUrlRewrite(url, baseDomain);
        if (rewrittenUrl && rewrittenUrl !== url) {
          console.log(`🔒 Graylist URL rewrite: ${baseDomain}`);
          chrome.tabs.update(tabId, { url: rewrittenUrl });
        }
      }
    }
    return;
  }

  await recordBlockAndRedirect(tabId, url, result.reason, result.match);
}

// Clean up dedup maps when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabLastChecked.delete(tabId);
  tabLastCheckedTime.delete(tabId);
});

// Handle web requests (main navigation)
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (isIgnoredUrl(details.url)) return;
  await handleBlock(details.tabId, details.url);
});

// Handle SPA navigation
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (isIgnoredUrl(details.url)) return;
  await handleBlock(details.tabId, details.url);
});

// Handle tab address bar changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (isIgnoredUrl(changeInfo.url)) return;
  await handleBlock(tabId, changeInfo.url);
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStats') {
    // Read stats from storage (not in-memory) to avoid MV3 service worker race
    chrome.storage.local.get(['stats'], (result) => {
      sendResponse({ stats: result.stats || { totalBlocks: 0 } });
    });
    return true;
  }

  if (request.action === 'setPassword') {
    // Store hash and salt together for PBKDF2
    const updates = { passwordHash: request.hash };
    if (request.salt) updates.passwordSalt = request.salt;
    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (request.action === 'verifyPassword') {
    // Compare provided hash with stored hash
    chrome.storage.local.get(['passwordHash', 'passwordSalt'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ valid: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({
          valid: result.passwordHash === request.hash,
          salt: result.passwordSalt || null
        });
      }
    });
    return true;
  }

  if (request.action === 'getBlocklists') {
    sendResponse({
      domains: blocklistDomains
    });
    return true;
  }

  if (request.action === 'updateBlocklists') {
    // Update blocklists in storage
    const updates = {};
    if (request.domains !== undefined) {
      blocklistDomains = request.domains;
      blocklistSet = new Set(request.domains.map(d => d.toLowerCase()));
      updates.blocklistDomains = request.domains;
    }

    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('✅ Pure Path: Blocklists updated in storage');
        sendResponse({ success: true });
        // Notify desktop app of the change
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendBlocklistUpdate();
        }
      }
    });
    return true;
  }

  if (request.action === 'reloadBlocklists') {
    // Reload blocklists from storage
    loadBlocklistsFromStorage().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'checkUrl') {
    // Delegate to handleBlock — it deduplicates and handles stats
    if (sender.tab && sender.tab.id) {
      handleBlock(sender.tab.id, request.url).then(() => {
        sendResponse({ blocked: false });
      }).catch(() => {
        sendResponse({ blocked: false });
      });
    } else {
      sendResponse({ blocked: false });
    }
    return true;
  }

  if (request.action === 'notifyBlock') {
    // Explicit block report from content script
    if (sender.tab && sender.tab.id) {
      recordBlockAndRedirect(
        sender.tab.id,
        request.url || sender.tab.url,
        request.reason,
        request.match
      ).then(() => {
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === 'isDomainSafe') {
    // Unified whitelist check — single source of truth
    const hostname = (request.hostname || '').toLowerCase();
    let safe = false;
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        safe = true;
        break;
      }
    }
    sendResponse({ safe });
    return true;
  }

  return false;
});

// ============================================================================
// NATIVE MESSAGING BRIDGE — Desktop App Communication
// Connects to Pure Path desktop companion via chrome.runtime.connectNative()
// ============================================================================

const NativeMessagingBridge = (function () {
  const HOST_NAME = 'com.purepath.companion';
  const HEARTBEAT_INTERVAL = 15000;  // 15 seconds — keeps connection alive
  const SYNC_INTERVAL = 60000;       // 60 seconds — full data refresh
  const MAX_RECONNECT_DELAY = 15000; // 15 seconds max backoff

  let port = null;
  let heartbeatTimer = null;
  let syncTimer = null;
  let reconnectDelay = 250;
  let reconnectTimer = null;
  let isConnected = false;

  // ─── Connect to desktop app ────────────────────────────────────
  function connect() {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.log(`🔌 Native host disconnected${err ? ': ' + err.message : ''}`);
        cleanup();
        scheduleReconnect();
      });

      // Send handshake immediately
      sendHandshake();

      // Start periodic heartbeat and sync
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
      syncTimer = setInterval(sendFullSync, SYNC_INTERVAL);

      isConnected = true;
      reconnectDelay = 250; // Reset backoff on successful connect
      console.log('🔗 Connected to Pure Path desktop app');
    } catch (err) {
      console.log('⚠️ Native messaging connect failed:', err.message);
      scheduleReconnect();
    }
  }

  // ─── Cleanup on disconnect ─────────────────────────────────────
  function cleanup() {
    isConnected = false;
    port = null;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  // ─── Reconnect with exponential backoff ────────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`🔄 Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  // ─── Send a message to the desktop app ─────────────────────────
  function send(msg) {
    if (!port || !isConnected) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch (err) {
      console.log('⚠️ Native send failed:', err.message);
      return false;
    }
  }

  // ─── Handshake ─────────────────────────────────────────────────
  async function sendHandshake() {
    const { stats } = await chrome.storage.local.get(['stats']);
    send({
      type: 'handshake',
      extensionVersion: chrome.runtime.getManifest().version,
      installDate: stats?.installDate || new Date().toISOString()
    });
    // Send full sync immediately — no delay
    sendFullSync();
  }

  // ─── Heartbeat ─────────────────────────────────────────────────
  function sendHeartbeat() {
    send({
      type: 'heartbeat',
      timestamp: Date.now()
    });
  }

  // ─── Full sync (stats + blocklists) ────────────────────────────
  async function sendFullSync() {
    // Send stats
    const { stats } = await chrome.storage.local.get(['stats']);
    if (stats) {
      const installDate = stats.installDate ? new Date(stats.installDate) : new Date();
      const daysProtected = Math.floor((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24));
      send({
        type: 'stats_sync',
        totalBlocks: stats.totalBlocks || 0,
        installDate: stats.installDate || '',
        lastBlockDate: stats.lastBlockDate || '',
        daysProtected: daysProtected
      });
    }

    // Send blocklists
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─── Incremental stats update (called after each block) ────────
  async function sendStatsUpdate() {
    const { stats } = await chrome.storage.local.get(['stats']);
    if (stats) {
      const installDate = stats.installDate ? new Date(stats.installDate) : new Date();
      const daysProtected = Math.floor((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24));
      send({
        type: 'stats_update',
        totalBlocks: stats.totalBlocks || 0,
        lastBlockDate: stats.lastBlockDate || '',
        daysProtected: daysProtected
      });
    }
  }

  // ─── Blocklist change notification ─────────────────────────────
  async function sendBlocklistUpdate() {
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─── Handle messages FROM the desktop app ──────────────────────
  function handleMessage(msg) {
    console.log('📩 Message from desktop app:', msg.type);

    switch (msg.type) {
      case 'ack':
        console.log('✅ Desktop app acknowledged connection');
        break;

      case 'request_sync':
        // Desktop app wants fresh data
        sendFullSync();
        break;

      case 'update_blocklist':
        // Desktop app pushed a blocklist change
        handleBlocklistUpdate(msg);
        break;

      default:
        console.log('❓ Unknown message from desktop:', msg.type);
    }
  }

  // ─── Handle blocklist updates from desktop ─────────────────────
  async function handleBlocklistUpdate(msg) {
    const updates = {};

    if (msg.listType === 'domains' && Array.isArray(msg.data)) {
      updates.blocklistDomains = msg.data;
      // Update in-memory blocklists
      blocklistDomains = msg.data;
      blocklistSet = new Set(msg.data.map(d => d.toLowerCase()));
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('✅ Blocklist updated from desktop app:', msg.listType);
    }
  }

  // ─── Public API ────────────────────────────────────────────────
  return {
    connect,
    sendStatsUpdate,
    sendBlocklistUpdate,
    isConnected: () => isConnected
  };
})();

// ─── Connect immediately on startup ─────────────────────────────
NativeMessagingBridge.connect();

// Also connect/reconnect when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // The main onInstalled listener (line 12) handles blocklist init.
  // This ensures the native bridge connects after setup.
  setTimeout(() => NativeMessagingBridge.connect(), 500);
});
