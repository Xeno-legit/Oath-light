/* ui.jsx — shared primitives: Logo, Switch, Segmented, AreaChart, Ring */

function Logo({ size = 21 }) {
  const [anim, setAnim] = React.useState('');

  return (
    <img
      src={(window.__resources && window.__resources.logo) || "logo.png"}
      width={size}
      height={size}
      className={'logo-img' + (anim === 'fwd' ? ' logo-spin-fwd' : anim === 'back' ? ' logo-spin-back' : '')}
      style={{ display: 'block', objectFit: 'contain' }}
      alt="Pure Path logo"
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

Object.assign(window, { Logo, Switch, Segmented, AreaChart, Ring });
