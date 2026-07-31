/* pages-settings.jsx — user settings.
 *
 * Layout rule for this page — the same one Blocking Settings follows, and the
 * reason this file was rebuilt: every row is a `<Setting>` (icon, one-line
 * title, at most one short line under it, control at the end) inside a
 * `<SectionCard>`. Anything longer than that one line goes in an `InfoDot`,
 * not on the page. The old version gave every card a full paragraph of
 * rationale before its first control, which meant the page read as an essay
 * with switches hidden in it.
 *
 * Section order is deliberate — who you are, how hard the app is on you, how
 * it talks, what it tells you, the optional add-ons, what protects the
 * settings themselves, what it has recorded, and last of all the exits.
 * Reading top to bottom never encounters a control before the thing that
 * governs it.
 */

// --- shared helpers ---------------------------------------------------------

// "47h 59m 03s" style remaining-time string.
function fmtDur(secs) {
  secs = Math.max(0, Math.floor(secs));
  const d = Math.floor(secs / 86400); secs -= d * 86400;
  const h = Math.floor(secs / 3600); secs -= h * 3600;
  const m = Math.floor(secs / 60); const s = secs - m * 60;
  const out = [];
  if (d) out.push(d + 'd');
  out.push(h + 'h', m + 'm', (s < 10 ? '0' : '') + s + 's');
  return out.join(' ');
}
// Used cross-file (pages-blocking/blocklist/monitor pending-weakening notes).
// Babel-standalone injects each file as a real <script>, so this top-level
// function is already a global — the explicit assignment just follows the
// house convention (`window.X = X`) every other shared symbol uses, so a
// future loader/strict-mode change can't silently break the bare references.
window.fmtDur = fmtDur;

// Human cool-off length, e.g. "10 minutes" / "24 hours" (kept in step with the
// backend's actual delay so the copy never lies, even while testing).
function delayWords(secs) {
  secs = Math.max(0, Math.floor(secs));
  const u = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  if (secs >= 86400 && secs % 86400 === 0) return u(secs / 86400, 'day');
  if (secs >= 3600 && secs % 3600 === 0) return u(secs / 3600, 'hour');
  if (secs >= 60 && secs % 60 === 0) return u(secs / 60, 'minute');
  return u(secs, 'second');
}

// "3 minutes ago" / "2 days ago" style relative time from unix seconds — a
// companion to fmtDur (a countdown, not an "ago") above.
function fmtAgo(unixSecs) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  if (secs < 60) return 'just now';
  const m = Math.floor(secs / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
  return new Date(unixSecs * 1000).toLocaleDateString();
}

// Every gated weakening on this page funnels through here: resolve the
// master-password token (4.2), or `null` when no password is configured.
// Rejects with Error('cancelled') if the user dismissed the prompt.
function acquireAuth() {
  return window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null);
}

// True when an error is really "the user closed the password prompt" — not
// something to show them a red message about.
function isCancel(e) {
  return e === 'cancelled' || !!(e && e.message === 'cancelled');
}

const native = () => !!(window.PPNative && window.PPNative.available);

// The one "this needs the desktop app" line, so eight cards can't each invent
// their own wording for it.
function DesktopOnly() {
  return <div className="muted-note">Available in the desktop app.</div>;
}

// --- Profile ----------------------------------------------------------------

function ProfileCard({ s, PP }) {
  const p = s.profile;
  const setP = (patch) => PP.set({ profile: patch });
  const [editing, setEditing] = React.useState(false);
  const initials = (p.name || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

  // The avatar renders as this row's icon rather than as a separate hero
  // block, which is what it used to be. `Setting` sizes its own `.ico` slot,
  // so the initials land in the same 40px square every other row's icon
  // occupies — and take their colour from --accent-ink, the token that exists
  // because white-on-white initials were the original invisible-text bug.
  const Avatar = () => <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-ink)' }}>{initials}</span>;

  return (
    <SectionCard
      title="You"
      sub="Not an account — Oath Light has no sign-in and no server to sign in to."
      info="Your name is how the app addresses you. The email is only used to prefill the “use my own email” shortcut when you set up a trusted contact; nothing is ever sent to it unless you do set one up.">
      <div className="setting">
        <div className="ico" style={{ background: 'var(--accent)' }}><Avatar /></div>
        <div className="txt">
          <b>{p.name || 'You'}</b>
          <span>{p.email || 'No email set'}{p.tz ? ` · ${p.tz}` : ''}</span>
        </div>
        <div className="setting-ctl">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editing &&
        <div className="sub-block">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label className="field">
              <span>Display name</span>
              <input className="input" value={p.name} onChange={(e) => setP({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={p.email} onChange={(e) => setP({ email: e.target.value })} />
            </label>
          </div>
        </div>}
    </SectionCard>
  );
}

// --- Serious Mode (UX Direction §1) -----------------------------------------

// The flagship toggle: one switch that flips the app's entire behaviour AND
// personality to its strictest configuration, with no per-feature exceptions
// (otherwise it gets negotiated with piecemeal, which is exactly what a weak
// moment does best).
//
// The asymmetry lives in Rust, not here: ON is one instant call; OFF files a
// pending change under `"serious.disable"` at double the ordinary cool-off,
// during which the mode stays FULLY active. This component never renders the
// mode as off on its own say-so — it renders `s.serious`, which is mirrored
// from the backend by `useSeriousMode()`.
function SeriousModeCard({ s, PP }) {
  const available = native();
  const on = !!s.serious;
  const disablePending = (window.usePendingWeakenings || (() => []))()
    .find((p) => p.action_id === 'serious.disable') || null;
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  const turnOn = () => {
    setErr('');
    if (!confirm(PP.t('serious.enable_confirm'))) return;
    setBusy(true);
    window.PPNative.setSeriousMode(true, null)
      .then(() => { PP.set({ serious: true }); })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const requestOff = () => {
    setErr('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.setSeriousMode(false, token); })
      // Deliberately does NOT set `serious: false` on success — a successful
      // call here means the REQUEST was filed, not that the mode came off.
      // `useSeriousMode` flips the mirror when the backend actually applies it.
      .catch((e) => { if (!isCancel(e)) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  };

  // Remaining time, in the same shape the strings layer expects.
  const remaining = disablePending ? Math.max(0, disablePending.remaining_secs | 0) : 0;
  const remainingParams = { hours: Math.floor(remaining / 3600), minutes: Math.floor((remaining % 3600) / 60) };

  return (
    <SectionCard
      title="Serious Mode"
      sub="Every protection at its strictest, and the app's whole tone with it."
      info="It covers everything at once — there is nothing to switch off piece by piece, because a mode you can negotiate with is a mode a weak moment will negotiate with. It is also the only thing that changes how Oath Light talks: on, the wording turns short and direct everywhere, including the block screen and the browser popup. Turning it on takes one click; turning it back off takes double the usual waiting period, during which it stays fully active.">

      {/* The control is a Switch — this is a mode, and a mode reads as a
          switch. The one thing it does NOT do is flip on its own: OFF is a
          gated weakening, so the switch stays on until the backend says
          otherwise (see the pending note below) rather than lying about the
          state for the duration of the cool-off. */}
      <Setting
        icon={IconShield}
        title="Serious Mode"
        desc={on
          ? (disablePending ? PP.t('serious.active_sub') + ' · turning off' : PP.t('serious.active_sub'))
          : 'Off — protections are at their individual settings'}
        tone={on ? 'ok' : undefined}>
        <Switch
          on={on}
          disabled={!available || busy || (on && !!disablePending)}
          onClick={on ? requestOff : turnOn} />
      </Setting>

      {available && on && !disablePending &&
        <div className="sub-block">
          <div className="muted-note">{PP.t('serious.disable_request_warning')}</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={requestOff} disabled={busy}>
            {PP.t('serious.disable_request_button')}
          </button>
        </div>}

      {available && on && disablePending &&
        <div className="pending-note">
          {PP.t('serious.disable_pending', remainingParams)} — nothing has weakened yet.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); window.PPNative.cancelWeakening('serious.disable'); }}>
            Keep it on
          </a>
        </div>}

      {err && <div className="err-note">{err}</div>}
      {!available && <DesktopOnly />}
    </SectionCard>
  );
}

// --- Language ---------------------------------------------------------------

// There is no voice picker any more, and that is the point. It used to sit
// here as a Companion/Coach pair, which meant the app's tone had two owners —
// this setting and Serious Mode, with Serious Mode silently overriding the
// picker and a line of copy underneath explaining that the control above it
// didn't apply. One thing changes the tone now: Serious Mode. Off is the warm
// voice, on is the hard one, everywhere, including the block screen and the
// popup (the override lives in strings.js's `t()`, so it holds on surfaces
// this page never renders).
//
// A previously-picked voice is not honoured, deliberately — see syncVoice() in
// store.js. Someone who chose "Coach" once must not be stuck being shouted at
// by an app that no longer shows them the switch.
//
// Two things the language list does deliberately:
//
//   * Every language is named in its own script (`nativeName`). Someone
//     switching TO Arabic can't necessarily read "Arabic" in English, which is
//     precisely the moment they need the label.
//   * An unreviewed translation says so, in the list, before it's picked.
//     Machine-drafted recovery copy is not the same product as reviewed copy,
//     and quietly presenting it as finished would be the kind of small
//     dishonesty this app is otherwise careful to avoid.
//
// Changing the locale re-derives text direction through the store's
// syncVoice() — this card never touches `dir` itself.
function LanguageCard({ s, PP }) {
  const S = window.OL_STRINGS;
  const langs = S && typeof S.locales === 'function' ? S.locales() : [];
  const activeLocale = s.locale || 'en';

  // Only English shipped — nothing to pick, so the card doesn't appear at all
  // rather than showing a list of one.
  if (langs.length < 2) return null;

  return (
    <SectionCard
      title="Language"
      sub="Used everywhere — this app, the block screen and the browser popup."
      info="Changing the language is not a protection setting, so it applies instantly and can be changed back instantly. Text direction follows the language automatically.">
      <Choices columns={2}>
        {langs.map((l) => (
          <Choice
            key={l.code}
            name={l.nativeName}
            lang={l.code}
            dir={l.dir}
            desc={l.name + (l.reviewed ? '' : ' · unreviewed draft — machine-translated, not yet checked by a speaker')}
            selected={activeLocale === l.code}
            onSelect={() => PP.set({ locale: l.code })} />
        ))}
      </Choices>
    </SectionCard>
  );
}

// --- Notifications ----------------------------------------------------------

// What this section says is now true, which it previously wasn't.
//
// The two check-in reminders ARE real and DO fire — **from the desktop app**,
// as of 0.5.0. They used to be the extension's job (a `chrome.alarms` alarm
// drew an in-page card on the active tab), which meant a nudge only reached
// someone who happened to have a browser open on a page the content script
// runs on. They now come from `src-tauri/src/reminder.rs`: the applier
// heartbeat checks once a minute, and at most every 30 minutes it shows a
// small card in the corner of the screen that closes itself after 12 seconds.
// Still not an OS toast — the app has no notification plugin — but it no
// longer depends on a browser being open, so that is what this now says.
//
// The three rows underneath used to be "Coming soon · not built yet". Audited
// the same way the Blocking page's were, that was wrong about two of the
// three:
//
//   * "Daily intention" is built — Overview renders one every day
//     (`DAILY_MESSAGES`).
//   * "Milestone celebrations" is built — Overview celebrates 7/30/90/… days
//     exactly once each, guarded by the persisted `lastMilestone`.
//   * "Weekly recap" was genuinely missing. It exists now, on Overview, in the
//     same in-app channel as the other two (`WeeklyRecapCard`).
//
// So all three are built; none of them is an operating-system notification,
// because the app has no notification plugin at all. Saying "shown in the app"
// is the honest description, and it stops the section from advertising a
// feature that would need backend surface nobody has written.
function NotificationsCard({ s, PP, go }) {
  const b = s.blocking;
  const toggleAlert = (id) =>
    PP.set({ blocking: { alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) } });

  const IN_APP = [
    { icon: IconSun, t: 'Daily intention', d: 'A short line waiting for you on Overview each day.' },
    { icon: IconFlame, t: 'Milestone celebrations', d: 'Overview marks 7, 30, 90 days and beyond — once each.' },
    { icon: IconArrowUp, t: 'Weekly recap', d: 'Overview sums up your last seven days: clean days, urges, slips.' },
  ];

  return (
    <SectionCard
      title="Check-ins and reminders"
      sub="Gentle nudges during your vulnerable hours, and what the app shows you on its own."
      info="Reminders appear in the corner of your screen, roughly twice an hour, and only while your vulnerable-hours window is open — set that window on the Blocking Settings page. They come from Oath Light itself, so no browser needs to be open. The card closes itself after a few seconds and never takes focus. Oath Light does not send operating-system notifications at all.">

      {b.alerts.map((a) => (
        <Setting key={a.id} icon={IconBell}
                 title={a.labelKey ? PP.t(a.labelKey) : a.label}
                 desc={a.descKey ? PP.t(a.descKey) : a.desc}>
          <Switch on={a.on} onClick={() => toggleAlert(a.id)} />
        </Setting>
      ))}

      <div className="sub-block">
        <div className="muted-note">
          These appear in the corner of your screen during your vulnerable hours.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); go('blocking'); }}>Set the window</a>
          {' '}— currently {b.vulnerable && b.vulnerable.on ? `${b.vulnerable.start} → ${b.vulnerable.end}` : 'off, so nothing will fire'}.
        </div>
      </div>

      <div className="sub-label">Always on, inside the app</div>
      {IN_APP.map((n) => (
        <Setting key={n.t} icon={n.icon} title={n.t} desc={n.d} tone="ok">
          <span className="chip chip-ok">On Overview</span>
        </Setting>
      ))}
    </SectionCard>
  );
}

// --- AI mentor (optional, opt-in) -------------------------------------------

// The only feature in this app that sends anything the user types off the
// device, so this card's job is disclosure before it is configuration. Three
// rules it follows:
//
//   * It states what is sent, to whom, and under whose key. The disclosure is
//     the section's own subtitle, not hidden behind a "learn more" — someone
//     deciding whether to turn this on should not have to go looking for the
//     cost. (It is the one place on this page where prose outranks an
//     InfoDot, on purpose.)
//   * The key is write-only from here. Rust reports `has_key`, never the key,
//     so nothing in the webview can read back a credential — and the field is
//     left blank on load rather than pre-filled with a fake value that looks
//     like the real one.
//   * It says plainly that the key is stored in plaintext, because it is (same
//     as the SMTP app-password). Implying a vault that doesn't exist would be
//     a worse failure than the plaintext itself.
function AiMentorCard() {
  const [cfg, setCfg] = React.useState(null);
  const [key, setKey] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [model, setModel] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState('');
  const available = native();

  React.useEffect(() => {
    let alive = true;
    if (!available) {
      setCfg({ enabled: false, has_key: false, model: '', provider: 'anthropic', base_url: '', providers: [] });
      return undefined;
    }
    PPNative.getMentorConfig().then((c) => { if (alive) { setCfg(c); setUrl(c.base_url || ''); } });
    return () => { alive = false; };
  }, [available]);

  if (!cfg) return null;

  // The catalog comes from Rust (mentor::PROVIDERS) rather than being retyped
  // here, so the picker can't drift from what the request path can actually
  // talk to.
  const providers = cfg.providers || [];
  const current = providers.find((p) => p.id === cfg.provider) || providers[0] || {};
  const needsUrl = !!current.needs_url;
  // A local server needs a URL and usually no key; a hosted one needs a key.
  const usable = needsUrl ? !!(cfg.base_url || '').trim() : cfg.has_key;

  async function apply(patch) {
    setSaving(true);
    setNote('');
    try {
      const next = await PPNative.setMentorConfig({
        enabled: patch.enabled !== undefined ? patch.enabled : cfg.enabled,
        // `undefined` means "leave the stored value alone" — that's what lets
        // the toggle work without the renderer ever holding the key.
        apiKey: patch.apiKey,
        provider: patch.provider,
        baseUrl: patch.baseUrl,
        model: patch.model,
      });
      setCfg(next);
      setUrl(next.base_url || '');
      if (patch.apiKey !== undefined) setKey('');
      if (patch.model !== undefined) setModel('');
      if (patch.apiKey === '') setNote('Key removed.');
      else if (patch.apiKey) setNote('Key saved.');
      else if (patch.provider) setNote(`Switched to ${(providers.find((p) => p.id === patch.provider) || {}).name || patch.provider}.`);
      else if (patch.model) setNote('Model saved.');
    } catch (e) {
      setNote(String(e && e.message ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="AI mentor"
      sub="Off unless you turn it on. When it is on, what you type goes to the provider you pick, under your own key, billed to your own account."
      info="It cannot change any setting in this app and will not help you weaken the filter — that is enforced in the request path, not just asked for in a prompt. The guided recovery exercises are a separate feature and still send nothing anywhere.">

      <Setting
        icon={IconSpark}
        title="Enable the AI mentor"
        desc={usable
          ? `Using ${cfg.model || 'the provider default'}.`
          : needsUrl ? 'Needs a server URL below before it can be turned on.'
                     : 'Needs an API key below before it can be turned on.'}>
        <Switch on={!!cfg.enabled} disabled={saving || !usable} onClick={() => apply({ enabled: !cfg.enabled })} />
      </Setting>

      <Setting
        icon={IconGlobe}
        title="Provider"
        desc={current.name || cfg.provider}
        info="Anthropic, OpenAI, Google, OpenRouter, Groq and Mistral all work, as does any OpenAI-compatible endpoint of your own. Switching provider clears the saved model, because a model name from one provider means nothing to another.">
        <select className="input" style={{ width: 190 }} value={cfg.provider} disabled={saving}
                onChange={(e) => apply({ provider: e.target.value })}>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Setting>

      {/* Custom/local: a server URL replaces the key. Ollama, LM Studio and
          vLLM all speak the OpenAI shape and usually want no auth at all. */}
      {needsUrl &&
        <div className="sub-block">
          <div className="sub-label" style={{ marginTop: 0 }}>Server URL</div>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1 }} type="url" placeholder="http://localhost:11434/v1"
                   value={url} autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={saving || !url.trim()}
                    onClick={() => apply({ baseUrl: url.trim() })}>Save</button>
          </div>
          <div className="muted-note">
            Any OpenAI-compatible endpoint — a local Ollama, LM Studio or vLLM server, or a gateway of
            your own. A local model sends nothing off this machine at all.
          </div>
        </div>}

      <Setting
        icon={IconLock}
        title="API key"
        desc={cfg.has_key ? 'One is saved' : (needsUrl ? 'Optional for a local server' : 'Not set')}
        info="Stored in plaintext in this app's settings file on this machine — the same as the email password for trusted-contact notifications. It is never sent to the browser extension and never leaves your device except as the authorization header on your own API requests.">
        {cfg.has_key &&
          <button className="btn btn-ghost btn-sm" disabled={saving}
                  onClick={() => apply({ apiKey: '', enabled: false })}>Remove</button>}
      </Setting>

      <div className="sub-block">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="password" style={{ flex: 1 }} autoComplete="off"
                 placeholder={cfg.has_key ? 'Enter a new key to replace the saved one' : 'Paste your key'}
                 value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={saving || !key.trim()}
                  onClick={() => apply({ apiKey: key.trim() })}>Save</button>
        </div>
        {current.keys_url &&
          <div className="muted-note">Get a key at {current.keys_url.replace(/^https?:\/\//, '')}.</div>}
      </div>

      {/* Model override. Cleared automatically on a provider switch. */}
      <Setting
        icon={IconGrid}
        title="Model"
        desc={cfg.model || current.default_model || 'Provider default'}
        info="Optional. Leave it empty to use whatever the provider's default is — that is the right answer unless you have a specific reason to pin one." />
      <div className="sub-block">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} autoComplete="off"
                 placeholder={cfg.model || current.default_model || 'Provider default'}
                 value={model} onChange={(e) => setModel(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={saving || !model.trim()}
                  onClick={() => apply({ model: model.trim() })}>Save</button>
        </div>
      </div>

      {note && <div className="muted-note">{note}</div>}
      {!available && <DesktopOnly />}
    </SectionCard>
  );
}

// --- Trusted contact (Phase 4 item 5.2, Tier 2) ------------------------------

// Optional, solo-first accountability amplifier: a parent, sibling, friend,
// or mentor — or, per the plan's "trusted-contact/self notifications" intent,
// just the user's OWN email, so a discrete event still leaves a paper trail
// in an inbox they check even without naming a third party. Entirely
// backend-owned (`SettingsV1.trusted_contact`, `None` by default) — this card
// never nags a solo user, it's just how they'd opt in if they want to.
// Wiring TO a contact is instant; removing one is friction-gated (5.2's
// anti-weak-moment rule: the contact is notified of the REQUEST immediately)
// and shows up in the generic `PendingChangesCard` below like any other
// weakening, so there's no bespoke countdown UI needed here.
function TrustedContactCard({ s }) {
  const available = native();
  const [contact, setContact] = React.useState(undefined); // undefined = loading, null = none configured
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const refresh = React.useCallback(() => {
    if (!available) { setContact(null); return; }
    window.PPNative.getTrustedContact().then((c) => setContact(c || null));
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);
  // Also refetch once a pending `trusted_contact.remove` actually applies
  // (its friction delay elapsing removes the count from this list).
  const pendingCount = (window.usePendingWeakenings || (() => []))().length;
  React.useEffect(() => { refresh(); }, [pendingCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileEmail = (s && s.profile && s.profile.email) || '';

  const save = () => {
    setErr(''); setMsg('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setErr('Enter an email — theirs, or your own if you just want a paper trail in your own inbox.'); return; }
    setBusy(true);
    window.PPNative.setTrustedContact(name.trim(), trimmedEmail, {
      uninstall_requested: true,
      lockdown_cancelled: true,
      password_removal_requested: true,
      ext_removed: true,
      block_burst: true,
    })
      .then(() => { setMsg('Trusted contact saved.'); setName(''); setEmail(''); refresh(); })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!confirm('Remove the trusted contact?\n\n'
      + 'This goes through the same waiting-period delay as any other protection change, and they are notified '
      + 'right away that removal was requested — that message can\'t be skipped.')) return;
    setErr(''); setMsg('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.requestRemoveTrustedContact(token); })
      .then(() => setMsg('Removal requested — see "Pending changes" below for the countdown.'))
      .catch((e) => { if (!isCancel(e)) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  };

  return (
    <SectionCard
      title="Trusted contact"
      sub="Fully optional. Oath Light works completely on its own without one."
      info="A parent, sibling, friend or mentor — or just your own email, for a paper trail — gets a short heads-up on a few discrete events: an uninstall request, a cancelled lockdown, an extension that goes missing and stays that way, an unusual burst of blocks. Never browsing history, never screenshots, only that something happened.">

      {!available && <DesktopOnly />}
      {available && contact === undefined && <div className="muted-note">Loading…</div>}

      {available && contact &&
        <Setting
          icon={IconBell}
          title={contact.name || 'Trusted contact'}
          desc={contact.email}
          tone="ok">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>Remove</button>
        </Setting>}

      {available && contact === null &&
        <div className="sub-block" style={{ paddingInlineStart: 4 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Their name (optional)" value={name}
                   onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 160px' }} />
            <input className="input" type="email" placeholder="Their email" value={email}
                   onChange={(e) => setEmail(e.target.value)} style={{ flex: '1 1 200px' }} />
            <button className="btn btn-primary btn-sm" disabled={busy || !email.trim()} onClick={save}>
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
          {profileEmail &&
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
                    onClick={() => setEmail(profileEmail)}>
              Use my own email instead
            </button>}
        </div>}

      {err && <div className="err-note">{err}</div>}
      {msg && <div className="muted-note">{msg}</div>}
    </SectionCard>
  );
}

// --- Master password (Phase 4 item 4.2) --------------------------------------

// The master password that gates every weakening request (turning off the
// uninstall guard/AI monitor, unblocking a custom site, opening an uninstall
// request). The real gate is entirely backend-side (`auth::require_auth` in
// lib.rs) — this card is just the UI for managing the password itself via
// `window.PPAuth`.
//
// Honest recovery story, stated plainly in the "Forgot it?" copy below:
// removing the password normally needs the CURRENT password plus the friction
// delay (`requestRemoval`). If you've genuinely forgotten it, "Forgot it?"
// starts the same delay without the password (`requestRemovalForgotten`) — it
// can't skip the wait, only skip proving you know a password you don't
// remember.
function SecurityCard() {
  const available = native();
  const [set, setSet] = React.useState(null); // null = still loading
  const [mode, setMode] = React.useState('idle'); // idle | set | change | remove
  const [current, setCurrent] = React.useState('');
  const [pw1, setPw1] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const refresh = React.useCallback(() => {
    if (!available) { setSet(false); return; }
    (window.PPAuth ? PPAuth.status() : Promise.resolve({ set: false }))
      .then((s) => setSet(!!(s && s.set)));
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const resetFields = () => { setCurrent(''); setPw1(''); setPw2(''); setErr(''); };
  const cancel = () => { setMode('idle'); resetFields(); };
  const open = (m) => { setMode(m); setMsg(''); resetFields(); };

  const submitSetOrChange = () => {
    setErr('');
    if (pw1.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (pw1 !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    window.PPAuth.setPassword(set ? current : null, pw1)
      .then(() => {
        setMsg(set ? 'Password changed.' : 'Master password set.');
        setSet(true);
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const submitRemove = () => {
    setErr('');
    setBusy(true);
    window.PPAuth.requestRemoval(current)
      .then(() => {
        setMsg('Removal requested — see "Pending changes" below for the countdown.');
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const forgotIt = () => {
    if (!confirm(
      "Forgot your master password?\n\n"
      + "This starts the same waiting-period removal every other protection change goes through. "
      + "You don't need the old password for this — but you do still have to wait out the delay. "
      + "Continue?"
    )) return;
    setErr('');
    setBusy(true);
    window.PPAuth.requestRemovalForgotten()
      .then(() => {
        setMsg('Removal requested — see "Pending changes" below for the countdown.');
        setMode('idle');
        resetFields();
      })
      .catch((e) => setErr(e && e.message ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <SectionCard
      title="Master password"
      sub="Asked for before any change that would weaken your protection."
      info="With one set, turning off a protection needs the password before the usual waiting period even starts. Without one, the waiting period still applies — but anyone sitting at this computer can start the countdown. It protects the settings; it does not encrypt anything.">

      <Setting
        icon={IconLock}
        title="Master password"
        desc={set === null ? 'Loading…' : (set ? 'Set' : 'Not set')}
        tone={set ? 'ok' : undefined}>
        {available && set !== null && mode === 'idle' &&
          <React.Fragment>
            <button className="btn btn-primary btn-sm" onClick={() => open(set ? 'change' : 'set')}>
              {set ? 'Change' : 'Set a password'}
            </button>
            {set && <button className="btn btn-ghost btn-sm" onClick={() => open('remove')}>Remove</button>}
          </React.Fragment>}
      </Setting>

      {!available && <DesktopOnly />}

      {(mode === 'set' || mode === 'change') &&
        <div className="sub-block">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
            {mode === 'change' &&
              <input type="password" className="input" placeholder="Current password" value={current}
                     onChange={(e) => setCurrent(e.target.value)} />}
            <input type="password" className="input" placeholder="New password (min. 6 characters)" value={pw1}
                   onChange={(e) => setPw1(e.target.value)} />
            <input type="password" className="input" placeholder="Confirm new password" value={pw2}
                   onChange={(e) => setPw2(e.target.value)} />
            {err && <div className="err-note">{err}</div>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
              <button className="btn btn-primary btn-sm"
                      disabled={busy || !pw1 || !pw2 || (mode === 'change' && !current)}
                      onClick={submitSetOrChange}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>}

      {mode === 'remove' &&
        <div className="sub-block">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
            <div className="muted-note" style={{ marginTop: 0 }}>
              Needs your current password, then the same waiting period as any other weakening —
              this doesn't skip it, it only starts it.
            </div>
            <input type="password" className="input" placeholder="Current password" value={current}
                   onChange={(e) => setCurrent(e.target.value)} />
            {err && <div className="err-note">{err}</div>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
              <button className="btn btn-danger btn-sm" disabled={busy || !current} onClick={submitRemove}>
                {busy ? 'Requesting…' : 'Request removal'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={forgotIt}>Forgot it?</button>
            </div>
          </div>
        </div>}

      {msg && mode === 'idle' && <div className="muted-note">{msg}</div>}
    </SectionCard>
  );
}

// --- Records: blocklist updates, protection history, false positives ---------

// Human-readable labels for the event log's machine `kind` tags — see
// core/eventlog.rs for the append-only, hash-chained format and the full set
// of `log_event` call sites in lib.rs. Falls back to a humanized version of
// the raw kind (snake_case -> Title Case) for anything not named here, so a
// future event kind never renders as a blank line.
const EVENT_LABELS = {
  uninstall_requested: 'Uninstall requested',
  uninstall_cancelled: 'Uninstall request cancelled',
  uninstall_completed: 'Uninstall completed',
  extension_missing: 'Extension went missing',
  extension_restored: 'Extension reconnected',
  extension_missing_confirmed: 'Extension confirmed missing',
  lockdown_started: 'Lockdown started',
  lockdown_cancel_refused: 'Lockdown cancel refused — was frozen',
  lockdown_escalation_enabled: 'Auto-lockdown (vulnerable hours) turned on',
  block_burst: 'Unusual burst of blocks',
  friction_requested: 'Protection change requested',
  friction_cancelled: 'Protection change cancelled',
  trusted_contact_set: 'Trusted contact set',
  notify_sent: 'Trusted contact notified',
  notify_failed: 'Contact notification failed',
  auth_failed: 'Incorrect master password entered',
  process_killed: 'Blocked app closed',
  monitor_escalated: 'AI monitor escalated',
  clock_anomaly: 'Clock tampering detected',
  chain_restarted: 'Event log integrity break detected',
  log_rotated: 'Event log rotated (routine)',
};

function humanizeKind(kind) {
  return (kind || '').split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
function eventLabel(kind) { return EVENT_LABELS[kind] || humanizeKind(kind); }

// A short, honest detail line for the handful of kinds whose `data` carries
// something worth surfacing — everything else just shows the label + time.
// The log itself never stores browsing history or screen content (plan 4.5:
// "event only, never content"), so there's rarely more to say than this.
function eventDetail(e) {
  const d = e.data || {};
  if ((e.kind === 'friction_requested' || e.kind === 'friction_cancelled') && d.action) return d.action;
  if ((e.kind === 'extension_missing' || e.kind === 'extension_restored' || e.kind === 'extension_missing_confirmed') && d.browser) return d.browser;
  if (e.kind === 'lockdown_started' && d.duration_secs) return (d.frozen ? 'frozen · ' : '') + delayWords(d.duration_secs);
  return '';
}

// Settings card for the over-the-air blocklist update channel: which list
// version is installed (or "built-in" when none has ever been), when the last
// check ran and how it went — shown verbatim, including real errors like the
// GitHub release not existing yet — and a "Check now" button. Checking only
// ever strengthens the lists (signed, monotonically-versioned updates), so
// the button is ungated.
function ListsUpdateRow() {
  const available = native();
  const [st, setSt] = React.useState(null);

  React.useEffect(() => {
    if (!available) return;
    let unlisten = null, cancelled = false;
    window.PPNative.getOtaStatus().then((v) => { if (!cancelled && v) setSt(v); });
    window.PPNative.onOtaStatus((v) => { if (!cancelled) setSt(v); })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    // Poll as a fallback while a check runs (the event covers the normal path).
    const id = setInterval(() => {
      window.PPNative.getOtaStatus().then((v) => { if (!cancelled && v) setSt(v); });
    }, 5000);
    return () => { cancelled = true; clearInterval(id); if (unlisten) unlisten(); };
  }, [available]);

  const checking = !!(st && st.checking);
  const version = st
    ? (st.loaded_version ? ('v' + st.loaded_version)
      : (st.installed_version ? ('v' + st.installed_version + ' (not loaded — using built-in)') : 'built-in'))
    : '…';
  const lastCheck = st && st.last_check ? fmtAgo(st.last_check) : 'never';
  const failed = !!(st && st.last_result && st.last_result.indexOf('failed') === 0);

  return (
    <React.Fragment>
      <Setting
        icon={IconGlobe}
        title="Blocklist updates"
        desc={`${version} · checked ${lastCheck}`}
        info="Oath Light checks weekly for signed blocklist updates and applies them automatically. An update can only ever add protection, never silently weaken it, and the bundled lists always remain as a fallback.">
        <button className="btn btn-ghost btn-sm" disabled={!available || checking}
                onClick={() => window.PPNative.checkListsUpdateNow().then((v) => { if (v) setSt(v); })}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </Setting>
      {st && st.last_result &&
        <div className={failed ? 'err-note' : 'muted-note'} style={{ wordBreak: 'break-word' }}>
          {st.last_result}
        </div>}
    </React.Fragment>
  );
}

// Tamper-evident event log (4.5) — a plain-language recent-activity list plus
// an on-demand "Verify integrity" button that re-walks the WHOLE hash chain
// from genesis, across every rotated segment (`verify_event_log` / see
// core/eventlog.rs). Honesty rule, taken straight from `VerifyReport`'s own
// doc comment: a past break is reported forever, even once the chain resumes
// correctly afterward — this card never hides that behind a "looks fine now".
function ProtectionHistoryRow() {
  const available = native();
  const [events, setEvents] = React.useState(null); // null = loading
  const [report, setReport] = React.useState(null);
  const [verifying, setVerifying] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!available) { setEvents([]); return; }
    window.PPNative.getEventLog(8).then((list) => setEvents(Array.isArray(list) ? list : []));
  }, [available]);

  const verify = () => {
    setVerifying(true);
    window.PPNative.verifyEventLog().then((r) => { if (r) setReport(r); }).finally(() => setVerifying(false));
  };

  const count = events ? events.length : 0;

  return (
    <React.Fragment>
      <Setting
        icon={IconClock}
        title="Protection history"
        desc={events === null ? 'Loading…' : (count ? `${count} recent event${count === 1 ? '' : 's'}` : 'Nothing recorded yet')}
        info="A tamper-evident log of protective events — never browsing history, never screenshots, only that something happened. Each entry is cryptographically chained to the one before it, so editing or deleting one leaves unmistakable evidence.">
        {available &&
          <button className="btn btn-ghost btn-sm" disabled={verifying} onClick={verify}>
            {verifying ? 'Verifying…' : 'Verify'}
          </button>}
      </Setting>

      {report &&
        <div className={report.intact ? 'muted-note' : 'err-note'}>
          {report.intact
            ? `Intact — ${report.entries} event${report.entries === 1 ? '' : 's'} verified back to the start.`
            : <React.Fragment>
                Tampering detected — the chain does not verify.{' '}
                {report.first_break_seq != null && ('Break at entry #' + report.first_break_seq + '. ')}
                {report.restarts > 0 && (report.restarts + (report.restarts === 1 ? ' restart' : ' restarts') + ' recorded. ')}
                {report.entries} event{report.entries === 1 ? '' : 's'} currently valid.
              </React.Fragment>}
        </div>}

      {count > 0 &&
        <React.Fragment>
          <button className="disclose" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <IconChevron size={15} className={open ? 'disclose-open' : ''} />
            {open ? 'Hide recent events' : 'Show recent events'}
          </button>
          {open &&
            <div className="sub-block">
              {events.map((e) => {
                const detail = eventDetail(e);
                return (
                  <div key={e.seq} className="row" style={{ justifyContent: 'space-between', gap: 10, padding: '5px 0' }}>
                    <span style={{ fontSize: 12.5 }}>
                      {eventLabel(e.kind)}
                      {detail && <span style={{ color: 'var(--muted)' }}> · {detail}</span>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtAgo(e.ts)}</span>
                  </div>
                );
              })}
            </div>}
        </React.Fragment>}
    </React.Fragment>
  );
}

// The user's own record of every time they told the AI monitor it was wrong,
// and the effect it had. This is the "review" half of plan item 2.4 — the
// overlay's report button is the other half, and it tells the user to come
// here, so this has to exist for that sentence to be true.
//
// Why show the raw scores: because we can. No commercial blocker can display
// its model's mistakes next to the confidence it had while making them. Doing
// it turns the ensemble's 95.8% from a marketing number into something the
// user can audit on their own machine.
//
// Renders nothing at all when there is nothing to review — a user who has
// never been wrongly interrupted should not see a row implying they might be.
function EvalLogRow() {
  const available = native();
  const [entries, setEntries] = React.useState(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!available) return;
    let cancelled = false;
    window.PPNative.getEvalLog(25).then((list) => {
      if (!cancelled) setEntries(Array.isArray(list) ? list : []);
    });
    return () => { cancelled = true; };
  }, [available]);

  if (!available || !entries || entries.length === 0) return null;

  return (
    <React.Fragment>
      <Setting
        icon={IconSearch}
        title="When the AI got it wrong"
        desc={`${entries.length} false alarm${entries.length === 1 ? '' : 's'} you reported`}
        info="The scores the model had at the time of each report. The pause before you can dismiss an alert gets shorter as these add up. Stored only on this computer — nothing here is ever sent anywhere.">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </Setting>
      {open &&
        <div className="sub-block">
          {entries.map((e, i) => (
            <div key={i} className="row" style={{ gap: 12, padding: '5px 0', fontSize: 12.5 }}>
              <span style={{ color: 'var(--muted)', minWidth: 92 }}>{fmtAgo(e.ts)}</span>
              <span style={{ color: 'var(--text-2)' }}>
                image {(e.siglip_nsfw * 100).toFixed(0)}% · nudity {(e.nudenet_explicit * 100).toFixed(0)}%
              </span>
              <span style={{ color: 'var(--muted)', marginInlineStart: 'auto' }}>pause was {e.dwell_secs}s</span>
            </div>
          ))}
        </div>}
    </React.Fragment>
  );
}

// --- Installing a new version (update.rs) ------------------------------------

// The card for the one situation where Oath Light's own defenses are the
// obstacle: installing a newer build over a running one. Both executables are
// running and each resurrects the other if killed, so an installer that tries
// to overwrite them loses — and the only existing stand-down path is gated on
// the 24-hour uninstall cool-off, which is the right gate for removal and an
// absurd one for a patch.
//
// So this button opens a fifteen-minute window, closes the app, and arms a
// scheduled task to bring everything back if the update never happens. The copy
// below is deliberately blunt about all three of those, in that order, because
// the app is about to vanish from the screen and a user who did not expect that
// will reasonably assume they broke something.
function AppUpdateCard() {
  const available = native();
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!available) return;
    let cancelled = false;
    window.PPNative.getUpdateState().then((v) => { if (!cancelled && v) setSt(v); });
    return () => { cancelled = true; };
  }, [available]);

  const windowMins = st ? Math.round(st.window_secs / 60) : 15;

  function start() {
    setErr('');
    setBusy(true);
    acquireAuth()
      .then((auth) => window.PPNative.beginUpdate(auth))
      .then((v) => {
        if (v) setSt(v);
        // `begin_update` resolves and THEN closes the app about two seconds
        // later. Saying so here is the only warning the user gets.
        setArmed(true);
      })
      .catch((e) => {
        setBusy(false);
        if (isCancel(e)) return;
        setErr(String((e && e.message) || e));
      });
  }

  return (
    <SectionCard
      title="Installing a new version"
      sub="Oath Light has to stand out of its own way for a moment before it can be replaced."
      info={
        `Oath Light runs two processes that restart each other, which is what stops it being ` +
        `closed from Task Manager — and also what stops an installer from replacing it. ` +
        `Preparing for an update pauses only that mutual restart, for ${windowMins} minutes, and ` +
        `closes the app so its files are free. Your blocklists, browser policies, extension ` +
        `enforcement and uninstall waiting period are all untouched, and blocking carries on in ` +
        `your browsers the whole time. One thing does stop: the system DNS filter runs inside ` +
        `the app, so it goes down while the app is closed and your normal DNS is put back — ` +
        `otherwise you would have no internet to finish the update with. It comes back on its ` +
        `own when Oath Light starts again. If you never run the installer, a scheduled task ` +
        `starts it for you when the ${windowMins} minutes are up.`
      }>
      {!available ? <DesktopOnly /> :
        <React.Fragment>
          <Setting
            icon={IconArrowUp}
            title="Prepare for an update"
            desc={st
              ? (st.active
                ? `Update window open — ${Math.ceil(st.seconds_left / 60)} min left`
                : `Version ${st.app_version} · download the new installer first`)
              : '…'}>
            {st && st.active
              ? <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => window.PPNative.cancelUpdate().then((v) => { if (v) setSt(v); })}>
                  Cancel
                </button>
              : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={start}>
                  {busy ? 'Preparing…' : 'Prepare'}
                </button>}
          </Setting>

          {armed &&
            <div className="muted-note">
              Oath Light is closing now. Run the installer within {windowMins} minutes — it will
              start the new version for you when it finishes.
              {st && st.recovery_armed === false &&
                <React.Fragment>
                  {' '}<b>Heads up:</b> the automatic restart could not be scheduled on this
                  machine, so if you don't run the installer, Oath Light will stay closed until
                  you open it or sign in again.
                </React.Fragment>}
            </div>}

          {err && <div className="err-note" style={{ wordBreak: 'break-word' }}>{err}</div>}
        </React.Fragment>}
    </SectionCard>
  );
}

function RecordsCard() {
  return (
    <SectionCard
      title="What Oath Light keeps"
      sub="Everything below lives on this computer only."
      info="No account, no server, no sync. Nothing in this section has ever been uploaded, and there is nowhere for it to go — the app has no backend of its own.">
      <ListsUpdateRow />
      <ProtectionHistoryRow />
      <EvalLogRow />
    </SectionCard>
  );
}

// --- Pending weakenings (Phase 4 friction, 4.1) ------------------------------

// Every OTHER pending weakening besides uninstall (which has its own
// dedicated card below) — turning off the uninstall guard, stopping the AI
// monitor, or unblocking a custom site all wait out the same friction delay
// before they actually apply. Hidden entirely when nothing is pending.
function PendingChangesCard({ PP }) {
  const all = (window.usePendingWeakenings || (() => []))();
  const pending = all.filter((p) => p.action_id !== 'uninstall');
  const [busy, setBusy] = React.useState(null);

  if (!pending.length) return null;

  const cancel = (p) => {
    setBusy(p.action_id);
    window.PPNative.cancelWeakening(p.action_id).then(() => {
      // The backend is the source of truth; this just keeps the renderer's
      // own copy from lying about the toggle/list in the meantime.
      //
      // (There was a `guard.disable` branch here. The uninstall guard has no
      // off switch any more, so that weakening can no longer be created — and
      // one left pending by an older build is cancelled at startup, before this
      // card ever renders.)
      if (p.action_id.indexOf('custom_block.remove:') === 0) {
        const domain = p.action_id.slice('custom_block.remove:'.length);
        const bl = PP.get().blocklist;
        if (!bl.customSites.some((x) => x.url === domain)) {
          PP.put('blocklist', { ...bl, customSites: [...bl.customSites, { id: Date.now(), url: domain, added: 'restored' }] });
        }
      }
    }).finally(() => setBusy(null));
  };

  return (
    <SectionCard
      title="Pending changes"
      sub="Requested, not yet applied — your protection is still fully on."
      info="Changes that weaken Oath Light's protection take effect only after a delay, the same friction that applies to uninstalling. Cancelling here leaves your protection exactly as it is now.">
      {pending.map((p) => (
        <Setting key={p.action_id} icon={IconClock} title={p.label}
                 desc={p.ready ? 'Ready to apply any moment now' : ('Applies in ' + fmtDur(p.remaining_secs))}>
          <button className="btn btn-ghost btn-sm" disabled={busy === p.action_id} onClick={() => cancel(p)}>
            Cancel
          </button>
        </Setting>
      ))}
    </SectionCard>
  );
}

// --- The exits: reset + uninstall -------------------------------------------

// The persisted, backend-owned uninstall request. Four states: idle → request,
// pending → live countdown + cancel, ready → reset / cancel / type-the-phrase /
// remove, removing → success message only (no actions — the app is seconds
// from closing itself down).
function DangerCard({ PP }) {
  const available = native();
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [removing, setRemoving] = React.useState(false);
  // 4.6 — what the user has typed of the confirmation phrase so far. Local
  // only; the backend holds the real phrase and does the real comparison.
  const [typed, setTyped] = React.useState('');
  const [, tick] = React.useReducer((x) => x + 1, 0);
  // Anchor the last backend reading so the local ticker can derive the countdown
  // without hammering the backend every second.
  const ref = React.useRef({ at: 0, remaining: 0 });

  const apply = (s) => {
    setSt(s);
    ref.current = { at: Date.now(), remaining: s ? s.remaining_secs : 0 };
  };

  const refresh = React.useCallback(() => {
    if (!available) return;
    window.PPNative.getUninstallState().then(apply).catch(() => {});
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);

  // 1s ticker while pending; re-sync from the backend (authoritative) at zero.
  React.useEffect(() => {
    if (!st || !st.requested || st.ready) return;
    const id = setInterval(() => {
      const left = ref.current.remaining - (Date.now() - ref.current.at) / 1000;
      if (left <= 0) refresh(); else tick();
    }, 1000);
    return () => clearInterval(id);
  }, [st, refresh]);

  const run = (fn) => {
    setBusy(true);
    fn().then(apply)
      .catch((e) => setMsg('Something went wrong: ' + (e && e.message ? e.message : e) + ' — please try again.'))
      .finally(() => setBusy(false));
  };

  // Master-password gated (4.2) when one is set — opening the request is the
  // first step of a weakening, even though protection stays fully on the whole
  // time it's pending. A dismissed prompt aborts silently rather than showing
  // the generic error message.
  const doRequest = () => {
    if (!st) return;
    if (!confirm('Start the ' + delayWords(st.delay_secs) + ' uninstall waiting period?\n\n'
      + 'Oath Light stays fully active the whole time. You can cancel whenever you like.')) return;
    setMsg('');
    setBusy(true);
    acquireAuth()
      .then((auth) => window.PPNative.requestUninstall(auth))
      .then(apply)
      .catch((e) => {
        if (isCancel(e)) return;
        setMsg('Something went wrong: ' + (e && e.message ? e.message : e) + ' — please try again.');
      })
      .finally(() => setBusy(false));
  };
  const doCancel = () => { setMsg(''); run(() => window.PPNative.cancelUninstall()); };
  const doReset = () => { setMsg(''); run(() => window.PPNative.resetUninstallTimer()); };
  const doRemove = () => {
    if (!confirm('Remove Oath Light completely?\n\n'
      + 'This disables all protection and deletes Oath Light from your computer. This cannot be undone.')) return;
    setBusy(true);
    // 4.6: the typed confirmation phrase goes with the call. The backend is
    // what actually checks it (`complete_uninstall`), so a mismatch comes back
    // as its error message rather than being pre-judged here.
    window.PPNative.completeUninstall(typed)
      .then(() => {
        setMsg('Removing Oath Light — it will close and delete itself in a moment.');
        setRemoving(true);
        refresh();
      })
      // The backend refuses to tear anything down unless removal is guaranteed
      // to proceed, and its error message already says as much — surface it
      // as-is instead of restating it.
      .catch((e) => setMsg('Could not remove Oath Light: ' + (e && e.message ? e.message : e)))
      .finally(() => setBusy(false));
  };

  const requested = st && st.requested;
  const ready = st && st.ready;
  const liveRemaining = requested && !ready
    ? Math.max(0, Math.round(ref.current.remaining - (Date.now() - ref.current.at) / 1000))
    : (st ? st.remaining_secs : 0);
  const pct = st && st.delay_secs
    ? Math.min(100, Math.max(0, (1 - liveRemaining / st.delay_secs) * 100)) : 0;

  return (
    <SectionCard
      title="Leaving"
      sub="Both of these are reversible in one direction only. They are last on this page for that reason."
      info="Resetting app data restores this app's own defaults — your streak, settings and theme — but does not remove Oath Light or turn off any protection. Uninstalling does both, after a waiting period.">

      <Setting
        icon={IconArrowUp}
        title="Reset app data"
        desc="Streak, settings and theme back to defaults"
        info="Protections are backend-owned and are NOT reset by this — the uninstall guard, the DNS filter, blocked apps and your master password all survive it. This is the app's own state, not the enforcement.">
        <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Reset all app data?')) PP.reset(); }}>
          Reset
        </button>
      </Setting>

      <Setting
        icon={IconShield}
        title="Uninstall Oath Light"
        desc={`Opens a ${st ? delayWords(st.delay_secs) : '24-hour'} waiting period first`}
        tone="danger"
        info="A moment of friction for your future self. Blocking and everything else stay fully active the entire time, and you can cancel whenever you like.">
        {st && !requested && !removing &&
          <button className="btn btn-danger btn-sm" disabled={busy || !available} onClick={doRequest}>
            Request uninstall
          </button>}
      </Setting>

      {!available && <DesktopOnly />}

      {/* pending → live countdown */}
      {requested && !ready && !removing &&
        <div className="sub-block">
          <div className="ut-count">{fmtDur(liveRemaining)}</div>
          <div className="ut-sub">until removal unlocks · protection active</div>
          <div className="ut-bar"><div className="ut-fill" style={{ width: pct + '%' }} /></div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel} style={{ marginTop: 14 }}>
            Cancel request
          </button>
        </div>}

      {/* ready → reset / cancel / type-the-phrase / remove.
          The phrase (4.6) is the last piece of friction in the whole system:
          the 24 hours guard the impulsive moment, this guards the moment the
          wait finally ends and the button is live. Deliberately placed above
          the buttons so it reads as a step, not an obstacle discovered after
          clicking. */}
      {ready && !removing &&
        <div className="sub-block">
          <div className="ut-ready">{PP.t('friction.ready_prompt')}</div>

          {st && st.confirm_phrase &&
            <div style={{ marginTop: 14 }}>
              <div className="muted-note" style={{ marginTop: 0 }}>
                To remove Oath Light, type this out. Not a test — just a minute of your own attention
                before something permanent.
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7, padding: '10px 12px',
                borderRadius: 10, background: 'var(--glass)', border: '1px solid var(--glass-brd-strong)',
                userSelect: 'none', maxWidth: '64ch', marginTop: 8,
              }}>
                {st.confirm_phrase}
              </div>
              <textarea
                className="input"
                rows={3}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type the phrase above"
                style={{ marginTop: 10, width: '100%', maxWidth: '64ch', fontFamily: 'monospace', fontSize: 13 }} />
            </div>}

          <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doReset}>Reset timer</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel}>{PP.t('friction.keep')}</button>
            {/* Enabled only once something has been typed — the backend is
                still the authority on whether it MATCHES; this only avoids a
                pointless round-trip on an empty box. */}
            <button className="btn btn-danger btn-sm"
                    disabled={busy || (st && st.confirm_phrase && !typed.trim())}
                    onClick={doRemove}>Remove completely</button>
          </div>
        </div>}

      {msg && <div className="ut-msg">{msg}</div>}
    </SectionCard>
  );
}

// --- the page ---------------------------------------------------------------

function SettingsPage({ s, PP, go }) {
  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Settings</div>
        <h1 className="page-title">How this app <em>behaves</em></h1>
        <p className="page-sub">Everything here is yours and stays on this computer.</p>
      </div>

      <ProfileCard s={s} PP={PP} />
      {/* Serious Mode is the only thing that changes the app's tone. */}
      <SeriousModeCard s={s} PP={PP} />
      <LanguageCard s={s} PP={PP} />
      <NotificationsCard s={s} PP={PP} go={go} />
      <AiMentorCard />
      <TrustedContactCard s={s} />
      <SecurityCard />
      <RecordsCard />
      <AppUpdateCard />
      <PendingChangesCard PP={PP} />
      <DangerCard PP={PP} />
    </div>
  );
}
window.SettingsPage = SettingsPage;
