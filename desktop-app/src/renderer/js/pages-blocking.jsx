/* pages-blocking.jsx */
function SettingRow({ icon: I, title, desc, on, onToggle, accent }) {
  return (
    <div className="setting">
      <div className="ico" style={accent ? { background: 'color-mix(in oklab, var(--accent-2) 14%, transparent)', color: 'var(--accent-2)' } : undefined}><I size={20} /></div>
      <div className="txt"><b>{title}</b><span>{desc}</span></div>
      <Switch on={on} onClick={onToggle} />
    </div>);

}

function BlockingPage({ s, PP }) {
  const b = s.blocking;
  const set = (patch) => PP.set({ blocking: patch });
  const toggle = (k) => set({ [k]: !b[k] });
  // Block-screen mode toggles are mutually exclusive — enabling one disables
  // the others; toggling the active one off leaves them all disabled.
  const modeKeys = ['redirectLinkOn', 'redirectOffline', 'bgSongEnabled'];
  const setMode = (k) => {
    if (b[k]) { set({ [k]: false }); return; }
    const patch = { [k]: true };
    modeKeys.forEach((m) => { if (m !== k) patch[m] = false; });
    set(patch);
  };
  const setVuln = (patch) => set({ vulnerable: { ...b.vulnerable, ...patch } });
  const toggleAlert = (id) => set({ alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) });

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Blocking Settings</div>
        <h1 className="page-title">How firmly to <em style={{ fontFamily: "Manrope" }}>hold the line</em></h1>
        <p className="page-sub">Have custom Blocking settings, Like redirects, videos and more.</p>
      </div>

      {/* redirect & blocking screen */}
      <div className="card fade-up">
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Blocking screen redirect</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, maxWidth: '60ch', lineHeight: 1.5 }}>
          When a blocked site is visited, redirect to a motivational video or page instead of the default blocking screen.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* redirect URL */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconCompass size={20} /></div>
              <div className="txt">
                <b>Redirect link</b>
                <span>Where the user is sent — e.g. a motivational YouTube video</span>
              </div>
              <Switch on={b.redirectLinkOn} onClick={() => setMode('redirectLinkOn')} />
            </div>
            {b.redirectLinkOn &&
            <div className="redirect-expand" style={{ display: 'flex', gap: 10 }}>
              <input
                type="url"
                className="redirect-input"
                placeholder="https://youtube.com/watch?v=…"
                value={b.redirectUrl}
                onChange={(e) => set({ redirectUrl: e.target.value })}
                style={{ flex: 1 }} />
              {b.redirectUrl &&
              <a href={b.redirectUrl} target="_blank" rel="noopener noreferrer" className="redirect-test">
                  Test ↗
                </a>
              }
            </div>
            }
          </div>

          {/* offline download */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconArrowUp size={20} style={{ transform: 'rotate(180deg)' }} /></div>
              <div className="txt">
                <b>Download for offline use</b>
                <span>Video plays locally — works without internet access</span>
              </div>
              <Switch on={b.redirectOffline} onClick={() => setMode('redirectOffline')} />
            </div>
            {b.redirectOffline &&
            <div className="redirect-expand">
                <input
                type="text"
                className="redirect-input"
                placeholder="/Users/you/Videos/motivation.mp4"
                value={b.redirectOfflinePath}
                onChange={(e) => set({ redirectOfflinePath: e.target.value })} />
              </div>
            }
          </div>

          {/* background song */}
          <div className="redirect-box">
            <div className="redirect-row">
              <div className="ico"><IconSpark size={20} /></div>
              <div className="txt">
                <b>Background audio on block screen</b>
                <span>Plays a calming track when the block screen appears</span>
              </div>
              <Switch on={b.bgSongEnabled} onClick={() => setMode('bgSongEnabled')} />
            </div>
            {b.bgSongEnabled &&
            <div className="redirect-expand">
                <input
                type="text"
                className="redirect-input"
                placeholder="/Users/you/Music/calm.mp3  or  https://…"
                value={b.bgSongPath}
                onChange={(e) => set({ bgSongPath: e.target.value })} />
              </div>
            }
          </div>
        </div>
      </div>

      {/* schedule & reminders */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Focus schedule &amp; reminders</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, marginBottom: 18, maxWidth: '60ch', lineHeight: 1.5 }}>
          Set your vulnerable hours and choose what kind of support shows up during them.
        </div>

        {/* vulnerable hours */}
        <div className="redirect-box">
          <div className="redirect-row">
            <div className="ico"><IconClock size={20} /></div>
            <div className="txt">
              <b>Vulnerable hours</b>
              <span>Pop ups & reminders run during this window</span>
            </div>
            <Switch on={b.vulnerable.on} onClick={() => setVuln({ on: !b.vulnerable.on })} />
          </div>
          {b.vulnerable.on &&
          <div className="redirect-expand" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label className="time-field">
                <span>From</span>
                <input type="time" className="time-input" value={b.vulnerable.start}
              onChange={(e) => setVuln({ start: e.target.value })} />
              </label>
              <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>→</span>
              <label className="time-field">
                <span>To</span>
                <input type="time" className="time-input" value={b.vulnerable.end}
              onChange={(e) => setVuln({ end: e.target.value })} />
              </label>
            </div>
          }
        </div>

        {/* pop-up / reminder types */}
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Pop-ups &amp; reminders
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Choose which nudges you want to receive during your vulnerable hours.
        </div>
        {b.alerts.map((a) =>
        <SettingRow key={a.id} icon={IconBell} title={a.label} desc={a.desc}
        on={a.on} onToggle={() => toggleAlert(a.id)} />
        )}
      </div>

    </div>);

}
window.BlockingPage = BlockingPage;