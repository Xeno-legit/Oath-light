/* pages-tips.jsx */
const TIPS = [
  { id: 't1', icon: IconUser, title: 'Try to Break Out of Isolation', body: "Isolation is one of the biggest reasons you might be set up for a relapse. Just have a person in your room — that person might be a family member, a friend, etc. The point is, you should NOT stay alone in a room.", color: 'var(--accent)' },
  { id: 't2', icon: IconShield, title: 'If You Feel a Relapse Is Coming', body: "Immediately try to shut all devices, regardless of whether Pure Path is installed on them or not. At least have Pure Path installed on your devices in case you are feeling too weak to resist.", color: 'var(--accent-2)' },
  { id: 't3', icon: IconHeart, title: 'If You Relapse', body: "Do not beat yourself up for it. A mistake is a mistake and you can't change the past — you can shape the future instead. Get back up and never spiral into the spiral of shame. Try to get a cold shower and clean yourself too.", color: 'var(--accent-3)' },
];

const QUESTIONS = [
  { id: 'q1', icon: IconFlame, title: 'The Nature of the Urge', body: "It is not abnormal to have an urge or desire. You cannot control your desires as they are. What you can control is what you do about those desires.", color: 'var(--accent)' },
  { id: 'q2', icon: IconArrowUp, title: 'Falling Again and Again?', body: "Notice how I said falling, not failing, because falling again is simply part of the process, not a complete failure. If you fall, get back up. No second thoughts.", color: 'var(--accent-2)' },
  { id: 'q3', icon: IconHeart, title: 'I Am In Despair', body: "We know. Here is the reality: treat the addiction like a virus. You can't live with it expecting to be normal.", color: 'var(--accent-3)' },
  { id: 'q4', icon: IconCompass, title: "I Relapsed, But I Don't Know Why", body: "Sometimes you can relapse before you are even conscious of the urge. This can sometimes happen at the most random of times, or at certain times when the conscious part of your mind is still booting up.", color: 'var(--accent)' },
  { id: 'q5', icon: IconShieldOff, title: "A Certain App/Website Wasn't Blocked", body: "Immediately report this to us, we will take care of it as soon as humanly possible. Visit the report page on the website.", color: 'var(--accent-2)' },
  { id: 'q6', icon: IconFlame, title: 'I Broke My Streak...', body: "Your progress was never EVER based on a number. And never let your personality and goals be based on a number. If the streak breaks and you are still breathing and alive, you can achieve a higher streak anyway.", color: 'var(--accent-3)' },
  { id: 'q7', icon: IconShield, title: "Pure Path Didn't Eliminate My Addiction", body: "Pure Path is not a physical person, we can't physically stop you from masturbating or somehow finding a loophole around us. What we can do is try our best to be your digital bodyguard. And we are most likely the best digital bodyguard ;D.", color: 'var(--accent)' },
  { id: 'q8', icon: IconSearch, title: 'What Are Some Reasons for a Sudden Relapse?', body: "Looking... Either it's looking at the opposite gender or not being able to lower your gaze properly. Yes, not lowering your gaze will only poison you slowly, leading to a sudden relapse. Do your best to lower your gaze.", color: 'var(--accent-2)' },
  { id: 'q9', icon: IconClock, title: 'When Will This Suffering End?', body: "If you are suffering because you didn't give the addiction its dose, then keep on suffering. It's not you who is suffering. It's the addiction that is absolutely suffocating.", color: 'var(--accent-3)' },
  { id: 'q10', icon: IconX, title: 'Can I Just Do It One Last Time?', body: 'My friend, ask yourself: was the "one last time" truly a one last time? That\'s it.', color: 'var(--accent)' },
  { id: 'q11', icon: IconWave, title: 'The Road Is Too Long...', body: "You never realize how long a road was if you just focus on what you can do as of now. And after a certain amount of time when you look back at the distance you covered, you will realize how far you have come.", color: 'var(--accent-2)' },
  { id: 'q12', icon: IconSpark, title: 'I Am Ashamed of Myself', body: "Never be ashamed of having desires, or expect the recovery road to be straight. It may twist and turn, but it doesn't mean you're lost. The important thing is you keep moving forward, no matter how slow. And never beat yourself up over a mistake. A mistake is a learning opportunity, nothing more and nothing less. Analyze your mistake, learn from it, and move on.", color: 'var(--accent-3)' },
];

function ProtocolCard({ item, isOpen, onToggle }) {
  return (
    <div className={'protocol-card' + (isOpen ? ' open' : '')} style={{ '--p-color': item.color }} onClick={onToggle}>
      <div className="protocol-accent" />
      <div className="protocol-inner">
        <div className="protocol-header">
          <div className="protocol-ico-wrap">
            <item.icon size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="protocol-title">{item.title}</div>
          </div>
          <div className={'protocol-toggle' + (isOpen ? ' open' : '')}>
            <IconChevron size={16} />
          </div>
        </div>
        <div className="protocol-expand" style={{ maxHeight: isOpen ? 250 : 0 }}>
          <div className="protocol-text">{item.body}</div>
        </div>
      </div>
    </div>
  );
}

function TipsPage({ s, PP }) {
  const [open, setOpen] = React.useState(null);
  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Tips & Questions</div>
        <h1 className="page-title">Tips that <em style={{ fontFamily: "Manrope" }}>work</em></h1>
        <p className="page-sub">Questions you might encounter, and tips that will guide you through your journey.</p>
      </div>

      {/* Disclaimer */}
      <div className="card fade-up" style={{ marginBottom: 18, display: 'flex', gap: 14, alignItems: 'center', background: 'linear-gradient(120deg, color-mix(in oklab, var(--accent-3) 14%, transparent), color-mix(in oklab, var(--accent-2) 10%, transparent))', border: '1px solid color-mix(in oklab, var(--accent-3) 22%, transparent)' }}>
        <div className="ico" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--bg-1)', color: 'var(--accent-3)' }}><IconShield size={22} /></div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Disclaimer</b>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>Pure Path is not fool-proof, nor is it a replacement for therapy or medical treatment. If you can afford therapy or medical treatment, please seek those first before you rely fully on Pure Path.</div>
        </div>
      </div>

      {/* Urge CTA */}
      <div className="card fade-up" style={{ marginBottom: 28, display: 'flex', gap: 16, alignItems: 'center', background: 'linear-gradient(120deg, color-mix(in oklab, var(--accent) 14%, transparent), color-mix(in oklab, var(--accent-2) 12%, transparent))' }}>
        <div className="ico" style={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--bg-1)', color: 'var(--accent)' }}><IconSpark size={24} /></div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15.5, fontWeight: 800 }}>Feeling an urge right now?</b>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 2 }}>Read through our tips, then talk it through with Radon.</div>
        </div>
        <button className="btn btn-primary" onClick={() => PP.set({ page: 'mentor' })}><IconChat size={17} /> Talk now</button>
      </div>

      {/* ── Tips Section ── */}
      <div className="section-label fade-up">
        <IconSpark size={16} />
        <span>Tips</span>
      </div>
      <div className="protocol-list stagger-long" style={{ marginBottom: 32 }}>
        {TIPS.map((t) =>
          <ProtocolCard key={t.id} item={t} isOpen={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
        )}
      </div>

      {/* ── Questions Section ── */}
      <div className="section-label fade-up">
        <IconChat size={16} />
        <span>Questions</span>
      </div>
      <div className="protocol-list stagger-long">
        {QUESTIONS.map((q) =>
          <ProtocolCard key={q.id} item={q} isOpen={open === q.id} onToggle={() => setOpen(open === q.id ? null : q.id)} />
        )}
      </div>
    </div>);

}
window.TipsPage = TipsPage;