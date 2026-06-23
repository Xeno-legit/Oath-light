/* pages-settings.jsx — user settings */
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
    </div>
  );
}
window.SettingsPage = SettingsPage;
