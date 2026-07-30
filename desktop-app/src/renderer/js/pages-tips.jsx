/* pages-tips.jsx — Tips & Questions.
 *
 * Fifteen short pieces of writing, which is a lot of writing to put in front of
 * someone who came here mid-urge. The rebuild is mostly about that:
 *
 *   * **Search.** Fifteen accordions with no way to filter is a list you scroll
 *     past. The field matches title and body across both sections, and says
 *     plainly when nothing matched instead of showing an empty page.
 *   * **The cards are real buttons now.** They were `<div onClick>` — no Tab
 *     stop, no Enter/Space, no `aria-expanded`, so the entire page was
 *     unreachable without a mouse and unreadable to a screen reader.
 *   * **No magic max-height.** The old expander animated to a hard-coded
 *     `250px`, which silently clips the longest entry at a narrow window. It
 *     now animates `grid-template-rows: 0fr → 1fr`, which is the same effect
 *     with no number to be wrong.
 *   * **Colour means something or it goes.** Each card used to pick one of
 *     three accents by position, so the colours encoded nothing but their own
 *     index. Now there are exactly two: tips and questions, which is a real
 *     distinction.
 *   * **The two gradient hero cards are one row.** A disclaimer and a "talk to
 *     someone" prompt were two full-width tinted panels stacked above the
 *     content — a third of the page before the first tip.
 */

const TIPS = [
  { id: 't1', icon: IconUser, title: 'Try to Break Out of Isolation', body: "Isolation is one of the biggest reasons you might be set up for a relapse. Just have a person in your room — that person might be a family member, a friend, etc. The point is, you should NOT stay alone in a room." },
  { id: 't2', icon: IconShield, title: 'If You Feel a Relapse Is Coming', body: "Immediately try to shut all devices, regardless of whether Oath Light is installed on them or not. At least have Oath Light installed on your devices in case you are feeling too weak to resist." },
  { id: 't3', icon: IconHeart, title: 'If You Relapse', body: "Do not beat yourself up for it. A mistake is a mistake and you can't change the past — you can shape the future instead. Get back up and never spiral into the spiral of shame. Try to get a cold shower and clean yourself too." },
];

const QUESTIONS = [
  { id: 'q1', icon: IconFlame, title: 'The Nature of the Urge', body: "It is not abnormal to have an urge or desire. You cannot control your desires as they are. What you can control is what you do about those desires." },
  { id: 'q2', icon: IconArrowUp, title: 'Falling Again and Again?', body: "Notice how I said falling, not failing, because falling again is simply part of the process, not a complete failure. If you fall, get back up. No second thoughts." },
  { id: 'q3', icon: IconHeart, title: 'I Am In Despair', body: "We know. Here is the reality: treat the addiction like a virus. You can't live with it expecting to be normal." },
  { id: 'q4', icon: IconCompass, title: "I Relapsed, But I Don't Know Why", body: "Sometimes you can relapse before you are even conscious of the urge. This can sometimes happen at the most random of times, or at certain times when the conscious part of your mind is still booting up." },
  { id: 'q5', icon: IconShieldOff, title: "A Certain App/Website Wasn't Blocked", body: "Immediately report this to us, we will take care of it as soon as humanly possible. Visit the report page on the website." },
  { id: 'q6', icon: IconFlame, title: 'I Broke My Streak...', body: "Your progress was never EVER based on a number. And never let your personality and goals be based on a number. If the streak breaks and you are still breathing and alive, you can achieve a higher streak anyway." },
  { id: 'q7', icon: IconShield, title: "Oath Light Didn't Eliminate My Addiction", body: "Oath Light is not a physical person, we can't physically stop you from masturbating or somehow finding a loophole around us. What we can do is try our best to be your digital bodyguard. And we are most likely the best digital bodyguard ;D." },
  { id: 'q8', icon: IconSearch, title: 'What Are Some Reasons for a Sudden Relapse?', body: "Looking... Either it's looking at the opposite gender or not being able to lower your gaze properly. Yes, not lowering your gaze will only poison you slowly, leading to a sudden relapse. Do your best to lower your gaze." },
  { id: 'q9', icon: IconClock, title: 'When Will This Suffering End?', body: "If you are suffering because you didn't give the addiction its dose, then keep on suffering. It's not you who is suffering. It's the addiction that is absolutely suffocating." },
  { id: 'q10', icon: IconX, title: 'Can I Just Do It One Last Time?', body: 'My friend, ask yourself: was the "one last time" truly a one last time? That\'s it.' },
  { id: 'q11', icon: IconWave, title: 'The Road Is Too Long...', body: "You never realize how long a road was if you just focus on what you can do as of now. And after a certain amount of time when you look back at the distance you covered, you will realize how far you have come." },
  { id: 'q12', icon: IconSpark, title: 'I Am Ashamed of Myself', body: "Never be ashamed of having desires, or expect the recovery road to be straight. It may twist and turn, but it doesn't mean you're lost. The important thing is you keep moving forward, no matter how slow. And never beat yourself up over a mistake. A mistake is a learning opportunity, nothing more and nothing less. Analyze your mistake, learn from it, and move on." },
];

// Case-insensitive match across the whole entry, not just the title — someone
// searching "shame" should find the answer that never uses the word in its
// heading.
function matches(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || item.body.toLowerCase().includes(q);
}

function ProtocolCard({ item, isOpen, onToggle }) {
  return (
    <div className={'protocol-card' + (isOpen ? ' open' : '')}>
      <div className="protocol-accent" />
      <div className="protocol-inner">
        {/* A real button: Tab reaches it, Enter and Space open it, and
            aria-expanded/aria-controls describe the panel it owns. */}
        <button
          type="button"
          className="protocol-header"
          aria-expanded={isOpen}
          aria-controls={`protocol-body-${item.id}`}
          onClick={onToggle}>
          <span className="protocol-ico-wrap"><item.icon size={20} /></span>
          <span className="protocol-title">{item.title}</span>
          <span className={'protocol-toggle' + (isOpen ? ' open' : '')}><IconChevron size={16} /></span>
        </button>
        <div className="protocol-expand" data-open={isOpen ? 'true' : 'false'}>
          <div className="protocol-expand-inner">
            <div className="protocol-text" id={`protocol-body-${item.id}`} role="region">{item.body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TipsPage({ s, PP, go }) {
  const [open, setOpen] = React.useState(null);
  const [query, setQuery] = React.useState('');

  const tips = TIPS.filter((t) => matches(t, query));
  const questions = QUESTIONS.filter((q) => matches(q, query));
  const total = tips.length + questions.length;

  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Tips &amp; Questions</div>
        <h1 className="page-title">Tips that <em>work</em></h1>
        <p className="page-sub">Questions you might encounter, and tips to guide you through the journey.</p>
      </div>

      {/* One row instead of two tinted hero panels. The disclaimer is a real
          promise and stays on the page — but it belongs next to the search
          field, not above a third of it. */}
      <div className="card fade-up spread" style={{ gap: 14, flexWrap: 'wrap' }}>
        <label className="tips-search">
          <IconSearch size={16} />
          <input
            className="input"
            type="search"
            placeholder="Search all 15…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tips and questions" />
        </label>
        <div className="row" style={{ gap: 10 }}>
          <InfoDot label="Disclaimer">
            Oath Light is not fool-proof, nor a replacement for therapy or medical treatment. If you can
            afford either, seek those first rather than relying fully on this app. It still won't
            disappoint you.
          </InfoDot>
          <button className="btn btn-primary btn-sm" onClick={() => go('mentor')}>
            <IconChat size={16} /> Feeling an urge now?
          </button>
        </div>
      </div>

      {total === 0 &&
        <div className="card fade-up" style={{ marginTop: 18, textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Nothing here matches “{query}”.</div>
          <div className="muted-note">
            Try a single word — or{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setQuery(''); }}>clear the search</a>.
          </div>
        </div>}

      {tips.length > 0 &&
        <React.Fragment>
          <div className="section-label fade-up"><IconSpark size={16} /><span>Tips</span></div>
          <div className="protocol-list stagger-long" style={{ marginBottom: 32 }}>
            {tips.map((t) =>
              <ProtocolCard key={t.id} item={t} isOpen={open === t.id} onToggle={() => toggle(t.id)} />
            )}
          </div>
        </React.Fragment>}

      {questions.length > 0 &&
        <React.Fragment>
          <div className="section-label fade-up"><IconChat size={16} /><span>Questions</span></div>
          {/* The one place the two-tone split is applied: tips read as advice,
              questions as answers, and that is the only thing the colour has
              ever needed to say. */}
          <div className="protocol-list stagger-long is-questions">
            {questions.map((q) =>
              <ProtocolCard key={q.id} item={q} isOpen={open === q.id} onToggle={() => toggle(q.id)} />
            )}
          </div>
        </React.Fragment>}
    </div>
  );
}
window.TipsPage = TipsPage;
