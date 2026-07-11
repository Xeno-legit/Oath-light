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
    window.PPNative.onEvasionDetected((p) => push(
      `${p.name} — ${p.reason === 'tor_browser' ? 'Tor Browser' : p.reason === 'portable_browser' ? 'portable copy' : 'evasion browser'} — ${p.killed ? 'blocked' : 'detected (not blocked)'}`
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
          <b>Block unknown &amp; evasion browsers</b>
          <span>Kill Tor Browser, LibreWolf and other extension-proof browsers — and portable copies of known ones — on sight instead of just logging them. Off by default: detections are always logged as warnings either way, this only decides whether they're also force-closed.</span>
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

function SettingRow({ icon: I, title, desc, on, onToggle, accent }) {
  return (
    <div className="setting">
      <div className="ico" style={accent ? { background: 'color-mix(in oklab, var(--accent-2) 14%, transparent)', color: 'var(--accent-2)' } : undefined}><I size={20} /></div>
      <div className="txt"><b>{title}</b><span>{desc}</span></div>
      <Switch on={on} onClick={onToggle} />
    </div>);

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
        if (!e || e.message !== 'cancelled') console.warn('[PurePath] toggleGuard failed:', e);
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
          What actually stops you from working around Pure Path — and what's still on the way.
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
            <span>Password-protect Pure Path's settings so they can't be changed without you</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="chip">Coming in Alpha</span>
            <Switch on={false} disabled />
          </div>
        </div>
      </div>

    </div>);

}
window.BlockingPage = BlockingPage;