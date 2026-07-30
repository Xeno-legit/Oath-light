/*!
 * Oath Light — strings.js
 * ------------------------------------------------------------------------
 * Single, dependency-free strings/voice/locale layer shared by every
 * surface: the MV3 extension (service worker via importScripts +
 * extension pages), the Tauri desktop renderer, and the static website.
 *
 * A string is addressed by three things: key, locale, voice. English is
 * the base table below and the fallback for every other locale; other
 * locales register themselves from `locales/<code>.js`. See the Locales
 * block further down for why they load as plain scripts.
 *
 * HARD CONSTRAINTS — do not violate these when editing this file:
 *   - No `window`, `document`, `chrome.*`, `localStorage`, or any other
 *     DOM/host API at load time. A service worker has none of these.
 *   - No `import`/`export` statements (must load via plain <script src>
 *     AND via `importScripts()` in a worker).
 *   - No build step, no dependencies.
 *   - Persistence of the chosen voice AND locale is the CALLER's job.
 *     This module only holds state in memory for the lifetime of the
 *     page/worker. See voice-sync.js for how each surface rehydrates.
 *   - Never throw. Every public method swallows its own errors and
 *     degrades (to English, to the key, to 'ltr'). A malformed locale
 *     file must not be able to kill the service worker that imports it.
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
    'app.welcome_title': { companion: 'Welcome back.', serious: 'Hello.' },
    'app.welcome_sub': {
      companion: "You're on a {days}-day streak. Every clear choice is a vote for the person you're becoming.",
      serious: '{days} days in. Hold the line. That is the whole job today.',
    },
    'app.streak_line': { companion: 'Day {days}, Keep going.', serious: 'Day {days}.' },
    'app.cta_see_progress': { companion: 'See my progress', serious: 'Show the numbers' },
    'app.cta_talk_it_through': { companion: 'Talk it through', serious: 'Get a plan' },

    // Shared micro-copy: bare verbs and states reused across surfaces. These
    // genuinely read the same in both registers — a button that says "Add" has
    // no warm version and no hard version — but they live here anyway so a
    // surface never has to reach outside the catalog for a word, and so a
    // translator gets them once instead of once per page.
    'app.action_add': { companion: 'Add', serious: 'Add' },
    'app.action_remove': { companion: 'Remove', serious: 'Remove' },
    'app.action_close': { companion: 'Close', serious: 'Close' },
    'app.action_cancel': { companion: 'Cancel', serious: 'Cancel' },
    'app.action_back': { companion: 'Back', serious: 'Back' },
    'app.action_continue': { companion: 'Continue', serious: 'Continue' },
    'app.action_test': { companion: 'Test ↗', serious: 'Test ↗' },
    'app.action_skip': { companion: 'Skip', serious: 'Skip' },
    'app.state_on': { companion: 'On', serious: 'On' },
    'app.state_off': { companion: 'Off', serious: 'Off' },
    'app.loading': { companion: 'Loading…', serious: 'Loading…' },
    'app.needs_desktop': { companion: 'Available in the desktop app.', serious: 'Desktop app only.' },

    /* ---------------------------------------------------------------
     * blocked.* — extension blocked page
     * (blocked.headline / blocked.body / blocked.cta_leave are load-bearing
     * exact keys — preview.html depends on them.)
     * --------------------------------------------------------------- */
    'blocked.status_pill': { companion: 'Protection Active', serious: 'Protection Active' },
    'blocked.headline': { companion: 'Take a deep breath', serious: 'Stand down.' },
    'blocked.body': {
      companion: 'This page was blocked to help you stay focused on your goals.',
      serious: 'Blocked. Got an Issue?',
    },
    'blocked.message': {
      companion: "You're making progress. Every time you see this page, you're choosing growth over impulse.",
      serious: 'You are making progress.',
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
    'popup.block_input_placeholder': { companion: 'Enter URL to block', serious: 'Add a site.' },
    'popup.block_button': { companion: 'Block', serious: 'Block' },
    'popup.block_success': { companion: 'Blocked "{domain}".', serious: '"{domain}" is Blocked.' },
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
    'status.ext_missing': { companion: 'Extension missing — fix', serious: 'Extension missing. Fix.' },
    'status.ext_partial': { companion: 'Partially protected — fix', serious: 'Partial coverage. Fix.' },
    'status.connecting': { companion: 'Connecting…', serious: 'Connecting…' },
    'status.not_installed': { companion: 'Not installed', serious: 'Not installed' },
    'status.browser_protection_title': { companion: 'Browser protection', serious: 'Browser protection' },
    'status.browsers_protected_count': { companion: '{protected}/{total} protected', serious: '{protected}/{total} protected' },

    // Per-browser row states. Flat states only — WHY a browser is in one of
    // them, and what could be done about it at the mechanism level, stays out
    // of the catalog on purpose (see VOICE.md, "status yes, map no"). Both
    // voices are identical here: a state is a fact, and a hard voice reading
    // out "Partially protected" differently would only make it less legible.
    'status.browser_protected': { companion: 'Protected', serious: 'Protected' },
    'status.browser_partial': { companion: 'Partially protected', serious: 'Partially protected' },
    'status.browser_running_unknown': { companion: 'Running · extension not detected', serious: 'Running · extension not detected' },
    'status.browser_ext_missing': { companion: 'Extension missing', serious: 'Extension missing' },
    'status.browser_idle': { companion: 'Installed · not running', serious: 'Installed · not running' },
    'status.profiles_connected': { companion: '{connected}/{total} profiles', serious: '{connected}/{total} profiles' },
    'status.profile_not_installed': { companion: 'not installed', serious: 'not installed' },
    'status.action_restore': { companion: 'Restore', serious: 'Restore' },
    'status.action_grant_admin': { companion: 'Grant admin & lock', serious: 'Grant admin & lock' },
    // Shown only where no policy can install the extension for the user —
    // today that is Edge on a PC with no Microsoft Edge Add-ons listing to
    // force-install from. It opens the store page; it is not a lock.
    'status.action_install_manually': { companion: 'Add it yourself', serious: 'Add it yourself' },
    // The browser auto-installed the extension but is holding it switched off
    // until the user approves it once. Opens that browser's extensions page.
    'status.action_turn_on': { companion: 'Turn it on', serious: 'Turn it on' },
    // Opens the ~20s restore window for a browser the lock is holding closed.
    // Says "open" rather than "unlock": what it hands over is a short supervised
    // window to finish installing, not the browser back.
    'status.action_unlock': {
      companion: 'Open {browser} to install',
      serious: 'Open {browser} to install' },

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
      serious: '{hours}h {minutes}m left. Still on.',
    },
    'friction.time_remaining_m': {
      companion: '{minutes}m remaining — protection active',
      serious: '{minutes}m left. Still on.',
    },
    'friction.cancel_request': { companion: 'Cancel request', serious: 'Cancel.' },
    'friction.keep': { companion: 'Keep protection on', serious: 'Keep.' },
    'friction.ready_prompt': {
      companion: 'The waiting period is over. What would you like to do?',
      serious: 'Wait is over.',
    },

    /* ---------------------------------------------------------------
     * lockdown.* — lockdown active / frozen / cancel-request
     * --------------------------------------------------------------- */
    'lockdown.start_button': { companion: 'Start lockdown', serious: 'Start lockdown' },
    'lockdown.active_label': { companion: 'Lockdown active', serious: 'Lockdown active' },
    'lockdown.remaining_note': { companion: 'remaining · lockdown active', serious: 'remaining. Locked. Stay put.' },
    'lockdown.frozen_label': { companion: 'Frozen — cannot be cancelled, only waited out', serious: 'You can not cancel this.' },
    'lockdown.frozen_note': {
      companion: 'This one is frozen — there is genuinely no way to cancel it. That was the point when it started.',
      serious: 'You froze it on purpose. There is no way out early. Good. That was the plan.',
    },
    // A non-frozen lockdown's own cancel-request reuses friction.cancel_request/friction.keep — same
    // action, same friction pattern, one string instead of a near-duplicate.
    'lockdown.end_early': { companion: 'End lockdown early', serious: 'End lockdown early' },
    'lockdown.keep_locked': { companion: 'Keep it locked', serious: 'Keep it locked' },
    'lockdown.section_title': { companion: 'Lockdown', serious: 'Lockdown' },
    'lockdown.section_sub': {
      companion: 'Only your allowlist stays reachable. Everything else blocks, for exactly as long as you set.',
      serious: 'Allowlist only. Everything else blocks for as long as you set.',
    },
    'lockdown.section_info': {
      companion: 'Meant for a genuinely hard day, not a daily habit. Starting one is instant and can always be extended. Ending one early goes through the waiting period — unless you chose Frozen, which cannot be ended early at all.',
      serious: 'For a hard day, not every day. Starting is instant and can be extended. Ending early waits out the delay — and Frozen cannot be ended early at all.',
    },
    'lockdown.duration_label': { companion: 'Duration', serious: 'Duration' },
    'lockdown.duration_30m': { companion: '30 minutes', serious: '30 minutes' },
    'lockdown.duration_1h': { companion: '1 hour', serious: '1 hour' },
    'lockdown.duration_2h': { companion: '2 hours', serious: '2 hours' },
    'lockdown.duration_4h': { companion: '4 hours', serious: '4 hours' },
    'lockdown.duration_8h': { companion: '8 hours', serious: '8 hours' },
    'lockdown.duration_24h': { companion: '24 hours', serious: '24 hours' },
    'lockdown.starting': { companion: 'Starting…', serious: 'Starting…' },
    'lockdown.frozen_choice': {
      companion: '**Frozen** — cannot be cancelled once started, only waited out.',
      serious: '**Frozen** — no cancel once started.',
    },
    'lockdown.frozen_choice_info_label': { companion: 'About frozen lockdown', serious: 'About frozen lockdown' },
    'lockdown.frozen_choice_info': {
      companion: 'No password, no override, no support request. Only choose this if that is exactly what you want.',
      serious: 'No password, no override, no support request. Choose it only if that is what you want.',
    },
    'lockdown.confirm_start': {
      companion: 'Start a {duration} lockdown?\n\nOnly your allowlist stays reachable — everything else blocks, full stop, the whole time.',
      serious: 'Start a {duration} lockdown?\n\nAllowlist only. Everything else blocks, the whole time.',
    },
    'lockdown.confirm_start_frozen_note': {
      companion: '\n\nFrozen: once started, this CANNOT be cancelled early — only waited out. There is no override, no password bypass.',
      serious: '\n\nFrozen: once started this CANNOT be cancelled early. No override. No password. Only the clock.',
    },
    'lockdown.confirm_cancel': {
      companion: 'End the lockdown early?\n\nThis goes through the same waiting period as any other protection change — the lockdown stays fully active until it elapses.',
      serious: 'End the lockdown early?\n\nSame waiting period as any other weakening. It stays fully active until the clock runs out.',
    },
    'lockdown.remaining_note_frozen': {
      companion: 'remaining · frozen — can only be waited out',
      serious: 'remaining. Frozen.',
    },
    'lockdown.end_early_short': { companion: 'End early', serious: 'End early' },
    'lockdown.cancel_pending': {
      companion: 'Ending in **{time}** — lockdown stays active until then.',
      serious: 'Ending in **{time}**. Still fully active by the way.',
    },
    'lockdown.escalation_title': { companion: 'Auto-lockdown during vulnerable hours', serious: 'Auto-lockdown during vulnerable hours' },
    'lockdown.escalation_info': {
      companion: 'When your vulnerable-hours window starts, begin a lockdown automatically instead of only showing nudges. Never frozen — always cancellable through the normal delay.',
      serious: 'Your window starts, a lockdown starts with it — not just a nudge. Never frozen; the normal delay still applies.',
    },
    'lockdown.escalation_pending_what': { companion: 'Auto-lockdown', serious: 'Auto-lockdown' },

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
    // Stage eyebrows, the breathing clock, the 5-4-3-2-1 prompts and the
    // optional exit log. Same rule as the rest of panic.*: serious is shorter,
    // never colder. Nothing in this flow is allowed to read as a rebuke.
    'panic.eyebrow_wave': { companion: 'The wave', serious: 'The wave' },
    'panic.eyebrow_ground': { companion: 'Grounding · 5-4-3-2-1', serious: 'Grounding · 5-4-3-2-1' },
    'panic.eyebrow_exit': { companion: 'You rode it out', serious: 'You rode it out' },
    'panic.breathe_cta': { companion: 'Continue', serious: 'Continue' },
    'panic.breath_in': { companion: 'Breathe in', serious: 'Breathe in' },
    'panic.breath_hold': { companion: 'Hold', serious: 'Hold' },
    'panic.breath_out': { companion: 'Breathe out', serious: 'Breathe out' },
    'panic.sense_see': { companion: 'see', serious: 'see' },
    'panic.sense_hear': { companion: 'hear', serious: 'hear' },
    'panic.sense_touch': { companion: 'touch', serious: 'touch' },
    'panic.sense_smell': { companion: 'smell', serious: 'smell' },
    'panic.sense_taste': { companion: 'taste', serious: 'taste' },
    'panic.ground_see': {
      companion: 'Look around and name five things you can see.',
      serious: 'Look around. Name five things you can see.',
    },
    'panic.ground_hear': {
      companion: 'Listen for a moment. Name four things you can hear.',
      serious: 'Listen. Name four things you can hear.',
    },
    'panic.ground_touch': {
      companion: 'Name three things you can feel — the chair, your feet on the floor, the air.',
      serious: 'Name three things you can feel — the chair, your feet, the air.',
    },
    'panic.ground_smell': { companion: 'Name two things you can smell.', serious: 'Name two things you can smell.' },
    'panic.ground_taste': { companion: 'Name one thing you can taste.', serious: 'Name one thing you can taste.' },
    'panic.redirect_tip': {
      companion: 'Tip: set a "Redirect link" in Blocking Settings and this screen can send you straight to your safe place.',
      serious: 'Set a "Redirect link" in Blocking Settings and this screen sends you straight there next time.',
    },
    'panic.log_prompt': { companion: 'What brought this on?', serious: 'What brought this on?' },
    'panic.log_optional': { companion: '(optional)', serious: '(optional)' },
    'panic.log_done': {
      companion: 'Logged quietly — thank you for checking in.',
      serious: 'Logged. Thank you for checking in.',
    },

    /* ---------------------------------------------------------------
     * streak.* — day counter, milestones, slip/relapse logging.
     * Companion keeps the current compassionate register; serious is
     * hard but forward-pointing, never cruel.
     * --------------------------------------------------------------- */
    'streak.day_count': { companion: '{days} days clean', serious: '{days} days. Keep it.' },
    'streak.best_streak_label': { companion: 'Best streak', serious: 'Best streak' },
    'streak.milestone_banner': {
      companion: "{days} days clean — that's a real milestone.",
      serious: '{days} days clean. Make it more.',
    },
    'streak.milestone_sub': {
      companion: 'Every one of those days was a choice. Well earned.',
      serious: 'Every one of those days was a choice.',
    },
    'streak.slip_button': { companion: 'I had a slip', serious: 'Log a slip' },
    'streak.slip_confirm_title': { companion: 'This stays between us', serious: 'Log it straight.' },
    'streak.slip_confirm_body': {
      companion: "A slip is not a collapse — it's a single moment, not your identity. Logging it honestly is part of recovery, not a failure report. Your best streak and everything you've already learned stay exactly as they are.",
      serious: "A slip is one moment, not a verdict. Get up.",
    },
    'streak.slip_logged_title': { companion: "Okay. You're still here.", serious: 'Logged.' },
    'streak.slip_logged_body': {
      companion: "Gentle mode is on for the next 24 hours. Your streak resets, but your best streak and this month's progress don't disappear. What would help right now?",
      serious: 'Streak resets. Best streak does not move. Pick the next step and take it.',
    },
    'streak.gentle_title': { companion: 'Be gentle', serious: 'Get up.' },
    'streak.gentle_sub': { companion: 'with yourself today', serious: 'Get up.' },
    // The one-tap trigger vocabulary, offered identically by the panic flow's
    // exit stage, the Overview quick-log and the slip dialog. One word each,
    // and the same word in both voices — this is a label the user is picking
    // off a list under pressure, not a line the app gets to editorialise in.
    'streak.trigger_bored': { companion: 'Bored', serious: 'Bored' },
    'streak.trigger_stressed': { companion: 'Stressed', serious: 'Stressed' },
    'streak.trigger_late': { companion: 'Late night', serious: 'Late night' },
    'streak.trigger_lonely': { companion: 'Lonely', serious: 'Lonely' },

    /* ---------------------------------------------------------------
     * overview.* — the desktop Overview page: streak hero, weekly recap,
     * trigger analytics, browser-protection panel. The slip dialog and the
     * milestone banner that live on this page use streak.* instead — same
     * moment, same words, one key.
     *
     * `*word*` renders italic and `**word**` renders bold (see tRich in the
     * renderer's ui.jsx), so a sentence stays ONE key instead of being cut
     * into lead/emphasis/tail fragments a translator can't reassemble.
     * --------------------------------------------------------------- */
    'overview.eyebrow': { companion: 'Overview', serious: 'Overview' },
    'overview.title': { companion: 'Your *progress*', serious: 'The *record*' },
    'overview.sub': {
      companion: "A calm look at how far you've come. Small, steady steps — that's the whole game.",
      serious: 'Where you actually stand. Small steps, taken every day. That is the game.',
    },
    'overview.hero_on_a_roll': { companion: 'On a roll', serious: 'Holding the line' },
    'overview.hero_gentle_label': { companion: 'Starting again, gently', serious: 'Starting again' },
    'overview.hero_gentle_body': {
      companion: "A slip is a moment, not your identity. Today isn't about the number — it's about showing up again.",
      serious: 'A slip is a moment, not a verdict. Today is not about the number.',
    },
    'overview.hero_next_milestone': {
      companion: "You're **{days} days** from your next milestone of {target} days. Keep the rhythm.",
      serious: '**{days} days** to {target}. Keep it up.',
    },
    'overview.days_clean_label': { companion: 'days clean', serious: 'days clean' },
    'overview.clean_days_month_one': { companion: '{count} clean day this month', serious: '{count} clean day this month' },
    'overview.clean_days_month_other': { companion: '{count} clean days this month', serious: '{count} clean days this month' },
    'overview.stat_best_streak_value': { companion: '{days} days', serious: '{days} days' },
    'overview.stat_best_streak_sub': { companion: 'Your personal record', serious: 'Your record. Beat it.' },
    'overview.stat_blocked_label': { companion: 'Sites blocked', serious: 'Sites blocked' },
    'overview.stat_blocked_sub': { companion: 'Across all your browsers', serious: 'Across all your browsers' },
    'overview.quote_eyebrow': { companion: "Today's quote", serious: "Today's quote" },

    // Weekly recap. One sentence per shape of week — never a template with
    // numbers dropped in — so the card can't congratulate someone on a week
    // that was actually hard.
    'overview.recap_title': { companion: 'Your last seven days', serious: 'Your last seven days' },
    'overview.recap_quiet': {
      companion: 'A quiet week — nothing logged either way. That counts.',
      serious: 'A quiet week. Nothing logged either way. That counts.',
    },
    'overview.recap_held_one': {
      companion: 'You felt it once and it passed.',
      serious: 'Felt it once. It passed.',
    },
    'overview.recap_held_other': {
      companion: 'You felt it {count} times and it passed every time.',
      serious: 'Felt it {count} times. It passed every time.',
    },
    'overview.recap_mostly_held': {
      companion: 'Mostly held. {urges} ridden out against {slips} — that ratio is the whole game.',
      serious: 'Mostly held. {urges} ridden out against {slips}. That ratio is the game.',
    },
    'overview.recap_hard': {
      companion: 'A hard week. It is on the record, and the record is what you build from.',
      serious: 'A hard week. It is on the record. Build from it.',
    },
    'overview.recap_trend': { companion: '{delta} vs. the week before', serious: '{delta} vs. the week before' },
    'overview.recap_clean_days': { companion: 'Clean days', serious: 'Clean days' },
    'overview.recap_ridden_out': { companion: 'Urges ridden out', serious: 'Urges ridden out' },
    'overview.recap_slips': { companion: 'Slips logged', serious: 'Slips logged' },
    'overview.recap_urge_one': { companion: '{count} urge', serious: '{count} urge' },
    'overview.recap_urge_other': { companion: '{count} urges', serious: '{count} urges' },
    'overview.recap_slip_one': { companion: '{count} slip', serious: '{count} slip' },
    'overview.recap_slip_other': { companion: '{count} slips', serious: '{count} slips' },

    // Local trigger analytics. Every line here is about what the log does or
    // doesn't yet support — the card never guesses, and neither does the copy.
    'overview.patterns_title': { companion: 'Your patterns', serious: 'Your patterns' },
    'overview.patterns_sub': {
      companion: 'Built entirely from what you log here — nothing is sent anywhere, nothing is guessed.',
      serious: 'Built from what you log here. Nothing sent anywhere. Nothing guessed.',
    },
    'overview.patterns_empty': {
      companion: 'Log an urge (or a slip) and this card starts learning your patterns — hour of day, day of week, and where your risk actually concentrates.',
      serious: 'Log an urge or a slip and this starts learning your patterns — hour, day, and where the risk concentrates.',
    },
    'overview.patterns_thin': {
      companion: "{count} logged so far — a few more and a real pattern can show. Nothing meaningful yet, so nothing's drawn.",
      serious: '{count} logged. A few more and a pattern can show. Nothing meaningful yet, so nothing is drawn.',
    },
    'overview.risk_window_summary': {
      companion: 'Your risk window looks like {when}.',
      serious: 'Your risk window: {when}.',
    },
    'overview.risk_window_events': {
      companion: '({band} of {total} logged events)',
      serious: '({band} of {total} logged events)',
    },
    'overview.by_hour': { companion: 'By hour of day', serious: 'By hour of day' },
    'overview.by_day': { companion: 'By day of week', serious: 'By day of week' },
    'overview.cover_window_cta': {
      companion: 'Cover this window with vulnerable hours',
      serious: 'Cover this window with vulnerable hours',
    },
    'overview.cover_window_locked': {
      companion: "The log doesn't show a strong enough pattern yet to suggest a window honestly — keep logging and this unlocks.",
      serious: 'Not a strong enough pattern yet to suggest a window honestly. Keep logging. This unlocks.',
    },
    'overview.urge_log_cta': { companion: 'I had an urge', serious: 'Log an urge' },
    'overview.urge_logged': { companion: 'Logged', serious: 'Logged' },

    // Slip dialog extras (its title/body come from streak.*).
    'overview.slip_trigger_prompt': { companion: 'What was happening? (optional)', serious: 'What was happening? (optional)' },
    'overview.slip_never_mind': { companion: 'Never mind', serious: 'Never mind' },
    'overview.slip_confirm_cta': { companion: 'Log it & start gentle mode', serious: 'Log it & start gentle mode' },
    'overview.slip_talk_mentor': { companion: 'Talk to the Mentor', serious: 'Get a plan from the Mentor' },
    'overview.slip_ride_urge': { companion: 'Ride out an urge instead', serious: 'Ride out an urge instead' },

    // Browser-protection panel.
    'overview.browser_sub': {
      companion: 'Oath Light watches every running browser and keeps its extension in place',
      serious: 'Every running browser is watched and its extension kept in place',
    },
    'overview.browser_needs_desktop': {
      companion: 'Browser monitoring runs in the desktop app.',
      serious: 'Browser monitoring runs in the desktop app.',
    },
    'overview.browser_none_running': {
      companion: 'No browser is running right now. Open one and Oath Light will protect it automatically.',
      serious: 'No browser running. Open one — it gets protected automatically.',
    },

    /* ---------------------------------------------------------------
     * blocking.* — the desktop Blocking Settings page. Section headers,
     * row titles, the one-line state under each row, and the InfoDot text
     * behind it.
     *
     * The `_info` strings describe what a setting DOES and what it costs to
     * turn off. They must not drift into describing where coverage is thin
     * or how a protection could be gotten around (VOICE.md, "status yes,
     * map no") — the serious variants below are shorter, never more
     * detailed. Lockdown's own copy lives in lockdown.*.
     * --------------------------------------------------------------- */
    'blocking.eyebrow': { companion: 'Blocking Settings', serious: 'Blocking Settings' },
    'blocking.title': { companion: 'How firmly to *hold the line*', serious: 'How firmly to *hold the line*' },
    'blocking.sub': {
      companion: 'Strict is already on. Everything below tunes it.',
      serious: 'Strict is already on. Everything below tunes it.',
    },

    'blocking.strictness_title': { companion: 'Strictness', serious: 'Strictness' },
    'blocking.strictness_sub': {
      companion: 'Strict is the floor. There is no gentler setting — that is the point.',
      serious: 'Strict is the floor. There is nothing gentler. That is the point.',
    },
    'blocking.strictness_info': {
      companion: 'Every individual protection below stays yours to tune afterwards. Changing preset can only ever turn things ON: nothing here can quietly weaken a protection, because weakening always goes through the waiting period instead.',
      serious: 'Every protection below stays yours to tune. A preset can only turn things ON — weakening always goes through the waiting period.',
    },

    // Strictness presets. The store owns which settings each one applies; only
    // the words are here. Strict is the floor, so neither voice is allowed to
    // describe a preset as making the app easier — because none of them can.
    'blocking.preset_strict_name': { companion: 'Strict', serious: 'Strict' },
    'blocking.preset_strict_desc': {
      companion: 'The default. Blocks the most it can without guessing.',
      serious: 'The default. Blocks the most it can without guessing.',
    },
    'blocking.preset_strict_info': {
      companion: "The full blocklist, graylist filtering and SafeSearch, plus YouTube Restricted Mode and URL-pattern matching on sites that aren't listed. Occasionally catches something innocent — report it and it gets fixed.",
      serious: "The full blocklist, graylist filtering and SafeSearch, plus YouTube Restricted Mode and URL-pattern matching on sites that aren't listed. It will occasionally catch something innocent, report it.",
    },
    'blocking.preset_lockdown_name': { companion: 'Lockdown', serious: 'Lockdown' },
    'blocking.preset_lockdown_desc': {
      companion: 'Strict, plus your vulnerable hours go allowlist-only.',
      serious: 'Strict, plus your vulnerable hours go allowlist-only.',
    },
    'blocking.preset_lockdown_info': {
      companion: 'Everything in Strict. On top of that, when your vulnerable-hours window starts, browsing automatically narrows to the allowlist until it ends.',
      serious: 'Everything in Strict. When your vulnerable-hours window starts, browsing narrows to the allowlist until it ends.',
    },

    'blocking.protection_title': { companion: 'Protection', serious: 'Protection' },
    'blocking.protection_sub': {
      companion: 'What actually keeps Oath Light in place and working.',
      serious: 'What keeps Oath Light in place and working.',
    },
    // Nothing in this section is a toggle any more, so the card's own
    // explanation is no longer about the on/off asymmetry — it is about there
    // being no off. The asymmetry copy still exists and is still true; it moved
    // to the settings that really are choices.
    'blocking.protection_info': {
      companion: "These are what Oath Light is. None of them have a switch — not one behind a password, not one behind a waiting period — because a protection you can end up talking yourself out of isn't protection. Everything on this page that IS a choice is still a choice.",
      serious: 'These are what Oath Light is. No switches, no password, no waiting period — there is no off. The settings that are choices are still choices.',
    },

    // The one chip every mandatory row wears. Shared rather than per-row: five
    // rows saying the same thing in five slightly different ways is how a page
    // stops reading like one decision.
    'blocking.always_on': { companion: 'Always on', serious: 'Always on' },

    'blocking.guard_title': { companion: 'Uninstall guard', serious: 'Uninstall guard' },
    'blocking.guard_desc_on': {
      companion: 'Extension kept installed, private windows closed off',
      serious: 'Extension kept installed, private windows closed off',
    },
    'blocking.guard_info': {
      companion: "Keeps the extension force-installed on every supported browser and re-applies the policy if it's removed. It also closes the two surfaces the extension can't reach on its own: Incognito/Private windows and Guest profiles. No switch — it can't be turned off.",
      serious: 'Keeps the extension force-installed on every supported browser and re-applies the policy if it goes. Incognito/Private windows and Guest profiles are closed off too. No switch. It does not come off.',
    },

    'blocking.safesearch_title': { companion: 'SafeSearch', serious: 'SafeSearch' },
    'blocking.safesearch_desc': { companion: 'Forced on every connected browser', serious: 'Forced on every connected browser' },
    'blocking.safesearch_info': {
      companion: 'Google, Bing, DuckDuckGo and Yahoo are pinned to SafeSearch and their toggle UI is hidden. No switch — it can\'t be turned off.',
      serious: 'Google, Bing, DuckDuckGo and Yahoo are pinned to SafeSearch and their toggle is hidden. No switch. It does not come off.',
    },

    'blocking.youtube_title': { companion: 'YouTube Restricted Mode', serious: 'YouTube Restricted Mode' },
    'blocking.youtube_desc_on': {
      companion: 'Mature videos and comments filtered by YouTube',
      serious: 'Mature videos and comments filtered by YouTube',
    },
    'blocking.youtube_info': {
      companion: "Applies YouTube's own strict Restricted Mode through a header rule — the same mechanism school networks use — so YouTube filters mature videos and comments on its side. No switch — it can't be turned off.",
      serious: "Applies YouTube's own strict Restricted Mode, so YouTube filters mature videos and comments on its side. No switch. It does not come off.",
    },

    'blocking.sub_apps': { companion: 'Apps and browsers', serious: 'Apps and browsers' },
    'blocking.sub_network': { companion: 'Network', serious: 'Network' },

    'blocking.apps_title': { companion: 'Blocked apps', serious: 'Blocked apps' },
    'blocking.apps_desc_count': { companion: '{count} blocked by process name', serious: '{count} blocked by process name' },
    'blocking.apps_desc_empty': { companion: 'Nothing blocked yet', serious: 'Nothing blocked yet' },
    'blocking.apps_info': {
      companion: 'Closes desktop apps by process name whenever they start. This is friction, not a sandbox — a renamed .exe walks straight past it. Adding one is instant; removing one goes through the waiting period.',
      serious: 'Closes desktop apps by process name whenever they start. Friction, not a sandbox. Adding is instant; removing waits out the delay.',
    },
    'blocking.apps_placeholder': { companion: 'e.g. discord.exe', serious: 'e.g. discord.exe' },
    'blocking.apps_stop_blocking_aria': { companion: 'Stop blocking {name}', serious: 'Stop blocking {name}' },
    'blocking.apps_pending': { companion: '**{name}** unblocks in **{time}**.', serious: '**{name}** unblocks in **{time}**.' },
    'blocking.apps_keep_blocking': { companion: 'Keep blocking it', serious: 'Keep blocking it' },
    'blocking.apps_session_label': { companion: 'This session', serious: 'This session' },
    // The live "what just happened" feed. Reports the event, never which
    // detection rule fired — the reason codes stay in the protection history
    // and the log, where they aren't a map for the person reading this page.
    'blocking.event_process_closed': { companion: '{name} — blocked list — closed', serious: '{name} — blocked list — closed' },
    'blocking.event_evasion_closed': { companion: '{name} — unrecognised browser — closed', serious: '{name} — unrecognised browser — closed' },
    'blocking.event_evasion_noted': { companion: '{name} — unrecognised browser — noted', serious: '{name} — unrecognised browser — noted' },

    'blocking.evasion_title': { companion: 'Close unrecognised browsers', serious: 'Close unrecognised browsers' },
    'blocking.evasion_desc_on': { companion: 'Closed on sight', serious: 'Closed on sight' },
    'blocking.evasion_desc_off': { companion: 'Recorded, not closed', serious: 'Recorded, not closed' },
    'blocking.evasion_info': {
      companion: "Some browsers can't be reached by the extension at all. With this on, they're closed as soon as they start. Either way, anything unrecognised is written to your protection history.",
      serious: 'With this on, an unrecognised browser is closed as soon as it starts. Either way it goes into your protection history.',
    },
    'blocking.evasion_pending_what': { companion: 'Closing unrecognised browsers', serious: 'Closing unrecognised browsers' },

    // Browser lock. Deliberately says "a browser" and never names Edge or why
    // it's the exception — "status yes, map no" (VOICE.md). The copy also avoids
    // promising that every browser gets this: most don't need it, because their
    // extension can't be removed in the first place.
    //
    // The off-state and pending-weakening keys are gone with the switch. What
    // replaced them is the recovery sentence: the lock is survivable because a
    // window is always available, and the copy has to say so, or being locked
    // out reads as being locked out permanently.
    'blocking.browser_lock_title': {
      companion: 'Require the extension to browse',
      serious: 'Require the extension to browse' },
    'blocking.browser_lock_desc_on': {
      companion: "A browser without it won't open",
      serious: "A browser without it won't open" },
    'blocking.browser_lock_info': {
      companion: "One browser can't be made to keep the extension the way the others can, so it simply doesn't open until the extension is on. If it's ever closed on you, come here and Oath Light will open it for a short window so you can switch the extension back on — as many times as you need. No switch, and no exceptions.",
      serious: "One browser can't be forced to keep the extension, so it doesn't open without it. Come here and Oath Light gives you a short window to switch the extension on — as often as it takes. No switch. No exceptions." },

    'blocking.dns_title': { companion: 'System DNS filter', serious: 'System DNS filter' },
    'blocking.dns_info': {
      companion: "Extends blocking past the browser to every other app on this computer. Needs administrator rights once, to take over DNS — until you grant that, this layer can't cover anything outside your browser. No switch; if it ever stops, Oath Light starts it again by itself.",
      serious: "Extends blocking past the browser to every app on this computer. Needs administrator rights once. Until you grant it, nothing outside the browser is covered. No switch — if it stops, it restarts itself.",
    },
    'blocking.dns_status_active': { companion: 'Filtering every app on this computer', serious: 'Filtering every app on this computer' },
    'blocking.dns_status_no_adapter': {
      companion: 'Running, but nothing outside your browser is covered yet — needs administrator rights',
      serious: 'Running, but nothing outside your browser is covered yet — needs administrator rights',
    },
    // The resolver itself is down. Says the two things worth saying: what is
    // still protecting you, and that nobody has to do anything about it.
    'blocking.dns_status_retrying': {
      companion: 'Starting again — your browser is still protected',
      serious: 'Starting again — your browser is still protected',
    },
    // Running and taken over, but something else on the machine is answering
    // DNS (see dns_filter.rs's `exposure_warning`). The detail sentence comes
    // from Rust; this is only the headline, and it must not keep claiming
    // "every app on this computer" while that is not true.
    'blocking.dns_status_reduced': {
      companion: 'Running, but not covering every app right now',
      serious: 'Running, but not covering every app right now',
    },
    'blocking.dns_grant_admin': { companion: 'Grant admin', serious: 'Grant admin' },
    'blocking.dns_retry': { companion: 'Try now', serious: 'Try now' },

    'blocking.monitor_title': { companion: 'AI screen monitor', serious: 'AI screen monitor' },
    'blocking.monitor_sub': {
      companion: "Optional. Watches this device's screen on-device and covers what it shouldn't be showing.",
      serious: "Optional. Watches this device's screen on-device and covers what it shouldn't be showing.",
    },
    'blocking.monitor_info': {
      companion: 'An on-device model looks at the screen when it changes. No frame ever leaves this computer — there is no server involved and nothing is uploaded. It only reacts when something persists across several frames, never to a single reading, and all it does is cover the screen and open your own redirect.',
      serious: 'An on-device model looks at the screen when it changes. No frame leaves this computer. It reacts only to something that persists across frames, and all it does is cover the screen and open your redirect.',
    },
    'blocking.monitor_row_title': { companion: 'Screen monitoring', serious: 'Screen monitoring' },
    'blocking.monitor_running': { companion: 'Running', serious: 'Running' },
    'blocking.monitor_row_info': {
      companion: 'Turning it on is instant. Turning it off goes through the waiting period like every other protection — it keeps running until that elapses.',
      serious: 'On is instant. Off waits out the delay like every other protection — it keeps running until then.',
    },
    'blocking.monitor_turn_on': { companion: 'Turn on', serious: 'Turn on' },
    'blocking.monitor_turn_off': { companion: 'Turn off', serious: 'Turn off' },
    'blocking.monitor_consent_title': { companion: 'Before you turn this on', serious: 'Before you turn this on' },
    'blocking.monitor_consent_1': {
      companion: 'It looks at whatever is on your screen — including windows that have nothing to do with browsing.',
      serious: 'It looks at whatever is on your screen — including windows that have nothing to do with browsing.',
    },
    'blocking.monitor_consent_2': {
      companion: 'Everything is processed on this device. No image is uploaded, stored, or sent anywhere.',
      serious: 'Everything is processed on this device. No image is uploaded, stored, or sent anywhere.',
    },
    'blocking.monitor_consent_3': {
      companion: "When it reacts, it covers the screen and opens your redirect. It can't close apps or report to anyone.",
      serious: "When it reacts, it covers the screen and opens your redirect. It can't close apps or report to anyone.",
    },
    'blocking.monitor_consent_4': {
      companion: 'Turning it back off takes 24 hours, like every other protection here.',
      serious: 'Turning it back off takes 24 hours, like every other protection here.',
    },
    'blocking.monitor_consent_cta': { companion: 'I understand — turn it on', serious: 'Understood — turn it on' },
    'blocking.monitor_pending_what': { companion: 'The screen monitor', serious: 'The screen monitor' },
    'blocking.monitor_show_readout': { companion: 'Show live readout', serious: 'Show live readout' },
    'blocking.monitor_hide_readout': { companion: 'Hide live readout', serious: 'Hide live readout' },
    'blocking.monitor_waiting': { companion: 'Waiting for the screen to change…', serious: 'Waiting for the screen to change…' },
    'blocking.monitor_capture_alt': { companion: 'Most recent screen capture', serious: 'Most recent screen capture' },
    'blocking.monitor_reading': { companion: '{score}% · checked {time}', serious: '{score}% · checked {time}' },

    'blocking.schedule_title': { companion: 'Your hard hours', serious: 'Your hard hours' },
    'blocking.schedule_sub': {
      companion: 'The window you already know is the risky one, and what happens during it.',
      serious: 'The window you already know is the risky one, and what happens during it.',
    },
    'blocking.schedule_info': {
      companion: 'Set from your own pattern rather than a generic default. The Overview page can fill this in from your logged urges once there are enough of them to see a shape.',
      serious: 'Set from your own pattern, not a generic default. The Overview page can fill it in from your logged urges once there are enough to see a shape.',
    },
    'blocking.vulnerable_title': { companion: 'Vulnerable hours', serious: 'Vulnerable hours' },
    'blocking.vulnerable_desc': { companion: 'Extra attention during this window.', serious: 'Extra attention during this window.' },
    'blocking.vulnerable_info': {
      companion: 'Reminders, grayscale and — on the Lockdown preset — automatic allowlist-only browsing all key off this window.',
      serious: 'Reminders, grayscale and — on the Lockdown preset — automatic allowlist-only browsing all key off this window.',
    },
    'blocking.time_from': { companion: 'From', serious: 'From' },
    'blocking.time_to': { companion: 'To', serious: 'To' },
    'blocking.time_until': { companion: 'Until', serious: 'Until' },
    'blocking.grayscale_title': { companion: 'Grayscale the screen', serious: 'Grayscale the screen' },
    'blocking.grayscale_desc_on': { companion: 'On during your window', serious: 'On during your window' },
    'blocking.grayscale_info': {
      companion: "Drains the colour out of the whole display while your window is running, then gives it back. On some Windows builds it takes effect at the next sign-in rather than instantly. This one isn't a protection, so you can switch it off any time — no waiting period.",
      serious: 'Drains the colour out of the display while your window runs, then gives it back. On some Windows builds it takes effect at the next sign-in. Not a protection — switch it off any time, no waiting period.',
    },
    'blocking.nudges_label': { companion: 'Nudges during the window', serious: 'Nudges during the window' },
    'blocking.alert_checkin_label': { companion: 'Gentle check-in', serious: 'Check-in' },
    'blocking.alert_checkin_desc': {
      companion: 'A soft “still with me?” prompt to keep you company.',
      serious: 'A short “still with me?” prompt during the window.',
    },
    'blocking.alert_quote_label': { companion: 'Motivational reminder', serious: 'Reminder' },
    'blocking.alert_quote_desc': {
      companion: 'A short line to reconnect you with your why.',
      serious: 'One line to put your why back in front of you.',
    },

    'blocking.blockscreen_title': { companion: 'What you see when it blocks', serious: 'What you see when it blocks' },
    'blocking.blockscreen_sub': {
      companion: 'A wall says no. This is the part that says what to do instead.',
      serious: 'A wall says no. This says what to do instead.',
    },
    'blocking.blockscreen_info': {
      companion: "Whatever you write here shows up on the block screen itself. Write it now, while you're thinking clearly — that's the whole trick. Leave it empty and the block screen won't invent advice of its own.",
      serious: "Whatever you write here shows up on the block screen. Write it now, while you're thinking clearly. Leave it empty and the block screen invents nothing.",
    },
    'blocking.redirect_title': { companion: 'Redirect instead of the block screen', serious: 'Redirect instead of the block screen' },
    'blocking.redirect_desc_unset': { companion: 'No link set yet', serious: 'No link set yet' },
    'blocking.redirect_desc_off': { companion: 'Off — show the block screen', serious: 'Off — show the block screen' },
    'blocking.redirect_info': {
      companion: 'Sends you to a page of your choosing instead of the default block screen — a video, a note to yourself, anything that helps more than a closed door does.',
      serious: 'Sends you to a page of your choosing instead of the block screen — a video, a note to yourself, anything that helps more than a closed door.',
    },
    'blocking.redirect_placeholder': { companion: 'https://youtube.com/watch?v=…', serious: 'https://youtube.com/watch?v=…' },
    'blocking.alternatives_label': { companion: "Instead, I'd rather…", serious: "Instead, I'd rather…" },
    'blocking.alternatives_placeholder': { companion: 'Go do 20 push-ups', serious: 'Go do 20 push-ups' },
    'blocking.alternatives_link_placeholder': { companion: 'Optional link', serious: 'Optional link' },

    'blocking.pending_note': {
      companion: '{what} turns off in **{time}** — it stays fully active until then.',
      serious: '{what} turns off in **{time}**. Fully active until then.',
    },
    'blocking.pending_keep': { companion: 'Keep it on', serious: 'Keep it on' },

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
    // "Coach", not "Drill Sergeant" — the id stays `serious` everywhere; this
    // is the label only. A drill sergeant is a caricature, and naming the hard
    // voice after one made the whole choice read as a joke. Arabic already had
    // it right ('المدرّب الصارم' — the strict coach), and the description
    // underneath has always said "a hard coach, fully on your side".
    'onboarding.serious_name': { companion: 'Coach', serious: 'Coach' },
    'onboarding.serious_desc': {
      companion: 'Short, direct, no cushioning. A hard coach who is completely on your side.',
      serious: 'Short. Direct. No cushioning. A hard coach, fully on your side.',
    },

    // The first-run wizard. Skipping is a first-class choice at every step and
    // the copy has to keep reading that way in both voices — a hard voice that
    // makes skipping sound like failure would be pressuring someone on their
    // first two minutes in the app.
    'onboarding.step_eyebrow': { companion: 'Setup · step {step} of {total}', serious: 'Setup · step {step} of {total}' },
    'onboarding.skip_setup': { companion: 'Skip setup', serious: 'Skip setup' },
    'onboarding.finish': { companion: 'Finish setup', serious: 'Finish setup' },

    'onboarding.welcome_title': { companion: "Let's set this up *properly*", serious: "Set this up *properly*" },
    'onboarding.welcome_sub': {
      companion: "Five short steps. You can skip the whole thing and change everything later — but the defaults you pick now are the ones that hold when you don't feel like picking.",
      serious: "Five short steps. Skippable, changeable later. But what you pick now is what holds on the day you don't feel like picking.",
    },
    'onboarding.welcome_rule': {
      companion: 'Oath Light works on a simple rule: **strengthening protection is instant, weakening it takes time**. Everything you turn on here can be turned back off — just not in the ten seconds where you most want to.',
      serious: 'One rule: **strengthening is instant, weakening takes time**. Everything here can come back off — just not in the ten seconds where you most want it off.',
    },

    'onboarding.preset_title': { companion: 'How strict should it be?', serious: 'How strict?' },
    'onboarding.preset_sub': {
      companion: 'You can change this any time, and tune individual settings afterwards.',
      serious: 'Changeable any time. Individual settings tune afterwards.',
    },
    'onboarding.preset_selected': { companion: 'Selected', serious: 'Selected' },
    'onboarding.preset_choose': { companion: 'Choose', serious: 'Choose' },

    'onboarding.hours_title': { companion: 'When is it hardest?', serious: 'When is it hardest?' },
    'onboarding.hours_sub': {
      companion: 'Late at night, for most people. Oath Light pays closer attention during these hours.',
      serious: 'Late at night, for most people. Oath Light pays closer attention then.',
    },

    'onboarding.extras_title': { companion: 'Two optional extras', serious: 'Two optional extras' },
    'onboarding.extras_sub': {
      companion: "Both are genuinely optional. Oath Light is fully effective without either — skip them if they don't fit your life.",
      serious: "Both genuinely optional. Oath Light is fully effective without either. Skip them if they don't fit your life.",
    },
    'onboarding.password_title': { companion: 'Master password', serious: 'Master password' },
    'onboarding.password_desc': {
      companion: "Asked for whenever a protection is being turned down. It can be your own, or set by someone you trust so you can't unlock it yourself. Without one, the waiting periods alone still hold.",
      serious: "Asked for whenever a protection is turned down. Yours, or set by someone you trust so you can't unlock it yourself. Without one, the waiting periods still hold.",
    },
    'onboarding.password_placeholder': { companion: 'Leave blank to skip', serious: 'Leave blank to skip' },
    'onboarding.password_button': { companion: 'Set password', serious: 'Set password' },
    'onboarding.password_too_short': { companion: 'Use at least 6 characters.', serious: 'Use at least 6 characters.' },
    'onboarding.password_saved': { companion: 'Password set.', serious: 'Password set.' },
    'onboarding.contact_title': { companion: 'Trusted contact', serious: 'Trusted contact' },
    'onboarding.contact_desc': {
      companion: "A parent, sibling, friend or mentor. They're told only that a discrete event happened — never what was browsed, never a screenshot, never a history.",
      serious: 'A parent, sibling, friend or mentor. Told only that an event happened — never what was browsed, never a screenshot, never a history.',
    },
    'onboarding.contact_name_placeholder': { companion: 'Their name', serious: 'Their name' },
    'onboarding.contact_email_placeholder': { companion: 'Their email', serious: 'Their email' },
    'onboarding.contact_button': { companion: 'Save contact', serious: 'Save contact' },
    'onboarding.contact_need_both': { companion: 'Both a name and an email are needed.', serious: 'Both a name and an email are needed.' },
    'onboarding.contact_saved': {
      companion: 'Saved. They will only ever be told that an event happened.',
      serious: 'Saved. They will only ever be told that an event happened.',
    },

    'onboarding.test_title': { companion: 'See it work', serious: 'See it work' },
    'onboarding.test_sub': {
      companion: 'Trust the demonstration, not the claim. This asks the app what it would do with a known adult site.',
      serious: 'Trust the demonstration, not the claim. This asks the app what it would do with a known adult site.',
    },
    'onboarding.test_button': { companion: 'Run the test', serious: 'Run the test' },
    'onboarding.test_running': { companion: 'Checking…', serious: 'Checking…' },
    'onboarding.test_blocked': {
      companion: "Blocked. That's the app answering for itself.",
      serious: 'Blocked. That is the app answering for itself.',
    },
    'onboarding.test_open': {
      companion: "Not blocked. That shouldn't happen — check that the browser extension is installed and connected from the Overview page, then run this again.",
      serious: 'Not blocked. That should not happen. Check the extension is installed and connected from the Overview page, then run this again.',
    },
    'onboarding.test_unreachable': {
      companion: "Couldn't reach the blocklist just now. Protection is unaffected — try again from Settings later.",
      serious: 'Could not reach the blocklist just now. Protection is unaffected. Try again from Settings later.',
    },
    'onboarding.test_failed': { companion: "Couldn't run the check just now.", serious: 'Could not run the check just now.' },
    'onboarding.test_needs_desktop': { companion: 'The live test needs the desktop app.', serious: 'The live test needs the desktop app.' },
  };

  /* ---------------------------------------------------------------
   * Locales (i18n).
   *
   * The registry below is a SECOND dimension over the same keys: a
   * string is resolved by locale first, then by voice. English is the
   * built-in base and is also the fallback for every other locale — a
   * key a translator hasn't reached yet renders in English rather than
   * rendering as a raw dotted key, so a half-finished locale degrades
   * to "some English" instead of "visibly broken".
   *
   * Locales load as plain sibling scripts (`locales/<code>.js`) that
   * call `registerLocale` at load time. That shape is forced by this
   * file's hard constraints: no build step, no `import`, and it has to
   * survive `importScripts()` in the MV3 service worker — so a locale
   * cannot be fetched lazily or pulled in as a module. Every shipped
   * locale is therefore listed in the manifest / the page's <script>
   * tags alongside this file. At ~94 keys each that costs a few KB.
   *
   * `dir` is part of the locale, not a separate setting: the direction
   * of the UI is a property of the language, and letting them drift
   * apart is how you end up with an RTL language in an LTR layout.
   * --------------------------------------------------------------- */
  var LOCALES = {
    en: {
      code: 'en',
      name: 'English',
      nativeName: 'English',
      dir: 'ltr',
      // `reviewed` is a claim about the COPY, not about the code: true
      // means a human fluent in the language has read it. Machine-drafted
      // locales ship with false and the picker says so out loud, because
      // silently shipping unreviewed recovery language to someone in a
      // hard moment is worse than shipping English.
      reviewed: true,
      strings: STRINGS,
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

  // Pull one voice's text out of a locale's entry for `key`, or null.
  // Within a locale, a missing `serious` falls back to that locale's
  // own `companion` before the caller falls back to English — a
  // translator who wrote only the warm voice should not silently get
  // English in serious mode when their own wording exists.
  function pick(table, key, voice) {
    if (!table) return null;
    var entry = table[key];
    if (!entry) return null;
    var str = entry[voice];
    if (str == null) str = entry.companion;
    return str == null ? null : str;
  }

  var OL_STRINGS = {
    version: 2,
    voices: ['companion', 'serious'],
    defaultVoice: 'companion',
    activeVoice: 'companion',
    seriousMode: false,
    strings: STRINGS,

    defaultLocale: 'en',
    activeLocale: 'en',
    localeTable: LOCALES,

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

    /* --- locale API ------------------------------------------------ */

    // Called by `locales/<code>.js` at load. Rejects anything missing a
    // code or a strings table; never throws, because a malformed locale
    // file must degrade to "that language isn't offered" rather than
    // taking down the service worker that imported it.
    registerLocale: function (def) {
      try {
        if (!def || typeof def.code !== 'string' || !def.code) return false;
        if (!def.strings || typeof def.strings !== 'object') return false;
        if (def.code === 'en') return false; // the base is not replaceable
        LOCALES[def.code] = {
          code: def.code,
          name: def.name || def.code,
          nativeName: def.nativeName || def.name || def.code,
          dir: def.dir === 'rtl' ? 'rtl' : 'ltr',
          reviewed: !!def.reviewed,
          strings: def.strings,
        };
        return true;
      } catch (e) {
        return false;
      }
    },

    // Ignores unknown codes, so a persisted preference for a locale that
    // is no longer shipped falls back to English instead of blanking the UI.
    setLocale: function (code) {
      try {
        if (Object.prototype.hasOwnProperty.call(LOCALES, code)) this.activeLocale = code;
      } catch (e) { /* never throw */ }
    },

    // The active locale's descriptor (never null — English is always registered).
    locale: function () {
      try {
        return LOCALES[this.activeLocale] || LOCALES.en;
      } catch (e) {
        return LOCALES.en;
      }
    },

    // Every registered locale, English first then alphabetical by code, so
    // the picker's order doesn't depend on script load order.
    locales: function () {
      try {
        var codes = Object.keys(LOCALES).sort();
        var out = [LOCALES.en];
        for (var i = 0; i < codes.length; i++) {
          if (codes[i] !== 'en') out.push(LOCALES[codes[i]]);
        }
        return out;
      } catch (e) {
        return [LOCALES.en];
      }
    },

    // 'rtl' | 'ltr' for the active locale — feed this straight into the
    // document's `dir` attribute. Callers must not infer direction from
    // the locale code themselves.
    dir: function () {
      return this.locale().dir;
    },

    // Returns the active-locale, active-voice string for `key`, interpolating
    // {params}. Serious mode ALWAYS wins over activeVoice. Resolution is
    // locale+voice -> locale+companion -> English+voice -> English+companion
    // -> the key itself. Never throws.
    t: function (key, params) {
      try {
        var voice = this.seriousMode ? 'serious' : this.activeVoice;
        var str = null;
        if (this.activeLocale !== 'en') {
          var loc = LOCALES[this.activeLocale];
          str = pick(loc && loc.strings, key, voice);
        }
        if (str == null) str = pick(this.strings, key, voice);
        if (str == null) return key;
        return interpolate(str, params);
      } catch (e) {
        return key;
      }
    },
  };

  root.OL_STRINGS = OL_STRINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
