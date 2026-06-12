/* store.js — global app-data store for Pure Path (plain JS, uses global React) */
(function () {
  const KEY = 'purepath_state_v2';

  const seedChat = [
    { role: 'mentor', text: "Hi — I'm here with you. This is a safe space. Whatever you're feeling right now, we can work through it together. What's on your mind?" },
  ];

  const defaults = {
    page: 'home',
    // display mirrored from the Tweaks panel (source of truth = useTweaks)
    display: { theme: 'dark', style: 'aurora', bg: 'both', intensity: 7 },

    streak: 0,
    bestStreak: 0,
    // ISO timestamp the current clean streak started from. The live `streak`
    // above is derived from this on load (and hourly) so the day counter
    // actually advances instead of sitting at a static number.
    streakStart: null,
    protection: true,

    // 14-day progress (mood/resilience score 0-100)
    progress: [],
    blockedThisWeek: 0,

    // Live browser/extension status is sourced from the desktop app's monitor
    // (see tauri-bridge.jsx → useBrowsers), not persisted here.

    blocklist: {
      blacklistDomains: '4.2M+',
      // Canonical Graylist V2 list — keep in sync with
      // extension/graylist-sites.js. kind: 'api' = NSFW items stripped from the
      // site's fetched JSON; 'dom' = adult items removed from server-rendered
      // pages + adult content pages hard-blocked.
      graylist: [
        { id: 'reddit', url: 'reddit.com', kind: 'api', on: true, desc: 'NSFW posts stripped from feeds; explicit search & subreddits blocked' },
        { id: 'x', url: 'x.com', kind: 'api', on: true, desc: 'Sensitive media stripped from timelines (also twitter.com)' },
        { id: 'tumblr', url: 'tumblr.com', kind: 'api', on: true, desc: 'NSFW posts stripped from the dashboard' },
        { id: 'pixiv', url: 'pixiv.net', kind: 'api', on: true, desc: 'R-18 artwork stripped from listings' },
        { id: 'bluesky', url: 'bsky.app', kind: 'api', on: true, desc: 'Adult-labelled posts stripped' },
        { id: 'mastodon', url: 'mastodon.social', kind: 'api', on: true, desc: 'Mastodon (all instances) — sensitive posts stripped' },
        { id: 'deviantart', url: 'deviantart.com', kind: 'api', on: true, desc: 'Mature deviations stripped from listings' },
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
        { id: 'newgrounds', url: 'newgrounds.com', kind: 'dom', on: true, desc: 'Adult (A-rated) work removed; adult pages blocked' },
        { id: 'ao3', url: 'archiveofourown.org', kind: 'dom', on: true, desc: 'Explicit & Mature works removed' },
        { id: 'furaffinity', url: 'furaffinity.net', kind: 'dom', on: true, desc: 'Adult & Mature submissions removed' },
        { id: 'fanfiction', url: 'fanfiction.net', kind: 'dom', on: true, desc: 'M/MA-rated stories removed' },
        { id: 'inkbunny', url: 'inkbunny.net', kind: 'dom', on: true, desc: 'Adult submissions removed' },
        { id: 'sofurry', url: 'sofurry.com', kind: 'dom', on: true, desc: 'Adult content removed' },
        { id: 'weasyl', url: 'weasyl.com', kind: 'dom', on: true, desc: 'Mature & explicit submissions removed' },
        { id: 'itch', url: 'itch.io', kind: 'dom', on: true, desc: 'Adult games blocked at the content-warning gate' },
        { id: 'steam', url: 'steampowered.com', kind: 'dom', on: true, desc: 'Adult games age-gated → blocked; mature community content blocked' },
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

    chat: seedChat.slice(),

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
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = saved ? deepMerge(defaults, saved) : defaults;
    // never persist transient page across the very first load issues — keep page though, it's nice
  } catch (e) { state = defaults; }

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
    // Restart the clean streak from now (keeps the best-streak record).
    relapse() {
      const best = Math.max(Number(state.bestStreak) || 0, Number(state.streak) || 0);
      PP.set({ streakStart: new Date().toISOString(), streak: 0, bestStreak: best });
    },
  };
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
