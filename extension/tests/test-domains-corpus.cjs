// extension/tests/test-domains-corpus.cjs
// The adversarial regression corpus for shouldBlockUrl() — the
// adversarial regression corpus for shouldBlockUrl()'s keyword / TLD / leet /
// native-IDN / bypass / SafeSearch layers. A FAIL on an allow() case is a
// FALSE POSITIVE (a legit site getting blocked) — the worst failure mode for
// this project — so this file is deliberately heavy on negative cases.
// Only the harness plumbing (block/allow/gap/cat) was adapted to run against
// the split bg/*.js modules via the shared vm sandbox instead of loading a
// monolithic background.js directly; every individual assertion below is
// unchanged from the original corpus.
'use strict';
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const shouldBlockUrl = sandbox.shouldBlockUrl;
  const runner = createRunner('test-domains-corpus');

  let curCat = '';
  const cat = (c) => { curCat = c; };
  function res(url) {
    const full = /^https?:\/\//i.test(url) ? url : 'https://' + url + '/';
    return shouldBlockUrl(full) || {};
  }
  function block(url, note) {
    const r = res(url);
    runner.ok(!!r.blocked, `[${curCat}] BLOCK ${url}`, note + ` (got ${r.blocked ? 'blocked:' + r.reason + ':' + r.match : (r.safesearch ? 'safesearch' : 'allowed:' + r.tier)})`);
  }
  function allow(url, note) {
    const r = res(url);
    runner.ok(!r.blocked, `[${curCat}] ALLOW ${url}`, note + ` (got ${r.blocked ? 'BLOCKED:' + r.reason + ':' + r.match : 'allowed'})`);
  }
  // gap(): documents a KNOWN under-block (an evasion not yet defeated). Not
  // asserted either way — matches the semantics of the original corpus, where
  // these are reported separately so they can't fail the FP-safety-focused suite.
  function gap(_url, _note) {}

  // ---- BEGIN corpus body ----
/* ===========================================================================
 * 1. ADULT TLDs — adult by definition
 * ========================================================================= */
cat('adult-tlds');
block('foo.xxx');         block('bar.porn');
block('baz.adult');       block('whatever.sex');
block('site.sexy');
allow('proxy.xxxiii.com', 'xxxiii (roman 23) is not a .xxx TLD'); // must not match mid-host

/* ===========================================================================
 * 2. STRONG STEMS — must block anywhere in host (incl. multilingual survivors)
 * ========================================================================= */
cat('strong-stems');
block('pornhub.com');           block('videos.xvideos.com');
block('m.xnxx.com');            block('hentaihaven.org');
block('sex4arabs.com', 'the canonical "list misses it, keyword catches it" case');
block('chaturbate.com');        block('onlyfans-leaks.net');
block('sharmota.tv');           block('bokepindo.com');
block('chudai-videos.in');      block('caonima.cc');
block('civitai-nsfw.com');      block('deepnude.app');
block('e621.net', 'added as a strong stem in batch 4 (entirely-NSFW booru)');
block('derpibooru.org');

/* ===========================================================================
 * 3. COMPOUNDS — collision-heavy roots match ONLY in explicit porn context
 * ========================================================================= */
cat('compounds');
block('bigtits.com');           block('asshole.net');
block('wetpussy.xxx');          block('monstercock.tv');
block('analsex.com');
// the bare roots must NEVER match standalone:
allow('cumulative.com');        allow('cucumber.org');
allow('document.net');          allow('circumstance.io');
allow('classroom.com');         allow('embassy.gov');
allow('assassincreed.com');     allow('assignment.help');
allow('titanium.org');          allow('institute.edu');
allow('octopus.energy', 'real UK energy company — "pus(sy)" must not trip');
allow('platypus.com');          allow('competitive.io');
allow('massachusetts.gov');

/* ===========================================================================
 * 4. GUARDED ROOTS — block when standalone, allow when whitelist-covered
 * ========================================================================= */
cat('guarded-block'); // standalone → BLOCK
block('sex.com');               block('anal.com');
block('milf.com');              block('rape.org');
block('cunt.net');

cat('guarded-allow'); // whitelist-covered → ALLOW
allow('essex.gov.uk');          allow('www.essex.ac.uk', 'University of Essex');
allow('sussex.ac.uk');          allow('middlesex.edu');
allow('wessex.org');            allow('sextant.io');
allow('analytics.google.com');  allow('analysis.com');
allow('canalplus.com', 'canal → covers anal');
allow('banalfacts.com');
allow('camscanner.com', 'CamScanner document scanner service');
allow('www.camscanner.com');
allow('metrostate.edu');
allow('ohiochristian.edu');
allow('specialconnections.ku.edu');
allow('frazer.rice.edu');
allow('djj.nsw.gov.au');
allow('primature.gov.gn');
allow('ieltsmarkcambridge.com');
allow('norwichcyclingcampaign.org');
allow('thecambridgepestcontrolcompany.co.uk');
allow('sem-scanner.co.uk');
allow('cambridgemanufacturing.com');
allow('docufiler.com');
allow('peacock.com', 'NBC Peacock streaming');
allow('cocktail-recipes.com');  allow('cockpit.io');
allow('cockroachlabs.com', 'CockroachDB — real database company');
allow('hitchcock.com');         allow('shuttlecock.net');
allow('cockfosters.tube', 'London Underground station');
allow('dickens.org');           allow('dickinson.edu');
allow('grapefruit.com');        allow('drapery.com');
allow('scraper-api.com');       allow('therapeutics.com');
allow('scunthorpe.gov.uk', 'the original Scunthorpe problem');
allow('milford.com');

/* ===========================================================================
 * 5. MULTILINGUAL GUARDED-ROOT TRAPS — these are the highest-value FP cases
 * ========================================================================= */
cat('multilang-traps');
allow('reputable.com', 'puta → reputable');
allow('computation.org', 'puta → computation');
allow('amputate.net', 'puta → amputate');
allow('disputable.io', 'puta → disputable');
allow('compute.com');           allow('dispute.org');
allow('grandiose.com', 'randi → grandiose');
allow('brandish.io');           allow('randint.dev');
allow('parachute.com', 'chut → parachute');
allow('chutney.co.uk');         allow('chutzpah.com');
allow('salopette-shop.fr', 'salope → salopette (overalls)');
allow('chodron.org', 'chod → Pema Chödrön (Buddhist teacher)');
allow('chodavaram.in', 'chod → Indian town');
allow('seksenler.com', 'seks → Turkish "the eighties"');
allow('puttanesca.recipes', 'puttane → pasta sauce');
allow('dupage.edu', 'dupa → DuPage county college');
allow('dupatta.shop', 'dupa → Indian scarf');
allow('curvature.io', 'curva → curvature');
allow('curvaceous.com');
allow('malakian.com', 'malakia → Daron Malakian (musician)');
allow('chikankari.in', 'chikan → Indian embroidery');
allow('porridge.co.uk', 'porr → porridge');
allow('kundalini-yoga.com', 'kunda → kundalini');
allow('picsart.com', 'picsa → photo-editing app');
allow('dengue-watch.org', 'dengu → dengue fever');
allow('poesia.net', 'poes → poetry (ES/AF)');
allow('pickaxe-tools.com', 'picka → pickaxe');
allow('lebanese-cuisine.com', 'ebane → Lebanese');
allow('debating-society.org', 'ebati → debating');
allow('patissier.fr', 'tissi → pastry chef');
allow('thoth-analytics.com', 'thot → Egyptian god Thoth');
allow('findomestic.it', 'findom → Italian bank Findomestic');
allow('coomera-realty.au', 'coomer → Coomera, Queensland suburb');
allow('possesso.it', 'sesso → possession');

/* ===========================================================================
 * 6. KNOWN-HARD EDGES — real words/names the substring+whitelist model may miss.
 *    (These probe gaps. A FAIL here = a genuine false positive to fix.)
 * ========================================================================= */
cat('hard-edges');
allow('trapezoid.com', 'rape → trapezoid (whitelist has "trapeze", not "trapez")');
allow('trapezius-muscle.com', 'rape → trapezius');
allow('cockatiel-care.com', 'cock → cockatiel (whitelist has cockatoo, not cockatiel)');
allow('kundera-books.com', 'kunda → Milan Kundera (author)');
allow('mirandized.law', 'randi → Mirandized (legal term)');
allow('sexsmith.ca', 'sex → Sexsmith, Alberta (real town)');
allow('cockaigne.com', 'cock → Land of Cockaigne');
allow('analemma-clock.com', 'anal → analemma (covered)');
allow('incurvation.com', 'curva → incurvation');

/* ===========================================================================
 * 7. LEETSPEAK — normalize before matching
 * ========================================================================= */
cat('leetspeak');
block('p0rnhub.com', '0→o');         block('p0rn0.net');
block('s3x.com', '3→e → sex (uncovered)');
block('5ex.com', '5→s → sex');
block('h3nta1.tv', 'hentai');
block('xh4mster.com', '4→a → xhamster');
block('h3n7a1video.com', '3→e,7→t,1→i → hentai');
block('0nlyf4ns-leak.com', '0→o,4→a → onlyfans');
block('s3xch4t.net', 'leet → sexchat → sex (uncovered)');
allow('e55ex.com', 'leet → essex (covered) — leet must not strip whitelist coverage');
allow('cl4ssic.com', '4→a → classic (covered) — leet must not create collisions');

/* ===========================================================================
 * 8. NATIVE-SCRIPT IDN — Node URL() punycodes these; engine decodes & matches
 * ========================================================================= */
cat('native-idn');
block('https://порно.com/', 'Cyrillic porno');
block('https://секс.рф/', 'Cyrillic seks');
block('https://色情.com/', 'Chinese se-qing');
block('https://야동.kr/', 'Korean yadong');
block('https://سكس.com/', 'Arabic sex');
block('https://変態.jp/', 'Japanese hentai');
allow('https://мир.рф/', 'Russian "world/peace" — benign');
allow('https://日本.jp/', 'Chinese/Japanese for "Japan"');
allow('https://köln.de/', 'Cologne — IDN must not coincidentally hit a Latin stem');
allow('https://münchen.de/', 'Munich');
allow('https://中国.cn/', 'China');

/* ===========================================================================
 * 9. BYPASS VECTORS — unwrap-then-recheck + pure-proxy blocks
 * ========================================================================= */
cat('bypass-proxies');
block('proxysite.com');         block('www.croxyproxy.com');
block('12ft.io');               block('archive.today');
block('archive.ph');           block('sub.kproxy.com');
allow('notarealproxy.com', 'random domain unrelated to a proxy');

cat('bypass-unwrap-translate');
block('https://pornhub-com.translate.goog/', 'translate.goog wrapper of pornhub.com');
block('https://www-xvideos-com.translate.goog/', 'translate.goog wrapper of xvideos');
allow('https://google-com.translate.goog/', 'translated whitelisted site stays allowed');
allow('https://en-wikipedia-org.translate.goog/wiki/Cat', 'clean translated page');
block('https://translate.google.com/translate?u=https%3A%2F%2Fpornhub.com', 'u= param wrapper');
allow('https://translate.google.com/translate?u=https%3A%2F%2Fgithub.com', 'u= clean target');

cat('bypass-unwrap-archive');
block('https://web.archive.org/web/2021/https://pornhub.com/', 'wayback wrapper of porn');
allow('https://web.archive.org/web/2021/https://wikipedia.org/', 'wayback wrapper of clean site');

/* ===========================================================================
 * 10. RAW PUBLIC-IP NAVIGATION — block public, exempt private/loopback
 * ========================================================================= */
cat('raw-ip');
block('http://104.21.5.5/', 'public IP');
block('http://8.8.8.8/', 'public IP (Google DNS) — raw-IP nav still blocked');
block('http://172.32.0.1/', '172.32 is OUTSIDE the private 172.16–31 range');
allow('http://127.0.0.1:8080/', 'loopback');
allow('http://192.168.1.1/', 'private');
allow('http://10.0.0.5/', 'private');
allow('http://172.16.0.1/', 'private (lower bound)');
allow('http://172.31.255.255/', 'private (upper bound)');
allow('http://169.254.1.1/', 'link-local');

/* ===========================================================================
 * 11. SUBDOMAIN / CASE / WHITELIST PRECEDENCE
 * ========================================================================= */
cat('subdomain-case');
block('cdn.pornhub.com');       block('VIDEOS.PORNHUB.COM', 'uppercase');
block('PoRnHuB.com');
allow('mail.google.com');       allow('store.steampowered.com');
allow('docs.google.com');

/* ===========================================================================
 * 12. MUST-ALLOW DOMAINS — recovery + graylist names the keyword layer must
 *     deliberately leave alone (these are domain-name decisions).
 * ========================================================================= */
cat('must-allow-domains');
allow('nofap.com', 'recovery resource — must never be blocked');
allow('furaffinity.net', 'graylist name, intentionally not keyword-blocked');
allow('gelbooru.com', 'danbooru/gelbooru not in strong stems');
allow('danbooru.donmai.us');
allow('deviantart.com');

/* ===========================================================================
 * 13. TOP GLOBAL SITES — broad must-allow sanity sweep
 * ========================================================================= */
cat('top-sites');
['google.com','youtube.com','facebook.com','instagram.com','wikipedia.org',
 'amazon.com','x.com','whatsapp.com','tiktok.com','netflix.com','linkedin.com',
 'microsoft.com','apple.com','baidu.com','yandex.com','spotify.com','twitch.tv',
 'github.com','stackoverflow.com','cloudflare.com','mozilla.org','paypal.com',
 'wordpress.org','adobe.com','salesforce.com','zoom.us','samsung.com','intel.com',
 'nvidia.com','espn.com','imdb.com','pinterest.com','quora.com','medium.com',
 'booking.com','airbnb.com','expedia.com','dropbox.com','slack.com','figma.com',
].forEach(d => allow(d, 'global top site'));

/* ===========================================================================
 * 14. ★ INSANELY CONFUSING ★ — the deliberately brutal corpus.
 *     Real towns / surnames / products / words that embed an NSFW stem, plus
 *     homoglyph & truncation evasions. A FAIL on allow() = a real-world false
 *     positive; a FAIL on block() = a real-world evasion that slips through.
 * ========================================================================= */

cat('confusing: strong-stem collisions (must allow)');
// Strong stems have NO whitelist guard — any host containing them blocks. These
// are the scariest collisions because there is no escape hatch.
allow('excluder.com', 'luder (SE) → draught/draft excluder — a real product');
allow('includer.io', 'luder → includer');
allow('concluder.com', 'luder → concluder');
allow('trumparmy.org', 'rumpa (SE) → "trump a..." political domain');
allow('puku-safari.co.zm', 'puku → the puku, an African antelope');
allow('tittensor.co.uk', 'titten (DE) → Tittensor, a village in Staffordshire');
allow('horoscope-daily.com', 'horor (SE) sanity — horoscope must stay clear');
allow('fitting-rooms.com', 'fitta (SE) sanity — fitting must stay clear');
allow('discussed-topics.com', 'kusse (DE) sanity — discussed must stay clear');

cat('confusing: guarded-root real names/places (must allow)');
allow('mobydick.com', 'dick → Moby-Dick (Melville)');
allow('cockcroft-institute.org', 'cock → John Cockcroft (Nobel physicist)');
allow('alcock.com', 'cock → John Alcock (transatlantic aviator)');
allow('glasscock-county.tx.gov', 'cock → Glasscock County, Texas');
allow('serape-blankets.com', 'rape → serape (Mexican shawl)');
allow('dickory-dock.com', 'dick → Hickory Dickory Dock (nursery rhyme)');
allow('sexeys.org', "sex → Sexey's School (real English school)");
// positive controls — these SHOULD pass (whitelist actually covers them):
allow('cockermouth.gov.uk', 'cock → Cockermouth (covered by "cocker")');
allow('gamecock-store.com', 'cock → gamecock (covered)');
allow('cumberbatch.com', 'cum is compound-only → Benedict Cumberbatch is safe');
allow('clitheroe.gov.uk', 'no stem at all → real Lancashire town');
allow('penistone.gov.uk', 'no stem (penis is not a domain stem) → real town');
allow('arsenal.com', 'no "anal" substring in arsenal');
allow('urinalysis-lab.com', 'no "anal" substring in urinal/urinalysis');
allow('scrapheap-challenge.com', 'no "rape" in scrapheap');

cat('confusing: homoglyph spoofs (now BLOCKED via confusable fold)');
block('https://sexх.com/', 'trailing Cyrillic kha — the "sex" is Latin → blocks');
block('https://pоrn.com/', 'Cyrillic "о" (U+043E) swapped for Latin o in porn');
block('https://роrn.com/', 'mixed Cyrillic р+о homoglyphs → porn');
block('https://ⲣorn.com/', 'Coptic small-letter ro homoglyph → porn');
block('https://xvіdeos.com/', 'Cyrillic і (U+0456) inside xvideos');
block('https://неntai.io/', 'Cyrillic н+е inside hentai');
block('https://роrnο.com/', 'Cyrillic + Greek omicron → porno');

cat('confusing: native-script words that FOLD into a short root (must allow)');
allow('https://соска.рф/', 'Cyrillic "pacifier" folds to "cocka" — must NOT trip cock root');
allow('https://мир.рф/', 'Cyrillic "world/peace"');
allow('https://кино.рф/', 'Cyrillic "cinema" — folds to "khho"-ish, no strong stem');
allow('https://сок.рф/', 'Cyrillic "juice" → folds to "cok", not a strong stem');

// KNOWN GAPS — truncation / separator evasions. These are NOT homoglyphs; the
// stem is genuinely broken up, so substring matching can't see it. Documented,
// not asserted (closing them risks FPs on hyphenated legit hosts).
gap('chaturb8.com', '8-substitution truncates chaturbate (8 not in LEET_MAP)');
gap('p-o-r-n.com', 'hyphen-separated porn');
gap('pron-hub.com', 'common "pron" misspelling of porn');
gap('x-h4mster.com', 'hyphen splits the xhamster stem');

cat('confusing: engineered porn that MUST still catch (block)');
block('p0rn0grafia.net', 'leet porno');
block('teenxvideos.com', 'xvideos stem (no separators)');
block('myonlyfans-leaks.io', 'onlyfans');
block('free-hentai-stream.tv', 'hentai');
block('sharmota-arab.net', 'Arabizi strong stem');
block('deepnudeapp.io', 'AI undress tool');

/* ===========================================================================
 * 15. ★ MULTILINGUAL COLLISIONS ★ — the deep audit of short foreign stems that
 *     collided with real words/names/places in OTHER languages. All must ALLOW.
 * ========================================================================= */

cat('multilang collisions: excluded stems (now allow)');
allow('itil-foundation.org', 'itil → ITIL IT-service-management framework');
allow('itil-training.com');
allow('djurfoder.se', 'foder → Swedish for animal feed/fodder');
allow('foder-shop.se');
allow('borsten-fabriek.nl', 'borsten → Dutch/German for bristles');
allow('sletten.no', 'sletten → common Norwegian surname/place');
allow('stagecity.com', 'geci → "stage city" (…ge+ci boundary)');
allow('dodgecity-rodeo.com', 'geci → Dodge City');
allow('imagecinema.com', 'geci → "image cinema"');
allow('tofudishes.com', 'fudi → "tofu dishes"');
allow('pudina-chutney.in', 'pudi → pudina (mint)');
allow('gastight-seals.com', 'gasti → gas-tight seals');
allow('vegastimes.com', 'gasti → "Vegas times"');
allow('gastineau-channel.org', 'gasti → Gastineau Channel, Alaska');
allow('naaimachine-shop.nl', 'naai → Dutch "naaimachine" = sewing machine');
allow('sinaai.be', 'naai → Sinaai, Belgian village');
allow('puku-safari.co.zm', 'puku → African antelope (also in §14)');

cat('multilang collisions: demoted-to-guarded (now allow)');
allow('occluder-device.com', 'luder → occluder (medical)');
allow('preluder.com', 'luder → preluder');
allow('skullisland-tours.com', 'kulli → Skull Island');

cat('multilang collisions: existing-guarded-root gaps (now allow)');
allow('kanald.com.tr', 'anal → Kanal D (Turkish TV channel)');
allow('manali-tourism.com', 'anal → Manali, Himachal Pradesh');
allow('panalpina-logistics.com', 'anal → Panalpina (freight company)');
allow('bacchanal-buffet.com', 'anal → Bacchanal Buffet (Caesars Palace)');
allow('kundan-jewellery.in', 'kunda → Kundan jewellery');
allow('mukunda-foundation.org', 'kunda → Mukunda (Hindu deity / name)');
allow('putamen-research.org', 'puta → putamen (basal ganglia)');
allow('saputara-hills.in', 'puta → Saputara hill station');
allow('pickapart-auto.com', 'picka → Pick-a-Part salvage');
allow('pickaback-games.com', 'picka → pickaback');
allow('poesy-press.com', 'poes → poesy (poetry)');

cat('multilang collisions: demoted stems STILL block standalone (control)');
block('luder.se', 'standalone German/Swedish "whore" → still blocks (guarded, uncovered)');
block('titten.de', 'standalone German "tits" → still blocks');
block('kulli.fi', 'standalone Finnish "dick" → still blocks');
block('rumpa-porr.se', 'rumpa present, uncovered → blocks');

  // ---- END ported body ----

  return runner.summary();
}

module.exports = { run };
