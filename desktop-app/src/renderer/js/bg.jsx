/* bg.jsx — animated background: orbs, waves, particles, stars, ripple, smoke */
function AnimatedBG({ bg, intensity }) {
  const showOrbs = bg === 'both' || bg === 'orbs';
  const showWaves = bg === 'both' || bg === 'waves';
  const showParticles = bg === 'both' || bg === 'orbs';

  const particles = React.useMemo(() => Array.from({ length: 16 }, () => ({
    left: Math.random() * 100,
    size: 3 + Math.random() * 7,
    dur: 16 + Math.random() * 22,
    delay: -Math.random() * 30,
  })), []);

  const stars = React.useMemo(() => Array.from({ length: 80 }, () => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 1 + Math.random() * 2.5,
    dur: 2 + Math.random() * 4,
    delay: -Math.random() * 6,
    op: 0.3 + Math.random() * 0.6,
  })), []);

  const ripples = React.useMemo(() => [0, 1, 2, 3], []);

  const smokes = React.useMemo(() => Array.from({ length: 6 }, () => ({
    left: 10 + Math.random() * 80,
    size: 260 + Math.random() * 180,
    dur: 28 + Math.random() * 20,
    delay: -Math.random() * 40,
  })), []);

  const wavePath = (a) =>
    `M0 ${a} C 180 ${a-28}, 360 ${a+28}, 540 ${a} S 900 ${a-28}, 1080 ${a} S 1440 ${a+28}, 1620 ${a} S 1980 ${a-28}, 2160 ${a} V 240 H 0 Z`;

  return (
    <div className="bg" aria-hidden="true">
      {/* ---- ORBS ---- */}
      {showOrbs && (
        <React.Fragment>
          <div className="bg-orb o1" />
          <div className="bg-orb o2" />
          <div className="bg-orb o3" />
        </React.Fragment>
      )}

      {/* ---- RISING PARTICLES ---- */}
      {showParticles && particles.map((p, i) => (
        <span key={i} className="bg-particle" style={{
          left: p.left + '%', bottom: '-10px',
          width: p.size, height: p.size,
          animationDuration: p.dur + 's', animationDelay: p.delay + 's',
        }} />
      ))}

      {/* ---- WAVES ---- */}
      {showWaves && (
        <div className="bg-waves">
          <svg viewBox="0 0 2160 240" preserveAspectRatio="none">
            <path className="w1" d={wavePath(120)} fill="var(--orb-a)" />
            <path className="w2" d={wavePath(150)} fill="var(--orb-c)" />
            <path className="w3" d={wavePath(175)} fill="var(--orb-b)" />
          </svg>
        </div>
      )}

      {/* ---- STARS ---- */}
      {bg === 'stars' && stars.map((s, i) => (
        <span key={i} style={{
          position: 'absolute',
          left: s.left + '%', top: s.top + '%',
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: 'var(--text)',
          opacity: s.op * intensity / 10,
          animation: `twinkle ${s.dur}s ${s.delay}s var(--ease-soft) infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      {/* ---- RIPPLE ---- */}
      {bg === 'ripple' && ripples.map((_, i) => (
        <span key={i} className="bg-ripple" style={{
          animationDelay: (i * 1.8) + 's',
          opacity: 0.18 * (intensity / 10),
        }} />
      ))}

      {/* ---- SMOKE ---- */}
      {bg === 'smoke' && smokes.map((s, i) => (
        <span key={i} style={{
          position: 'absolute',
          left: s.left + '%', bottom: '-80px',
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 40%, var(--orb-${['a','b','c','a','b','c'][i]}), transparent 70%)`,
          filter: 'blur(55px)',
          opacity: 0.35 * (intensity / 10),
          animation: `smoke-drift ${s.dur}s ${s.delay}s linear infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      <div className="bg-veil" />
    </div>
  );
}
window.AnimatedBG = AnimatedBG;
