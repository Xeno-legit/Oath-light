/* pages-blocking.jsx — Blocking Settings.
 *
 * Layout rule for this page (and the reason it was rebuilt): every row is
 * `<Setting>` — icon, one-line title, at most one short line of description,
 * control at the end. Anything longer than that one line goes in an InfoDot,
 * not on the page. The old version put its full rationale inline under every
 * switch, which buried the switches themselves in prose.
 *
 * Section order is deliberate — how hard it blocks, what enforces that, what
 * watches the screen, when it applies, what you see when it fires, and finally
 * the one drastic lever. Reading top to bottom answers "how strict am I?"
 * before it answers "what happens at 11pm?".
 */

// Open the redirect URL for the "Test" button. Normalizes a scheme-less entry
// to https (same rule the extension uses), then opens it in the default browser
// via the native command, falling back to window.open outside Tauri.
function openRedirect(raw) {
  let u = (raw || '').trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (window.PPNative && window.PPNative.available) window.PPNative.openExternal(u);
  else window.open(u, '_blank', 'noopener');
}

// Shared by every section that calls a friction-gated backend command: resolve
// the master-password token (4.2), or `null` when no password is configured.
// Rejects with Error('cancelled') if the user dismissed the prompt.
function acquireAuth() {
  return window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null);
}

// A pending-weakening note, in the one shape every section here needs: what is
// turning off, when, and the one-click way to call it back. Previously each
// section hand-wrote this line and they had all drifted apart.
function PendingNote({ pending, whatKey, onKeep }) {
  if (!pending) return null;
  return (
    <div className="pending-note">
      {tRich('blocking.pending_note', { what: PP.t(whatKey), time: fmtDur(pending.remaining_secs) })}
      {onKeep &&
        <React.Fragment>{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onKeep(); }}>{PP.t('blocking.pending_keep')}</a>
        </React.Fragment>}
    </div>
  );
}

/* ---------------------------------------------------------------- strictness */

function StrictnessCard({ s, PP }) {
  const current = (s.blocking && s.blocking.strictness) || 'strict';
  const presets = PP.PRESETS || [];
  return (
    <SectionCard
      title={PP.t('blocking.strictness_title')}
      sub={PP.t('blocking.strictness_sub')}
      info={PP.t('blocking.strictness_info')}>
      <Choices>
        {presets.map((p) => (
          <Choice
            key={p.id}
            name={PP.t(p.nameKey)}
            desc={PP.t(p.descKey)}
            info={PP.t(p.infoKey)}
            selected={current === p.id}
            onSelect={() => PP.applyPreset(p.id)} />
        ))}
      </Choices>
    </SectionCard>
  );
}

/* --------------------------------------------------------------- protections */

// Process-level app blocking + evasion-browser detection (plan item 1.3).
// House rule: name-based process blocking is friction, not a sandbox — a
// renamed exe slips right past it, and that's an accepted limitation, not a
// bug to fix here. The kill decision itself always happens in Rust
// (`enforce_processes` in lib.rs); everything in this component is just a
// view onto that state plus the friction-gated removal/toggle requests.
function AppBlockingSection() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [cfg, setCfg] = React.useState(null); // { blocked_processes, block_unknown_browsers, ... }
  const [newProc, setNewProc] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  // Session-only — not persisted, just a live feed of what the backend has
  // emitted since this page mounted (last 6, newest first).
  const [recent, setRecent] = React.useState([]);

  const pending = (window.usePendingWeakenings || (() => []))();
  const pendingRemovals = pending.filter((p) => p.action_id.indexOf('process_block.remove:') === 0);
  const evasionPending = pending.find((p) => p.action_id === 'evasion_kill.disable');
  const browserLockPending = pending.find((p) => p.action_id === 'browser_lock.disable');

  const refresh = React.useCallback(() => {
    if (!available) return;
    window.PPNative.getAppSettings().then((s) => { if (s) setCfg(s); });
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Also refetch whenever the pending-weakening count changes — an applied
  // removal or an applied `evasion_kill.disable` needs the list/toggle here
  // to catch up without waiting on an unrelated re-render.
  React.useEffect(() => { refresh(); }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!available) return;
    let unProc = null, unEvasion = null, cancelled = false;
    const push = (text) => setRecent((r) => [{ id: Date.now() + Math.random(), ts: Date.now(), text }, ...r].slice(0, 6));
    window.PPNative.onProcessEnforcement((p) => push(PP.t('blocking.event_process_closed', { name: p.name })))
      .then((fn) => { if (cancelled) fn(); else unProc = fn; });
    // UX Direction §3: report WHAT happened, not which category of evasion it
    // was — the reason codes are still logged in full to the protection
    // history and the app log, they just aren't a taxonomy on screen.
    window.PPNative.onEvasionDetected((p) => push(
      PP.t(p.killed ? 'blocking.event_evasion_closed' : 'blocking.event_evasion_noted', { name: p.name })
    )).then((fn) => { if (cancelled) fn(); else unEvasion = fn; });
    return () => { cancelled = true; if (unProc) unProc(); if (unEvasion) unEvasion(); };
  }, [available]);

  function addProc() {
    const name = newProc.trim();
    if (!name || busy) return;
    setErr('');
    setBusy(true);
    window.PPNative.addBlockedProcess(name)
      .then(() => { setNewProc(''); refresh(); })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  function removeProc(name) {
    setErr('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.removeBlockedProcess(name, token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  }

  function toggleEvasionKill(enabled) {
    setErr('');
    if (enabled) {
      // Turning it on is a strengthening — instant, no auth needed.
      setBusy(true);
      window.PPNative.setBlockUnknownBrowsers(true, null)
        .then(() => refresh())
        .catch((e) => setErr(e && e.message ? e.message : String(e)))
        .finally(() => setBusy(false));
      return;
    }
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.setBlockUnknownBrowsers(false, token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  }

  // Same asymmetry as every other protection here: on instantly, off only
  // through auth + a cool-off.
  function toggleBrowserLock(enabled) {
    setErr('');
    if (enabled) {
      setBusy(true);
      window.PPNative.setBrowserLock(true, null)
        .then(() => refresh())
        .catch((e) => setErr(e && e.message ? e.message : String(e)))
        .finally(() => setBusy(false));
      return;
    }
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.setBrowserLock(false, token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  }

  const blockedList = (cfg && cfg.blocked_processes) || [];
  const killUnknown = !!(cfg && cfg.block_unknown_browsers);
  const browserLock = !!(cfg && cfg.lock_unverified_browsers);

  return (
    <React.Fragment>
      <Setting
        icon={IconGrid}
        title={PP.t('blocking.apps_title')}
        desc={blockedList.length
          ? PP.t('blocking.apps_desc_count', { count: blockedList.length })
          : PP.t('blocking.apps_desc_empty')}
        info={PP.t('blocking.apps_info')}>
        <span className="chip">{blockedList.length}</span>
      </Setting>

      <div className="sub-block">
        <div className="row" style={{ gap: 10 }}>
          <input
            className="input"
            placeholder={PP.t('blocking.apps_placeholder')}
            value={newProc}
            onChange={(e) => setNewProc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProc()}
            style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" disabled={busy || !available} onClick={addProc}>
            <IconPlus size={15} /> {PP.t('app.action_add')}
          </button>
        </div>

        {blockedList.length > 0 &&
          <div className="tag-list">
            {blockedList.map((name) => (
              <span key={name} className="tag">
                {name}
                <button className="tag-x" disabled={busy} aria-label={PP.t('blocking.apps_stop_blocking_aria', { name })}
                        onClick={() => removeProc(name)}><IconX size={13} /></button>
              </span>
            ))}
          </div>}

        {pendingRemovals.map((p) => {
          const name = p.action_id.slice('process_block.remove:'.length);
          return (
            <div key={p.action_id} className="pending-note">
              {tRich('blocking.apps_pending', { name, time: fmtDur(p.remaining_secs) })}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); window.PPNative.cancelWeakening(p.action_id).then(refresh); }}>
                {PP.t('blocking.apps_keep_blocking')}
              </a>
            </div>
          );
        })}

        {err && <div className="err-note">{err}</div>}
        {!available && <div className="muted-note">{PP.t('app.needs_desktop')}</div>}
      </div>

      {/* UX Direction §3 — "status yes, map no": this deliberately does not
          name the specific browsers it defends against, which would be a list
          of things to go try. */}
      <Setting
        icon={IconShieldOff}
        title={PP.t('blocking.evasion_title')}
        desc={PP.t(killUnknown ? 'blocking.evasion_desc_on' : 'blocking.evasion_desc_off')}
        info={PP.t('blocking.evasion_info')}>
        <Switch on={killUnknown} onClick={() => toggleEvasionKill(!killUnknown)} disabled={busy || !available} />
      </Setting>
      <PendingNote pending={evasionPending} whatKey="blocking.evasion_pending_what"
                   onKeep={() => window.PPNative.cancelWeakening('evasion_kill.disable').then(refresh)} />

      {/* Same "status yes, map no" rule: this says a browser that won't run the
          extension won't run, without naming which browser or why it's the one
          that can be made to behave this way. */}
      <Setting
        icon={IconLock}
        title={PP.t('blocking.browser_lock_title')}
        desc={PP.t(browserLock ? 'blocking.browser_lock_desc_on' : 'blocking.browser_lock_desc_off')}
        info={PP.t('blocking.browser_lock_info')}>
        <Switch on={browserLock} onClick={() => toggleBrowserLock(!browserLock)} disabled={busy || !available} />
      </Setting>
      <PendingNote pending={browserLockPending} whatKey="blocking.browser_lock_pending_what"
                   onKeep={() => window.PPNative.cancelWeakening('browser_lock.disable').then(refresh)} />

      {recent.length > 0 &&
        <div className="sub-block">
          <div className="sub-label">{PP.t('blocking.apps_session_label')}</div>
          {recent.map((r) => (
            <div key={r.id} className="muted-note" style={{ marginTop: 2 }}>
              {new Date(r.ts).toLocaleTimeString()} — {r.text}
            </div>
          ))}
        </div>}
    </React.Fragment>
  );
}

// System-level DNS filter (plan items 1.1 + 1.2). A coarse whole-domain
// backstop for surfaces the browser extension can't reach, enforced by a local
// DNS resolver the desktop app points every network adapter at. The real gate
// lives in Rust (`set_dns_filter_enabled`); this is a view onto `get_dns_status`
// plus the instant-enable / friction-gated-disable requests.
function DnsFilterSection() {
  const available = !!(window.PPNative && window.PPNative.available);
  // { running, taken_over, last_error, upstreams, upstream_warning, exposure_warning }
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  const pending = (window.usePendingWeakenings || (() => []))();
  const disablePending = pending.find((p) => p.action_id === 'dns.disable');

  const refresh = React.useCallback(() => {
    if (!available) return;
    window.PPNative.getDnsStatus().then((s) => { if (s) setStatus(s); });
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Re-poll while active (health/takeover state can flip on its own — e.g. the
  // failsafe restoring real DNS if the resolver dies) and whenever a pending
  // weakening resolves.
  React.useEffect(() => {
    if (!available) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [available, refresh]);
  React.useEffect(() => { refresh(); }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const on = !!(status && status.running);

  function toggle() {
    setErr('');
    if (!on) {
      // Turning it on is a strengthening — instant, no auth. A bind conflict
      // or missing-admin failure rejects; surface it verbatim.
      setBusy(true);
      window.PPNative.setDnsFilter(true, null)
        .then(() => refresh())
        .catch((e) => setErr(e && e.message ? e.message : String(e)))
        .finally(() => setBusy(false));
      return;
    }
    // Turning it off is a weakening — password gate (4.2) then friction delay.
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.setDnsFilter(false, token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  }

  // Status line: off / active / active-but-sidelined / active-but-not-taken-over
  // / error. The 'reduced' tone is deliberately NOT 'warn': nothing is broken
  // and there is nothing to restart, so it must not pull in the
  // restart-as-administrator note below.
  let statusText, statusTone;
  if (!status) { statusText = PP.t('app.loading'); statusTone = 'muted'; }
  else if (status.last_error && !on) { statusText = status.last_error; statusTone = 'danger'; }
  else if (on && status.taken_over && status.exposure_warning) { statusText = PP.t('blocking.dns_status_reduced'); statusTone = 'reduced'; }
  else if (on && status.taken_over) { statusText = PP.t('blocking.dns_status_active'); statusTone = 'ok'; }
  else if (on && !status.taken_over) { statusText = status.last_error || PP.t('blocking.dns_status_no_adapter'); statusTone = 'warn'; }
  else { statusText = PP.t('blocking.dns_status_off'); statusTone = 'muted'; }

  return (
    <React.Fragment>
      <Setting
        icon={IconGlobe}
        title={PP.t('blocking.dns_title')}
        desc={statusText}
        info={PP.t('blocking.dns_info')}>
        <Switch on={on} onClick={toggle} disabled={busy || !available} />
      </Setting>
      {statusTone === 'warn' &&
        <div className="warn-note">
          {PP.t('blocking.dns_warn_restart', { status: statusText })}
        </div>}
      {/* Separate from the status line on purpose: the filter IS working, the
          network isn't. Merging the two would make a bad Wi-Fi day look like a
          broken protection. */}
      {on && status && status.upstream_warning &&
        <div className="warn-note">{status.upstream_warning}</div>}
      {/* Third distinct case: the filter is working AND the network is fine, but
          the resolver is no longer in the DNS path, so it is covering less than
          the headline claims. Rust owns the wording (dns_filter.rs's
          `exposure_message`) because it knows which connection it found. */}
      {on && status && status.exposure_warning &&
        <div className="warn-note">{status.exposure_warning}</div>}
      {err && <div className="err-note">{err}</div>}
      <PendingNote pending={disablePending} whatKey="blocking.dns_pending_what"
                   onKeep={() => window.PPNative.cancelWeakening('dns.disable').then(refresh)} />
    </React.Fragment>
  );
}

function ProtectionsCard({ s, PP }) {
  const b = s.blocking;
  const set = (patch) => PP.set({ blocking: patch });
  const toggle = (k) => set({ [k]: !b[k] });
  const guardPending = (window.usePendingWeakenings || (() => []))().find((p) => p.action_id === 'guard.disable');

  // Turning the uninstall guard OFF is a weakening, gated behind the master
  // password (4.2) when one is set — turning it back ON is a strengthening and
  // stays instant/ungated, the same asymmetry as every other friction rule
  // here. Only the off-and-currently-on click goes through PPAuth.
  //
  // This calls `PPNative.setGuard` directly with the acquired token rather than
  // flipping the local store and letting app.jsx's reconciliation effect push
  // it — that effect deliberately passes no token (it's a reconciler, not a
  // user action), so it alone could never get past the backend gate. The store
  // only flips after the gated call actually succeeds.
  const toggleGuard = () => {
    if (!b.uninstallGuard) { toggle('uninstallGuard'); return; }
    acquireAuth()
      .then((auth) => (window.PPNative && PPNative.available
        ? PPNative.setGuard(false, auth)
        : Promise.resolve({ applied: true })))
      .then(() => toggle('uninstallGuard'))
      .catch((e) => {
        if (!e || e.message !== 'cancelled') console.warn('[OathLight] toggleGuard failed:', e);
      });
  };

  return (
    <SectionCard
      title={PP.t('blocking.protection_title')}
      sub={PP.t('blocking.protection_sub')}
      info={PP.t('blocking.protection_info')}>

      <Setting
        icon={IconShield}
        title={PP.t('blocking.guard_title')}
        desc={PP.t(b.uninstallGuard ? 'blocking.guard_desc_on' : 'app.state_off')}
        info={PP.t('blocking.guard_info')}>
        <Switch on={b.uninstallGuard} onClick={toggleGuard} />
      </Setting>
      <PendingNote pending={guardPending} whatKey="blocking.guard_pending_what" />

      <Setting
        icon={IconSearch}
        title={PP.t('blocking.safesearch_title')}
        desc={PP.t('blocking.safesearch_desc')}
        info={PP.t('blocking.safesearch_info')}>
        <span className="chip chip-ok">{PP.t('blocking.safesearch_chip')}</span>
      </Setting>

      <Setting
        icon={IconShield}
        title={PP.t('blocking.youtube_title')}
        desc={PP.t(b.youtubeRestrict ? 'app.state_on' : 'app.state_off')}
        info={PP.t('blocking.youtube_info')}>
        <Switch on={!!b.youtubeRestrict} onClick={() => toggle('youtubeRestrict')} />
      </Setting>

      <div className="sub-label">{PP.t('blocking.sub_apps')}</div>
      <AppBlockingSection />

      <div className="sub-label">{PP.t('blocking.sub_network')}</div>
      <DnsFilterSection />
    </SectionCard>
  );
}

/* ------------------------------------------------------------- screen monitor */

// The on-device AI screen monitor. It used to be a top-level page of its own,
// which framed a protection as a dashboard; it belongs with the other
// protections. Enabling it is gated behind an explicit warning because — unlike
// everything else on this page — it looks at the screen itself, and nobody
// should turn that on without having been told so in plain words.
//
// Nothing about the model or the pipeline changed in the move: this is still a
// view onto the backend's `nsfw-scan` / `nsfw-overlay` events plus the same
// friction-gated stop request.
function MonitorSection() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [running, setRunning] = React.useState(false);
  const [last, setLast] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [showDetail, setShowDetail] = React.useState(false);

  const stopPending = (window.usePendingWeakenings || (() => []))()
    .find((p) => p.action_id === 'monitor.disable') || null;

  React.useEffect(() => {
    if (!available) return;
    let unlisten = null, cancelled = false;
    PPNative.nsfwMonitorRunning().then((r) => { if (!cancelled) setRunning(r); });
    PPNative.onNsfwScan((scan) => setLast(scan))
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, [available]);

  // Re-sync the real running state whenever the pending stop appears or
  // disappears — the backend's applier thread does the actual stop once the
  // delay elapses (and a cancel from Settings withdraws it); either way this
  // notices and keeps the status honest.
  React.useEffect(() => {
    if (!available) return;
    PPNative.nsfwMonitorRunning().then(setRunning);
  }, [!!stopPending, available]);

  const start = () => {
    setErr('');
    setConfirming(false);
    PPNative.startNsfwMonitor().then(() => setRunning(true))
      .catch((e) => setErr(String(e && e.message || e)));
  };

  // Stopping is a friction-gated weakening (4.1): the backend resolves
  // { applied, pending } instead of just stopping. `applied` true means there
  // was nothing to weaken (it was already stopped). When `applied` is false the
  // monitor is still running and the pending request shows up within one poll.
  const stop = () => {
    acquireAuth()
      .then((auth) => PPNative.stopNsfwMonitor(auth))
      .then((outcome) => { if (outcome && outcome.applied) setRunning(false); })
      .catch((e) => {
        if (e && e.message === 'cancelled') return;
        setErr(String(e && e.message || e));
      });
  };

  return (
    <SectionCard
      title={PP.t('blocking.monitor_title')}
      sub={PP.t('blocking.monitor_sub')}
      info={PP.t('blocking.monitor_info')}>

      <Setting
        icon={IconSearch}
        title={PP.t('blocking.monitor_row_title')}
        desc={PP.t(running ? 'blocking.monitor_running' : 'app.state_off')}
        tone={running ? 'ok' : undefined}
        info={PP.t('blocking.monitor_row_info')}>
        {running
          ? <button className="btn btn-ghost btn-sm" onClick={stop} disabled={!!stopPending}>{PP.t('blocking.monitor_turn_off')}</button>
          : <button className="btn btn-primary btn-sm" disabled={!available} onClick={() => setConfirming(true)}>{PP.t('blocking.monitor_turn_on')}</button>}
      </Setting>

      {/* The warning. Deliberately a blocking step rather than fine print: this
          is the one protection that reads the screen, so consent to that is
          collected explicitly, once, before it ever starts. */}
      {confirming &&
        <div className="warn-panel">
          <div className="warn-panel-title"><IconShield size={17} /> {PP.t('blocking.monitor_consent_title')}</div>
          <ul className="warn-panel-list">
            <li>{PP.t('blocking.monitor_consent_1')}</li>
            <li>{PP.t('blocking.monitor_consent_2')}</li>
            <li>{PP.t('blocking.monitor_consent_3')}</li>
            <li>{PP.t('blocking.monitor_consent_4')}</li>
          </ul>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={start}>{PP.t('blocking.monitor_consent_cta')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>{PP.t('app.action_cancel')}</button>
          </div>
        </div>}

      <PendingNote pending={stopPending} whatKey="blocking.monitor_pending_what" />
      {err && <div className="err-note">{err}</div>}
      {!available && <div className="muted-note">{PP.t('app.needs_desktop')}</div>}

      {/* The live readout is diagnostics, not a setting — collapsed by default
          so it stops competing with the controls above it. */}
      {running &&
        <React.Fragment>
          <button className="disclose" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>
            <IconChevron size={15} className={showDetail ? 'disclose-open' : ''} />
            {PP.t(showDetail ? 'blocking.monitor_hide_readout' : 'blocking.monitor_show_readout')}
          </button>
          {showDetail &&
            <div className="sub-block">
              {last
                ? <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {last.thumb &&
                      <img src={last.thumb} alt={PP.t('blocking.monitor_capture_alt')}
                           style={{ width: 200, borderRadius: 10, display: 'block' }} />}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{last.top_label}</div>
                      <div className="muted-note">
                        {PP.t('blocking.monitor_reading', {
                          score: (last.top_score * 100).toFixed(1),
                          time: new Date(last.ts).toLocaleTimeString(),
                        })}
                      </div>
                    </div>
                  </div>
                : <div className="muted-note">{PP.t('blocking.monitor_waiting')}</div>}
            </div>}
        </React.Fragment>}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ schedule */

function ScheduleCard({ s, PP }) {
  const b = s.blocking;
  const available = !!(window.PPNative && window.PPNative.available);
  const set = (patch) => PP.set({ blocking: patch });
  const setVuln = (patch) => set({ vulnerable: { ...b.vulnerable, ...patch } });
  const toggleAlert = (id) => set({ alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) });
  const [grayErr, setGrayErr] = React.useState('');

  // The friction asymmetry deliberately does NOT apply to grayscale — see
  // settings.rs's `grayscale_vulnerable_hours`. Turning it off unblocks
  // nothing, and holding someone's display hostage for 24 hours over a
  // wellbeing nudge would be applying a good rule in the wrong place.
  const toggleGray = () => {
    const next = !b.grayscaleVulnerable;
    setGrayErr('');
    set({ grayscaleVulnerable: next });
    if (available) {
      window.PPNative.setGrayscaleVulnerableHours(next).catch((e) => {
        setGrayErr(e && e.message ? e.message : String(e));
        set({ grayscaleVulnerable: !next });
      });
    }
  };

  return (
    <SectionCard
      title={PP.t('blocking.schedule_title')}
      sub={PP.t('blocking.schedule_sub')}
      info={PP.t('blocking.schedule_info')}>

      <Setting
        icon={IconClock}
        title={PP.t('blocking.vulnerable_title')}
        desc={b.vulnerable.on ? `${b.vulnerable.start} → ${b.vulnerable.end}` : PP.t('app.state_off')}
        info={PP.t('blocking.vulnerable_info')}>
        <Switch on={b.vulnerable.on} onClick={() => setVuln({ on: !b.vulnerable.on })} />
      </Setting>

      {b.vulnerable.on &&
        <div className="sub-block">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="time-field">
              <span>{PP.t('blocking.time_from')}</span>
              <input type="time" className="time-input" value={b.vulnerable.start}
                     onChange={(e) => setVuln({ start: e.target.value })} />
            </label>
            <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>→</span>
            <label className="time-field">
              <span>{PP.t('blocking.time_to')}</span>
              <input type="time" className="time-input" value={b.vulnerable.end}
                     onChange={(e) => setVuln({ end: e.target.value })} />
            </label>
          </div>
        </div>}

      <Setting
        icon={IconMoon}
        title={PP.t('blocking.grayscale_title')}
        desc={PP.t(b.grayscaleVulnerable ? 'blocking.grayscale_desc_on' : 'app.state_off')}
        info={PP.t('blocking.grayscale_info')}>
        <Switch on={!!b.grayscaleVulnerable} onClick={toggleGray} disabled={!available} />
      </Setting>
      {grayErr && <div className="err-note">{grayErr}</div>}

      <div className="sub-label">{PP.t('blocking.nudges_label')}</div>
      {b.alerts.map((a) =>
        <Setting key={a.id} icon={IconBell}
                 title={a.labelKey ? PP.t(a.labelKey) : a.label}
                 desc={a.descKey ? PP.t(a.descKey) : a.desc}>
          <Switch on={a.on} onClick={() => toggleAlert(a.id)} />
        </Setting>
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------- block screen */

function BlockScreenCard({ s, PP }) {
  const b = s.blocking;
  const alts = b.alternatives || [];
  const set = (patch) => PP.set({ blocking: patch });
  const [draft, setDraft] = React.useState('');
  const [draftUrl, setDraftUrl] = React.useState('');

  const addAlt = () => {
    const text = draft.trim();
    if (!text) return;
    // Arrays are replaced wholesale by PP.set, so build the new one here.
    set({ alternatives: alts.concat([{ id: String(Date.now()), text, url: draftUrl.trim() }]) });
    setDraft(''); setDraftUrl('');
  };
  const removeAlt = (id) => set({ alternatives: alts.filter((a) => a.id !== id) });

  return (
    <SectionCard
      title={PP.t('blocking.blockscreen_title')}
      sub={PP.t('blocking.blockscreen_sub')}
      info={PP.t('blocking.blockscreen_info')}>

      <Setting
        icon={IconCompass}
        title={PP.t('blocking.redirect_title')}
        desc={b.redirectLinkOn
          ? (b.redirectUrl || PP.t('blocking.redirect_desc_unset'))
          : PP.t('blocking.redirect_desc_off')}
        info={PP.t('blocking.redirect_info')}>
        <Switch on={b.redirectLinkOn} onClick={() => set({ redirectLinkOn: !b.redirectLinkOn })} />
      </Setting>

      {b.redirectLinkOn &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10 }}>
            <input
              type="url"
              className="input"
              placeholder={PP.t('blocking.redirect_placeholder')}
              value={b.redirectUrl}
              onChange={(e) => set({ redirectUrl: e.target.value })}
              style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!b.redirectUrl}
                    onClick={() => openRedirect(b.redirectUrl)}>{PP.t('app.action_test')}</button>
          </div>
        </div>}

      <div className="sub-label">{PP.t('blocking.alternatives_label')}</div>
      {alts.map((a) => (
        <Setting key={a.id} icon={IconSpark} title={a.text} desc={a.url || undefined}>
          <button className="btn btn-ghost btn-sm" onClick={() => removeAlt(a.id)}>{PP.t('app.action_remove')}</button>
        </Setting>
      ))}

      {alts.length < 6 &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder={PP.t('blocking.alternatives_placeholder')} value={draft}
                   onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && addAlt()}
                   style={{ flex: '1 1 220px' }} />
            <input className="input" placeholder={PP.t('blocking.alternatives_link_placeholder')} value={draftUrl}
                   onChange={(e) => setDraftUrl(e.target.value)} style={{ flex: '1 1 160px' }} />
            <button className="btn btn-ghost btn-sm" onClick={addAlt} disabled={!draft.trim()}>{PP.t('app.action_add')}</button>
          </div>
        </div>}
    </SectionCard>
  );
}

/* ---------------------------------------------------------------- lockdown */

// Cold Turkey-style allowlist-only browsing, on demand — while active, only the
// mainstream allowlist is reachable; everything else blocks, full stop.
//
// Asymmetry (see src-tauri/lockdown.rs's module doc): starting/extending is
// always a STRENGTHENING — instant, unconditional, monotonic. Ending one early
// is the WEAKENING — a normal lockdown goes through the same friction delay as
// every other weakening; a FROZEN lockdown refuses outright, on purpose,
// because that was the whole point of choosing frozen.
const LOCKDOWN_DURATIONS = [
  { value: 1800, labelKey: 'lockdown.duration_30m' },
  { value: 3600, labelKey: 'lockdown.duration_1h' },
  { value: 2 * 3600, labelKey: 'lockdown.duration_2h' },
  { value: 4 * 3600, labelKey: 'lockdown.duration_4h' },
  { value: 8 * 3600, labelKey: 'lockdown.duration_8h' },
  { value: 24 * 3600, labelKey: 'lockdown.duration_24h' },
];

function LockdownCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [view, setView] = React.useState(null); // { active, frozen, remaining_secs, active_until }
  const [escalate, setEscalate] = React.useState(null); // null = loading
  const [durationSecs, setDurationSecs] = React.useState(3600);
  const [frozenChoice, setFrozenChoice] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [escBusy, setEscBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [, tick] = React.useReducer((x) => x + 1, 0);
  // The backend's credited-time engine is the source of truth; this just
  // derives a smooth 1s countdown between re-syncs instead of hammering it.
  const ref = React.useRef({ at: 0, remaining: 0 });

  const pending = (window.usePendingWeakenings || (() => []))();
  const cancelPending = pending.find((p) => p.action_id === 'lockdown.cancel');
  const escalationPending = pending.find((p) => p.action_id === 'lockdown.escalation_disable');

  const applyView = (v) => {
    setView(v);
    ref.current = { at: Date.now(), remaining: v ? v.remaining_secs : 0 };
  };

  const refresh = React.useCallback(() => {
    if (!available) return;
    window.PPNative.getLockdownState().then((v) => { if (v) applyView(v); });
    // No dedicated "get lockdown escalation" command — SettingsV1.lockdown is
    // part of the same full-settings snapshot getAppSettings() already returns.
    window.PPNative.getAppSettings().then((s) => { if (s) setEscalate(!!(s.lockdown && s.lockdown.escalate_vulnerable_hours)); });
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Re-poll while mounted — a lockdown can end on its own (natural expiry, no
  // click involved), and a cancel/escalation-disable can resolve from Settings.
  React.useEffect(() => {
    if (!available) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [available, refresh]);
  React.useEffect(() => { refresh(); }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!view || !view.active) return;
    const id = setInterval(() => {
      const left = ref.current.remaining - (Date.now() - ref.current.at) / 1000;
      if (left <= 0) refresh(); else tick();
    }, 1000);
    return () => clearInterval(id);
  }, [view, refresh]);

  const liveRemaining = view && view.active
    ? Math.max(0, Math.round(ref.current.remaining - (Date.now() - ref.current.at) / 1000))
    : 0;

  const start = () => {
    setErr('');
    const chosen = LOCKDOWN_DURATIONS.find((o) => o.value === durationSecs);
    const durationLabel = chosen ? PP.t(chosen.labelKey) : fmtDur(durationSecs);
    const warn = frozenChoice ? PP.t('lockdown.confirm_start_frozen_note') : '';
    if (!confirm(PP.t('lockdown.confirm_start', { duration: durationLabel }) + warn)) return;
    setBusy(true);
    window.PPNative.startLockdown(durationSecs, frozenChoice)
      .then((v) => applyView(v))
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const cancel = () => {
    if (!confirm(PP.t('lockdown.confirm_cancel'))) return;
    setErr('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.cancelLockdown(token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  };

  const toggleEscalation = () => {
    setErr('');
    if (!escalate) {
      // Turning it on is a strengthening — instant, no auth.
      setEscBusy(true);
      window.PPNative.setLockdownEscalation(true, null)
        .then(() => setEscalate(true))
        .catch((e) => setErr(e && e.message ? e.message : String(e)))
        .finally(() => setEscBusy(false));
      return;
    }
    acquireAuth()
      .then((token) => { setEscBusy(true); return window.PPNative.setLockdownEscalation(false, token); })
      .then((outcome) => { if (outcome && outcome.applied) setEscalate(false); refresh(); })
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setEscBusy(false));
  };

  return (
    <SectionCard
      title={PP.t('lockdown.section_title')}
      sub={PP.t('lockdown.section_sub')}
      info={PP.t('lockdown.section_info')}>

      {!available && <div className="muted-note">{PP.t('app.needs_desktop')}</div>}
      {available && !view && <div className="muted-note">{PP.t('app.loading')}</div>}

      {/* inactive → start */}
      {available && view && !view.active &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '0 0 180px' }}>
              <span>{PP.t('lockdown.duration_label')}</span>
              <select className="input" value={durationSecs} onChange={(e) => setDurationSecs(Number(e.target.value))}>
                {LOCKDOWN_DURATIONS.map((o) => <option key={o.value} value={o.value}>{PP.t(o.labelKey)}</option>)}
              </select>
            </label>
            <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={start}>
              {PP.t(busy ? 'lockdown.starting' : 'lockdown.start_button')}
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={frozenChoice} onChange={(e) => setFrozenChoice(e.target.checked)} />
            <span className={frozenChoice ? 'frozen-armed' : undefined}>
              {tRich('lockdown.frozen_choice')}
              <InfoDot label={PP.t('lockdown.frozen_choice_info_label')}>
                {PP.t('lockdown.frozen_choice_info')}
              </InfoDot>
            </span>
          </label>
          {err && <div className="err-note">{err}</div>}
        </div>}

      {/* active */}
      {available && view && view.active &&
        <div className="sub-block" style={{ marginTop: 4 }}>
          <div className="ut-count">{fmtDur(liveRemaining)}</div>
          <div className="ut-sub">
            {PP.t(view.frozen ? 'lockdown.remaining_note_frozen' : 'lockdown.remaining_note')}
          </div>
          {err && <div className="err-note">{err}</div>}
          {!view.frozen &&
            <button className="btn btn-ghost btn-sm" disabled={busy || !!cancelPending} onClick={cancel} style={{ marginTop: 14 }}>
              {PP.t('lockdown.end_early_short')}
            </button>}
          {view.frozen &&
            <div className="muted-note" style={{ marginTop: 12 }}>
              {PP.t('lockdown.frozen_note')}
            </div>}
          {cancelPending &&
            <div className="pending-note">
              {tRich('lockdown.cancel_pending', { time: fmtDur(cancelPending.remaining_secs) })}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); window.PPNative.cancelWeakening('lockdown.cancel').then(refresh); }}>
                {PP.t('lockdown.keep_locked')}
              </a>
            </div>}
        </div>}

      <Setting
        icon={IconLock}
        title={PP.t('lockdown.escalation_title')}
        desc={PP.t(escalate ? 'app.state_on' : 'app.state_off')}
        info={PP.t('lockdown.escalation_info')}>
        <Switch on={!!escalate} onClick={toggleEscalation} disabled={escBusy || escalate === null || !available} />
      </Setting>
      <PendingNote pending={escalationPending} whatKey="lockdown.escalation_pending_what"
                   onKeep={() => window.PPNative.cancelWeakening('lockdown.escalation_disable').then(refresh)} />
    </SectionCard>
  );
}

/* -------------------------------------------------------------------- page */

function BlockingPage({ s, PP }) {
  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">{PP.t('blocking.eyebrow')}</div>
        <h1 className="page-title">{tRich('blocking.title')}</h1>
        <p className="page-sub">{PP.t('blocking.sub')}</p>
      </div>

      <StrictnessCard s={s} PP={PP} />
      <ProtectionsCard s={s} PP={PP} />
      <MonitorSection />
      <ScheduleCard s={s} PP={PP} />
      <BlockScreenCard s={s} PP={PP} />
      <LockdownCard />
    </div>
  );
}

window.BlockingPage = BlockingPage;
