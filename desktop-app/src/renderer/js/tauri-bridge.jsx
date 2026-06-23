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
    // Re-apply the force-install policy (dormant/no-op until release config set).
    enforce(browserKey) { return invoke('enforce_extension', { browserKey: browserKey || null }); },
    // Toggle the "keep the extension installed" guard.
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
    // Classify an image file with the NSFW model (Phase 4 optional AI layer).
    // Resolves to { scores, top_label, top_score, nsfw_score, sensitive_score }.
    classifyImage(path) { return invoke('classify_image', { path }); },
    // Background screen monitor (scans the screen on major changes).
    startNsfwMonitor() { return invoke('start_nsfw_monitor'); },
    stopNsfwMonitor() { return invoke('stop_nsfw_monitor'); },
    nsfwMonitorRunning() { return invoke('nsfw_monitor_running').catch(() => false); },
    // Subscribe to live scan results; resolves to an unlisten function.
    onNsfwScan(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('nsfw-scan', (evt) => { if (evt && evt.payload) cb(evt.payload); });
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
