/* Pure Path — popup (vanilla). Wires the new UI to the background blocklist APIs. */

const $ = (id) => document.getElementById(id);

/* ---------- quotes ---------- */
const QUOTES = [
  { t: "Don't watch the clock; do what it does. Keep going.", a: "Sam Levenson" },
  { t: "Discipline is choosing between what you want now and what you want most.", a: "Abraham Lincoln" },
  { t: "The successful warrior is the average person, with laser-like focus.", a: "Bruce Lee" },
  { t: "We are what we repeatedly do. Excellence, then, is a habit.", a: "Aristotle" },
  { t: "You don't have to be great to start, but you have to start to be great.", a: "Zig Ziglar" },
  { t: "You are not your urges. You are the one who decides.", a: "Anonymous" },
  { t: "Every clear choice is a vote for the person you're becoming.", a: "Pure Path" },
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

function addDomain() {
  const url = cleanUrl($('blockInput').value);
  if (!url) return;
  if (!url.includes('.') || url.includes(' ')) { setMsg('Enter a valid domain (e.g. example.com)', false); return; }

  chrome.runtime.sendMessage({ action: 'addCustomDomain', domain: url }, (res) => {
    if (chrome.runtime.lastError || !res) { setMsg('Could not save. Try again.', false); return; }
    if (!res.success) {
      setMsg(res.reason === 'default' ? 'Already blocked by default.'
        : res.reason === 'exists' ? 'Already in your blocklist.'
        : 'Could not save. Try again.', false);
      return;
    }
    $('blockInput').value = '';
    setMsg('Blocked “' + url + '”.', true);
    setTimeout(() => setMsg('', true), 2200);
  });
}

function openManager() {
  chrome.tabs.create({ url: chrome.runtime.getURL('user_blocklist.html') });
}

/* ---------- stats ---------- */
function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.stats) return;
    const s = res.stats;
    $('statBlocked').textContent = (s.totalBlocks || 0).toLocaleString();
    if (s.installDate) {
      const days = Math.floor((Date.now() - new Date(s.installDate).getTime()) / 86400000);
      $('statStreak').textContent = Math.max(0, days);
    }
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
