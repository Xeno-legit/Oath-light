/* pages-overview.jsx */
const BROWSER_LOGOS = {
  chrome: (
    <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <path d="M24 14h19.2A22 22 0 0 0 5.3 12.9L14.7 29A11 11 0 0 1 24 14z" fill="#ea4335" />
      <path d="M14.7 29 5.3 12.9A22 22 0 0 0 14.9 44.6L24.5 28.4A11 11 0 0 1 14.7 29z" fill="#34a853" />
      <path d="M33 18.5 24.5 33A11 11 0 0 0 33.7 16.5l.1.1L46 16.4A22 22 0 0 1 24.6 46l9.4-16.2z" fill="#fbbc05" />
      <circle cx="24" cy="24" r="8.5" fill="#4285f4" />
    </svg>
  ),
  safari: (
    <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#1da1f2" />
      <circle cx="24" cy="24" r="18" fill="#fff" />
      <path d="M24 24 33 15 27 27z" fill="#f5443a" />
      <path d="M24 24 15 33 21 21z" fill="#d8d8d8" />
    </svg>
  ),
  firefox: (
    <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">
      <circle cx="24" cy="25" r="20" fill="#ff7139" />
      <path d="M40 13c1.5 3 1 7-1 9 1-4-1-7-3-8 1 3 0 5-2 7-5 4-9 3-12 8-2 4 0 9 4 11A16 16 0 0 0 41 26c0-5-1-10-1-13z" fill="#ffbd2e" />
      <path d="M24 9C15 9 9 16 9 24c0 4 2 8 5 10-2-3-2-7 0-10 3-4 9-3 11-9 1-3-1-6-1-6z" fill="#ff4f5e" />
    </svg>
  ),
  edge: (
    <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">
      <path d="M42 30c0 8-8 13-16 13-6 0-12-3-15-9 3 4 8 5 13 4 6-1 9-5 9-9 0-3-2-5-5-5H12C13 13 22 6 31 8c7 1 11 7 11 14z" fill="#0c88da" />
      <path d="M12 24c0-5 3-9 7-11-3 4-3 9 0 12 2 2 5 2 8 2H28c-9 0-16-1-16-3z" fill="#33d375" />
      <path d="M19 13c-4 2-7 6-7 11 0 6 6 9 11 8-4-2-6-6-5-11 1-4 0-7-1-8z" fill="#1de9b6" opacity=".0" />
    </svg>
  ),
};

const EXT_STATUS = {
  connected: { label: 'Connected', color: 'var(--accent-2)', dot: 'var(--accent-2)' },
  outdated: { label: 'Update available', color: '#d9a441', dot: '#d9a441' },
  disconnected: { label: 'Not connected', color: 'var(--muted)', dot: 'color-mix(in oklab, var(--muted) 70%, transparent)' },
};

function ExtensionRow({ ext, PP, s }) {
  const st = EXT_STATUS[ext.status];
  const update = (patch) => PP.set({ extensions: s.extensions.map((e) => e.id === ext.id ? { ...e, ...patch } : e) });
  const action =
    ext.status === 'disconnected' ? { label: 'Connect', onClick: () => update({ status: 'connected', version: '2.4.1', lastSync: 'Just now' }) } :
    ext.status === 'outdated' ? { label: 'Update', onClick: () => update({ status: 'connected', version: '2.4.1', lastSync: 'Just now' }) } :
    null;

  return (
    <div className={'ext-row' + (ext.status === 'disconnected' ? ' is-off' : '')}>
      <div className="ext-logo">{BROWSER_LOGOS[ext.id]}</div>
      <div className="ext-info">
        <div className="ext-name">
          {ext.name}
          {ext.version && <span className="ext-ver">v{ext.version}</span>}
        </div>
        <div className="ext-status" style={{ color: st.color }}>
          <span className="ext-dot" style={{ background: st.dot }} />
          {st.label}
          {ext.lastSync && <span className="ext-sync">· synced {ext.lastSync}</span>}
        </div>
      </div>
      {action &&
        <button className="btn btn-ghost btn-sm" onClick={action.onClick}>{action.label}</button>
      }
    </div>
  );
}
const DAILY_MESSAGES = [
{ q: "The urge is a wave. You don't have to fight it — just let it rise, crest, and pass. You always outlast it.", a: "Today's quote", by: "Naval Ravikant" },
{ q: "You are not starting over. You are starting from experience, with everything the last days taught you.", a: "Today's quote", by: "James Clear" },
{ q: "Discipline is choosing what you want most over what you want now. You've chosen well today.", a: "Today's quote", by: "Abraham Lincoln" },
{ q: "Every clear minute rewires you a little. Quietly, you are becoming someone new.", a: "Today's quote", by: "Marcus Aurelius" }];


function StatTile({ icon: I, label, value, sub }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ gap: 10, color: 'var(--accent)' }}>
        <I size={18} /><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', marginTop: 10 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>);

}

function OverviewPage({ s, PP }) {
  const msg = DAILY_MESSAGES[new Date().getDate() % DAILY_MESSAGES.length];
  const nextMilestone = [7, 14, 30, 60, 90, 180, 365].find((m) => m > s.streak) || s.streak + 30;
  const ringVal = Math.min(100, Math.round(s.streak / nextMilestone * 100));

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Overview</div>
        <h1 className="page-title">Your <em style={{ fontFamily: "Manrope" }}>progress</em></h1>
        <p className="page-sub">A calm look at how far you've come. Small, steady steps — that's the whole game.</p>
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'stretch' }}>
        {/* streak hero */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Ring value={ringVal} size={170}>
            <div>
              <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, letterSpacing: '-.04em' }}>{s.streak}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginTop: 4 }}>days clean</div>
            </div>
          </Ring>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ gap: 8, color: 'var(--accent-2)' }}>
              <IconFlame size={19} /><span style={{ fontWeight: 800, fontSize: 15 }}>On a roll</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.55, margin: '10px 0 16px' }}>
              You're <b style={{ color: 'var(--text)' }}>{nextMilestone - s.streak} days</b> from your next milestone of {nextMilestone} days. Keep the rhythm.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => PP.set({ streak: 0 })}>
              <IconFlame size={16} /> Relapsed?
            </button>
          </div>
        </div>

        {/* stat tiles */}
        <div className="grid" style={{ gridTemplateRows: '1fr 1fr', gap: 16 }}>
          <StatTile icon={IconArrowUp} label="Best streak" value={`${s.bestStreak} days`} sub="Your personal record" />
          <StatTile icon={IconShield} label="Blocked this week" value={s.blockedThisWeek} sub="Attempts intercepted" />
        </div>
      </div>

      {/* daily message */}
      <div className="card fade-up" style={{ marginTop: 18, padding: '28px 30px', position: 'relative', overflow: 'hidden' }}>
        <div className="eyebrow" style={{ color: 'var(--muted)' }}>{msg.a}</div>
        <blockquote style={{ fontSize: 27, lineHeight: 1.35, letterSpacing: '.005em', marginTop: 8, maxWidth: '46ch', fontFamily: "Manrope" }}>
          “{msg.q}”
        </blockquote>
        {msg.by && (
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 600, color: 'var(--muted)' }}>
            — <em>{msg.by}</em>
          </div>
        )}
      </div>

      {/* extension connection status */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div className="spread" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>Browser protection</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>Pure Path enforces blocking through its browser extensions</div>
          </div>
          {(() => {
            const conn = s.extensions.filter((e) => e.status === 'connected').length;
            const total = s.extensions.length;
            const allGood = conn === total;
            return (
              <span className="chip" style={{ color: allGood ? 'var(--accent-2)' : 'var(--warn, #d9a441)' }}>
                <IconShield size={14} /> {conn}/{total} active
              </span>
            );
          })()}
        </div>

        <div className="ext-grid">
          {s.extensions.map((ext) => <ExtensionRow key={ext.id} ext={ext} PP={PP} s={s} />)}
        </div>
      </div>
    </div>);

}
window.OverviewPage = OverviewPage;