/* pages-mentor.jsx — Personal Mentor: honest recovery-program v1 (plan 5.3).
 *
 * This used to be a regex-keyword chatbot behind a "Coming Soon" blur — a
 * fake persona with simulated typing delays. That would destroy trust the
 * moment a vulnerable user noticed the pattern-match. v1 replaces it with
 * exactly what the frontier plan asks for: a small library of *scripted*
 * CBT/ACT guided exercises (urge -> grounding -> reflection -> plan),
 * presented plainly as guided exercises — never as "AI", never as a chat
 * with a live listener on the other end.
 *
 * The "Ride out an urge" exercise deliberately hands off to PanicPage
 * (pages-panic.jsx) rather than re-implementing breathing/grounding here —
 * that flow already covers it, verbatim, one voice everywhere.
 *
 * Reflection answers are ephemeral component state only: nothing here is
 * persisted, synced, or sent anywhere. */

const MENTOR_EXERCISES = [
  {
    id: 'urge',
    icon: IconWave,
    color: 'var(--accent)',
    title: 'Ride out an urge',
    blurb: 'A guided breathing and grounding sequence for right now.',
    minutes: '~3 min',
    steps: [
      {
        kind: 'handoff',
        eyebrow: 'Right now',
        title: "You reached out. That's already a win.",
        body: [
          "Acting on an urge isn't the only option — and opening this instead of scrolling further is proof of that.",
          "This hands you into the full guided session: box breathing, a reminder that the urge is a wave that peaks and fades whether you feed it or not, then 5-4-3-2-1 grounding to bring you back into the room. About three minutes, and it never rushes you.",
        ],
        cta: 'Start the guided session',
      },
    ],
  },
  {
    id: 'slip',
    icon: IconHeart,
    color: 'var(--accent-3)',
    title: 'I slipped',
    blurb: 'Self-compassion, a short reflection, and one concrete next step.',
    minutes: '~4 min',
    steps: [
      {
        kind: 'info',
        eyebrow: 'No judgment here',
        title: 'Thank you for being honest with yourself.',
        body: [
          "A slip is not a collapse. It's a single moment — not your identity, and not the end of the progress you've already made.",
          'The next few hours matter most, so let’s protect them. Nothing you write in this exercise is judged, stored elsewhere, or shared with anyone.',
        ],
      },
      {
        kind: 'reflect',
        key: 'before',
        eyebrow: 'Reflect',
        title: 'What happened right before?',
        prompt: 'Walk back a few minutes. Where were you, what were you doing, how were you feeling in your body?',
        placeholder: 'e.g. I was alone and scrolling late at night, feeling bored and a bit low…',
      },
      {
        kind: 'reflect',
        key: 'feeling',
        eyebrow: 'Reflect',
        title: 'What feeling was underneath it?',
        prompt: "Sometimes the urge isn't really about the urge — it's loneliness, stress, boredom, or being tired in disguise. What was really going on?",
        chips: ['Stress', 'Loneliness', 'Boredom', 'Tiredness', 'Anxiety', 'Something else'],
        placeholder: 'Tap a word above, or write your own…',
      },
      {
        kind: 'reflect',
        key: 'plan',
        eyebrow: 'Plan',
        title: 'Choose your next clean step',
        prompt: "You haven't lost your progress — everything you've learned is still yours. What's one small, concrete thing you'll do in the next few minutes?",
        chips: ['Get up and change rooms', 'Drink a glass of cold water', 'Message someone safe', 'Go straight to sleep'],
        placeholder: 'Tap a suggestion above, or write your own plan…',
      },
      {
        kind: 'done',
        eyebrow: 'That counts',
        title: "That's a clean next step.",
        body: [
          "Everything you've learned is still yours. Come back to this exercise any time you need it — there's no limit, and no score being kept.",
        ],
      },
    ],
  },
  {
    id: 'understand',
    icon: IconSmoke,
    color: 'var(--accent-2)',
    title: 'Understand the habit',
    blurb: 'A short, honest lesson on why this happens and what actually helps.',
    minutes: '~2 min',
    steps: [
      {
        kind: 'info',
        eyebrow: 'Why this happens',
        title: "It's not a willpower problem.",
        body: [
          "For most people, this isn't about willpower being broken — it's a learned way to soothe a feeling.",
          'The brain reaches for a fast hit of relief when something underneath feels uncomfortable: stress, loneliness, boredom, anxiety. The behavior is the smoke; the fire is what’s really burning underneath.',
        ],
      },
      {
        kind: 'info',
        eyebrow: 'What actually helps',
        title: 'Notice the fire, not just the smoke.',
        body: [
          "So the work isn't just ‘resist harder.’ It's noticing what you're really needing in the moment, and slowly building gentler ways to meet it.",
          'Reading this all the way through is already a small step toward that noticing. That counts.',
        ],
      },
    ],
  },
  {
    id: 'tonight',
    icon: IconMoon,
    color: 'var(--accent)',
    title: 'Plan for tonight',
    blurb: 'Turn the hardest hours into a plan you set now, while you’re clear-headed.',
    minutes: '~3 min',
    steps: [
      {
        kind: 'info',
        eyebrow: 'Before it gets hard',
        title: 'Nights can be the hardest.',
        body: [
          "Fewer distractions, more tiredness, defenses down. Deciding what to do in the moment is the hardest time to decide anything — so let's set the plan now instead, while you're clear-headed.",
        ],
      },
      {
        kind: 'checklist',
        eyebrow: 'Your plan',
        title: 'Your 3-step plan for tonight',
        intro: "Personalize each step so it's actually yours tonight — specific enough that future-you doesn't have to think.",
        items: [
          { key: 'env', label: 'Change your environment', helper: 'Different room, lights on, phone across the room — anything that gets you physically away from the trigger.', placeholder: 'e.g. move to the kitchen and turn all the lights on' },
          { key: 'job', label: 'Give your hands and mind a job', helper: 'A walk, a cold glass of water, a message to someone safe.', placeholder: 'e.g. text Ahmad, then a 10-minute walk' },
          { key: 'bridge', label: 'Set a bridge to sleep', helper: "Tell yourself you'll just get to sleep — nothing else to decide tonight.", placeholder: 'e.g. lights off by 11, no more decisions after that' },
        ],
      },
      {
        kind: 'done',
        eyebrow: 'You’ve got this',
        title: "You've made it through every hard night so far.",
        body: ["Tonight's no different. Keep this plan in mind — or come back and reread it if things get heavy."],
      },
    ],
  },
];

function StepDots({ count, idx }) {
  if (count <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 22 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i <= idx ? 'var(--accent)' : 'color-mix(in oklab, var(--text) 18%, transparent)',
          transition: 'background .2s',
        }} />
      ))}
    </div>
  );
}

// The Overview's "I had a slip" dialog records the slip (PP.relapse) and
// THEN routes here — but someone can also land on this exercise directly,
// having logged nothing. Near-identical copy with silently different effects
// would be exactly the kind of dishonesty this page exists to avoid, so the
// closing step offers the log explicitly. Gated on !PP.isGentle(): a slip
// recorded moments ago (the dialog path, or a second run through the
// exercise) means gentle mode is already on, so the offer disappears and the
// dialog → exercise path can never double-log.
function SlipLogOffer({ PP }) {
  const [logged, setLogged] = React.useState(false);
  if (!logged && PP.isGentle()) return null;
  return logged ? (
    <div style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
      <IconCheck size={13} /> Slip logged — gentle mode is on for the next 24 hours.
    </div>
  ) : (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
        If this slip just happened and you haven't logged it yet, you can do that here —
        it starts 24h of gentle mode and keeps your history honest.
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => { PP.relapse(null); setLogged(true); }}>
        <IconHeart size={15} /> Log this slip
      </button>
    </div>
  );
}

function ExerciseFlow({ exercise, stepIdx, setStepIdx, answers, setAnswer, onExit, go, PP }) {
  const steps = exercise.steps;
  const step = steps[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  const next = () => setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));

  return (
    <div className="page mentor-page" style={{ maxWidth: 640 }}>
      <button className="btn btn-ghost btn-sm fade-up" style={{ marginBottom: 18 }} onClick={onExit}>
        <IconChevron size={15} style={{ transform: 'rotate(180deg)' }} /> All exercises
      </button>

      <div className="card fade-up" key={stepIdx} style={{ padding: '32px 34px' }}>
        {step.eyebrow && <div className="eyebrow">{step.eyebrow}</div>}
        {step.title && <h1 className="page-title" style={{ fontSize: 25, marginBottom: 14 }}>{step.title}</h1>}

        {(step.kind === 'handoff' || step.kind === 'info' || step.kind === 'done') &&
          step.body.map((p, i) => (
            <p key={i} className="page-sub" style={{ maxWidth: 'none', marginTop: i ? 12 : 0 }}>{p}</p>
          ))
        }

        {step.kind === 'handoff' &&
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => go('panic')}>
            <IconWave size={17} /> {step.cta}
          </button>
        }

        {step.kind === 'reflect' &&
          <>
            <p className="page-sub" style={{ maxWidth: 'none' }}>{step.prompt}</p>
            {step.chips &&
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {step.chips.map((c) => (
                  <button key={c} type="button" className="chip prompt-chip" onClick={() => {
                    const cur = answers[step.key] || '';
                    // A chip is a one-shot insert — re-tapping (or a stray
                    // double-tap) must not pile up "Stress, Stress".
                    if (cur.includes(c)) return;
                    setAnswer(step.key, (cur ? cur + ', ' : '') + c);
                  }}>
                    {c}
                  </button>
                ))}
              </div>
            }
            <textarea className="input" rows={4}
              style={{ marginTop: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              placeholder={step.placeholder}
              value={answers[step.key] || ''}
              onChange={(e) => setAnswer(step.key, e.target.value)} />
          </>
        }

        {step.kind === 'checklist' &&
          <>
            {step.intro && <p className="page-sub" style={{ maxWidth: 'none' }}>{step.intro}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              {step.items.map((item) => {
                const val = answers[item.key] || {};
                return (
                  <label key={item.key} className="card" style={{
                    padding: 16, background: 'var(--glass-2)', display: 'flex', gap: 12,
                    alignItems: 'flex-start', cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={!!val.done} style={{ marginTop: 4, accentColor: 'var(--accent)' }}
                      onChange={(e) => setAnswer(item.key, { ...val, done: e.target.checked })} />
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 14.5, fontWeight: 800 }}>{item.label}</b>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{item.helper}</div>
                      <input className="input" style={{ marginTop: 9 }} placeholder={item.placeholder}
                        value={val.text || ''}
                        onChange={(e) => setAnswer(item.key, { ...val, text: e.target.value })} />
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        }

        {step.kind === 'done' && exercise.id === 'slip' && PP && <SlipLogOffer PP={PP} />}

        <StepDots count={steps.length} idx={stepIdx} />

        {step.kind !== 'handoff' &&
          <div className="row" style={{ marginTop: 26, justifyContent: 'space-between' }}>
            {!isFirst ? <button className="btn btn-ghost btn-sm" onClick={back}>Back</button> : <span />}
            {isLast ?
              <button className="btn btn-primary btn-sm" onClick={onExit}>
                {step.kind === 'done' ? 'Back to exercises' : 'Finish'}
              </button> :
              <button className="btn btn-primary btn-sm" onClick={next}>Next <IconChevron size={15} /></button>
            }
          </div>
        }
      </div>
    </div>
  );
}

function MentorPage({ s, PP, go }) {
  const [activeId, setActiveId] = React.useState(null);
  const [stepIdx, setStepIdx] = React.useState(0);
  // Ephemeral only — { [exerciseId]: { [stepOrItemKey]: value } }. Never
  // persisted to the PP store; resets when the page unmounts.
  const [answers, setAnswers] = React.useState({});

  const exercise = MENTOR_EXERCISES.find((e) => e.id === activeId) || null;

  function openExercise(id) {
    setActiveId(id);
    setStepIdx(0);
  }
  function closeExercise() {
    setActiveId(null);
    setStepIdx(0);
  }
  function setAnswer(key, value) {
    setAnswers((prev) => ({ ...prev, [activeId]: { ...(prev[activeId] || {}), [key]: value } }));
  }

  const openTarget = go || ((page) => PP.set({ page }));

  if (exercise) {
    return (
      <ExerciseFlow
        exercise={exercise}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
        answers={answers[activeId] || {}}
        setAnswer={setAnswer}
        onExit={closeExercise}
        go={openTarget}
        PP={PP}
      />
    );
  }

  return (
    <div className="page mentor-page" style={{ maxWidth: 1040 }}>
      <div className="page-head fade-up">
        <div className="eyebrow">Recovery Program</div>
        <h1 className="page-title">Guided exercises, <em style={{ fontFamily: 'Manrope' }}>not a chatbot</em></h1>
        <p className="page-sub">
          A small library of scripted CBT/ACT exercises for the hard moments — riding out an
          urge, recovering from a slip, understanding the habit, and planning ahead. Pick one
          below and go at your own pace.
        </p>
      </div>

      <div className="card fade-up" style={{
        marginBottom: 22, display: 'flex', gap: 14, alignItems: 'center',
        background: 'linear-gradient(120deg, color-mix(in oklab, var(--accent) 14%, transparent), color-mix(in oklab, var(--accent-2) 10%, transparent))',
      }}>
        <div className="ico" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--bg-1)', color: 'var(--accent)' }}>
          <IconShield size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>No AI. No persona. Just what works.</b>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>
            These are scripted exercises, not a chatbot pretending to be a person on the other
            end. Anything you write stays on this device and is never sent anywhere.
          </div>
        </div>
      </div>

      <div className="grid stagger" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {MENTOR_EXERCISES.map((ex) => (
          <button key={ex.id} className="card hover hub-card" style={{ textAlign: 'left' }} onClick={() => openExercise(ex.id)}>
            <div className="hub-card-ico" style={{ background: `color-mix(in oklab, ${ex.color} 15%, transparent)`, color: ex.color }}>
              <ex.icon size={22} />
            </div>
            <div className="hub-card-title">{ex.title}</div>
            <div className="hub-card-desc">{ex.blurb}</div>
            <div className="hub-card-foot">
              <span className="chip">{ex.minutes}</span>
              <IconChevron size={18} className="hub-arrow" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
window.MentorPage = MentorPage;
