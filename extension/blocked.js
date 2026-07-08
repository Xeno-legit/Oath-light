// Blocked page — mirrors the desktop app's design system (theme × palette × atmosphere).

/* ============================================================
   THEME / PALETTE / ATMOSPHERE
   Read from chrome.storage.local, falling back to desktop defaults.
   ============================================================ */
const THEMES = ['light', 'dark'];
const STYLES = ['aurora', 'lagoon', 'dawn', 'midnight', 'forest', 'ember', 'noir'];
const BGS = ['both', 'orbs', 'waves', 'stars', 'ripple', 'smoke', 'off'];
const DEFAULTS = { theme: 'dark', style: 'aurora', bg: 'both', intensity: 7 };

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function applyDisplay(d) {
  const theme = pick(d.theme, THEMES, DEFAULTS.theme);
  const style = pick(d.style, STYLES, DEFAULTS.style);
  const bg = pick(d.bg, BGS, DEFAULTS.bg);
  let intensity = Number.isFinite(+d.intensity) ? +d.intensity : DEFAULTS.intensity;
  intensity = Math.max(0, Math.min(10, intensity));

  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-style', style);
  el.setAttribute('data-bg', bg);
  el.style.setProperty('--intensity', String(intensity / 10));

  buildBG(bg, intensity);
}

/* ============================================================
   ANIMATED BACKGROUND — mirrors desktop bg.jsx (orbs, waves,
   particles, stars, ripple, smoke). Styling lives in desktop.css.
   ============================================================ */
const rand = (min, max) => min + Math.random() * (max - min);

function wavePath(a) {
  return `M0 ${a} C 180 ${a - 28}, 360 ${a + 28}, 540 ${a} S 900 ${a - 28}, 1080 ${a} `
    + `S 1440 ${a + 28}, 1620 ${a} S 1980 ${a - 28}, 2160 ${a} V 240 H 0 Z`;
}

function buildBG(bg, intensity) {
  const root = document.querySelector('.bg');
  if (!root) return;

  // wipe everything except the legibility veil
  root.querySelectorAll(':scope > :not(.bg-veil)').forEach((n) => n.remove());

  const frag = document.createDocumentFragment();
  const showOrbs = bg === 'both' || bg === 'orbs';
  const showWaves = bg === 'both' || bg === 'waves';
  const showParticles = bg === 'both' || bg === 'orbs';
  const i10 = intensity / 10;

  // ---- ORBS ----
  if (showOrbs) {
    ['o1', 'o2', 'o3'].forEach((cls) => {
      const orb = document.createElement('div');
      orb.className = 'bg-orb ' + cls;
      frag.appendChild(orb);
    });
  }

  // ---- RISING PARTICLES ----
  if (showParticles) {
    for (let i = 0; i < 16; i++) {
      const size = rand(3, 10);
      const p = document.createElement('span');
      p.className = 'bg-particle';
      Object.assign(p.style, {
        left: rand(0, 100) + '%', bottom: '-10px',
        width: size + 'px', height: size + 'px',
        animationDuration: rand(16, 38) + 's',
        animationDelay: -rand(0, 30) + 's',
      });
      frag.appendChild(p);
    }
  }

  // ---- WAVES ----
  if (showWaves) {
    const ns = 'http://www.w3.org/2000/svg';
    const wrap = document.createElement('div');
    wrap.className = 'bg-waves';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 2160 240');
    svg.setAttribute('preserveAspectRatio', 'none');
    [['w1', 120, 'var(--orb-a)'], ['w2', 150, 'var(--orb-c)'], ['w3', 175, 'var(--orb-b)']]
      .forEach(([cls, a, fill]) => {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('class', cls);
        path.setAttribute('d', wavePath(a));
        path.setAttribute('fill', fill);
        svg.appendChild(path);
      });
    wrap.appendChild(svg);
    frag.appendChild(wrap);
  }

  // ---- STARS ----
  if (bg === 'stars') {
    for (let i = 0; i < 80; i++) {
      const size = rand(1, 3.5);
      const op = rand(0.3, 0.9);
      const s = document.createElement('span');
      Object.assign(s.style, {
        position: 'absolute',
        left: rand(0, 100) + '%', top: rand(0, 100) + '%',
        width: size + 'px', height: size + 'px',
        borderRadius: '50%', background: 'var(--text)',
        opacity: String(op * i10),
        animation: `twinkle ${rand(2, 6)}s ${-rand(0, 6)}s var(--ease-soft) infinite`,
        pointerEvents: 'none',
      });
      frag.appendChild(s);
    }
  }

  // ---- RIPPLE ----
  if (bg === 'ripple') {
    for (let i = 0; i < 4; i++) {
      const r = document.createElement('span');
      r.className = 'bg-ripple';
      r.style.animationDelay = (i * 1.8) + 's';
      r.style.opacity = String(0.18 * i10);
      frag.appendChild(r);
    }
  }

  // ---- SMOKE ----
  if (bg === 'smoke') {
    const orbVars = ['a', 'b', 'c', 'a', 'b', 'c'];
    for (let i = 0; i < 6; i++) {
      const size = rand(260, 440);
      const sm = document.createElement('span');
      Object.assign(sm.style, {
        position: 'absolute',
        left: rand(10, 90) + '%', bottom: '-80px',
        width: size + 'px', height: size + 'px',
        borderRadius: '50%',
        background: `radial-gradient(circle at 40% 40%, var(--orb-${orbVars[i]}), transparent 70%)`,
        filter: 'blur(55px)',
        opacity: String(0.35 * i10),
        animation: `smoke-drift ${rand(28, 48)}s ${-rand(0, 40)}s linear infinite`,
        pointerEvents: 'none',
      });
      frag.appendChild(sm);
    }
  }

  // insert before the veil so it stays on top
  root.insertBefore(frag, root.querySelector('.bg-veil'));
}

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
};
reasonEl.textContent = reasonMap[reason] || 'This page was blocked to help you stay focused.';

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
// Verbatim from the desktop Mentor copy (pages-mentor.jsx) — one voice everywhere.
const PANIC_WAVE_COPY = "The urge feels huge, but it's a wave — it peaks around 20 minutes and then it fades whether you feed it or not. You don't have to fight it. Just let it move through. I'm right here.";
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
    eyebrow.textContent = "You're safe here";
    title.textContent = "Let's breathe first.";
    sub.textContent = 'In for four, hold for four, out for four, hold for four. Nothing to fix right now — just follow the circle.';
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
    title.textContent = 'This will pass.';
    sub.textContent = PANIC_WAVE_COPY;
    nextBtn.textContent = "I'm still here";
    panicTimer = setTimeout(panicAdvance, PANIC_WAVE_SECS * 1000);
  } else if (panicStage === 2) {
    const gs = PANIC_GROUND_STEPS[panicStep];
    eyebrow.textContent = 'Grounding · 5-4-3-2-1';
    title.textContent = 'Come back to the room.';
    sub.textContent = gs.prompt;
    panicEl('panicGroundCount').textContent = String(gs.count);
    panicEl('panicGroundSense').textContent = gs.sense;
    nextBtn.textContent = 'Done — next';
    panicTimer = setTimeout(panicAdvance, PANIC_GROUND_STEP_SECS * 1000);
  } else {
    // Exit: no auto-timer — leaving is always the user's own choice.
    // TODO(5.4): when the urge-log store exists, report a flow-completion
    // event here and offer the one-tap urge log before exit.
    eyebrow.textContent = 'You rode it out';
    title.textContent = 'Well done. Truly.';
    sub.textContent = "The urge is already weaker than when you arrived. Choose where to go next — somewhere that feeds the person you're becoming.";
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
   APPLY DISPLAY SETTINGS (theme / palette / atmosphere / intensity)
   ============================================================ */
applyDisplay(DEFAULTS); // paint immediately with defaults, then refine from storage

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['theme', 'style', 'bg', 'intensity', 'display'], (r) => {
    if (chrome.runtime.lastError) return;
    const d = r.display && typeof r.display === 'object' ? r.display : r;
    applyDisplay({
      theme: d.theme, style: d.style, bg: d.bg, intensity: d.intensity,
    });
  });

  // live-update if settings change while the page is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (['theme', 'style', 'bg', 'intensity', 'display'].some((k) => k in changes)) {
      chrome.storage.local.get(['theme', 'style', 'bg', 'intensity', 'display'], (r) => {
        const d = r.display && typeof r.display === 'object' ? r.display : r;
        applyDisplay({ theme: d.theme, style: d.style, bg: d.bg, intensity: d.intensity });
      });
    }
  });
}
