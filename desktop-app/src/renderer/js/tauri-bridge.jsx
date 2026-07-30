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
    // Open a browser at its own extensions page. Needed where the extension is
    // auto-installed rather than force-installed (Edge): the browser downloads
    // it but leaves it switched off until the user approves it once.
    openExtensionsPage(browserKey) {
      return invoke('open_extensions_page', { browserKey })
        .catch((e) => console.warn('[OathLight] openExtensionsPage failed:', e));
    },
    // Open a restore window for a locked-out browser (Edge): re-asserts the
    // auto-install registration, launches the browser at its extensions page,
    // and suspends the kill for ~20s. Resolves to the seconds granted.
    //
    // Not friction-gated, deliberately: it grants seconds, not access, and the
    // only thing it enables is installing the extension — the outcome the lock
    // exists to produce. Gating it would make the lockout unrecoverable.
    requestBrowserRestore(browserKey) {
      return invoke('request_browser_restore', { browserKey })
        .catch((e) => console.warn('[OathLight] requestBrowserRestore failed:', e));
    },
    // Toggle the browser lock (kill a browser that can't be force-installed
    // until it carries the extension). ON is instant; OFF is a friction-gated
    // weakening — same { applied, pending } contract as `setGuard`, and the same
    // rule: `applied: false` means the lock is still fully ON.
    setBrowserLock(enabled, auth) {
      return invoke('set_browser_lock_enabled', { enabled: !!enabled, auth: auth || null });
    },
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
        .catch((e) => console.warn('[OathLight] setBlocking failed (rebuild the app?):', e));
    },
    // Open a URL in the default browser (the "Test" button on the blocking page).
    openExternal(url) {
      return invoke('open_external', { url })
        .catch((e) => console.warn('[OathLight] openExternal failed:', e));
    },
    // Push the app's clean-streak day count to the extensions.
    setStreak(streak) { return invoke('set_app_streak', { streak: streak | 0 }).catch(() => {}); },
    // Push the renderer's "my blocklist" custom sites to every connected
    // extension (localStorage stays the source of truth; this is the sync).
    setCustomDomains(domains) {
      return invoke('set_custom_domains', { domains })
        .catch((e) => console.warn('[OathLight] setCustomDomains failed (rebuild the app?):', e));
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

    // AI mentor (optional, opt-in — see src-tauri/src/mentor.rs). The API key
    // lives in Rust and never crosses this bridge: `getMentorConfig` reports
    // `has_key`, never the key, and `setMentorConfig` is write-only for it.
    // Resolves to { enabled, has_key, model, provider, base_url, providers },
    // where `providers` is the catalog the Settings picker is built from —
    // sourced from Rust so the UI can't offer a provider the request path
    // doesn't know how to talk to.
    getMentorConfig() {
      return invoke('get_mentor_config').catch(() => ({
        enabled: false, has_key: false, model: '',
        provider: 'anthropic', base_url: '', providers: [],
      }));
    },
    // `apiKey`/`model`/`provider`/`baseUrl` are tri-state: omit (or pass null)
    // to leave the stored value alone, pass '' to clear it. That's what lets
    // the enable toggle work without the renderer ever holding the key.
    setMentorConfig({ enabled, apiKey, model, provider, baseUrl }) {
      return invoke('set_mentor_config', {
        enabled: !!enabled,
        apiKey: apiKey === undefined ? null : apiKey,
        model: model === undefined ? null : model,
        provider: provider === undefined ? null : provider,
        baseUrl: baseUrl === undefined ? null : baseUrl,
      });
    },
    // Send the conversation, get one reply. `history` is [{role, text}, …]
    // oldest first, ending with the new user message. Resolves to
    // { text, blocked_locally, model }; `blocked_locally` means the text came
    // from Rust (a refusal or a withheld reply), NOT from the model — the UI
    // must label those differently rather than passing them off as the AI.
    mentorSend(history) { return invoke('mentor_send', { history }); },

    // Friction (4.1/4.3): every pending "weakening" of protection (uninstall
    // guard, AI monitor, a custom-block removal) — the backend is the source
    // of truth for the countdown, never the renderer's own clock.
    getPendingWeakenings() {
      return invoke('get_pending_weakenings').catch((e) => { console.warn('[OathLight] getPendingWeakenings failed:', e); return []; });
    },
    cancelWeakening(actionId) {
      return invoke('cancel_weakening', { actionId })
        .catch((e) => console.warn('[OathLight] cancelWeakening failed:', e));
    },
    // Request removal of a custom-blocked domain — a weakening, gated behind
    // the friction delay AND, if set, the master password (4.2). The domain
    // stays blocked until the delay elapses.
    removeCustomDomain(domain, auth) {
      return invoke('remove_custom_domain', { domain, auth: auth || null })
        .catch((e) => { console.warn('[OathLight] removeCustomDomain failed:', e); return null; });
    },
    nsfwMonitorRunning() { return invoke('nsfw_monitor_running').catch(() => false); },

    // Process-level app blocking + evasion-browser detection (1.3). Backend-
    // owned settings — `getAppSettings` is the honest read (blocked_processes,
    // block_unknown_browsers), refetched by the caller after every mutation.
    getAppSettings() { return invoke('get_app_settings').catch((e) => { console.warn('[OathLight] getAppSettings failed:', e); return null; }); },
    // Adding a block is a strengthening — instant, ungated. Resolves to the
    // new full blocked-process list.
    addBlockedProcess(name) {
      return invoke('add_blocked_process', { name })
        .catch((e) => { console.warn('[OathLight] addBlockedProcess failed:', e); throw e; });
    },
    // Removing a block is a weakening — friction-gated (1.3), same shape as
    // removeCustomDomain: resolves to { action_id, label, ..., remaining_secs,
    // ready }. Requires the master-password token if one is set (4.2).
    removeBlockedProcess(name, auth) {
      return invoke('remove_blocked_process', { name, auth: auth || null })
        .catch((e) => { console.warn('[OathLight] removeBlockedProcess failed:', e); throw e; });
    },
    // Toggle blocking unknown/evasion browsers outright. Turning ON is
    // instant; turning OFF is friction-gated (same { applied, pending } shape
    // as setGuard) and requires the master-password token if one is set.
    setBlockUnknownBrowsers(enabled, auth) {
      return invoke('set_block_unknown_browsers', { enabled: !!enabled, auth: auth || null })
        .catch((e) => { console.warn('[OathLight] setBlockUnknownBrowsers failed:', e); throw e; });
    },

    // System DNS filter (1.1/1.2). `getDnsStatus` -> { running, taken_over,
    // last_error, upstreams, upstream_warning, exposure_warning }.
    // `setDnsFilter(true)` is a strengthening —
    // instant, and REJECTS (throws) on a port-53 conflict / no-admin so the
    // caller can show the error verbatim; `setDnsFilter(false, auth)` is a
    // friction-gated weakening (same { applied, pending } shape as setGuard)
    // and requires the master-password token if one is set.
    getDnsStatus() {
      return invoke('get_dns_status')
        .catch((e) => { console.warn('[OathLight] getDnsStatus failed:', e); return null; });
    },
    setDnsFilter(enabled, auth) {
      return invoke('set_dns_filter_enabled', { enabled: !!enabled, auth: auth || null });
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
    // `confirm` is the typed confirmation phrase (4.6) — the backend compares
    // it against the one it minted when the request was filed and rejects a
    // mismatch, so this is not a renderer-side check that can be skipped.
    completeUninstall(confirm) { return invoke('complete_uninstall', { confirm: confirm || null }); },

    // OTA blocklist updates (3.5). Status shape:
    //   { installed_version, loaded_version, last_check, last_result, checking }
    // `checkListsUpdateNow` kicks a check off on a backend thread and returns
    // immediately (checking: true); the outcome arrives via `onOtaStatus`
    // (the backend's `ota-status` event) — poll `getOtaStatus` as a fallback.
    getOtaStatus() { return invoke('get_ota_status').catch((e) => { console.warn('[OathLight] getOtaStatus failed:', e); return null; }); },
    checkListsUpdateNow() {
      return invoke('check_lists_update_now')
        .catch((e) => { console.warn('[OathLight] checkListsUpdateNow failed:', e); return null; });
    },
    // Subscribe to OTA check outcomes; resolves to an unlisten function, same
    // shape as onNsfwScan.
    onOtaStatus(cb) {
      if (!available) return Promise.resolve(() => {});
      return T.event.listen('ota-status', (evt) => { if (evt && evt.payload) cb(evt.payload); });
    },

    // Trusted contact (5.2, Tier 2) — optional, solo-first accountability
    // amplifier. `getTrustedContact` resolves the configured contact or
    // `null` (nothing configured — the honest solo default). `setTrustedContact`
    // is a strengthening (instant) when wiring a NEW contact or editing one
    // in place (same email); the backend itself refuses an email change on an
    // existing contact (that's a weakening — see `requestRemoveTrustedContact`).
    // `notify` is the raw `NotifyEventsV1` shape (snake_case keys — it's
    // deserialized directly, not through Tauri's camelCase arg mapping):
    // `{ uninstall_requested, lockdown_cancelled, password_removal_requested,
    // ext_removed, block_burst }`.
    getTrustedContact() {
      return invoke('get_trusted_contact').catch((e) => { console.warn('[OathLight] getTrustedContact failed:', e); return null; });
    },
    setTrustedContact(name, email, notify) {
      return invoke('set_trusted_contact', { name, email, notify });
    },
    // Removing a contact is a weakening (5.2's anti-weak-moment rule): friction-
    // gated AND the contact is notified of the REQUEST immediately, before the
    // delay even starts. Requires the master-password token if one is set.
    // Resolves to the same `{ action_id, label, ..., remaining_secs, ready }`
    // shape as `removeCustomDomain` — it shows up in `usePendingWeakenings()`
    // like any other pending change.
    requestRemoveTrustedContact(auth) {
      return invoke('request_remove_trusted_contact', { auth: auth || null });
    },

    // Tamper-evident event log (4.5) — see core/eventlog.rs for the format.
    // `getEventLog` resolves the most recent entries in the CURRENT log
    // segment, newest first, capped at `limit`. Never contains browsing
    // history or screen content — event only.
    getEventLog(limit) {
      return invoke('get_event_log', { limit: limit == null ? null : limit })
        .catch((e) => { console.warn('[OathLight] getEventLog failed:', e); return []; });
    },
    // Re-walks the WHOLE hash chain from genesis, across every rotated
    // segment, on demand — the "Verify integrity" button. Resolves to
    // `{ intact, entries, first_break_seq, chain_started, restarts }`; once
    // `intact` goes false it never "heals" even if the chain resumes
    // correctly afterward — see `VerifyReport`'s doc comment in eventlog.rs.
    verifyEventLog() {
      return invoke('verify_event_log')
        .catch((e) => { console.warn('[OathLight] verifyEventLog failed:', e); return null; });
    },

    // Lockdown Mode (4.4) — whitelist-only browsing, on demand. `getLockdownState`
    // resolves the clock-tamper-immune credited-time view:
    // `{ active, frozen, remaining_secs, active_until }`. `active_until` is a
    // wall-clock display estimate only, never authoritative — see lockdown.rs.
    getLockdownState() {
      return invoke('get_lockdown_state').catch((e) => { console.warn('[OathLight] getLockdownState failed:', e); return null; });
    },
    // Start (or extend/upgrade) a lockdown. STRENGTHENING — always instant,
    // never gated: extending never shortens the remaining time, and
    // upgrading normal -> frozen is monotonic (frozen never downgrades back).
    // Resolves to the same `LockdownView` shape as `getLockdownState`.
    startLockdown(durationSecs, frozen) {
      return invoke('start_lockdown', { durationSecs, frozen: !!frozen, auth: null });
    },
    // End a lockdown early — the WEAKENING half of 4.4's asymmetry. A normal
    // (non-frozen) lockdown goes through the ordinary friction delay under
    // the "lockdown.cancel" action id (master-password gated if one is set)
    // and resolves to the same `{ action_id, label, ..., remaining_secs,
    // ready }` shape as `removeCustomDomain` — it shows up in
    // `usePendingWeakenings()` like any other pending change. A FROZEN
    // lockdown REJECTS outright (no friction entry is ever registered for
    // one) — the promise rejects with the honest "wait it out" message;
    // callers must not treat that as a generic error to retry.
    cancelLockdown(auth) {
      return invoke('cancel_lockdown', { auth: auth || null });
    },
    // Additively allow one domain through an active lockdown (4.4's
    // anti-brick valve) — a short 60s friction delay under
    // "lockdown.allow:<domain>", master-password gated if one is set.
    requestLockdownAllow(domain, auth) {
      return invoke('request_lockdown_allow', { domain, auth: auth || null });
    },
    // Schedule-from-vulnerable-hours escalation (4.4 v2): auto-start a
    // (non-frozen) lockdown during the configured vulnerable-hours window
    // instead of only showing reminder pop-ups. Turning ON is instant (a
    // strengthening); turning OFF is a weakening — friction-gated under
    // "lockdown.escalation_disable", same `{ applied, pending }`
    // WeakeningOutcome shape as `setGuard`/`setDnsFilter`. Never touches an
    // already-active lockdown either way.
    setLockdownEscalation(enabled, auth) {
      return invoke('set_lockdown_escalation', { enabled: !!enabled, auth: auth || null });
    },

    // Grayscale during vulnerable hours (5.6). Instant in BOTH directions —
    // unlike every protection toggle here, this is an environment nudge and
    // deliberately isn't friction-gated (see grayscale.rs). Turning it off
    // also lifts the filter immediately if a window is running. Rejects with
    // a message on a platform/registry failure, so the caller can show it.
    setGrayscaleVulnerableHours(enabled) {
      return invoke('set_grayscale_vulnerable_hours', { enabled: !!enabled });
    },

    // Recovery data — urge log, slip log, streak (5.4/5.5). The BACKEND owns
    // this now (recovery.rs); the renderer's localStorage copy is only an
    // offline mirror for the standalone preview. Every one of these resolves
    // the full `RecoveryView` — `{ streak, best_streak, last_milestone, urges,
    // slips, gentle, clean_days_this_month, milestones }` — with everything
    // derived server-side, so the caller just replaces its state wholesale
    // rather than recomputing anything.
    getRecoveryLog() {
      return invoke('get_recovery_log').catch((e) => { console.warn('[OathLight] getRecoveryLog failed:', e); return null; });
    },
    logUrge(trigger, source) {
      return invoke('log_urge', { trigger: trigger || null, source: source || 'manual' })
        .catch((e) => { console.warn('[OathLight] logUrge failed:', e); return null; });
    },
    // Deliberately NOT friction-gated in the backend — see `log_slip`'s doc
    // comment. Logging a slip honestly is recovery, not a weakening.
    logSlip(trigger) {
      return invoke('log_slip', { trigger: trigger || null })
        .catch((e) => { console.warn('[OathLight] logSlip failed:', e); return null; });
    },
    markMilestone(days) {
      return invoke('mark_milestone', { days: days | 0 })
        .catch((e) => { console.warn('[OathLight] markMilestone failed:', e); return null; });
    },
    // One-time carry-over of a streak that predates the backend store. The
    // backend refuses anything that would shorten a streak or that arrives
    // after it has history of its own, so this is safe to call unconditionally.
    migrateRecoveryStreak(streakStart, bestStreak) {
      return invoke('migrate_recovery_streak', { streakStart: streakStart | 0, bestStreak: bestStreak | 0 })
        .catch(() => null);
    },

    // False-positive eval log (2.4). The user's own record of every time they
    // told the AI monitor it was wrong: `{ ts, monitor_id, siglip_nsfw,
    // nudenet_explicit, screen_hash, dwell_secs }`, newest first. Local only —
    // there is no upload path anywhere in the app, deliberately.
    getEvalLog(limit) {
      return invoke('get_eval_log', { limit: limit == null ? null : limit })
        .catch((e) => { console.warn('[OathLight] getEvalLog failed:', e); return []; });
    },

    // Serious Mode (UX Direction §1) — the single toggle that flips the whole
    // app to its strictest configuration and its hard voice, no per-feature
    // exceptions. Turning it ON is instant (a strengthening) and never needs
    // auth. Turning it OFF is the strongest-guarded weakening in the app:
    // friction-gated under `"serious.disable"` at DOUBLE the ordinary delay,
    // master-password gated if one is set, and the trusted contact is told at
    // request time. Same `{ applied, pending }` WeakeningOutcome shape as
    // `setGuard` — when `applied` is false the mode is still FULLY on and
    // stays that way until the delay elapses; callers must not pre-emptively
    // render it as off.
    setSeriousMode(enabled, auth) {
      return invoke('set_serious_mode', { enabled: !!enabled, auth: auth || null });
    },

    // Update mode (update.rs). `getUpdateState` resolves
    // `{ active, seconds_left, window_secs, app_version, recovery_armed }`.
    //
    // `beginUpdate` is the one that does something: it opens a bounded window
    // in which the dual-process watchdog stops resurrecting, so an installer
    // can actually replace the two executables, and then CLOSES THE APP about
    // two seconds later. Callers must treat a resolved promise as "the app is
    // going away now" and say so before it happens — there is no second
    // notification. Master-password gated, so it goes through PPAuth.acquire()
    // like every other gated call.
    //
    // `cancelUpdate` re-arms the guards; ungated, since strengthening never is.
    getUpdateState() {
      return invoke('get_update_state').catch((e) => {
        console.warn('[OathLight] getUpdateState failed:', e);
        return null;
      });
    },
    beginUpdate(auth) { return invoke('begin_update', { auth: auth || null }); },
    cancelUpdate() { return invoke('cancel_update'); },

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

  // React hook — mirrors the BACKEND's Serious Mode flag into the store
  // (UX Direction §1). The backend is the source of truth; this only copies
  // it down so the UI has something synchronous to render voice and visuals
  // from. Polled rather than pushed because the flag can change without any
  // renderer involvement at all — the friction applier thread flips it off
  // when the cool-off elapses, possibly while this window is closed.
  //
  // Mount once, high in the tree (App) — every other component reads
  // `s.serious` off the store rather than calling this again.
  window.useSeriousMode = function useSeriousMode() {
    React.useEffect(() => {
      if (!available) return;
      let cancelled = false;
      const refresh = () => invoke('get_app_settings').then((cfg) => {
        if (cancelled || !cfg) return;
        const on = !!cfg.serious_mode;
        // Only write on an actual change — PP.set notifies every subscriber,
        // and this runs on a timer.
        if (window.PP && window.PP.get().serious !== on) window.PP.set({ serious: on });
      }).catch(() => {});
      refresh();
      const id = setInterval(refresh, 4000);
      return () => { cancelled = true; clearInterval(id); };
    }, []);
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
