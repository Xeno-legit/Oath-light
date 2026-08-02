// bg/vulnerable-window.js — evaluate the desktop app's "vulnerable hours"
// window in LOCAL time, and top up a lockdown while it is open.
//
// Formerly bg/reminders.js. The in-page reminder pop-ups this file was named
// for are gone: reminders now fire from the desktop app itself (see
// src-tauri/src/reminder.rs), which is where a nudge belongs — it reaches the
// user whether or not a browser is open, and it stops the extension needing
// tabs.sendMessage into whatever page happens to be in front.
//
// What stayed is the half that genuinely cannot live on the desktop side:
// LOCKDOWN SCHEDULE-FROM-VULNERABLE-HOURS (plan 4.4 v2, opt-in, off by
// default). The desktop app has no timezone database, so it cannot tell on its
// own when a "22:00 → 06:00" window is open. This extension can — it runs in
// the browser's local-time context — so while the desktop-owned
// `escalate_vulnerable_hours` setting is on, this alarm periodically tells the
// desktop "the window is active, N minutes remain" (see `maybeEscalateLockdown`)
// and the desktop tops up a lockdown to match. `lockdown.start` is monotonic,
// so a redundant message is a harmless no-op, not a bug. Only armed while the
// setting is actually on (see `reconcileLockdownEscalationAlarm`), so a user who
// never opts in pays nothing extra.

const LOCKDOWN_ESCALATION_ALARM = 'pp-lockdown-escalation';
const LOCKDOWN_ESCALATION_PERIOD_MIN = 2;

// Is the current local time inside [start, end)? Handles overnight windows
// (e.g. 22:00 → 06:00) and a full-day window (start === end).
function isWithinWindow(start, end) {
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
    return m ? (Math.min(23, +m[1]) * 60 + Math.min(59, +m[2])) : null;
  };
  const a = toMin(start), z = toMin(end);
  if (a == null || z == null) return false;
  if (a === z) return true;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return a < z ? (cur >= a && cur < z) : (cur >= a || cur < z);
}

// Minutes remaining until [start, end)'s local-time END, given we're
// currently inside it (0 if the parse fails or we're not actually inside —
// callers already check `isWithinWindow` first, so this is a safety
// fallback, not the primary gate). Mirrors `isWithinWindow`'s own window math
// so the two never disagree about what "inside" means.
function minutesUntilWindowEnd(start, end) {
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
    return m ? (Math.min(23, +m[1]) * 60 + Math.min(59, +m[2])) : null;
  };
  const a = toMin(start), z = toMin(end);
  if (a == null || z == null) return 0;
  if (a === z) return 24 * 60; // full-day window — no real "end" to count down to
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (a < z) return (cur >= a && cur < z) ? (z - cur) : 0;
  // Overnight window (a > z): active from `a` through midnight, or from
  // midnight through `z`.
  if (cur >= a) return (24 * 60 - cur) + z;
  if (cur < z) return z - cur;
  return 0;
}

// Ensure the lockdown-escalation alarm exists (idempotent — never resets a
// live timer).
async function armLockdownEscalationAlarm() {
  try {
    const existing = await chrome.alarms.get(LOCKDOWN_ESCALATION_ALARM);
    if (existing && existing.periodInMinutes === LOCKDOWN_ESCALATION_PERIOD_MIN) return;
    chrome.alarms.create(LOCKDOWN_ESCALATION_ALARM, {
      periodInMinutes: LOCKDOWN_ESCALATION_PERIOD_MIN,
      delayInMinutes: LOCKDOWN_ESCALATION_PERIOD_MIN,
    });
  } catch (_) {}
}

async function disarmLockdownEscalationAlarm() {
  try { await chrome.alarms.clear(LOCKDOWN_ESCALATION_ALARM); } catch (_) {}
}

// If the desktop-owned setting is on, tell it about a currently-active
// vulnerable-hours window right now (not just on the next alarm tick) — so
// turning the setting on WHILE already inside the window doesn't have to
// wait up to `LOCKDOWN_ESCALATION_PERIOD_MIN` minutes for the first top-up.
async function maybeEscalateLockdown() {
  if (!blockingSettings) await loadBlockingSettings();
  const b = blockingSettings;
  if (!b) return;
  const ld = b.lockdown || {};
  if (!ld.escalate_vulnerable_hours) return;
  const v = b.vulnerable || {};
  if (!v.on || !isWithinWindow(v.start, v.end)) return;
  const remainingMin = minutesUntilWindowEnd(v.start, v.end);
  if (remainingMin <= 0) return;
  if (typeof NativeMessagingBridge !== 'undefined' && NativeMessagingBridge.sendVulnerableWindowActive) {
    NativeMessagingBridge.sendVulnerableWindowActive(remainingMin);
  }
}

// Arm/disarm the escalation alarm to match the desktop-pushed setting, and
// immediately check once — called whenever fresh blocking settings arrive
// (see `native-bridge.js`'s `handleSetBlocking`), so a toggle takes effect
// without waiting for a service-worker restart.
async function reconcileLockdownEscalationAlarm() {
  if (!blockingSettings) await loadBlockingSettings();
  const ld = (blockingSettings && blockingSettings.lockdown) || {};
  if (ld.escalate_vulnerable_hours) {
    await armLockdownEscalationAlarm();
    maybeEscalateLockdown();
  } else {
    await disarmLockdownEscalationAlarm();
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCKDOWN_ESCALATION_ALARM) maybeEscalateLockdown();
});

chrome.runtime.onInstalled.addListener(reconcileLockdownEscalationAlarm);
chrome.runtime.onStartup.addListener(reconcileLockdownEscalationAlarm);
