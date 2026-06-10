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
    protection: true,

    // 14-day progress (mood/resilience score 0-100)
    progress: [],
    blockedThisWeek: 0,

    // browser extension connections that enforce blocking
    extensions: [
      { id: 'chrome', name: 'Chrome', status: 'disconnected', version: null, lastSync: null },
      { id: 'safari', name: 'Safari', status: 'disconnected', version: null, lastSync: null },
      { id: 'firefox', name: 'Firefox', status: 'disconnected', version: null, lastSync: null },
      { id: 'edge', name: 'Edge', status: 'disconnected', version: null, lastSync: null },
    ],

    blocklist: {
      blacklistDomains: '4.2M+',
      graylist: [
        { id: 'reddit', url: 'reddit.com', desc: 'NSFW subreddits & galleries filtered', on: true },
        { id: 'x', url: 'x.com', desc: 'Sensitive media hidden, adult accounts blocked', on: true },
        { id: 'tumblr', url: 'tumblr.com', desc: 'Explicit blogs and tags filtered', on: true },
        { id: 'youtube', url: 'youtube.com', desc: 'Restricted Mode enforced', on: true },
        { id: 'imgur', url: 'imgur.com', desc: 'Mature albums blocked', on: false },
        { id: 'discord', url: 'discord.com', desc: 'Age-restricted servers blocked', on: true },
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
  };
  window.PP = PP;

  // Hook
  window.usePP = function usePP() {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => PP.subscribe(() => force()), []);
    return [PP.get(), PP];
  };
})();
