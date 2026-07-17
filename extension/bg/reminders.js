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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMINDER_ALARM) maybeShowReminder();
});

chrome.runtime.onInstalled.addListener(armReminderAlarm);
chrome.runtime.onStartup.addListener(armReminderAlarm);
armReminderAlarm();