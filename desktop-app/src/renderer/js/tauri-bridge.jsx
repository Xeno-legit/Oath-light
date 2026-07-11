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
    // treat the guard as off just because this resolved.
    setGuard(enabled) { return invoke('set_guard_enabled', { enabled: !!enabled }); },
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
    startNsfwMonitor() { return invoke('start_nsfw_monitor'); },
    stopNsfwMonitor() { return invoke('stop_nsfw_monitor'); },

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
    // the friction delay; the domain stays blocked until it elapses.
    removeCustomDomain(domain) {
      return invoke('remove_custom_domain', { domain })
        .catch((e) => { console.warn('[PurePath] removeCustomDomain failed:', e); return null; });
    },
    nsfwMonitorRunning() { return invoke('nsfw_monitor_running').catch(() => false); },
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
    getUninstallState() { return invoke('get_uninstall_state'); },
    requestUninstall() { return invoke('request_uninstall'); },
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
