/* Blocklist manager — desktop blocklist UX, wired to the background.
   Blacklist check + custom add/remove go through the background so this page
   never loads the multi-MB built-in domain list. */

const $ = (id) => document.getElementById(id);

/* ---------- icons ---------- */
const ICON = {
  shieldOff: ['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z', 'M5 4l14 16'],
  check: ['M5 12.5l4.5 4.5L19 6.5'],
  wave: ['M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0'],
  shield: ['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z', 'M9 12l2 2 4-4'],
  trash: ['M4 7h16M9 7V5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 5v2M6 7l1 13a1.5 1.5 0 001.5 1.4h7A1.5 1.5 0 0017 20L18 7'],
};
function svg(paths, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'svgi');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); s.appendChild(p);
  }
  return s;
}

/* ---------- helpers ---------- */
function cleanDomain(q) {
  return q.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M+';
  if (n >= 1e3) return n.toLocaleString();
  return String(n);
}
function hint(html) {
  const d = document.createElement('div');
  d.className = 'search-hint';
  d.innerHTML = html; // trusted static strings only
  return d;
}
function resultRow(kind, iconPaths, title, sub, chip) {
  const wrap = document.createElement('div');
  wrap.className = 'search-result ' + kind;
  const ico = document.createElement('div'); ico.className = 'ico'; ico.appendChild(svg(iconPaths, 20));
  const txt = document.createElement('div'); txt.className = 'txt';
  const b = document.createElement('b'); b.textContent = title;
  const sp = document.createElement('span'); sp.textContent = sub;
  txt.append(b, sp);
  const c = document.createElement('span'); c.className = 'chip'; c.textContent = chip;
  wrap.append(ico, txt, c);
  return wrap;
}

/* ---------- tabs ---------- */
function initTabs() {
  const seg = $('tabs');
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  });
}

/* ---------- blacklist search ---------- */
let blackTimer = null;
function initBlacklist() {
  const input = $('blackInput'), out = $('blackResult');
  input.addEventListener('input', () => {
    clearTimeout(blackTimer);
    const d = cleanDomain(input.value);
    if (!d) { out.textContent = ''; out.appendChild(hint('Type any website to check it against the built-in blacklist.')); return; }
    blackTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'checkDomainBlocked', domain: d }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        out.textContent = '';
        out.appendChild(res.blocked
          ? resultRow('is-blocked', ICON.shieldOff, res.domain, 'On the blacklist — fully blocked', 'Blocked')
          : resultRow('is-clear', ICON.check, res.domain, 'Not on the blacklist', 'Not blocked'));
      });
    }, 140);
  });
}

/* ---------- graylist search (static, mirrors the desktop app) ---------- */
const GRAYLIST = [
  { url: 'reddit.com', desc: 'NSFW subreddits & galleries filtered' },
  { url: 'x.com', desc: 'Sensitive media hidden, adult accounts blocked' },
  { url: 'tumblr.com', desc: 'Explicit blogs and tags filtered' },
  { url: 'youtube.com', desc: 'Restricted Mode enforced' },
  { url: 'imgur.com', desc: 'Mature albums blocked' },
  { url: 'discord.com', desc: 'Age-restricted servers blocked' },
];
function initGraylist() {
  $('graylistCount').textContent = GRAYLIST.length + ' sites';
  const input = $('grayInput'), out = $('grayResult');
  input.addEventListener('input', () => {
    const d = cleanDomain(input.value);
    out.textContent = '';
    if (!d) { out.appendChild(hint('Type any website to see if its explicit content is filtered. To block a site entirely, add it under <b>Custom sites</b>.')); return; }
    const hit = GRAYLIST.find((g) => d === g.url || d.includes(g.url) || g.url.includes(d));
    out.appendChild(hit
      ? resultRow('is-gray', ICON.wave, hit.url, hit.desc, 'Filtered')
      : resultRow('is-clear', ICON.check, d, 'Not on the graylist — block it under Custom sites if needed', 'Not filtered'));
  });
}

/* ---------- custom sites ---------- */
let customList = [];
function renderCustom() {
  const card = $('customListCard');
  card.textContent = '';
  if (!customList.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:24px; text-align:center; color:var(--muted)';
    empty.textContent = 'No custom sites yet.';
    card.appendChild(empty);
    return;
  }
  for (const url of customList) {
    const row = document.createElement('div');
    row.className = 'setting'; row.style.padding = '13px 14px';
    const ico = document.createElement('div'); ico.className = 'ico';
    ico.style.cssText = 'background:color-mix(in oklab,var(--accent-2) 14%,transparent); color:var(--accent-2)';
    ico.appendChild(svg(ICON.shield, 18));
    const txt = document.createElement('div'); txt.className = 'txt';
    const b = document.createElement('b'); b.textContent = url;
    const sp = document.createElement('span'); sp.textContent = 'Custom site';
    txt.append(b, sp);
    const rm = document.createElement('button');
    rm.className = 'btn btn-ghost btn-sm'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove ' + url);
    rm.appendChild(svg(ICON.trash, 15));
    rm.addEventListener('click', () => removeCustom(url));
    row.append(ico, txt, rm);
    card.appendChild(row);
  }
}
function customMsg(text, ok) {
  const el = $('customMsg');
  el.textContent = text || '';
  el.style.color = ok ? 'var(--accent-2)' : '#d9534f';
}
function addCustom() {
  const url = cleanDomain($('customInput').value);
  if (!url) return;
  if (!url.includes('.') || url.includes(' ')) { customMsg('Enter a valid domain (e.g. example.com)', false); return; }
  chrome.runtime.sendMessage({ action: 'addCustomDomain', domain: url }, (res) => {
    if (chrome.runtime.lastError || !res) { customMsg('Could not save. Try again.', false); return; }
    if (!res.success) {
      customMsg(res.reason === 'default' ? 'Already blocked by default.'
        : res.reason === 'exists' ? 'Already in your blocklist.'
        : 'Could not save. Try again.', false);
      return;
    }
    customList = [url, ...customList];
    $('customInput').value = '';
    customMsg('Blocked “' + url + '”.', true);
    renderCustom();
    setTimeout(() => customMsg('', true), 2200);
  });
}
function removeCustom(url) {
  chrome.runtime.sendMessage({ action: 'removeCustomDomain', domain: url }, (res) => {
    if (chrome.runtime.lastError || !res || !res.success) { customMsg('Could not remove. Try again.', false); return; }
    customList = customList.filter((d) => d !== url);
    renderCustom();
  });
}
function loadCustom() {
  chrome.runtime.sendMessage({ action: 'getCustomDomains' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    customList = res.custom || [];
    renderCustom();
    $('blacklistCount').textContent = fmtCount(res.builtIn || 0) + ' domains';
  });
}

/* ---------- protection status pill ---------- */
function loadStatus() {
  chrome.storage.local.get(['protectionEnabled'], (r) => {
    const on = r.protectionEnabled !== false;
    $('navStatus').classList.toggle('is-off', !on);
    $('navStatusText').textContent = on ? 'Protection active' : 'Protection paused';
  });
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initBlacklist();
  initGraylist();
  $('customAdd').addEventListener('click', addCustom);
  $('customInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustom(); });
  loadCustom();
  loadStatus();
});
