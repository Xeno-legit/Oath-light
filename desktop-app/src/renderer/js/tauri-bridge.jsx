/* tauri-bridge.jsx — live bridge between the React UI and the Rust backend.
 *
 * Exposes:
 *   useBrowsers()  — React hook returning the live per-browser status array
 *                    emitted by the desktop app's monitor (`browsers-status`).
 *   window.PPNative — imperative helpers (enforce, setGuard, requestSync) and
 *                     `available` (true only when running inside Tauri).
 *
 * Outside Tauri (e.g. the standalone HTML preview) everything degrades to a
 * harmless no-op and `useBrowsers()` returns an empty list.
 */
(function () {
  const T = typeof window !== 'undefined' ? window.__TAURI__ : null;
  const available = !!(T && T.core && T.event);

  function invoke(cmd, args) {
    if (!available) return Promise.reject(new Error('Tauri not available'));
    return T.core.invoke(cmd, args);
  }

  window.PPNative = {
    available,
    // Re-apply the force-install policy. Live for Chromium (user-scope by
    // default); still dormant for Firefox while it's on hold.
    enforce(browserKey) { return invoke('enforce_extension', { browserKey: browserKey || null }); },
    // Ask for admin once (UAC) and lock the extension. Writing the policy needs
    // elevation; this relaunches elevated, writes it, and sets up silent
    // elevated re-assertion at future logins.
    requestElevatedSetup() { return invoke('request_elevated_setup'); },
    // Toggle the "keep the extension installed" guard. Turning it ON is
    // instant; turning it OFF is a friction-gated weakening (4.1) — resolves
    // to { applied, pending }. When `applied` is false the guard is still ON
    // and stays that way until `pending`'s delay elapses; callers must not
    // treat the guard as off just because this resolved. `auth` is a master-
    // password session token (4.2) — required only when turning OFF a guard
    // that's currently on; every other caller passes null.
    setGuard(enabled, auth) { return invoke('set_guard_enabled', { enabled: !!enabled, auth: auth || null }); },
    // Ask all connected extensions to push fresh stats/blocklists.
    requestSync() { return invoke('request_sync'); },
    getBrowsersStatus() { return invoke('get_browsers_status'); },
    // Push the selected theme/palette to every connected extension.
    setTheme(display) { return invoke('set_extension_theme', { display }).catch(() => {}); },
    // Push blocking settings (redirect target + reminder schedule) to the extensions.
    setBlocking(settings) {
      return invoke('set_blocking_settings', { settings })
        .catch((e) => console.warn('[PurePath] setBlocking failed (rebuild the app?):', e));
    },
    // Open a URL in the default browser (the "Test" button on the blocking page).
    openExternal(url) {
      return invoke('open_external', { url })
        .catch((e) => console.warn('[PurePath] openExternal failed:', e));
    },
    // Push the app's clean-streak day count to the extensions.
    setStreak(streak) { return invoke('set_app_streak', { streak: streak | 0 }).catch(() => {}); },
    // Push the renderer's "my blocklist" custom sites to every connected
    // extension (localStorage stays the source of truth; this is the sync).
    setCustomDomains(domains) {
      return invoke('set_custom_domains', { domains })
        .catch((e) => console.warn('[PurePath] setCustomDomains failed (rebuild the app?):', e));
    },
    // Check whether a domain is currently blocked (exact or parent-domain
    // match), against whatever list is effective right now.
    checkDomainBlocked(domain) { return invoke('check_domain_blocked', { domain }).catch(() => null); },
    // Classify an image file with the NSFW model (Phase 4 optional AI layer).
    // Resolves to { scores, top_label, top_score, nsfw_score, sensitive_score }.
    classifyImage(path) { return invoke('classify_image', { path }); },
    // Background screen monitor (scans the screen on major changes). Starting
    // is always instant. Stopping is a friction-gated weakening (4.1) —
    // resolves to { applied, pending }; when `applied` is false the monitor
    // is still running and stays that way until `pending`'s delay elapses.
    // `auth` (4.2) is only required while the monitor is actually running.
    startNsfwMonitor() { return invoke('start_nsfw_monitor'); },
    stopNsfwMonitor(auth) { return invoke('stop_nsfw_monitor', { auth: auth || null }); },

    // Friction (4.1/4.3): every pending "weakening" of protection (uninstall
    // guard, AI monitor, a custom-block removal) — the backend is the source
    // of truth for the countdown, never the renderer's own clock.
    getPendingWeakenings() {
      return invoke('get_pending_weakenings').catch((e) => { console.warn('[PurePath] getPendingWeakenings failed:', e); return []; });
    },
    cancelWeakening(actionId) {
      return invoke('cancel_weakening', { actionId })
        .catch((e) => console.warn('[PurePath] cancelWeakening failed:', e));
    },
    // Request removal of a custom-blocked domain — a weakening, gated behind
    // the friction delay AND, if set, the master password (4.2). The domain
    // stays blocked until the delay elapses.
    removeCustomDomain(domain, auth) {
      return invoke('remove_custom_domain', { domain, auth: auth || null })
        .catch((e) => { console.warn('[PurePath] removeCustomDomain failed:', e); return null; });
    },
    nsfwMonitorRunning() { return invoke('nsfw_monitor_running').catch(() => false); },

    // Process-level app blocking + evasion-browser detection (1.3). Backend-
    // owned settings — `getAppSettings` is the honest read (blocked_processes,
    // block_unknown_browsers), refetched by the caller after every mutation.
    getAppSettings() { return invoke('get_app_settings').catch((e) => { console.warn('[PurePath] getAppSettings failed:', e); return null; }); },
    // Adding a block is a strengthening — instant, ungated. Resolves to the
    // new full blocked-process list.
    addBlockedProcess(name) {
      return invoke('add_blocked_process', { name })
        .catch((e) => { console.warn('[PurePath] addBlockedProcess failed:', e); throw e; });
    },
    // Removing a block is a weakening — friction-gated (1.3), same shape as
    // removeCustomDomain: resolves to { action_id, label, ..., remaining_secs,
    // ready }. Requires the master-password token if one is set (4.2).
    removeBlockedProcess(name, auth) {
      return invoke('remove_blocked_process', { name, auth: auth || null })
        .catch((e) => { console.warn('[PurePath] removeBlockedProcess failed:', e); throw e; });
    },
    // Toggle blocking unknown/evasion browsers outright. Turning ON is
    // instant; turning OFF is friction-gated (same { applied, pending } shape
    // as setGuard) and requires the master-password token if one is set.
    setBlockUnknownBrowsers(enabled, auth) {
      return invoke('set_block_unknown_browsers', { enabled: !!enabled, auth: auth || null })
        .catch((e) => { console.warn('[PurePath] setBlockUnknownBrowsers failed:', e); throw e; });
    },
    // Subscribe to blocked-list kill events ({ action, name, reason }).
    // Resolves to an unlisten function, same shape as onNsfwScan.
    onProcessEnforcement(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('process-enforcement', (evt) => { if (evt && evt.payload) cb(evt.payload); });
    },
    // Subscribe to evasion-browser detections ({ name, path, reason, killed }).
    // Resolves to an unlisten function, same shape as onNsfwScan.
    onEvasionDetected(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('evasion-detected', (evt) => { if (evt && evt.payload) cb(evt.payload); });
    },
    // Subscribe to live scan results; resolves to an unlisten function.
    onNsfwScan(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('nsfw-scan', (evt) => { if (evt && evt.payload) cb(evt.payload); });
    },
    // Subscribe to the action-layer overlay's lifecycle ({ event: 'escalated'
    // | 'dismissed', monitor_id }), emitted by overlay.rs. Resolves to an
    // unlisten function, same shape as onNsfwScan.
    onNsfwOverlay(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('nsfw-overlay', (evt) => { if (evt && evt.payload) cb(evt.payload); });
    },

    // 24-hour uninstall request (Phase 4 friction). The backend owns the timer
    // (persisted to disk); these just read/drive it. State shape:
    //   { requested, requested_at, delay_secs, elapsed_secs, remaining_secs, ready }
    // `requestUninstall`'s `auth` (4.2) is required opening a fresh request —
    // it's the first step of a weakening even though nothing changes yet.
    getUninstallState() { return invoke('get_uninstall_state'); },
    requestUninstall(auth) { return invoke('request_uninstall', { auth: auth || null }); },
    resetUninstallTimer() { return invoke('reset_uninstall_timer'); },
    cancelUninstall() { return invoke('cancel_uninstall'); },
    // Resolves to "launched" (uninstaller started, app will close) or "manual".
    completeUninstall() { return invoke('complete_uninstall'); },

    // Panic / SOS flow (5.1). `onOpenPanic` subscribes to the backend's
    // `open-panic` event (tray "I need help now" / Ctrl+Shift+Space / the
    // extension blocked page's deep-link); resolves to an unlisten function,
    // same shape as onNsfwScan. `takePanicPending` consumes a request that
    // fired before this renderer existed (cold start from the tray/hotkey).
    onOpenPanic(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('open-panic', () => cb());
    },
    takePanicPending() { return invoke('take_panic_pending').catch(() => false); },
  };

  // Master password (Phase 4 item 4.2). Every weakening command's real gate
  // lives in Rust (`auth::require_auth`) — this object is just the renderer's
  // convenience wrapper around the auth commands, plus `acquire()`, the one
  // helper every gated caller in this codebase goes through instead of
  // rolling its own prompt/cache logic.
  window.PPAuth = {
    // Resolves `{ set: bool }`; `{ set: false }` outside Tauri (nothing to gate).
    status() {
      if (!available) return Promise.resolve({ set: false });
      return invoke('get_auth_status').catch(() => ({ set: false }));
    },
    // Verify a password and mint a session token — does NOT go through the
    // `acquire()` cache; this is the primitive the `PasswordGate` modal and
    // the fallback `prompt()` path in `acquire()` both call directly.
    verify(password) { return invoke('verify_master_password', { password }); },
    // Set (current === null/undefined) or change (current required) the
    // master password.
    setPassword(current, newPw) {
      return invoke('set_master_password', { current: current || null, new: newPw });
    },
    // Request removal — current password required, THEN the friction delay.
    requestRemoval(current) { return invoke('request_password_removal', { current }); },
    // The "forgot it" recovery path — no current password, but the same
    // friction delay (see auth.rs / lib.rs `request_password_removal_forgotten`
    // for why that's still safe). Used by the "Forgot it?" link in Settings.
    requestRemovalForgotten() { return invoke('request_password_removal_forgotten'); },

    // Cached session token + when it was minted. Module-scoped (shared by
    // every gated caller in the app, not owned by one component) rather than
    // React state — `acquire()` is called from plain event handlers all over
    // the renderer, not just from inside a component render.
    _token: null,
    _tokenAt: 0,

    // Resolve a live master-password session token for a gated action:
    //   - `null` immediately if no password is configured at all (nothing to
    //     gate — the backend would no-op the check anyway, but this also
    //     avoids ever showing a prompt to a solo user with no password set).
    //   - the cached token if it's still comfortably fresh (< 4 minutes old —
    //     shorter than the backend's 5-minute session TTL in auth.rs, so this
    //     never hands back a token the backend is about to reject).
    //   - otherwise prompts via `window.__ppAuthPrompt` (a Promise the
    //     `PasswordGate` modal registers on mount — see ui.jsx) and caches
    //     the result.
    // Rejects with `Error('cancelled')` when the user dismisses the prompt —
    // every gated caller catches that exact message and aborts silently
    // instead of surfacing it as an error.
    acquire() {
      return this.status().then((st) => {
        if (!st || !st.set) return null;
        const fresh = this._token && (Date.now() - this._tokenAt) < 4 * 60 * 1000;
        if (fresh) return this._token;
        const prompt = window.__ppAuthPrompt;
        const ask = prompt ? prompt() : new Promise((resolve, reject) => {
          // No PasswordGate mounted (e.g. a standalone preview outside the
          // real app shell) — fall back to a plain browser prompt so the
          // flow still works end to end rather than dead-ending.
          const pw = window.prompt('Enter your master password:');
          if (pw == null) { reject(new Error('cancelled')); return; }
          this.verify(pw).then(resolve, reject);
        });
        return ask.then((token) => {
          this._token = token;
          this._tokenAt = Date.now();
          return token;
        });
      });
    },
  };

  // React hook — live aggregate stats (total blocks across every extension).
  window.useExtensionStats = function useExtensionStats() {
    const [stats, setStats] = React.useState(null);
    React.useEffect(() => {
      if (!available) return;
      let unlisten = null, cancelled = false;
      invoke('get_extension_stats').then((s) => { if (!cancelled) setStats(s); }).catch(() => {});
      T.event.listen('extension-stats', (evt) => {
        if (!cancelled && evt.payload) setStats(evt.payload);
      }).then((fn) => { if (cancelled) fn(); else unlisten = fn; }).catch(() => {});
      return () => { cancelled = true; if (unlisten) unlisten(); };
    }, []);
    return stats;
  };

  // React hook — live domain/keyword blocklist counts, for honest "X domains
  // blocked" copy instead of a hardcoded string. Re-fetched whenever an
  // extension pushes a fresh blocklist sync (the event payload is the full
  // lists — it's only used here as a refresh signal, not kept).
  window.useBlocklistCounts = function useBlocklistCounts() {
    const [counts, setCounts] = React.useState(null);
    React.useEffect(() => {
      if (!available) return;
      let unlisten = null, cancelled = false;
      const refresh = () => invoke('get_blocklist_counts').then((c) => { if (!cancelled) setCounts(c); }).catch(() => {});
      refresh();
      T.event.listen('extension-blocklist', () => refresh())
        .then((fn) => { if (cancelled) fn(); else unlisten = fn; }).catch(() => {});
      return () => { cancelled = true; if (unlisten) unlisten(); };
    }, []);
    return counts;
  };

  // React hook — polls the friction store's pending weakenings (uninstall
  // guard / AI monitor disables, custom-block removals) while mounted. The
  // backend is the source of truth (persisted, clock-tamper immune — see
  // friction.rs), so this is a poll, not a push; 1.5s is fast enough for a
  // live-feeling countdown without hammering the backend. Returns [] outside
  // Tauri.
  window.usePendingWeakenings = function usePendingWeakenings() {
    const [pending, setPending] = React.useState([]);
    React.useEffect(() => {
      if (!available) return;
      let cancelled = false;
      const refresh = () => window.PPNative.getPendingWeakenings().then((list) => {
        if (!cancelled && Array.isArray(list)) setPending(list);
      });
      refresh();
      const id = setInterval(refresh, 1500);
      return () => { cancelled = true; clearInterval(id); };
    }, []);
    return pending;
  };

  // React hook — subscribes to the monitor's per-browser status stream.
  window.useBrowsers = function useBrowsers() {
    const [browsers, setBrowsers] = React.useState([]);

    React.useEffect(() => {
      if (!available) return;
      let unlisten = null;
      let cancelled = false;

      // Seed with the current snapshot, then follow the live stream.
      invoke('get_browsers_status').then((list) => {
        if (!cancelled && Array.isArray(list)) setBrowsers(list);
      }).catch(() => {});

      T.event.listen('browsers-status', (evt) => {
        if (!cancelled && Array.isArray(evt.payload)) setBrowsers(evt.payload);
      }).then((fn) => {
        if (cancelled) fn(); else unlisten = fn;
      }).catch(() => {});

      return () => { cancelled = true; if (unlisten) unlisten(); };
    }, []);

    return browsers;
  };
})();
