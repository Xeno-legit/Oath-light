// bg/native-bridge.js — NativeMessagingBridge: the desktop-companion-app
// connection (handshake/heartbeat/full-sync), inbound message handling
// (blocklist push, theme, app-data, blocking-settings), and the immediate
// connect-on-load calls. Relocated verbatim from the original background.js
// monolith — no logic changes.

// NATIVE MESSAGING BRIDGE — Desktop App Communication
// Connects to Pure Path desktop companion via chrome.runtime.connectNative()

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
  let profileId = null;

  // ─ Stable per-profile id ───────────────────────────────────
  // Each Chrome profile has its own extension storage, so a value stored here
  // is unique to (and stable for) this profile. The desktop app uses it to tell
  // multiple connected profiles of the same browser apart.
  async function ensureProfileId() {
    if (profileId) return profileId;
    try {
      const { ppProfileId } = await chrome.storage.local.get(['ppProfileId']);
      if (ppProfileId) { profileId = ppProfileId; return profileId; }
      profileId = (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await chrome.storage.local.set({ ppProfileId: profileId });
    } catch (e) {
      profileId = profileId || ('p-' + Math.random().toString(36).slice(2, 10));
    }
    return profileId;
  }

  // ─ Connect to desktop app ──────────────────────────────────
  function connect() {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.log(`Native host disconnected${err ? ': ' + err.message : ''}`);
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
      console.log('Connected to Pure Path desktop app');
    } catch (err) {
      console.log('️ Native messaging connect failed:', err.message);
      scheduleReconnect();
    }
  }

  // ─ Cleanup on disconnect ───────────────────────────────────
  function cleanup() {
    isConnected = false;
    port = null;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  // ─ Reconnect with exponential backoff ──────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(` Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  // ─ Send a message to the desktop app ───────────────────────
  function send(msg) {
    if (!port || !isConnected) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch (err) {
      console.log('️ Native send failed:', err.message);
      return false;
    }
  }

  // ─ Handshake ───────────────────────────────────────────────
  async function sendHandshake() {
    await ensureProfileId();
    const { stats } = await chrome.storage.local.get(['stats']);
    send({
      type: 'handshake',
      profileId,
      extensionVersion: chrome.runtime.getManifest().version,
      installDate: stats?.installDate || new Date().toISOString()
    });
    // Send full sync immediately — no delay
    sendFullSync();
  }

  // ─ Heartbeat ───────────────────────────────────────────────
  function sendHeartbeat() {
    send({
      type: 'heartbeat',
      profileId,
      timestamp: Date.now()
    });
  }

  // ─ Full sync (stats + blocklists) ──────────────────────────
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

  // ─ Incremental stats update (called after each block) ──────
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

  // ─ Blocklist change notification ───────────────────────────
  async function sendBlocklistUpdate() {
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─ Handle messages FROM the desktop app ────────────────────
  function handleMessage(msg) {
    console.log(' Message from desktop app:', msg.type);

    switch (msg.type) {
      case 'ack':
        console.log('Desktop app acknowledged connection');
        break;

      case 'request_sync':
        // Desktop app wants fresh data
        sendFullSync();
        break;

      case 'update_blocklist':
        // Desktop app pushed a blocklist change
        handleBlocklistUpdate(msg);
        break;

      case 'set_theme':
        // Desktop app pushed its selected theme/palette — mirror it so every
        // extension page matches (theme-sync.js / blocked.js read this).
        handleSetTheme(msg);
        break;

      case 'set_app_data':
        // Desktop app pushed the canonical day-streak + global block total
        // (summed across every browser/profile). Pages read `ppAppData`.
        handleSetAppData(msg);
        break;

      case 'set_blocking':
        // Desktop app pushed the blocking settings (redirect target + reminder
        // schedule). Cache them and re-arm the reminder loop.
        handleSetBlocking(msg);
        break;

      default:
        console.log('Unknown message from desktop:', msg.type);
    }
  }

  // ─ Mirror the app's day streak + global block total into storage ──
  async function handleSetAppData(msg) {
    const data = {};
    if (typeof msg.streak === 'number') data.streak = msg.streak;
    if (typeof msg.globalBlocks === 'number') data.globalBlocks = msg.globalBlocks;
    if (Object.keys(data).length === 0) return;
    const { ppAppData } = await chrome.storage.local.get(['ppAppData']);
    await chrome.storage.local.set({ ppAppData: Object.assign({}, ppAppData, data) });
  }

  // ─ Cache the desktop app's blocking settings ───────────────
  async function handleSetBlocking(msg) {
    const settings = (msg.settings && typeof msg.settings === 'object') ? msg.settings : null;
    if (!settings) return;
    blockingSettings = settings;
    console.log('[PurePath] blocking settings received — redirect:',
      settings.redirectLinkOn ? (settings.redirectUrl || '(blank)') : 'off');
    try { await chrome.storage.local.set({ ppBlocking: settings }); } catch (_) {}
    // Re-arm the reminder loop to reflect the new schedule immediately.
    if (typeof armReminderAlarm === 'function') armReminderAlarm();
  }

  // ─ Mirror the desktop app's theme into storage ─────────────
  async function handleSetTheme(msg) {
    const d = (msg.display && typeof msg.display === 'object') ? msg.display : msg;
    const display = {};
    if (d.theme) display.theme = d.theme;
    if (d.style) display.style = d.style;
    if (d.bg) display.bg = d.bg;
    if (typeof d.intensity !== 'undefined') display.intensity = d.intensity;
    if (Object.keys(display).length === 0) return;
    // Store the object plus mirrored top-level keys (blocked.js reads either).
    await chrome.storage.local.set({ display, ...display });
  }

  // ─ Handle blocklist updates from desktop ───────────────────
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
      console.log('Blocklist updated from desktop app:', msg.listType);
    }
  }

  // ─ Public API ──────────────────────────────────────────────
  return {
    connect,
    sendStatsUpdate,
    sendBlocklistUpdate,
    isConnected: () => isConnected
  };
})();

// ─ Connect immediately on startup ───────────────────────────
NativeMessagingBridge.connect();

// Also connect/reconnect when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // The main onInstalled listener (line 12) handles blocklist init.
  // This ensures the native bridge connects after setup.
  setTimeout(() => NativeMessagingBridge.connect(), 500);
});