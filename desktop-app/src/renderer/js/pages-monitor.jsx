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

// Assigns stable "Display N" labels to monitor ids in first-seen order (the
// ids themselves are opaque OS handles, not 1/2/3). Kept in a ref rather than
// state — it's only read during render of already-changing scan data, not a
// value that needs to itself trigger a re-render.
function monitorLabeler() {
  const order = [];
  return (monitorId) => {
    if (monitorId == null) return null;
    let idx = order.indexOf(monitorId);
    if (idx === -1) { order.push(monitorId); idx = order.length - 1; }
    return { label: 'Display ' + (idx + 1), multi: order.length > 1 };
  };
}

function MonitorPage() {
  const native = !!(window.PPNative && PPNative.available);
  const [running, setRunning] = React.useState(false);
  const [last, setLast] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [err, setErr] = React.useState('');
  const [overlayEvents, setOverlayEvents] = React.useState([]);
  // Friction (4.1): the live pending "Stop" request, if one is waiting out its
  // delay — the monitor is still actually running the whole time. Sourced from
  // the shared backend poll (not a local snapshot) so the countdown ticks and
  // the note survives navigating away from this page and back.
  const stopPending = (window.usePendingWeakenings || (() => []))()
    .find((p) => p.action_id === 'monitor.disable') || null;
  const labelFor = React.useRef(monitorLabeler()).current;

  React.useEffect(() => {
    if (!native) return;
    let unlisten = null, unlistenOverlay = null, cancelled = false;
    PPNative.nsfwMonitorRunning().then((r) => { if (!cancelled) setRunning(r); });
    PPNative.onNsfwScan((scan) => {
      labelFor(scan.monitor_id); // register this id's display order even if not shown yet
      setLast(scan);
      setHistory((h) => [scan, ...h].slice(0, 8));
    }).then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    PPNative.onNsfwOverlay((evt) => {
      setOverlayEvents((h) => [{ ...evt, ts: Date.now() }, ...h].slice(0, 6));
    }).then((fn) => { if (cancelled) fn(); else unlistenOverlay = fn; });
    return () => { cancelled = true; if (unlisten) unlisten(); if (unlistenOverlay) unlistenOverlay(); };
  }, []);

  const start = () => {
    setErr('');
    PPNative.startNsfwMonitor().then(() => setRunning(true))
      .catch((e) => setErr(String(e && e.message || e)));
  };
  // Stopping is a friction-gated weakening (4.1): the backend resolves
  // { applied, pending } instead of just stopping. `applied` true means there
  // was nothing to weaken (it was already stopped) — behave as before. When
  // `applied` is false the monitor is still running; the pending request
  // shows up via `stopPending` above within one poll.
  //
  // Also master-password gated (4.2) when a password is set — `PPAuth.acquire()`
  // resolves the session token to pass through (or `null` if no password is
  // configured), or rejects `Error('cancelled')` if the user dismissed the
  // prompt, in which case this aborts silently rather than showing an error.
  const stop = () => {
    (window.PPAuth ? PPAuth.acquire() : Promise.resolve(null))
      .then((auth) => PPNative.stopNsfwMonitor(auth))
      .then((outcome) => {
        if (outcome && outcome.applied) setRunning(false);
      })
      .catch((e) => {
        if (e && e.message === 'cancelled') return;
        setErr(String(e && e.message || e));
      });
  };

  // Re-sync the real running state whenever the pending stop appears or
  // disappears — the backend's applier thread does the actual stop once the
  // delay elapses (and a cancel from Settings withdraws it); either way this
  // notices and keeps the status chip honest.
  React.useEffect(() => {
    if (!native) return;
    PPNative.nsfwMonitorRunning().then((r) => setRunning(r));
  }, [!!stopPending]);

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
          {stopPending &&
            /* fmtDur is a plain top-level function in pages-settings.jsx; cross-file
               load order is safe here for the same reason noted in pages-blocking.jsx. */
            <span className="chip" style={{ color: 'var(--muted)' }}>
              Stops in {fmtDur(stopPending.remaining_secs)} — cancel in Settings
            </span>}
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
              {labelFor(last.monitor_id).multi &&
                <span className="chip" style={{ fontWeight: 700 }}>{labelFor(last.monitor_id).label}</span>}
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
                  {labelFor(h.monitor_id).multi &&
                    <span style={{ position: 'absolute', top: 4, left: 4, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.55)' }}>
                      {labelFor(h.monitor_id).label}
                    </span>}
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.top_label}</div>
              </div>
            )}
          </div>
        </div>}

      {/* Action-layer overlay lifecycle (escalated/dismissed) — see overlay.rs */}
      {overlayEvents.length > 0 &&
        <div className="card" style={{ padding: 14, marginTop: 18 }}>
          <div className="nav-label" style={{ marginBottom: 10 }}>Action layer</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {overlayEvents.map((e, i) =>
              <div key={e.ts + '-' + i} className="row" style={{ gap: 8, fontSize: 12.5, opacity: 0.85 }}>
                <span className="chip" style={{ fontWeight: 700, color: e.event === 'escalated' ? '#ef4444' : '#22c55e' }}>
                  {e.event === 'escalated' ? 'Overlay shown' : 'Dismissed'}
                </span>
                {labelFor(e.monitor_id).multi && <span className="chip">{labelFor(e.monitor_id).label}</span>}
                <span>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>}
    </div>
  );
}

Object.assign(window, { MonitorPage });
