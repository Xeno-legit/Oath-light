/* pages-themes.jsx — Noir + fully custom colours (UX Direction §7).
 *
 * The old multi-palette picker (aurora/lagoon/dawn/midnight/forest/ember) is
 * GONE, by owner decision: maintaining several curated palettes is work that
 * buys nothing, and none of them were the design system. What replaces it is
 * strictly more capable — **Noir is the only built-in theme**, and the user
 * edits the design system's own colour tokens directly, applied as runtime
 * `--ol-*` overrides on top of the Noir defaults.
 *
 * Why editing `--ol-*` actually works: styles.css defines its own variables
 * (`--accent`, `--text`, `--bg-0`, …) as `var(--ol-accent)`, `var(--ol-text-1)`,
 * … So a root-level override of an `--ol-*` token cascades through the entire
 * app, the same way it does in design-system/preview.html. That is the whole
 * mechanism — no rebuild, no stylesheet swapping, no second source of truth.
 *
 * Dark and light are both part of Noir (not separate themes), so overrides are
 * stored per side: `s.customTokens.dark` / `.light`.
 *
 * **The rebuild.** The previous version put all seventeen colour tokens in one
 * undifferentiated list, each row labelled with its raw custom-property name,
 * with no way to see what a change did without scrolling away from it. That is
 * a token inspector, not a theme picker. What it is now:
 *
 *   * Colours are grouped by what they DO — accents, text, surfaces, status —
 *     because "Accent 2" and "Background 3" mean nothing to someone who has
 *     not read tokens.css. The group is the explanation.
 *   * Each group is collapsed until opened, so the page opens on four short
 *     rows instead of seventeen colour pickers.
 *   * A live preview sits above them showing a real button, a real card and
 *     real text in the current values, so the effect of a change is visible
 *     without leaving the page.
 *   * The raw `--ol-*` name moved into an InfoDot. It still matters (it is
 *     what a user pastes into a bug report) but it is not what the row is
 *     about.
 *
 * **The atmosphere is gone.** This page used to end with a seven-option
 * animated-background picker and a 0–10 motion slider. That whole axis has
 * been replaced by four that do not animate: Look (the ground and surface
 * recipe), Neutral (the hue bias of the greys), Wallpaper (the user's own
 * image, with an enforced legibility scrim) and Interface (density and
 * reduce-motion). Nothing behind the app moves any more — ambient motion is
 * idle stimulation, which is the pattern this product exists to argue
 * against, and it was also the app's largest continuous paint cost.
 */

/* ── Looks ────────────────────────────────────────────────────────────────
 * What replaced the atmosphere. The old picker offered seven animated
 * backgrounds — orbs, waves, a starfield, ripples, smoke — plus a 0–10
 * "intensity" slider to make them move less. All of it drew on top of the
 * app forever, none of it carried information, and ambient motion is the
 * exact pattern this product argues against.
 *
 * A look is not a background. It is a ground (what the field behind the app
 * is made of), a surface (how a card separates from it) and a chrome
 * (whether the sidebar sits on its own tier), resolved entirely in CSS from
 * one `[data-look]` attribute. Nothing here animates.
 *
 * `group` sorts them on the page. Twelve options is a lot for one list, but
 * they are genuinely different rather than seven variations on drifting —
 * and grouped by what they FEEL like, the list is scannable in a way the old
 * flat one was not.
 */
const LOOK_GROUPS = [
  { id: 'quiet',      title: 'Quiet',      sub: 'Flat grounds. The interface is the only thing on screen.' },
  { id: 'structured', title: 'Structured', sub: 'Depth from tiers and borders rather than texture.' },
  { id: 'textured',   title: 'Textured',   sub: 'A material behind the app — woven, drawn or printed.' },
];

const LOOKS = [
  { id: 'matte',    group: 'quiet', name: 'Matte',    desc: 'Flat, with a fine grain',        icon: IconMatte,
    info: 'The default, and the closest thing to a plain page. A 2.5% noise texture over a flat ground — it exists to stop large dark fields from banding, which is the one thing a truly flat background genuinely gets wrong.' },
  { id: 'halo',     group: 'quiet', name: 'Halo',     desc: 'Matte, lit from above',          icon: IconHalo,
    info: 'Matte with one fixed light source over the page heading. Noir’s accent is white, so this reads as a soft grey lift rather than a colour — worth having if the flat version feels abrupt at the top of the window.' },
  { id: 'field',    group: 'quiet', name: 'Field',    desc: 'One still diagonal wash',        icon: IconFieldBg,
    info: 'A single fixed gradient across the window. This is the gradient depth the orbs used to provide, without the lava-lamp: it never moves and never composites a blurred layer.' },
  { id: 'theatre',  group: 'quiet', name: 'Theatre',  desc: 'Edges fall away',                icon: IconTheatre,
    info: 'The corners darken and the centre stays lit, so your eye lands on the content without anything moving. Attention by subtraction. Pairs badly with the two-tone looks, which is why it is its own option rather than a switch.' },

  { id: 'slate',    group: 'structured', name: 'Slate',    desc: 'Two-tone, nothing decorative', icon: IconSlate,
    info: 'The sidebar drops to the deepest tier and the content pane rises above it. No texture, no glow, no gradient — every edge in the app is either a tier change or a border. If you want Oath Light to look like an instrument rather than a product, this is it.' },
  { id: 'studio',   group: 'structured', name: 'Studio',   desc: 'Two-tone, content recessed',   icon: IconStudio,
    info: 'Slate plus a recessed content pane: the page sits in a well below the title bar, the way a document sits in a window frame. This is where most well-made desktop apps get their depth, and it needs no texture at all.' },
  { id: 'paper',    group: 'structured', name: 'Paper',    desc: 'Hairlines, no shadow',         icon: IconPaperBg,
    info: 'Shadows off, radii tightened. Every edge becomes a single hairline. The most severe option here and the least forgiving — with no shadow to soften it, anything slightly misaligned reads as a mistake rather than as a style.' },
  { id: 'drafting', group: 'structured', name: 'Drafting', desc: 'Dot grid, hairline cards',     icon: IconDrafting,
    info: 'A 23px dot matrix behind two-tone chrome. Dot grids are the vernacular of drawing boards and design canvases — they imply measurement, which is a good deal closer to what this app is for than a drifting orb was.' },

  { id: 'cloth',    group: 'textured', name: 'Cloth',     desc: 'A fine woven crosshatch',   icon: IconCloth,
    info: 'A directional weave rather than random noise. Structured texture reads as material; noise reads as an effect. The warmest and least clinical option here, and it pairs naturally with the warm neutral below.' },
  { id: 'contour',  group: 'textured', name: 'Contour',   desc: 'Elevation lines',           icon: IconContour,
    info: 'Topographic contour lines, still and irregular. Borrowed from maps rather than from screensavers — it suggests terrain and distance covered, which is the same idea the streak counter is getting at.' },
  { id: 'engrave',  group: 'textured', name: 'Engraved',  desc: 'Concentric fine rings',     icon: IconEngrave,
    info: 'The guilloche pattern used on certificates and banknotes. An oath is a document before it is an app, and this is the only look here that says so out loud.' },
  { id: 'halftone', group: 'textured', name: 'Halftone',  desc: 'Print dots, growing downward', icon: IconHalftone,
    info: 'A dot grid whose dots grow toward the bottom of the window, the way a printed halftone does. It gives the field a direction without putting a gradient in it.' },
];

// Hue bias of the greys. Noir is achromatic by default; the tempers shift the
// four background tiers only, never text, accent, border or status — so no
// choice here can change a contrast ratio.
const NEUTRALS = [
  { id: 'pure', name: 'Pure',  desc: 'Achromatic, as Noir ships' },
  { id: 'cool', name: 'Cool',  desc: 'A trace of blue in the greys' },
  { id: 'warm', name: 'Warm',  desc: 'A trace of brown in the greys' },
];

// The editable colour tokens, grouped by role. Names are matched against the
// shared manifest (tokens.js, a byte-identical copy of design-system/tokens.js)
// rather than redeclared, so a token added there shows up here — in the
// `other` bucket if it isn't assigned a role, which is visible rather than
// silently dropped.
const COLOR_GROUPS = [
  {
    id: 'accent',
    title: 'Accent',
    sub: 'The colour on buttons, switches and highlights.',
    info: 'Accent is the primary one — buttons, active switches, the streak ring. Accent 2 and 3 appear in gradients and charts. "Ink on accent" is the text drawn ON TOP of an accent fill: if that stops contrasting with Accent, button labels go invisible, which is exactly the bug it was added to fix.',
    names: ['--ol-accent', '--ol-accent-2', '--ol-accent-3', '--ol-accent-ink'],
  },
  {
    id: 'text',
    title: 'Text',
    sub: 'Three tiers, from headings down to hints.',
    info: 'Primary is headings and body, secondary is supporting lines, muted is timestamps and hints. Keeping all three distinguishable from each other AND from the background is what makes the interface readable — set them too close and the hierarchy collapses.',
    names: ['--ol-text-1', '--ol-text-2', '--ol-text-3'],
  },
  {
    id: 'surface',
    title: 'Surfaces',
    sub: 'The page, the cards and the borders between them.',
    info: 'Background 0 is the page itself; 1 through 3 are progressively raised surfaces — cards, panels, popovers. Depth in this app comes from those four steps plus the borders, not from shadows, so collapsing them onto one colour flattens the whole layout.',
    names: ['--ol-bg-0', '--ol-bg-1', '--ol-bg-2', '--ol-bg-3', '--ol-border', '--ol-border-strong', '--ol-focus-ring'],
  },
  {
    id: 'status',
    title: 'Status',
    sub: 'Good, careful, and stop.',
    info: 'Used for protection states and warnings — an active filter, a pending weakening, a failed action. These carry meaning rather than style, so it is worth keeping them recognisable as green/amber/red even while changing everything else.',
    names: ['--ol-ok', '--ol-warn', '--ol-danger'],
  },
  {
    id: 'ground',
    title: 'Ground',
    sub: 'What the looks above are drawn with.',
    info: 'The ink each look paints its ground in: the dot for the grid looks, the thread for woven and engraved ones, the edge for Theatre’s falloff, and the recess shadow under Studio’s content pane. "Surface top edge" is the 1px lit line along the top of every card — it is what makes a card read as a raised panel rather than a lighter rectangle, so setting it to the card colour flattens the whole app.',
    names: ['--ol-hairline', '--ol-ground-dot', '--ol-ground-thread', '--ol-ground-edge', '--ol-ground-well'],
  },
];

// Everything in the manifest's colour group, by name.
function colorTokenMap() {
  const all = (typeof window !== 'undefined' && window.OL_TOKENS) || [];
  const map = new Map();
  all.filter((t) => t.group === 'color' && t.type === 'color').forEach((t) => map.set(t.name, t));
  return map;
}

// The value to show in a swatch: the user's override if there is one,
// otherwise whatever Noir currently computes for that token. `getComputedStyle`
// is the honest read — it reflects the live cascade including the active theme
// side, so the picker always opens on the colour actually on screen.
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
      <div className="ico" style={{ background: live, border: '1px solid var(--glass-brd-strong)' }} />
      <div className="txt">
        <b>
          {token.label}
          <InfoDot label={`CSS name for ${token.label}`}>
            <code>{token.name}</code> — the design-system token this row sets. Overriding it here changes
            every place in the app that uses it.
          </InfoDot>
        </b>
        {override && <span>Changed from Noir</span>}
      </div>
      <div className="setting-ctl">
        {hex !== null
          ? <input type="color" value={hex} aria-label={token.label}
                   onChange={(e) => onChange(token.name, e.target.value)}
                   style={{ width: 42, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          : <input className="input" value={live} aria-label={token.label}
                   onChange={(e) => onChange(token.name, e.target.value)}
                   style={{ width: 180, fontFamily: 'monospace', fontSize: 12 }} />}
        {override &&
          <button className="btn btn-ghost btn-sm" onClick={() => onClear(token.name)}>Reset</button>}
      </div>
    </div>
  );
}

// A live sample of the things a colour change is most likely to break. Small
// on purpose — it is a check, not a showroom — but it deliberately includes an
// accent-filled button, because accent-vs-ink is the pairing that actually
// goes wrong.
function Preview() {
  return (
    <div className="theme-preview">
      <div className="theme-preview-row">
        <button type="button" className="btn btn-primary btn-sm" tabIndex={-1}>Primary</button>
        <button type="button" className="btn btn-ghost btn-sm" tabIndex={-1}>Ghost</button>
        <span className="chip">Chip</span>
        <span className="chip chip-ok">Active</span>
      </div>
      <div className="theme-preview-row">
        <b>Heading text</b>
        <span style={{ color: 'var(--text-2)' }}>Supporting line</span>
        <span style={{ color: 'var(--muted)' }}>Muted hint</span>
      </div>
      <div className="theme-preview-row">
        <span className="theme-preview-dot" style={{ background: 'var(--ol-ok)' }} />
        <span className="theme-preview-dot" style={{ background: 'var(--ol-warn)' }} />
        <span className="theme-preview-dot" style={{ background: 'var(--ol-danger)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>on · pending · blocked</span>
      </div>
    </div>
  );
}

function ColorGroup({ group, tokens, overrides, onChange, onClear }) {
  const [open, setOpen] = React.useState(false);
  const rows = group.names.map((n) => tokens.get(n)).filter(Boolean);
  if (rows.length === 0) return null;
  const changed = rows.filter((t) => overrides[t.name]).length;

  return (
    <React.Fragment>
      <Setting
        icon={IconPalette}
        title={group.title}
        desc={changed ? `${group.sub} · ${changed} changed` : group.sub}
        info={group.info}
        tone={changed ? 'ok' : undefined}>
        <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Edit'}
        </button>
      </Setting>
      {open &&
        <div className="sub-block">
          {rows.map((t) => (
            <TokenRow key={t.name} token={t} override={overrides[t.name] || null}
                      onChange={onChange} onClear={onClear} />
          ))}
        </div>}
    </React.Fragment>
  );
}

/* ── Wallpaper ────────────────────────────────────────────────────────────
 * The user's own image behind the app, which is a different proposition from
 * the atmosphere it replaces: it is static, it is chosen once, and it is
 * theirs rather than something the app decided to do at them.
 *
 * Two things are deliberately not negotiable. The image is downscaled on
 * import (PP.wallpaper.write) rather than stored at whatever size the camera
 * produced, and the scrim cannot be turned off — the slider bottoms out at
 * 25%, not 0. A photograph behind an interface is only ever as legible as
 * the scrim over it, and "I can't read my own blocklist" is not a preference
 * worth honouring.
 */
function WallpaperSection({ s, PP }) {
  const w = s.wallpaper || {};
  const fileRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const patch = (next) => PP.put('wallpaper', Object.assign({}, w, next));

  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                 // re-picking the same file must re-fire
    if (!file) return;
    setBusy(true); setErr(null);
    PP.wallpaper.write(file)
      .then(() => patch({ on: true, name: file.name }))
      .catch((ex) => setErr(ex.message))
      .then(() => setBusy(false));
  };

  const remove = () => {
    PP.wallpaper.clear();
    patch({ on: false, name: '' });
    setErr(null);
  };

  return (
    <SectionCard
      title="Wallpaper"
      sub="Your own image behind the app, if you want one."
      info="Applies to the desktop app only — the browser extension's pages are rendered by the browser in a separate context and don't receive it. The image is scaled down and stored locally on this machine; it is never uploaded anywhere.">

      <input ref={fileRef} type="file" accept="image/*" onChange={pick}
             style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />

      <Setting
        icon={IconImage}
        title={w.on && w.name ? w.name : 'No wallpaper'}
        desc={w.on ? 'Showing behind the app' : 'The look above is drawn on its own'}
        tone={w.on ? 'ok' : undefined}
        info="Large photographs are resized to at most 2560px wide and re-encoded before being saved, so a 6MB phone photo doesn't sit in local storage at full size for a background that renders behind a 55% scrim.">
        <button className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? 'Working…' : w.on ? 'Replace' : 'Choose image'}
        </button>
        {w.on && <button className="btn btn-ghost btn-sm" onClick={remove}>Remove</button>}
      </Setting>

      {err && <div className="err-note">{err}</div>}

      {w.on &&
        <React.Fragment>
          <Setting
            icon={IconMoon}
            title="Dim"
            desc={`${w.dim || 55}% — the darker this is, the more readable the app`}
            info="The scrim between your image and the interface. It stops at 25% rather than 0 on purpose: below that, text starts failing against a busy photograph, and an unreadable blocking app is a broken one.">
            <span className="chip">{w.dim || 55}%</span>
          </Setting>
          <div className="sub-block">
            <input type="range" className="pp-range" min="25" max="90" value={w.dim || 55}
                   aria-label="Wallpaper dim"
                   style={{ ['--fill']: ((((w.dim || 55) - 25) / 65) * 100) + '%' }}
                   onChange={(e) => patch({ dim: +e.target.value })} />
          </div>

          <Setting
            icon={IconSliders}
            title="Blur"
            desc={w.blur ? `${w.blur}px` : 'Sharp'}
            info="Blurring a photograph is the cheapest way to make it stop competing with the interface in front of it — detail becomes colour. At zero the image is shown as-is.">
            <span className="chip">{w.blur || 0}</span>
          </Setting>
          <div className="sub-block">
            <input type="range" className="pp-range" min="0" max="24" value={w.blur || 0}
                   aria-label="Wallpaper blur"
                   style={{ ['--fill']: (((w.blur || 0) / 24) * 100) + '%' }}
                   onChange={(e) => patch({ blur: +e.target.value })} />
          </div>
        </React.Fragment>}
    </SectionCard>
  );
}

function ThemesPage({ s, PP }) {
  // Light/dark, look, neutral, density and motion all route through the tweak
  // setter so the Tweaks panel and this page stay in lockstep. Colours and the
  // wallpaper do NOT — they're store state, not tweaks.
  const d = s.display;
  const apply = window.__setDisplayTweak || (() => {});

  const side = d.theme === 'light' ? 'light' : 'dark';
  const overrides = (s.customTokens && s.customTokens[side]) || {};
  const tokens = colorTokenMap();
  const overrideCount = Object.keys(overrides).length;

  // Any manifest colour token not claimed by a group above, so adding one to
  // tokens.js can never make it silently uneditable.
  const claimed = new Set(COLOR_GROUPS.flatMap((g) => g.names));
  const unclaimed = Array.from(tokens.keys()).filter((n) => !claimed.has(n));

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

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Themes</div>
        <h1 className="page-title">Make the space <em>yours</em></h1>
        <p className="page-sub">Oath Light ships in Noir. Everything below layers on top of it.</p>
      </div>

      <SectionCard
        title="Appearance"
        sub="Both are Noir — one lit for daytime, one for a dark room."
        info="Light and dark are two sides of the same theme, not two themes. Your custom colours are saved separately for each side, because a colour that reads well on black rarely reads well on white.">
        <Choices columns={2}>
          <Choice icon={IconSun} name="Light" desc="Bright surfaces, dark text"
                  selected={d.theme === 'light'} onSelect={() => apply({ theme: 'light' })} />
          <Choice icon={IconMoon} name="Dark" desc="Deep surfaces, light text"
                  selected={d.theme !== 'light'} onSelect={() => apply({ theme: 'dark' })} />
        </Choices>
      </SectionCard>

      <SectionCard
        title={`Colours · ${side} mode`}
        sub="Change any of them, and reset back to Noir whenever you want."
        info="These are the design system's own colour tokens, overridden live. Nothing is rebuilt and no stylesheet is swapped — the change lands in this app, the block screen and the browser popup at once, because all three read the same tokens.">

        <Preview />

        {tokens.size === 0 &&
          <div className="err-note">Token manifest unavailable — colours can't be edited in this build.</div>}

        {COLOR_GROUPS.map((g) => (
          <ColorGroup key={g.id} group={g} tokens={tokens} overrides={overrides}
                      onChange={setToken} onClear={clearToken} />
        ))}

        {unclaimed.length > 0 &&
          <ColorGroup
            group={{
              id: 'other', title: 'Other', sub: 'Tokens without a group yet.',
              info: 'These exist in the design-system manifest but have not been sorted into a role above. They are editable anyway — better visible and unlabelled than quietly missing.',
              names: unclaimed,
            }}
            tokens={tokens} overrides={overrides} onChange={setToken} onClear={clearToken} />}

        {overrideCount > 0 &&
          <div className="sub-block">
            <button className="btn btn-ghost btn-sm" onClick={() => writeSide({})}>
              Reset all {overrideCount} back to Noir
            </button>
          </div>}
      </SectionCard>

      <SectionCard
        title="Look"
        sub="What sits behind the app, and how a card lifts off it."
        info="A look is three decisions at once: the ground (the field behind everything), the surface (whether a card is a shadowed panel or a hairline outline) and the chrome (whether the sidebar sits on its own tier). None of them animate. The atmosphere that used to be here — orbs, waves, a starfield, drifting smoke — ran about a hundred animations continuously and told you nothing; this replaced it entirely.">
        {LOOK_GROUPS.map((g) => (
          <React.Fragment key={g.id}>
            <div className="sec-sub" style={{ marginTop: 4 }}>{g.title} — {g.sub}</div>
            <Choices>
              {LOOKS.filter((l) => l.group === g.id).map((l) => (
                <Choice key={l.id} icon={l.icon} name={l.name} desc={l.desc} info={l.info}
                        selected={d.look === l.id} onSelect={() => apply({ look: l.id })} />
              ))}
            </Choices>
          </React.Fragment>
        ))}
      </SectionCard>

      <SectionCard
        title="Neutral"
        sub="Whether the greys lean cool, warm, or neither."
        info="This only moves the four background tiers — text, accent, borders and status colours are untouched, so no choice here can change a contrast ratio or make anything harder to read. It is also the single largest change to how the app feels per unit of effort: a pure grey reads as unconsidered, a grey with a slight bias reads as chosen.">
        <Choices columns={3}>
          {NEUTRALS.map((n) => (
            <Choice key={n.id} icon={IconDroplet} name={n.name} desc={n.desc}
                    selected={(d.neutral || 'pure') === n.id} onSelect={() => apply({ neutral: n.id })} />
          ))}
        </Choices>
      </SectionCard>

      <WallpaperSection s={s} PP={PP} />

      <SectionCard
        title="Interface"
        sub="Spacing, and whether things move."
        info="Both of these replaced the old motion-intensity slider, which only ever scaled decorative animation. These are the two adjustments people actually ask for.">
        <Setting
          icon={IconDensity}
          title="Density"
          desc={(d.density || 'comfortable') === 'compact' ? 'Compact — tighter spacing' : 'Comfortable — the default spacing'}
          info="Trims the padding around and inside pages. Text size is deliberately NOT reduced — shrinking type is a different request, and usually an accessibility problem rather than a space saving.">
          <div className="seg">
            <button className={(d.density || 'comfortable') === 'comfortable' ? 'on' : ''}
                    onClick={() => apply({ density: 'comfortable' })}>Comfortable</button>
            <button className={d.density === 'compact' ? 'on' : ''}
                    onClick={() => apply({ density: 'compact' })}>Compact</button>
          </div>
        </Setting>

        <Setting
          icon={IconMotionOff}
          title="Reduce motion"
          desc={d.motion === 'off' ? 'On — transitions and entrances are off' : 'Off — transitions play normally'}
          info="Turns off page entrances, hover lifts and transitions. Nothing in the background moves any more regardless of this setting, so what's left is interaction feedback. If your system already asks for reduced motion, the app honours that on its own and this switch is not needed.">
          <button className={'switch' + (d.motion === 'off' ? ' on' : '')}
                  role="switch" aria-checked={d.motion === 'off'} aria-label="Reduce motion"
                  onClick={() => apply({ motion: d.motion === 'off' ? 'on' : 'off' })} />
        </Setting>
      </SectionCard>
    </div>
  );
}
window.ThemesPage = ThemesPage;
