/* pages-settings.jsx — user settings */

// --- 24-hour uninstall request (Phase 4 friction) ---------------------------

// "47h 59m 03s" style remaining-time string.
function fmtDur(secs) {
  secs = Math.max(0, Math.floor(secs));
  const d = Math.floor(secs / 86400); secs -= d * 86400;
  const h = Math.floor(secs / 3600); secs -= h * 3600;
  const m = Math.floor(secs / 60); const s = secs - m * 60;
  const out = [];
  if (d) out.push(d + 'd');
  out.push(h + 'h', m + 'm', (s < 10 ? '0' : '') + s + 's');
  return out.join(' ');
}
// Used cross-file (pages-blocking/blocklist/monitor pending-weakening notes).
// Babel-standalone injects each file as a real <script>, so this top-level
// function is already a global — the explicit assignment just follows the
// house convention (`window.X = X`) every other shared symbol uses, so a
// future loader/strict-mode change can't silently break the bare references.
window.fmtDur = fmtDur;

// Human cool-off length, e.g. "10 minutes" / "24 hours" (kept in step with the
// backend's actual delay so the copy never lies, even while testing).
function delayWords(secs) {
  secs = Math.max(0, Math.floor(secs));
  const u = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  if (secs >= 86400 && secs % 86400 === 0) return u(secs / 86400, 'day');
  if (secs >= 3600 && secs % 3600 === 0) return u(secs / 3600, 'hour');
  if (secs >= 60 && secs % 60 === 0) return u(secs / 60, 'minute');
  return u(secs, 'second');
}

// The settings card that drives the persisted, backend-owned uninstall request.
// Four states: idle → request, pending → live countdown + cancel, ready →
// reset / cancel / remove, removing → success message only (no actions —
// the app is seconds from closing itself down).
function UninstallCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [removing, setRemoving] = React.useState(false);
  const [, tick] = React.useReducer((x) => x + 1, 0);
  // Anchor the last backend reading so the local ticker can derive the countdown
  // without hammering the backend every second.
  const ref = React.useRef({ at: 0, remaining: 0 });

  const apply = (s) => {
    setSt(s);
    ref.current = { at: Date.now(), remaining: s ? s.remaining_secs : 0 };
  };

  const refresh = React.useCallback(() => {
    if (!available) return;
    window.PPNative.getUninstallState().then(apply).catch(() => {});
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);

  // 1s ticker while pending; re-sync from the backend (authoritative) at zero.
  React.useEffect(() => {
    if (!st || !st.requested || st.ready) return;
    const id = setInterval(() => {
      const left = ref.current.remaining - (Date.now() - ref.current.at) / 1000;
      if (left <= 0) refresh(); else tick();
    }, 1000);
    return () => clearInterval(id);
  }, [st, refresh]);

  const run = (fn) => {
    setBusy(true);
    fn().then(apply)
      .catch((e) => setMsg('Something went wrong: ' + (e && e.message ? e.message : e) + ' — please try again.'))
      .finally(() => setBusy(false));
  };

  // Master-password gated (4.2) when one is set — opening the request is the
  // first step of a weakening, even though protection stays fully on the
  // whole time it's pending. `PPAuth.acquire()` resolves the session token
  // (or `null` outside a password) to pass through, or rejects
  // `Error('cancelled')` if the prompt was dismissed, which aborts silently
  // here rather than showing the generic error message.
  const doRequest = () => {
    if (!st) return;
    if (!confirm('Start the ' + delayWords(st.delay_secs) + ' uninstall waiting period?\n\n'
      + 'Pure Path stays fully active the whole time. You can cancel whenever you like.')) return;
    setMsg('');
    setBusy(true);
    (window.PPAuth ? PPAuth.acquire() : Promise.resolve(null))
      .then((auth) => window.PPNative.requestUninstall(auth))
      .then(apply)
      .catch((e) => {
        if (e && e.message === 'cancelled') return;
        setMsg('Something went wrong: ' + (e && e.message ? e.message : e) + ' — please try again.');
      })
      .finally(() => setBusy(false));
  };
  const doCancel = () => { setMsg(''); run(() => window.PPNative.cancelUninstall()); };
  const doReset = () => { setMsg(''); run(() => window.PPNative.resetUninstallTimer()); };
  const doRemove = () => {
    if (!confirm('Remove Pure Path completely?\n\n'
      + 'This disables all protection and deletes Pure Path from your computer. This cannot be undone.')) return;
    setBusy(true);
    window.PPNative.completeUninstall()
      .then(() => {
        setMsg('Removing Pure Path — it will close and delete itself in a moment.');
        setRemoving(true);
        refresh();
      })
      // The backend refuses to tear anything down unless removal is
      // guaranteed to proceed, and its error message already says as much —
      // just surface it as-is instead of restating it.
      .catch((e) => setMsg('Could not remove Pure Path: ' + (e && e.message ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const requested = st && st.requested;
  const ready = st && st.ready;
  const liveRemaining = requested && !ready
    ? Math.max(0, Math.round(ref.current.remaining - (Date.now() - ref.current.at) / 1000))
    : (st ? st.remaining_secs : 0);
  const pct = st && st.delay_secs
    ? Math.min(100, Math.max(0, (1 - liveRemaining / st.delay_secs) * 100)) : 0;

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconShield size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Uninstall Pure Path</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            Removing Pure Path opens a {st ? delayWords(st.delay_secs) : '24-hour'} waiting period first — a moment
            of friction for your future self. Blocking and everything else stay fully active the entire time.
          </div>

          {/* idle → request */}
          {st && !requested && !removing &&
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" disabled={busy || !available} onClick={doRequest}>
                Request uninstall
              </button>
            </div>
          }

          {/* pending → live countdown */}
          {requested && !ready && !removing &&
            <div className="ut-pending" style={{ marginTop: 16 }}>
              <div className="ut-count">{fmtDur(liveRemaining)}</div>
              <div className="ut-sub">until removal unlocks · protection active</div>
              <div className="ut-bar"><div className="ut-fill" style={{ width: pct + '%' }} /></div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel} style={{ marginTop: 14 }}>
                Cancel request
              </button>
            </div>
          }

          {/* ready → reset / cancel / remove */}
          {ready && !removing &&
            <div style={{ marginTop: 16 }}>
              <div className="ut-ready">The waiting period is over. What would you like to do?</div>
              <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doReset}>Reset timer</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel}>Cancel — stay protected</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={doRemove}>Remove completely</button>
              </div>
            </div>
          }

          {/* removing → success message only, no actions — the app is about to close itself */}
          {msg && <div className="ut-msg">{msg}</div>}
          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)' }}>Uninstall controls are available in the desktop app.</div>
          }
        </div>
      </div>
    </div>
  );
}

// --- Master password (Phase 4 item 4.2) --------------------------------------

// Settings card for setting/changing/removing the master password that gates
// every weakening request (turning off the uninstall guard/AI monitor,
// unblocking a custom site, opening an uninstall request). The real gate is
// entirely server-side (`auth::require_auth` in lib.rs) — this card is just
// the UI for managing the password itself via `window.PPAuth`.
//
// Honest recovery story, stated plainly in the "Remove password" copy below:
// removing the password normally needs the CURRENT password plus the
// friction delay (`requestRemoval`). If you've genuinely forgotten it, the
// "Forgot it?" link starts the same delay without the password
// (`requestRemovalForgotten`) — it can't skip the wait, only skip proving you
// know a password you don't remember.
function SecurityCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [set, setSet] = React.useState(null); // null = still loading
  const [mode, setMode] = React.useState('idle'); // idle | set | change | remove
  const [current, setCurrent] = React.useState('');
  const [pw1, setPw1] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const refresh = React.useCallback(() => {
    if (!available) { setSet(false); return; }
    (window.PPAuth ? PPAuth.status() : Promise.resolve({ set: false }))
      .then((s) => setSet(!!(s && s.set)));
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const resetFields = () => { setCurrent(''); setPw1(''); setPw2(''); setErr(''); };
  const cancel = () => { setMode('idle'); resetFields(); };
  const open = (m) => { setMode(m); setMsg(''); resetFields(); };

  const submitSetOrChange = () => {
    setErr('');
    if (pw1.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (pw1 !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    window.PPAuth.setPassword(set ? current : null, pw1)
      .then(() => {
        setMsg(set ? 'Password changed.' : 'Master password set.');
        setSet(true);
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const submitRemove = () => {
    setErr('');
    setBusy(true);
    window.PPAuth.requestRemoval(current)
      .then(() => {
        setMsg('Removal requested — see "Pending changes" below for the countdown.');
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const forgotIt = () => {
    if (!confirm(
      "Forgot your master password?\n\n"
      + "This starts the same waiting-period removal every other protection change goes through. "
      + "You don't need the old password for this — but you do still have to wait out the delay. "
      + "Continue?"
    )) return;
    setErr('');
    setBusy(true);
    window.PPAuth.requestRemovalForgotten()
      .then(() => {
        setMsg('Removal requested — see "Pending changes" below for the countdown.');
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconLock size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Master password</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            {set
              ? 'Set. Turning off a protection — the uninstall guard, the AI monitor, a custom site block, or '
                + 'starting an uninstall request — needs this password before the usual waiting period even starts.'
              : "Not set. Turning off a protection still waits out the usual delay, but anyone at this computer "
                + 'can start that countdown. Add a password to require it first.'}
          </div>

          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}

          {available && set === null &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}

          {available && set !== null && mode === 'idle' &&
            <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => open(set ? 'change' : 'set')}>
                {set ? 'Change password' : 'Set a password'}
              </button>
              {set &&
                <button className="btn btn-ghost btn-sm" onClick={() => open('remove')}>Remove password</button>}
            </div>}

          {(mode === 'set' || mode === 'change') &&
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
              {mode === 'change' &&
                <input type="password" className="input" placeholder="Current password" value={current}
                       onChange={(e) => setCurrent(e.target.value)} />}
              <input type="password" className="input" placeholder="New password (min. 6 characters)" value={pw1}
                     onChange={(e) => setPw1(e.target.value)} />
              <input type="password" className="input" placeholder="Confirm new password" value={pw2}
                     onChange={(e) => setPw2(e.target.value)} />
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
                <button className="btn btn-primary btn-sm"
                        disabled={busy || !pw1 || !pw2 || (mode === 'change' && !current)}
                        onClick={submitSetOrChange}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>}

          {mode === 'remove' &&
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                Requires your current password, then the same waiting period as any other weakening —
                this doesn't skip it, it only starts it.
              </div>
              <input type="password" className="input" placeholder="Current password" value={current}
                     onChange={(e) => setCurrent(e.target.value)} />
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
                <button className="btn btn-danger btn-sm" disabled={busy || !current} onClick={submitRemove}>
                  {busy ? 'Requesting…' : 'Request removal'}
                </button>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={forgotIt}>
                Forgot it?
              </button>
            </div>}

          {msg && mode === 'idle' && <div className="ut-msg" style={{ marginTop: 12 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// --- Pending weakenings (Phase 4 friction, 4.1) ------------------------------

// Every OTHER pending weakening besides uninstall (which has its own
// dedicated card above) — turning off the uninstall guard, stopping the AI
// monitor, or unblocking a custom site all wait out the same friction delay
// before they actually apply. Hidden entirely when nothing is pending.
function PendingChangesCard({ PP }) {
  const all = (window.usePendingWeakenings || (() => []))();
  const pending = all.filter((p) => p.action_id !== 'uninstall');
  const [busy, setBusy] = React.useState(null);

  if (!pending.length) return null;

  const cancel = (p) => {
    setBusy(p.action_id);
    window.PPNative.cancelWeakening(p.action_id).then(() => {
      // The backend is the source of truth; this just keeps the renderer's
      // own copy from lying about the toggle/list in the meantime.
      if (p.action_id === 'guard.disable') {
        PP.set({ blocking: { uninstallGuard: true } });
      } else if (p.action_id.indexOf('custom_block.remove:') === 0) {
        const domain = p.action_id.slice('custom_block.remove:'.length);
        const bl = PP.get().blocklist;
        if (!bl.customSites.some((x) => x.url === domain)) {
          PP.put('blocklist', { ...bl, customSites: [...bl.customSites, { id: Date.now(), url: domain, added: 'restored' }] });
        }
      }
    }).finally(() => setBusy(null));
  };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <b style={{ fontSize: 14.5, fontWeight: 800 }}>Pending changes</b>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
        Changes that weaken Pure Path's protection take effect only after a short delay — the same kind of
        friction that applies to uninstalling. Canceling here leaves your protection exactly as it is now.
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pending.map((p) => (
          <div className="setting" key={p.action_id}>
            <div className="txt">
              <b>{p.label}</b>
              <span>{p.ready ? 'Ready to apply any moment now' : ('Applies in ' + fmtDur(p.remaining_secs))}</span>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={busy === p.action_id} onClick={() => cancel(p)}>
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- OTA blocklist updates (Phase 4 item 3.5) --------------------------------

// Settings card for the over-the-air blocklist update channel: which list
// version is installed (or "built-in" when none has ever been), when the last
// check ran and how it went — shown verbatim, including real errors like the
// GitHub release not existing yet — and a "Check now" button. Checking only
// ever strengthens the lists (signed, monotonically-versioned updates), so
// the button is ungated.
function ListsUpdateCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [st, setSt] = React.useState(null);

  React.useEffect(() => {
    if (!available) return;
    let unlisten = null, cancelled = false;
    window.PPNative.getOtaStatus().then((v) => { if (!cancelled && v) setSt(v); });
    window.PPNative.onOtaStatus((v) => { if (!cancelled) setSt(v); })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    // Poll as a fallback while a check runs (the event covers the normal path).
    const id = setInterval(() => {
      window.PPNative.getOtaStatus().then((v) => { if (!cancelled && v) setSt(v); });
    }, 5000);
    return () => { cancelled = true; clearInterval(id); if (unlisten) unlisten(); };
  }, [available]);

  const checkNow = () => {
    window.PPNative.checkListsUpdateNow().then((v) => { if (v) setSt(v); });
  };

  const checking = !!(st && st.checking);
  const version = st
    ? (st.loaded_version ? ('v' + st.loaded_version)
      : (st.installed_version ? ('v' + st.installed_version + ' (not loaded — using built-in)') : 'built-in'))
    : '…';
  const lastCheck = st && st.last_check
    ? new Date(st.last_check * 1000).toLocaleString()
    : 'never';

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconGlobe size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Blocklist updates</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            Pure Path checks weekly for signed blocklist updates and applies them automatically —
            updates can only ever add protection, never silently weaken it. The bundled lists always
            remain as a fallback.
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><span style={{ color: 'var(--muted)' }}>Installed list version:</span> <b>{version}</b></div>
            <div><span style={{ color: 'var(--muted)' }}>Last check:</span> {lastCheck}</div>
            {st && st.last_result &&
              <div style={{ wordBreak: 'break-word' }}>
                <span style={{ color: 'var(--muted)' }}>Result:</span>{' '}
                {st.last_result.indexOf('failed') === 0
                  ? <span style={{ color: '#ef4444' }}>{st.last_result}</span>
                  : st.last_result}
              </div>}
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" disabled={!available || checking} onClick={checkNow}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ s, PP }) {
  const p = s.profile;
  const setP = (patch) => PP.set({ profile: patch });
  const [editing, setEditing] = React.useState(false);

  // The real reminders — same array the Blocking page edits (shared store
  // state), toggled the same way as pages-blocking.jsx's toggleAlert.
  const b = s.blocking;
  const toggleAlert = (id) => PP.set({ blocking: { alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) } });

  // Not built yet — an honest disabled row beats a toggle that does nothing.
  const COMING_NOTIFS = [
    { icon: IconSun, t: 'Daily intention', d: 'A gentle morning message to set the tone.' },
    { icon: IconFlame, t: 'Milestone celebrations', d: 'Cheer you on at 7, 30, 90 days and beyond.' },
    { icon: IconArrowUp, t: 'Weekly progress recap', d: 'A short summary of your week every Sunday.' },
  ];

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Account</div>
        <h1 className="page-title">User <em>settings</em></h1>
        <p className="page-sub">Your profile, accountability and notifications. You're in full control of everything here.</p>
      </div>

      {/* profile */}
      <div className="card fade-up" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <div className="avatar" style={{ width: 64, height: 64, flex: '0 0 64px', fontSize: 22 }}>{p.name.split(' ').map((x) => x[0]).join('')}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>{p.name}</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>{p.email}</div>
          {p.tz && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <span className="chip">{p.tz}</span>
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit profile'}</button>
      </div>

      {/* fields — shown only while editing; they already persist live to the store */}
      {editing &&
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Profile details</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
          <label className="field"><span>Display name</span><input className="input" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></label>
          <label className="field"><span>Email</span><input className="input" value={p.email} onChange={(e) => setP({ email: e.target.value })} /></label>
        </div>
      </div>
      }

      {/* notifications */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Notifications</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          These are the real check-in reminders — they show up in the browser during your vulnerable hours (set on the Blocking Settings page).
        </div>
        {b.alerts.map((a) => (
          <div className="setting" key={a.id}>
            <div className="ico"><IconBell size={20} /></div>
            <div className="txt"><b>{a.label}</b><span>{a.desc}</span></div>
            <Switch on={a.on} onClick={() => toggleAlert(a.id)} />
          </div>
        ))}

        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Coming soon
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Not built yet — shown honestly here instead of a switch that would quietly do nothing.
        </div>
        {COMING_NOTIFS.map((n) => (
          <div className="setting" key={n.t}>
            <div className="ico"><n.icon size={20} /></div>
            <div className="txt"><b>{n.t}</b><span>{n.d}</span></div>
            <div className="row" style={{ gap: 10 }}>
              <span className="chip">Coming in Alpha</span>
              <Switch on={false} disabled />
            </div>
          </div>
        ))}
      </div>

      {/* danger / reset */}
      <div className="card fade-up" style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="txt" style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Reset app data</b>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Restore Pure Path to its default state.</div>
        </div>
        <button className="btn btn-ghost" onClick={() => { if (confirm('Reset all app data?')) PP.reset(); }}>Reset</button>
      </div>

      {/* master password (4.2) — gates every weakening request below */}
      <SecurityCard />

      {/* pending weakenings (4.1) — guard/monitor disables, custom-block removals */}
      <PendingChangesCard PP={PP} />

      {/* uninstall — 24-hour friction request */}
      <UninstallCard />
    </div>
  );
}
window.SettingsPage = SettingsPage;
