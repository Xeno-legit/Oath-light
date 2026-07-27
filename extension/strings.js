/*!
 * Oath Light — strings.js
 * ------------------------------------------------------------------------
 * Single, dependency-free strings/voice layer shared by every surface:
 * the MV3 extension (service worker via importScripts + extension pages),
 * the Tauri desktop renderer, and the static website.
 *
 * HARD CONSTRAINTS — do not violate these when editing this file:
 *   - No `window`, `document`, `chrome.*`, `localStorage`, or any other
 *     DOM/host API at load time. A service worker has none of these.
 *   - No `import`/`export` statements (must load via plain <script src>
 *     AND via `importScripts()` in a worker).
 *   - No build step, no dependencies.
 *   - Persistence of the chosen voice is the CALLER's job. This module
 *     only holds state in memory for the lifetime of the page/worker.
 *
 * See VOICE.md (same directory) for the voice registers, key-naming
 * conventions, and the hard content rules every string here must follow.
 * ------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  // key -> { companion: '...', serious: '...' }
  // Dot-namespaced keys. Keep both voices present for every key — t()
  // falls back companion -> key, but a missing serious string means
  // serious mode silently reverts to the soft voice, which defeats the
  // point of serious mode. Namespaces below mirror VOICE.md.
  var STRINGS = {

    /* ---------------------------------------------------------------
     * app.* — hub greeting / hero / welcome
     * --------------------------------------------------------------- */
    'app.greeting_morning': { companion: 'Good morning, {name}', serious: 'Morning, {name}.' },
    'app.greeting_afternoon': { companion: 'Good afternoon, {name}', serious: 'Afternoon, {name}.' },
    'app.greeting_evening': { companion: 'Good evening, {name}', serious: 'Evening, {name}.' },
    'app.welcome_title': { companion: 'Welcome back.', serious: 'Report in.' },
    'app.welcome_sub': {
      companion: "You're on a {days}-day streak. Every clear choice is a vote for the person you're becoming.",
      serious: '{days} days in. Hold the line. That is the whole job today.',
    },
    'app.streak_line': { companion: 'Day {days}', serious: 'Day {days}. Keep going.' },
    'app.cta_see_progress': { companion: 'See my progress', serious: 'Show the numbers' },
    'app.cta_talk_it_through': { companion: 'Talk it through', serious: 'Get a plan' },

    /* ---------------------------------------------------------------
     * blocked.* — extension blocked page
     * (blocked.headline / blocked.body / blocked.cta_leave are load-bearing
     * exact keys — preview.html depends on them.)
     * --------------------------------------------------------------- */
    'blocked.status_pill': { companion: 'Protection Active', serious: 'Protection Active' },
    'blocked.headline': { companion: 'Take a deep breath', serious: 'Stand down.' },
    'blocked.body': {
      companion: 'This page was blocked to help you stay focused on your goals.',
      serious: 'This page is blocked. That was the plan. Stick to it.',
    },
    'blocked.message': {
      companion: "You're making progress. Every time you see this page, you're choosing growth over impulse.",
      serious: 'Every block is a rep. You are getting stronger whether it feels like it or not.',
    },
    'blocked.cta_leave': { companion: 'Return to Safety', serious: 'Back to safety. Now.' },
    'blocked.cta_panic': { companion: 'I need help right now', serious: 'I need help right now' },
    'blocked.stat_blocked_label': { companion: 'Sites Blocked', serious: 'Sites Blocked' },
    'blocked.stat_days_label': { companion: 'Days Protected', serious: 'Days Protected' },
    'blocked.reason_lockdown': {
      companion: 'Lockdown is on — only your allowlist is reachable right now.',
      serious: 'Lockdown is on. Only your allowlist is reachable. That was your call.',
    },

    /* ---------------------------------------------------------------
     * popup.* — extension popup
     * --------------------------------------------------------------- */
    'popup.protection_on': { companion: 'Protection On', serious: 'Protection On' },
    'popup.protection_sub': { companion: 'Actively filtering this browser', serious: 'Actively filtering this browser' },
    'popup.block_input_placeholder': { companion: 'Enter URL to block', serious: 'Add a site to shut down' },
    'popup.block_button': { companion: 'Block', serious: 'Block' },
    'popup.block_success': { companion: 'Blocked "{domain}".', serious: '"{domain}" is done. Blocked.' },
    'popup.block_error_invalid': {
      companion: 'Enter a valid domain (e.g. example.com)',
      serious: 'Not a valid domain. Try example.com.',
    },
    'popup.block_error_duplicate': { companion: 'Already in your blocklist.', serious: 'Already blocked. Good.' },
    'popup.block_error_default': { companion: 'Already blocked by default.', serious: 'Already covered by default.' },
    'popup.block_error_generic': { companion: 'Could not save. Try again.', serious: "Didn't save. Try again." },
    'popup.stat_blocked_label': { companion: 'Sites Blocked', serious: 'Sites Blocked' },
    'popup.stat_streak_label': { companion: 'Day Streak', serious: 'Day Streak' },
    'popup.open_manager': { companion: 'My Blocklist', serious: 'My Blocklist' },
    'popup.footer_synced': { companion: 'Synced', serious: 'Synced' },

    /* ---------------------------------------------------------------
     * status.* — honest, actionable status. Status yes, map no: these
     * strings never explain WHY or WHAT a layer defends against.
     * (status.protected / status.ext_missing are load-bearing exact keys.)
     * --------------------------------------------------------------- */
    'status.protected': { companion: 'Protection active', serious: 'Protection active' },
    'status.ext_missing': { companion: 'Extension missing — fix', serious: 'Extension missing. Fix this now.' },
    'status.ext_partial': { companion: 'Partially protected — fix', serious: 'Partial coverage. Fix this now.' },
    'status.connecting': { companion: 'Connecting…', serious: 'Connecting…' },
    'status.not_installed': { companion: 'Not installed', serious: 'Not installed' },
    'status.browser_protection_title': { companion: 'Browser protection', serious: 'Browser protection' },
    'status.browsers_protected_count': { companion: '{protected}/{total} protected', serious: '{protected}/{total} protected' },

    /* ---------------------------------------------------------------
     * friction.* — pending-change / cool-off copy
     * (friction.pending_label / friction.keep are load-bearing exact keys.)
     * --------------------------------------------------------------- */
    'friction.pending_label': { companion: 'Pending change', serious: 'Pending change' },
    'friction.request_submitted': {
      companion: "Request submitted. Protection stays fully on while you wait.",
      serious: 'Request logged. Protection stays fully on until the clock runs out.',
    },
    'friction.time_remaining_hm': {
      companion: '{hours}h {minutes}m remaining — protection active',
      serious: '{hours}h {minutes}m left. Still active. Still on.',
    },
    'friction.time_remaining_m': {
      companion: '{minutes}m remaining — protection active',
      serious: '{minutes}m left. Still active. Still on.',
    },
    'friction.cancel_request': { companion: 'Cancel request', serious: 'Stand down the request' },
    'friction.keep': { companion: 'Keep protection on', serious: 'Keep protection on' },
    'friction.ready_prompt': {
      companion: 'The waiting period is over. What would you like to do?',
      serious: 'Wait is over. Decide, now.',
    },

    /* ---------------------------------------------------------------
     * lockdown.* — lockdown active / frozen / cancel-request
     * --------------------------------------------------------------- */
    'lockdown.start_button': { companion: 'Start lockdown', serious: 'Start lockdown' },
    'lockdown.active_label': { companion: 'Lockdown active', serious: 'Lockdown active' },
    'lockdown.remaining_note': { companion: 'remaining · lockdown active', serious: 'remaining. Locked. Stay put.' },
    'lockdown.frozen_label': { companion: 'Frozen — cannot be cancelled, only waited out', serious: 'Frozen. No cancel. Ride it out.' },
    'lockdown.frozen_note': {
      companion: 'This one is frozen — there is genuinely no way to cancel it. That was the point when it started.',
      serious: 'You froze it on purpose. There is no way out early. Good. That was the plan.',
    },
    // A non-frozen lockdown's own cancel-request reuses friction.cancel_request/friction.keep — same
    // action, same friction pattern, one string instead of a near-duplicate.
    'lockdown.end_early': { companion: 'End lockdown early', serious: 'End lockdown early' },
    'lockdown.keep_locked': { companion: 'Keep it locked', serious: 'Keep it locked' },

    /* ---------------------------------------------------------------
     * panic.* — SOS / panic flow. BOTH voices stay supportive and
     * de-escalating here; serious only gets firmer, never harsher.
     * --------------------------------------------------------------- */
    'panic.entry_cta': { companion: 'I need help right now', serious: 'I need help right now' },
    'panic.eyebrow_safe': { companion: "You're safe here", serious: "You're safe here" },
    'panic.breathe_title': { companion: "Let's breathe first.", serious: 'Breathe. First.' },
    'panic.breathe_sub': {
      companion: 'In for four, hold for four, out for four, hold for four. Nothing to fix right now — just follow the circle.',
      serious: 'In for four, hold for four, out for four, hold for four. Follow the circle. Nothing else to do right now.',
    },
    'panic.wave_title': { companion: 'This will pass.', serious: 'This will pass.' },
    'panic.wave_body': {
      companion: "The urge feels huge, but it's a wave — it peaks around 20 minutes and then it fades whether you feed it or not. You don't have to fight it. Just let it move through. I'm right here.",
      serious: "The urge is a wave. It peaks in about 20 minutes and fades either way. You don't have to fight it — just outlast it. Stay with me.",
    },
    'panic.wave_cta': { companion: "I'm still here", serious: "Still here." },
    'panic.ground_title': { companion: 'Come back to the room.', serious: 'Come back to the room.' },
    'panic.ground_cta': { companion: 'Done — next', serious: 'Done. Next.' },
    'panic.exit_title': { companion: 'Well done. Truly.', serious: 'You held. Good.' },
    'panic.exit_body': {
      companion: "The urge is already weaker than when you arrived. Choose where to go next — somewhere that feeds the person you're becoming.",
      serious: "The urge is weaker now than when you started. Choose what's next — make it count.",
    },
    'panic.exit_cta_redirect': { companion: 'Take me somewhere good', serious: 'Take me somewhere good' },
    'panic.exit_cta_home': { companion: 'Back to Oath Light', serious: 'Back to Oath Light' },

    /* ---------------------------------------------------------------
     * streak.* — day counter, milestones, slip/relapse logging.
     * Companion keeps the current compassionate register; serious is
     * hard but forward-pointing, never cruel.
     * --------------------------------------------------------------- */
    'streak.day_count': { companion: '{days} days clean', serious: '{days} days. Keep it.' },
    'streak.best_streak_label': { companion: 'Best streak', serious: 'Best streak' },
    'streak.milestone_banner': {
      companion: "{days} days clean — that's a real milestone.",
      serious: '{days} days down. Earned, not given.',
    },
    'streak.milestone_sub': {
      companion: 'Every one of those days was a choice. Well earned.',
      serious: 'Every one of those days was a choice you made on purpose. Next one starts now.',
    },
    'streak.slip_button': { companion: 'I had a slip', serious: 'Log a slip' },
    'streak.slip_confirm_title': { companion: 'This stays between us', serious: 'Log it straight.' },
    'streak.slip_confirm_body': {
      companion: "A slip is not a collapse — it's a single moment, not your identity. Logging it honestly is part of recovery, not a failure report. Your best streak and everything you've already learned stay exactly as they are.",
      serious: "A slip is one moment, not a verdict. Log it straight, no spin. Your best streak stays on the board. Get up.",
    },
    'streak.slip_logged_title': { companion: "Okay. You're still here.", serious: 'Logged. Back in the fight.' },
    'streak.slip_logged_body': {
      companion: "Gentle mode is on for the next 24 hours. Your streak resets, but your best streak and this month's progress don't disappear. What would help right now?",
      serious: 'Streak resets. Best streak does not move. Pick the next step and take it.',
    },
    'streak.gentle_title': { companion: 'Be gentle', serious: 'Get up.' },
    'streak.gentle_sub': { companion: 'with yourself today', serious: 'Back in the fight. Today.' },

    /* ---------------------------------------------------------------
     * notify.* — trusted-contact email subjects/bodies. Vague about the
     * "what" on purpose (event kind + name only) — no browsing detail,
     * ever, in either voice. {name} interpolates the protected person.
     * --------------------------------------------------------------- */
    'notify.uninstall_requested_subject': {
      companion: "Oath Light: an uninstall was requested on {name}'s computer",
      serious: "Oath Light: uninstall requested on {name}'s computer",
    },
    'notify.uninstall_requested_body': {
      companion: "There's a waiting period before it can complete, and it can still be cancelled. This is just a heads-up so you can check in.",
      serious: 'A waiting period is running before it can complete. It can still be cancelled. Worth a check-in.',
    },
    'notify.lockdown_cancelled_subject': {
      companion: "Oath Light: a lockdown was cancelled early on {name}'s computer",
      serious: "Oath Light: lockdown cancelled early on {name}'s computer",
    },
    'notify.lockdown_cancelled_body': {
      companion: "Oath Light's lockdown mode was ended before its timer ran out. Nothing about what was browsed is shared — only that it happened.",
      serious: 'Lockdown ended before the timer ran out. Nothing about what was browsed is shared — only that it happened.',
    },
    'notify.serious_disable_requested_subject': {
      companion: "Oath Light: turning off Serious Mode was requested on {name}'s computer",
      serious: "Oath Light: Serious Mode disable requested on {name}'s computer",
    },
    'notify.serious_disable_requested_body': {
      companion: "There's a waiting period before Serious Mode can turn off, and it stays fully active the whole time. This is just a heads-up so you can check in.",
      serious: 'A waiting period is running before Serious Mode can turn off. It stays fully active until then. Worth a check-in.',
    },

    /* ---------------------------------------------------------------
     * serious.* — Serious Mode itself: enable confirm, active label,
     * disable-request warning. Disabling files a 24-48h pending change
     * during which the mode stays fully active.
     * --------------------------------------------------------------- */
    'serious.enable_confirm': {
      companion: 'Turn on Serious Mode? This switches everything to the strictest settings and the harder voice, everywhere.',
      serious: 'Turn on Serious Mode. Strictest settings, hard voice, everywhere. One click. No half measures.',
    },
    'serious.enable_button': { companion: 'Turn on Serious Mode', serious: 'Turn on Serious Mode' },
    'serious.active_label': { companion: 'Serious Mode is on', serious: 'Serious Mode: ON' },
    'serious.active_sub': {
      companion: 'The strictest settings and the hard voice are active everywhere.',
      serious: 'Strictest settings. Hard voice. Everywhere. No exceptions.',
    },
    'serious.disable_request_warning': {
      companion: "Turning this off starts a waiting period — Serious Mode stays fully on the whole time, and your trusted contact is notified if you've set one.",
      serious: 'Turning this off starts a waiting period. It stays fully on until the wait ends. Your trusted contact is told, if you set one. That was the deal.',
    },
    'serious.disable_request_button': { companion: 'Request to turn off', serious: 'Request to turn off' },
    'serious.disable_pending': {
      companion: 'Turning off in {hours}h {minutes}m — Serious Mode stays on until then.',
      serious: 'Off in {hours}h {minutes}m. Still on until then. No shortcuts.',
    },

    /* ---------------------------------------------------------------
     * onboarding.* — the voice choice itself
     * --------------------------------------------------------------- */
    'onboarding.voice_title': { companion: 'Choose how Oath Light talks to you', serious: 'Choose how Oath Light talks to you' },
    'onboarding.voice_sub': {
      companion: 'Pick a voice. You can change it any time, unless Serious Mode is on.',
      serious: 'Pick a voice. You can change it later — unless Serious Mode overrides it.',
    },
    'onboarding.companion_name': { companion: 'Companion', serious: 'Companion' },
    'onboarding.companion_desc': {
      companion: 'Warm, steady, and plain-spoken. Someone in your corner.',
      serious: 'Warm and steady. Someone in your corner.',
    },
    'onboarding.serious_name': { companion: 'Drill Sergeant', serious: 'Drill Sergeant' },
    'onboarding.serious_desc': {
      companion: 'Short, direct, no cushioning. A hard coach who is completely on your side.',
      serious: 'Short. Direct. No cushioning. A hard coach, fully on your side.',
    },
  };

  /* ---------------------------------------------------------------
   * Interpolation: replaces {token} with params[token]. Leaves the
   * placeholder untouched if the param is missing, so a bad call is
   * visible instead of silently corrupting the sentence.
   * --------------------------------------------------------------- */
  function interpolate(str, params) {
    if (!params || typeof str !== 'string') return str;
    return str.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, token) {
      return Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : match;
    });
  }

  var OL_STRINGS = {
    version: 1,
    voices: ['companion', 'serious'],
    defaultVoice: 'companion',
    activeVoice: 'companion',
    seriousMode: false,
    strings: STRINGS,

    // Ignores unknown voices — callers can pass anything without a guard.
    setVoice: function (v) {
      try {
        if (this.voices.indexOf(v) !== -1) this.activeVoice = v;
      } catch (e) { /* never throw */ }
    },

    setSeriousMode: function (bool) {
      try {
        this.seriousMode = !!bool;
      } catch (e) { /* never throw */ }
    },

    // Returns the active-voice string for `key`, interpolating {params}.
    // Serious mode ALWAYS wins regardless of activeVoice. Falls back
    // companion -> the key itself. Never throws.
    t: function (key, params) {
      try {
        var entry = this.strings && this.strings[key];
        if (!entry) return key;
        var voice = this.seriousMode ? 'serious' : this.activeVoice;
        var str = entry[voice];
        if (str == null) str = entry.companion;
        if (str == null) return key;
        return interpolate(str, params);
      } catch (e) {
        return key;
      }
    },
  };

  root.OL_STRINGS = OL_STRINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
