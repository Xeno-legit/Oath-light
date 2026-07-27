/* pages-panic.jsx — Panic / SOS urge-surfing flow (plan item 5.1).
 *
 * Full-screen staged sequence: box breathing → the 20-minute-wave message
 * (Mentor copy from pages-mentor.jsx, verbatim) → 5-4-3-2-1 grounding → exit
 * to the user's configured redirect target. Every stage auto-advances on its
 * own timer but stays skippable — the flow defaults to carrying the user
 * through, never trapping them.
 *
 * Reached from: the sidebar "I need help" item, the tray's "I need help
 * now", the global Ctrl+Shift+Space hotkey, and the extension blocked page's
 * deep-link (all funnel through the `open-panic` event — see app.jsx). */

// Verbatim from MENTOR_REPLIES.urge (pages-mentor.jsx) — one voice everywhere.
const PANIC_WAVE_COPY =
  "The urge feels huge, but it's a wave — it peaks around 20 minutes and then it fades whether you feed it or not. You don't have to fight it. Just let it move through. I'm right here.";

const PANIC_GROUND_STEPS = [
  { count: 5, sense: 'see', prompt: 'Look around and name five things you can see.' },
  { count: 4, sense: 'hear', prompt: 'Listen for a moment. Name four things you can hear.' },
  { count: 3, sense: 'touch', prompt: 'Name three things you can feel — the chair, your feet on the floor, the air.' },
  { count: 2, sense: 'smell', prompt: 'Name two things you can smell.' },
  { count: 1, sense: 'taste', prompt: 'Name one thing you can taste.' },
];

const PANIC_BREATH_PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
const PANIC_BREATH_SECS = 64;      // four full 16s box cycles ≈ a minute
const PANIC_WAVE_SECS = 24;        // enough to actually read it, twice
const PANIC_GROUND_STEP_SECS = 20; // per grounding sense

// One-tap trigger tags offered at the exit stage (5.4) — read from the
// store's canonical PP.TRIGGERS (store.js), never redeclared, so this flow
// and the overview's quick-log/slip dialog always offer the same vocabulary.
const PANIC_TRIGGERS = PP.TRIGGERS;

// The active "Redirect link" destination, or null — mirrors getRedirectTarget
// in extension/background.js so desktop and extension send the user to the
// exact same place.
function panicRedirectTarget(blocking) {
  const b = blocking || {};
  if (!b.redirectLinkOn) return null;
  let u = (b.redirectUrl || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    if (!/^[^\s/]+\.[^\s/]+/.test(u)) return null;
    u = 'https://' + u;
  }
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
  } catch (e) {
    return null;
  }
  return u;
}

function PanicPage({ s, go }) {
  // stage: 0 breathing · 1 wave · 2 grounding (step 0..4) · 3 exit
  const [pos, setPos] = React.useState({ stage: 0, step: 0 });
  const advance = React.useCallback(() => {
    setPos((p) => {
      if (p.stage === 2 && p.step < PANIC_GROUND_STEPS.length - 1) {
        return { stage: 2, step: p.step + 1 };
      }
      return { stage: Math.min(p.stage + 1, 3), step: 0 };
    });
  }, []);

  // Auto-advance: each stage flows into the next on its own timer; the exit
  // stage never advances on its own — leaving is always the user's choice.
  React.useEffect(() => {
    if (pos.stage === 3) return;
    const secs =
      pos.stage === 0 ? PANIC_BREATH_SECS :
      pos.stage === 1 ? PANIC_WAVE_SECS :
      PANIC_GROUND_STEP_SECS;
    const id = setTimeout(advance, secs * 1000);
    return () => clearTimeout(id);
  }, [pos, advance]);

  // Breathing clock — drives the phase label + the calm 1-4 counter, synced
  // to the CSS ring's 16s animation cycle (4s per phase).
  const [breathSec, setBreathSec] = React.useState(0);
  React.useEffect(() => {
    if (pos.stage !== 0) return;
    const started = Date.now();
    const id = setInterval(() => setBreathSec((Date.now() - started) / 1000), 250);
    return () => clearInterval(id);
  }, [pos.stage]);

  // Urge log (5.4): the exit stage offers one optional, one-tap trigger tag
  // (or a plain skip) that logs this flow-completion with source 'panic'.
  // Logging is entirely optional and never gates the exit buttons below —
  // the flow already promised leaving is always the user's own choice.
  const [urgeLogged, setUrgeLogged] = React.useState(false);
  const logPanicUrge = React.useCallback((trigger) => {
    if (urgeLogged) return;
    if (window.PP) window.PP.logUrge(trigger, 'panic');
    setUrgeLogged(true);
  }, [urgeLogged]);

  const phaseIdx = Math.floor(breathSec / 4) % 4;
  const phaseCount = Math.min(4, Math.floor(breathSec % 4) + 1);
  const target = panicRedirectTarget(s.blocking);
  const gs = PANIC_GROUND_STEPS[pos.step] || PANIC_GROUND_STEPS[0];

  return (
    <div className="page panic-page">
      {pos.stage === 0 && (
        <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="eyebrow">You're safe here</div>
          <h1 className="page-title" style={{ marginBottom: 8 }}>Let's breathe first.</h1>
          <p className="page-sub" style={{ margin: '0 auto 34px', textAlign: 'center' }}>
            In for four, hold for four, out for four, hold for four.
            Nothing to fix right now — just follow the circle.
          </p>
          <div className="panic-breath-wrap">
            <div className="panic-breath-ring" />
            <div className="panic-breath-label">
              {PANIC_BREATH_PHASES[phaseIdx]}
              <span className="panic-breath-count">{phaseCount}</span>
            </div>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 34 }} onClick={advance}>
            Continue <IconChevron size={16} />
          </button>
        </div>
      )}

      {pos.stage === 1 && (
        <div className="fade-up" style={{ maxWidth: 560 }}>
          <div className="eyebrow">The wave</div>
          <h1 className="page-title" style={{ marginBottom: 18 }}>This will pass.</h1>
          <p className="panic-wave-copy">{PANIC_WAVE_COPY}</p>
          <button className="btn btn-ghost" style={{ marginTop: 30 }} onClick={advance}>
            I'm still here <IconChevron size={16} />
          </button>
        </div>
      )}

      {pos.stage === 2 && (
        <div className="fade-up" key={pos.step} style={{ maxWidth: 560 }}>
          <div className="eyebrow">Grounding · 5-4-3-2-1</div>
          <h1 className="page-title" style={{ marginBottom: 22 }}>Come back to the room.</h1>
          <div className="panic-ground-count">{gs.count}</div>
          <div className="panic-ground-sense">{gs.sense}</div>
          <p className="page-sub" style={{ margin: '14px auto 0', textAlign: 'center' }}>{gs.prompt}</p>
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 26 }}>
            {PANIC_GROUND_STEPS.map((st, i) => (
              <span key={st.sense} className={'panic-dot' + (i <= pos.step ? ' on' : '')} />
            ))}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 26 }} onClick={advance}>
            Done — next <IconChevron size={16} />
          </button>
        </div>
      )}

      {pos.stage === 3 && (
        <div className="fade-up" style={{ maxWidth: 560 }}>
          <div className="eyebrow">You rode it out</div>
          <h1 className="page-title" style={{ marginBottom: 12 }}>Well done. Truly.</h1>
          <p className="page-sub" style={{ margin: '0 auto 30px', textAlign: 'center' }}>
            The urge is already weaker than when you arrived. Choose where to go
            next — somewhere that feeds the person you're becoming.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {target && (
              <button className="btn btn-primary"
                onClick={() => { if (window.PPNative && PPNative.available) PPNative.openExternal(target); }}>
                <IconCompass size={17} /> Take me somewhere good
              </button>
            )}
            <button className={'btn ' + (target ? 'btn-ghost' : 'btn-primary')} onClick={() => go('home')}>
              <IconHeart size={17} /> Back to Oath Light
            </button>
          </div>
          {!target && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 18 }}>
              Tip: set a "Redirect link" in Blocking Settings and this screen can
              send you straight to your safe place.
            </p>
          )}

          {/* One-tap urge log (5.4) — optional, unobtrusive, never gates the
              exit buttons above. Collapses to a quiet thank-you once tapped. */}
          <div style={{ marginTop: 30, textAlign: 'center' }}>
            {!urgeLogged ? (
              <React.Fragment>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  What brought this on? <span style={{ opacity: .75 }}>(optional)</span>
                </div>
                <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {PANIC_TRIGGERS.map((t) => (
                    <button key={t.id} className="chip" onClick={() => logPanicUrge(t.id)}>{t.label}</button>
                  ))}
                  <button className="chip" style={{ color: 'var(--muted)' }} onClick={() => logPanicUrge(null)}>Skip</button>
                </div>
              </React.Fragment>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                <IconCheck size={12} /> Logged quietly — thank you for checking in.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PanicPage });
