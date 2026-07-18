// bg/reminders.js — Focus-schedule reminder pop-ups. Fires a gentle in-page
// nudge (via content.js) during the desktop app's configured "vulnerable
// hours" window, driven by a persistent chrome.alarms alarm so it survives
// MV3 service-worker sleep. Relocated verbatim from the original
// background.js monolith — no logic changes.

// REMINDER POP-UPS — Focus-schedule nudges
// During the desktop app's "Vulnerable hours" window, fire a gentle in-page
// pop-up (rendered by content.js) for whichever reminder types are enabled.
// A single persistent alarm drives this — it survives the MV3 service worker
// sleeping and wakes it to fire. The schedule (window + which alerts) is
// evaluated at fire time from the cached settings, so the alarm itself never
// needs rebuilding when settings change.

const REMINDER_ALARM = 'pp-reminder';
const REMINDER_PERIOD_MIN = 30; // roughly twice an hour while inside the window

// LOCKDOWN SCHEDULE-FROM-VULNERABLE-HOURS (plan 4.4 v2, opt-in, off by
// default) — a second, independent alarm from the reminder one above: the
// desktop app has no timezone database, so it can't tell on its own when the
// vulnerable-hours window opens/closes. This extension already evaluates
// that window in local time for the reminder pop-ups (`isWithinWindow`), so
// while the desktop-owned `escalate_vulnerable_hours` setting is on, this
// alarm periodically tells the desktop "the window is active, N minutes
// remain" — see `maybeEscalateLockdown` — and the desktop tops up a lockdown
// to match (`lockdown.start` is monotonic, so a redundant message is a
// harmless no-op, not a bug). Only armed while the setting is actually on
// (see `reconcileLockdownEscalationAlarm`), so a user who never opts in pays
// nothing extra.
const LOCKDOWN_ESCALATION_ALARM = 'pp-lockdown-escalation';
const LOCKDOWN_ESCALATION_PERIOD_MIN = 2;

// A small rotating pool for the "Motivational reminder" type.
const REMINDER_QUOTES = [
  'The man who moves a mountain begins by carrying away small stones.',
  'You are not your urges. You are the one who notices them — and chooses.',
  'Discipline is choosing between what you want now and what you want most.',
  'Every time you say no, the next no gets easier. You are rewiring yourself.',
  'The urge always passes. Outlast it — ride the wave, don’t feed it.',
  'Who you become is built from the moments you refuse to give in.',
  'Fall seven times, stand up eight. The streak is the man, not the number.',
  'Close the tab. Take a walk. Future-you is already grateful.',
];

function buildReminder(kind) {
  if (kind === 'checkin') {
    return {
      title: 'Still with you',
      body: 'Take a slow breath. You’re stronger than this moment — it will pass.',
    };
  }
  // 'quote' (and any future text type) → a short line.
  const q = REMINDER_QUOTES[Math.floor(Math.random() * REMINDER_QUOTES.length)];
  return { title: 'Remember your why', body: q };
}

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

// Ensure the reminder alarm exists (idempotent — never resets a live timer).
async function armReminderAlarm() {
  try {
    const existing = await chrome.alarms.get(REMINDER_ALARM);
    if (existing && existing.periodInMinutes === REMINDER_PERIOD_MIN) return;
    chrome.alarms.create(REMINDER_ALARM, {
      periodInMinutes: REMINDER_PERIOD_MIN,
      delayInMinutes: REMINDER_PERIOD_MIN,
    });
  } catch (_) {}
}

async function maybeShowReminder() {
  if (!blockingSettings) await loadBlockingSettings();
  const b = blockingSettings;
  if (!b) return;
  const v = b.vulnerable || {};
  if (!v.on || !isWithinWindow(v.start, v.end)) return;
  const enabled = Array.isArray(b.alerts) ? b.alerts.filter((a) => a && a.on) : [];
  if (!enabled.length) return;

  const pick = enabled[Math.floor(Math.random() * enabled.length)];
  const content = buildReminder(pick.id);

  // Show on whatever tab the user is currently looking at.
  let tabs = [];
  try { tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (_) {}
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null || isIgnoredUrl(tab.url || '')) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'showReminder', kind: pick.id, title: content.title, body: content.body,
    });
  } catch (_) {
    // No content script in this tab yet (or a page we don't run on) — skip silently.
  }
}

// Ensure the lockdown-escalation alarm exists (idempotent, same shape as
// `armReminderAlarm`).
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
  if (alarm.name === REMINDER_ALARM) maybeShowReminder();
  else if (alarm.name === LOCKDOWN_ESCALATION_ALARM) maybeEscalateLockdown();
});

chrome.runtime.onInstalled.addListener(armReminderAlarm);
chrome.runtime.onStartup.addListener(armReminderAlarm);
chrome.runtime.onInstalled.addListener(reconcileLockdownEscalationAlarm);
chrome.runtime.onStartup.addListener(reconcileLockdownEscalationAlarm);
armReminderAlarm();