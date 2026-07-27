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
function PendingNote({ pending, what, onKeep }) {
  if (!pending) return null;
  return (
    <div className="pending-note">
      {what} turns off in <b>{fmtDur(pending.remaining_secs)}</b> — it stays fully active until then.
      {onKeep &&
        <React.Fragment>{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onKeep(); }}>Keep it on</a>
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
      title="Strictness"
      sub="Strict is the floor. There is no gentler setting — that is the point."
      info="Every individual protection below stays yours to tune afterwards. Changing preset can only ever turn things ON: nothing here can quietly weaken a protection, because weakening always goes through the waiting period instead.">
      <div className="strict-choices">
        {presets.map((p) => {
          const active = current === p.id;
          return (
            /* The whole card is the hit target, but the info dot inside it is
               its own button — so the pick button is a sibling overlay rather
               than a wrapper. Nesting one button inside another would both be
               invalid markup and make opening the info bubble silently apply
               the preset. */
            <div key={p.id} className={'strict-choice' + (active ? ' sel' : '')}>
              <button className="strict-choice-hit" aria-pressed={active}
                      onClick={() => PP.applyPreset(p.id)}>
                <span className="sr-only">{active ? `${p.name}, selected` : `Choose ${p.name}`}</span>
              </button>
              <div className="strict-choice-head">
                <span className="strict-choice-name">
                  {p.name}
                  {p.info && <InfoDot label={`About ${p.name}`}>{p.info}</InfoDot>}
                </span>
                {active && <span className="strict-choice-mark"><IconCheck size={14} /></span>}
              </div>
              <div className="strict-choice-desc">{p.desc}</div>
            </div>
          );
        })}
      </div>
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
    window.PPNative.onProcessEnforcement((p) => push(`${p.name} — blocked list — closed`))
      .then((fn) => { if (cancelled) fn(); else unProc = fn; });
    // UX Direction §3: report WHAT happened, not which category of evasion it
    // was — the reason codes are still logged in full to the protection
    // history and the app log, they just aren't a taxonomy on screen.
    window.PPNative.onEvasionDetected((p) => push(
      `${p.name} — unrecognised browser — ${p.killed ? 'closed' : 'noted'}`
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

  const blockedList = (cfg && cfg.blocked_processes) || [];
  const killUnknown = !!(cfg && cfg.block_unknown_browsers);

  return (
    <React.Fragment>
      <Setting
        icon={IconGrid}
        title="Blocked apps"
        desc={blockedList.length ? `${blockedList.length} blocked by process name` : 'Nothing blocked yet'}
        info="Closes desktop apps by process name whenever they start. This is friction, not a sandbox — a renamed .exe walks straight past it. Adding one is instant; removing one goes through the waiting period.">
        <span className="chip">{blockedList.length}</span>
      </Setting>

      <div className="sub-block">
        <div className="row" style={{ gap: 10 }}>
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
          <div className="tag-list">
            {blockedList.map((name) => (
              <span key={name} className="tag">
                {name}
                <button className="tag-x" disabled={busy} aria-label={`Stop blocking ${name}`}
                        onClick={() => removeProc(name)}><IconX size={13} /></button>
              </span>
            ))}
          </div>}

        {pendingRemovals.map((p) => {
          const name = p.action_id.slice('process_block.remove:'.length);
          return (
            <div key={p.action_id} className="pending-note">
              <b>{name}</b> unblocks in <b>{fmtDur(p.remaining_secs)}</b>.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); window.PPNative.cancelWeakening(p.action_id).then(refresh); }}>
                Keep blocking it
              </a>
            </div>
          );
        })}

        {err && <div className="err-note">{err}</div>}
        {!available && <div className="muted-note">Available in the desktop app.</div>}
      </div>

      {/* UX Direction §3 — "status yes, map no": this deliberately does not
          name the specific browsers it defends against, which would be a list
          of things to go try. */}
      <Setting
        icon={IconShieldOff}
        title="Close unrecognised browsers"
        desc={killUnknown ? 'Closed on sight' : 'Recorded, not closed'}
        info="Some browsers can't be reached by the extension at all. With this on, they're closed as soon as they start. Either way, anything unrecognised is written to your protection history.">
        <Switch on={killUnknown} onClick={() => toggleEvasionKill(!killUnknown)} disabled={busy || !available} />
      </Setting>
      <PendingNote pending={evasionPending} what="Closing unrecognised browsers"
                   onKeep={() => window.PPNative.cancelWeakening('evasion_kill.disable').then(refresh)} />

      {recent.length > 0 &&
        <div className="sub-block">
          <div className="sub-label">This session</div>
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

  // Status line: off / active / active-but-not-taken-over / error.
  let statusText, statusTone;
  if (!status) { statusText = 'Loading…'; statusTone = 'muted'; }
  else if (status.last_error && !on) { statusText = status.last_error; statusTone = 'danger'; }
  else if (on && status.taken_over) { statusText = 'Filtering every app on this computer'; statusTone = 'ok'; }
  else if (on && !status.taken_over) { statusText = status.last_error || 'Running, but no adapter could be redirected — needs administrator rights'; statusTone = 'warn'; }
  else { statusText = 'Off — only the browser extension is filtering'; statusTone = 'muted'; }

  return (
    <React.Fragment>
      <Setting
        icon={IconGlobe}
        title="System DNS filter"
        desc={statusText}
        info="Extends blocking past the browser to every other app on this computer. Needs administrator rights once, to take over DNS. Opt-in — turning it on is instant, turning it off goes through the waiting period.">
        <Switch on={on} onClick={toggle} disabled={busy || !available} />
      </Setting>
      {statusTone === 'warn' &&
        <div className="warn-note">
          {statusText}. Restart Oath Light as administrator and switch this on again.
        </div>}
      {err && <div className="err-note">{err}</div>}
      <PendingNote pending={disablePending} what="The DNS filter"
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
      title="Protection"
      sub="What actually keeps Oath Light in place and working."
      info="Turning any of these ON is instant. Turning one OFF files a request that waits out the delay first — during which the protection stays fully active. That asymmetry is deliberate and applies everywhere in the app.">

      <Setting
        icon={IconShield}
        title="Uninstall guard"
        desc={b.uninstallGuard ? 'On — extension kept installed, private windows closed off' : 'Off'}
        info="Keeps the extension force-installed on every supported browser and re-applies the policy if it's removed. It also closes the two surfaces the extension can't reach on its own: Incognito/Private windows and Guest profiles.">
        <Switch on={b.uninstallGuard} onClick={toggleGuard} />
      </Setting>
      <PendingNote pending={guardPending} what="The uninstall guard" />

      <Setting
        icon={IconSearch}
        title="SafeSearch"
        desc="Forced on every connected browser"
        info="Google, Bing, DuckDuckGo and Yahoo are pinned to SafeSearch and their toggle UI is hidden. There is deliberately no switch for this one — it can't be turned off.">
        <span className="chip chip-ok">Always on</span>
      </Setting>

      <Setting
        icon={IconShield}
        title="YouTube Restricted Mode"
        desc={b.youtubeRestrict ? 'On' : 'Off'}
        info="Applies YouTube's own strict Restricted Mode through a header rule — the same mechanism school networks use — so YouTube filters mature videos and comments on its side. Included in Strict.">
        <Switch on={!!b.youtubeRestrict} onClick={() => toggle('youtubeRestrict')} />
      </Setting>

      <div className="sub-label">Apps and browsers</div>
      <AppBlockingSection />

      <div className="sub-label">Network</div>
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
      title="AI screen monitor"
      sub="Optional. Watches this device's screen on-device and covers what it shouldn't be showing."
      info="An on-device model looks at the screen when it changes. No frame ever leaves this computer — there is no server involved and nothing is uploaded. It only reacts when something persists across several frames, never to a single reading, and all it does is cover the screen and open your own redirect.">

      <Setting
        icon={IconSearch}
        title="Screen monitoring"
        desc={running ? 'Running' : 'Off'}
        tone={running ? 'ok' : undefined}
        info="Turning it on is instant. Turning it off goes through the waiting period like every other protection — it keeps running until that elapses.">
        {running
          ? <button className="btn btn-ghost btn-sm" onClick={stop} disabled={!!stopPending}>Turn off</button>
          : <button className="btn btn-primary btn-sm" disabled={!available} onClick={() => setConfirming(true)}>Turn on</button>}
      </Setting>

      {/* The warning. Deliberately a blocking step rather than fine print: this
          is the one protection that reads the screen, so consent to that is
          collected explicitly, once, before it ever starts. */}
      {confirming &&
        <div className="warn-panel">
          <div className="warn-panel-title"><IconShield size={17} /> Before you turn this on</div>
          <ul className="warn-panel-list">
            <li>It looks at whatever is on your screen — including windows that have nothing to do with browsing.</li>
            <li>Everything is processed on this device. No image is uploaded, stored, or sent anywhere.</li>
            <li>When it reacts, it covers the screen and opens your redirect. It can't close apps or report to anyone.</li>
            <li>Turning it back off takes 24 hours, like every other protection here.</li>
          </ul>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={start}>I understand — turn it on</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>}

      <PendingNote pending={stopPending} what="The screen monitor" />
      {err && <div className="err-note">{err}</div>}
      {!available && <div className="muted-note">Available in the desktop app.</div>}

      {/* The live readout is diagnostics, not a setting — collapsed by default
          so it stops competing with the controls above it. */}
      {running &&
        <React.Fragment>
          <button className="disclose" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>
            <IconChevron size={15} className={showDetail ? 'disclose-open' : ''} />
            {showDetail ? 'Hide live readout' : 'Show live readout'}
          </button>
          {showDetail &&
            <div className="sub-block">
              {last
                ? <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {last.thumb &&
                      <img src={last.thumb} alt="Most recent screen capture"
                           style={{ width: 200, borderRadius: 10, display: 'block' }} />}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{last.top_label}</div>
                      <div className="muted-note">{(last.top_score * 100).toFixed(1)}% · checked {new Date(last.ts).toLocaleTimeString()}</div>
                    </div>
                  </div>
                : <div className="muted-note">Waiting for the screen to change…</div>}
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
      title="Your hard hours"
      sub="The window you already know is the risky one, and what happens during it."
      info="Set from your own pattern rather than a generic default. The Overview page can fill this in from your logged urges once there are enough of them to see a shape.">

      <Setting
        icon={IconClock}
        title="Vulnerable hours"
        desc={b.vulnerable.on ? `${b.vulnerable.start} → ${b.vulnerable.end}` : 'Off'}
        info="Reminders, grayscale and — on the Lockdown preset — automatic allowlist-only browsing all key off this window.">
        <Switch on={b.vulnerable.on} onClick={() => setVuln({ on: !b.vulnerable.on })} />
      </Setting>

      {b.vulnerable.on &&
        <div className="sub-block">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
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
        </div>}

      <Setting
        icon={IconMoon}
        title="Grayscale the screen"
        desc={b.grayscaleVulnerable ? 'On during your window' : 'Off'}
        info="Drains the colour out of the whole display while your window is running, then gives it back. On some Windows builds it takes effect at the next sign-in rather than instantly. This one isn't a protection, so you can switch it off any time — no waiting period.">
        <Switch on={!!b.grayscaleVulnerable} onClick={toggleGray} disabled={!available} />
      </Setting>
      {grayErr && <div className="err-note">{grayErr}</div>}

      <div className="sub-label">Nudges during the window</div>
      {b.alerts.map((a) =>
        <Setting key={a.id} icon={IconBell} title={a.label} desc={a.desc}>
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
      title="What you see when it blocks"
      sub="A wall says no. This is the part that says what to do instead."
      info="Whatever you write here shows up on the block screen itself. Write it now, while you're thinking clearly — that's the whole trick. Leave it empty and the block screen won't invent advice of its own.">

      <Setting
        icon={IconCompass}
        title="Redirect instead of the block screen"
        desc={b.redirectLinkOn ? (b.redirectUrl || 'No link set yet') : 'Off — show the block screen'}
        info="Sends you to a page of your choosing instead of the default block screen — a video, a note to yourself, anything that helps more than a closed door does.">
        <Switch on={b.redirectLinkOn} onClick={() => set({ redirectLinkOn: !b.redirectLinkOn })} />
      </Setting>

      {b.redirectLinkOn &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10 }}>
            <input
              type="url"
              className="input"
              placeholder="https://youtube.com/watch?v=…"
              value={b.redirectUrl}
              onChange={(e) => set({ redirectUrl: e.target.value })}
              style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!b.redirectUrl}
                    onClick={() => openRedirect(b.redirectUrl)}>Test ↗</button>
          </div>
        </div>}

      <div className="sub-label">Instead, I'd rather…</div>
      {alts.map((a) => (
        <Setting key={a.id} icon={IconSpark} title={a.text} desc={a.url || undefined}>
          <button className="btn btn-ghost btn-sm" onClick={() => removeAlt(a.id)}>Remove</button>
        </Setting>
      ))}

      {alts.length < 6 &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Go do 20 push-ups" value={draft}
                   onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && addAlt()}
                   style={{ flex: '1 1 220px' }} />
            <input className="input" placeholder="Optional link" value={draftUrl}
                   onChange={(e) => setDraftUrl(e.target.value)} style={{ flex: '1 1 160px' }} />
            <button className="btn btn-ghost btn-sm" onClick={addAlt} disabled={!draft.trim()}>Add</button>
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
    if (!confirm('End the lockdown early?\n\nThis goes through the same waiting period as any other protection change — the lockdown stays fully active until it elapses.')) return;
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
      title="Lockdown"
      sub="Only your allowlist stays reachable. Everything else blocks, for exactly as long as you set."
      info="Meant for a genuinely hard day, not a daily habit. Starting one is instant and can always be extended. Ending one early goes through the waiting period — unless you chose Frozen, which cannot be ended early at all.">

      {!available && <div className="muted-note">Available in the desktop app.</div>}
      {available && !view && <div className="muted-note">Loading…</div>}

      {/* inactive → start */}
      {available && view && !view.active &&
        <div className="sub-block">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '0 0 180px' }}>
              <span>Duration</span>
              <select className="input" value={durationSecs} onChange={(e) => setDurationSecs(Number(e.target.value))}>
                {LOCKDOWN_DURATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={start}>
              {busy ? 'Starting…' : 'Start lockdown'}
            </button>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={frozenChoice} onChange={(e) => setFrozenChoice(e.target.checked)} />
            <span>
              <b style={{ color: frozenChoice ? 'var(--ol-danger)' : 'var(--text-2)' }}>Frozen</b> — cannot be
              cancelled once started, only waited out.
              <InfoDot label="About frozen lockdown">
                No password, no override, no support request. Only choose this if that is exactly what you want.
              </InfoDot>
            </span>
          </label>
          {err && <div className="err-note">{err}</div>}
        </div>}

      {/* active */}
      {available && view && view.active &&
        <div className="ut-pending" style={{ marginTop: 4 }}>
          <div className="ut-count">{fmtDur(liveRemaining)}</div>
          <div className="ut-sub">
            {view.frozen ? 'remaining · frozen — can only be waited out' : 'remaining · lockdown active'}
          </div>
          {err && <div className="err-note">{err}</div>}
          {!view.frozen &&
            <button className="btn btn-ghost btn-sm" disabled={busy || !!cancelPending} onClick={cancel} style={{ marginTop: 14 }}>
              End early
            </button>}
          {view.frozen &&
            <div className="muted-note" style={{ marginTop: 12 }}>
              There is genuinely no way to cancel this one. That was the point when it started.
            </div>}
          {cancelPending &&
            <div className="pending-note">
              Ending in <b>{fmtDur(cancelPending.remaining_secs)}</b> — lockdown stays active until then.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); window.PPNative.cancelWeakening('lockdown.cancel').then(refresh); }}>
                Keep it locked
              </a>
            </div>}
        </div>}

      <Setting
        icon={IconLock}
        title="Auto-lockdown during vulnerable hours"
        desc={escalate ? 'On' : 'Off'}
        info="When your vulnerable-hours window starts, begin a lockdown automatically instead of only showing nudges. Never frozen — always cancellable through the normal delay.">
        <Switch on={!!escalate} onClick={toggleEscalation} disabled={escBusy || escalate === null || !available} />
      </Setting>
      <PendingNote pending={escalationPending} what="Auto-lockdown"
                   onKeep={() => window.PPNative.cancelWeakening('lockdown.escalation_disable').then(refresh)} />
    </SectionCard>
  );
}

/* -------------------------------------------------------------------- page */

function BlockingPage({ s, PP }) {
  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Blocking Settings</div>
        <h1 className="page-title">How firmly to <em>hold the line</em></h1>
        <p className="page-sub">Strict is already on. Everything below tunes it.</p>
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
