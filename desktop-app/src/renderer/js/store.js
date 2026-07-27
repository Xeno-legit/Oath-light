/* store.js — global app-data store for Oath Light (plain JS, uses global React) */
(function () {
  const KEY = 'oathlight_state_v2';

  const defaults = {
    page: 'home',
    // display mirrored from the Tweaks panel (source of truth = useTweaks).
    // `style` is pinned to 'noir' — the only built-in theme (UX Direction §7).
    display: { theme: 'dark', style: 'noir', bg: 'both', intensity: 7 },

    // User-custom theme (UX Direction §7). Not a palette PRESET — presets are
    // gone. These are runtime overrides of the design system's own color
    // tokens (`--ol-*`), applied as inline custom properties on the root
    // element on top of the Noir defaults, exactly the mechanism
    // design-system/preview.html uses for editing. Kept per theme side because
    // a color that reads well on black rarely reads well on white; an empty
    // object on a side simply means "Noir's own values".
    customTokens: { dark: {}, light: {} },

    streak: 0,
    bestStreak: 0,
    // ISO timestamp the current clean streak started from. The live `streak`
    // above is derived from this on load (and hourly) so the day counter
    // actually advances instead of sitting at a static number.
    streakStart: null,
    protection: true,

    // Urge log & trigger analytics (5.4). Each entry:
    //   { ts: ISO string, trigger: 'bored'|'stressed'|'late'|'lonely'|null, source: 'panic'|'manual'|'slip' }
    // Capped (see PP.logUrge/relapse) so this never grows unbounded on a long
    // -running profile. `source` records where the tap came from — the panic
    // flow's exit stage, a manual one-tap on Overview, or a logged slip —
    // without changing the shape analytics reads.
    urges: [],

    // Compassionate streak design (5.5). Slips are recorded as data, not just
    // a zeroed counter — `slips` is a capped list of ISO timestamps, each
    // slip also mirrored into `urges` (source: 'slip') so it counts toward
    // the same trigger analytics. The 24h "gentle mode" window is DERIVED
    // from the last slip timestamp (see PP.isGentle) — deliberately not a
    // stored field, so it can never disagree with the slip log. (A stale
    // `gentleUntil` key from an earlier build merges in harmlessly and is
    // never read.) `lastMilestone` is the highest streak milestone already
    // celebrated for the CURRENT streak (reset to 0 on a slip) — persisted
    // so a milestone is celebrated exactly once, even across app restarts.
    slips: [],
    lastMilestone: 0,

    // 14-day progress (mood/resilience score 0-100)
    progress: [],
    blockedThisWeek: 0,

    // Live browser/extension status is sourced from the desktop app's monitor
    // (see tauri-bridge.jsx → useBrowsers), not persisted here.

    blocklist: {
      // Dead field, kept only so old persisted state merges cleanly — nothing
      // renders it anymore. The real count comes live from the backend via
      // useBlocklistCounts(); no hardcoded stats, ever again.
      blacklistDomains: null,
      // Canonical Graylist V2 list — keep in sync with
      // extension/graylist-sites.js. kind: 'api' = NSFW items stripped from the
      // site's fetched JSON; 'dom' = adult items removed from server-rendered
      // pages + adult content pages hard-blocked.
      graylist: [
        { id: 'reddit', url: 'reddit.com', kind: 'api', on: true, desc: 'NSFW posts stripped from feeds; explicit search & subreddits blocked' },
        { id: 'x', url: 'x.com', kind: 'api', on: true, desc: 'Sensitive media stripped from timelines (also twitter.com)' },
        { id: 'tumblr', url: 'tumblr.com', kind: 'api', on: true, desc: 'NSFW posts stripped from the dashboard' },
        { id: 'pixiv', url: 'pixiv.net', kind: 'api', on: true, desc: 'R-18 artwork stripped from listings' },
        { id: 'mastodon', url: 'mastodon.social', kind: 'api', on: true, desc: 'Mastodon (all instances) — sensitive posts stripped' },
        { id: 'imgur', url: 'imgur.com', kind: 'api', on: true, desc: 'NSFW images stripped from galleries' },
        { id: 'nexusmods', url: 'nexusmods.com', kind: 'api', on: true, desc: 'Adult mods stripped from listings' },
        { id: 'vimeo', url: 'vimeo.com', kind: 'api', on: true, desc: 'Adult-rated videos stripped from feeds' },
        { id: 'dailymotion', url: 'dailymotion.com', kind: 'api', on: true, desc: 'Explicit videos stripped; family filter enforced' },
        { id: 'odysee', url: 'odysee.com', kind: 'api', on: true, desc: 'Mature content stripped from feeds' },
        { id: 'patreon', url: 'patreon.com', kind: 'api', on: true, desc: 'NSFW posts stripped from feeds' },
        { id: 'gumroad', url: 'gumroad.com', kind: 'api', on: true, desc: 'Adult products stripped from listings' },
        { id: 'minds', url: 'minds.com', kind: 'api', on: true, desc: 'NSFW posts stripped from feeds' },
        { id: 'itaku', url: 'itaku.ee', kind: 'api', on: true, desc: 'NSFW & questionable art stripped' },
        { id: 'peertube', url: 'PeerTube', kind: 'api', on: true, desc: 'PeerTube (all instances) — NSFW videos stripped' },
        { id: 'lemmy', url: 'Lemmy', kind: 'api', on: true, desc: 'Lemmy (all instances) — NSFW posts & communities stripped' },
        { id: 'mangadex', url: 'mangadex.org', kind: 'api', on: true, desc: 'Erotica & pornographic manga stripped' },
        { id: 'artstation', url: 'artstation.com', kind: 'api', on: true, desc: 'Adult-content artwork stripped' },
        { id: 'flickr', url: 'flickr.com', kind: 'api', on: true, desc: 'Moderate & restricted photos stripped' },
        { id: 'sketchfab', url: 'sketchfab.com', kind: 'api', on: true, desc: 'Age-restricted 3D models stripped from listings & search' },
        { id: '500px', url: '500px.com', kind: 'api', on: true, desc: 'NSFW (notSafeForWork) photos stripped from feeds & search' },
        { id: 'gamebanana', url: 'gamebanana.com', kind: 'api', on: true, desc: 'NSFW/sexual mods stripped from browse & search feeds' },
        { id: 'wattpad', url: 'wattpad.com', kind: 'api', on: true, desc: 'Mature-rated stories stripped from search, browse & feeds' },
        { id: 'fanbox', url: 'fanbox.cc', kind: 'api', on: true, desc: 'R-18 creators & posts stripped from feeds (Pixiv Fanbox)' },
        { id: 'newgrounds', url: 'newgrounds.com', kind: 'dom', on: true, desc: 'Adult (A-rated) work removed; adult pages blocked' },
        { id: 'ao3', url: 'archiveofourown.org', kind: 'dom', on: true, desc: 'Explicit & Mature works removed' },
        { id: 'fanfiction', url: 'fanfiction.net', kind: 'dom', on: true, desc: 'M/MA-rated stories removed' },
        { id: 'scribblehub', url: 'scribblehub.com', kind: 'dom', on: true, desc: 'Adult/smut web-fiction removed; adult series & genre pages blocked' },
        { id: 'itch', url: 'itch.io', kind: 'dom', on: true, desc: 'Adult games blocked at the content-warning gate' },
        { id: 'steam', url: 'steampowered.com', kind: 'dom', on: true, desc: 'Adult games age-gated → blocked; mature community content blocked' },
        { id: 'webtoons', url: 'webtoons.com', kind: 'dom', on: true, desc: 'Mature (15+/18+) series & episodes blocked' },
        { id: 'tapas', url: 'tapas.io', kind: 'dom', on: true, desc: 'Mature series & episodes removed/blocked at the content gate' },
        { id: 'kofi', url: 'ko-fi.com', kind: 'dom', on: true, desc: 'NSFW-tagged creator pages blocked at the adult-content gate' },
        { id: 'writingcom', url: 'writing.com', kind: 'dom', on: true, desc: 'Adult (18+/GC/XGC) items removed from listings & feeds; adult item pages blocked' },
        { id: 'youtube', url: 'youtube.com', kind: 'enforce', on: true, desc: 'Restricted Mode forced (PREF cookie); explicit/suggestive searches blocked' },
        { id: 'spotify', url: 'spotify.com', kind: 'enforce', on: true, desc: 'Explicit erotica/adult audio searches blocked' },
        { id: 'characterai', url: 'character.ai', kind: 'enforce', on: true, desc: 'NSFW character searches blocked; the platform stays usable' },
        { id: 'poe', url: 'poe.com', kind: 'enforce', on: true, desc: 'NSFW bot searches blocked; the platform stays usable' },
        { id: 'huggingface', url: 'huggingface.co', kind: 'enforce', on: true, desc: 'NSFW model & dataset searches blocked; ordinary model browsing untouched' },
        { id: 'discord', url: 'discord.com', kind: 'discord', on: true, desc: 'Age-restricted channels & servers blocked' },
      ],
      customSites: [],
      allow: [],
    },

    blocking: {
      // Strictness preset (6.4): standard | strict | lockdown. See PP.PRESETS
      // for what each one actually changes — this is no longer a decorative
      // label, the extension reads it to decide whether the higher-false-
      // positive layers are armed. Older builds stored gentle|balanced|strict;
      // those migrate on load (see migrateStrictness).
      strictness: 'standard',
      sensitivity: 72,
      lock: true,
      uninstallGuard: true,
      safeSearch: true,
      youtubeRestrict: false, // opt-in strictness — enforced by the extension via a YouTube-Restrict header rule
      blockApps: true,
      incognitoBlock: true,
      breakRequest: true,
      redirectUrl: '',
      redirectLinkOn: false,
      redirectOffline: false,
      redirectOfflinePath: '',
      bgSongEnabled: false,
      bgSongPath: '',
      vulnerable: { on: true, start: '22:00', end: '06:00' },
      // Grayscale the display during the vulnerable-hours window (5.6).
      // Backend-owned (settings.rs) — this is the renderer's mirror; the
      // Blocking page writes it through `set_grayscale_vulnerable_hours`.
      grayscaleVulnerable: false,
      // Habit replacement (5.6): the user's OWN alternatives, shown on the
      // block screen. A wall says "no"; this says "here's the thing you
      // already decided you'd rather be doing". Each entry is
      // `{ id, text, url }` — `url` optional, and when present the block page
      // makes the entry a link. Empty by default: a generic suggestion is
      // worse than none, because the whole point is that the user wrote it.
      alternatives: [],
      alerts: [
        { id: 'checkin', label: 'Gentle check-in', desc: 'A soft “still with me?” prompt to keep you company.', on: true },
        { id: 'quote', label: 'Motivational reminder', desc: 'A short line to reconnect you with your why.', on: false },
      ],
    },

    // `chat` (the old fake-mentor transcript) is gone — the recovery program
    // (5.3) keeps reflections ephemeral. A stale `chat` key in old persisted
    // state merges in harmlessly and is simply never read.

    profile: {
      name: 'You',
      email: '',
      partner: '',
      member: '',
      tz: '',
    },
    notif: { daily: true, milestone: true, partner: true, urge: false, weekly: true },

    // Voice layer (UX Direction §2). The user's tone choice, picked at
    // onboarding and changeable in Settings — 'companion' | 'serious'. This is
    // a plain preference and lives here; Serious Mode (below) is NOT, and
    // overrides it whenever it's on.
    voice: 'companion',

    // Serious Mode (UX Direction §1) — MIRROR ONLY. The backend
    // (settings.rs `serious_mode`) is the source of truth, because turning it
    // OFF is a friction-gated weakening that a renderer flag must never be
    // able to shortcut. `useSeriousMode()` in tauri-bridge.jsx polls the
    // backend and writes the answer here so the UI has something synchronous
    // to render from; nothing in the renderer should ever set this to false
    // on its own. Outside Tauri (standalone preview) it simply stays false.
    serious: false,

    // First-run onboarding (6.4). Set once the wizard is completed or skipped,
    // so it never reappears. Absent/false on a fresh install = show it.
    onboarded: false,
  };

  // Whole days elapsed since an ISO timestamp (0 if missing/invalid).
  function daysSince(iso) {
    const start = iso ? new Date(iso).getTime() : NaN;
    if (!isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  }

  // Streak milestones celebrated by the overview (5.5) — the ONE canonical
  // list, exposed as PP.MILESTONES so the backfill below, PP.relapse's reset
  // and the overview's celebration/next-milestone UI can never drift apart.
  const MILESTONES = [7, 14, 30, 60, 90, 180, 365];
  // Trigger vocabulary for the urge log (5.4) — the ONE canonical list,
  // exposed as PP.TRIGGERS. Consumed by the panic flow's exit tags, the
  // overview's quick-log and the slip dialog; ids are what analytics buckets
  // on, so a new trigger only ever needs adding here.
  const TRIGGERS = [
    { id: 'bored', label: 'Bored' },
    { id: 'stressed', label: 'Stressed' },
    { id: 'late', label: 'Late night' },
    { id: 'lonely', label: 'Lonely' },
  ];
  // ── Strictness presets (plan 6.4) ────────────────────────────────────────
  // Three named starting points, offered in the first-run wizard and on the
  // Blocking page. Each `settings` bundle is applied to the RENDERER-owned
  // blocking settings only.
  //
  // Hard rule, and the reason this isn't just a big Object.assign: a preset
  // may only ever STRENGTHEN. Backend-owned protections (uninstall guard, DNS
  // filter, AI monitor, lockdown escalation) each have their own friction-gated
  // disable path in Rust, and letting "switch to Standard" quietly weaken them
  // from the renderer would be a hole straight through 4.1's whole design.
  // `backendOn` lists protections a preset asks to turn ON — a strengthening,
  // always instant and safe. Nothing here ever turns one off.
  const PRESETS = [
    {
      id: 'standard',
      name: 'Standard',
      desc: 'The full blocklist, graylist filtering and SafeSearch. What most people want.',
      settings: { safeSearch: true, youtubeRestrict: false },
      backendOn: [],
    },
    {
      id: 'strict',
      name: 'Strict',
      desc: 'Adds YouTube Restricted Mode and URL-pattern matching on unlisted sites. Blocks more, and occasionally blocks something innocent.',
      settings: { safeSearch: true, youtubeRestrict: true },
      backendOn: [],
    },
    {
      id: 'lockdown',
      name: 'Lockdown',
      desc: 'Everything in Strict, plus your vulnerable hours automatically escalate to allowlist-only browsing.',
      settings: { safeSearch: true, youtubeRestrict: true, vulnerable: { on: true } },
      backendOn: ['lockdownEscalation'],
    },
  ];

  // Older builds stored gentle|balanced|strict. Map them onto the real presets
  // rather than leaving a value nothing understands: gentle/balanced were both
  // "the defaults", and strict keeps its name and meaning.
  function migrateStrictness(value) {
    if (value === 'gentle' || value === 'balanced') return 'standard';
    return PRESETS.some((p) => p.id === value) ? value : 'standard';
  }

  // Cap for the urges/slips logs — old entries drop off the front so a
  // long-running profile never grows these unbounded.
  const LOG_CAP = 500;
  // Append to a log list, enforcing LOG_CAP — the one code path every log
  // write goes through, so no future write site can forget the cap.
  function capPush(list, entry) {
    const out = (list || []).slice();
    out.push(entry);
    while (out.length > LOG_CAP) out.shift();
    return out;
  }
  const GENTLE_MS = 24 * 60 * 60 * 1000;

  function deepMerge(base, over) {
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in over) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k]) out[k] = deepMerge(base[k], over[k]);
      else out[k] = over[k];
    }
    return out;
  }

  let state;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = saved ? deepMerge(defaults, saved) : defaults;
    // never persist transient page across the very first load issues — keep page though, it's nice
  } catch (e) { state = defaults; saved = null; }

  // The graylist is a built-in catalog, not user-editable state — always source
  // it from code so the canonical list ships without being shadowed by a stale
  // persisted copy (deepMerge keeps saved arrays wholesale).
  try { if (state && state.blocklist) state.blocklist.graylist = defaults.blocklist.graylist; } catch (e) {}

  // Preset-name migration (6.4) — a persisted gentle/balanced value would
  // otherwise sit there matching no preset, leaving the Blocking page with
  // nothing selected and the extension with a strictness it doesn't know.
  try {
    if (state && state.blocking) state.blocking.strictness = migrateStrictness(state.blocking.strictness);
  } catch (e) {}

  // ── Voice layer (UX Direction §2) ─────────────────────────────────────────
  // Push the store's voice/serious values into the shared OL_STRINGS instance
  // (strings.js, byte-identical to design-system/strings.js) and mirror
  // Serious Mode onto the root element, which is where tokens.css hangs its
  // `[data-serious]` visual overrides. Called on load and after every state
  // change, so `PP.t()` never has to re-derive anything per call and a flip
  // repaints copy AND chrome together in one render.
  function syncVoice() {
    try {
      const S = window.OL_STRINGS;
      if (S) {
        S.setVoice(state.voice || S.defaultVoice);
        S.setSeriousMode(!!state.serious);
      }
      const el = document.documentElement;
      if (state.serious) el.setAttribute('data-serious', '');
      else el.removeAttribute('data-serious');
    } catch (e) { /* never let a voice sync break a render */ }
  }
  syncVoice();

  const subs = new Set();
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }, 120);
  }
  function notify() { subs.forEach((fn) => fn(state)); }

  // Milestone backfill (5.5): an install that predates `lastMilestone`
  // shouldn't "celebrate" progress it already had the moment this feature
  // ships — silently mark whatever milestone the CURRENT streak already
  // cleared as already-celebrated. A fresh install (or one that already has
  // the field, even at its legitimate 0) is left alone so a real, new
  // milestone still celebrates normally. Persisted immediately: nothing else
  // is guaranteed to write the store this session (initStreak's recompute
  // no-ops when the derived streak is unchanged), and an unpersisted
  // backfill would silently re-derive differently next launch.
  if (saved && saved.lastMilestone === undefined) {
    const cleared = MILESTONES.filter((m) => (Number(state.streak) || 0) >= m).pop();
    if (cleared) { state.lastMilestone = cleared; persist(); }
  }

  // Onboarding backfill (6.4), same reasoning as the milestone backfill above:
  // an install that predates the wizard has already been set up by hand, and
  // shoving a first-run flow in front of an existing user on upgrade day would
  // be worse than never shipping one. Only a genuinely fresh profile (no saved
  // state at all) sees it. A profile that already carries the field — even at
  // its legitimate `false` — is left alone.
  if (saved && saved.onboarded === undefined) {
    state.onboarded = true;
    persist();
  }

  const PP = {
    get() { return state; },
    set(patch) {
      state = deepMerge(state, typeof patch === 'function' ? patch(state) : patch);
      syncVoice(); persist(); notify();
    },
    // replace a top-level key wholesale (for arrays etc.)
    put(key, value) {
      state = Object.assign({}, state, { [key]: value });
      syncVoice(); persist(); notify();
    },

    // The renderer's one string lookup (UX Direction §2). Delegates to the
    // shared OL_STRINGS, which `syncVoice` keeps pointed at the active voice —
    // and which forces the hard voice whenever Serious Mode is on, regardless
    // of the user's `voice` choice. Falls back to the key itself on a typo
    // (strings.js's contract), so a bad key is visible instead of blank.
    t(key, params) {
      const S = window.OL_STRINGS;
      return S ? S.t(key, params) : key;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    reset() { state = JSON.parse(JSON.stringify(defaults)); persist(); notify(); },

    // Apply a strictness preset (6.4). Renderer-owned settings are merged in
    // directly; anything a preset wants turned on in the BACKEND goes through
    // the ordinary strengthening command (instant, never gated). Presets never
    // weaken — see PRESETS' comment — so there is deliberately no path here
    // that turns a backend protection off, whichever preset is chosen.
    applyPreset(id) {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      PP.set({ blocking: Object.assign({ strictness: preset.id }, preset.settings) });
      if (preset.backendOn.includes('lockdownEscalation')) {
        const N = window.PPNative;
        if (N && N.available) N.setLockdownEscalation(true, null).catch(() => {});
      }
    },

    // Append one urge-log entry (5.4). `trigger` is a PP.TRIGGERS id, or
    // null/omitted when skipped; `source` records where the tap came from
    // ('panic' | 'manual' — 'slip' entries are written by `relapse` below,
    // not through here).
    //
    // The BACKEND owns this data now (recovery.rs, 5.4/5.5) — localStorage is
    // an offline mirror, kept so the standalone renderer preview still works.
    // Both are written: the local one immediately (so the UI never waits on a
    // round-trip), the backend one authoritatively, with its reply replacing
    // local state wholesale. `PP.set` keeps saved arrays whole rather than
    // merging element-by-element, so these build the new array themselves.
    logUrge(trigger, source) {
      PP.set({ urges: capPush(state.urges, { ts: new Date().toISOString(), trigger: trigger || null, source: source || 'manual' }) });
      const N = window.PPNative;
      if (N && N.available) N.logUrge(trigger, source || 'manual').then(adoptRecoveryView);
    },

    // Compassionate streak design (5.5): a slip is recorded as data — not
    // just a zeroed counter. Keeps `bestStreak` (never regresses), logs the
    // slip's timestamp (which is also what starts the derived 24h gentle
    // window — see isGentle), mirrors it into the urge log (source: 'slip')
    // so trigger analytics sees it too, and resets `lastMilestone` since a
    // new streak starts earning milestones from zero. `trigger` is optional,
    // same vocabulary as `logUrge`.
    relapse(trigger) {
      const best = Math.max(Number(state.bestStreak) || 0, Number(state.streak) || 0);
      const nowIso = new Date().toISOString();
      PP.set({
        streakStart: nowIso,
        streak: 0,
        bestStreak: best,
        slips: capPush(state.slips, nowIso),
        urges: capPush(state.urges, { ts: nowIso, trigger: trigger || null, source: 'slip' }),
        lastMilestone: 0,
      });
      const N = window.PPNative;
      if (N && N.available) N.logSlip(trigger).then(adoptRecoveryView);
    },

    // Record that a milestone was celebrated (5.5), so it fires exactly once.
    // Monotonic on both sides — safe to call from a render effect.
    markMilestone(days) {
      if ((Number(days) || 0) > (Number(state.lastMilestone) || 0)) PP.set({ lastMilestone: days });
      const N = window.PPNative;
      if (N && N.available) N.markMilestone(days).then(adoptRecoveryView);
    },

    // True while the most recent slip is less than 24h old — derived straight
    // from the slip log so gentle mode can never disagree with it. The
    // overview reads this to tone down streak-centric copy instead of
    // showing a bare "Day 0".
    isGentle() {
      const slips = state.slips || [];
      const last = slips.length ? new Date(slips[slips.length - 1]).getTime() : NaN;
      return isFinite(last) && Date.now() - last < GENTLE_MS;
    },

    // Derived "clean days this month" (5.5): calendar days elapsed so far
    // this month, minus the distinct calendar days that contain a logged
    // slip — so a slip dents the month instead of erasing the streak number
    // outright. Never negative.
    cleanDaysThisMonth() {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const daysElapsed = now.getDate(); // 1..31, inclusive of today
      const slipDays = new Set();
      (state.slips || []).forEach((iso) => {
        const d = new Date(iso);
        if (!isFinite(d.getTime())) return;
        if (d.getFullYear() === y && d.getMonth() === m) slipDays.add(d.getDate());
      });
      return Math.max(0, daysElapsed - slipDays.size);
    },
  };
  // Canonical shared lists (see their definitions above) — pages must read
  // these off PP instead of declaring their own copies.
  PP.MILESTONES = MILESTONES;
  PP.TRIGGERS = TRIGGERS;
  PP.GENTLE_MS = GENTLE_MS;
  PP.PRESETS = PRESETS;
  window.PP = PP;

  // ── Recovery data: backend-owned (5.4/5.5) ────────────────────────────────
  // Replace the local mirror with a `RecoveryView` from recovery.rs. Called on
  // startup and after every write. Everything here is DERIVED server-side, so
  // this is a wholesale adoption, not a merge — the point of the move is that
  // there is one answer to "what is my streak", and it is the backend's.
  //
  // Timestamps cross the bridge as unix SECONDS; the renderer's own log format
  // is ISO strings (it predates the backend and the analytics code reads it),
  // so they're converted here rather than changing every read site.
  function adoptRecoveryView(view) {
    if (!view) return;
    const iso = (secs) => new Date((Number(secs) || 0) * 1000).toISOString();
    PP.put('urges', (view.urges || []).map((u) => ({
      ts: iso(u.ts), trigger: u.trigger || null, source: u.source || 'manual',
    })));
    PP.put('slips', (view.slips || []).map(iso));
    PP.set({
      streak: Number(view.streak) || 0,
      bestStreak: Number(view.best_streak) || 0,
      lastMilestone: Number(view.last_milestone) || 0,
      // Keep the local anchor consistent with the adopted streak so
      // `initStreak`'s hourly recompute agrees with the backend instead of
      // fighting it across midnight.
      streakStart: new Date(Date.now() - (Number(view.streak) || 0) * 86400000).toISOString(),
    });
  }
  window.__adoptRecoveryView = adoptRecoveryView;

  // Startup hydration + one-time migration.
  //
  // This deliberately POLLS for `PPNative` instead of running on a microtask.
  // `tauri-bridge.jsx` — which defines it — is a `type="text/babel"` script,
  // and babel-standalone transforms those asynchronously, well after this
  // plain script has finished. A `Promise.resolve().then(...)` here therefore
  // fires while `window.PPNative` is still undefined, and the hydration
  // silently never happens: the streak reads 0 and the urge log looks empty
  // even though the backend has both. (Found by rendering the app; a syntax
  // check can't see it.) Bounded at ~5s so a build without the bridge at all
  // gives up rather than polling forever.
  (function hydrateRecovery(attempt) {
    const N = window.PPNative;
    if (!N) {
      if (attempt < 100) setTimeout(() => hydrateRecovery(attempt + 1), 50);
      return;
    }
    // Outside Tauri (the standalone preview) the localStorage mirror stands
    // on its own — nothing to hydrate from.
    if (!N.available) return;
    // Offer whatever streak localStorage still holds. The backend adopts it
    // only if it's EARLIER than its own anchor and only while it has no
    // history — see `migrate_streak_start`. Then adopt whatever it says.
    const startSecs = Math.floor(new Date(state.streakStart || Date.now()).getTime() / 1000);
    N.migrateRecoveryStreak(startSecs, Number(state.bestStreak) || 0)
      .then((view) => view || N.getRecoveryLog())
      .then(adoptRecoveryView)
      .catch(() => {});
  })(0);

  // Day counter — anchor a start date and derive the live streak from it.
  (function initStreak() {
    if (!state.streakStart) {
      // First run, or migrating an older state that only had a static number:
      // backdate the anchor so the existing streak value carries over.
      const base = Number(state.streak) || 0;
      state.streakStart = new Date(Date.now() - base * 86400000).toISOString();
    }
    const recompute = () => {
      const d = daysSince(state.streakStart);
      const best = Math.max(Number(state.bestStreak) || 0, d);
      if (d !== state.streak || best !== state.bestStreak) PP.set({ streak: d, bestStreak: best });
    };
    recompute();
    // Re-check hourly so an app left open across midnight still ticks over.
    setInterval(recompute, 60 * 60 * 1000);
  })();

  // Hook
  window.usePP = function usePP() {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => PP.subscribe(() => force()), []);
    return [PP.get(), PP];
  };
})();
