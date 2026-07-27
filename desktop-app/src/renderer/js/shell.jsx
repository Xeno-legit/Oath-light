/* shell.jsx — window chrome, sidebar, and the hub menu (starting page) */

const NAV = [
{ id: 'overview', label: 'Overview', icon: IconGrid },
{ id: 'monitor', label: 'AI Monitor', icon: IconSearch },
{ id: 'blocklist', label: 'Blocklist', icon: IconShield },
{ id: 'blocking', label: 'Blocking Settings', icon: IconSliders },
{ id: 'mentor', label: 'Recovery Program', icon: IconChat },
{ id: 'tips', label: 'Tips & Questions', icon: IconSpark },
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
        <span className="tl-title">Oath Light</span>
        <span className="beta-badge" title="Open beta build — features are still in testing and may change or misbehave.">BETA</span>
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
          <div className="brand-name">Oath Light</div>
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

      {/* Panic / SOS (5.1) — deliberately its own section, always visible,
          never buried in the page list. Also reachable from the tray item,
          Ctrl+Shift+Space, and the extension's blocked page. */}
      <div className="nav-label" style={{ marginTop: 16 }}>Support</div>
      <nav className="nav">
        <button className={'nav-item nav-sos' + (s.page === 'panic' ? ' active' : '')} onClick={() => go('panic')}>
          <IconHeart />
          <span>SOS — I need help</span>
        </button>
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
{ id: 'blocklist', icon: IconShield, title: 'Blocklist', desc: 'Check what gets blocked — blacklist, graylist and custom sites.', stat: () => 'Blocklist' },
{ id: 'blocking', icon: IconSliders, title: 'Blocking Settings', desc: 'Strictness, schedules and tamper protection.', stat: (s) => 'Manage settings' },
{ id: 'mentor', icon: IconChat, title: 'Recovery Program', desc: 'Guided CBT/ACT exercises for the hard moments. Always here.', stat: () => '4 exercises' },
{ id: 'tips', icon: IconSpark, title: 'Tips & Questions', desc: 'Questions you might encounter, and tips to guide you.', stat: () => '15 items' },
{ id: 'themes', icon: IconPalette, title: 'Themes', desc: 'Make the space yours — light, dark and atmosphere.', stat: (s) => s.display.style }];


function HubMenu({ s, go }) {
  const hour = new Date().getHours();
  const name = s.profile.name.split(' ')[0];
  // Voice layer (UX Direction §2): every line of hero copy comes from the
  // strings layer, so Serious Mode flips the whole greeting register — not
  // just a banner bolted on top of soft copy.
  const greetKey = hour < 12 ? 'app.greeting_morning' : hour < 18 ? 'app.greeting_afternoon' : 'app.greeting_evening';
  // Live domain count for the Blocklist card's stat chip (null until loaded /
  // outside Tauri) — guarded so a not-yet-wired hook can't crash the hub.
  const counts = (window.useBlocklistCounts || (() => null))();
  return (
    <div className="page hub" style={{ maxWidth: 1040 }}>
      <div className="beta-banner fade-up" role="note">
        <span className="beta-banner-tag">OPEN BETA</span>
        <span className="beta-banner-text">
          You're running an early public build of Oath Light. It's still in active
          testing — some protection may be incomplete and things can change or break.
          Please don't rely on it as your only safeguard yet.
        </span>
      </div>
      <div className="hub-hero fade-up">
        <div className="hub-mark"><Logo size={56} /></div>
        <div className="eyebrow" style={{ marginTop: 22 }}>{PP.t(greetKey, { name })}</div>
        <h1 className="hub-title">{PP.t('app.welcome_title')}</h1>
        <p className="page-sub" style={{ margin: '0 auto', fontSize: 16.5 }}>
          {PP.t('app.welcome_sub', { days: s.streak })}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 22, gap: 12 }}>
          <button className="btn btn-primary" onClick={() => go('overview')}><IconArrowUp size={17} /> {PP.t('app.cta_see_progress')}</button>
          <button className="btn btn-ghost" onClick={() => go('mentor')}><IconChat size={17} /> {PP.t('app.cta_talk_it_through')}</button>
        </div>
      </div>

      <div className="grid hub-grid stagger" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 40 }}>
        {HUB_CARDS.map((c) => {
          // Blocklist's stat is a live count sourced from the real backend
          // list, not the card's own stat() fn — every other card keeps the
          // plain stat-function architecture.
          const stat = c.id === 'blocklist' ?
          counts ? `${counts.domain_count.toLocaleString()} domains` : 'View list' :
          c.stat(s);
          return (
            <button key={c.id} className="card hover hub-card" onClick={() => go(c.id)}>
              <div className="hub-card-ico"><c.icon size={22} /></div>
              <div className="hub-card-title">{c.title}</div>
              <div className="hub-card-desc">{c.desc}</div>
              <div className="hub-card-foot">
                <span className="chip">{stat}</span>
                <IconChevron size={18} className="hub-arrow" />
              </div>
            </button>);

        })}
      </div>
    </div>);

}

Object.assign(window, { NAV, TitleBar, Sidebar, HubMenu });