// bg/blocklists.js — Blocklist state + loading/persistence.
// In-memory blocklist Set/array, the default (built-in) domain cache, the
// desktop-app blocking-settings cache, the per-tab dedup maps, and the
// chrome.storage <-> JSON bootstrap/reload pipeline (onInstalled/onStartup +
// cold-start eager load). Relocated verbatim from the original background.js
// monolith — no logic changes.

let isExtensionEnabled = true;
let blocklistDomains = [];
let blocklistSet = new Set(); // O(1) domain lookup

let defaultDomains = [];

// Blocking settings pushed down from the desktop app (the "Redirect link" target
// and the focus-schedule reminders). Cached in memory for a zero-cost read on
// every navigation; mirrored to chrome.storage.local under `ppBlocking` so it
// survives a service-worker restart.
let blockingSettings = null;
async function loadBlockingSettings() {
  try {
    const { ppBlocking } = await chrome.storage.local.get(['ppBlocking']);
    if (ppBlocking && typeof ppBlocking === 'object') blockingSettings = ppBlocking;
  } catch (_) {}
  // Re-assert the DNR-backed strictness toggle on every worker spawn — ruleset
  // enable/disable persists across restarts, but re-applying from the cached
  // settings keeps DNR state honest if it and storage ever drift.
  applyYouTubeRestrictRuleset();
  return blockingSettings;
}

// YouTube Restricted Mode (plan 3.4) — an opt-in strictness level, DEFAULT
// OFF. Implemented as a static declarativeNetRequest ruleset (manifest id
// `pp_youtube_restrict`, disabled at install) that stamps the documented
// `YouTube-Restrict: Strict` request header onto *.youtube.com traffic — the
// same mechanism school/enterprise networks use, so YouTube itself filters
// server-side. Toggled by the desktop app's blocking settings
// (`youtubeRestrict` on the same channel as redirectLinkOn/redirectUrl).
// Wrapped in feature checks: Firefox < 113 and the test harness have no
// chrome.declarativeNetRequest, and enforcement must degrade silently there.
const YT_RESTRICT_RULESET_ID = 'pp_youtube_restrict';
function applyYouTubeRestrictRuleset() {
  const on = !!(blockingSettings && blockingSettings.youtubeRestrict);
  try {
    const dnr = chrome.declarativeNetRequest;
    if (!dnr || typeof dnr.updateEnabledRulesets !== 'function') return;
    const p = dnr.updateEnabledRulesets(
      on ? { enableRulesetIds: [YT_RESTRICT_RULESET_ID] }
         : { disableRulesetIds: [YT_RESTRICT_RULESET_ID] }
    );
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}

// Cached Set of the built-in domains, for fast "is this a default?" checks.
let defaultSetCache = null;
function getDefaultSet() {
  if (!defaultSetCache || defaultSetCache.size !== defaultDomains.length) {
    defaultSetCache = new Set(defaultDomains);
  }
  return defaultSetCache;
}

// On a cold/revived service worker the in-memory list can be empty; reload it
// from storage before any mutation so we never overwrite the saved blocklist.
// A single shared promise dedupes the cold-start bootstrap and the first
// navigation racing to load the same 385k list.
let blocklistLoadPromise = null;
async function ensureBlocklistLoaded() {
  if (blocklistSet && blocklistSet.size > 0) return;
  if (!blocklistLoadPromise) {
    blocklistLoadPromise = loadBlocklistsFromStorage()
      .finally(() => { blocklistLoadPromise = null; });
  }
  await blocklistLoadPromise;
}

// User-added domains are tracked in their own storage key (the source of truth
// for "my blocklist"), independent of the large merged blocklistDomains list.
async function getCustomList() {
  const { customDomains } = await chrome.storage.local.get(['customDomains']);
  return Array.isArray(customDomains) ? customDomains : [];
}

// Deduplication maps: prevents multi-firing stats while allowing re-blocks
const tabLastChecked = new Map();
const tabLastCheckedTime = new Map();

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
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Pure Path starting up');
  await loadDefaultListsIntoMemory();
  await loadBlocklistsFromStorage();
});

// Cold-start: an idle-revived MV3 service worker re-evaluates this script but
// fires NEITHER onInstalled NOR onStartup — so without this the blacklist Set
// would sit empty (only the keyword layer firing) until the next browser
// restart. Load eagerly on every worker spawn; ensureBlocklistLoaded dedupes
// against the first navigation that also triggers a load.
ensureBlocklistLoaded();
loadDefaultListsIntoMemory();
loadBlockingSettings();

// Cache default lists into variables to send to Desktop app
// Loads all part files in parallel for fastest cold-start. domains_ai.json is
// the AI-erotica category (AI-girlfriend/companion sites, NSFW AI image
// generators, NSFW character-chat frontends, jailbroken chat UIs) — kept as
// its own file/category like the other parts, merged into the same flat
// defaultDomains array the matcher already treats every part uniformly.
async function loadDefaultListsIntoMemory() {
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      fetch(chrome.runtime.getURL('blocklists/domains_part1.json')),
      fetch(chrome.runtime.getURL('blocklists/domains_part2.json')),
      fetch(chrome.runtime.getURL('blocklists/domains_part3.json')),
      fetch(chrome.runtime.getURL('blocklists/domains_ai.json')),
    ]);
    const [d1, d2, d3, d4] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json()]);
    defaultDomains = [
      ...(d1.domains || []),
      ...(d2.domains || []),
      ...(d3.domains || []),
      ...(d4.domains || []),
    ];
  } catch(e) {
    console.error('Error caching default lists:', e);
  }
}

async function initializeBlocklistsFromJSON() {
  try {
    console.log('Pure Path: Initializing blocklists from JSON files...');
    
    // Ensure we have default domains loaded
    if (!defaultDomains || defaultDomains.length === 0) {
      console.log(' defaultDomains empty, fetching now...');
      await loadDefaultListsIntoMemory();
    }
    
    if (!defaultDomains || defaultDomains.length === 0) {
      throw new Error('Could not load domains from JSON file');
    }

    // Save to storage
    await chrome.storage.local.set({
      blocklistDomains: defaultDomains
    });

    console.log(`Pure Path: Initialized ${defaultDomains.length} domains in storage`);
  } catch (error) {
    console.error('Pure Path: Error initializing blocklists from JSON:', error);
  }
}

async function loadBlocklistsFromStorage() {
  try {
    console.log('Pure Path: Loading blocklists from storage...');
    const result = await chrome.storage.local.get(['blocklistDomains']);

    if (result.blocklistDomains && result.blocklistDomains.length > 0 && result.blocklistDomains.length < 600000) {
      blocklistDomains = result.blocklistDomains;
      // Build the Set for O(1) lookups — more memory efficient for-loop
      blocklistSet = new Set();
      for (let i = 0; i < blocklistDomains.length; i++) {
        blocklistSet.add(blocklistDomains[i].toLowerCase());
      }
      console.log(`Pure Path: Loaded ${blocklistDomains.length} domains from storage`);
    } else {
      if (result.blocklistDomains && result.blocklistDomains.length >= 600000) {
         console.log('Pure Path: Detected old unoptimized blocklist in storage. Forcing re-initialization...');
         await chrome.storage.local.remove('blocklistDomains');
      }
      // If not in storage, initialize from JSON
      console.log('️ Pure Path: Blocklists empty or not found in storage, initializing from JSON...');
      await initializeBlocklistsFromJSON();
      
      // Load again after initialization
      const retryResult = await chrome.storage.local.get(['blocklistDomains']);
      if (retryResult.blocklistDomains && retryResult.blocklistDomains.length > 0) {
          blocklistDomains = retryResult.blocklistDomains;
          blocklistSet = new Set();
          for (let i = 0; i < blocklistDomains.length; i++) {
            blocklistSet.add(blocklistDomains[i].toLowerCase());
          }
          console.log(`Pure Path: Successfully initialized ${blocklistDomains.length} domains`);
      } else {
          console.error('Pure Path: Failed to load blocklists even after initialization');
      }
    }
  } catch (error) {
    console.error('Pure Path: Error loading blocklists from storage:', error);
  }
}

async function loadBlocklists() {
  await loadBlocklistsFromStorage();
  await applyOtaListsIfPresent();
}

// OTA preference (plan 3.5): if bg/ota.js has a verified, whitelist-clean list
// set stored (from the extension-only weekly fetch), prefer its domains over
// whatever the bundled/cached load just installed. A missing/corrupt/rejected
// OTA set leaves the bundled lists in place — the built-in lists are never
// deleted, so this can only ever ADD freshness, never brick browsing (the
// safety floor). No-op when the desktop app is driving lists, or before ota.js
// / matching.js have loaded (both true only transiently at cold start).
async function applyOtaListsIfPresent() {
  try {
    if (typeof PurePathOTA === 'undefined' || typeof WHITELIST_DOMAINS === 'undefined') return;
    const ota = await PurePathOTA.loadStoredOta(chrome.storage.local, WHITELIST_DOMAINS);
    if (!ota || !ota.domains.length) return;
    blocklistDomains = ota.domains;
    blocklistSet = new Set();
    for (let i = 0; i < blocklistDomains.length; i++) blocklistSet.add(blocklistDomains[i].toLowerCase());
    console.log(`Pure Path: applied OTA blocklist v${ota.version} (${blocklistDomains.length} domains)`);
  } catch (error) {
    console.error('Pure Path: OTA list apply failed (keeping bundled lists):', error);
  }
}
