/* Oath Light — popup (vanilla). Wires the new UI to the background blocklist APIs. */

const $ = (id) => document.getElementById(id);

/* ---------- quotes ---------- */
const QUOTES = [
  { t: "Don't watch the clock; do what it does. Keep going.", a: "Sam Levenson" },
  { t: "Discipline is choosing between what you want now and what you want most.", a: "Abraham Lincoln" },
  { t: "The successful warrior is the average person, with laser-like focus.", a: "Bruce Lee" },
  { t: "We are what we repeatedly do. Excellence, then, is a habit.", a: "Aristotle" },
  { t: "You don't have to be great to start, but you have to start to be great.", a: "Zig Ziglar" },
  { t: "You are not your urges. You are the one who decides.", a: "Anonymous" },
  { t: "Every clear choice is a vote for the person you're becoming.", a: "Oath Light" },
];
let qi = Math.floor(Math.random() * QUOTES.length);
function renderQuote() {
  $('quoteText').textContent = QUOTES[qi].t;
  $('quoteAuthor').textContent = QUOTES[qi].a;
}
function nextQuote() {
  const text = $('quoteText'), author = $('quoteAuthor');
  text.style.opacity = '0'; author.style.opacity = '0';
  setTimeout(() => {
    qi = (qi + 1) % QUOTES.length;
    renderQuote();
    text.style.opacity = '1'; author.style.opacity = '1';
  }, 260);
}

/* ---------- domains ---------- */
function cleanUrl(q) {
  return q.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

/* ---------- quick block ---------- */
function setMsg(text, ok) {
  const el = $('blockMsg');
  el.textContent = text || '';
  el.style.color = ok ? 'var(--accent-2)' : '#e0564f';
}

/* Voice layer (UX Direction §2) — static popup copy is bound declaratively in
 * popup.html via `data-ol-str`; this is the lookup for the messages built here
 * in JS. Guarded so the popup still works if strings.js fails to load. */
function t(key, params) {
  return window.OLVoice ? window.OLVoice.t(key, params) : key;
}

function addDomain() {
  const url = cleanUrl($('blockInput').value);
  if (!url) return;
  if (!url.includes('.') || url.includes(' ')) { setMsg(t('popup.block_error_invalid'), false); return; }

  chrome.runtime.sendMessage({ action: 'addCustomDomain', domain: url }, (res) => {
    if (chrome.runtime.lastError || !res) { setMsg(t('popup.block_error_generic'), false); return; }
    if (!res.success) {
      setMsg(res.reason === 'default' ? t('popup.block_error_default')
        : res.reason === 'exists' ? t('popup.block_error_duplicate')
        : t('popup.block_error_generic'), false);
      return;
    }
    $('blockInput').value = '';
    setMsg(t('popup.block_success', { domain: url }), true);
    setTimeout(() => setMsg('', true), 2200);
  });
}

function openManager() {
  chrome.tabs.create({ url: chrome.runtime.getURL('user_blocklist.html') });
}

/* ---------- stats ---------- */
// Prefer the desktop app's canonical numbers (day streak + global block total
// summed across every browser/profile); fall back to this profile's own stats.
function loadStats() {
  chrome.storage.local.get(['ppAppData'], (store) => {
    const app = (store && store.ppAppData) || {};
    chrome.runtime.sendMessage({ action: 'getStats' }, (res) => {
      const s = (res && res.stats) || {};
      const blocks = typeof app.globalBlocks === 'number' ? app.globalBlocks : (s.totalBlocks || 0);
      $('statBlocked').textContent = blocks.toLocaleString();

      let days = null;
      if (typeof app.streak === 'number') days = app.streak;
      else if (s.installDate) days = Math.floor((Date.now() - new Date(s.installDate).getTime()) / 86400000);
      if (days !== null) $('statStreak').textContent = Math.max(0, days);
    });
  });
}

/* ---------- init ---------- */
function init() {
  try { $('ppVer').textContent = 'Version ' + chrome.runtime.getManifest().version; } catch (e) {}
  renderQuote();
  $('quote').addEventListener('click', nextQuote);
  $('blockBtn').addEventListener('click', addDomain);
  $('blockInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addDomain(); });
  $('openManagerRow').addEventListener('click', openManager);
  loadStats();
}

document.addEventListener('DOMContentLoaded', init);
