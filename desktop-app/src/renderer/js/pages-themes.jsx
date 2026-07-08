/* pages-themes.jsx — visual style + theme + atmosphere. Mirrors the Tweaks panel. */
const STYLE_OPTS = [
{ id: 'aurora',   name: 'Aurora',     desc: 'Violet & soft pink — dreamy and calm',       a: '#7c5cff', b: '#e879c6' },
{ id: 'lagoon',   name: 'Cool Teal',  desc: 'Teal & green — fresh and grounding',         a: '#1fb6c9', b: '#3fd49a' },
{ id: 'dawn',     name: 'Dawn',       desc: 'Peach & rose — warm and gentle',             a: '#ff8a6b', b: '#ff7aa0' },
{ id: 'midnight', name: 'Midnight',   desc: 'Navy & electric blue — cool and focused',    a: '#1a5fff', b: '#7c63ff' },
{ id: 'forest',   name: 'Forest',     desc: 'Pine & sage green — grounded and earthy',   a: '#1f9e5c', b: '#5ec44a' },
{ id: 'ember',    name: 'Ember',      desc: 'Charcoal & burnt orange — warm energy',     a: '#cc6010', b: '#cc2a10' },
{ id: 'noir',     name: 'Noir',       desc: 'Black & white — pure monochrome focus',     a: '#111111', b: '#f5f5f5' },
];

const BG_OPTS = [
{ id: 'both',   name: 'Full atmosphere', desc: 'Orbs, particles & flowing waves', icon: IconAtmosphere },
{ id: 'orbs',   name: 'Drifting orbs',   desc: 'Soft glowing orbs & particles',  icon: IconOrbs },
{ id: 'waves',  name: 'Flowing waves',   desc: 'Gentle layered waves only',      icon: IconWave },
{ id: 'stars',  name: 'Starfield',       desc: 'Twinkling stars across the canvas', icon: IconStars },
{ id: 'ripple', name: 'Ripple',          desc: 'Slow concentric rings from center', icon: IconRipple },
{ id: 'smoke',  name: 'Smoke',           desc: 'Large soft clouds drifting upward', icon: IconSmoke },
{ id: 'off',    name: 'Minimal',         desc: 'Still background, no motion',    icon: IconMinimal },
];


function ThemesPage({ s, PP }) {
  // these call into the tweak setter exposed on window so the panel + page stay in sync
  const d = s.display;
  const apply = window.__setDisplayTweak || (() => {});

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Themes</div>
        <h1 className="page-title">Make the space <em style={{ fontFamily: "Manrope" }}>yours</em></h1>
        <p className="page-sub">A calm environment helps a calm mind. Choose a palette and atmosphere that feels like a deep breath.</p>
      </div>

      {/* light/dark */}
      <div className="card fade-up spread">
        <div className="row" style={{ gap: 14 }}>
          <div className="ico" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 13, display: 'grid', placeItems: 'center', background: 'color-mix(in oklab, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            {d.theme === 'dark' ? <IconMoon size={21} /> : <IconSun size={21} />}
          </div>
          <div>
            <b style={{ fontSize: 15.5, fontWeight: 800 }}>Appearance</b>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Switch between a bright or restful interface.</div>
          </div>
        </div>
        <Segmented value={d.theme} onChange={(v) => apply({ theme: v })} options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' }]
        } />
      </div>

      {/* palette */}
      <div style={{ fontWeight: 800, fontSize: 15, margin: '24px 4px 12px' }}>Palette</div>
      <div className="grid fade-up" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {STYLE_OPTS.map((o) =>
        <button key={o.id} className={'card hover style-card' + (d.style === o.id ? ' sel' : '')} onClick={() => apply({ style: o.id })}>
            <div className="style-swatch" style={{ background: `linear-gradient(135deg, ${o.a}, ${o.b})` }}>
              {d.style === o.id && <span className="style-check"><IconCheck size={16} /></span>}
            </div>
            <div style={{ fontWeight: 800, fontSize: 15.5, marginTop: 13 }}>{o.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{o.desc}</div>
          </button>
        )}
      </div>

      {/* atmosphere */}
      <div style={{ fontWeight: 800, fontSize: 15, margin: '24px 4px 12px' }}>Atmosphere</div>
      <div className="grid fade-up" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {BG_OPTS.map((o) =>
        <button key={o.id} className={'card hover bg-card' + (d.bg === o.id ? ' sel' : '')} onClick={() => apply({ bg: o.id })}>
            <div className="row" style={{ gap: 12 }}>
              <div className="bg-card-ico"><o.icon size={20} /></div>
              <div style={{ textAlign: 'left' }}>
                <b style={{ fontSize: 14.5, fontWeight: 800 }}>{o.name}</b>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{o.desc}</div>
              </div>
              {d.bg === o.id && <span className="style-check" style={{ marginLeft: 'auto', position: 'static' }}><IconCheck size={15} /></span>}
            </div>
          </button>
        )}
      </div>

      {/* motion */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <b style={{ fontSize: 15, fontWeight: 800 }}>Motion intensity</b>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>How lively the background feels.</div>
          </div>
          <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{d.intensity}</span>
        </div>
        <input type="range" className="pp-range" min="0" max="10" value={d.intensity}
        style={{ ['--fill']: d.intensity * 10 + '%' }}
        onChange={(e) => apply({ intensity: +e.target.value })} />
      </div>
    </div>);

}
window.ThemesPage = ThemesPage;