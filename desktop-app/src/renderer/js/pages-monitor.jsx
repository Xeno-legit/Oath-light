/* pages-monitor.jsx — live AI screen monitor (Phase 4 optional AI monitoring).
 * Shows what the model just captured + its per-label scores, updated on each
 * `nsfw-scan` event emitted by the Rust backend. */

function ppRiskColor(nsfw) {
  if (nsfw >= 0.6) return '#ef4444';   // red
  if (nsfw >= 0.3) return '#f59e0b';   // amber
  return '#22c55e';                    // green
}

function ScoreBar({ label, value, highlight }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="row" style={{ alignItems: 'center', gap: 10, margin: '7px 0' }}>
      <div style={{ width: 160, fontSize: 13, fontWeight: highlight ? 700 : 500, opacity: highlight ? 1 : 0.82 }}>{label}</div>
      <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'rgba(127,127,127,.18)', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', borderRadius: 6, background: highlight ? '#6366f1' : 'rgba(127,127,127,.5)', transition: 'width .25s ease' }} />
      </div>
      <div style={{ width: 56, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</div>
    </div>
  );
}

function MonitorPage() {
  const native = !!(window.PPNative && PPNative.available);
  const [running, setRunning] = React.useState(false);
  const [last, setLast] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    if (!native) return;
    let unlisten = null, cancelled = false;
    PPNative.nsfwMonitorRunning().then((r) => { if (!cancelled) setRunning(r); });
    PPNative.onNsfwScan((scan) => {
      setLast(scan);
      setHistory((h) => [scan, ...h].slice(0, 8));
    }).then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, []);

  const start = () => { setErr(''); PPNative.startNsfwMonitor().then(() => setRunning(true)).catch((e) => setErr(String(e && e.message || e))); };
  const stop = () => { PPNative.stopNsfwMonitor().then(() => setRunning(false)); };

  const labels = (last && last.labels) || ['Anime-SFW', 'Hentai', 'Normal-SFW', 'Pornography', 'Enticing or Sensual'];
  const scores = (last && last.scores) || [];
  const nsfw = last ? last.nsfw_score : 0;
  const topIdx = scores.length ? scores.indexOf(Math.max(...scores)) : -1;

  return (
    <div className="page" style={{ maxWidth: 1040 }}>
      <div className="eyebrow">Phase 4 · optional AI monitoring</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>AI Screen Monitor</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Scans the screen with the on-device model whenever it changes meaningfully.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: running ? '#22c55e' : '#9ca3af', boxShadow: running ? '0 0 8px #22c55e' : 'none' }} />
            {running ? 'Monitoring' : 'Stopped'}
          </span>
          {running
            ? <button className="btn btn-ghost" onClick={stop}><IconX size={16} /> Stop</button>
            : <button className="btn btn-primary" onClick={start}><IconSearch size={16} /> Start monitoring</button>}
        </div>
      </div>

      {!native &&
        <div className="card" style={{ marginTop: 18, padding: 18 }}>
          Not running inside the desktop app — launch Pure Path (Tauri) to use the live monitor.
        </div>}

      {err &&
        <div className="card" style={{ marginTop: 14, padding: 14, borderColor: '#ef4444', color: '#ef4444' }}>{err}</div>}

      <div className="grid" style={{ gridTemplateColumns: '420px 1fr', gap: 18, marginTop: 18, alignItems: 'start' }}>
        {/* What it sees */}
        <div className="card" style={{ padding: 12 }}>
          <div className="nav-label" style={{ marginBottom: 8 }}>What it sees</div>
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'rgba(127,127,127,.12)', aspectRatio: '16 / 10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {last && last.thumb
              ? <img src={last.thumb} alt="last capture" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ opacity: 0.6, fontSize: 13 }}>{running ? 'waiting for a screen change…' : 'press Start to begin'}</span>}
            {last &&
              <span style={{ position: 'absolute', top: 8, right: 8, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: '#fff', background: ppRiskColor(nsfw) }}>
                {(nsfw * 100).toFixed(1)}% NSFW
              </span>}
          </div>
          {last &&
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10, fontSize: 11.5, opacity: 0.8 }}>
              <span className="chip">capture {last.capture_ms.toFixed(0)}ms</span>
              <span className="chip">infer {last.infer_ms.toFixed(0)}ms</span>
              <span className="chip">Δ {last.change.toFixed(0)}</span>
              <span className="chip">{last.width}×{last.height}</span>
              <span className="chip">{new Date(last.ts).toLocaleTimeString()}</span>
            </div>}
        </div>

        {/* Scores */}
        <div className="card" style={{ padding: 16 }}>
          <div className="nav-label" style={{ marginBottom: 8 }}>Classification</div>
          {last
            ? <>
                <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>{last.top_label}</span>
                  <span style={{ opacity: 0.7 }}>{(last.top_score * 100).toFixed(1)}%</span>
                </div>
                {labels.map((lab, i) => <ScoreBar key={lab} label={lab} value={scores[i] || 0} highlight={i === topIdx} />)}
                <div className="divider" style={{ margin: '14px 0' }} />
                <div className="row" style={{ gap: 18 }}>
                  <div><div className="nav-label">NSFW (Hentai+Porn)</div><div style={{ fontSize: 18, fontWeight: 700, color: ppRiskColor(nsfw) }}>{(nsfw * 100).toFixed(1)}%</div></div>
                  <div><div className="nav-label">Sensitive (+Enticing)</div><div style={{ fontSize: 18, fontWeight: 700 }}>{(last.sensitive_score * 100).toFixed(1)}%</div></div>
                </div>
              </>
            : <div style={{ opacity: 0.6, fontSize: 14, padding: '20px 0' }}>No scan yet. Results appear here when the screen changes.</div>}
        </div>
      </div>

      {/* Recent history */}
      {history.length > 0 &&
        <div className="card" style={{ padding: 14, marginTop: 18 }}>
          <div className="nav-label" style={{ marginBottom: 10 }}>Recent scans</div>
          <div className="row" style={{ gap: 10, overflowX: 'auto' }}>
            {history.map((h, i) =>
              <div key={h.ts + '-' + i} style={{ flex: '0 0 auto', width: 116, textAlign: 'center' }}>
                <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '16 / 10', background: 'rgba(127,127,127,.12)' }}>
                  {h.thumb && <img src={h.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <span style={{ position: 'absolute', bottom: 4, right: 4, padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: '#fff', background: ppRiskColor(h.nsfw_score) }}>
                    {(h.nsfw_score * 100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.top_label}</div>
              </div>
            )}
          </div>
        </div>}
    </div>
  );
}

Object.assign(window, { MonitorPage });
