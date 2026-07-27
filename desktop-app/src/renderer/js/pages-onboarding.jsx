/* pages-onboarding.jsx — first-run wizard (plan item 6.4).
 *
 * The README has promised a setup wizard for a long time and there wasn't one.
 * This is it: a full-screen, five-step first run that ends with the user having
 * actually SEEN a block happen, rather than trusting a status pill.
 *
 * Design rules it follows, all of them load-bearing:
 *   - **Solo-first (5.2).** The master password and trusted contact steps are
 *     one screen, both explicitly skippable, and skipping is presented as a
 *     first-class choice rather than a downgrade. A user with nobody to name
 *     must reach the end feeling fully set up, because they are.
 *   - **Status yes, map no (UX Direction §3).** Nothing here explains what any
 *     layer defends against or where coverage is thin. The test step reports
 *     "blocked" / "not blocked" and nothing more.
 *   - **Presets strengthen only (6.4).** Choosing a preset routes through
 *     `PP.applyPreset`, which cannot weaken a backend protection.
 *   - **Skippable in full.** Anyone can leave at any step; `onboarded` is set
 *     either way so it never nags twice. A wizard that traps someone is worse
 *     than no wizard.
 */

// A domain used purely to demonstrate that blocking works. It is on the
// curated blacklist and is a household name specifically so the result is
// unambiguous — the user sees the app's own answer for a site they know.
const ONBOARD_TEST_DOMAIN = 'pornhub.com';

function StepShell({ step, total, title, sub, children, onBack, onNext, nextLabel, onSkip }) {
  return (
    <div className="page" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-head fade-up">
        <div className="eyebrow">Setup · step {step} of {total}</div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children}
      <div className="row" style={{ gap: 12, marginTop: 26, alignItems: 'center' }}>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>Back</button>}
        <button className="btn btn-primary" onClick={onNext}>{nextLabel || 'Continue'}</button>
        {onSkip &&
          <button className="btn btn-ghost" style={{ marginInlineStart: 'auto', opacity: .75 }} onClick={onSkip}>
            Skip setup
          </button>}
      </div>
    </div>
  );
}

function OnboardingFlow({ s, PP }) {
  const [step, setStep] = React.useState(0);
  const available = !!(window.PPNative && window.PPNative.available);

  // Step 4 (protections) local state — nothing is written until the user acts,
  // so an untouched field never creates a password or a contact.
  const [pw, setPw] = React.useState('');
  const [pwMsg, setPwMsg] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [contactMsg, setContactMsg] = React.useState('');

  // Step 5 (live test) state.
  const [testState, setTestState] = React.useState('idle'); // idle | running | blocked | open | error
  const [testMsg, setTestMsg] = React.useState('');

  const finish = () => PP.set({ onboarded: true, page: 'home' });

  const runTest = () => {
    if (!available) { setTestState('error'); setTestMsg('The live test needs the desktop app.'); return; }
    setTestState('running');
    window.PPNative.checkDomainBlocked(ONBOARD_TEST_DOMAIN).then((res) => {
      // `checkDomainBlocked` resolves null on any failure (see tauri-bridge).
      if (res === null || res === undefined) {
        setTestState('error');
        setTestMsg("Couldn't reach the blocklist just now. Protection is unaffected — try again from Settings later.");
        return;
      }
      const blocked = typeof res === 'object' ? !!res.blocked : !!res;
      setTestState(blocked ? 'blocked' : 'open');
    }).catch(() => {
      setTestState('error');
      setTestMsg("Couldn't run the check just now.");
    });
  };

  const savePassword = () => {
    if (!window.PPAuth || pw.length < 6) { setPwMsg('Use at least 6 characters.'); return; }
    window.PPAuth.setPassword(null, pw)
      .then(() => { setPwMsg('Password set.'); setPw(''); })
      .catch((e) => setPwMsg(e && e.message ? e.message : String(e)));
  };

  const saveContact = () => {
    if (!available) { setContactMsg('Available in the desktop app.'); return; }
    if (!contactName.trim() || !contactEmail.trim()) { setContactMsg('Both a name and an email are needed.'); return; }
    window.PPNative.setTrustedContact(contactName.trim(), contactEmail.trim(), null)
      .then(() => setContactMsg('Saved. They will only ever be told that an event happened.'))
      .catch((e) => setContactMsg(e && e.message ? e.message : String(e)));
  };

  // Six screens: welcome, voice, preset, hours, extras, test. (Counted wrong
  // as 5 at first, which showed "step 5 of 5" on two consecutive screens.)
  const TOTAL = 6;

  // ── 1. Welcome ──────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <StepShell
        step={1} total={TOTAL}
        title={<React.Fragment>Let's set this up <em style={{ fontFamily: 'Manrope' }}>properly</em></React.Fragment>}
        sub="Five short steps. You can skip the whole thing and change everything later — but the defaults you pick now are the ones that hold when you don't feel like picking."
        onNext={() => setStep(1)}
        onSkip={finish}>
        <div className="card fade-up">
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
            Oath Light works on a simple rule: <b style={{ color: 'var(--text)' }}>strengthening protection is
            instant, weakening it takes time</b>. Everything you turn on here can be turned back off — just
            not in the ten seconds where you most want to.
          </div>
        </div>
      </StepShell>
    );
  }

  // ── 2. Voice ────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <StepShell
        step={2} total={TOTAL}
        title={PP.t('onboarding.voice_title')}
        sub={PP.t('onboarding.voice_sub')}
        onBack={() => setStep(0)} onNext={() => setStep(2)} onSkip={finish}>
        <div className="card fade-up">
          {[
            { id: 'companion', nameKey: 'onboarding.companion_name', descKey: 'onboarding.companion_desc', icon: IconHeart },
            { id: 'serious', nameKey: 'onboarding.serious_name', descKey: 'onboarding.serious_desc', icon: IconFlame },
          ].map((v) => {
            const active = (s.voice || 'companion') === v.id;
            return (
              <div className="setting" key={v.id}>
                <div className="ico"><v.icon size={20} /></div>
                <div className="txt"><b>{PP.t(v.nameKey)}</b><span>{PP.t(v.descKey)}</span></div>
                <button className={'btn ' + (active ? 'btn-primary' : 'btn-ghost')}
                        onClick={() => PP.set({ voice: v.id })}>
                  {active ? 'Selected' : 'Choose'}
                </button>
              </div>
            );
          })}
        </div>
      </StepShell>
    );
  }

  // ── 3. Strictness preset ────────────────────────────────────────────────
  if (step === 2) {
    const current = (s.blocking && s.blocking.strictness) || 'strict';
    return (
      <StepShell
        step={3} total={TOTAL}
        title="How strict should it be?"
        sub="You can change this any time, and tune individual settings afterwards."
        onBack={() => setStep(1)} onNext={() => setStep(3)} onSkip={finish}>
        <div className="card fade-up">
          {(PP.PRESETS || []).map((p) => {
            const active = current === p.id;
            return (
              <div className="setting" key={p.id}>
                <div className="ico"><IconSliders size={20} /></div>
                <div className="txt"><b>{p.name}</b><span>{p.desc}</span></div>
                <button className={'btn ' + (active ? 'btn-primary' : 'btn-ghost')}
                        onClick={() => PP.applyPreset(p.id)}>
                  {active ? 'Selected' : 'Choose'}
                </button>
              </div>
            );
          })}
        </div>
      </StepShell>
    );
  }

  // ── 4. Vulnerable hours ─────────────────────────────────────────────────
  if (step === 3) {
    const v = (s.blocking && s.blocking.vulnerable) || { on: true, start: '22:00', end: '06:00' };
    const setV = (patch) => PP.set({ blocking: { vulnerable: Object.assign({}, v, patch) } });
    return (
      <StepShell
        step={4} total={TOTAL}
        title="When is it hardest?"
        sub="Late at night, for most people. Oath Light pays closer attention during these hours."
        onBack={() => setStep(2)} onNext={() => setStep(4)} onSkip={finish}>
        <div className="card fade-up">
          <div className="setting">
            <div className="ico"><IconClock size={20} /></div>
            <div className="txt"><b>Vulnerable hours</b><span>Extra attention during this window.</span></div>
            <Switch on={!!v.on} onClick={() => setV({ on: !v.on })} />
          </div>
          {v.on &&
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
              <label className="field"><span>From</span>
                <input className="input" type="time" value={v.start || '22:00'} onChange={(e) => setV({ start: e.target.value })} />
              </label>
              <label className="field"><span>Until</span>
                <input className="input" type="time" value={v.end || '06:00'} onChange={(e) => setV({ end: e.target.value })} />
              </label>
            </div>}
        </div>
      </StepShell>
    );
  }

  // ── 5. Optional extras, then the live test ──────────────────────────────
  if (step === 4) {
    return (
      <StepShell
        step={5} total={TOTAL}
        title="Two optional extras"
        sub="Both are genuinely optional. Oath Light is fully effective without either — skip them if they don't fit your life."
        onBack={() => setStep(3)} onNext={() => setStep(5)} nextLabel="Continue" onSkip={finish}>
        <div className="card fade-up">
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Master password</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, maxWidth: '62ch' }}>
            Asked for whenever a protection is being turned down. It can be your own, or set by someone
            you trust so you can't unlock it yourself. Without one, the waiting periods alone still hold.
          </div>
          <div className="row" style={{ gap: 10 }}>
            <input className="input" type="password" placeholder="Leave blank to skip"
                   value={pw} onChange={(e) => setPw(e.target.value)} style={{ maxWidth: 280 }} />
            <button className="btn btn-ghost" onClick={savePassword} disabled={!pw}>Set password</button>
          </div>
          {pwMsg && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{pwMsg}</div>}

          <div style={{ fontWeight: 800, fontSize: 15, margin: '22px 0 4px' }}>Trusted contact</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, maxWidth: '62ch' }}>
            A parent, sibling, friend or mentor. They're told only that a discrete event happened —
            never what was browsed, never a screenshot, never a history.
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Their name" value={contactName}
                   onChange={(e) => setContactName(e.target.value)} style={{ maxWidth: 200 }} />
            <input className="input" placeholder="Their email" value={contactEmail}
                   onChange={(e) => setContactEmail(e.target.value)} style={{ maxWidth: 240 }} />
            <button className="btn btn-ghost" onClick={saveContact} disabled={!contactName || !contactEmail}>Save contact</button>
          </div>
          {contactMsg && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{contactMsg}</div>}
        </div>
      </StepShell>
    );
  }

  // ── 6. See it work ──────────────────────────────────────────────────────
  return (
    <StepShell
      step={6} total={TOTAL}
      title="See it work"
      sub="Trust the demonstration, not the claim. This asks the app what it would do with a known adult site."
      onBack={() => setStep(4)} onNext={finish} nextLabel="Finish setup">
      <div className="card fade-up">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runTest} disabled={testState === 'running'}>
            {testState === 'running' ? 'Checking…' : 'Run the test'}
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--muted)' }}>{ONBOARD_TEST_DOMAIN}</span>
        </div>

        {testState === 'blocked' &&
          <div style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: 'var(--ok, var(--accent))' }}>
            Blocked. That's the app answering for itself.
          </div>}
        {testState === 'open' &&
          <div style={{ marginTop: 14, fontSize: 13.5, color: '#e0564f', maxWidth: '62ch' }}>
            Not blocked. That shouldn't happen — check that the browser extension is installed and
            connected from the Overview page, then run this again.
          </div>}
        {(testState === 'error') &&
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)', maxWidth: '62ch' }}>{testMsg}</div>}
      </div>
    </StepShell>
  );
}

window.OnboardingFlow = OnboardingFlow;
