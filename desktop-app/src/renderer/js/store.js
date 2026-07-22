/* store.js — global app-data store for Oath Light (plain JS, uses global React) */
(function () {
  const KEY = 'oathlight_state_v2';

  const defaults = {
    page: 'home',
    // display mirrored from the Tweaks panel (source of truth = useTweaks)
    display: { theme: 'dark', style: 'noir', bg: 'both', intensity: 7 },

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
        { id: 'discord', url: 'discord.com', kind: 'discord', on: true, desc: 'Age-restricted channels & servers blocked' },
      ],
      customSites: [],
      allow: [],
    },

    blocking: {
      strictness: 'balanced', // gentle | balanced | strict
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

  const PP = {
    get() { return state; },
    set(patch) {
      state = deepMerge(state, typeof patch === 'function' ? patch(state) : patch);
      persist(); notify();
    },
    // replace a top-level key wholesale (for arrays etc.)
    put(key, value) {
      state = Object.assign({}, state, { [key]: value });
      persist(); notify();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    reset() { state = JSON.parse(JSON.stringify(defaults)); persist(); notify(); },

    // Append one urge-log entry (5.4). `trigger` is a PP.TRIGGERS id, or
    // null/omitted when skipped; `source` records where the tap came from
    // ('panic' | 'manual' — 'slip' entries are written by `relapse` below,
    // not through here). A plain array replace (`PP.set` keeps saved arrays
    // wholesale, it never merges them element-by-element), so this builds
    // the new array itself rather than relying on deepMerge to append.
    logUrge(trigger, source) {
      PP.set({ urges: capPush(state.urges, { ts: new Date().toISOString(), trigger: trigger || null, source: source || 'manual' }) });
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
  window.PP = PP;

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
