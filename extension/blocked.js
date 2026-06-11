// Blocked page — mirrors the desktop app's design system (theme × palette × atmosphere).

/* ============================================================
   THEME / PALETTE / ATMOSPHERE
   Read from chrome.storage.local, falling back to desktop defaults.
   ============================================================ */
const THEMES = ['light', 'dark'];
const STYLES = ['aurora', 'lagoon', 'dawn', 'midnight', 'forest', 'ember'];
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
  "The only person you are destined to become is the person you decide to be. — Ralph Waldo Emerson",
  "Success is the sum of small efforts repeated day in and day out. — Robert Collier",
  "You are not your urges. You are the one who decides. — Anonymous",
  "Every moment is a fresh beginning. — T.S. Eliot",
  "The best time to plant a tree was 20 years ago. The second best time is now. — Chinese Proverb",
  "Your future self will thank you for the choices you make today. — Anonymous",
  "Discipline is choosing between what you want now and what you want most. — Abraham Lincoln",
  "The pain of discipline is far less than the pain of regret. — Anonymous",
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
quoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];

/* ============================================================
   STATS
   ============================================================ */
chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Error loading stats:', chrome.runtime.lastError);
    return;
  }
  if (response && response.stats) {
    const stats = response.stats;
    document.getElementById('totalBlocks').textContent = (stats.totalBlocks || 0).toLocaleString();
    if (stats.installDate) {
      const days = Math.floor((Date.now() - new Date(stats.installDate).getTime()) / 86400000);
      document.getElementById('daysClean').textContent = Math.max(0, days);
    }
  }
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
