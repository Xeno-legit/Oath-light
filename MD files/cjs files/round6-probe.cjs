// Round 6 adversarial probe / retest — maps Pure Path's PERIMETER coverage and
// asserts the Round-6 fixes (§13). No explicit content is fetched; this only asks
// "would the perimeter block this URL shape?".
//
//   logic()  = the REAL shouldBlockUrl() from extension/background.js (vm).
//   bl()     = membership in the REAL 100k-domain blacklist JSONs (loaded here,
//              since the vm can't lazy-load them).
// Each row declares an expectation: 'block' | 'allow'. 'allow' rows are either
// intended-usable surfaces (no over-block) or documented residuals.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const blDir = path.join(__dirname, 'extension', 'blocklists');
const blacklist = new Set();
for (const f of fs.readdirSync(blDir)) {
  if (!/^domains_part\d+\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(blDir, f), 'utf8'));
  for (const d of (j.domains || [])) blacklist.add(d);
}
function inBlacklist(hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (blacklist.has(parts.slice(i).join('.'))) return parts.slice(i).join('.');
  }
  return null;
}

const src = fs.readFileSync(path.join(__dirname, 'extension', 'background.js'), 'utf8');
const noop = () => {};
const listener = { addListener: noop, removeListener: noop, hasListener: () => false };
const aget = (k, cb) => { const r = {}; if (typeof cb === 'function') cb(r); return Promise.resolve(r); };
const aset = (o, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); };
const chrome = {
  runtime: { onInstalled: listener, onStartup: listener, onMessage: listener, onConnect: listener,
    getURL: (p) => 'chrome-extension://test/' + p, id: 'test', lastError: null, getManifest: () => ({ version: '0' }),
    connectNative: () => ({ onMessage: listener, onDisconnect: listener, postMessage: noop, disconnect: noop }), sendMessage: noop },
  storage: { local: { get: aget, set: aset, remove: aset }, onChanged: listener },
  tabs: { onRemoved: listener, onUpdated: listener, get: () => Promise.resolve({ url: '' }), update: () => Promise.resolve() },
  webNavigation: { onBeforeNavigate: listener, onHistoryStateUpdated: listener, onCommitted: listener },
  cookies: { set: () => Promise.resolve(), get: () => Promise.resolve(null), remove: () => Promise.resolve() },
  alarms: { create: noop, get: () => Promise.resolve(null), onAlarm: listener, clear: noop },
  action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
};
const sandbox = { chrome, console: { log: noop, error: noop, warn: noop }, URL, URLSearchParams,
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Set, Map,
  fetch: () => Promise.reject(new Error('no fetch')) };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'background.js' });
const shouldBlockUrl = sandbox.shouldBlockUrl;

let pass = 0, fail = 0;
function check(url, expect, note) {
  const host = new URL(url).hostname.toLowerCase();
  const r = shouldBlockUrl(url) || {};
  const blocked = !!r.blocked || !!inBlacklist(host);
  const got = r.blocked ? 'BLOCK(' + r.reason + ')'
            : (inBlacklist(host) ? 'BLOCK(blacklist:' + inBlacklist(host) + ')'
            : (r.safesearch ? 'safesearch' : 'allow(' + (r.tier || '—') + ')'));
  const ok = expect === 'block' ? blocked : !blocked;
  if (ok) pass++; else fail++;
  console.log('  ' + (ok ? '✓' : '✗ FAIL') + ' [' + expect + '] ' + got.padEnd(34) + ' ' + url + (note ? '   // ' + note : ''));
}

console.log('\n§13.1 whitelisted hosts — adult SEARCH must BLOCK; normal use must ALLOW');
check('https://www.quora.com/search?q=porn', 'block');
check('https://www.amazon.com/s?k=hentai', 'block');
check('https://www.ebay.com/sch/i.html?_nkw=hardcore+porn', 'block');
check('https://www.crunchyroll.com/search?q=hentai', 'block');
check('https://www.quora.com/search?q=how+to+learn+python', 'allow', 'SFW search stays usable');
check('https://www.amazon.com/s?k=usb+cable', 'allow', 'SFW search stays usable');
check('https://www.crunchyroll.com/search?q=naruto', 'allow', 'SFW search stays usable');
check('https://www.amazon.com/dp/B0ABC', 'allow', 'product page untouched');

console.log('\n§13.1 cloud file hosts — DOCUMENTED RESIDUAL (productivity, no enumerable adult path)');
check('https://drive.google.com/drive/folders/abc', 'allow', 'residual');
check('https://docs.google.com/document/d/abc/edit', 'allow', 'residual');
check('https://www.dropbox.com/s/abc/file.jpg', 'allow', 'residual');
check('https://onedrive.live.com/?id=abc', 'allow', 'residual');

console.log('\n§13.2 generic image/file hosts — must BLOCK');
['https://ibb.co/abc123', 'https://imgbb.com/', 'https://imgchest.com/p/abc',
 'https://pixhost.to/show/123/abc.jpg', 'https://imgbox.com/abc', 'https://imx.to/i/abc',
 'https://vipr.im/abc.html', 'https://jpg.church/img/abc', 'https://jpg5.su/img/abc'
].forEach(u => check(u, 'block'));
check('https://cdn.discordapp.com/attachments/1/2/x.png', 'allow', 'RESIDUAL: mixed-use CDN');

console.log('\n§13.3 paste/publishing hosts — must BLOCK');
['https://telegra.ph/Some-Title-01-01', 'https://telegra.ph/file/0123abc.jpg',
 'https://graph.org/Some-Title-01-01', 'https://teletype.in/@user/abc',
 'https://justpaste.it/abc12', 'https://rentry.co/abcde', 'https://write.as/somepost'
].forEach(u => check(u, 'block'));
check('https://t.me/s/somechannel', 'allow', 'RESIDUAL: Telegram preview (separate mechanism)');

console.log('\n§13.4 foreign engines — image surface + NSFW query BLOCK; SFW web search ALLOW');
check('https://image.baidu.com/search/index?tn=baiduimage&word=naked%20woman', 'block', 'image surface');
check('https://search.naver.com/search.naver?where=image&query=naked%20woman', 'block', 'image surface');
check('https://pic.sogou.com/pics?query=naked%20woman', 'block', 'image surface');
check('https://search.seznam.cz/obrazky?q=naked%20woman', 'block', 'image surface');
check('https://www.baidu.com/s?wd=hentai', 'block', 'NSFW web query');
check('https://www.baidu.com/s?wd=weather+beijing', 'allow', 'SFW web search stays usable');
check('https://baike.baidu.com/item/Cat', 'allow', 'Baidu encyclopedia untouched');
check('https://mail.naver.com/', 'allow', 'Naver mail untouched');

console.log('\nControls — must BLOCK (no regression)');
['https://www.pornhub.com/', 'https://bunkrr.su/a/abc', 'https://redgifs.com/watch/abc',
 'https://en.wikipedia.org/wiki/Ejaculation', 'https://yewtu.be/search?q=lingerie',
 'https://yandex.com/images/search?text=naked%20women'
].forEach(u => check(u, 'block'));

console.log('\nControls — must ALLOW (no over-block)');
['https://en.wikipedia.org/wiki/Cat', 'https://www.google.com/maps',
 'https://github.com/torvalds/linux', 'https://en.wikipedia.org/wiki/Sexual_reproduction'
].forEach(u => check(u, 'allow'));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
