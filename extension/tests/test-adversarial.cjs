// extension/tests/test-adversarial.cjs
// Every §1-§9 reproduction case from the original adversarial audit rounds,
// asserted unchanged against the split bg/*.js modules. This file IS the record
// of those rounds — the scratch script and the report they came from are
// retired, because a passing test can't go stale the way a document can.
'use strict';
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const shouldBlockUrl = sandbox.shouldBlockUrl;
  const runner = createRunner('test-adversarial');

  function check(label, url, expect) {
    const r = shouldBlockUrl(url) || {};
    let ok;
    if (expect === 'block') ok = r.blocked === true;
    else if (expect === 'safesearch') ok = r.safesearch === true;
    else if (expect === 'allow') ok = !r.blocked;
    runner.ok(ok, label, `expected ${expect}, url=${url}, got=${JSON.stringify(r)}`);
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

console.log('\n§R5 (Round 5) whitelisted Wikipedia explicit SEX-ACT articles → BLOCK (was total bypass via whitelist)');
check('Wikipedia /wiki/Ejaculation (inline act video)', 'https://en.wikipedia.org/wiki/Ejaculation', 'block');
check('Wikipedia /wiki/Oral_sex', 'https://en.wikipedia.org/wiki/Oral_sex', 'block');
check('Wikipedia /wiki/Anal_sex', 'https://en.wikipedia.org/wiki/Anal_sex', 'block');
check('Wikipedia /wiki/Sexual_intercourse (user: include)', 'https://en.wikipedia.org/wiki/Sexual_intercourse', 'block');
check('Wikipedia /wiki/Masturbation', 'https://en.wikipedia.org/wiki/Masturbation', 'block');
check('Wikipedia /wiki/Facial_(sex_act) (paren disambig)', 'https://en.wikipedia.org/wiki/Facial_(sex_act)', 'block');
check('Wikipedia /wiki/Creampie (sexual)', 'https://en.wikipedia.org/wiki/Creampie', 'block');
check('Wikipedia /wiki/Cunnilingus', 'https://en.wikipedia.org/wiki/Cunnilingus', 'block');
check('Wikipedia /wiki/List_of_sex_positions', 'https://en.wikipedia.org/wiki/List_of_sex_positions', 'block');
check('German Wikipedia (all-TLD/subdomain) /wiki/Fellatio', 'https://de.wikipedia.org/wiki/Fellatio', 'block');
check('Mobile Wikipedia (en.m.) /wiki/Hentai', 'https://en.m.wikipedia.org/wiki/Hentai', 'block');

console.log('\n§R5 Wikipedia EDUCATIONAL / anatomy / SFW articles → ALLOW (sex-acts-only scope, no over-block)');
check('Wikipedia /wiki/Sexual_reproduction (educational)', 'https://en.wikipedia.org/wiki/Sexual_reproduction', 'allow');
check('Wikipedia /wiki/Sex_education', 'https://en.wikipedia.org/wiki/Sex_education', 'allow');
check('Wikipedia /wiki/Human_sexuality', 'https://en.wikipedia.org/wiki/Human_sexuality', 'allow');
check('Wikipedia /wiki/Puberty', 'https://en.wikipedia.org/wiki/Puberty', 'allow');
check('Wikipedia /wiki/Pregnancy', 'https://en.wikipedia.org/wiki/Pregnancy', 'allow');
check('Wikipedia /wiki/Oral_history (NOT oral_sex)', 'https://en.wikipedia.org/wiki/Oral_history', 'allow');
check('Wikipedia /wiki/Analysis (NOT anal_sex)', 'https://en.wikipedia.org/wiki/Analysis', 'allow');
check('Wikipedia /wiki/Cream_pie (the food)', 'https://en.wikipedia.org/wiki/Cream_pie', 'allow');
check('Wikipedia /wiki/Facial (beauty treatment)', 'https://en.wikipedia.org/wiki/Facial', 'allow');
check('Wikipedia /wiki/Squirting_cucumber (plant)', 'https://en.wikipedia.org/wiki/Squirting_cucumber', 'allow');
check('Wikipedia /wiki/Golden_shower_tree (plant)', 'https://en.wikipedia.org/wiki/Golden_shower_tree', 'allow');
check('Wikipedia /wiki/Fingering_(guitar)', 'https://en.wikipedia.org/wiki/Fingering_(guitar)', 'allow');

console.log('\nCONTROLS — must still be ALLOWED (no over-block)');
check('Wikipedia normal article /wiki/Cat', 'https://en.wikipedia.org/wiki/Cat', 'allow');
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

console.log('\n§11.2 (Round 4) uncovered "uncensored" AI platforms → BLOCK');
check('mage.space', 'https://www.mage.space/', 'block');
check('tensor.art', 'https://tensor.art/', 'block');
check('chub.ai', 'https://chub.ai/', 'block');
check('venus.chub.ai (subdomain)', 'https://venus.chub.ai/characters', 'block');
check('yodayo.com', 'https://yodayo.com/', 'block');
check('pixai.art', 'https://pixai.art/', 'block');
check('perchance AI image gen (path)', 'https://perchance.org/ai-text-to-image-generator', 'block');
check('perchance AI character chat', 'https://perchance.org/ai-character-chat', 'block');

console.log('\n§11.2 perchance SFW generators → ALLOW (path-scoped block, not whole domain)');
check('perchance name generator', 'https://perchance.org/welcome', 'allow');
check('perchance dice roller', 'https://perchance.org/random-number-generator', 'allow');

console.log('\n§11.4 (Round 4) codetabs quest= proxy unwrap → BLOCK (inner is porn)');
check('codetabs quest → pornhub', 'https://api.codetabs.com/v1/proxy/?quest=https://www.pornhub.com/', 'block');
check('codetabs quest (encoded) → pornhub', 'https://api.codetabs.com/v1/proxy/?quest=https%3A%2F%2Fwww.pornhub.com%2F', 'block');
check('bare api.codetabs.com (no target)', 'https://api.codetabs.com/v1/proxy/', 'block');
check('corsproxy.org → pornhub', 'https://corsproxy.org/?url=https://www.pornhub.com/', 'block');

console.log('\n§11.4 codetabs proxying a CLEAN site → still ALLOW (unwrap re-checks, not blanket)');
check('codetabs quest → wikipedia', 'https://api.codetabs.com/v1/proxy/?quest=https://en.wikipedia.org/wiki/Cat', 'allow');

console.log('\n§11.1 (Round 4) privacy-frontend instances → BLOCK at navigation (seed list)');
check('redlib.catsarch.com/r/nsfw', 'https://redlib.catsarch.com/r/nsfw', 'block');
check('safereddit.com', 'https://safereddit.com/r/pics', 'block');
check('yewtu.be (invidious) search', 'https://yewtu.be/search?q=lingerie', 'block');
check('xcancel.com (nitter)', 'https://xcancel.com/search?q=nsfw', 'block');
check('piped.video', 'https://piped.video/watch?v=abc', 'block');
check('rimgo.bus-hit.me', 'https://rimgo.bus-hit.me/a/abc', 'block');

console.log('\n§11.3 SearXNG instances → NOT navigation-blocked (content.js scope-blocks image surface; text search stays)');
check('searx.be image search (detector handles in-page)', 'https://searx.be/search?q=naked&categories=images', 'allow');
check('searx.be text search stays usable', 'https://searx.be/search?q=weather', 'allow');

  return runner.summary();
}

module.exports = { run };
