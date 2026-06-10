/* shell.jsx — window chrome, sidebar, and the hub menu (starting page) */

const NAV = [
{ id: 'overview', label: 'Overview', icon: IconGrid },
{ id: 'blocklist', label: 'Blocklist', icon: IconShield },
{ id: 'blocking', label: 'Blocking Settings', icon: IconSliders },
{ id: 'mentor', label: 'Personal Mentor', icon: IconChat },
{ id: 'tips', label: 'Tips & Protocols', icon: IconSpark },
{ id: 'themes', label: 'Themes', icon: IconPalette }];


// Window controls for the frameless Tauri window (withGlobalTauri = true).
function winCtl(action) {
  try {
    const w = window.__TAURI__ && window.__TAURI__.window;
    const appWin = w && (w.getCurrentWindow ? w.getCurrentWindow() : w.getCurrent && w.getCurrent());
    if (appWin && appWin[action]) appWin[action]();
  } catch (e) {/* running outside Tauri (e.g. plain browser preview) */}
}

function WinBtn({ label, action, danger, children }) {
  return (
    <button className={'win-btn' + (danger ? ' win-close' : '')}
            title={label} aria-label={label} onClick={() => winCtl(action)}>
      {children}
    </button>);

}

function TitleBar({ s }) {
  return (
    <div className="titlebar">
      <div className="tl-brand" data-tauri-drag-region>
        <span className="tl-logo"><Logo size={18} /></span>
        <span className="tl-title">Pure Path</span>
      </div>
      <div className="tl-drag" data-tauri-drag-region style={{ flex: 1, alignSelf: 'stretch' }} />
      <div className="win-ctrls">
        <WinBtn label="Minimize" action="minimize">
          <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </WinBtn>
        <WinBtn label="Maximize" action="toggleMaximize">
          <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
        </WinBtn>
        <WinBtn label="Close" action="close" danger>
          <svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></svg>
        </WinBtn>
      </div>
    </div>);

}

function Sidebar({ s, go }) {
  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => go('home')} title="Home">
        <div className="brand-logo"><Logo size={34} /></div>
        <div>
          <div className="brand-name">Pure Path</div>
          <div className="brand-sub">Day {s.streak}</div>
        </div>
      </div>

      <div className="nav-label">Main</div>
      <nav className="nav">
        {NAV.map((n) =>
        <button key={n.id} className={'nav-item' + (s.page === n.id ? ' active' : '')} onClick={() => go(n.id)}>
            <n.icon />
            <span>{n.label}</span>

          </button>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="divider" style={{ margin: '10px 6px 12px' }} />
        <div className={'user-card' + (s.page === 'settings' ? ' active' : '')} onClick={() => go('settings')}>
          <div className="avatar">{s.profile.name.split(' ').map((x) => x[0]).join('')}</div>
          <div className="user-meta">
            <b>{s.profile.name}</b>
            <span>{s.profile.email}</span>
          </div>
          <IconGear size={17} style={{ marginLeft: 'auto', opacity: .6 }} />
        </div>
      </div>
    </aside>);

}

/* ---------- HUB MENU (starting page) ---------- */
const HUB_CARDS = [
{ id: 'overview', icon: IconGrid, title: 'Overview', desc: 'Your streak, progress and daily intention at a glance.', stat: (s) => `Day ${s.streak}` },
{ id: 'blocklist', icon: IconShield, title: 'Blocklist', desc: 'Check what gets blocked — blacklist, graylist and custom sites.', stat: (s) => `${s.blocklist.blacklistDomains} domains` },
{ id: 'blocking', icon: IconSliders, title: 'Blocking Settings', desc: 'Strictness, schedules and tamper protection.', stat: (s) => 'Manage settings' },
{ id: 'mentor', icon: IconChat, title: 'Personal Mentor', desc: 'A calm companion for the hard moments. Always here.', stat: () => 'Coming soon' },
{ id: 'tips', icon: IconSpark, title: 'Tips & Protocols', desc: 'Field-tested techniques to ride out urges.', stat: () => '12 protocols' },
{ id: 'themes', icon: IconPalette, title: 'Themes', desc: 'Make the space yours — light, dark and atmosphere.', stat: (s) => s.display.style }];


function HubMenu({ s, go }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = s.profile.name.split(' ')[0];
  return (
    <div className="page hub" style={{ maxWidth: 1040 }}>
      <div className="hub-hero fade-up">
        <div className="hub-mark"><Logo size={56} /></div>
        <div className="eyebrow" style={{ marginTop: 22 }}>{greeting}, {name}</div>
        <h1 className="hub-title">Welcome back.</h1>
        <p className="page-sub" style={{ margin: '0 auto', fontSize: 16.5 }}>
          You're on a <b style={{ color: 'var(--text)' }}>{s.streak}-day</b> streak. Every clear choice is a vote for the person you're becoming.
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 22, gap: 12 }}>
          <button className="btn btn-primary" onClick={() => go('overview')}><IconArrowUp size={17} /> See my progress</button>
          <button className="btn btn-ghost" onClick={() => go('mentor')}><IconChat size={17} /> Talk it through</button>
        </div>
      </div>

      <div className="grid hub-grid stagger" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 40 }}>
        {HUB_CARDS.map((c) =>
        <button key={c.id} className="card hover hub-card" onClick={() => go(c.id)}>
            <div className="hub-card-ico"><c.icon size={22} /></div>
            <div className="hub-card-title">{c.title}</div>
            <div className="hub-card-desc">{c.desc}</div>
            <div className="hub-card-foot">
              <span className="chip">{c.stat(s)}</span>
              <IconChevron size={18} className="hub-arrow" />
            </div>
          </button>
        )}
      </div>
    </div>);

}

Object.assign(window, { NAV, TitleBar, Sidebar, HubMenu });