// background.js — MV3 service-worker / background-script ENTRY POINT.
//
// This file used to be the entire 2,657-line extension monolith. It has been
// split into cohesive modules under bg/ (blocklists, matching, graylist,
// native-bridge, reminders) — see each file's header comment. This file now
// keeps only: the shared block handler (handleBlock / recordBlockAndRedirect
// / getRedirectTarget / isIgnoredUrl), the navigation event listeners, and
// the runtime.onMessage router.
//
// Chrome MV3 classic service workers support importScripts() — load the
// modules synchronously so every function/const below is defined before it
// executes. Firefox MV3 background scripts do NOT define importScripts; there
// the manifest's "background.scripts" array lists the same bg/ files (in the
// same dependency order) followed by this file, so the browser loads them
// sequentially into one shared global scope instead — the guard below simply
// no-ops on Firefox.
if (typeof importScripts === 'function') {
  importScripts('bg/blocklists.js', 'bg/matching.js', 'bg/graylist.js', 'bg/native-bridge.js', 'bg/reminders.js');
}

// SHARED BLOCK HANDLER — single source of truth for blocking + stats
// Deduplicates across the 3 navigation listeners per tabId+URL pair.

function isIgnoredUrl(url) {
  return url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://');
}

async function recordBlockAndRedirect(tabId, url, reason, match, skipTabUpdate = false) {
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
  if (url.startsWith(blockedPrefix)) return null;

  // TEMP (testing): both block destinations — blocked.html AND the user-configured
  // "Redirect link" — are PAUSED here, because navigating to either can crash/hang
  // the Playwright automation bridge. While PP_TESTING is true, every block routes
  // to a light about:blank instead. Set PP_TESTING=false to restore BOTH the normal
  // block screen and the redirect-link behaviour.
  const PP_TESTING = true;
  const blockedUrl = PP_TESTING
    ? 'about:blank'
    : blockedPrefix + `?reason=${reason}&match=${encodeURIComponent(match)}`;
  if (PP_TESTING) console.log('[PurePath][TEST] BLOCK', { reason, match, url });

  // Desktop "Redirect link": send the user to the configured URL instead of the
  // block screen. The loop guard (the url isn't already the target) stops an
  // infinite bounce if the redirect destination ever resolves as blocked itself.
  // (Suppressed entirely while PP_TESTING — see above.)
  const redirectTarget = PP_TESTING ? null : getRedirectTarget();
  const targetUrl = (redirectTarget && !url.startsWith(redirectTarget)) ? redirectTarget : blockedUrl;
  if (redirectTarget) {
    console.log('[PurePath] block →', targetUrl === redirectTarget ? 'redirecting to ' + redirectTarget : 'block screen (loop guard)');
  } else if (!blockingSettings) {
    console.log('[PurePath] block → block screen (no settings from desktop app yet)');
  }

  if (!skipTabUpdate) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && !tab.url.startsWith(blockedPrefix)) {
        await chrome.tabs.update(tabId, { url: targetUrl });
      }
    } catch (e) {
      chrome.tabs.update(tabId, { url: targetUrl }).catch(() => {});
    }
  }

  return targetUrl;
}

// The active "Redirect link" destination, or null when the setting is off /
// blank / unusable. Tolerates a scheme-less entry ("youtube.com/watch?v=…") by
// assuming https, so the user doesn't have to type the protocol.
function getRedirectTarget() {
  const b = blockingSettings;
  if (!b || !b.redirectLinkOn) return null;
  let u = (b.redirectUrl || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    // Only auto-prefix things that look like a host (has a dot, no spaces).
    if (!/^[^\s/]+\.[^\s/]+/.test(u)) return null;
    u = 'https://' + u;
  }
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
  } catch (_) {
    return null;
  }
  return u;
}

async function handleBlock(tabId, url, skipTabUpdate = false) {
  // Make sure the blacklist is loaded (cold-revived worker). Returns instantly
  // once warm, so this adds no per-navigation cost — and removes the previous
  // per-navigation chrome.storage round-trip that gated every check.
  await ensureBlocklistLoaded();

  const result = shouldBlockUrl(url);

  // Handle silent SafeSearch enforcement
  if (result && result.safesearch) {
    if (url !== result.redirectUrl) {
      console.log(`Forcing SafeSearch: ${result.match}`);
      // Fire-and-forget: Firefox rejects tabs.update with "Navigation rejected"
      // when the navigation has already moved on. Swallow it — the redirect just
      // didn't apply, which is harmless.
      chrome.tabs.update(tabId, { url: result.redirectUrl }).catch(() => {});
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
          console.log(`Graylist URL rewrite: ${baseDomain}`);
          // Fire-and-forget: see SafeSearch redirect above — swallow Firefox's
          // "Navigation rejected" rejection when the navigation already changed.
          chrome.tabs.update(tabId, { url: rewrittenUrl }).catch(() => {});
        }
      }
    }
    return;
  }

  return await recordBlockAndRedirect(tabId, url, result.reason, result.match, skipTabUpdate);
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
        console.log('Pure Path: Blocklists updated in storage');
        sendResponse({ success: true });
        // Notify desktop app of the change
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendBlocklistUpdate();
        }
      }
    });
    return true;
  }

  if (request.action === 'getCustomDomains') {
    // The user's own list (small) + the built-in count for display.
    (async () => {
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      sendResponse({ custom: await getCustomList(), builtIn: getDefaultSet().size });
    })();
    return true;
  }

  if (request.action === 'checkDomainBlocked') {
    // Yes/no check against the built-in blacklist (exact or parent-domain match).
    (async () => {
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      const d = (request.domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      const dset = getDefaultSet();
      let blocked = dset.has(d);
      if (!blocked && d.includes('.')) {
        // also match if a parent registrable domain is blocked (sub.x.com -> x.com)
        const parts = d.split('.');
        for (let i = 1; i < parts.length - 1 && !blocked; i++) {
          if (dset.has(parts.slice(i).join('.'))) blocked = true;
        }
      }
      sendResponse({ domain: d, blocked });
    })();
    return true;
  }

  if (request.action === 'addCustomDomain') {
    (async () => {
      const domain = (request.domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!domain) { sendResponse({ success: false, reason: 'empty' }); return; }
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      if (getDefaultSet().has(domain)) { sendResponse({ success: false, reason: 'default' }); return; }
      const custom = await getCustomList();
      if (custom.includes(domain)) { sendResponse({ success: false, reason: 'exists' }); return; }
      await ensureBlocklistLoaded();
      const nextCustom = [...custom, domain];
      if (!blocklistSet.has(domain)) { blocklistDomains = [...blocklistDomains, domain]; blocklistSet.add(domain); }
      chrome.storage.local.set({ customDomains: nextCustom, blocklistDomains }, () => {
        if (chrome.runtime.lastError) { sendResponse({ success: false, reason: 'storage' }); return; }
        if (typeof NativeMessagingBridge !== 'undefined') NativeMessagingBridge.sendBlocklistUpdate();
        sendResponse({ success: true });
      });
    })();
    return true;
  }

  if (request.action === 'removeCustomDomain') {
    (async () => {
      const domain = (request.domain || '').trim().toLowerCase();
      await ensureBlocklistLoaded();
      const nextCustom = (await getCustomList()).filter((d) => d !== domain);
      blocklistDomains = blocklistDomains.filter((d) => d !== domain);
      blocklistSet.delete(domain);
      chrome.storage.local.set({ customDomains: nextCustom, blocklistDomains }, () => {
        if (chrome.runtime.lastError) { sendResponse({ success: false }); return; }
        if (typeof NativeMessagingBridge !== 'undefined') NativeMessagingBridge.sendBlocklistUpdate();
        sendResponse({ success: true });
      });
    })();
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
    if (sender.tab && sender.tab.id) {
      handleBlock(sender.tab.id, request.url, true).then((blockedUrl) => {
        if (blockedUrl) {
          sendResponse({ blocked: true, blockedUrl: blockedUrl });
        } else {
          sendResponse({ blocked: false });
        }
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

  if (request.action === 'graylistFiltered') {
    // Graylist V2 stripped N site-labelled NSFW items from a JSON response.
    // Track it separately from navigation blocks (it's filtering, not a redirect).
    const n = Number(request.count) || 0;
    if (n > 0) {
      (async () => {
        const { stats } = await chrome.storage.local.get(['stats']);
        const s = stats || { totalBlocks: 0, installDate: new Date().toISOString() };
        s.graylistFiltered = (s.graylistFiltered || 0) + n;
        await chrome.storage.local.set({ stats: s });
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendStatsUpdate();
        }
      })();
    }
    return false;
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