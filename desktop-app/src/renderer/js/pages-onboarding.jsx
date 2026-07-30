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
        <div className="eyebrow">{PP.t('onboarding.step_eyebrow', { step, total })}</div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children}
      <div className="row" style={{ gap: 12, marginTop: 26, alignItems: 'center' }}>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>{PP.t('app.action_back')}</button>}
        <button className="btn btn-primary" onClick={onNext}>{nextLabel || PP.t('app.action_continue')}</button>
        {onSkip &&
          <button className="btn btn-ghost" style={{ marginInlineStart: 'auto', opacity: .75 }} onClick={onSkip}>
            {PP.t('onboarding.skip_setup')}
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
    if (!available) { setTestState('error'); setTestMsg(PP.t('onboarding.test_needs_desktop')); return; }
    setTestState('running');
    window.PPNative.checkDomainBlocked(ONBOARD_TEST_DOMAIN).then((res) => {
      // `checkDomainBlocked` resolves null on any failure (see tauri-bridge).
      if (res === null || res === undefined) {
        setTestState('error');
        setTestMsg(PP.t('onboarding.test_unreachable'));
        return;
      }
      const blocked = typeof res === 'object' ? !!res.blocked : !!res;
      setTestState(blocked ? 'blocked' : 'open');
    }).catch(() => {
      setTestState('error');
      setTestMsg(PP.t('onboarding.test_failed'));
    });
  };

  const savePassword = () => {
    if (!window.PPAuth || pw.length < 6) { setPwMsg(PP.t('onboarding.password_too_short')); return; }
    window.PPAuth.setPassword(null, pw)
      .then(() => { setPwMsg(PP.t('onboarding.password_saved')); setPw(''); })
      .catch((e) => setPwMsg(e && e.message ? e.message : String(e)));
  };

  const saveContact = () => {
    if (!available) { setContactMsg(PP.t('app.needs_desktop')); return; }
    if (!contactName.trim() || !contactEmail.trim()) { setContactMsg(PP.t('onboarding.contact_need_both')); return; }
    window.PPNative.setTrustedContact(contactName.trim(), contactEmail.trim(), null)
      .then(() => setContactMsg(PP.t('onboarding.contact_saved')))
      .catch((e) => setContactMsg(e && e.message ? e.message : String(e)));
  };

  // Five screens: welcome, preset, hours, extras, test. (Counted wrong as 5
  // when there were six, which showed "step 5 of 5" on two consecutive
  // screens — so this number is worth keeping honest.)
  //
  // There WAS a sixth, second from the front: a Companion/Coach voice picker.
  // It is gone along with the one in Settings — Serious Mode is the only thing
  // that changes the app's tone now, and a first-run wizard is the wrong place
  // to ask about a mode that takes double the cool-off period to undo.
  const TOTAL = 5;

  // ── 1. Welcome ──────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <StepShell
        step={1} total={TOTAL}
        title={tRich('onboarding.welcome_title')}
        sub={PP.t('onboarding.welcome_sub')}
        onNext={() => setStep(1)}
        onSkip={finish}>
        <div className="card fade-up">
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
            {tRich('onboarding.welcome_rule')}
          </div>
        </div>
      </StepShell>
    );
  }

  // ── 2. Strictness preset ────────────────────────────────────────────────
  if (step === 1) {
    const current = (s.blocking && s.blocking.strictness) || 'strict';
    return (
      <StepShell
        step={2} total={TOTAL}
        title={PP.t('onboarding.preset_title')}
        sub={PP.t('onboarding.preset_sub')}
        onBack={() => setStep(0)} onNext={() => setStep(2)} onSkip={finish}>
        <div className="card fade-up">
          {(PP.PRESETS || []).map((p) => {
            const active = current === p.id;
            return (
              <div className="setting" key={p.id}>
                <div className="ico"><IconSliders size={20} /></div>
                <div className="txt"><b>{PP.t(p.nameKey)}</b><span>{PP.t(p.descKey)}</span></div>
                <button className={'btn ' + (active ? 'btn-primary' : 'btn-ghost')}
                        onClick={() => PP.applyPreset(p.id)}>
                  {active ? PP.t('onboarding.preset_selected') : PP.t('onboarding.preset_choose')}
                </button>
              </div>
            );
          })}
        </div>
      </StepShell>
    );
  }

  // ── 3. Vulnerable hours ─────────────────────────────────────────────────
  if (step === 2) {
    const v = (s.blocking && s.blocking.vulnerable) || { on: true, start: '22:00', end: '06:00' };
    const setV = (patch) => PP.set({ blocking: { vulnerable: Object.assign({}, v, patch) } });
    return (
      <StepShell
        step={3} total={TOTAL}
        title={PP.t('onboarding.hours_title')}
        sub={PP.t('onboarding.hours_sub')}
        onBack={() => setStep(1)} onNext={() => setStep(3)} onSkip={finish}>
        <div className="card fade-up">
          <div className="setting">
            <div className="ico"><IconClock size={20} /></div>
            <div className="txt">
              <b>{PP.t('blocking.vulnerable_title')}</b><span>{PP.t('blocking.vulnerable_desc')}</span>
            </div>
            <Switch on={!!v.on} onClick={() => setV({ on: !v.on })} />
          </div>
          {v.on &&
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
              <label className="field"><span>{PP.t('blocking.time_from')}</span>
                <input className="input" type="time" value={v.start || '22:00'} onChange={(e) => setV({ start: e.target.value })} />
              </label>
              <label className="field"><span>{PP.t('blocking.time_until')}</span>
                <input className="input" type="time" value={v.end || '06:00'} onChange={(e) => setV({ end: e.target.value })} />
              </label>
            </div>}
        </div>
      </StepShell>
    );
  }

  // ── 4. Optional extras, then the live test ──────────────────────────────
  if (step === 3) {
    return (
      <StepShell
        step={4} total={TOTAL}
        title={PP.t('onboarding.extras_title')}
        sub={PP.t('onboarding.extras_sub')}
        onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel={PP.t('app.action_continue')} onSkip={finish}>
        <div className="card fade-up">
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{PP.t('onboarding.password_title')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, maxWidth: '62ch' }}>
            {PP.t('onboarding.password_desc')}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <input className="input" type="password" placeholder={PP.t('onboarding.password_placeholder')}
                   value={pw} onChange={(e) => setPw(e.target.value)} style={{ maxWidth: 280 }} />
            <button className="btn btn-ghost" onClick={savePassword} disabled={!pw}>
              {PP.t('onboarding.password_button')}
            </button>
          </div>
          {pwMsg && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{pwMsg}</div>}

          <div style={{ fontWeight: 800, fontSize: 15, margin: '22px 0 4px' }}>{PP.t('onboarding.contact_title')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, maxWidth: '62ch' }}>
            {PP.t('onboarding.contact_desc')}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder={PP.t('onboarding.contact_name_placeholder')} value={contactName}
                   onChange={(e) => setContactName(e.target.value)} style={{ maxWidth: 200 }} />
            <input className="input" placeholder={PP.t('onboarding.contact_email_placeholder')} value={contactEmail}
                   onChange={(e) => setContactEmail(e.target.value)} style={{ maxWidth: 240 }} />
            <button className="btn btn-ghost" onClick={saveContact} disabled={!contactName || !contactEmail}>
              {PP.t('onboarding.contact_button')}
            </button>
          </div>
          {contactMsg && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>{contactMsg}</div>}
        </div>
      </StepShell>
    );
  }

  // ── 5. See it work ──────────────────────────────────────────────────────
  return (
    <StepShell
      step={5} total={TOTAL}
      title={PP.t('onboarding.test_title')}
      sub={PP.t('onboarding.test_sub')}
      onBack={() => setStep(3)} onNext={finish} nextLabel={PP.t('onboarding.finish')}>
      <div className="card fade-up">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={runTest} disabled={testState === 'running'}>
            {testState === 'running' ? PP.t('onboarding.test_running') : PP.t('onboarding.test_button')}
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--muted)' }}>{ONBOARD_TEST_DOMAIN}</span>
        </div>

        {testState === 'blocked' &&
          <div style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: 'var(--ok, var(--accent))' }}>
            {PP.t('onboarding.test_blocked')}
          </div>}
        {testState === 'open' &&
          <div style={{ marginTop: 14, fontSize: 13.5, color: '#e0564f', maxWidth: '62ch' }}>
            {PP.t('onboarding.test_open')}
          </div>}
        {(testState === 'error') &&
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)', maxWidth: '62ch' }}>{testMsg}</div>}
      </div>
    </StepShell>
  );
}

window.OnboardingFlow = OnboardingFlow;
