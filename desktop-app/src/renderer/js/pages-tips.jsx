/* pages-tips.jsx */
const PROTOCOLS = [
{ id: 1, tag: 'In the moment', icon: IconClock, title: 'The 20-minute wave', body: "Urges peak and fall within about 20 minutes. Set a timer, change rooms, and do something physical. Don't argue with the urge — just outlast it. It always passes.", color: 'var(--accent)' },
{ id: 2, tag: 'Breathing', icon: IconDroplet, title: 'Box breathing reset', body: "In for 4, hold 4, out 4, hold 4. Repeat for two minutes. This pulls you out of the fight-or-flight loop that fuels compulsion and brings the thinking brain back online.", color: 'var(--accent-2)' },
{ id: 3, tag: 'Environment', icon: IconShield, title: 'Design the exits', body: "Make the behavior inconvenient. Phone charges outside the bedroom, browse only in shared spaces, and keep your hands busy after 10pm. Willpower fails; good design doesn't.", color: 'var(--accent-3)' },
{ id: 4, tag: 'Mindset', icon: IconHeart, title: 'HALT check-in', body: "When an urge hits, ask: am I Hungry, Angry, Lonely, or Tired? The urge is usually a messenger for an unmet need. Meet the real need and the urge loses its grip.", color: 'var(--accent)' },
{ id: 5, tag: 'Recovery', icon: IconArrowUp, title: 'The 5-minute rule after a slip', body: "A slip is one moment, not a verdict. Don't spiral into 'I've ruined it.' Stand up, drink water, and start a fresh clean streak from the very next minute. Shame feeds the cycle.", color: 'var(--accent-2)' },
{ id: 6, tag: 'Connection', icon: IconChat, title: 'Reach out first', body: "Isolation is the soil urges grow in. Before acting, message your partner or talk to Sage. Naming the urge to another mind shrinks it dramatically.", color: 'var(--accent-3)' }];


function TipsPage({ s, PP }) {
  const [open, setOpen] = React.useState(1);
  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Tips & Protocols</div>
        <h1 className="page-title">Tools that <em style={{ fontFamily: "Manrope" }}>actually work</em></h1>
        <p className="page-sub">Practical, field-tested techniques for riding out urges and building lasting change. Keep one or two in your back pocket.</p>
      </div>

      <div className="card fade-up" style={{ marginBottom: 18, display: 'flex', gap: 16, alignItems: 'center', background: 'linear-gradient(120deg, color-mix(in oklab, var(--accent) 14%, transparent), color-mix(in oklab, var(--accent-2) 12%, transparent))' }}>
        <div className="ico" style={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--bg-1)', color: 'var(--accent)' }}><IconSpark size={24} /></div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15.5, fontWeight: 800 }}>Feeling an urge right now?</b>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 2 }}>Start with the 20-minute wave, then talk it through with Radon.</div>
        </div>
        <button className="btn btn-primary" onClick={() => PP.set({ page: 'mentor' })}><IconChat size={17} /> Talk now</button>
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {PROTOCOLS.map((p) =>
        <div key={p.id} className={'card protocol' + (open === p.id ? ' open' : '')} onClick={() => setOpen(open === p.id ? 0 : p.id)}>
            <div className="row" style={{ gap: 13, alignItems: 'flex-start' }}>
              <div className="protocol-ico" style={{ background: `color-mix(in oklab, ${p.color} 16%, transparent)`, color: p.color }}><p.icon size={21} /></div>
              <div style={{ flex: 1 }}>
                <div className="chip" style={{ fontSize: 11, padding: '2px 9px', marginBottom: 7 }}>{p.tag}</div>
                <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: '-.02em' }}>{p.title}</div>
              </div>
              <IconChevron size={18} className="protocol-chev" style={{ color: 'var(--muted)', transform: open === p.id ? 'rotate(90deg)' : 'none', transition: 'transform .25s var(--ease)' }} />
            </div>
            <div className="protocol-body" style={{ maxHeight: open === p.id ? 200 : 0 }}>
              <p>{p.body}</p>
            </div>
          </div>
        )}
      </div>
    </div>);

}
window.TipsPage = TipsPage;