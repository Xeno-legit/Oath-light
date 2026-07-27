/* pages-themes.jsx — Noir + fully custom colors (UX Direction §7).
 *
 * The old multi-palette picker (aurora/lagoon/dawn/midnight/forest/ember) is
 * GONE, by owner decision: maintaining several curated palettes is work that
 * buys nothing, and none of them were the design system. What replaces it is
 * strictly more capable — **Noir is the only built-in theme**, and the user
 * edits the design system's own color tokens directly, applied as runtime
 * `--ol-*` overrides on top of the Noir defaults.
 *
 * Why editing `--ol-*` actually works: under `[data-style="noir"]`, styles.css
 * defines its own variables (`--accent`, `--text`, `--bg-0`, …) as
 * `var(--ol-accent)`, `var(--ol-text-1)`, … So a root-level override of an
 * `--ol-*` token cascades through the entire app, the same way it does in
 * design-system/preview.html. That is the whole mechanism — no rebuild, no
 * stylesheet swapping, no second source of truth.
 *
 * Dark and light are both part of Noir (not separate themes), so overrides are
 * stored per side: `s.customTokens.dark` / `.light`.
 */

// Atmosphere is an independent axis from color and survives the palette
// removal untouched — it drives the animated canvas, not the token layer.
const BG_OPTS = [
{ id: 'both',   name: 'Full atmosphere', desc: 'Orbs, particles & flowing waves', icon: IconAtmosphere },
{ id: 'orbs',   name: 'Drifting orbs',   desc: 'Soft glowing orbs & particles',  icon: IconOrbs },
{ id: 'waves',  name: 'Flowing waves',   desc: 'Gentle layered waves only',      icon: IconWave },
{ id: 'stars',  name: 'Starfield',       desc: 'Twinkling stars across the canvas', icon: IconStars },
{ id: 'ripple', name: 'Ripple',          desc: 'Slow concentric rings from center', icon: IconRipple },
{ id: 'smoke',  name: 'Smoke',           desc: 'Large soft clouds drifting upward', icon: IconSmoke },
{ id: 'off',    name: 'Minimal',         desc: 'Still background, no motion',    icon: IconMinimal },
];

// The editable color tokens, read from the shared manifest (tokens.js, a
// byte-identical copy of design-system/tokens.js). Only the `color` group is
// exposed: type/spacing/motion tokens are structural design-system decisions,
// not personalization, and letting a user set `--ol-size-base: 40px` would
// just break their own layout. Guarded so a missing manifest degrades to an
// empty editor instead of crashing the page.
function colorTokens() {
  const all = (typeof window !== 'undefined' && window.OL_TOKENS) || [];
  return all.filter((t) => t.group === 'color' && t.type === 'color');
}

// The value to show in a swatch: the user's override if there is one,
// otherwise whatever Noir currently computes for that token. `getComputedStyle`
// is the honest read — it reflects the live cascade including the active
// theme side, so the picker always opens on the color actually on screen.
function currentValue(name, override) {
  if (override) return override;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || '#000000';
  } catch (e) {
    return '#000000';
  }
}

// `<input type="color">` only accepts `#rrggbb`. tokens.css is authored in hex
// so this is nearly always a straight pass-through, but a token carrying
// `rgba()`/`color-mix()` would otherwise silently reset the swatch to black —
// return null instead and let the caller fall back to a text input.
function asHex(value) {
  const v = (value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  }
  return null;
}

function TokenRow({ token, override, onChange, onClear }) {
  const live = currentValue(token.name, override);
  const hex = asHex(live);
  return (
    <div className="setting">
      <div className="ico" style={{
        background: live,
        border: '1px solid var(--glass-brd-strong)',
        borderRadius: 10,
      }} />
      <div className="txt">
        <b>{token.label}</b>
        <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{token.name}</span>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        {hex !== null ?
          <input
            type="color"
            value={hex}
            aria-label={token.label}
            onChange={(e) => onChange(token.name, e.target.value)}
            style={{ width: 42, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} /> :
          <input
            className="input"
            value={live}
            aria-label={token.label}
            onChange={(e) => onChange(token.name, e.target.value)}
            style={{ width: 180, fontFamily: 'monospace', fontSize: 12 }} />}
        {override &&
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => onClear(token.name)}>Reset</button>}
      </div>
    </div>
  );
}

function ThemesPage({ s, PP }) {
  // Light/dark and atmosphere still route through the tweak setter so the
  // Tweaks panel and this page stay in lockstep. Colors do NOT — they're store
  // state, not a tweak.
  const d = s.display;
  const apply = window.__setDisplayTweak || (() => {});

  const side = d.theme === 'light' ? 'light' : 'dark';
  const overrides = (s.customTokens && s.customTokens[side]) || {};
  const tokens = colorTokens();
  const overrideCount = Object.keys(overrides).length;

  // Writes go through `put` rather than `set`: deepMerge would keep old keys
  // forever, so clearing an override would be impossible.
  const writeSide = (next) => {
    PP.put('customTokens', Object.assign({}, s.customTokens, { [side]: next }));
  };
  const setToken = (name, value) => writeSide(Object.assign({}, overrides, { [name]: value }));
  const clearToken = (name) => {
    const next = Object.assign({}, overrides);
    delete next[name];
    writeSide(next);
  };
  const resetSide = () => writeSide({});

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Themes</div>
        <h1 className="page-title">Make the space <em style={{ fontFamily: "Manrope" }}>yours</em></h1>
        <p className="page-sub">
          Oath Light ships in Noir. Everything below layers on top of it — set any color you like,
          on either side, and reset back to Noir whenever you want.
        </p>
      </div>

      {/* light/dark — both sides of Noir, not separate themes */}
      <div className="card fade-up spread">
        <div className="row" style={{ gap: 14 }}>
          <div className="ico" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 13, display: 'grid', placeItems: 'center', background: 'color-mix(in oklab, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            {d.theme === 'dark' ? <IconMoon size={21} /> : <IconSun size={21} />}
          </div>
          <div>
            <b style={{ fontSize: 15.5, fontWeight: 800 }}>Appearance</b>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Switch between a bright or restful interface. Colors are saved separately for each.
            </div>
          </div>
        </div>
        <Segmented value={d.theme} onChange={(v) => apply({ theme: v })} options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' }]
        } />
      </div>

      {/* custom colors — the replacement for the old palette grid */}
      <div className="spread" style={{ margin: '24px 4px 12px', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          Colors <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 13 }}>· {side} mode</span>
        </div>
        {overrideCount > 0 &&
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={resetSide}>
            Reset all {overrideCount} to Noir
          </button>}
      </div>
      <div className="card fade-up">
        {tokens.length === 0 &&
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Token manifest unavailable — colors can't be edited in this build.
          </div>}
        {tokens.map((tk) => (
          <TokenRow
            key={tk.name}
            token={tk}
            override={overrides[tk.name] || null}
            onChange={setToken}
            onClear={clearToken} />
        ))}
      </div>

      {/* atmosphere */}
      <div style={{ fontWeight: 800, fontSize: 15, margin: '24px 4px 12px' }}>Atmosphere</div>
      <div className="grid fade-up" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        {BG_OPTS.map((o) =>
        <button key={o.id} className={'card hover bg-card' + (d.bg === o.id ? ' sel' : '')} onClick={() => apply({ bg: o.id })}>
            <div className="row" style={{ gap: 12 }}>
              <div className="bg-card-ico"><o.icon size={20} /></div>
              <div style={{ textAlign: 'start' }}>
                <b style={{ fontSize: 14.5, fontWeight: 800 }}>{o.name}</b>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{o.desc}</div>
              </div>
              {d.bg === o.id && <span className="style-check" style={{ marginInlineStart: 'auto', position: 'static' }}><IconCheck size={15} /></span>}
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
