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
// Three states: idle → request, pending → live countdown + cancel, ready →
// reset / cancel / remove.
function UninstallCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
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

  const run = (fn) => { setBusy(true); fn().then(apply).catch(() => {}).finally(() => setBusy(false)); };

  const doRequest = () => {
    if (!st) return;
    if (!confirm('Start the ' + delayWords(st.delay_secs) + ' uninstall waiting period?\n\n'
      + 'Pure Path stays fully active the whole time. You can cancel whenever you like.')) return;
    setMsg(''); run(() => window.PPNative.requestUninstall());
  };
  const doCancel = () => { setMsg(''); run(() => window.PPNative.cancelUninstall()); };
  const doReset = () => { setMsg(''); run(() => window.PPNative.resetUninstallTimer()); };
  const doRemove = () => {
    if (!confirm('Remove Pure Path completely?\n\n'
      + 'This disables all protection and launches the uninstaller. This cannot be undone.')) return;
    setBusy(true);
    window.PPNative.completeUninstall()
      .then((r) => {
        setMsg(r === 'launched'
          ? 'The uninstaller has been launched. Pure Path will close shortly.'
          : 'Protection has been disabled. To finish, remove Pure Path from Windows Settings → Apps.');
        refresh();
      })
      .catch((e) => setMsg('Could not start the uninstall: ' + (e && e.message ? e.message : e)))
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
          {st && !requested &&
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" disabled={busy || !available} onClick={doRequest}>
                Request uninstall
              </button>
            </div>
          }

          {/* pending → live countdown */}
          {requested && !ready &&
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
          {ready &&
            <div style={{ marginTop: 16 }}>
              <div className="ut-ready">The waiting period is over. What would you like to do?</div>
              <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doReset}>Reset timer</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel}>Cancel — stay protected</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={doRemove}>Remove completely</button>
              </div>
            </div>
          }

          {msg && <div className="ut-msg">{msg}</div>}
          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)' }}>Uninstall controls are available in the desktop app.</div>
          }
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ s, PP }) {
  const p = s.profile;
  const setP = (patch) => PP.set({ profile: patch });
  const toggleN = (k) => PP.set({ notif: { [k]: !s.notif[k] } });

  const NOTIFS = [
    { k: 'daily', icon: IconSun, t: 'Daily intention', d: 'A gentle morning message to set the tone.' },
    { k: 'milestone', icon: IconFlame, t: 'Milestone celebrations', d: 'Cheer you on at 7, 30, 90 days and beyond.' },
    { k: 'urge', icon: IconShield, t: 'Urge check-ins', d: 'Occasional nudges during your vulnerable hours.' },
    { k: 'weekly', icon: IconArrowUp, t: 'Weekly progress recap', d: 'A short summary of your week every Sunday.' },
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
        <button className="btn btn-ghost">Edit profile</button>
      </div>

      {/* fields */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Profile details</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
          <label className="field"><span>Display name</span><input className="input" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></label>
          <label className="field"><span>Email</span><input className="input" value={p.email} onChange={(e) => setP({ email: e.target.value })} /></label>
        </div>
      </div>

      {/* notifications */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Notifications</div>
        {NOTIFS.map((n) => (
          <div className="setting" key={n.k}>
            <div className="ico"><n.icon size={20} /></div>
            <div className="txt"><b>{n.t}</b><span>{n.d}</span></div>
            <Switch on={s.notif[n.k]} onClick={() => toggleN(n.k)} />
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

      {/* uninstall — 24-hour friction request */}
      <UninstallCard />
    </div>
  );
}
window.SettingsPage = SettingsPage;
