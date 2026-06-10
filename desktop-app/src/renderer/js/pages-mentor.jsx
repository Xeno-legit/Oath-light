/* pages-mentor.jsx — AI companion chat for hard moments */
const QUICK_PROMPTS = [
"I'm having an urge right now",
"I slipped and feel awful",
"Why do I keep doing this?",
"Help me get through tonight"];


const MENTOR_REPLIES = {
  urge: "Okay. First — you reached out instead of acting. That's already a win, and it matters.\n\nLet's ground you. Look around and name five things you can see right now. Then take one slow breath with me: in for four… hold for four… out for six.\n\nThe urge feels huge, but it's a wave — it peaks around 20 minutes and then it fades whether you feed it or not. You don't have to fight it. Just let it move through. I'm right here.",
  slip: "Thank you for telling me. That took courage, and I'm not going anywhere.\n\nA slip is not a collapse — it's a single moment, not your identity. The most important hours are the next few, so let's protect them. What happened right before? Sometimes the urge isn't really about the urge — it's loneliness, stress, or being tired in disguise.\n\nYou haven't lost your progress. Everything you've learned is still yours. Let's just take the next clean step together.",
  why: "That's a brave question, and it deserves a real answer rather than shame.\n\nFor most people this isn't about willpower being broken — it's a learned way to soothe a feeling. The brain reaches for a fast hit of relief when something underneath feels uncomfortable. The behavior is the smoke; the fire is usually stress, loneliness, boredom, or anxiety.\n\nSo the work isn't just 'resist harder.' It's noticing what you're really needing in that moment, and slowly building gentler ways to meet it. You're already doing that by asking.",
  night: "Nights can be the hardest — fewer distractions, more tiredness, defenses down. Let's make a plan so you're not deciding in the heat of the moment.\n\nThree things: 1) Change your environment now — different room, lights on, phone across the room. 2) Give your hands and mind a job — a walk, a cold glass of water, a message to someone safe. 3) Set a 'bridge' — tell yourself you'll just get to sleep, nothing else to decide tonight.\n\nYou've made it through every hard night so far. Tonight's no different. Want to talk it through while it passes?",
  default: "I hear you, and I'm glad you're here. There's no judgment in this space.\n\nTell me a little more about what's going on for you right now — what are you feeling in your body, and what happened just before? We'll take it one small step at a time, together."
};

function pickReply(text) {
  const t = text.toLowerCase();
  if (/(urge|tempt|craving|want to|right now|horny)/.test(t)) return MENTOR_REPLIES.urge;
  if (/(slip|relapse|failed|messed up|gave in|feel awful|guilt|ashamed)/.test(t)) return MENTOR_REPLIES.slip;
  if (/(why|keep doing|again|addict|broken)/.test(t)) return MENTOR_REPLIES.why;
  if (/(night|tonight|late|can't sleep|bed)/.test(t)) return MENTOR_REPLIES.night;
  return MENTOR_REPLIES.default;
}

function MentorPage({ s, PP }) {
  const [draft, setDraft] = React.useState('');
  const [typing, setTyping] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.chat, typing]);

  function send(text) {
    const t = (text ?? draft).trim();
    if (!t || typing) return;
    PP.put('chat', [...s.chat, { role: 'user', text: t }]);
    setDraft('');
    setTyping(true);
    const reply = pickReply(t);
    setTimeout(() => {
      PP.put('chat', [...PP.get().chat, { role: 'mentor', text: reply }]);
      setTyping(false);
    }, 1100 + Math.random() * 700);
  }

  return (
    <div className="page mentor-page" style={{ position: 'relative', maxWidth: 860, display: 'flex', flexDirection: 'column', height: '100%', paddingBottom: 24 }}>
      <div className="page-head fade-up" style={{ marginBottom: 18 }}>
        <div className="eyebrow">Personal Mentor</div>
        <h1 className="page-title">A calm voice, <em style={{ fontFamily: "Manrope" }}>any hour</em></h1>
        <p className="page-sub">Your private companion for the hard moments. Nothing here is judged, stored elsewhere, or shared.</p>
      </div>

      <div className="card chat-card fade-up">
        <div className="chat-head">
          <div className="avatar" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}><IconChat size={17} /></div>
          <div>
            <b style={{ fontSize: 14, fontWeight: 800 }}>Sage</b>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-2)' }} /> Here with you
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
          onClick={() => PP.put('chat', PP.get().chat.slice(0, 1))}>New chat</button>
        </div>

        <div className="chat-scroll scroll" ref={scrollRef}>
          {s.chat.map((m, i) =>
          <div key={i} className={'msg ' + m.role}>
              {m.role === 'mentor' && <div className="msg-ava"><IconChat size={14} /></div>}
              <div className="bubble">{m.text.split('\n\n').map((p, j) => <p key={j} style={{ marginTop: j ? 10 : 0 }}>{p}</p>)}</div>
            </div>
          )}
          {typing &&
          <div className="msg mentor">
              <div className="msg-ava"><IconChat size={14} /></div>
              <div className="bubble typing"><span /><span /><span /></div>
            </div>
          }
        </div>

        {s.chat.length <= 1 &&
        <div className="chat-prompts">
            {QUICK_PROMPTS.map((p) =>
          <button key={p} className="chip prompt-chip" onClick={() => send(p)}>{p}</button>
          )}
          </div>
        }

        <div className="chat-input">
          <input className="input" placeholder="Type what you're feeling…" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn btn-primary chat-send" onClick={() => send()} disabled={!draft.trim() || typing}><IconSend size={18} /></button>
        </div>
      </div>

    {/* Coming Soon overlay */}
    <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in oklab, var(--bg-0) 55%, transparent)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        zIndex: 10
      }}>
      <div style={{
          background: 'var(--glass-2)', border: '1px solid var(--glass-brd-strong)',
          borderRadius: 24, padding: '38px 52px', textAlign: 'center',
          boxShadow: 'var(--shadow)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
        }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'color-mix(in oklab, var(--accent) 16%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}><IconGear size={32} /></div>
        <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-.02em' }}>Coming Soon</div>
        <p style={{ fontSize: 15, color: 'var(--muted)', maxWidth: '28ch', lineHeight: 1.55 }}>

          </p>
        <div className="chip" style={{ marginTop: 4, color: 'var(--accent)', borderColor: 'color-mix(in oklab, var(--accent) 35%, transparent)' }}>
          In development
        </div>
      </div>
    </div>
    </div>);

}
window.MentorPage = MentorPage;