// Sandbox test for the adversarial-report fixes. Loads the REAL background.js in
// a vm with a chrome stub and exercises shouldBlockUrl / checkSearchEngineSafeSearch
// against the report's reproduction cases (§1–§9). Run: node test-adversarial-fixes.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'extension', 'background.js'), 'utf8');

// ── minimal chrome stub ─────────────────────────────────────────────────────
const noop = () => {};
const listener = { addListener: noop, removeListener: noop, hasListener: () => false };
const asyncGet = (keys, cb) => { const r = {}; if (typeof cb === 'function') { cb(r); } return Promise.resolve(r); };
const asyncSet = (obj, cb) => { if (typeof cb === 'function') cb(); return Promise.resolve(); };
const chrome = {
  runtime: {
    onInstalled: listener, onStartup: listener, onMessage: listener, onConnect: listener,
    getURL: (p) => 'chrome-extension://test/' + p, id: 'test', lastError: null,
    connectNative: () => ({ onMessage: listener, onDisconnect: listener, postMessage: noop, disconnect: noop }),
    sendMessage: noop,
  },
  storage: { local: { get: asyncGet, set: asyncSet, remove: asyncSet }, onChanged: listener },
  tabs: { onRemoved: listener, onUpdated: listener, get: () => Promise.resolve({ url: '' }), update: () => Promise.resolve() },
  webNavigation: { onBeforeNavigate: listener, onHistoryStateUpdated: listener, onCommitted: listener },
  cookies: { set: () => Promise.resolve(), get: () => Promise.resolve(null), remove: () => Promise.resolve() },
  alarms: { create: noop, get: () => Promise.resolve(null), onAlarm: listener, clear: noop },
  action: { setBadgeText: noop, setBadgeBackgroundColor: noop },
};

const sandbox = { chrome, console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Set, Map, fetch: () => Promise.reject(new Error('no fetch')) };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'background.js' });

const shouldBlockUrl = sandbox.shouldBlockUrl;
if (typeof shouldBlockUrl !== 'function') { console.error('shouldBlockUrl not found'); process.exit(2); }

// ── assertions ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, url, expect) {
  const r = shouldBlockUrl(url) || {};
  let ok, got;
  if (expect === 'block') { ok = r.blocked === true; got = ok ? 'blocked(' + r.reason + ')' : 'NOT blocked (' + r.tier + ')'; }
  else if (expect === 'safesearch') { ok = r.safesearch === true; got = ok ? 'safesearch→' + r.redirectUrl : 'no safesearch (' + (r.blocked ? 'blocked ' + r.reason : r.tier) + ')'; }
  else if (expect === 'allow') { ok = !r.blocked; got = r.blocked ? 'BLOCKED(' + r.reason + ')' : 'allowed (' + r.tier + ')'; }
  if (ok) { pass++; console.log('  ✓ ' + label + ' → ' + got); }
  else { fail++; console.log('  ✗ ' + label + '  EXPECTED ' + expect + '  GOT ' + got); }
}

console.log('\n§1.1 uncovered engines — image/video grids → BLOCK');
check('Yandex Images', 'https://yandex.com/images/search?text=naked%20women', 'block');
check('Brave Images', 'https://search.brave.com/images?q=naked%20women', 'block');
check('Yandex Video (sex)', 'https://yandex.com/video/search?text=sex', 'block');

console.log('\n§1.1/§3.4 uncovered/graylist engines — NSFW text query → BLOCK');
check('Brave web nsfw query', 'https://search.brave.com/search?q=naked%20women', 'block');
check('Startpage nsfw query', 'https://www.startpage.com/sp/search?query=porn', 'block');
check('Ecosia nsfw query', 'https://www.ecosia.org/search?q=hentai', 'block');

console.log('\n§1.2 regional google TLD → force SafeSearch (was bypassed)');
check('google.de search', 'https://www.google.de/search?q=naked%20women&udm=2', 'safesearch');
check('google.co.uk search', 'https://www.google.co.uk/search?q=test', 'safesearch');
check('google.com search', 'https://www.google.com/search?q=test', 'safesearch');

console.log('\n§1.3 trusted host explicit galleries → BLOCK');
check('Commons Category:Nude', 'https://commons.wikimedia.org/wiki/Category:Nude_women', 'block');
check('Commons Category:Human_penis', 'https://commons.wikimedia.org/wiki/Category:Human_penis', 'block');

console.log('\n§1.4 YouTube de-whitelisted + nuclear search → BLOCK');
check('YouTube lingerie haul', 'https://www.youtube.com/results?search_query=lingerie+try+on+haul', 'block');

console.log('\n§7.2 Spotify de-whitelisted erotica search → BLOCK');
check('Spotify erotica audiobook', 'https://open.spotify.com/search/erotica%20audiobook', 'block');

console.log('\n§6.1 SSR-only graylist sites — search/browse → BLOCK');
check('Tumblr search', 'https://www.tumblr.com/search/lingerie', 'block');
check('Tumblr tagged', 'https://www.tumblr.com/tagged/nsfw', 'block');
check('Tumblr search bikini (was a live leak)', 'https://www.tumblr.com/search/bikini', 'block');
check('Wattpad search smut', 'https://www.wattpad.com/search/smut', 'block');
check('Wattpad stories browse', 'https://www.wattpad.com/stories/erotica', 'block');

console.log('\nSuggestive-class keyword coverage → BLOCK (graylist/engine search)');
check('Reddit search swimsuit', 'https://www.reddit.com/search/?q=swimsuit', 'block');
check('Yandex cleavage query', 'https://yandex.com/search/?text=cleavage', 'block');
check('Pixiv tag busty', 'https://www.pixiv.net/tags/busty/artworks', 'block');

console.log('\n§7.1 Minds search → BLOCK');
check('Minds search nsfw', 'https://www.minds.com/search?q=nsfw', 'block');
check('X search nsfw', 'https://x.com/search?q=hentai', 'block');

console.log('\n§7.3 Reddit .json suffix bypass → BLOCK');
check('Reddit /r/RealGirls.json', 'https://www.reddit.com/r/RealGirls.json?limit=5', 'block');
check('Reddit /r/gonewild.rss', 'https://www.reddit.com/r/gonewild.rss', 'block');

console.log('\n§9.1#3 numeric / IPv6 IP evasion → BLOCK');
check('decimal IP', 'http://1090052999/', 'block');
check('hex IP', 'http://0x68107b60/', 'block');
check('IPv6 global', 'http://[2606:4700::1111]/', 'block');
check('dotted public IP (control)', 'http://104.16.123.96/', 'block');

console.log('\n§3.2 proxy/translate unwrap → BLOCK (inner is porn)');
check('r.jina.ai → pornhub', 'https://r.jina.ai/https://www.pornhub.com/', 'block');
check('corsproxy.io → pornhub', 'https://corsproxy.io/?url=https://www.pornhub.com/', 'block');
check('allorigins → pornhub', 'https://api.allorigins.win/get?url=https%3A%2F%2Fwww.pornhub.com%2F', 'block');
check('bare corsproxy (no target)', 'https://corsproxy.io/', 'block');

console.log('\nCONTROLS — must still be ALLOWED (no over-block)');
check('Wikipedia article on sex (whitelisted)', 'https://en.wikipedia.org/wiki/Sexual_intercourse', 'allow');
check('Commons innocent category', 'https://commons.wikimedia.org/wiki/Category:Cats', 'allow');
check('YouTube normal video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'allow');
check('YouTube innocent search', 'https://www.youtube.com/results?search_query=guitar+lesson', 'allow');
check('Reddit normal sub', 'https://www.reddit.com/r/aww', 'allow');
check('Wattpad normal search', 'https://www.wattpad.com/search/fantasy', 'allow');
check('mail.google.com (not a search surface)', 'https://mail.google.com/mail/u/0/', 'allow');
check('docs.google.com', 'https://docs.google.com/document/d/abc/edit', 'allow');
check('private IP', 'http://192.168.1.1/', 'allow');
check('loopback IP', 'http://127.0.0.1:8080/', 'allow');
check('localhost', 'http://localhost:3000/', 'allow');

console.log('\nCONTROLS — SafeSearch still forced on covered engines (not over-blocked)');
check('Yandex innocent text search (force family)', 'https://yandex.com/search/?text=weather', 'safesearch');
check('Bing innocent search (force adlt)', 'https://www.bing.com/search?q=weather', 'safesearch');

console.log('\n──────────────────────────────────────────');
console.log('PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
