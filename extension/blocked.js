// Blocked page — mirrors the desktop app's design system (theme × look).

/* ============================================================
   THEME / LOOK
   Read from chrome.storage.local, falling back to desktop defaults.

   There is no palette axis. `data-style` used to name one of seven palettes
   and every stylesheet keyed its colours off it; Noir has been the only
   built-in theme since 2026-07-19 and the others are gone from the CSS, so
   what was left here was validating a value nothing wrote for selectors that
   no longer existed.

   There is no atmosphere axis either, as of the same rebuild. `bg` named one
   of seven animated backgrounds and `intensity` scaled how fast they moved;
   both are gone, along with the ~250 lines of DOM-building below that drew
   them. What replaced them is `look`, which is a plain attribute the CSS
   keys off — nothing is constructed in JS and nothing animates.

   This page especially had no business running a hundred animations. It is
   what someone sees at the moment they are trying to stop, and a drifting
   lava lamp is the wrong thing to put in front of them.
   ============================================================ */
const THEMES = ['light', 'dark'];
const LOOKS = ['matte', 'halo', 'field', 'theatre', 'slate', 'studio',
               'paper', 'drafting', 'cloth', 'contour', 'engrave', 'halftone'];
const NEUTRALS = ['pure', 'cool', 'warm'];
const DEFAULTS = { theme: 'dark', look: 'matte', neutral: 'pure' };

/* Voice layer (UX Direction §2) — voice-sync.js paints every `data-ol-str`
 * element in blocked.html on its own; this is the lookup for the handful of
 * strings this file builds in JS. Guarded so the page still renders if the
 * strings layer ever fails to load. */
function t(key, params) {
  return window.OLVoice ? window.OLVoice.t(key, params) : key;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function applyDisplay(d) {
  const el = document.documentElement;
  el.setAttribute('data-theme', pick(d.theme, THEMES, DEFAULTS.theme));
  el.setAttribute('data-look', pick(d.look, LOOKS, DEFAULTS.look));

  // `pure` is the CSS default and is written as an absent attribute, so the
  // :root declaration is the single source for it.
  const neutral = pick(d.neutral, NEUTRALS, DEFAULTS.neutral);
  if (neutral === 'pure') el.removeAttribute('data-neutral');
  else el.setAttribute('data-neutral', neutral);

  // The desktop app's wallpaper is deliberately NOT mirrored here. It is a
  // data URL of the user's own photograph, and pushing megabytes of image
  // through the extension's storage on every theme change — to sit behind a
  // page whose whole job is to be unwelcoming — is the wrong trade twice.
}

/* The ~120-line background builder that used to sit here is gone. It created
   between 3 and 96 elements per page load depending on the `bg` value —
   orbs, particles, an SVG wave stack, a starfield, ripple rings, smoke —
   each with randomised durations and negative delays, then spliced them in
   before a legibility veil. All of it has been replaced by one attribute and
   a handful of `--ground-*` declarations in desktop.css. */

/* ============================================================
   BLOCK REASON
   ============================================================ */
const quotes = [
  { t: "The only person you are destined to become is the person you decide to be.", a: "Ralph Waldo Emerson" },
  { t: "Success is the sum of small efforts repeated day in and day out.", a: "Robert Collier" },
  { t: "You are not your urges. You are the one who decides.", a: "Anonymous" },
  { t: "Every moment is a fresh beginning.", a: "T.S. Eliot" },
  { t: "The best time to plant a tree was 20 years ago. The second best time is now.", a: "Chinese Proverb" },
  { t: "Your future self will thank you for the choices you make today.", a: "Anonymous" },
  { t: "Discipline is choosing between what you want now and what you want most.", a: "Abraham Lincoln" },
  { t: "The pain of discipline is far less than the pain of regret.", a: "Anonymous" },
];

const urlParams = new URLSearchParams(window.location.search);
const reason = urlParams.get('reason');
const match = urlParams.get('match');

const reasonEl = document.getElementById('reason');
const reasonMap = {
  domain: `Domain blocked: ${match}`,
  keyword_domain: `Domain contains blocked keyword: ${match}`,
  keyword_path: `URL contains explicit content pattern`,
  keyword_context: `URL contains multiple NSFW indicators`,
  search_query: `Search blocked: "${match}" in query`,
  search_images: `Image search blocked: "${match}"`,
  keyword_content: `Page content blocked: ${match}`,
  blacklist_domain: `Blocked domain: ${match}`,
  explicit_domain: `Explicit domain blocked`,
  graylist_explicit: `NSFW content blocked on monitored site`,
  safesearch_bypass: `SafeSearch was disabled — bypass attempt blocked`,
  // Lockdown Mode (plan 4.4) — allowlist-only browsing. Mentor-toned, not
  // punitive: this is a wall the user chose to put up for themselves. Voiced
  // (UX Direction §2) because it's the one reason line that's a message rather
  // than a per-block detail; the rest stay literal on purpose.
  lockdown: t('blocked.reason_lockdown'),
};
reasonEl.textContent = reasonMap[reason] || t('blocked.body');

// During a lockdown, add a second line of context under the reason so it reads
// as a chosen pre-commitment, not an error. Kept out of the reasonMap so the
// existing one-line entries stay untouched.
if (reason === 'lockdown') {
  const note = document.createElement('div');
  note.style.cssText = 'font-size:13px;opacity:.7;margin-top:8px;line-height:1.5;max-width:52ch';
  note.textContent = "You set this up when you were thinking clearly. It lifts on its own when the timer ends — nothing to do but let it hold. If a site you genuinely need is blocked, you can add it from Oath Light (it takes effect after a short pause).";
  if (reasonEl.parentNode) reasonEl.parentNode.insertBefore(note, reasonEl.nextSibling);
}

/* ============================================================
   HABIT REPLACEMENT (plan 5.6)
   The user's own alternatives, pushed by the desktop app inside the blocking
   settings. Rendered as data — this page attaches no meaning to any entry, so
   nothing here needs updating when someone writes a new one.

   Nothing is shown when the list is empty, which is the default. A block
   screen that invents its own advice ("try going for a walk!") reads as a
   greeting card; one that reflects back what the user themselves decided,
   while they were thinking clearly, is the actual 5.6 mechanism.
   ============================================================ */
(function renderAlternatives() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  chrome.storage.local.get(['ppBlocking'], (r) => {
    const list = (r && r.ppBlocking && Array.isArray(r.ppBlocking.alternatives))
      ? r.ppBlocking.alternatives : [];
    if (!list.length) return;
    const box = document.getElementById('alts');
    const out = document.getElementById('altsList');
    if (!box || !out) return;

    list.slice(0, 6).forEach((alt) => {
      const text = (alt && alt.text ? String(alt.text) : '').trim();
      if (!text) return;
      // Only http(s) links become anchors — a `javascript:` or `data:` URL in
      // a user-supplied field must never become a clickable element on a page
      // that runs in every tab.
      const url = alt && alt.url ? String(alt.url).trim() : '';
      const safe = /^https?:\/\//i.test(url);
      const el = document.createElement(safe ? 'a' : 'div');
      el.className = 'alt-item';
      el.textContent = text;
      if (safe) { el.href = url; el.rel = 'noreferrer noopener'; }
      out.appendChild(el);
    });

    if (out.children.length) box.hidden = false;
  });
})();

const quoteEl = document.getElementById('quote');
const quoteTextEl = document.getElementById('quoteText');
const quoteAuthorEl = document.getElementById('quoteAuthor');
let qi = Math.floor(Math.random() * quotes.length);

function renderQuote() {
  quoteTextEl.textContent = quotes[qi].t;
  quoteAuthorEl.textContent = quotes[qi].a;
}
renderQuote();

// tap the quote to cycle to another (fades text/author out, swaps, fades back in)
quoteEl.addEventListener('click', () => {
  quoteTextEl.style.opacity = '0';
  quoteAuthorEl.style.opacity = '0';
  setTimeout(() => {
    qi = (qi + 1) % quotes.length;
    renderQuote();
    quoteTextEl.style.opacity = '1';
    quoteAuthorEl.style.opacity = '1';
  }, 260);
});

/* ============================================================
   STATS
   ============================================================ */
// Prefer the desktop app's canonical day streak + global block total (summed
// across every browser/profile); fall back to this profile's own stats.
chrome.storage.local.get(['ppAppData'], (store) => {
  const app = (store && store.ppAppData) || {};
  chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
    const stats = (response && response.stats) || {};
    const blocks = typeof app.globalBlocks === 'number' ? app.globalBlocks : (stats.totalBlocks || 0);
    const tb = document.getElementById('totalBlocks');
    if (tb) tb.textContent = blocks.toLocaleString();

    let days = null;
    if (typeof app.streak === 'number') days = app.streak;
    else if (stats.installDate) days = Math.floor((Date.now() - new Date(stats.installDate).getTime()) / 86400000);
    const dc = document.getElementById('daysClean');
    if (dc && days !== null) dc.textContent = Math.max(0, days);
  });
});

/* ============================================================
   RETURN TO SAFETY
   ============================================================ */
document.getElementById('goBackBtn').addEventListener('click', () => {
  try {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) {
        chrome.tabs.update(tab.id, { url: 'https://www.google.com' });
      } else {
        window.location.href = 'https://www.google.com';
      }
    });
  } catch (error) {
    window.location.href = 'https://www.google.com';
  }
});

/* ============================================================
   PANIC / SOS — "I need help right now" (plan item 5.1)
   Self-contained urge-surfing flow: box breathing → the 20-minute-wave
   message → 5-4-3-2-1 grounding → the user's redirect target. Mirrors the
   desktop app's pages-panic.jsx stage-for-stage; the SOS button also
   deep-links the desktop app (which surfaces its own full flow) when it's
   connected — this overlay runs either way, so the best moment to help
   never depends on the companion app.
   ============================================================ */
// The wave / breathe / exit copy now lives in the strings layer
// (`panic.*` in strings.js) so it stays identical across every surface AND
// follows the active voice — the grounding prompts below stay literal here
// because they're a fixed 5-4-3-2-1 script, not voiced copy.
const PANIC_GROUND_STEPS = [
  { count: 5, sense: 'see', prompt: 'Look around and name five things you can see.' },
  { count: 4, sense: 'hear', prompt: 'Listen for a moment. Name four things you can hear.' },
  { count: 3, sense: 'touch', prompt: 'Name three things you can feel — the chair, your feet on the floor, the air.' },
  { count: 2, sense: 'smell', prompt: 'Name two things you can smell.' },
  { count: 1, sense: 'taste', prompt: 'Name one thing you can taste.' },
];
const PANIC_BREATH_PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
const PANIC_BREATH_SECS = 64;      // four full 16s box cycles ≈ a minute
const PANIC_WAVE_SECS = 24;        // enough to actually read it, twice
const PANIC_GROUND_STEP_SECS = 20; // per grounding sense

const panicEl = (id) => document.getElementById(id);
let panicStage = 0;      // 0 breathing · 1 wave · 2 grounding · 3 exit
let panicStep = 0;       // grounding step 0..4
let panicGoTarget = null;
let panicTimer = null, panicTicker = null;

function panicClearTimers() {
  if (panicTimer) { clearTimeout(panicTimer); panicTimer = null; }
  if (panicTicker) { clearInterval(panicTicker); panicTicker = null; }
}

// The user's configured "Redirect link" (cached from the desktop app by
// bg/native-bridge.js under `ppBlocking`), or null — same normalization as
// background.js getRedirectTarget so both layers send the user to the exact
// same place.
function panicRedirectTarget(cb) {
  try {
    chrome.storage.local.get(['ppBlocking'], (r) => {
      if (chrome.runtime.lastError) { cb(null); return; }
      const b = (r && r.ppBlocking) || null;
      let u = (b && b.redirectLinkOn) ? (b.redirectUrl || '').trim() : '';
      if (u && !/^https?:\/\//i.test(u)) u = /^[^\s/]+\.[^\s/]+/.test(u) ? 'https://' + u : '';
      try {
        if (u) { const p = new URL(u); if (p.protocol !== 'http:' && p.protocol !== 'https:') u = ''; }
      } catch (_) { u = ''; }
      cb(u || null);
    });
  } catch (_) { cb(null); }
}

// Navigate this tab away — same pattern as goBackBtn above.
function panicNavigate(url) {
  try {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) chrome.tabs.update(tab.id, { url });
      else window.location.href = url;
    });
  } catch (_) {
    window.location.href = url;
  }
}

function panicRender() {
  panicClearTimers();
  panicEl('panicBreath').hidden = panicStage !== 0;
  panicEl('panicGroundBox').hidden = panicStage !== 2;
  panicEl('panicGoBtn').hidden = panicStage !== 3;
  const eyebrow = panicEl('panicEyebrow'), title = panicEl('panicTitle'), sub = panicEl('panicSub');
  const nextBtn = panicEl('panicNextBtn');

  if (panicStage === 0) {
    eyebrow.textContent = t('panic.eyebrow_safe');
    title.textContent = t('panic.breathe_title');
    sub.textContent = t('panic.breathe_sub');
    nextBtn.textContent = 'Continue';
    const started = Date.now();
    panicTicker = setInterval(() => {
      const secs = (Date.now() - started) / 1000;
      panicEl('panicPhaseLabel').textContent = PANIC_BREATH_PHASES[Math.floor(secs / 4) % 4];
      panicEl('panicPhaseCount').textContent = String(Math.min(4, Math.floor(secs % 4) + 1));
    }, 250);
    panicTimer = setTimeout(panicAdvance, PANIC_BREATH_SECS * 1000);
  } else if (panicStage === 1) {
    eyebrow.textContent = 'The wave';
    title.textContent = t('panic.wave_title');
    sub.textContent = t('panic.wave_body');
    nextBtn.textContent = t('panic.wave_cta');
    panicTimer = setTimeout(panicAdvance, PANIC_WAVE_SECS * 1000);
  } else if (panicStage === 2) {
    const gs = PANIC_GROUND_STEPS[panicStep];
    eyebrow.textContent = 'Grounding · 5-4-3-2-1';
    title.textContent = t('panic.ground_title');
    sub.textContent = gs.prompt;
    panicEl('panicGroundCount').textContent = String(gs.count);
    panicEl('panicGroundSense').textContent = gs.sense;
    nextBtn.textContent = t('panic.ground_cta');
    panicTimer = setTimeout(panicAdvance, PANIC_GROUND_STEP_SECS * 1000);
  } else {
    // Exit: no auto-timer — leaving is always the user's own choice.
    // TODO(5.4): when the urge-log store exists, report a flow-completion
    // event here and offer the one-tap urge log before exit.
    eyebrow.textContent = 'You rode it out';
    title.textContent = t('panic.exit_title');
    sub.textContent = t('panic.exit_body');
    nextBtn.textContent = 'Stay here';
    panicRedirectTarget((target) => {
      panicGoTarget = target || 'https://www.google.com';
    });
  }
}

function panicAdvance() {
  if (panicStage === 2 && panicStep < PANIC_GROUND_STEPS.length - 1) {
    panicStep += 1;
  } else {
    panicStage = Math.min(panicStage + 1, 3);
    panicStep = 0;
  }
  panicRender();
}

function openPanicFlow() {
  panicStage = 0;
  panicStep = 0;
  panicGoTarget = null;
  panicEl('panicOverlay').hidden = false;
  panicRender();
}

function closePanicFlow() {
  panicClearTimers();
  panicEl('panicOverlay').hidden = true;
}

panicEl('panicBtn').addEventListener('click', () => {
  // Best-effort deep-link: when the desktop app is connected it surfaces its
  // window and opens its own panic flow. Fire-and-forget — the in-page flow
  // below runs regardless of whether the desktop answers.
  try {
    chrome.runtime.sendMessage({ action: 'openPanic' }, () => { void chrome.runtime.lastError; });
  } catch (_) { /* not running as an extension page (e.g. file preview) */ }
  openPanicFlow();
});

panicEl('panicNextBtn').addEventListener('click', () => {
  if (panicStage === 3) closePanicFlow();
  else panicAdvance();
});

panicEl('panicGoBtn').addEventListener('click', () => {
  panicNavigate(panicGoTarget || 'https://www.google.com');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panicEl('panicOverlay').hidden) closePanicFlow();
});

/* ============================================================
   APPLY DISPLAY SETTINGS (theme / look / neutral)
   ============================================================ */
applyDisplay(DEFAULTS); // paint immediately with defaults, then refine from storage

if (typeof chrome !== 'undefined' && chrome.storage) {
  // 'bg' and 'intensity' stay in this list on purpose. They are never read
  // any more, but a profile written by an older build still has them, and a
  // storage change that only touches those keys should still trigger a
  // refresh — otherwise an upgrade leaves this page on stale values until
  // something else happens to write.
  const DISPLAY_KEYS = ['theme', 'look', 'neutral', 'bg', 'intensity', 'display'];
  const refresh = () => chrome.storage.local.get(DISPLAY_KEYS, (r) => {
    if (chrome.runtime.lastError) return;
    const d = r.display && typeof r.display === 'object' ? r.display : r;
    applyDisplay({ theme: d.theme, look: d.look, neutral: d.neutral });
  });

  refresh();

  // live-update if settings change while the page is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (DISPLAY_KEYS.some((k) => k in changes)) refresh();
  });
}
