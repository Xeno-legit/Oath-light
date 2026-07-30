/* ui.jsx — shared primitives: Logo, Switch, Segmented, AreaChart, Ring */

/* ErrorBoundary — the thing that stops one broken page from taking the whole
 * app down with it.
 *
 * React 18's `createRoot` unmounts the ENTIRE tree when a render throws and no
 * boundary catches it. In an app with no build step, where every page is
 * transpiled in the browser at runtime, that is not a theoretical risk: a
 * single undefined global in one page file (an icon deleted in a refactor, say)
 * throws on first render and the user gets a black window with no sidebar, no
 * tray-reachable UI, and no way back. For a blocker that is the worst possible
 * failure — the panic flow, the mentor exercises and the settings that turn
 * things off all live behind that same window.
 *
 * So: `App` mounts one of these around the routed page (the sidebar and title
 * bar survive, and switching pages clears the error because the boundary is
 * keyed on the page id), and one more around the whole app as the last resort.
 * The fallback is deliberately built from plain elements and inline styles —
 * no Setting, no SectionCard, no icons — because whatever just broke might be
 * one of those.
 *
 * `scope="app"` renders the root-level variant, which can only offer a reload.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    // The webview console is the only place this can go — there is no crash
    // reporter and nothing is sent anywhere.
    console.error('[OathLight] render error caught by boundary:', err, info);
  }

  render() {
    if (!this.state.err) return this.props.children;

    const isApp = this.props.scope === 'app';
    const msg = String((this.state.err && this.state.err.message) || this.state.err);

    return (
      <div style={{ padding: isApp ? '48px 40px' : '38px 34px', maxWidth: 620 }}>
        <div style={{
          fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--muted, #8a8a8a)', marginBottom: 10,
        }}>
          Something broke
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.25 }}>
          {isApp
            ? "Oath Light couldn't draw its window."
            : "This page couldn't load."}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-2, #b5b5b5)', margin: '0 0 8px' }}>
          {isApp
            ? 'This is a bug in the app, not something you did. Blocking is unaffected — it runs in the background and in your browsers, not in this window.'
            : 'This is a bug in the app, not something you did. The rest of Oath Light still works, and blocking is unaffected — pick another page in the sidebar, or reload.'}
        </p>
        <p style={{
          fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted, #8a8a8a)',
          margin: '0 0 22px', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace',
        }}>
          {msg}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
            Reload the app
          </button>
          {!isApp && this.props.onHome &&
            <button className="btn btn-ghost btn-sm"
                    onClick={() => { this.setState({ err: null }); this.props.onHome(); }}>
              Back to Home
            </button>}
        </div>
      </div>
    );
  }
}

function Logo({ size = 21 }) {
  const [anim, setAnim] = React.useState('');

  return (
    <img
      src={(window.__resources && window.__resources.logo) || "logo.png"}
      width={size}
      height={size}
      className={'logo-img' + (anim === 'fwd' ? ' logo-spin-fwd' : anim === 'back' ? ' logo-spin-back' : '')}
      style={{ display: 'block', objectFit: 'contain' }}
      alt="Oath Light logo"
      onMouseEnter={() => { setAnim('fwd'); }}
      onMouseLeave={() => { setAnim('back'); }}
      onAnimationEnd={() => { if (anim === 'back') setAnim(''); }}
    />
  );
}

function Switch({ on, onClick, disabled }) {
  return (
    <button
      className={'switch' + (on ? ' on' : '')}
      onClick={disabled ? undefined : onClick}
      role="switch"
      aria-checked={on}
      disabled={!!disabled} />);

}

function Segmented({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* InfoDot — the replacement for explanatory paragraphs.
 *
 * The settings pages used to carry their full rationale as body copy under
 * every row, which made them unreadable: the important part (what the switch
 * does) drowned in the unimportant part (why it works that way). The rule now
 * is that a row states what it does in one line, and anything longer hides
 * behind one of these.
 *
 * It opens on CLICK of the icon and on nothing else. It used to open on
 * `:hover` of its wrapper, which was wrong twice over: an icon whose whole
 * purpose is to be the handle for the explanation should be pressed, not
 * brushed past — and because a container rule blockified the wrapper to the
 * full width of the row (see the display guard in styles.css), "hovering the
 * wrapper" in practice meant hovering anywhere along the title line, so the
 * bubble fired at people reading the text. Click is deliberate; nothing opens
 * by accident.
 *
 * It is a real <button> rather than a `title=` attribute so it is announced,
 * focusable and styleable. Escape and any outside click close it.
 */
function InfoDot({ children, label = 'More information' }) {
  const [open, setOpen] = React.useState(false);
  // Which corner the bubble hangs from, decided per-open by measurement below.
  const [place, setPlace] = React.useState({ align: 'start', side: 'below' });
  const wrapRef = React.useRef(null);
  const bubbleRef = React.useRef(null);
  const btnRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();          // don't also close the dialog behind it
      setOpen(false);
      if (btnRef.current) btnRef.current.focus();
    };
    // Capture phase: the pick button under a <Choice> stops propagation of its
    // own events, and this needs to win regardless.
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Flip the bubble before it is painted if the default corner would push it
  // off screen. Default is start-aligned and below, which is where an
  // explanation for a left-hand label belongs; the flips are for dots that end
  // up near the right or bottom edge.
  //
  // It re-measures after its own flip rather than deciding once, because one
  // measurement can be taken before the bubble has settled at its final size
  // and then never revisited. Each axis only ever flips AWAY from the default,
  // so this converges in at most one extra pass instead of oscillating.
  React.useLayoutEffect(() => {
    if (!open || !bubbleRef.current) return;
    const b = bubbleRef.current.getBoundingClientRect();
    const M = 12;
    const next = {
      align: place.align === 'end' || b.right > window.innerWidth - M ? 'end' : 'start',
      side: place.side === 'above' || b.bottom > window.innerHeight - M ? 'above' : 'below',
    };
    if (next.align !== place.align || next.side !== place.side) setPlace(next);
  }, [open, place.align, place.side]);

  // Next open re-decides from scratch — the window may have been resized, or
  // the row scrolled somewhere else entirely, since the last one.
  React.useEffect(() => {
    if (!open) setPlace({ align: 'start', side: 'below' });
  }, [open]);

  return (
    <span className={'infodot' + (open ? ' open' : '')} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={'infodot-btn' + (open ? ' on' : '')}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          // This dot lives inside <label>s (where a click would toggle the
          // checkbox) and inside <Choice> cards (where it would pick the
          // option). Neither is what pressing "explain this" means.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11.5" x2="12" y2="16.5" />
          <circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <span
        className="infodot-bubble"
        ref={bubbleRef}
        role="note"
        data-align={place.align}
        data-side={place.side}>
        {children}
      </span>
    </span>
  );
}

/* Setting — the one settings row used across every page.
 *
 * `title` is the label, `desc` the single short line under it, `info` the long
 * explanation (rendered into an InfoDot, never inline). `children` is whatever
 * control sits at the end of the row — a Switch, a button, a chip. Pages are
 * not supposed to hand-roll `.setting` markup any more; when they all did,
 * every page drifted into its own spacing and its own idea of how much text
 * was acceptable.
 */
function Setting({ icon: I, title, desc, info, children, tone }) {
  const toneStyle = tone === 'danger'
    ? { background: 'color-mix(in oklab, var(--ol-danger) 14%, transparent)', color: 'var(--ol-danger)' }
    : tone === 'ok'
    ? { background: 'color-mix(in oklab, var(--ol-ok) 14%, transparent)', color: 'var(--ol-ok)' }
    : undefined;
  return (
    <div className="setting">
      {I && <div className="ico" style={toneStyle}><I size={20} /></div>}
      <div className="txt">
        <b>{title}{info && <InfoDot label={`About: ${title}`}>{info}</InfoDot>}</b>
        {desc && <span>{desc}</span>}
      </div>
      {children != null && <div className="setting-ctl">{children}</div>}
    </div>
  );
}

/* SectionCard — a titled group of Settings. Same reasoning as Setting: one
 * definition, so section headers can't drift in size/spacing per page. */
function SectionCard({ title, sub, info, children, style }) {
  return (
    <div className="card fade-up sec" style={style}>
      {title &&
        <div className="sec-head">
          <div className="sec-title">
            {title}{info && <InfoDot label={`About: ${title}`}>{info}</InfoDot>}
          </div>
          {sub && <div className="sec-sub">{sub}</div>}
        </div>}
      {children}
    </div>
  );
}

/* Choice / Choices — the one "pick exactly one of these" control.
 *
 * Every page that offers a mutually-exclusive set (strictness, voice,
 * language, atmosphere) renders it through here. Before this existed the same
 * idea appeared three ways — a bordered card grid on Blocking, a different
 * bordered card grid on Themes, and a row of Choose/Selected buttons in
 * Settings — so "which one is selected?" looked different on each page.
 *
 * The whole card is the hit target, but the pick button is a SIBLING overlay
 * rather than a wrapper: an InfoDot inside a choice is itself a button, and
 * nesting one button in another is both invalid markup and a trap where
 * opening the explanation silently applies the option.
 */
function Choice({ name, desc, info, icon: I, selected, disabled, onSelect, lang, dir }) {
  return (
    <div className={'choice' + (selected ? ' sel' : '') + (disabled ? ' locked' : '')}>
      <button className="choice-hit" aria-pressed={selected} disabled={!!disabled}
              onClick={disabled ? undefined : onSelect}>
        <span className="sr-only">{selected ? `${name}, selected` : `Choose ${name}`}</span>
      </button>
      <div className="choice-head">
        <span className="choice-name" lang={lang} dir={dir}>
          {I && <I size={17} />}
          {name}
          {info && <InfoDot label={`About ${name}`}>{info}</InfoDot>}
        </span>
        {selected && <span className="choice-mark"><IconCheck size={14} /></span>}
      </div>
      {desc && <div className="choice-desc">{desc}</div>}
    </div>
  );
}

function Choices({ children, columns }) {
  return (
    <div className="choices"
         style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {children}
    </div>
  );
}

/* Smooth area chart with gradient fill + animated draw */
function AreaChart({ data, height = 132, accent = 'var(--accent)', accent2 = 'var(--accent-2)' }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(560);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const pad = 6;
  const min = Math.min(...data) - 6;
  const max = Math.max(...data) + 6;
  const H = height;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / (max - min)) * (H - pad * 2 - 14);
    return [x, y];
  });
  // catmull-rom -> bezier smoothing
  function smooth(p) {
    if (p.length < 2) return '';
    let d = `M ${p[0][0]} ${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  }
  const line = smooth(pts);
  const area = line + ` L ${pts[pts.length - 1][0]} ${H} L ${pts[0][0]} ${H} Z`;
  const last = pts[pts.length - 1];

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={H} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.34" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor={accent2} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="url(#lineStroke)" strokeWidth="2.5"
              strokeLinecap="round" className="chart-line" pathLength="1" />
        <circle cx={last[0]} cy={last[1]} r="5" fill="var(--bg-1)" stroke="url(#lineStroke)" strokeWidth="2.5" />
        <circle cx={last[0]} cy={last[1]} r="11" fill={accent} opacity="0.18">
          <animate attributeName="r" values="6;13;6" dur="2.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.28;0;0.28" dur="2.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

/* progress ring */
function Ring({ value, size = 168, stroke = 12, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="color-mix(in oklab, var(--text) 12%, transparent)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)"
                strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
                strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 1.2s var(--ease)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}

/* PasswordGate — the one modal every gated weakening (4.2) funnels through.
 * Invisible until `window.PPAuth.acquire()` actually needs a password: on
 * mount it registers `window.__ppAuthPrompt = () => new Promise(...)`, which
 * `acquire()` calls and awaits. There is deliberately no Rust-side trust
 * placed in anything this component does — the real gate is
 * `auth::require_auth` in lib.rs; this is purely the UI for collecting the
 * password and turning it into a verified session token via
 * `PPAuth.verify()`. See tauri-bridge.jsx's `PPAuth.acquire()` doc comment
 * for the full contract (resolve with a token, or reject `Error('cancelled')`
 * on dismiss). */
function PasswordGate() {
  const [open, setOpen] = React.useState(false);
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // The in-flight prompt's resolve/reject, captured when `__ppAuthPrompt` is
  // called — kept in a ref (not state) since it's only ever read from event
  // handlers, never rendered.
  const waiter = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    window.__ppAuthPrompt = () => new Promise((resolve, reject) => {
      // A second concurrent prompt (rare — two gated actions racing) just
      // cancels the first one rather than stacking modals; the first
      // caller's `acquire()` sees a 'cancelled' rejection and aborts.
      if (waiter.current) waiter.current.reject(new Error('cancelled'));
      waiter.current = { resolve, reject };
      setPw('');
      setErr('');
      setOpen(true);
    });
    return () => { delete window.__ppAuthPrompt; };
  }, []);

  React.useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const close = (rejectErr) => {
    setOpen(false);
    setBusy(false);
    if (waiter.current) {
      if (rejectErr) waiter.current.reject(rejectErr); else waiter.current.resolve();
      waiter.current = null;
    }
  };

  const cancel = () => close(new Error('cancelled'));

  const unlock = () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr('');
    window.PPAuth.verify(pw).then((token) => {
      setOpen(false);
      setBusy(false);
      if (waiter.current) { waiter.current.resolve(token); waiter.current = null; }
    }).catch((e) => {
      // Wrong password: re-try in place, same modal, cleared field — never
      // treated as a cancel (that's only the explicit Cancel button / Esc).
      setBusy(false);
      setPw('');
      setErr((e && e.message) ? e.message : 'Wrong password.');
      if (inputRef.current) inputRef.current.focus();
    });
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.45)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="card" style={{ width: 360, maxWidth: '90vw', padding: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Enter your master password</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
          This change weakens Oath Light's protection, so it needs your master password first.
        </div>
        <input
          ref={inputRef}
          type="password"
          className="input"
          placeholder="Master password"
          value={pw}
          disabled={busy}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') unlock(); if (e.key === 'Escape') cancel(); }}
        />
        {err && <div style={{ fontSize: 12.5, color: '#ef4444', marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy || !pw} onClick={unlock}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Rich strings ──────────────────────────────────────────────────────────
 * `PP.t()` returns a plain string, but a lot of this app's copy carries one
 * emphasised span — the italic serif word in a page title, the bold duration
 * in a pending-change note. Splitting those into `title_lead` + `title_em`
 * key pairs was the alternative, and it's a bad one: it hands a translator
 * sentence fragments, and it stops the serious voice from restructuring the
 * sentence (which is the entire point of the second voice).
 *
 * So the emphasis lives INSIDE the string, in a two-marker subset of
 * markdown, and this renders it:
 *
 *   *word*    -> <em>   (the italic serif accent used in page titles)
 *   **word**  -> <b>    (the bold value in a status/pending line)
 *
 * Interpolation happens first, so `**{hours}h**` bolds whatever went in.
 * Anything without markers renders as plain text and costs nothing.
 */
function tRich(key, params) {
  const str = PP.t(key, params);
  if (typeof str !== 'string' || str.indexOf('*') === -1) return str;

  // Split on the markers, keeping them: **strong** is matched before *em* so
  // the double marker never reads as two empty emphases.
  const parts = str.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
      return <b key={i}>{part.slice(2, -2)}</b>;
    }
    if (part.length > 2 && part[0] === '*' && part[part.length - 1] === '*') {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

Object.assign(window, {
  Logo, Switch, Segmented, AreaChart, Ring, PasswordGate,
  InfoDot, Setting, SectionCard, Choice, Choices, tRich,
  ErrorBoundary,
});
