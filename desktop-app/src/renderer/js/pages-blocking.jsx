/* pages-blocking.jsx */
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
    window.PPNative.onProcessEnforcement((p) => push(`${p.name} — blocked list — killed`))
      .then((fn) => { if (cancelled) fn(); else unProc = fn; });
    // UX Direction §3: report WHAT happened, not which category of evasion it
    // was — the reason codes are still logged in full to the protection
    // history and the app log, they just aren't a taxonomy on screen.
    window.PPNative.onEvasionDetected((p) => push(
      `${p.name} — unrecognised browser — ${p.killed ? 'blocked' : 'detected (not blocked)'}`
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

  // PPAuth (master password, 4.2) may not exist in this build yet — the
  // defensive call means this works with or without it, and a cancelled
  // prompt (rejected with message 'cancelled') aborts silently.
  function acquireAuth() {
    return window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null);
  }

  function removeProc(name) {
    setErr('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.removeBlockedProcess(name, token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  }

  function keepBlockingProc(p) {
    window.PPNative.cancelWeakening(p.action_id).then(refresh);
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

  const blockedList = (cfg && cfg.blocked_processes) || [];
  const killUnknown = !!(cfg && cfg.block_unknown_browsers);

  return (
    <React.Fragment>
      <div className="setting" style={{ alignItems: 'flex-start' }}>
        <div className="ico"><IconGrid size={20} /></div>
        <div className="txt" style={{ flex: 1 }}>
          <b>App blocking</b>
          <span>Block distracting or explicit desktop apps by process name. This is friction, not a sandbox — a renamed .exe slips straight past it, on purpose accepted as a known limit rather than something faked as airtight.</span>

          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            <input
              className="input"
              placeholder="e.g. discord.exe"
              value={newProc}
              onChange={(e) => setNewProc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addProc()}
              style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" disabled={busy || !available} onClick={addProc}>
              <IconPlus size={15} /> Add
            </button>
          </div>

          {blockedList.length > 0 &&
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {blockedList.map((name) => (
                <div key={name} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', background: 'color-mix(in oklab, var(--muted) 7%, transparent)', borderRadius: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeProc(name)}>
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
          }

          {pendingRemovals.length > 0 &&
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pendingRemovals.map((p) => {
                const name = p.action_id.slice('process_block.remove:'.length);
                return (
                  <div key={p.action_id} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', background: 'color-mix(in oklab, #d9a441 12%, transparent)', borderRadius: 8 }}>
                    <span style={{ fontSize: 13 }}><b>{name}</b> — unblocks in {fmtDur(p.remaining_secs)}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => keepBlockingProc(p)}>Keep blocking</button>
                  </div>
                );
              })}
            </div>
          }

          {err && <div style={{ fontSize: 12, color: '#d9534f', marginTop: 8 }}>{err}</div>}
          {!available && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>App blocking controls are available in the desktop app.</div>}
        </div>
      </div>

      <div className="setting">
        <div className="ico"><IconShieldOff size={20} /></div>
        <div className="txt">
          {/* UX Direction §3 — "status yes, map no": this used to name the
              specific browsers it defends against, which is a list of things
              to go try. What the user needs here is what the switch DOES; the
              full threat model lives in SECURITY.md, outside the app. */}
          <b>Block unknown &amp; evasion browsers</b>
          <span>Close unrecognised browsers on sight instead of only recording them. Off by default — either way, anything unrecognised is written to your protection history.</span>
        </div>
        <Switch on={killUnknown} onClick={() => toggleEvasionKill(!killUnknown)} disabled={busy || !available} />
      </div>
      {evasionPending &&
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '-6px 0 10px 54px' }}>
          Turning off in {fmtDur(evasionPending.remaining_secs)} — cancel from Settings → Pending changes
        </div>
      }

      {recent.length > 0 &&
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', marginBottom: 6 }}>Recent detections (this session)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recent.map((r) => (
              <div key={r.id} style={{ fontSize: 12, color: 'var(--muted)' }}>
                {new Date(r.ts).toLocaleTimeString()} — {r.text}
              </div>
            ))}
          </div>
        </div>
      }
    </React.Fragment>
  );
}

// System-level DNS filter (plan items 1.1 + 1.2). A coarse whole-domain
// backstop for surfaces the browser extension can't reach — Tor, portable
// browsers, Electron apps — enforced by a local DNS resolver the desktop app
// points every network adapter at. The real gate lives in Rust
// (`set_dns_filter_enabled`); this is a view onto `get_dns_status` plus the
// instant-enable / friction-gated-disable requests.
function DnsFilterSection() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [status, setStatus] = React.useState(null); // { running, taken_over, last_error, upstreams }
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

  function acquireAuth() {
    return window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null);
  }

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

  function keepOn() {
    window.PPNative.cancelWeakening('dns.disable').then(refresh);
  }

  // Status line: off / active / active-but-not-taken-over / error.
  let statusText, statusColor;
  if (!status) { statusText = 'Loading…'; statusColor = 'var(--muted)'; }
  else if (status.last_error && !on) { statusText = status.last_error; statusColor = '#d9534f'; }
  else if (on && status.taken_over) {
    statusText = 'Active — filtering at the network level' + (status.upstreams && status.upstreams.length ? ' · upstream ' + status.upstreams.join(', ') : '');
    statusColor = 'var(--accent-2)';
  }
  else if (on && !status.taken_over) { statusText = status.last_error || 'Resolver running, but no network adapter could be redirected — needs administrator rights.'; statusColor = '#d9a441'; }
  else { statusText = 'Off — only the browser extension is filtering.'; statusColor = 'var(--muted)'; }

  return (
    <React.Fragment>
      <div className="setting" style={{ alignItems: 'flex-start' }}>
        <div className="ico"><IconShield size={20} /></div>
        <div className="txt" style={{ flex: 1 }}>
          {/* UX Direction §3 — the old copy enumerated exactly which apps the
              extension can't reach, i.e. a shopping list. Kept: what it does,
              what it costs (admin rights), and that it's opt-in. */}
          <b>System DNS filter</b>
          <span>
            Extends blocking beyond the browser to everything else on this computer. Needs administrator
            rights once, to take over DNS. Opt-in.
          </span>
          <div style={{ fontSize: 12.5, color: statusColor, marginTop: 8 }}>{statusText}</div>
          {err && <div style={{ fontSize: 12, color: '#d9534f', marginTop: 6 }}>{err}</div>}
          {!available && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Available in the desktop app.</div>}
        </div>
        <Switch on={on} onClick={toggle} disabled={busy || !available} />
      </div>
      {disablePending &&
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '-6px 0 10px 54px' }}>
          Turning off in {fmtDur(disablePending.remaining_secs)} — it stays fully active until then · cancel from Settings → Pending changes,{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); keepOn(); }} style={{ color: 'var(--accent-2)' }}>keep it on</a>
        </div>
      }
    </React.Fragment>
  );
}

// --- Lockdown Mode (Phase 4 item 4.4) ----------------------------------------
//
// Cold Turkey-style whitelist-only browsing, on demand — while active, only
// the ~110-domain mainstream allowlist (plus anything additively let through
// via the short `lockdown.allow` friction) is reachable; everything else
// blocks, full stop. Lives HERE on the Blocking page, not Settings: it's a
// blocking MODE that sits alongside the other enforcement controls in
// "Tamper protection & enforcement" (uninstall guard, app blocking, DNS
// filter) rather than an account-level preference — and it's the single most
// drastic lever on this page, so it gets its own dedicated card instead of
// being buried as one more settings row.
//
// Asymmetry (see src-tauri/lockdown.rs's module doc): starting/extending is
// always a STRENGTHENING — instant, unconditional, monotonic (extending
// never shortens the remaining time; upgrading normal -> frozen is allowed,
// frozen never downgrades back). Ending one early is the WEAKENING — a
// normal lockdown goes through the same friction delay as every other
// weakening (`lockdown.cancel`, master-password gated); a FROZEN lockdown
// refuses outright, on purpose — there's no cancel button for one at all,
// because that was the whole point of choosing frozen in the first place.
const LOCKDOWN_DURATIONS = [
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 2 * 3600, label: '2 hours' },
  { value: 4 * 3600, label: '4 hours' },
  { value: 8 * 3600, label: '8 hours' },
  { value: 24 * 3600, label: '24 hours' },
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
  // Same anchor-and-tick pattern as UninstallCard: the backend's credited-time
  // engine is the source of truth, this just derives a smooth 1s countdown
  // between re-syncs instead of hammering the backend every second.
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
    // just part of the same full-settings snapshot getAppSettings() already
    // returns (AppBlockingSection reads the same command for blocked_processes).
    window.PPNative.getAppSettings().then((s) => { if (s) setEscalate(!!(s.lockdown && s.lockdown.escalate_vulnerable_hours)); });
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Re-poll while mounted — a lockdown can end on its own (natural expiry, no
  // click involved), and a cancel/escalation-disable friction request can
  // resolve from elsewhere (e.g. the "Pending changes" card in Settings).
  React.useEffect(() => {
    if (!available) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [available, refresh]);
  React.useEffect(() => { refresh(); }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1s local ticker while active, re-synced from the backend every 5s above.
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

  const acquireAuth = () => (window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null));

  const start = () => {
    setErr('');
    const chosen = LOCKDOWN_DURATIONS.find((o) => o.value === durationSecs);
    const durationLabel = chosen ? chosen.label : fmtDur(durationSecs);
    const warn = frozenChoice
      ? '\n\nFrozen: once started, this CANNOT be cancelled early — only waited out. There is no override, no password bypass.'
      : '';
    if (!confirm(`Start a ${durationLabel} lockdown?\n\nOnly your allowlist stays reachable — everything else blocks, full stop, the whole time.${warn}`)) return;
    setBusy(true);
    window.PPNative.startLockdown(durationSecs, frozenChoice)
      .then((v) => applyView(v))
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const cancel = () => {
    if (!confirm('End the lockdown early?\n\nThis goes through the same waiting-period delay as any other protection change — the lockdown stays fully active until it elapses.')) return;
    setErr('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.cancelLockdown(token); })
      .then(() => refresh())
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  };

  const keepLockedDown = () => { window.PPNative.cancelWeakening('lockdown.cancel').then(refresh); };

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

  const keepEscalationOn = () => { window.PPNative.cancelWeakening('lockdown.escalation_disable').then(refresh); };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconLock size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Lockdown mode</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            The nuclear option: only a small mainstream allowlist stays reachable — everything else blocks, full
            stop, for exactly as long as you set. Meant for a genuinely hard day, not a daily habit.
          </div>

          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}

          {available && !view &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}

          {/* inactive → start */}
          {available && view && !view.active &&
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
              <label className="field">
                <span>Duration</span>
                <select className="input" value={durationSecs} onChange={(e) => setDurationSecs(Number(e.target.value))}>
                  {LOCKDOWN_DURATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={frozenChoice} onChange={(e) => setFrozenChoice(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <b style={{ color: frozenChoice ? '#ef4444' : 'var(--text-2)' }}>Frozen</b> — cannot be cancelled once
                  started, only waited out. No password, no override. Only choose this if that is exactly what you want.
                </span>
              </label>
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={start}>
                {busy ? 'Starting…' : 'Start lockdown'}
              </button>
            </div>}

          {/* active */}
          {available && view && view.active &&
            <div className="ut-pending" style={{ marginTop: 16 }}>
              <div className="ut-count">{fmtDur(liveRemaining)}</div>
              <div className="ut-sub">
                {view.frozen ? 'remaining · frozen — cannot be cancelled, only waited out' : 'remaining · lockdown active'}
              </div>
              {err && <div style={{ fontSize: 12.5, color: '#ef4444', marginTop: 10 }}>{err}</div>}

              {!view.frozen &&
                <button className="btn btn-ghost btn-sm" disabled={busy || !!cancelPending} onClick={cancel} style={{ marginTop: 14 }}>
                  End lockdown early
                </button>}

              {view.frozen &&
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14 }}>
                  This one is frozen — there is genuinely no way to cancel it. That was the point when it started.
                </div>}

              {cancelPending &&
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                  Ending in {fmtDur(cancelPending.remaining_secs)} — lockdown stays active until then · cancel from
                  Settings → Pending changes,{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); keepLockedDown(); }} style={{ color: 'var(--accent-2)' }}>keep it locked</a>
                </div>}
            </div>}

          {/* escalation toggle — visible regardless of whether a lockdown is active right now */}
          <div className="setting" style={{ marginTop: 12, paddingLeft: 0, paddingRight: 0 }}>
            <div className="txt">
              <b>Auto-lockdown during vulnerable hours</b>
              <span>When your vulnerable-hours window (set above, under Focus schedule &amp; reminders) starts, automatically
                begin a lockdown instead of only showing pop-ups. Never frozen — always cancellable through the normal delay.</span>
            </div>
            <Switch on={!!escalate} onClick={toggleEscalation} disabled={escBusy || escalate === null || !available} />
          </div>
          {escalationPending &&
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 0' }}>
              Turning off in {fmtDur(escalationPending.remaining_secs)} — cancel from Settings → Pending changes,{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); keepEscalationOn(); }} style={{ color: 'var(--accent-2)' }}>keep it on</a>
            </div>}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ icon: I, title, desc, on, onToggle, accent }) {
  return (
    <div className="setting">
      <div className="ico" style={accent ? { background: 'color-mix(in oklab, var(--accent-2) 14%, transparent)', color: 'var(--accent-2)' } : undefined}><I size={20} /></div>
      <div className="txt"><b>{title}</b><span>{desc}</span></div>
      <Switch on={on} onClick={onToggle} />
    </div>);

}

// --- Environment tools (plan item 5.6) --------------------------------------

// Two things that aren't blocking and shouldn't pretend to be: desaturating
// the screen during the risk window, and offering the user's own alternatives
// on the block page instead of only a wall.
//
// Note the friction asymmetry deliberately does NOT apply to the grayscale
// toggle — see `settings.rs`'s `grayscale_vulnerable_hours` and grayscale.rs.
// Turning it off unblocks nothing, and holding someone's display hostage for
// 24 hours over a wellbeing nudge would be applying a good rule in the wrong
// place.
function EnvironmentToolsCard({ s, PP }) {
  const available = !!(window.PPNative && window.PPNative.available);
  const b = s.blocking || {};
  const alts = b.alternatives || [];
  const [draft, setDraft] = React.useState('');
  const [draftUrl, setDraftUrl] = React.useState('');
  const [err, setErr] = React.useState('');

  const toggleGray = () => {
    const next = !b.grayscaleVulnerable;
    setErr('');
    // Mirror locally straight away; the backend owns the persisted value.
    PP.set({ blocking: { grayscaleVulnerable: next } });
    if (available) {
      window.PPNative.setGrayscaleVulnerableHours(next)
        .catch((e) => {
          setErr(e && e.message ? e.message : String(e));
          PP.set({ blocking: { grayscaleVulnerable: !next } });
        });
    }
  };

  const addAlt = () => {
    const text = draft.trim();
    if (!text) return;
    const url = draftUrl.trim();
    // Arrays are replaced wholesale by PP.set, so build the new one here.
    PP.set({ blocking: { alternatives: alts.concat([{ id: String(Date.now()), text, url }]) } });
    setDraft(''); setDraftUrl('');
  };
  const removeAlt = (id) => {
    PP.set({ blocking: { alternatives: alts.filter((a) => a.id !== id) } });
  };

  return (
    <div className="card fade-up" style={{ marginBottom: 18 }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Your environment</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, maxWidth: '60ch', lineHeight: 1.5 }}>
        Not blocking — these change what the hard hour feels like, and what you're offered
        instead of just a closed door.
      </div>

      <div className="setting">
        <div className="ico"><IconMoon size={20} /></div>
        <div className="txt">
          <b>Grayscale during vulnerable hours</b>
          <span>
            Drains the colour out of your whole screen while your risk window is running, then
            gives it back. On some Windows builds this takes effect at the next sign-in rather
            than instantly. You can switch it off any time — it isn't a protection.
          </span>
        </div>
        <Switch on={!!b.grayscaleVulnerable} onClick={toggleGray} disabled={!available} />
      </div>
      {err && <div style={{ fontSize: 12, color: '#d9534f', margin: '-6px 0 10px 54px' }}>{err}</div>}

      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '18px 0 4px' }}>
        Instead, I'd rather…
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, maxWidth: '60ch' }}>
        What you write here shows up on the block screen. Write it now, while you're thinking
        clearly — that's the whole trick. Leave it empty and the block screen won't invent
        advice of its own.
      </div>

      {alts.map((a) => (
        <div className="setting" key={a.id}>
          <div className="ico"><IconSpark size={20} /></div>
          <div className="txt"><b>{a.text}</b>{a.url && <span>{a.url}</span>}</div>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12.5 }}
                  onClick={() => removeAlt(a.id)}>Remove</button>
        </div>
      ))}

      {alts.length < 6 &&
        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Go do 20 push-ups" value={draft}
                 onChange={(e) => setDraft(e.target.value)} style={{ flex: '1 1 220px' }} />
          <input className="input" placeholder="Optional link" value={draftUrl}
                 onChange={(e) => setDraftUrl(e.target.value)} style={{ flex: '1 1 180px' }} />
          <button className="btn btn-ghost" onClick={addAlt} disabled={!draft.trim()}>Add</button>
        </div>}
    </div>
  );
}

function BlockingPage({ s, PP }) {
  const b = s.blocking;
  const set = (patch) => PP.set({ blocking: patch });
  // Friction (4.1): if the uninstall guard has a pending "turn off" request,
  // it's still fully ON (the backend never flips it early) — this is purely
  // an honest heads-up, not a countdown that gates anything here. `fmtDur` is
  // a plain top-level `function` declared in pages-settings.jsx; even though
  // that file loads AFTER this one (see index.html's script order), globals
  // resolve at *render* time, not at script-parse time, and by the time this
  // component actually renders every script has already run — so this is
  // safe. See pages-settings.jsx for the definition.
  const guardPending = (window.usePendingWeakenings || (() => []))().find((p) => p.action_id === 'guard.disable');
  const toggle = (k) => set({ [k]: !b[k] });
  // Turning the uninstall guard OFF is a weakening, gated behind the master
  // password (4.2) when one is set — turning it back ON is a strengthening
  // and stays instant/ungated (`toggle` above), same asymmetry as every
  // other friction rule in this codebase. Only the off-and-currently-on
  // click goes through `PPAuth.acquire()`.
  //
  // This calls `PPNative.setGuard` directly with the acquired token, rather
  // than just flipping the local store and letting app.jsx's reconciliation
  // effect push it — that effect deliberately passes no token (it's a
  // reconciler, not a user action; see its comment in app.jsx), so it alone
  // could never get past the backend's gate. The local store only flips
  // after the direct, gated call actually succeeds; a cancelled prompt or a
  // real error leaves the switch exactly where it was. (The reconciliation
  // effect still fires afterward when the store changes — redundant but
  // harmless: the friction request already exists, so its own ungated call
  // just gets rejected by the backend gate and is swallowed there.)
  const toggleGuard = () => {
    if (!b.uninstallGuard) { toggle('uninstallGuard'); return; }
    (window.PPAuth ? PPAuth.acquire() : Promise.resolve(null))
      .then((auth) => (window.PPNative && PPNative.available
        ? PPNative.setGuard(false, auth)
        : Promise.resolve({ applied: true })))
      .then(() => toggle('uninstallGuard'))
      .catch((e) => {
        if (!e || e.message !== 'cancelled') console.warn('[OathLight] toggleGuard failed:', e);
      });
  };
  // Block-screen mode toggles are mutually exclusive — enabling one disables
  // the others; toggling the active one off leaves them all disabled.
  const modeKeys = ['redirectLinkOn', 'redirectOffline', 'bgSongEnabled'];
  const setMode = (k) => {
    if (b[k]) { set({ [k]: false }); return; }
    const patch = { [k]: true };
    modeKeys.forEach((m) => { if (m !== k) patch[m] = false; });
    set(patch);
  };
  const setVuln = (patch) => set({ vulnerable: { ...b.vulnerable, ...patch } });
  const toggleAlert = (id) => set({ alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) });

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Blocking Settings</div>
        <h1 className="page-title">How firmly to <em style={{ fontFamily: "Manrope" }}>hold the line</em></h1>
        <p className="page-sub">Have custom Blocking settings, Like redirects, videos and more.</p>
      </div>

      {/* Strictness presets (6.4) — the same three the first-run wizard offers,
          reachable again here. `PP.applyPreset` can only ever strengthen, so
          switching down a level never turns a backend protection off; those
          keep their own friction-gated paths further down this page. */}
      <div className="card fade-up" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Strictness</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10, maxWidth: '60ch', lineHeight: 1.5 }}>
          A starting point, not a cage — every individual setting below stays yours to tune afterwards.
        </div>
        {(PP.PRESETS || []).map((p) => {
          const active = (b.strictness || 'standard') === p.id;
          return (
            <div className="setting" key={p.id}>
              <div className="ico"><IconSliders size={20} /></div>
              <div className="txt"><b>{p.name}</b><span>{p.desc}</span></div>
              <button className={'btn ' + (active ? 'btn-primary' : 'btn-ghost')}
                      onClick={() => PP.applyPreset(p.id)}>
                {active ? 'Selected' : 'Choose'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Environment tools (5.6) — grayscale hours + habit replacement.
          Neither of these blocks anything; they change what the hard hour
          feels like, and what the block screen offers instead of a wall. */}
      <EnvironmentToolsCard s={s} PP={PP} />

      {/* redirect & blocking screen */}
      <div className="card fade-up">
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Blocking screen redirect</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, maxWidth: '60ch', lineHeight: 1.5 }}>
          When a blocked site is visited, redirect to a motivational video or page instead of the default blocking screen.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* redirect URL */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconCompass size={20} /></div>
              <div className="txt">
                <b>Redirect link</b>
                <span>Where the user is sent — e.g. a motivational YouTube video</span>
              </div>
              <Switch on={b.redirectLinkOn} onClick={() => setMode('redirectLinkOn')} />
            </div>
            {b.redirectLinkOn &&
            <div className="redirect-expand" style={{ display: 'flex', gap: 10 }}>
              <input
                type="url"
                className="redirect-input"
                placeholder="https://youtube.com/watch?v=…"
                value={b.redirectUrl}
                onChange={(e) => set({ redirectUrl: e.target.value })}
                style={{ flex: 1 }} />
              {b.redirectUrl &&
              <button type="button" className="redirect-test" onClick={() => openRedirect(b.redirectUrl)}>
                  Test ↗
                </button>
              }
            </div>
            }
          </div>

          {/* offline download */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconArrowUp size={20} style={{ transform: 'rotate(180deg)' }} /></div>
              <div className="txt">
                <b>Download for offline use</b>
                <span>Video plays locally — works without internet access</span>
              </div>
              <Switch on={b.redirectOffline} onClick={() => setMode('redirectOffline')} />
            </div>
            {b.redirectOffline &&
            <div className="redirect-expand">
                <input
                type="text"
                className="redirect-input"
                placeholder="/Users/you/Videos/motivation.mp4"
                value={b.redirectOfflinePath}
                onChange={(e) => set({ redirectOfflinePath: e.target.value })} />
              </div>
            }
          </div>

          {/* background song */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconSpark size={20} /></div>
              <div className="txt">
                <b>Background audio on block screen</b>
                <span>Plays a calming track when the block screen appears</span>
              </div>
              <Switch on={b.bgSongEnabled} onClick={() => setMode('bgSongEnabled')} />
            </div>
            {b.bgSongEnabled &&
            <div className="redirect-expand">
                <input
                type="text"
                className="redirect-input"
                placeholder="/Users/you/Music/calm.mp3  or  https://…"
                value={b.bgSongPath}
                onChange={(e) => set({ bgSongPath: e.target.value })} />
              </div>
            }
          </div>
        </div>
      </div>

      {/* schedule & reminders */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Focus schedule &amp; reminders</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, marginBottom: 18, maxWidth: '60ch', lineHeight: 1.5 }}>
          Set your vulnerable hours and choose what kind of support shows up during them.
        </div>

        {/* vulnerable hours */}
        <div className="redirect-box">
          <div className="redirect-row">
            <div className="ico"><IconClock size={20} /></div>
            <div className="txt">
              <b>Vulnerable hours</b>
              <span>Pop ups & reminders run during this window</span>
            </div>
            <Switch on={b.vulnerable.on} onClick={() => setVuln({ on: !b.vulnerable.on })} />
          </div>
          {b.vulnerable.on &&
          <div className="redirect-expand" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label className="time-field">
                <span>From</span>
                <input type="time" className="time-input" value={b.vulnerable.start}
              onChange={(e) => setVuln({ start: e.target.value })} />
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>→</span>
              <label className="time-field">
                <span>To</span>
                <input type="time" className="time-input" value={b.vulnerable.end}
              onChange={(e) => setVuln({ end: e.target.value })} />
              </label>
            </div>
          }
        </div>

        {/* pop-up / reminder types */}
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Pop-ups &amp; reminders
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Choose which nudges you want to receive during your vulnerable hours.
        </div>
        {b.alerts.map((a) =>
        <SettingRow key={a.id} icon={IconBell} title={a.label} desc={a.desc}
        on={a.on} onToggle={() => toggleAlert(a.id)} />
        )}
      </div>

      {/* tamper protection & enforcement */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Tamper protection &amp; enforcement</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, marginBottom: 18, maxWidth: '60ch', lineHeight: 1.5 }}>
          What actually stops you from working around Oath Light — and what's still on the way.
        </div>

        {/* real, backend-enforced */}
        <div className="setting">
          <div className="ico"><IconShield size={20} /></div>
          <div className="txt">
            <b>Uninstall guard</b>
            <span>Force-installs the extension on Chromium browsers and re-applies the policy if it's removed (user-level lock now; machine-wide hardening later)</span>
          </div>
          <Switch on={b.uninstallGuard} onClick={toggleGuard} />
        </div>
        {guardPending &&
          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '-6px 0 10px 54px' }}>
            Turning off in {fmtDur(guardPending.remaining_secs)} — cancel from Settings → Pending changes
          </div>
        }

        {/* SafeSearch is enforced unconditionally by the extension — there's
            genuinely no switch for this, so we don't pretend there is one. */}
        <div className="setting">
          <div className="ico"><IconSearch size={20} /></div>
          <div className="txt">
            <b>SafeSearch enforcement</b>
            <span>Forced on every connected browser, permanently — it can't be turned off, on purpose</span>
          </div>
          <span className="chip" style={{ color: 'var(--accent-2)' }}>Always on</span>
        </div>

        {/* YouTube Restricted Mode — opt-in strictness, default OFF. The browser
            extension enforces it with a YouTube-Restrict: Strict header rule
            (the same mechanism school networks use), pushed down on the same
            channel as the redirect settings. */}
        <div className="setting">
          <div className="ico"><IconShield size={20} /></div>
          <div className="txt">
            <b>YouTube Restricted Mode (strict)</b>
            <span>Opt-in: the browser extension applies YouTube's strict Restricted Mode via a header rule, so YouTube filters mature videos & comments server-side</span>
          </div>
          <Switch on={!!b.youtubeRestrict} onClick={() => toggle('youtubeRestrict')} />
        </div>

        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          App &amp; process blocking
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Enforced by the desktop app in the background — no browser needed.
        </div>

        <AppBlockingSection />

        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Network-level DNS
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          A coarse backstop for apps that never touch the browser extension. Requires administrator rights.
        </div>

        <DnsFilterSection />

        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Coming soon
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Not built yet — shown honestly here instead of as a switch that would quietly do nothing.
        </div>

        <div className="setting">
          <div className="ico"><IconMoon size={20} /></div>
          <div className="txt">
            <b>Incognito blocking</b>
            <span>Stop private/incognito windows from being used to slip past filters</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="chip">Coming in Phase 4</span>
            <Switch on={false} disabled />
          </div>
        </div>

        <div className="setting">
          <div className="ico"><IconLock size={20} /></div>
          <div className="txt">
            <b>Settings lock</b>
            <span>Password-protect Oath Light's settings so they can't be changed without you</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="chip">Coming in Alpha</span>
            <Switch on={false} disabled />
          </div>
        </div>
      </div>

      {/* lockdown mode (4.4) — the single most drastic lever on this page, so
          it's a dedicated card rather than one more row above */}
      <LockdownCard />

    </div>);

}
window.BlockingPage = BlockingPage;