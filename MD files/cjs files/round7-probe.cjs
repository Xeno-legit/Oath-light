// Round 7 adversarial probe — maps two NEW perimeter gaps a "desperate addict"
// would reach for that Rounds 1-6 never drove:
//   A. OBFUSCATED SEARCH QUERIES. matchSearchQueryPorn() lowercases + strips
//      [_-.,] but never normalizeLeet()s, while the hostname layer
//      (checkDomainKeywords) DOES. So h3ntai / p0rn / pu55y / b00bs / s3x and
//      separator forms (p.o.r.n) bypass the nuclear keyword block on EVERY
//      search surface (Tier-2 engines, graylist routes, trusted-host search,
//      Reddit/Patreon).  Confirmed live: mojeek.com/search?q=h3ntai rendered
//      (and surfaced a hentai-porn link) while ?q=hentai was ERR_ABORTED.
//   B. REDDIT MEDIA SUBDOMAINS. Every Reddit defense keys on reddit.com; the
//      media CDNs i.redd.it / preview.redd.it / v.redd.it (and redd.it short
//      links) are a different registrable domain with no rule.
//
// Same harness shape as round6-probe.cjs: real shouldBlockUrl() in a vm + the
// real 100k-domain blacklist. 'block' rows are what the perimeter SHOULD do;
// pre-fix the obfuscation rows are expected to FAIL (that's the finding).
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

console.log('\n§A.1 Tier-2 engine — plain keyword BLOCKS, obfuscation must also BLOCK');
check('https://www.mojeek.com/search?q=hentai', 'block', 'control: plain keyword');
check('https://www.mojeek.com/search?q=h3ntai', 'block', 'LEAK: leet bypass (CONFIRMED LIVE)');
check('https://www.mojeek.com/search?q=p0rn', 'block', 'LEAK: leet bypass');
check('https://www.gibiru.com/results.html?q=pr0n', 'block', 'LEAK: leet on uncensored engine');
check('https://search.brave.com/search?q=p.o.r.n', 'block', 'LEAK: separator bypass');

console.log('\n§A.2 Graylist search routes — plain BLOCKS, obfuscation must also BLOCK');
check('https://www.youtube.com/results?search_query=porn', 'block', 'control');
check('https://www.youtube.com/results?search_query=p0rn', 'block', 'LEAK: leet');
check('https://www.pixiv.net/tags/hentai/artworks', 'block', 'control');
check('https://www.pixiv.net/tags/h3ntai/artworks', 'block', 'LEAK: leet');
check('https://www.tumblr.com/search/p0rn', 'block', 'LEAK: leet');
check('https://imgur.com/search?q=pu55y', 'block', 'LEAK: leet');

console.log('\n§A.3 Trusted-host + Reddit search — plain BLOCKS, obfuscation must also BLOCK');
check('https://www.quora.com/search?q=p0rn', 'block', 'LEAK: leet on whitelisted host');
check('https://www.reddit.com/search/?q=p0rn', 'block', 'LEAK: leet');
check('https://www.reddit.com/search/?q=b00bs', 'block', 'LEAK: leet');

console.log('\n§A.4 Controls — obfuscation fix must NOT over-block innocent queries');
check('https://www.mojeek.com/search?q=essex', 'allow', 'no Scunthorpe');
check('https://www.youtube.com/results?search_query=python+tutorial', 'allow', 'SFW stays usable');
check('https://www.reddit.com/search/?q=minecraft', 'allow', 'SFW stays usable');
check('https://www.mojeek.com/search?q=pen+island', 'allow', 'de-space must NOT make "penis"');
check('https://www.mojeek.com/search?q=the+rapist', 'allow', 'must NOT make "rape" (run-together guarded)');
check('https://www.mojeek.com/search?q=ps5+review', 'allow', 'leet must NOT corrupt "ps5"');
check('https://www.mojeek.com/search?q=areas+51', 'allow', 'leet on digits stays SFW');
check('https://www.mojeek.com/search?q=classic+cars', 'allow', 'leet/de-space SFW');
check('https://www.gibiru.com/results.html?q=pr0n', 'block', 'metathesis pr0n->pron');
check('https://www.mojeek.com/search?q=apron+pattern', 'allow', "'pron' whole-word, no Scunthorpe");
check('https://www.mojeek.com/search?q=prone+position', 'allow', "'pron' must not hit 'prone'");
check('https://www.mojeek.com/search?q=rule34', 'block', 'digit-keyword still caught via RAW variant');
check('https://www.mojeek.com/search?q=18%2B+games', 'block', '"18+" still caught via RAW variant');

console.log('\n§B Reddit media subdomains — host-keyed defenses all miss redd.it (RESIDUAL)');
// redd.it is Reddit's own CDN for BOTH sfw + nsfw uploads, with no per-URL NSFW
// signal — blanket-blocking the host breaks SFW image opens. Same mixed-use class
// as cdn.discordapp.com (§13.2 residual). Flagged, left as documented residual.
check('https://i.redd.it/abc123.jpg', 'allow', 'RESIDUAL: mixed-use Reddit image CDN');
check('https://preview.redd.it/abc123.jpg?width=1080', 'allow', 'RESIDUAL: mixed-use');
check('https://v.redd.it/abc123/DASH_1080.mp4', 'allow', 'RESIDUAL: mixed-use video CDN');

console.log('\nControls — must BLOCK (no regression)');
['https://www.pornhub.com/', 'https://yandex.com/images/search?text=naked%20women',
 'https://www.mojeek.com/search?q=porn', 'https://en.wikipedia.org/wiki/Ejaculation'
].forEach(u => check(u, 'block'));

console.log('\nControls — must ALLOW (no over-block)');
['https://en.wikipedia.org/wiki/Cat', 'https://www.reddit.com/r/aww/',
 'https://www.mojeek.com/search?q=weather'
].forEach(u => check(u, 'allow'));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + '/' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
