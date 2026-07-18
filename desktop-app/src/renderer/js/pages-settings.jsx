/* pages-settings.jsx — user settings */

// --- 24-hour uninstall request (Phase 4 friction) ---------------------------

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

// The settings card that drives the persisted, backend-owned uninstall request.
// Four states: idle → request, pending → live countdown + cancel, ready →
// reset / cancel / remove, removing → success message only (no actions —
// the app is seconds from closing itself down).
function UninstallCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [removing, setRemoving] = React.useState(false);
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
  // first step of a weakening, even though protection stays fully on the
  // whole time it's pending. `PPAuth.acquire()` resolves the session token
  // (or `null` outside a password) to pass through, or rejects
  // `Error('cancelled')` if the prompt was dismissed, which aborts silently
  // here rather than showing the generic error message.
  const doRequest = () => {
    if (!st) return;
    if (!confirm('Start the ' + delayWords(st.delay_secs) + ' uninstall waiting period?\n\n'
      + 'Oath Light stays fully active the whole time. You can cancel whenever you like.')) return;
    setMsg('');
    setBusy(true);
    (window.PPAuth ? PPAuth.acquire() : Promise.resolve(null))
      .then((auth) => window.PPNative.requestUninstall(auth))
      .then(apply)
      .catch((e) => {
        if (e && e.message === 'cancelled') return;
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
    window.PPNative.completeUninstall()
      .then(() => {
        setMsg('Removing Oath Light — it will close and delete itself in a moment.');
        setRemoving(true);
        refresh();
      })
      // The backend refuses to tear anything down unless removal is
      // guaranteed to proceed, and its error message already says as much —
      // just surface it as-is instead of restating it.
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
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconShield size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Uninstall Oath Light</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            Removing Oath Light opens a {st ? delayWords(st.delay_secs) : '24-hour'} waiting period first — a moment
            of friction for your future self. Blocking and everything else stay fully active the entire time.
          </div>

          {/* idle → request */}
          {st && !requested && !removing &&
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-danger btn-sm" disabled={busy || !available} onClick={doRequest}>
                Request uninstall
              </button>
            </div>
          }

          {/* pending → live countdown */}
          {requested && !ready && !removing &&
            <div className="ut-pending" style={{ marginTop: 16 }}>
              <div className="ut-count">{fmtDur(liveRemaining)}</div>
              <div className="ut-sub">until removal unlocks · protection active</div>
              <div className="ut-bar"><div className="ut-fill" style={{ width: pct + '%' }} /></div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel} style={{ marginTop: 14 }}>
                Cancel request
              </button>
            </div>
          }

          {/* ready → reset / cancel / remove */}
          {ready && !removing &&
            <div style={{ marginTop: 16 }}>
              <div className="ut-ready">The waiting period is over. What would you like to do?</div>
              <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doReset}>Reset timer</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doCancel}>Cancel — stay protected</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={doRemove}>Remove completely</button>
              </div>
            </div>
          }

          {/* removing → success message only, no actions — the app is about to close itself */}
          {msg && <div className="ut-msg">{msg}</div>}
          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)' }}>Uninstall controls are available in the desktop app.</div>
          }
        </div>
      </div>
    </div>
  );
}

// --- Master password (Phase 4 item 4.2) --------------------------------------

// Settings card for setting/changing/removing the master password that gates
// every weakening request (turning off the uninstall guard/AI monitor,
// unblocking a custom site, opening an uninstall request). The real gate is
// entirely server-side (`auth::require_auth` in lib.rs) — this card is just
// the UI for managing the password itself via `window.PPAuth`.
//
// Honest recovery story, stated plainly in the "Remove password" copy below:
// removing the password normally needs the CURRENT password plus the
// friction delay (`requestRemoval`). If you've genuinely forgotten it, the
// "Forgot it?" link starts the same delay without the password
// (`requestRemovalForgotten`) — it can't skip the wait, only skip proving you
// know a password you don't remember.
function SecurityCard() {
  const available = !!(window.PPNative && window.PPNative.available);
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
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconLock size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Master password</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            {set
              ? 'Set. Turning off a protection — the uninstall guard, the AI monitor, a custom site block, or '
                + 'starting an uninstall request — needs this password before the usual waiting period even starts.'
              : "Not set. Turning off a protection still waits out the usual delay, but anyone at this computer "
                + 'can start that countdown. Add a password to require it first.'}
          </div>

          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}

          {available && set === null &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}

          {available && set !== null && mode === 'idle' &&
            <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => open(set ? 'change' : 'set')}>
                {set ? 'Change password' : 'Set a password'}
              </button>
              {set &&
                <button className="btn btn-ghost btn-sm" onClick={() => open('remove')}>Remove password</button>}
            </div>}

          {(mode === 'set' || mode === 'change') &&
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
              {mode === 'change' &&
                <input type="password" className="input" placeholder="Current password" value={current}
                       onChange={(e) => setCurrent(e.target.value)} />}
              <input type="password" className="input" placeholder="New password (min. 6 characters)" value={pw1}
                     onChange={(e) => setPw1(e.target.value)} />
              <input type="password" className="input" placeholder="Confirm new password" value={pw2}
                     onChange={(e) => setPw2(e.target.value)} />
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
                <button className="btn btn-primary btn-sm"
                        disabled={busy || !pw1 || !pw2 || (mode === 'change' && !current)}
                        onClick={submitSetOrChange}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>}

          {mode === 'remove' &&
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                Requires your current password, then the same waiting period as any other weakening —
                this doesn't skip it, it only starts it.
              </div>
              <input type="password" className="input" placeholder="Current password" value={current}
                     onChange={(e) => setCurrent(e.target.value)} />
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
                <button className="btn btn-danger btn-sm" disabled={busy || !current} onClick={submitRemove}>
                  {busy ? 'Requesting…' : 'Request removal'}
                </button>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={forgotIt}>
                Forgot it?
              </button>
            </div>}

          {msg && mode === 'idle' && <div className="ut-msg" style={{ marginTop: 12 }}>{msg}</div>}
        </div>
      </div>
    </div>
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
  const available = !!(window.PPNative && window.PPNative.available);
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
  // (its friction delay elapsing removes the count from this list), same
  // pattern as `AppBlockingSection`'s pending-count refetch above.
  const pendingCount = (window.usePendingWeakenings || (() => []))().length;
  React.useEffect(() => { refresh(); }, [pendingCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileEmail = (s && s.profile && s.profile.email) || '';
  const useMyEmail = () => setEmail(profileEmail);

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

  const acquireAuth = () => (window.PPAuth ? window.PPAuth.acquire() : Promise.resolve(null));

  const remove = () => {
    if (!confirm('Remove the trusted contact?\n\n'
      + 'This goes through the same waiting-period delay as any other protection change, and they are notified '
      + 'right away that removal was requested — that message can\'t be skipped.')) return;
    setErr(''); setMsg('');
    acquireAuth()
      .then((token) => { setBusy(true); return window.PPNative.requestRemoveTrustedContact(token); })
      .then(() => setMsg('Removal requested — see "Pending changes" below for the countdown.'))
      .catch((e) => { if (e !== 'cancelled' && !(e && e.message === 'cancelled')) setErr(e && e.message ? e.message : String(e)); })
      .finally(() => setBusy(false));
  };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconBell size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Trusted contact</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            Fully optional — Oath Light works completely on its own without this. A parent, sibling, friend, or
            mentor (or just your own email, for a paper trail) gets a short heads-up on a few discrete events: an
            uninstall request, a cancelled lockdown, an extension that goes missing and stays that way, an unusual
            burst of blocks. Never browsing history, never screenshots — only that something happened.
          </div>

          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}

          {available && contact === undefined &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}

          {available && contact &&
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{contact.name || 'Trusted contact'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{contact.email}</div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={remove}>
                Remove
              </button>
            </div>}

          {available && contact === null &&
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
              <input className="input" placeholder="Their name (optional)" value={name}
                     onChange={(e) => setName(e.target.value)} />
              <div className="row" style={{ gap: 8 }}>
                <input type="email" className="input" placeholder="Their email" value={email}
                       onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} />
                {profileEmail &&
                  <button type="button" className="btn btn-ghost btn-sm" onClick={useMyEmail}
                          title="Prefill with your own profile email — notify yourself instead of naming someone else">
                    Use my email
                  </button>}
              </div>
              {err && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
              <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}
                      disabled={busy || !email.trim()} onClick={save}>
                {busy ? 'Saving…' : 'Add trusted contact'}
              </button>
            </div>}

          {msg && <div className="ut-msg" style={{ marginTop: 12 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// --- Pending weakenings (Phase 4 friction, 4.1) ------------------------------

// Every OTHER pending weakening besides uninstall (which has its own
// dedicated card above) — turning off the uninstall guard, stopping the AI
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
      if (p.action_id === 'guard.disable') {
        PP.set({ blocking: { uninstallGuard: true } });
      } else if (p.action_id.indexOf('custom_block.remove:') === 0) {
        const domain = p.action_id.slice('custom_block.remove:'.length);
        const bl = PP.get().blocklist;
        if (!bl.customSites.some((x) => x.url === domain)) {
          PP.put('blocklist', { ...bl, customSites: [...bl.customSites, { id: Date.now(), url: domain, added: 'restored' }] });
        }
      }
    }).finally(() => setBusy(null));
  };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <b style={{ fontSize: 14.5, fontWeight: 800 }}>Pending changes</b>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
        Changes that weaken Oath Light's protection take effect only after a short delay — the same kind of
        friction that applies to uninstalling. Canceling here leaves your protection exactly as it is now.
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pending.map((p) => (
          <div className="setting" key={p.action_id}>
            <div className="txt">
              <b>{p.label}</b>
              <span>{p.ready ? 'Ready to apply any moment now' : ('Applies in ' + fmtDur(p.remaining_secs))}</span>
            </div>
            <button className="btn btn-ghost btn-sm" disabled={busy === p.action_id} onClick={() => cancel(p)}>
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- OTA blocklist updates (Phase 4 item 3.5) --------------------------------

// Settings card for the over-the-air blocklist update channel: which list
// version is installed (or "built-in" when none has ever been), when the last
// check ran and how it went — shown verbatim, including real errors like the
// GitHub release not existing yet — and a "Check now" button. Checking only
// ever strengthens the lists (signed, monotonically-versioned updates), so
// the button is ungated.
function ListsUpdateCard() {
  const available = !!(window.PPNative && window.PPNative.available);
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

  const checkNow = () => {
    window.PPNative.checkListsUpdateNow().then((v) => { if (v) setSt(v); });
  };

  const checking = !!(st && st.checking);
  const version = st
    ? (st.loaded_version ? ('v' + st.loaded_version)
      : (st.installed_version ? ('v' + st.installed_version + ' (not loaded — using built-in)') : 'built-in'))
    : '…';
  const lastCheck = st && st.last_check
    ? new Date(st.last_check * 1000).toLocaleString()
    : 'never';

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconGlobe size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Blocklist updates</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            Oath Light checks weekly for signed blocklist updates and applies them automatically —
            updates can only ever add protection, never silently weaken it. The bundled lists always
            remain as a fallback.
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><span style={{ color: 'var(--muted)' }}>Installed list version:</span> <b>{version}</b></div>
            <div><span style={{ color: 'var(--muted)' }}>Last check:</span> {lastCheck}</div>
            {st && st.last_result &&
              <div style={{ wordBreak: 'break-word' }}>
                <span style={{ color: 'var(--muted)' }}>Result:</span>{' '}
                {st.last_result.indexOf('failed') === 0
                  ? <span style={{ color: '#ef4444' }}>{st.last_result}</span>
                  : st.last_result}
              </div>}
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" disabled={!available || checking} onClick={checkNow}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}
        </div>
      </div>
    </div>
  );
}

// --- Protection history (Phase 4 item 4.5) -----------------------------------

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

// Tamper-evident event log (4.5) — a plain-language recent-activity list plus
// an on-demand "Verify integrity" button that re-walks the WHOLE hash chain
// from genesis, across every rotated segment (`verify_event_log` / see
// core/eventlog.rs). Honesty rule, taken straight from `VerifyReport`'s own
// doc comment: a past break is reported forever, even once the chain resumes
// correctly afterward — this card never hides that behind a "looks fine now".
function ProtectionHistoryCard() {
  const available = !!(window.PPNative && window.PPNative.available);
  const [events, setEvents] = React.useState(null); // null = loading
  const [report, setReport] = React.useState(null);
  const [verifying, setVerifying] = React.useState(false);

  const refresh = React.useCallback(() => {
    if (!available) { setEvents([]); return; }
    window.PPNative.getEventLog(8).then((list) => setEvents(Array.isArray(list) ? list : []));
  }, [available]);

  React.useEffect(() => { refresh(); }, [refresh]);

  const verify = () => {
    setVerifying(true);
    window.PPNative.verifyEventLog().then((r) => { if (r) setReport(r); }).finally(() => setVerifying(false));
  };

  return (
    <div className="card fade-up" style={{ marginTop: 18 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div className="ut-ico"><IconClock size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Protection history</b>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5, maxWidth: '64ch' }}>
            A tamper-evident log of protective events — never browsing history, never screenshots, only that
            something happened. Each entry is cryptographically chained to the one before it, so editing or
            deleting one leaves unmistakable evidence.
          </div>

          {!available &&
            <div className="ut-msg" style={{ color: 'var(--muted)', marginTop: 12 }}>Available in the desktop app.</div>}

          {available && events === null &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}

          {available && events && events.length === 0 &&
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Nothing recorded yet.</div>}

          {available && events && events.length > 0 &&
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
              {events.map((e) => {
                const detail = eventDetail(e);
                return (
                  <div key={e.seq} className="row"
                       style={{ justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: '1px solid var(--glass-brd)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{eventLabel(e.kind)}</div>
                      {detail && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{fmtAgo(e.ts)}</div>
                  </div>
                );
              })}
            </div>}

          {available &&
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-sm" disabled={verifying} onClick={verify}>
                {verifying ? 'Verifying…' : 'Verify integrity'}
              </button>
            </div>}

          {report &&
            <div className="ut-msg" style={{ marginTop: 12, color: report.intact ? 'var(--accent-2)' : '#ef4444' }}>
              {report.intact
                ? <React.Fragment>
                    <IconCheck size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                    Intact — {report.entries} event{report.entries === 1 ? '' : 's'} verified back to the start.
                  </React.Fragment>
                : <React.Fragment>
                    Tampering detected — the chain does not verify.{' '}
                    {report.first_break_seq != null && ('Break at entry #' + report.first_break_seq + '. ')}
                    {report.restarts > 0 && (report.restarts + (report.restarts === 1 ? ' restart' : ' restarts') + ' recorded. ')}
                    {report.entries} event{report.entries === 1 ? '' : 's'} currently valid.
                  </React.Fragment>}
            </div>}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ s, PP }) {
  const p = s.profile;
  const setP = (patch) => PP.set({ profile: patch });
  const [editing, setEditing] = React.useState(false);

  // The real reminders — same array the Blocking page edits (shared store
  // state), toggled the same way as pages-blocking.jsx's toggleAlert.
  const b = s.blocking;
  const toggleAlert = (id) => PP.set({ blocking: { alerts: b.alerts.map((x) => x.id === id ? { ...x, on: !x.on } : x) } });

  // Not built yet — an honest disabled row beats a toggle that does nothing.
  const COMING_NOTIFS = [
    { icon: IconSun, t: 'Daily intention', d: 'A gentle morning message to set the tone.' },
    { icon: IconFlame, t: 'Milestone celebrations', d: 'Cheer you on at 7, 30, 90 days and beyond.' },
    { icon: IconArrowUp, t: 'Weekly progress recap', d: 'A short summary of your week every Sunday.' },
  ];

  return (
    <div className="page">
      <div className="page-head fade-up">
        <div className="eyebrow">Account</div>
        <h1 className="page-title">User <em>settings</em></h1>
        <p className="page-sub">Your profile, accountability and notifications. You're in full control of everything here.</p>
      </div>

      {/* profile */}
      <div className="card fade-up" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <div className="avatar" style={{ width: 64, height: 64, flex: '0 0 64px', fontSize: 22 }}>{p.name.split(' ').map((x) => x[0]).join('')}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>{p.name}</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>{p.email}</div>
          {p.tz && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <span className="chip">{p.tz}</span>
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit profile'}</button>
      </div>

      {/* fields — shown only while editing; they already persist live to the store */}
      {editing &&
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Profile details</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
          <label className="field"><span>Display name</span><input className="input" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></label>
          <label className="field"><span>Email</span><input className="input" value={p.email} onChange={(e) => setP({ email: e.target.value })} /></label>
        </div>
      </div>
      }

      {/* notifications */}
      <div className="card fade-up" style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Notifications</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          These are the real check-in reminders — they show up in the browser during your vulnerable hours (set on the Blocking Settings page).
        </div>
        {b.alerts.map((a) => (
          <div className="setting" key={a.id}>
            <div className="ico"><IconBell size={20} /></div>
            <div className="txt"><b>{a.label}</b><span>{a.desc}</span></div>
            <Switch on={a.on} onClick={() => toggleAlert(a.id)} />
          </div>
        ))}

        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)', margin: '22px 0 4px' }}>
          Coming soon
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>
          Not built yet — shown honestly here instead of a switch that would quietly do nothing.
        </div>
        {COMING_NOTIFS.map((n) => (
          <div className="setting" key={n.t}>
            <div className="ico"><n.icon size={20} /></div>
            <div className="txt"><b>{n.t}</b><span>{n.d}</span></div>
            <div className="row" style={{ gap: 10 }}>
              <span className="chip">Coming in Alpha</span>
              <Switch on={false} disabled />
            </div>
          </div>
        ))}
      </div>

      {/* danger / reset */}
      <div className="card fade-up" style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="txt" style={{ flex: 1 }}>
          <b style={{ fontSize: 14.5, fontWeight: 800 }}>Reset app data</b>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Restore Oath Light to its default state.</div>
        </div>
        <button className="btn btn-ghost" onClick={() => { if (confirm('Reset all app data?')) PP.reset(); }}>Reset</button>
      </div>

      {/* trusted contact (5.2, Tier 2) — optional accountability amplifier */}
      <TrustedContactCard s={s} />

      {/* master password (4.2) — gates every weakening request below */}
      <SecurityCard />

      {/* blocklist OTA updates (3.5) — signed, monotonic, strengthening-only */}
      <ListsUpdateCard />

      {/* tamper-evident event log (4.5) — plain-language history + on-demand verify */}
      <ProtectionHistoryCard />

      {/* pending weakenings (4.1) — guard/monitor disables, custom-block removals, trusted-contact removal, lockdown cancel/escalation */}
      <PendingChangesCard PP={PP} />

      {/* uninstall — 24-hour friction request */}
      <UninstallCard />
    </div>
  );
}
window.SettingsPage = SettingsPage;
