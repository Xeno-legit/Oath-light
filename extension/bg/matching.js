// bg/matching.js — ALL pure URL / hostname / keyword / search-query matching
// logic: the whitelist, Reddit graylist path+keyword tables, the nuclear
// search-query porn filter, graylist/trusted-host search checks, search-engine
// SafeSearch enforcement, the domain-name keyword layer (leet/confusable/IDN
// punycode folding), bypass-vector (proxy/translate/IP) detection, the
// curated supplemental blacklist + privacy-frontend seed list, and the
// top-level shouldBlockUrl() decision function. Deliberately kept as ONE file
// (per project convention) so the entire decision pipeline is testable in
// isolation via the vm harness in extension/tests/. Relocated verbatim from
// the original background.js monolith — no logic changes.

// WHITELIST - Completely safe domains (never block)

const WHITELIST_DOMAINS = [
  // Search engines & AI
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'gemini.google.com',
  'bard.google.com',
  'openai.com',
  'anthropic.com',
  'claude.ai',
  'chatgpt.com',

  // Development & Tech
  'github.com',
  'gitlab.com',
  'stackoverflow.com',
  'stackexchange.com',
  'microsoft.com',
  'apple.com',
  'developer.mozilla.org',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'hub.docker.com',
  'vercel.com',
  'netlify.com',
  'heroku.com',
  'aws.amazon.com',
  'cloud.google.com',
  'azure.microsoft.com',
  'bitbucket.org',
  'codepen.io',
  'replit.com',
  'figma.com',

  // Cloud & Productivity
  'notion.so',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'onedrive.live.com',
  'office.com',
  'slack.com',
  'zoom.us',
  'teams.microsoft.com',

  // Social Media (mainstream safe)
  'linkedin.com',

  // Education & Reference
  'wikipedia.org',
  'wikihow.com',
  'khanacademy.org',
  'coursera.org',
  'udemy.com',
  'edx.org',
  'mit.edu',
  'stanford.edu',
  'harvard.edu',
  'w3schools.com',
  'freecodecamp.org',
  'codecademy.com',
  'brilliant.org',
  'merriam-webster.com',
  'dictionary.com',
  'wolframalpha.com',
  'quora.com',

  // E-commerce
  'amazon.com',
  'ebay.com',
  'walmart.com',
  'target.com',

  // News & Media
  'bbc.com',
  'cnn.com',
  'nytimes.com',
  'theguardian.com',
  'reuters.com',
  'washingtonpost.com',
  'wsj.com',
  'apnews.com',
  'aljazeera.com',
  'forbes.com',
  'techcrunch.com',
  'arstechnica.com',
  'theverge.com',
  'wired.com',

  // Banking & Finance
  'paypal.com',
  'stripe.com',
  'chase.com',
  'bankofamerica.com',

  // Health
  'webmd.com',
  'mayoclinic.org',
  'nih.gov',
  'who.int',

  // Government
  'nasa.gov',
  'irs.gov',

  // Entertainment (safe)
  // NOTE: youtube.com / youtu.be / spotify.com were REMOVED from the whitelist
  // (report §1.4 + §3.1). Whitelisting short-circuited ALL content filtering, so
  // YouTube served unrestricted suggestive content and Spotify served explicit
  // erotica audio. They now flow through the normal pipeline: YouTube gets forced
  // Restricted Mode (GRAYLIST_COOKIE_MAP, PREF cookie) + the nuclear search filter
  // (GRAYLIST_SEARCH_ROUTES); Spotify gets the nuclear search filter.
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'crunchyroll.com',
  'store.steampowered.com',
  'epicgames.com'
];

// REDDIT-SPECIFIC CONTENT FILTERING (Paths and Keywords)

const GRAYLIST_EXPLICIT_PATHS = [
  // General NSFW
  '/r/nsfw', '/r/tipofmypenis', '/r/porn', '/r/nsfw411', '/r/iwanttofuckher', '/r/distension', '/r/bimbofetish', '/r/christiangirls', '/r/cuckold', '/r/dirtygaming', '/r/sexybutnotporn', '/r/femalepov', '/r/omgbeckylookathiscock', '/r/sexygirls', '/r/breedingmaterial', '/r/toocuteforporno', '/r/justhotwomen', '/r/realsexyselfies', '/r/stripgirls', '/r/uncommonposes', '/r/gifsofremoval', '/r/nostalgiafapping', '/r/oilporn', '/r/bisexy', '/r/riskyporn',
  // MILF
  '/r/milf', '/r/gonewild30plus', '/r/preggoporn', '/r/realmoms',
  // Teen
  '/r/legalteens', '/r/collegesluts', '/r/adorableporn', '/r/legalteensxxx', '/r/gonewild18', '/r/18_19', '/r/pornstarletHQ', '/r/fauxbait',
  // Amateur
  '/r/realgirls', '/r/amateur', '/r/homemadexxx', '/r/dirtypenpals', '/r/festivalsluts', '/r/collegeamateurs', '/r/amateurcumsluts', '/r/nsfw_amateurs', '/r/funwithfriends', '/r/randomsexiness', '/r/amateurporn', '/r/normalnudes',
  // Cam
  '/r/camwhores', '/r/camsluts', '/r/tiktokliveslip',
  // Gonewild
  '/r/gonewild', '/r/petitegonewild', '/r/gonewildstories', '/r/treesgonewild', '/r/gonewildaudio', '/r/gwnerdy', '/r/gonemild', '/r/altgonewild', '/r/gifsgonewild', '/r/analgw', '/r/gonewildsmiles', '/r/onstagegw', '/r/repressedgonewild', '/r/bdsmgw', '/r/underweargw', '/r/labiagw', '/r/tributeme', '/r/weddingsgonewild', '/r/gwpublic', '/r/assholegonewild', '/r/leggingsgonewild', '/r/dykesgonewild', '/r/goneerotic', '/r/gonewildhairy', '/r/gonewildtrans', '/r/gonwild', '/r/ratemynudebody', '/r/onmww', '/r/gwcouples', '/r/gonewildcouples', '/r/wouldyoufuckmywife', '/r/gonewildcurvy', '/r/gonewildplus', '/r/bigboobsgw', '/r/bigboobsgonewild', '/r/mycleavage', '/r/asiansgonewild', '/r/gonewildcolor', '/r/indiansgonewild', '/r/latinasgw', '/r/pawgtastic', '/r/workgonewild', '/r/gonewildscrubs', '/r/swingersgw', '/r/militarygonewild',
  // Snapchat
  '/r/nsfw_snapchat', '/r/snapleaks',
  // Wives
  '/r/wifesharing', '/r/hotwife', '/r/slutwife',
  // Animated
  '/r/rule34', '/r/ecchi', '/r/futanari', '/r/doujinshi', '/r/yiff', '/r/monstergirl', '/r/mechanicalsluts', '/r/rule34_comics', '/r/sex_comics',
  // Video Games
  '/r/overwatch_porn', '/r/pokeporn', '/r/bowsette', '/r/rule34lol', '/r/rule34overwatch', '/r/nintendowaifus', '/r/34honor', '/r/fivefapsatfreddys', '/r/breathofthegonewild', '/r/animalcrossingr34', '/r/apexlegends_porn', '/r/tflewd', '/r/thelostwoods',
  // Hentai
  '/r/hentai', '/r/hentai_gif', '/r/westernhentai', '/r/hentai_irl', '/r/artistic_hentai', '/r/hentaibeast', '/r/hentaihumiliation', '/r/traphentai', '/r/ahegao', '/r/ahegao_irl', '/r/hypnohentai', '/r/tentai', '/r/handholding', '/r/honeyfuckers', '/r/itshiptofuckbees', '/r/guro', '/r/hentaibondage', '/r/animeshorts', '/r/kuroihada', '/r/2dtittytouching', '/r/buttfangs', '/r/yuri', '/r/zettairyouiki', '/r/hentaifemdom', '/r/thighhighhentai', '/r/animebooty', '/r/swimsuithentai', '/r/animelegs', '/r/animearmpits', '/r/2dsuccubi', '/r/animemidriff', '/r/skindentation', '/r/thighdeology', '/r/chiisaihentai', '/r/bokunoeroacademia', '/r/waifusgonewild', '/r/sideoppai',
  // BDSM
  '/r/bdsm', '/r/bondage', '/r/bdsmcommunity', '/r/forcedorgasms', '/r/damselsindistress', '/r/cuffed', '/r/gagged', '/r/femaleorgasmdenial', '/r/girlscontrolled',
  // Blowjobs
  '/r/blowjobs', '/r/deepthroat', '/r/onherknees', '/r/blowjobsandwich',
  // Ass
  '/r/ass', '/r/asstastic', '/r/facedownassup', '/r/assinthong', '/r/bigasses', '/r/buttplug', '/r/theunderbun', '/r/booty', '/r/pawg', '/r/paag', '/r/cutelittlebutts', '/r/hungrybutts', '/r/celebritybutts', '/r/cosplaybutts', '/r/mooning',
  // Anal
  '/r/anal', '/r/painal', '/r/masterofanal', '/r/buttsharpies',
  // Asshole
  '/r/asshole', '/r/assholebehindthong', '/r/spreadem', '/r/bendover',
  // Yoga pants
  '/r/girlsinyogapants', '/r/yogapants',
  // Boobs/Nipples
  '/r/boobies', '/r/tittydrop', '/r/boltedontits', '/r/boobbounce', '/r/boobs', '/r/downblouse', '/r/homegrowntits', '/r/breastenvy', '/r/youtubetitties', '/r/torpedotits', '/r/thehangingboobs', '/r/page3glamour', '/r/biggerthanyouthought', '/r/bustypetite', '/r/hugeboobs', '/r/stacked', '/r/burstingout', '/r/2busty2hide', '/r/bigtiddygothgf', '/r/engorgedveinybreasts', '/r/pokies', '/r/ghostnipples', '/r/nipples', '/r/puffies', '/r/lactation', '/r/tinytits', '/r/aa_cups',
  // Face/Hair
  '/r/braceface', '/r/earspokingout', '/r/girlswithneonhair', '/r/shorthairchicks',
  // Legs/Feet
  '/r/stockings', '/r/legs', '/r/tightshorts', '/r/buttsandbarefeet', '/r/feet', '/r/datgap', '/r/thighhighs', '/r/thickthighs',
  // Pussy
  '/r/pussy', '/r/rearpussy', '/r/innie', '/r/simps', '/r/pelfie', '/r/godpussy', '/r/presenting', '/r/hairypussy', '/r/lipsthatgrip', '/r/fucklicking', '/r/moundofvenus', '/r/pussymound',
  // Skin
  '/r/hotchickswithtattoos', '/r/sexyfrex', '/r/tanlines', '/r/complexionexcellence',
  // Waist/Tummy
  '/r/sexytummies', '/r/theratio',
  // Body Type
  '/r/fitgirls', '/r/bodyperfection', '/r/samespecies', '/r/athleticgirls', '/r/fitgirlsfucking', '/r/curvy', '/r/thick', '/r/juicyasians', '/r/voluptuous', '/r/jigglefuck', '/r/chubby', '/r/slimthick', '/r/massivetitsnass', '/r/thicker', '/r/tightsqueeze', '/r/casualjiggles', '/r/bbw', '/r/dirtysmall', '/r/xsmallgirls', '/r/funsized',
  // Celebrity/Athlete
  '/r/athlete', '/r/volleyballgirls', '/r/ohlympics', '/r/celebnsfw', '/r/watchitfortheplot', '/r/extramile', '/r/onoffcelebs',
  // Cum
  '/r/cumsluts', '/r/girlsfinishingthejob', '/r/cumfetish', '/r/cumcoveredfucking', '/r/cumhaters', '/r/thickloads', '/r/before_after_cumsluts', '/r/pulsatingcumshots', '/r/impressedbycum', '/r/creampies', '/r/throatpies', '/r/facialfun', '/r/cumonclothes', '/r/oralcreampie',
  // Emotion
  '/r/happyembarrassedgirls', '/r/borednignored', '/r/annoyedtobenude',
  // Ethnicity
  '/r/damngoodinterracial', '/r/asianhotties', '/r/realasians', '/r/asiannnsfw', '/r/asianporn', '/r/bustyasians', '/r/indianbabes', '/r/nsfw_japan', '/r/kpopfap', '/r/womenofcolor', '/r/darkangels', '/r/blackchickswhitedicks', '/r/ebony', '/r/afrodisiac', '/r/ginger', '/r/redheads', '/r/latinas', '/r/latinacuties', '/r/palegirls', '/r/snowwhites',
  // Gifs
  '/r/nsfw_gif', '/r/nsfw_gifs', '/r/porn_gifs', '/r/porninfifteenseconds', '/r/nsfw_html5', '/r/the_best_nsfw_gifs',
  // Groups
  '/r/twingirls', '/r/groupofnudegirls', '/r/ifyouhadtopickone',
  // Hardcore
  '/r/nsfwhardcore', '/r/shelikesitrough', '/r/freeuse', '/r/whenitgoesin', '/r/outercourse', '/r/gangbang', '/r/breeding', '/r/pegging', '/r/passionx', '/r/amateurgirlsbigcocks', '/r/facesitting', '/r/nsfw_plowcam', '/r/pronebone', '/r/facefuck',
  // High Quality
  '/r/highresnsfw',
  // Incest
  '/r/incestporn',
  // Individuals (pornstars)
  '/r/sarah_xxx', '/r/remylacroix', '/r/anjelica_ebbi', '/r/blancnoir', '/r/rileyreid', '/r/dollywinks', '/r/tessafowler', '/r/lilyivy', '/r/funsizedasian', '/r/mycherrycrush', '/r/gillianbarnes', '/r/kawaiikitten', '/r/emilybloom', '/r/legendarylootz', '/r/sexyflowerwater', '/r/miamalkova', '/r/sashagrey', '/r/keriberry_420', '/r/justpeachyy', '/r/angelawhite', '/r/miakhalifa', '/r/alexapearl', '/r/missalice_18', '/r/evalovia', '/r/giannamichaels', '/r/arianamarie',
  // Lesbian
  '/r/lesbians', '/r/straightgirlsplaying', '/r/girlskissing', '/r/mmgirls', '/r/facesittinglesbians',
  // Masturbation/Orgasm
  '/r/holdthemoan', '/r/o_faces', '/r/jilling', '/r/gettingherselfoff', '/r/quiver', '/r/girlshumpingthings', '/r/ruinedorgasms', '/r/holdingit', '/r/suctiondildos', '/r/baddragon', '/r/grool', '/r/squirting',
  // Men
  '/r/ladybonersgw', '/r/massivecock', '/r/chickflixxx', '/r/gaybrosgonewild', '/r/sissies', '/r/selffuck', '/r/sounding',
  // Furry
  '/r/furryporn', '/r/zootopiaporn', '/r/yiffgif', '/r/furrypornsubreddit', '/r/gfur', '/r/femyiff', '/r/gayfurryporn', '/r/yiffcomics', '/r/sharktits', '/r/arousingavians', '/r/anthroids', '/r/anthropokeporn', '/r/dragonpenis', '/r/dragonsfuckingdragons', '/r/feralpokeporn', '/r/furryfrot', '/r/gaypokeporn', '/r/horsecocksmasterrace', '/r/scalieporn', '/r/wholesomeyiff',
  // Outfits
  '/r/onoff', '/r/nsfwoutfits', '/r/girlswithglasses', '/r/collared', '/r/seethru', '/r/sweatermeat', '/r/cfnm', '/r/nsfwfashion', '/r/leotards', '/r/bikinis', '/r/bikinibridge', '/r/nsfwcosplay', '/r/nsfwcostumes', '/r/girlsinschooluniforms', '/r/wtstadamit', '/r/tightdresses', '/r/upskirt', '/r/leggingsgonewild', '/r/tightshorts', '/r/lingerie', '/r/garterbelts',
  // Professional/Sites
  '/r/suicidegirls',
  // Public
  '/r/changingrooms', '/r/trashyboners', '/r/flashinggirls', '/r/publicflashing', '/r/sexinfrontofothers', '/r/notsafefornature', '/r/realpublicnudity', '/r/socialmediasluts', '/r/flashingandflaunting',
  // Trans
  '/r/tgirls', '/r/traps', '/r/tgifs',
  // Gay
  '/r/gaysex', '/r/topsandbottoms', '/r/lgbtsex', '/r/gaykink', '/r/gaybdsmcommunity', '/r/gaymersgonewild', '/r/gaybears', '/r/lgbtgonewild', '/r/bigonewild', '/r/gaynsfw',
  // Video
  '/r/pornvids', '/r/nsfw_videos',
  // Meet People
  '/r/dirtysnapchat', '/r/randomactsofblowjob', '/r/dirtykikpals', '/r/randomactsofmuffdive',
  // Other
  '/r/nsfwfunny', '/r/pornhubcomments', '/r/stupidslutsclub', '/r/sluttyconfessions', '/r/sextrophies', '/r/quarantinegonewild', '/r/celebrityarmpits', '/r/armpitfetish',
  // Weird
  '/r/dragonsfuckingcars', '/r/scporn', '/r/fedlegs', '/r/cummingonfigurines',
  // Generic NSFW paths
  '/porn', '/sex', '/nude', '/adult', '/hentai', '/xxx', '/ecchi',
  // Expanded graylist paths for new platforms
  '/artworks/r18', '/tags/r-18', '/tags/r18',
  '/nsfw', '/r18', '/r-18',
  '/tag/nsfw', '/tag/adult', '/tag/onlyfans', '/tag/ecchi',
  '/tags/nsfw', '/tags/nude', '/tags/porn',
  '/games/tag-nsfw', '/games/tag-adult',
  '/groups/nudephotography', '/groups/artisticnude',
  // Anime NSFW Subreddits
  '/r/ecchi', '/r/hentaibondage', '/r/yuri', '/r/yaoi'
].map(p => p.toLowerCase());

const SOFT_PORN_KEYWORDS = [
  'sexy', 'hot babes', 'hot girls', 'hot women', 'hot chicks',
  'bikini babes', 'lingerie', 'underwear models', 'swimsuit models',
  'topless', 'bottomless', 'naked', 'nude', 'nudes',
  'sex', 'sexual',
  // Suggestive-class terms that surface nudity on graylist/tag searches (the
  // Tumblr "/search/bikini" leak). Soft tier: forces SafeSearch on big engines,
  // blocks the search on graylist sites / Tier-2 engines / Reddit.
  'thicc', 'bikini', 'swimsuit', 'cleavage', 'busty', 'thong', 'panties', 'curvy',
  'strip', 'stripping', 'stripper', 'striptease',
  'cam girl', 'camgirl', 'webcam girl', 'live cam',
  'onlyfans', 'only fans', 'patreon nsfw',
  'adult content', 'mature content', '18+', 'nsfw',
  'not safe for work', 'explicit content'
].map(k => k.toLowerCase());

const HARD_PORN_KEYWORDS = [
  'porn', 'pornography', 'pornhub', 'xvideos', 'xnxx', 'redtube',
  'hentai', 'doujin', 'rule34',
  'sex video', 'sex videos', 'porn video', 'porn videos',
  'boobs', 'boobies', 'tits', 'titties', 'breasts',
  'ass', 'butt', 'booty', 'pussy', 'vagina',
  'dick', 'cock', 'penis', 'balls', 'testicles',
  'fuck', 'fucking',
  'milf', 'gilf', 'dilf',
  'gangbang', 'orgy', 'threesome', 'foursome',
  'blowjob', 'handjob', 'footjob',
  'cumshot', 'creampie', 'facial',
  'lesbian porn', 'gay porn', 'shemale', 'trans porn',
  'incest', 'stepmom', 'stepsister', 'stepbrother',
  'rape', 'forced', 'bdsm', 'bondage',
  'bangbros', 'brazzers', 'youporn', 'spankbang', 'xhamster',
  'chaturbate', 'livejasmin', 'bongacams', 'stripchat',
  'camslut', 'camwhore', 'bukkake', 'fellatio', 'cunnilingus',
  'futanari', 'gokkun', 'goatse', 'deepthroat', 'fisting',
  'jailbait', 'lolita', 'bestiality', 'zoophilia', 'necrophilia',
  'coprophilia', 'scat', 'cuckold', 'dominatrix', 'femdom',
  'pegging', 'squirting', 'creampies', 'cumshots', 'assfuck',
  'cocksucker', 'motherfucker', 'doggystyle', 'doggy style',
  'gangbanged', 'circlejerk', 'nympho', 'nymphomania',
  'smegma', 'felching', 'rimjob', 'rimming', 'queef',
  'sodomize', 'sodomy', 'scissoring', 'tribadism',
  'goregasm', 'dolcett', 'guro', 'vorarephilia',
  'suicidegirls', 'babestation', 'slutwife', 'hotwife',
  'ecchi', 'ahegao', 'oppai', 'yaoi', 'yuri',
  'shotacon', 'lolicon', 'doujinshi', 'ero manga', 'eroge',
  'smut', 'erotica',
  // 'pron' = common porn-slang metathesis (porn→pron→pr0n). Whole-word-only
  // (SUBSTRING_UNSAFE) so it can't Scunthorpe apron/prone/pronoun (report Round 7).
  'pron',
  // Bare unambiguous terms — safe under whole-word matching (used only in the
  // Reddit subreddit/search checks). 'xxx'/'cum' are whole-word-only (len < 4),
  // so they can't Scunthorpe; 'gonewild'/'r34'/'lewd' are long enough to substring.
  'xxx', 'cum', 'gonewild', 'r34', 'lewd'
].map(k => k.toLowerCase());

// NUCLEAR SEARCH-QUERY FILTER (shared by Reddit §4c and Patreon §5)
// Returns the matched NSFW keyword if the raw search query contains ANY soft- or
// hard-porn term, else null. Whole-word match for short keywords so we don't
// Scunthorpe innocent queries (essex/massachusetts/document); substring for
// ≥4-char keywords so run-together terms ("milfhunter", "hotbabes") are caught.
// This is the ground-truth-INDEPENDENT layer: it kills the adult *search itself*,
// catching under-tagged/suggestive content the platform never labels NSFW (the
// "privates covered by one pixel → not 18+" leak that DOM label-hiding can't reach).
// ≥4-char keywords that are ALSO substrings of common innocent words — these must
// match WHOLE-WORD ONLY (never run-together), or they Scunthorpe legit searches:
//   cock→cocktail/peacock  butt→button/butter  dick→Dickens  balls→footballs
//   rape→grape/scrape/drape  milf→Milford. Standalone use still blocks; we only
//   give up run-together matches for these few (rare in real adult queries).
const SUBSTRING_UNSAFE_KEYWORDS = new Set(['cock', 'butt', 'dick', 'balls', 'rape', 'milf', 'pron']);

// Collapse runs of single characters separated by separators so spelled-out
// obfuscation ("p o r n", "p.o.r.n", "h-e-n-t-a-i") folds back to the word.
// Requires >=3 single chars in a row, so real multi-letter words are untouched
// ("pen island", "the rapist", "j r r tolkien" → "jrr tolkien" stay safe — only
// genuine single-letter sequences are joined).
function deSpaceLetters(s) {
  return s.replace(/[a-z0-9](?:[\s._\-+*|/~]+[a-z0-9]){2,}/g,
    (m) => m.replace(/[\s._\-+*|/~]+/g, ''));
}

function matchSearchQueryPorn(searchQuery) {
  if (!searchQuery) return null;
  const queryLower = searchQuery.toLowerCase();
  // OBFUSCATION-RESISTANT MATCHING (report Round 7 §A). The hostname layer
  // (checkDomainKeywords) normalizes leetspeak, but this query layer never did —
  // so h3ntai / p0rn / pu55y / b00bs / s3x and the separator forms "p.o.r.n" /
  // "p o r n" slipped the nuclear keyword block on EVERY search surface (Tier-2
  // engines, graylist routes, trusted-host search, Reddit/Patreon). We now test a
  // small set of de-obfuscated variants with the SAME whole-word + >=4-run-together
  // rule, so the Scunthorpe guards (SUBSTRING_UNSAFE + len<4 whole-word-only) still
  // hold. The RAW variant is always included unchanged so digit-bearing keywords
  // (r34 / rule34 / 18+) — which leet-normalization would corrupt — keep matching.
  const bases = new Set([queryLower, deSpaceLetters(queryLower)]);
  const variants = [];
  for (const b of bases) {
    variants.push(b);
    const leet = normalizeLeet(b);
    if (leet !== b) variants.push(leet);
  }
  // NB: don't strip '+' — searchParams already turned URL '+' into spaces, so a
  // surviving '+' is a literal one we must keep (e.g. the "18+" keyword).
  const wordHays = variants.map(
    (v) => ' ' + v.replace(/[_\-.,]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ');
  const has = (keyword) => {
    for (const qText of wordHays) if (qText.includes(' ' + keyword + ' ')) return true; // whole-word
    if (keyword.length >= 4 && !SUBSTRING_UNSAFE_KEYWORDS.has(keyword)) {
      for (const v of variants) if (v.includes(keyword)) return true;                   // run-together
    }
    return false;
  };
  for (const keyword of HARD_PORN_KEYWORDS) if (has(keyword)) return keyword;
  for (const keyword of SOFT_PORN_KEYWORDS) if (has(keyword)) return keyword;
  return null;
}

// GRAYLIST SEARCH-QUERY FILTER — extend the nuclear keyword block (used for
// Reddit §4c + Patreon §5) to EVERY graylisted site's search endpoint. This is
// the ground-truth-INDEPENDENT layer: it kills the adult *search itself* before
// the page renders, which ALSO closes the SSR first-paint leak the JSON scrub
// can't see (report §3.4 + §6.1 — Tumblr/Wattpad/Minds search is server-rendered,
// so the fetch/XHR patch never sees it). Each extractor returns the raw search
// string for its host, pulling it from the query string OR the path (many SPAs
// put the term in the path, e.g. tumblr.com/search/<q>, wattpad.com/search/<q>).

// URL-decoded path segment after `prefix` (e.g. '/search/'), or null.
function pathSegmentAfter(urlObj, prefix) {
  const p = urlObj.pathname;
  if (!p.toLowerCase().startsWith(prefix)) return null;
  let seg = p.slice(prefix.length).split('/')[0];
  if (!seg) return null;
  try { seg = decodeURIComponent(seg); } catch (_) {}
  return seg.replace(/\+/g, ' ');
}
function pathStartsWith(urlObj, prefix) {
  return urlObj.pathname.toLowerCase().startsWith(prefix);
}

const GRAYLIST_SEARCH_ROUTES = new Map([
  ['tumblr.com',      (u) => pathSegmentAfter(u, '/search/') || pathSegmentAfter(u, '/tagged/')],
  ['wattpad.com',     (u) => pathSegmentAfter(u, '/search/') || pathSegmentAfter(u, '/stories/') || pathSegmentAfter(u, '/list/')],
  ['pixiv.net',       (u) => pathSegmentAfter(u, '/tags/') || u.searchParams.get('word')],
  ['x.com',           (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['twitter.com',     (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['minds.com',       (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['youtube.com',     (u) => u.searchParams.get('search_query') || u.searchParams.get('q')],
  ['spotify.com',     (u) => pathSegmentAfter(u, '/search/') || u.searchParams.get('q')],
  ['vimeo.com',       (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['dailymotion.com', (u) => pathSegmentAfter(u, '/search/')],
  ['gumroad.com',     (u) => u.searchParams.get('query') || u.searchParams.get('q')],
  ['imgur.com',       (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['flickr.com',      (u) => pathStartsWith(u, '/search') ? u.searchParams.get('text') : null],
  ['sketchfab.com',   (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['500px.com',       (u) => pathSegmentAfter(u, '/search/') || u.searchParams.get('q')],
  ['artstation.com',  (u) => pathStartsWith(u, '/search') ? u.searchParams.get('query') : null],
  ['newgrounds.com',  (u) => u.searchParams.get('terms') || u.searchParams.get('q')],
  ['itaku.ee',        (u) => u.searchParams.get('search') || u.searchParams.get('q')],
  ['gamebanana.com',  (u) => u.searchParams.get('_sSearchString') || u.searchParams.get('q')],
  // "Trusted" hosts whose on-site search can surface explicit galleries (§1.3).
  ['wikimedia.org',   (u) => u.searchParams.get('search')],
  ['archive.org',     (u) => u.searchParams.get('query') || u.searchParams.get('q')],

  // ── Mainstream AI platforms with NSFW corners (plan item 3.3) ────────────
  // These are NOT the AI-erotica blacklist (domains_ai.json) and NOT the
  // stem-blocked ones (civitai, undressai, … are STRONG stems, blocked
  // outright). These four are genuinely mainstream, genuinely useful, and get
  // the graylist treatment instead: the platform stays fully usable and only
  // the adult SEARCH dies. That distinction is the whole reason graylisting
  // exists — blocking huggingface.co outright would be absurd, and leaving its
  // NSFW model search untouched would be a hole.
  //
  // Character platforms are the highest-value entry here: their filters are
  // routinely worked around, and the search box is where that starts.
  ['character.ai',    (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['c.ai',            (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  ['poe.com',         (u) => pathStartsWith(u, '/search') ? u.searchParams.get('q') : null],
  // Model hubs: the search endpoint carries the term in `search` (HF) — an
  // NSFW-keyword model/dataset hunt is blocked, ordinary model browsing is not.
  ['huggingface.co',  (u) => u.searchParams.get('search') || (pathStartsWith(u, '/search') ? u.searchParams.get('q') : null)]
]);

const GRAYLIST_SEARCH_DOMAINS = new Set(GRAYLIST_SEARCH_ROUTES.keys());

function matchGraylistSearchDomain(hostname) {
  if (GRAYLIST_SEARCH_DOMAINS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (GRAYLIST_SEARCH_DOMAINS.has(parent)) return parent;
  }
  return null;
}

// Matched NSFW keyword if THIS url is an adult search on a graylist site, else null.
function checkGraylistSearch(hostname, urlObj) {
  const base = matchGraylistSearchDomain(hostname);
  if (!base) return null;
  let q = null;
  try { q = GRAYLIST_SEARCH_ROUTES.get(base)(urlObj); } catch (_) {}
  return matchSearchQueryPorn(q);
}

// TRUSTED-HOST EXPLICIT GALLERIES (report §1.3, §3.1, Round 5) — otherwise-SFW
// hosts that also host browsable adult collections / explicit articles. We block
// the adult SURFACES by path without nuking the whole (genuinely useful) host.
// IMPORTANT: this check runs BEFORE the whitelist short-circuit (report §3.1
// "whitelist grants navigation trust, NOT content-filter suppression"), so it
// fires even on whitelisted hosts (wikipedia.org). Tokens are chosen to avoid
// the obvious educational collisions: 'naked' (→ naked mole-rat), bare 'sexual'
// (→ sexual reproduction) and 'breast' (→ breast cancer) are EXCLUDED.
//   • commons.wikimedia.org — adult Category:/File:/Special: gallery surfaces.
//   • wikipedia.org (ALL language + m. subdomains) — explicit SEX-ACT/practice
//     articles that embed real photos & inline VIDEO of the act (report Round 5:
//     /wiki/Ejaculation served an inline "Video of a human male ejaculating",
//     /wiki/Oral_sex|Fellatio|Orgasm carried video, /wiki/Anal_sex 10 photos…).
//     Scope = sex ACTS only (user decision): each slug is anchored at /wiki/ and
//     bounded by (?![a-z]) so pure anatomy / reproduction / health / sex-ed
//     articles (Penis, Vulva, Sexual_reproduction, Sexual_health, Sex_education,
//     Puberty, Pregnancy …) stay ALLOWED. Slugs that would collide with SFW
//     articles are deliberately omitted (e.g. 'squirting'→Squirting_cucumber,
//     'golden_shower'→Golden_shower_tree, 'deep_throat'→Watergate/X-Files).
const TRUSTED_HOST_ADULT_PATH = new Map([
  ['commons.wikimedia.org', /\/(?:wiki\/)?(?:category|file|special):[^?]*?(?:nude|nudity|erotic|porn|pornograph|hardcore|hentai|masturbat|orgasm|ejaculat|fellatio|cunnilingus|handjob|blowjob|penis|phallus|vulva|vagina|labia|clitoris|testicl|scrotum|genitalia|genitals|coitus|copulation|sexual_(?:intercourse|activity|penetration|stimulation|arousal|positions)|bdsm|bondage|fetish)/i],
  ['wikipedia.org', /\/wiki\/(?:(?:ejaculation|female_ejaculation|cum_shot|cumshot|creampie|oral_sex|anal_sex|group_sex|sexual_intercourse|sexual_penetration|mutual_masturbation|female_masturbation|masturbation|orgasm|fellatio|cunnilingus|anilingus|handjob|mammary_intercourse|intercrural_sex|tribadism|bukkake|gokkun|snowballing|felching|gangbang|double_penetration|list_of_sex_positions?|sex_positions?|fisting|coprophilia|urolagnia|hentai|ahegao)(?![a-z])|(?:facial|pearl_necklace|fingering)_(?:\(|%28)sex)/i]
]);

function checkTrustedAdultPath(hostname, urlObj) {
  let re = TRUSTED_HOST_ADULT_PATH.get(hostname);
  if (!re) {
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1 && !re; i++) re = TRUSTED_HOST_ADULT_PATH.get(parts.slice(i).join('.'));
  }
  if (!re) return null;
  return re.test(urlObj.pathname.toLowerCase()) ? 'adult gallery path' : null;
}

// WHITELISTED-HOST ADULT SEARCH (report Round 6 §13.1) — several whitelisted hosts
// expose an on-site SEARCH that can surface adult results the whitelist would
// otherwise wave straight through (Quora NSFW spaces, Amazon/eBay adult listings,
// Crunchyroll ecchi). Like checkTrustedAdultPath this runs BEFORE the whitelist
// short-circuit, but it only kills the *adult search* (porn-keyword query) — every
// normal search/browse on these hosts stays usable, so their (large) legit value
// is preserved. NOTE: this closes the ENUMERABLE adult surface only. The cloud
// FILE hosts (drive.google.com / docs.google.com / dropbox.com / onedrive.live.com)
// stay a documented residual: they render arbitrary uploads with no enumerable
// adult path, and they're core productivity tools that can't be blacklisted —
// per the strategy doc's "file hosts slide" note.
const TRUSTED_HOST_SEARCH = new Map([
  ['quora.com',       (u) => u.searchParams.get('q')],
  ['amazon.com',      (u) => u.searchParams.get('k') || u.searchParams.get('field-keywords')],
  ['ebay.com',        (u) => u.searchParams.get('_nkw')],
  ['crunchyroll.com', (u) => u.searchParams.get('q')]
]);

function checkTrustedHostSearch(hostname, urlObj) {
  let fn = TRUSTED_HOST_SEARCH.get(hostname);
  if (!fn) {
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1 && !fn; i++) fn = TRUSTED_HOST_SEARCH.get(parts.slice(i).join('.'));
  }
  if (!fn) return null;
  let q = null;
  try { q = fn(urlObj); } catch (_) {}
  return matchSearchQueryPorn(q);
}

// SEARCH ENGINE SAFESEARCH ENFORCEMENT
//
// TIER 1 — mainstream engines whose web UI reliably honours a SafeSearch URL
//          param. We force the strict value across ALL regional TLDs
//          (google.de / google.co.uk / search.yahoo.co.jp …). The old code
//          matched only the bare `.com`, so every regional TLD bypassed
//          SafeSearch entirely (Adversarial report §1.2). The new host regexes
//          match the brand on any public-suffix TLD, and DON'T match unrelated
//          sub-domains (mail./docs./news.google.com), so we no longer redirect
//          non-search hosts.
// TIER 2 — other engines (Yandex, Brave, Startpage, Ecosia, Mojeek, Qwant, …)
//          that ignore URL params and/or have no reliable strict param, and were
//          previously UNCOVERED — serving hardcore image grids with zero
//          enforcement (report §1.1). For these we (a) force the documented param
//          where one exists (best-effort), AND (b) hard-block their image/video
//          search surfaces (the thumbnail grids), AND (c) hard-block any search
//          whose query contains an NSFW keyword. General text search still works.
//
// NOTE: self-hosted SearXNG/Searx instances live on arbitrary domains and can't
// be matched by host; AI answer engines (perplexity/you.com) are text and are
// covered by the keyword layer, not here.

const SEARCH_ENGINES = [
  // ── Tier 1 — force strict param, all TLDs ──
  { id: 'google',     tier: 1, re: /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/,         qkeys: ['q'],          param: 'safe',       value: 'active' },
  { id: 'bing',       tier: 1, re: /^(www\.)?(cn\.)?bing\.[a-z]{2,3}(\.[a-z]{2})?$/,     qkeys: ['q'],          param: 'adlt',       value: 'strict' },
  { id: 'duckduckgo', tier: 1, re: /^((www|html|lite|start)\.)?duckduckgo\.com$/,        qkeys: ['q'],          param: 'kp',         value: '1' },
  { id: 'yahoo',      tier: 1, re: /^((www|search)\.)?yahoo\.[a-z]{2,3}(\.[a-z]{2})?$/,  qkeys: ['p'],          param: 'vm',         value: 'r' },
  // ── Tier 2 — block image/video + NSFW queries; force param where known ──
  { id: 'yandex',     tier: 2, re: /^(www\.)?yandex\.[a-z]{2,3}(\.[a-z]{2})?$|^ya\.ru$/, qkeys: ['text', 'q'], param: 'family',     value: 'yes' },
  { id: 'brave',      tier: 2, re: /^search\.brave\.com$/,                               qkeys: ['q'],          param: 'safesearch', value: 'strict' },
  { id: 'qwant',      tier: 2, re: /^(www\.)?qwant\.com$/,                               qkeys: ['q'],          param: 'safesearch', value: '2' },
  // Ecosia DOES honour a URL param (verified against its settings UI and the
  // serv-inc/safe-search enforcement addon): safesearch=2 = strict. (The plan
  // doc said `sfsg=strict` — that param doesn't exist; 2 is the strict value,
  // same scheme as Qwant.) The existing safesearch=0/off bypass check above
  // already covers attempts to force it back off.
  { id: 'ecosia',     tier: 2, re: /^(www\.)?ecosia\.org$/,                              qkeys: ['q'],          param: 'safesearch', value: '2' },
  { id: 'startpage',  tier: 2, re: /^(www\.)?startpage\.com$/,                           qkeys: ['query', 'q'] },
  { id: 'mojeek',     tier: 2, re: /^(www\.)?mojeek\.com$/,                              qkeys: ['q'] },
  { id: 'swisscows',  tier: 2, re: /^(www\.)?swisscows\.com$/,                           qkeys: ['query', 'q'] },
  { id: 'gibiru',     tier: 2, re: /^(www\.)?gibiru\.com$/,                              qkeys: ['q'] },
  { id: 'yep',        tier: 2, re: /^(www\.)?yep\.com$/,                                 qkeys: ['q'] },
  { id: 'metager',    tier: 2, re: /^(www\.)?metager\.org$/,                             qkeys: ['eingabe', 'q'] },
  // ── Round 6 §13.4 — major non-Western engines the Tier-2 list omitted. They
  //    force no param and were fully uncovered. Realized payoff is capped by the
  //    engines' OWN heavy self-censorship (Baidu→artistic, Naver→0 results), but
  //    the enforcement gap is identical to Yandex/Brave, so we cover the class:
  //    block image/video surfaces (incl. their image.* / pic.* subdomains, see
  //    isMediaSearchSurface) + NSFW queries. Narrow host regexes so non-search
  //    subdomains (tieba./baike./fanyi.baidu.com, mail.naver.com) are untouched.
  { id: 'baidu',      tier: 2, re: /^(www\.|m\.|image\.|pic\.|v\.)?baidu\.com$/,         qkeys: ['word', 'wd', 'q'] },
  { id: 'naver',      tier: 2, re: /^(search\.|s\.|m\.)?naver\.com$/,                    qkeys: ['query', 'q'] },
  { id: 'sogou',      tier: 2, re: /^(www\.|pic\.|m\.|v\.)?sogou\.com$/,                 qkeys: ['query', 'q'] },
  { id: 'seznam',     tier: 2, re: /^search\.seznam\.cz$/,                               qkeys: ['q'] }
];

function matchSearchEngine(hostname) {
  for (const se of SEARCH_ENGINES) if (se.re.test(hostname)) return se;
  return null;
}

// Does this URL look like an image / video / picture search surface? Used to deny
// the hardcore thumbnail grids on Tier-2 engines that ignore our forced param.
function isMediaSearchSurface(urlObj) {
  // Host-based: a dedicated image/picture/video search SUBDOMAIN is a media
  // surface by definition (image.baidu.com, pic.sogou.com, images.search.yahoo).
  // Only ever reached for matched Tier-2 engines, so this can't over-match SFW.
  if (/^(images?|imgs?|pic|pics|photo|photos|video|videos)\./.test(urlObj.hostname.toLowerCase())) return true;
  const p = urlObj.pathname.toLowerCase();
  // 'obrazky' = Seznam's image path (Czech for "images").
  if (/(^|\/)(images?|imgs?|videos?|vids?|pics?|photos?|gallery|obrazky)(\/|$)/.test(p)) return true;
  const sp = urlObj.searchParams;
  // 'where' = Naver tab (where=image), 'tn' = Baidu surface (tn=baiduimage).
  for (const k of ['t', 'tbm', 'ia', 'iax', 'iar', 'cat', 'kind', 'fmt', 'type', 'where', 'tn']) {
    const v = (sp.get(k) || '').toLowerCase();
    if (/image|isch|img|video|vid|photo|pic/.test(v)) return true;
  }
  return false;
}

function readSearchQuery(urlObj, qkeys) {
  for (const k of qkeys) {
    const v = urlObj.searchParams.get(k);
    if (v) return v;
  }
  return null;
}

// Direct image-CDN access (plan 3.4) — the raw thumbnail servers BEHIND the
// engines' image search. An image-search result grid is just <img> tags into
// these hosts, so copying a thumbnail URL (or a "view image" deep link) into
// the address bar serves the NSFW image with zero engine-side SafeSearch and
// zero SEARCH_ENGINES coverage (the CDN hostnames don't match any engine
// regex). Only ever consulted for top-level navigations / frame loads via
// shouldBlockUrl — embedded <img> subresources on normal pages never reach
// this code path, so blocking here can't break Bing/Yandex thumbnails
// legitimately inlined elsewhere.
function isDirectImageCdn(urlObj) {
  const h = urlObj.hostname.toLowerCase();
  // Bing thumbnails: tse1–tse4.mm.bing.net + th.bing.com, all under /th?id=…
  // Path-gated so unrelated bing.net infrastructure hosts stay untouched.
  if ((h === 'th.bing.com' || h === 'bing.net' || h.endsWith('.bing.net')) &&
      /^\/th([\/?]|$)/.test(urlObj.pathname)) return true;
  // Yandex image thumbnails: the im0-tub-{ru,com,…}.yandex.net farm serves
  // /i?id=… previews; avatars.mds.yandex.net/get-images-* is the full-size
  // image store behind yandex.com/images (path-gated — avatars.mds also hosts
  // benign service icons under other /get-* namespaces).
  if (/^im\d+-tub[a-z0-9-]*\.yandex\.net$/.test(h)) return true;
  if (h === 'avatars.mds.yandex.net' && /^\/get-images/.test(urlObj.pathname)) return true;
  return false;
}

// SAFESEARCH ENFORCEMENT (always-on)

function checkSearchEngineSafeSearch(url, hostname) {
  // Image-CDN direct access is checked BEFORE the engine table — the CDN
  // hosts aren't search frontends, so matchSearchEngine can never see them.
  try {
    const cdnUrl = new URL(url);
    if (isDirectImageCdn(cdnUrl)) {
      return { blocked: true, reason: 'search_media_uncovered', match: cdnUrl.hostname + ' image CDN direct', tier: 'blacklist', hostname };
    }
  } catch (_) {}

  const se = matchSearchEngine(hostname);
  if (!se) return null;

  try {
    const urlObj = new URL(url);

    // Block attempts to disable SafeSearch on ANY recognised engine.
    const low = url.toLowerCase();
    if (low.includes('safe=off') || low.includes('safesearch=off') || low.includes('safe=0') ||
        low.includes('safesearch=0') || low.includes('adlt=off') || low.includes('family=no')) {
      console.log('SafeSearch disabled - blocking bypass attempt');
      return {
        blocked: true,
        reason: 'safesearch_bypass',
        match: 'SafeSearch disabled',
        severity: 'bypass_attempt'
      };
    }

    // TIER 2 hard blocks: image/video grids and NSFW queries leak even when the
    // engine ignores our forced param, so deny those surfaces outright.
    if (se.tier === 2) {
      if (isMediaSearchSurface(urlObj)) {
        return { blocked: true, reason: 'search_media_uncovered', match: se.id + ' image/video search', tier: 'blacklist', hostname };
      }
      const hit = matchSearchQueryPorn(readSearchQuery(urlObj, se.qkeys));
      if (hit) {
        return { blocked: true, reason: 'search_query_keyword', match: se.id + ':' + hit, tier: 'blacklist', hostname };
      }
    }

    // Force the strict SafeSearch param (Tier 1 always; Tier 2 where we know one).
    if (se.param && urlObj.searchParams.get(se.param) !== se.value) {
      urlObj.searchParams.set(se.param, se.value);
      return {
        safesearch: true,
        redirectUrl: urlObj.toString(),
        reason: 'safesearch_always_on',
        match: se.id + ' SafeSearch enforced'
      };
    }
  } catch (error) {
    console.error(' Error checking search engine:', error);
  }

  return null;
}

// ============================================================================
// DOMAIN-NAME KEYWORD LAYER  (Phase 2)
// Catches porn domains that aren't on the exact blocklist (e.g. sex4arabs.com)
// WITHOUT Scunthorpe false positives. Rules:
//   - Match stems ONLY against the hostname — never paths/queries/page content.
//   - Strong, unambiguous stems match as a substring anywhere.
//   - Collision-heavy 3-letter roots (cum/ass/tit/pussy) are NEVER matched bare —
//     only inside explicit porn compounds.
//   - Guarded roots (sex/anal/cock/dick/rape/cunt/milf) match as a substring but
//     are excused when the match sits inside a whitelisted real word
//     (essex, analytics, peacock, dickens, grape, scunthorpe, milford, ...).
//   - Leetspeak (p0rn, s3x) is normalised before matching.
// Deterministic — a host either contains an unexcused stem or it doesn't.
// ============================================================================

const ADULT_TLDS = ['.xxx', '.porn', '.adult', '.sex', '.sexy'];

// Tier A — long / unambiguous. Substring match anywhere in the hostname.
const KEYWORD_STEMS_STRONG = [
  'porn', 'pornhub', 'xvideos', 'xvideo', 'xnxx', 'xhamster', 'redtube', 'youporn',
  'spankbang', 'brazzers', 'bangbros', 'hentai', 'doujin', 'doujinshi', 'rule34',
  'nsfw', 'bukkake', 'blowjob', 'handjob', 'rimjob', 'cumshot', 'creampie', 'gangbang',
  'deepthroat', 'fellatio', 'cunnilingus', 'masturbat', 'dildo', 'fleshlight',
  'onlyfans', 'chaturbate', 'livejasmin', 'bongacams', 'stripchat', 'myfreecams',
  'camsoda', 'futanari', 'ahegao', 'lolicon', 'shotacon', 'shemale', 'cuckold',
  'femdom', 'fisting', 'jailbait', 'bestiality', 'camgirl', 'camwhore',
  'titties', 'boobies', 'sexcam', 'sexvideo', 'sextape', 'escortservice',

  // ═══ Multi-language — Batch 1 (ES FR DE PT AR RU ZH TR JA HI) ═══
  // Source: docs/reference/nsfw-keywords-multilingual.md. Only unique/long terms that survived
  // each language's WARNING block. Short/common terms (am, cu, se, gan, cao, av,
  // kos, tiz, geil, arsch, dul, lund, chod, boquete, gostosa, family-relation
  // words…) are EXCLUDED — deferred to the curated list + native-script (IDN).
  // Ambiguous roots (puta, pute, randi, chut, salope, seks) are GUARDED below.
  // — Spanish —
  'follar', 'mamada', 'mamadas', 'chupapollas', 'desnuda', 'desnudas', 'tetas',
  'tetona', 'tetonas', 'partuza', 'putita', 'putitas', 'putilla', 'putillas',
  // — French —
  'branlette', 'partouze', 'godemichet', 'suceuse', 'avaleuse', 'lesbienne',
  'dominatrice', 'nichons',
  // — German —
  'ficken', 'huren', 'nutten', 'schlampe', 'schlampen', 'muschi',
  'muschis', 'fotze', 'fotzen', 'schwanz', 'pimmel', 'arschloch',
  'arschfick', 'wichser', 'wichsen', 'abspritzen', 'flittchen',
  // — Portuguese —
  'caralho', 'boceta', 'xereca', 'bunduda', 'punheta', 'esporra',
  'cornudo',
  // — Arabic (Arabizi) —
  'sharmota', 'sharmoota', 'sharamit', 'sharmotat', 'qahba', 'qahbat', 'qa7ba',
  'neekat', 'naykeen', 'naykah', 'zboub', 'manyakeh', 'manayeek', 'dayoos',
  'dayooth', 'niswanji', 'fadiha', 'fadi7a', 'bzaz', 'bzooz', 'so7aq',
  'mamhoun', 'mamhouna', 'da3ara', 'metnak', 'mitnaka', 'labwa',
  // — Russian (translit) —
  'porevo', 'pizda', 'shluha', 'shluhi', 'shalava', 'shalavy', 'prostitutka',
  'prostitutki', 'eblya', 'telki', 'drochila', 'zhopa',
  'popka', 'popochka', 'trahatsya', 'minetchik', 'gruppovuha', 'lesbiyanki',
  // — Chinese (pinyin; most ZH terms excluded as surnames/places) —
  'caonima', 'koujiao', 'seqing',
  // — Turkish —
  'orospu', 'orospular', 'kaltak', 'sikis', 'sikerim', 'masturbasyon',
  'lezbiyen', 'otuzbir', 'bosalma', 'yarragi',
  // — Japanese (romaji) —
  'oppai', 'paizuri', 'omanko', 'chinpo', 'onani', 'senzuri',
  'manzuri', 'sukebe', 'jukujo', 'kyonyu', 'ferachi', 'hamedori', 'deriheru',
  'netorare', 'nakadashi', 'gokkun', 'tekoki', 'ecchi',
  // — Hindi/Hinglish —
  'chudai', 'chudu', 'chudakkad', 'choot', 'gaand',

  // ═══ Multi-language — Batch 2 (IT NL PL KO ID VI EL RO BN) ═══
  // Most short terms (fica, fut, dit, lon, kolo, sani, cur, am, hee, kuy…) are
  // EXCLUDED per each language's WARNING block — they collide with everyday
  // words/names/places. Ambiguous roots (sesso, figa, puttane, hoer, dupa,
  // sperma, curva, malakia, chikan) are GUARDED below. Thai romaji contributes
  // nothing here (all monosyllabic collisions) → deferred to IDN + curated.
  // — Italian —
  'cazzo', 'cazzi', 'bagascia', 'chiavare', 'fottere', 'bocchino',
  'pompino', 'pompini', 'sborra', 'arrapato', 'arrapata', 'lesbica', 'lesbiche',
  'frocio', 'puttana', 'fighe',
  // — Dutch —
  'neuken', 'neuker', 'hoeren', 'kutten', 'aftrekken', 'pijpen',
  'lesbisch',
  // — Polish —
  'cipka', 'chuj', 'fiut', 'jebac', 'jebie', 'dupy', 'dziwka', 'dziwki',
  'kurwa', 'kurwy', 'cycki', 'cycek', 'ruchac', 'ciota', 'wytrysk', 'lesbijka',
  'lesbijki',
  // — Korean (romanized) —
  'shibal', 'eongdeongi', 'gaseumgol', 'changnyo', 'geolre',
  'rejeubieon',
  // — Indonesian —
  'bokep', 'ngentot', 'memek', 'kontol', 'titit', 'colmek',
  'jablay', 'lonte', 'bugil', 'toket', 'bokong', 'nyepong',
  'mengisap',
  // — Vietnamese —
  'thudam', 'quaytay', 'clipnong', 'loanluan', 'xuattinh', 'khoathan', 'gaixinh',
  // — Greek (Greeklish) —
  'poutsos', 'poutsa', 'gamisi', 'vyzia', 'tsoula', 'arxidia', 'malakies',
  'tsimpouki', 'xysimo', 'pousti',
  // — Romanian —
  'futut', 'pizde', 'labagiu', 'poponar', 'lesbiene', 'dezbracat',
  // — Bengali —
  'khanki',

  // ═══ Multi-language — Batch 3 (Scandi CS HU TL FA UK FI HE TA/TE MS PA UR SW AF SR BG SK ML/KN MR) ═══
  // Heaviest deferral yet — Dravidian/Persian/short-Germanic terms collide with
  // Indian places/names, Sanskrit, Latin and everyday words (see each WARNING).
  // Ambiguous roots guarded below. Gujarati + much of Urdu/Vietnamese rely on
  // existing guards (chod/chut/seks/porn/randi/puta).
  // — Scandinavian (SE/NO/DK) —
  'fitta', 'fittor', 'fisse', 'fisser', 'kusse', 'kusser', 'knulla', 'knulle',
  'kneppe', 'knepper', 'horor', 'slampa', 'slampor', 'tuttar',
  'liderlig', 'lesbisk',
  // — Czech —
  'mrdat', 'mrdka', 'mrdal', 'kokot', 'curak', 'kurva', 'devka', 'prdel', 'prcat',
  // — Hungarian —
  'szex', 'baszni', 'baszas', 'fasz', 'fasza', 'faszfej', 'kurvak',
  'gecik', 'picsak', 'csocs', 'szopo', 'szopni',
  // — Tagalog —
  'kantot', 'kantutan', 'iyot', 'inyot', 'pekpek', 'jakol', 'salsal', 'libog',
  'malibog', 'chupain',
  // — Persian —
  'jende', 'jendeh', 'gaeedam', 'gaidam', 'mameh', 'sakzadan',
  // — Ukrainian —
  'shluhy', 'yebaty',
  // — Finnish —
  'pillut', 'kyrpa', 'nussia', 'bylsia', 'huora', 'tissit',
  'runkkari', 'alaston', 'alastonkuvat',
  // — Hebrew —
  'hizdayen', 'shadayim',
  // — Tamil / Telugu —
  'pundai', 'pundae', 'koodhi', 'koothi', 'soothu', 'mulaigal', 'thayoli',
  'sallalu', 'lanjalu',
  // — Malay —
  'lancap', 'melancap', 'tetek', 'kongkek', 'enjut', 'sontot', 'pelacur',
  // — Punjabi —
  'phudi', 'chudva', 'kanjar', 'kanjri', 'tattay', 'chupo',
  'chupan',
  // — Urdu —
  'ghasti',
  // — Swahili —
  'mboro', 'matako', 'kunyandua', 'nyandu', 'kusagana', 'punyeto', 'mkundu',
  // — Afrikaans —
  'naaier', 'naaifliek', 'fokken',
  // — Serbo-Croatian —
  'jebanje', 'jebati', 'jebac', 'kurac', 'guzic', 'drkanje', 'drkat', 'drolja',
  'drolje', 'svrsavanje', 'pusenje', 'picajzla',
  // — Bulgarian —
  'pichka', 'pichki', 'guzove', 'tsici', 'kurvi', 'shlaha', 'shliha',
  // — Slovak —
  'jebanie', 'kundy', 'kokoty', 'kurvy', 'cecky', 'vyfajcit',
  // — Malayalam / Kannada —
  'pooru', 'thullu', 'kazhappu',
  // — Marathi —
  'zhavne', 'zhavadi', 'zhavnya', 'zhavade', 'pucchi', 'bochi', 'lavda',
  'madarzat',

  // ═══ Special categories — Batch 4 (anime/3D, fetish/leak slang, adult games, AI) ═══
  // Mostly English brand/slang terms. EXCLUDED as legit words / acronyms / the
  // nofap recovery site: furry, vore, scat, latex, rubber, harem, bull, bbc,
  // nofap, blender, manga, wildlife, cbt, faceswap, trap, gimp, clop, edging,
  // pegging, chastity, sissy, motherless, erome, asstr (masstransit/classtrip).
  // Boorus & graylist sites (furaffinity, inkbunny, gelbooru…) are NOT keyword-
  // blocked — they're Graylist-V2 filter targets. Ambiguous: thot/findom/coomer
  // are GUARDED below.
  // — Anime / 3D / CGI —
  'yiff', 'eroguro', 'waifu', 'monstergirl', 'hmanhua', 'bdcul', 'denpasoft',
  'mangagamer', 'jastusa', 'kaguragames', 'filtfap', 'fapnation', 'fapgames',
  'tsumino', 'pururin', 'hanime', 'erocosplay', 'shadbase', 'paheal', 'koikatsu',
  'koikatu', 'honeyselect', 'aishoujo', 'sankakucomplex', 'derpibooru', 'e621',
  // — Fetish / leak / subculture slang —
  'scalie', 'murrsuit', 'goonette', 'paypig', 'cashslave', 'gloryhole',
  'femboy', 'sissification', 'gimpsuit', 'necrophilia', 'footfetish', 'footjob',
  'shibari', 'kinbaku', 'cuckquean', 'hotwife', 'tribbing', 'cfnm', 'cmnf',
  'fapello', 'bunkr', 'simpcity', 'ofleaks', 'fansly', 'cyberdrop', 'bdsm',
  'gonewildaudio', 'eraudica', 'soundgasm',
  // — Adult games / mods —
  'jennymod', 'elliemod', 'wickedwhims', 'summertimesaga', 'beingadik',
  'robloxcondo', 'rbxcondo', 'condogames', 'gachaheat', 'sentrucondo', 'nutaku',
  'dlsite', 'fanza', 'virtamate',
  // — AI / deepfake —
  'civitai', 'deepnude', 'undressai', 'undressher', 'clothoff', 'nudify',
  'nudifier', 'deepfake', 'dezgo', 'soulgen', 'promptchan', 'unstablediffusion',
  'spicychat', 'janitorai', 'crushonai', 'dreamgf', 'sillytavern', 'lovense',
  'kiiroo', 'autoblow', 'sxyprn', 'efukt', 'venusai'
];

// Explicit porn COMPOUNDS — let the collision-heavy roots (cum/ass/tit/pussy/
// cock/dick) match only inside an unambiguous context.
const KEYWORD_COMPOUNDS = [
  'cumslut', 'cumdump', 'cumtribute', 'cumpilation',
  'asshole', 'assfuck', 'assfucking', 'asslick', 'assporn',
  'bigtits', 'hugetits', 'nicetits', 'titfuck', 'titjob', 'saggytits',
  'wetpussy', 'tightpussy', 'pussyfuck', 'pussylick', 'eatpussy',
  'bigcock', 'suckcock', 'cocksucker', 'cocksucking', 'monstercock', 'horsecock',
  'hugecock', 'thickcock', 'cockslut', 'cockwhore', 'cockhungry', 'gaycock', 'cockpic',
  'bigdick', 'suckdick', 'dickpic', 'dickslut', 'dicksucking', 'dickriding', 'smalldick',
  'analsex', 'analporn', 'analcreampie'
];

// AI-erotica COMPOUNDS (plan item 3.3) — the AI-girlfriend/companion-bot and
// jailbroken-chat naming trend pairs a common English word ("girlfriend",
// "boyfriend", "companion", "waifu", "nude", "lewd") with "ai"/"gpt", the same
// way cum/ass/tit/pussy/cock/dick above are compound-only: the bare word alone
// is common-word collision-heavy (see below), but nobody accidentally names a
// website "aigirlfriend" or "nsfwgpt".
//   - 'nsfwai'/'ainsfw'/'nsfwgpt'/'gptnsfw'/'hentaiai'/'aihentai'/'aiwaifu'/
//     'waifuai' are already reachable via the existing bare 'nsfw'/'hentai'/
//     'waifu' STRONG stems above — kept explicit anyway for readability/intent
//     and because compounds are checked with zero whitelist escape (unlike
//     guarded roots), so they're worth pinning down with their own tests.
//   - Deliberately did NOT add bare 'girlfriend'/'boyfriend'/'companion' as a
//     GUARDED root: "companion" collides with real senior-care/travel-
//     insurance brands (CompanionLife, travel companion services, senior
//     "companion aide" care) and "girlfriend"/"boyfriend" collide with dating/
//     entertainment sites generally — guarding them would need a whitelist the
//     size of the English language. Compound-only sidesteps that entirely.
//   - Also deliberately did NOT add 'companionai'/'companionaide'-shaped
//     suffix compounds (real collision: senior-care "Companion Aide" services)
//     or bare 'jailbreak'-anything (collides with legitimate iOS-jailbreak and
//     AI-safety/"uncensored LLM" research discourse). 'unfilteredai'/
//     'uncensoredai' were considered and DROPPED for the same reason
//     (foreseeable collision with legit open-source "uncensored LLM" research
//     naming) even though a couple of confirmed NSFW brands use that exact name
//     — those are handled as exact domain entries in domains_ai.json instead,
//     where an exact-match blocklist carries no substring false-positive risk.
//     'tavernai' (TavernAI, the jailbroken-chat frontend) was likewise DROPPED
//     — it sits inside real Greek restaurant names ("tavernaithaki" = Taverna
//     Ithaki) and compounds have zero whitelist escape; tavernai.net /
//     nsfwtavern.ai are exact entries in domains_ai.json.
//   - 'aicompanion' is NOT here either — every "-ai"-final word + "companion"
//     contains it (bonsaicompanion, samuraicompanion), so it needs the
//     whitelist-escape machinery: it's a GUARDED root below.
const KEYWORD_COMPOUNDS_AI_EROTICA = [
  'aigirlfriend', 'girlfriendai', 'virtualgirlfriend',
  'aiboyfriend', 'boyfriendai', 'virtualboyfriend',
  'nsfwai', 'ainsfw', 'nsfwgpt', 'gptnsfw',
  'hentaiai', 'aihentai',
  'aiwaifu', 'waifuai',
  'lewdai', 'nudeai', 'ainude'
];
KEYWORD_COMPOUNDS.push(...KEYWORD_COMPOUNDS_AI_EROTICA);

// Guarded roots — substring match, but excused by whitelist coverage.
const KEYWORD_ROOTS_GUARDED = [
  // NB: cock & dick are NOT here — like cum/ass/tit/pussy they are COMPOUND-ONLY
  // (see KEYWORD_COMPOUNDS). As bare roots they collided with ~190 real words
  // (blackcock, woodcock, billycock, medick, dickcissel, Moby-Dick, Dickens…).
  'sex', 'anal', 'rape', 'cunt', 'milf',
  // multi-language ambiguous roots (whitelist-guarded below):
  'seks', 'puta', 'pute', 'randi', 'chut', 'chod', 'salope',
  // batch 2:
  'sesso', 'figa', 'puttane', 'hoer', 'dupa', 'sperma', 'curva', 'malakia', 'chikan',
  // batch 3:
  'porr', 'kunda', 'picsa', 'dengu', 'poes', 'picka', 'ebane', 'ebati', 'tissi',
  // batch 4 (thot dropped entirely — collided with orthotic/lithotomy/lithotripsy):
  'findom', 'coomer',
  // demoted from KEYWORD_STEMS_STRONG — too collision-prone to match bare; now
  // whitelist-guarded (traps below). See test-domains.cjs for the collisions:
  //   luder→excluder/includer/concluder, rumpa→"trump a…", titten→Tittensor,
  //   kulli→skull-island. (puku/itil/foder/borsten/sletten/geci/fudi/pudi/gasti/
  //   naai/hure/tette/peler/siski/chinko… were too ambiguous even for guarding →
  //   dropped to curated-list + IDN.)
  'luder', 'rumpa', 'titten', 'kulli',
  // demoted via the wordlist audit (audit-wordlist.cjs):
  'pillu', 'gooning', 'zoophil',
  // bocha (MR) was strong → collided with turbo-charge/turbo-charger (trap: bochar):
  'bocha',
  // AI-erotica (plan 3.3): 'aicompanion' is the companion-bot ecosystem's
  // generic self-description, but any "-ai"-final word + "companion" contains
  // it (bonsaicompanion, samuraicompanion — traps below), so it can't be a
  // zero-escape compound like the aigirlfriend/nsfwgpt family above.
  'aicompanion'
];

// Whitelist of real words that legitimately contain a guarded root. A guarded
// root is ignored when its occurrence sits fully inside one of these.
const KEYWORD_WHITELIST_WORDS = [
  // sex
  'sexual', 'sexuality', 'sexualis', 'sexualize', 'sexualise', 'sexology',
  'sexologist', 'sexagenarian', 'sexagesimal', 'sexpartite', 'sextant', 'sextet',
  'sextett', 'sextuple', 'sextuplet', 'sexton', 'sexism', 'sexist', 'unisex',
  'intersex', 'samesex', 'sexed', 'sexeducation', 'essex', 'sussex', 'middlesex',
  'wessex', 'transsexual', 'homosexual', 'heterosexual', 'bisexual', 'asexual',
  'pansexual', 'demisexual',
  // anal
  'analysis', 'analytic', 'analytics', 'analyst', 'analytical', 'analyze', 'analyse',
  'analyzer', 'analyser', 'analyzed', 'analysed', 'analyzing', 'analysing', 'analog',
  'analogue', 'analogy', 'analogous', 'analemma', 'analgesic', 'analgesia', 'canal',
  'canals', 'banal', 'banality',
  // cock
  'peacock', 'cocktail', 'cockpit', 'cockroach', 'cockney', 'hancock', 'hitchcock',
  'babcock', 'woodcock', 'shuttlecock', 'gamecock', 'stopcock', 'weathercock',
  'cockle', 'cockerel', 'cockatoo', 'cockade', 'cocker', 'cockburn', 'cockfosters',
  'cocksure', 'petcock', 'haycock',
  // dick
  'dickens', 'dickinson', 'dickson', 'dicker', 'dickey', 'dicky', 'benedick',
  // rape
  'grape', 'grapes', 'grapefruit', 'grapevine', 'drape', 'drapes', 'drapery', 'draped',
  'scrape', 'scraped', 'scraper', 'scraping', 'trapeze', 'therapeutic', 'therapeutics',
  'rapeseed',
  // cunt
  'scunthorpe',
  // milf
  'milford', 'milfoil', 'milfont',
  // cum / ass / tit / pussy — these roots are compound-only (never matched bare),
  // so the following are belt-and-suspenders / future-proofing per project spec.
  'cumulative', 'accumulate', 'accumulation', 'document', 'documentary',
  'documentation', 'circumstance', 'circumstances', 'circumvent', 'cucumber', 'scum',
  'cumin', 'incumbent', 'cumberland', 'cumbersome', 'encumber',
  'class', 'classic', 'classical', 'classroom', 'mass', 'massive', 'massachusetts',
  'passage', 'password', 'embassy', 'ambassador', 'assassin', 'assault', 'assemble',
  'assembly', 'assess', 'assessment', 'asset', 'assets', 'assign', 'assignment',
  'assist', 'assistant', 'associate', 'association', 'glass', 'grass', 'brass', 'bass',
  'harass', 'harassment', 'bypass', 'compass', 'canvass', 'molasses', 'potassium',
  'title', 'titles', 'titan', 'titanic', 'titanium', 'competitive', 'constitution',
  'substitute', 'institute', 'petition', 'repetition', 'latitude', 'altitude',
  'attitude', 'gratitude', 'multitude', 'titration',
  'pussycat', 'pussyfoot', 'pussywillow', 'octopus', 'platypus', 'opus',
  // ══ Multi-language false-positive traps (Batch 1) ══
  // seks — Turkish: eighty / section
  'seksen', 'seksenler', 'seksiyon',
  // puta — reputable, computation, amputate, disputable, putative, diputado…
  'reputa', 'computa', 'amputa', 'disputa', 'imputa', 'deputa', 'putativ', 'diputa',
  // pute — compute, dispute, repute, impute, depute, amputee
  'compute', 'dispute', 'repute', 'impute', 'depute', 'amputee',
  // randi — grandiose, branding, randint
  'grandi', 'brandi', 'randint',
  // chut — parachute, chutney, chutzpah, chute
  'parachut', 'chutney', 'chutzpah', 'chute',
  // salope — salopette (overalls). (escalope does NOT actually contain 'salope')
  'salopett', 'escalope',
  // chod — Tibetan Buddhist Chöd / Pema Chödrön
  'chodron', 'chodorov',
  // Documentary / future-proof — WHY these foreign stems are EXCLUDED from
  // substring matching (surname / place / name / common-word collisions):
  'caoliu', 'macaoliu', 'haose', 'selang', 'selangor', 'yadong', 'sneek',
  'design', 'desire', 'savita', 'bhabhi', 'java', 'javelin', 'heteroge',
  'erogen', 'figaro', 'possesso', 'chikan', 'lund', 'manko', 'mankato',
  'spermat', 'spiegel', 'marsch', 'amsterdam', 'huanghe', 'citizen', 'avatar',
  'sikhism', 'nutter', 'trafficker', 'lauda', 'boquete', 'gostosa', 'corrida',
  // ══ Batch 2 traps ══
  'possesso',                            // IT sesso (possession)
  'puttanesca',                          // IT puttane (pasta sauce)
  'hoera',                               // NL hoer (hurray)
  'dupage', 'dupatta',                   // PL dupa (DuPage county / Indian scarf)
  'spermat', 'spermac',                  // PL/RO sperma (spermatozoa / spermaceti)
  'curvatur', 'curvace',                 // RO curva (curvature / curvaceous)
  'malakian',                            // EL malakia (surname — Daron Malakian)
  'chikankari',                          // KO/JA chikan (Indian embroidery)
  'chodavaram', 'chodankar',             // BN chod (Indian town / surname)
  'seksualn', 'seksuolog', 'seksizm',    // PL seks (sexual / sexology / sexism)
  // ══ Batch 3 traps ══
  'porridge',                            // Scandi porr
  'kundalini',                           // CZ/SK kunda
  'picsart',                             // HU picsa (photo app)
  'dengue',                              // TE dengu (fever)
  'poesia', 'poesie',                    // AF poes (poetry)
  'pickax', 'pickard',                   // SR picka (pickaxe / Picard)
  'lebanese',                            // BG ebane
  'debati', 'rebati',                    // BG ebati (debating / rebating)
  'patissier',                           // FI tissi (pastry chef)
  // ══ Batch 4 traps ══
  'thoth',                               // thot (Egyptian god)
  'findomestic',                         // findom (Italian bank)
  'coomera',                             // coomer (Queensland suburb)

  // ══ Adversarial-corpus traps (test-domains.cjs §"insanely confusing") ══
  // English guarded-root gaps the substring+whitelist model was missing:
  'trapez', 'serape', 'crape',           // rape → trapeze/trapezoid/trapezius, serape, crape-myrtle
  'cockatiel', 'cockaigne', 'cockcroft', // cock → cockatiel, Land of Cockaigne, John Cockcroft
  'alcock', 'glasscock',                 // cock → aviator Alcock, Glasscock County TX
  'mobydick', 'dickory',                 // dick → Moby-Dick, Hickory Dickory Dock
  'sexsmith', 'sexey',                   // sex → Sexsmith (AB town), Sexey's School
  'mirandi',                             // randi → Miranda / Mirandized
  'incurva',                             // curva → incurvation / incurvate
  // anal → channel/place/company/word collisions (canal already covers cognates):
  'kanal', 'manali', 'panal', 'bacchanal', // Kanal (TV), Manali (India), Panalpina, bacchanalia
  // multilingual guarded-root gaps surfaced by the audit:
  'kundera', 'mukunda', 'kundan',        // kunda → author Kundera, deity Mukunda, Kundan jewellery
  'putamen', 'saputar',                  // puta → putamen (brain), Saputara (India)
  'pickap', 'pickab',                    // picka → pick-a-part/phone, pickaback/pickability
  'poesy',                               // poes → poesy (poetry)
  // traps for the roots just demoted from strong (above):
  'cluder', 'eluder', 'lluder',          // luder → ex/in/con/oc-cluder, de/e/pre-luder, colluder
  'trumpa',                              // rumpa → "trump a…" etc.
  'tittensor',                           // titten → Tittensor (Staffordshire village)
  'skulli',                              // kulli → skull-island / skull-i…

  // ══ Wordlist-audit traps (audit-wordlist.cjs) ══
  // Real-website English words that collided with a guarded root. Each entry
  // contains its root so WHITELIST_BY_ROOT indexes it automatically. (We only
  // chase common/real-site words here — not the archaic-dictionary long tail.)
  // sex → leap-year / printing / astrology / neuter / poetry terms:
  'bissext', 'desex', 'sextil', 'sexto', 'sextain', 'sextan',
  // anal → minerals / Confucius / medicine / illiteracy:
  'analci', 'analect', 'analept', 'analphabet', 'analav',
  // rape → anatomy / architecture / plants:
  'traper', 'parape', 'broomrape', 'igarape', 'frape',
  // randi → "after a meal" / modus operandi / drugs / minerals / plants:
  'prandi', 'operandi', 'jaborandi', 'randit', 'randia', 'farandi',
  // sesso → assessor/obsessor/insessor:
  'sessor',
  // onani → nonanimal/nonanimate:
  'nonani',
  // bocha → turbocharger/turbocharge:
  'bochar',
  // tissi → fortissimo/latissimus/prestissimo:
  'tissim',
  // chod → bronchodilator / psychodrama / tichodroma:
  'ychod', 'nchod', 'ichod',
  // curva → curvate/curvature & re/ex/de/pro/trans-curvation:
  'curvat', 'curvac', 'recurva', 'excurva', 'decurva', 'procurva', 'transcurva',
  // sperma → botanical -spermae / spermaduct / spermary:
  'ospermae', 'spermaduct', 'spermary', 'spermaphyt',
  // puta → Laputa / putamen / putation / sputa / supputation:
  'laputa', 'putamin', 'putati', 'sputa', 'supputa',
  // poes → hoopoes / mythopoesis / poesiless:
  'hoopoes', 'poesis', 'poesil',
  // pillu (demoted) → lapillus/capillus / papillule:
  'pillus', 'pillula',
  // ecchi → Secchi-disk / zecchino / libecchio / orecchion:
  'secchi', 'zecchi', 'becchi', 'specchi', 'orecchi', 'libecchi',
  // chut → parachutist / catechu-tannic:
  'chutist', 'catechut',
  // picka → pickaroon / pickadil / pickage:
  'pickaroon', 'pickadil', 'pickage',
  // dupa → dupable/dupability:
  'dupab',
  // figa → figary / rufigallic:
  'figary', 'rufiga',
  // pute → puteal/puteli / cajuputene:
  'puteal', 'puteli', 'cajuputene',
  // ebane → horsebane/mousebane:
  'sebane',
  // kunda → bakunda / burkundauze:
  'bakunda', 'burkunda',
  // fitta → fittable/fittage:
  'fittab', 'fittag',
  // malakia → neuromalakia (softening of nerve tissue):
  'omalakia',
  // gooning (demoted) → dragooning:
  'dragooning',
  // zoophil (demoted) → zoophilous/zoophily (ecology — pollinated by animals):
  'zoophilou', 'zoophily',
  // aicompanion → "-ai"-final word + companion: bonsai/samurai/acai companion
  // apps (gardening guides, game-guide sites, nutrition). NB deliberately NOT
  // excusing thai/dubai + companion — "companion" in those geo pairings is
  // escort vocabulary, exactly what the root is for.
  'bonsaicompanion', 'samuraicompanion', 'acaicompanion'
];

// Pre-index whitelist words by the guarded root they contain (perf + clarity).
const WHITELIST_BY_ROOT = {};
for (const root of KEYWORD_ROOTS_GUARDED) {
  WHITELIST_BY_ROOT[root] = KEYWORD_WHITELIST_WORDS.filter(w => w.includes(root));
}

// Leetspeak normalisation — conservative map, applied before matching.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Homoglyph / confusable folding — maps non-Latin lookalikes to their Latin
// twin so a spoofed host (pоrn.com with a Cyrillic о) folds back to "porn".
// HIGH-CONFIDENCE visual confusables only (the letters actually used in domain
// spoofing). The folded form is checked against the STRONG stems + compounds
// ONLY — never the short guarded roots — so a legit native-script word that
// happens to fold into a 3–4 letter root (Russian "соска" → "cocka") can't
// create a false positive.
const CONFUSABLE_MAP = {
  // Cyrillic → Latin
  'а': 'a', 'е': 'e', 'ё': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'ѕ': 's', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't',
  // Greek → Latin
  'ο': 'o', 'ρ': 'p', 'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'τ': 't', 'χ': 'x',
  // Coptic → Latin
  'ⲟ': 'o', 'ⲣ': 'p', 'ⲭ': 'x'
};
function foldConfusables(s) {
  let out = '';
  for (const ch of s) {
    if (CONFUSABLE_MAP[ch]) { out += CONFUSABLE_MAP[ch]; continue; }
    const cp = ch.codePointAt(0);
    // Fullwidth Latin/digits (U+FF01–U+FF5E) → ASCII (subtract the 0xFEE0 offset)
    if (cp >= 0xFF01 && cp <= 0xFF5E) out += String.fromCharCode(cp - 0xFEE0);
    else out += ch;
  }
  return out;
}
function normalizeLeet(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) out += (LEET_MAP[s[i]] || s[i]);
  return out;
}

// Is the guarded-root occurrence at [idx, idx+len) fully inside a whitelist word?
function isCoveredByWhitelist(host, idx, len, words) {
  for (const w of words) {
    let from = 0, wIdx;
    while ((wIdx = host.indexOf(w, from)) !== -1) {
      if (wIdx <= idx && wIdx + w.length >= idx + len) return true;
      from = wIdx + 1;
    }
  }
  return false;
}

// ── Native-script IDN support (Batch 5) ──
// Browsers expose IDN hostnames as punycode (xn--…). We decode to Unicode and
// match native-script NSFW stems. Only multi-codepoint / unambiguous terms —
// single common chars (色 colour, 性 nature, نم milk, کس short) are excluded.
const PUNY_BASE = 36, PUNY_TMIN = 1, PUNY_TMAX = 26, PUNY_SKEW = 38, PUNY_DAMP = 700;
function punyAdapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNY_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  const limit = ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1;
  while (delta > limit) { delta = Math.floor(delta / (PUNY_BASE - PUNY_TMIN)); k += PUNY_BASE; }
  return Math.floor(k + (PUNY_BASE - PUNY_TMIN + 1) * delta / (delta + PUNY_SKEW));
}
function punyDigit(cp) {
  if (cp >= 48 && cp < 58) return cp - 22;   // 0-9 -> 26-35
  if (cp >= 65 && cp < 91) return cp - 65;   // A-Z -> 0-25
  if (cp >= 97 && cp < 123) return cp - 97;  // a-z -> 0-25
  return PUNY_BASE;
}
function punycodeDecode(input) {
  const output = [];
  let n = 128, i = 0, bias = 72;
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 128) return null;
    output.push(c);
  }
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i;
    for (let w = 1, k = PUNY_BASE; ; k += PUNY_BASE) {
      if (index >= input.length) return null;
      const digit = punyDigit(input.charCodeAt(index++));
      if (digit >= PUNY_BASE) return null;
      i += digit * w;
      const t = k <= bias ? PUNY_TMIN : (k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias);
      if (digit < t) break;
      w *= (PUNY_BASE - t);
    }
    const out = output.length + 1;
    bias = punyAdapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  try { return String.fromCodePoint.apply(null, output); } catch (e) { return null; }
}
function idnToUnicode(hostname) {
  return hostname.split('.').map(function (label) {
    if (label.lastIndexOf('xn--', 0) === 0) {
      const d = punycodeDecode(label.slice(4));
      return d === null ? label : d;
    }
    return label;
  }).join('.');
}

const NATIVE_STEMS = [
  // Arabic / Persian (Perso-Arabic script)
  'سكس', 'بورن', 'نيك', 'قحبة', 'شرموطة', 'دعارة', 'عاهرة',
  'سکس', 'پورن', 'کیر', 'جنده',
  // Cyrillic (RU / UK / BG)
  'секс', 'порно', 'порево', 'порнуха', 'пизда', 'шлюха', 'шлюхи', 'ебать',
  'ебля', 'сиськи', 'минет', 'сперма', 'хуй', 'жопа',
  // Chinese
  '色情', '做爱', '性爱', '肛交', '口交', '鸡巴', '巨乳', '裸体', '偷拍',
  '婊子', '淫荡', '操逼', '黄色电影', '成人电影',
  // Japanese (kana / kanji)
  '変態', 'おっぱい', 'まんこ', 'ちんこ', 'オナニー', 'ぶっかけ', 'ふたなり',
  '痴漢', 'フェラ', '中出し', '手コキ', 'ゴックン', 'エッチ', '熟女',
  // Korean (Hangul)
  '섹스', '포르노', '야동', '보지', '자지', '자위', '강간', '창녀', '걸레', '펠라',
  // Thai
  'เย็ด', 'ควย', 'เซ็กส์', 'โสเภณี',
  // Hebrew
  'סקס', 'פורנו', 'זין', 'זונה',
  // Greek
  'μουνί', 'πούτσος', 'κώλος', 'μαλακία', 'γαμήσι',
  // Bengali
  'সেক্স', 'চোদা', 'গুদ', 'খানকি'
];

// Core check. Returns { hit: bool, match?: string }.
function checkDomainKeywords(hostname) {
  // Decode IDN punycode once; match everything against the Unicode form so a
  // benign ACE string (xn--…) can't coincidentally hit a Latin stem.
  const host0 = (hostname.indexOf('xn--') !== -1) ? idnToUnicode(hostname) : hostname;

  // Native-script stems — only when the host has non-ASCII characters.
  if (/[^\x00-\x7F]/.test(host0)) {
    for (const stem of NATIVE_STEMS) {
      if (host0.indexOf(stem) !== -1) return { hit: true, match: stem };
    }
  }

  const variants = [host0];
  const leet = normalizeLeet(host0);
  if (leet !== host0) variants.push(leet);

  for (const host of variants) {
    // Adult TLDs — adult by definition
    for (const tld of ADULT_TLDS) {
      if (host.endsWith(tld)) return { hit: true, match: tld };
    }
    // Strong stems
    for (const stem of KEYWORD_STEMS_STRONG) {
      if (host.includes(stem)) return { hit: true, match: stem };
    }
    // Explicit porn compounds
    for (const c of KEYWORD_COMPOUNDS) {
      if (host.includes(c)) return { hit: true, match: c };
    }
    // Guarded roots (whitelist-excused)
    for (const root of KEYWORD_ROOTS_GUARDED) {
      const words = WHITELIST_BY_ROOT[root];
      let from = 0, idx;
      while ((idx = host.indexOf(root, from)) !== -1) {
        if (!isCoveredByWhitelist(host, idx, root.length, words)) {
          return { hit: true, match: root };
        }
        from = idx + 1;
      }
    }
  }

  // Homoglyph spoof pass — only when the host has non-ASCII. Fold confusables to
  // Latin and re-check STRONG stems + compounds ONLY (deliberately NOT the short
  // guarded roots — see CONFUSABLE_MAP note: protects legit native-script words).
  if (/[^\x00-\x7F]/.test(host0)) {
    const folded = foldConfusables(host0);
    if (folded !== host0) {
      const fvariants = [folded];
      const fleet = normalizeLeet(folded);
      if (fleet !== folded) fvariants.push(fleet);
      for (const host of fvariants) {
        for (const tld of ADULT_TLDS) {
          if (host.endsWith(tld)) return { hit: true, match: tld };
        }
        for (const stem of KEYWORD_STEMS_STRONG) {
          if (host.includes(stem)) return { hit: true, match: stem };
        }
        for (const c of KEYWORD_COMPOUNDS) {
          if (host.includes(c)) return { hit: true, match: c };
        }
      }
    }
  }

  return { hit: false };
}

// ============================================================================
// BYPASS-VECTOR BLOCKING  (Phase 2)
// "Unwrap, then re-check": pull the real target out of proxy/translate/archive
// wrappers and run it through the normal pipeline. Pure-bypass tools and raw
// public-IP navigation are blocked outright.
// ============================================================================

// Pure unblocker / web-proxy / archive-viewer services — no legit use here.
const BYPASS_PROXY_DOMAINS = new Set([
  'proxysite.com', 'croxyproxy.com', 'croxyproxy.net', 'croxy.network',
  'hide.me', 'hidester.com', 'kproxy.com', '4everproxy.com', 'proxyium.com',
  'blockaway.net', 'plainproxies.com', 'filterbypass.me', 'proxfree.com',
  'anonymouse.org', 'megaproxy.com', 'zalmos.com', 'vpnbook.com', 'genmirror.com',
  'unblockit.id', '12ft.io', '1ft.io',
  // archive viewers (Wayback is unwrapped instead — see unwrapBypassUrl)
  'archive.today', 'archive.ph', 'archive.is', 'archive.li', 'archive.md',
  'archive.vn', 'archive.fo',
  // reader / CORS proxies (report §3.2 + §11.4) — unwrapBypassUrl pulls the real
  // target out first when present; a BARE visit (no target) lands here and is blocked.
  'r.jina.ai', 's.jina.ai', 'corsproxy.io', 'allorigins.win',
  'thingproxy.freeboard.io', 'cors-anywhere.herokuapp.com',
  'api.codetabs.com', 'corsproxy.org', 'proxy.cors.sh', 'whateverorigin.org'
]);

function matchesBypassProxy(hostname) {
  if (BYPASS_PROXY_DOMAINS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (BYPASS_PROXY_DOMAINS.has(parent)) return parent;
  }
  return null;
}

// Extract the real destination from a translate/archive wrapper, or null.
function unwrapBypassUrl(urlObj) {
  const host = urlObj.hostname.toLowerCase();

  // Google Translate rendered subdomain: <encoded-host>.translate.goog
  // Google encodes original '.' as '-' and original '-' as '--'.
  if (host.endsWith('.translate.goog')) {
    const sub = host.slice(0, -'.translate.goog'.length);
    const original = sub.split('--').map(function (s) { return s.replace(/-/g, '.'); }).join('-');
    return `https://${original}${urlObj.pathname}${urlObj.search}`;
  }

  // translate.google.com / googleusercontent ?...&u=<target>
  if (host === 'translate.google.com' || host === 'translate.googleusercontent.com') {
    const u = urlObj.searchParams.get('u');
    if (u) return u;
  }

  // Wayback Machine: web.archive.org/web/<timestamp>/<original-url>
  if (host === 'web.archive.org' || host.endsWith('.web.archive.org')) {
    const m = urlObj.pathname.match(/\/web\/[^/]+\/(https?:\/\/.+)/);
    if (m) return m[1];
  }

  // Bing translator (report §3.2): translatetheweb.com/?...&a=<target>
  if (host === 'translatetheweb.com' || host.endsWith('.translatetheweb.com') ||
      host === 'microsofttranslator.com' || host.endsWith('.microsofttranslator.com')) {
    const a = urlObj.searchParams.get('a') || urlObj.searchParams.get('u');
    if (a) return a;
  }

  // Yandex translate: translate.yandex.*/translate?...&url=<target>
  if (host === 'translate.yandex.com' || host === 'translate.yandex.ru' || host === 'translate.yandex.net') {
    const u = urlObj.searchParams.get('url') || urlObj.searchParams.get('text');
    if (u && /^https?:\/\//i.test(u)) return u;
  }

  // CORS / reader proxies that take the target in a query param. Param name varies
  // by service: allorigins/corsproxy use `url`, codetabs uses `quest`, others `u`
  // (report §11.4 — codetabs slipped because only url/u were read).
  if (host === 'corsproxy.io' || host.endsWith('.corsproxy.io') ||
      host === 'corsproxy.org' || host === 'proxy.cors.sh' || host === 'whateverorigin.org' ||
      host === 'api.allorigins.win' || host === 'allorigins.win' || host.endsWith('.allorigins.win') ||
      host === 'api.codetabs.com' || host === 'cors-anywhere.herokuapp.com') {
    const u = urlObj.searchParams.get('url') || urlObj.searchParams.get('u') ||
              urlObj.searchParams.get('quest');
    if (u) { try { return decodeURIComponent(u); } catch (_) { return u; } }
  }

  // r.jina.ai / thingproxy: the target URL is appended to the path.
  //   https://r.jina.ai/https://target/…   ·   https://thingproxy.freeboard.io/fetch/https://target/…
  if (host === 'r.jina.ai' || host === 's.jina.ai' ||
      host === 'thingproxy.freeboard.io' || host.endsWith('.thingproxy.freeboard.io')) {
    const m = (urlObj.pathname + urlObj.search).match(/(https?:(?:\/\/|%2f%2f).+)/i);
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; } }
  }

  return null;
}

// Are these 4 octets a routable PUBLIC IPv4? (private/loopback/link-local exempt.)
function octetsArePublic(o) {
  if (o.some(n => !Number.isInteger(n) || n > 255 || n < 0)) return false;
  if (o[0] === 0 || o[0] === 10 || o[0] === 127) return false;   // this-net / private / loopback
  if (o[0] === 192 && o[1] === 168) return false;                // private
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;    // private
  if (o[0] === 169 && o[1] === 254) return false;                // link-local
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return false;   // CGNAT
  if (o[0] >= 224) return false;                                  // multicast / reserved (not a site)
  return true;
}

// Raw public-IP host in ANY notation — dotted-quad, a single decimal/hex/octal
// integer (http://1090052999/, http://0x7f…/), or IPv6 (http://[2606:4700::]/).
// A classic blocklist bypass; the old code matched ONLY dotted-quad (report
// §9.1#3). Private / loopback / link-local stay exempt so localhost dev works.
function isPublicIpHost(host) {
  if (!host) return false;
  host = host.toLowerCase();

  // IPv6 (new URL() keeps the [brackets] on .hostname). Strip them + any zone id.
  if (host.indexOf(':') !== -1) {
    const h = host.replace(/^\[/, '').replace(/\]$/, '').split('%')[0];
    if (h === '' || h === '::' || h === '::1') return false;      // unspecified / loopback
    if (/^fe[89ab]/.test(h)) return false;                       // fe80::/10 link-local
    if (/^f[cd]/.test(h)) return false;                          // fc00::/7 unique-local
    return true;                                                  // any other global IPv6
  }

  // Dotted IPv4.
  const dq = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dq) return octetsArePublic([dq[1], dq[2], dq[3], dq[4]].map(Number));

  // Single-number host: decimal, hex (0x…) or octal (0…) → 32-bit IPv4.
  let n = null;
  if (/^\d+$/.test(host)) n = parseInt(host, 10);
  else if (/^0x[0-9a-f]+$/.test(host)) n = parseInt(host, 16);
  else if (/^0[0-7]+$/.test(host)) n = parseInt(host, 8);
  if (n !== null && Number.isFinite(n) && n >= 0 && n <= 0xFFFFFFFF) {
    return octetsArePublic([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }

  return false;
}

// CURATED SUPPLEMENTAL BLACKLIST (report Round 4 §11.2)
// "Uncensored" AI image/character platforms that the 500k list AND the domain-
// keyword stems both miss: the stems match the registrable LABEL only, and
// "mage"/"tensor"/"chub"/"perchance" aren't stems (and a bare stem would
// over-match SFW words). The brand-name AI *companions* (candy.ai, crushon.ai,
// seaart.ai) are already on the main blacklist — these are the general-purpose
// generators / character hubs that were left open.
const EXTRA_BLACKLIST_DOMAINS = new Set([
  'mage.space',                       // self-titled "Unlimited & Uncensored AI Image & Video Generator"
  'tensor.art', 'tusiart.com',        // R-18 AI-art platforms
  'chub.ai', 'characterhub.org',      // uncensored NSFW character-card / roleplay hub (+ venus subdomain)
  'yodayo.com', 'pixai.art', 'figgs.ai', 'sakura.fm',  // adjacent NSFW-capable AI art/companion hubs

  // ── Round 6 §13.2 — generic image/album hosts with NO porn stem, not on the
  //    blacklist, so all three host layers were blind. These are the classic
  //    forum/NSFW thumbnail-gallery hosts (predominantly adult; the canonical
  //    SFW image host is a mainstream provider, so per the triage rule they have
  //    no SFW value worth preserving here). pixhost confirmed live-reachable.
  'pixhost.to', 'imgbox.com', 'imx.to', 'vipr.im', 'imgview.net', 'pixroute.com',
  'imagetwist.com', 'imgdrive.net', 'acidimg.cc', 'imgadult.com', 'turboimagehost.com',
  // Chevereto "img.*" / jpg.* chameleon family (heavily adult, churns TLDs)
  'jpg.church', 'jpg.fish', 'jpg.pet', 'jpg.homes', 'jpg.fishing', 'host.church',
  'jpg1.su', 'jpg2.su', 'jpg3.su', 'jpg4.su', 'jpg5.su', 'jpeg.pet',
  // Mixed-use general image hosts (have real SFW use too — included for the
  // addiction threat model; remove any of these if the collateral is unwanted).
  'ibb.co', 'imgbb.com', 'imgchest.com',

  // ── Round 6 §13.3 — Telegram-adjacent publishing / paste hosts that render
  //    arbitrary user HTML + inline images with no self-censorship. telegra.ph
  //    was flagged uncovered in §7.5/§9/§12.2 and is a known porn-dump vector;
  //    telegra.ph + justpaste confirmed live-reachable. graph.org is the
  //    telegra.ph alias.
  'telegra.ph', 'graph.org', 'justpaste.it', 'teletype.in', 'rentry.co', 'rentry.org',
  'write.as', 'controlc.com', 'ctxt.io'
]);

// PRIVACY-FRONTEND INSTANCE SEED LIST (report Round 4 §11.1)
// redlib/libreddit (Reddit), invidious/piped (YouTube), nitter (X) and rimgo
// (Imgur) are pure PROXIES of platforms Oath Light already restricts on the
// canonical host — they re-serve the same content UNFILTERED on arbitrary
// community domains, so every host-keyed defense misses them. They have no SFW
// value to preserve (the canonical platform IS the legit path), so per the
// "leaking + no legit use case → blacklist" rule we hard-block the popular,
// stable instances at the navigation layer (clean ERR_ABORTED, fires BEFORE the
// instance's anti-bot challenge even loads). This is the belt; the content.js
// fingerprint detector is the suspenders for instances not on this list.
// (SearXNG instances are deliberately NOT here — they have legit private text
//  search; content.js scope-blocks only their image/SafeSearch-off surfaces.)
const FRONTEND_INSTANCE_DOMAINS = new Set([
  // redlib / libreddit (Reddit)
  'redlib.catsarch.com', 'safereddit.com', 'redlib.privacyredirect.com',
  'reddit.nerdvpn.de', 'l.opnxng.com', 'redlib.perennialte.ch', 'libreddit.kavin.rocks',
  'redlib.tux.pizza', 'rl.bloat.cat', 'redlib.r4fo.com', 'redlib.4o1x5.dev',
  'redlib.kittywa.ves', 'red.ngn.tf', 'redlib.freedit.eu', 'redlib.privacy.com.de',
  // invidious (YouTube)
  'yewtu.be', 'inv.nadeko.net', 'invidious.nerdvpn.de', 'iv.ggtyler.dev',
  'yt.artemislena.eu', 'invidious.jing.rocks', 'inv.tux.pizza', 'invidious.fdn.fr',
  'invidious.privacyredirect.com', 'iv.melmac.space',
  // piped (YouTube)
  'piped.video', 'piped.kavin.rocks', 'piped.privacydev.net', 'piped.reallyaweso.me',
  // nitter (X)
  'xcancel.com', 'nitter.poast.org', 'nitter.privacyredirect.com', 'nitter.net',
  'lightbrd.com', 'nitter.tiekoetter.com', 'nitter.kavin.rocks',
  // rimgo (Imgur)
  'rimgo.totaldarkness.net', 'rimgo.bus-hit.me', 'rimgo.privacydev.net', 'rimgo.pussthecat.org'
]);

// perchance.org hosts BOTH innocuous generators (names, dice, lists…) AND the
// notorious uncensored AI image + character-chat generators. Block only the AI
// generator/chat paths so the SFW generators keep working (report §11.2).
function isBlockedPerchancePath(hostname, urlObj) {
  if (hostname !== 'perchance.org' && !hostname.endsWith('.perchance.org')) return false;
  const p = urlObj.pathname.toLowerCase();
  return /^\/ai[-/]/.test(p) || p.includes('image-generator') ||
         p.includes('character-chat') || p.includes('-chat') || p.includes('nsfw');
}

// LOCKDOWN MODE (plan item 4.4) — whitelist-only browsing.
//
// The desktop app pushes lockdown state on the same channel as the blocking
// settings (`blockingSettings.lockdown = {active, frozen, ends_at_hint,
// allow}` — see bg/native-bridge.js handleSetBlocking). While a lockdown is
// active, `shouldBlockUrl` allows ONLY the mainstream whitelist plus whatever
// the user additively allowed during the lockdown (each of those went through
// a short 60s friction delay on the desktop side — 4.4's anti-brick rule);
// everything else blocks with a dedicated lockdown reason.
//
// Self-expiry fallback: the desktop is the authority and pushes `active:false`
// at the real end. Only if the desktop connection is DOWN do we fall back to
// the wall-clock `ends_at_hint`, and only in the EXPIRY direction — a clock
// roll can never SHORTEN a lockdown while the desktop is connected (it just
// keeps pushing the authoritative state), and can never extend one either.
function lockdownState() {
  return (typeof blockingSettings === 'object' && blockingSettings && blockingSettings.lockdown) || null;
}

// ════════════════════════════════════════════════════════════════════════════
// URL PATH / QUERY KEYWORD LAYER (plan item 3.7)
// ════════════════════════════════════════════════════════════════════════════
// The keyword engine has always run on HOSTNAMES only, which leaves the NSFW
// *sections* of otherwise-unlisted mixed sites uncovered (`example.com/porn/`,
// `?tag=nsfw`). This layer closes that — but it is the highest-false-positive
// thing in the whole matcher, so it is deliberately hedged four ways:
//
//   1. **Opt-in.** It only runs under the Strict or Lockdown preset (6.4), or
//      while Serious Mode is on. The default Standard preset never sees it.
//   2. **Last.** It is the final check in `shouldBlockUrl`, reached only by a
//      host that is not whitelisted, not blacklisted, not graylisted, and not
//      caught by the hostname keyword layer — i.e. genuinely unknown.
//   3. **Whole tokens only.** The path/query is split on non-alphanumerics and
//      each segment must EQUAL a keyword. No substring matching, ever. This is
//      what makes the existing trap-word discipline unnecessary here: "rape"
//      cannot match inside "therapeutic" when only whole segments are compared.
//   4. **Hard keywords single, soft keywords in pairs.** One unambiguous term
//      ("hentai") blocks; ambiguous ones ("sex", "nude") need two DISTINCT
//      soft terms before they mean anything, so `/health/sex-education` stays
//      reachable while `/nude/sexy/gallery` does not.
//
// Multi-word keywords ("sex video") are skipped: URL segments are single
// tokens by construction, so those entries could never match anyway.

// Segments that flip a page from "adult" to "about adult things" — an entire
// category of legitimate content this layer must not touch. One of these
// anywhere in the path disarms the layer for that URL.
const PATH_KEYWORD_EXEMPT_SEGMENTS = new Set([
  'education', 'educational', 'health', 'healthcare', 'medical', 'medicine',
  'anatomy', 'biology', 'science', 'research', 'study', 'therapy', 'therapist',
  'counselling', 'counseling', 'recovery', 'addiction', 'support', 'help',
  'abuse', 'assault', 'consent', 'safeguarding', 'policy', 'policies', 'legal',
  'law', 'news', 'article', 'report', 'wiki', 'definition', 'dictionary',
  'documentation', 'docs', 'api', 'faq', 'about', 'privacy', 'terms',
]);

// Split a path + query into lowercase alphanumeric tokens. Query VALUES are
// included (`?tag=nsfw`) alongside keys; percent-encoding is decoded first so
// `%68entai` tokenizes the same as `hentai`.
function urlKeywordTokens(urlObj) {
  let raw = urlObj.pathname + ' ' + urlObj.search;
  try { raw = decodeURIComponent(raw); } catch (e) { /* malformed escape — use as-is */ }
  return raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Is the Strict-or-above tier armed? Reads the same pushed blocking settings
// every other desktop-driven toggle here reads. Serious Mode (UX Direction §1)
// forces it on regardless of the preset — it covers everything, by definition.
function pathKeywordLayerArmed() {
  const s = (typeof blockingSettings === 'object' && blockingSettings) || null;
  if (!s) return false;
  if (s.serious === true) return true;
  return s.strictness === 'strict' || s.strictness === 'lockdown';
}

// Returns `{ reason, match }` when the URL's path/query should block, else null.
// Exposed for the test suite as well as `shouldBlockUrl`.
function checkUrlPathKeywords(urlObj) {
  if (!pathKeywordLayerArmed()) return null;

  const tokens = urlKeywordTokens(urlObj);
  if (tokens.length === 0) return null;

  for (const tok of tokens) {
    if (PATH_KEYWORD_EXEMPT_SEGMENTS.has(tok)) return null;
  }
  const tokenSet = new Set(tokens);

  // Tier 1 — one unambiguous term is enough.
  for (const kw of HARD_PORN_KEYWORDS) {
    if (kw.includes(' ')) continue; // multi-word: can't be a single URL segment
    if (tokenSet.has(kw)) return { reason: 'keyword_path', match: kw };
  }

  // Tier 2 — two DISTINCT ambiguous terms. One is noise; two in the same URL
  // is a pattern.
  const softHits = [];
  for (const kw of SOFT_PORN_KEYWORDS) {
    if (kw.includes(' ')) continue;
    if (tokenSet.has(kw)) {
      softHits.push(kw);
      if (softHits.length >= 2) {
        return { reason: 'keyword_context', match: softHits.join('+') };
      }
    }
  }

  return null;
}

function isLockdownActive() {
  const ld = lockdownState();
  if (!ld || !ld.active) return false;
  // While the desktop is connected it owns the clock — never self-expire.
  const connected = (typeof NativeMessagingBridge !== 'undefined')
    && typeof NativeMessagingBridge.isConnected === 'function'
    && NativeMessagingBridge.isConnected();
  if (!connected && typeof ld.ends_at_hint === 'number' && ld.ends_at_hint > 0) {
    // Desktop is gone: honor the last-pushed end hint so a crashed companion
    // app doesn't strand the user in a permanent lockdown. Never shortens a
    // still-connected one (that branch is unreachable while connected).
    if (Date.now() / 1000 > ld.ends_at_hint) return false;
  }
  return true;
}

// Is `hostname` reachable during a lockdown: a mainstream-whitelist domain
// (exact or subdomain) OR one the user additively allowed for this lockdown.
function lockdownAllows(hostname) {
  for (const wd of WHITELIST_DOMAINS) {
    if (hostname === wd || hostname.endsWith('.' + wd)) return true;
  }
  const ld = lockdownState();
  const allow = (ld && Array.isArray(ld.allow)) ? ld.allow : [];
  for (const raw of allow) {
    const d = (raw || '').toString().toLowerCase();
    if (d && (hostname === d || hostname.endsWith('.' + d))) return true;
  }
  return false;
}

// URL BLOCKING LOGIC — blocklist + keyword layer + bypass-vector

function shouldBlockUrl(url, depth = 0) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // STEP -1: LOCKDOWN MODE (4.4) — the FIRST check, before everything.
    // When active, only the whitelist + user allowlist get through; every
    // other host blocks with a dedicated lockdown reason so blocked.html can
    // show its "Lockdown active" message. Blocks still record stats normally
    // (handleBlock → recordBlockAndRedirect runs on this `blocked: true`).
    if (isLockdownActive()) {
      if (lockdownAllows(hostname)) {
        return { blocked: false, tier: 'lockdown_allow', hostname };
      }
      return { blocked: true, reason: 'lockdown', match: hostname, tier: 'lockdown', hostname };
    }

    // STEP 0: Bypass-vector — unwrap proxy/translate/archive wrappers and
    // re-check the REAL target. Runs before the whitelist so wrappers hosted on
    // whitelisted domains (e.g. translate.google.com) can't slip through.
    if (depth < 3) {
      const unwrapped = unwrapBypassUrl(urlObj);
      if (unwrapped) {
        const inner = shouldBlockUrl(unwrapped, depth + 1);
        if (inner && inner.blocked) {
          return { blocked: true, reason: 'bypass_' + (inner.reason || 'blocked'), match: inner.match || hostname, tier: 'bypass', hostname };
        }
        return { blocked: false, tier: 'bypass_clean', hostname };
      }
    }

    // STEP 1: Check search engine SafeSearch enforcement
    const searchCheck = checkSearchEngineSafeSearch(url, hostname);
    if (searchCheck && (searchCheck.blocked || searchCheck.safesearch)) {
      return searchCheck;
    }

    // STEP 1.5: "Trusted" hosts with explicit galleries / sex-act articles —
    // block the adult SURFACES by path (Wikimedia Commons, Wikipedia sex-act
    // articles). Runs BEFORE the whitelist so a whitelisted host (wikipedia.org)
    // can no longer suppress this content check (report §3.1 architectural fix /
    // Round 5). For non-adult paths it returns null and the host proceeds
    // normally (e.g. en.wikipedia.org/wiki/Cat → whitelist allow).
    const trustedAdult = checkTrustedAdultPath(hostname, urlObj);
    if (trustedAdult) {
      return { blocked: true, reason: 'trusted_host_adult_path', match: hostname + ' ' + trustedAdult, tier: 'blacklist', hostname };
    }

    // STEP 1.6: Adult SEARCH on a whitelisted host (Quora/Amazon/eBay/Crunchyroll).
    // Also runs before the whitelist so the porn-keyword search is killed without
    // suppressing the host's normal use (report Round 6 §13.1).
    const trustedSearch = checkTrustedHostSearch(hostname, urlObj);
    if (trustedSearch) {
      return { blocked: true, reason: 'trusted_host_search_keyword', match: hostname + ':' + trustedSearch, tier: 'blacklist', hostname };
    }

    // STEP 2: Check WHITELIST (never block these)
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        return { blocked: false, tier: 'whitelist', hostname };
      }
    }

    // STEP 2b: Bypass tools (web proxies / unblockers / archive viewers)
    const bypassDomain = matchesBypassProxy(hostname);
    if (bypassDomain) {
      return { blocked: true, reason: 'bypass_tool', match: bypassDomain, tier: 'bypass', hostname };
    }

    // STEP 2c: Raw public-IP navigation — a classic blocklist bypass
    if (isPublicIpHost(hostname)) {
      return { blocked: true, reason: 'raw_ip', match: hostname, tier: 'bypass', hostname };
    }

    // STEP 3: Check BLACKLIST (explicit NSFW domains from blocklist)
    if (blocklistSet && blocklistSet.size > 0) {
      const parts = hostname.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const domainToCheck = parts.slice(i).join('.');
        if (blocklistSet.has(domainToCheck)) {
          return { blocked: true, reason: 'blacklist_domain', match: domainToCheck, tier: 'blacklist', hostname };
        }
      }
    }

    // STEP 3a: Curated supplemental blacklist — uncovered "uncensored" AI
    // image/character platforms (report Round 4 §11.2), no-stem image/album hosts
    // (Round 6 §13.2), Telegram-adjacent paste/publishing hosts (§13.3), pure-proxy
    // privacy-frontend instances (§11.1), and perchance AI paths.
    {
      const parts = hostname.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const d = parts.slice(i).join('.');
        if (EXTRA_BLACKLIST_DOMAINS.has(d)) {
          return { blocked: true, reason: 'blacklist_supplemental', match: d, tier: 'blacklist', hostname };
        }
        if (FRONTEND_INSTANCE_DOMAINS.has(d)) {
          return { blocked: true, reason: 'privacy_frontend_instance', match: d, tier: 'blacklist', hostname };
        }
      }
    }
    if (isBlockedPerchancePath(hostname, urlObj)) {
      return { blocked: true, reason: 'perchance_ai_path', match: 'perchance.org AI generator', tier: 'blacklist', hostname };
    }

    // STEP 3b: DOMAIN-NAME KEYWORD LAYER — catches unlisted porn domains
    // (e.g. sex4arabs.com). Hostname-only; runs even if the blocklist is empty.
    const kw = checkDomainKeywords(hostname);
    if (kw.hit) {
      return { blocked: true, reason: 'domain_keyword', match: kw.match, tier: 'keyword', hostname };
    }

    // STEP 4: REDDIT-SPECIFIC CONTENT FILTERING (Paths and Keywords)
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
      // Normalise data-feed suffixes off the path so /r/RealGirls.json (and .rss/
      // .xml/.embed) can't slip past the exact-path block (report §7.3).
      const pathname = urlObj.pathname.toLowerCase().replace(/\.(json|rss|xml|embed|compact|mobile)$/, '');

      // 4a. Check explicit NSFW paths FIRST (exact, no false positives)
      for (const path of GRAYLIST_EXPLICIT_PATHS) {
         if (pathname === path || pathname.startsWith(path + '/')) {
            return { blocked: true, reason: 'reddit_explicit_path', match: path, tier: 'blacklist', hostname };
         }
      }

      // 4b. Check keywords against the subreddit name, with proper
      //     word boundary splitting to avoid false positives.
      //     e.g., /r/AssassinsCreed → ["assassins", "creed"] — won't match "ass"
      const subredditMatch = pathname.match(/^\/r\/([^\/]+)/i);
      if (subredditMatch) {
        const rawSubName = decodeURIComponent(subredditMatch[1]);
        const subName = rawSubName.toLowerCase();
        // Split camelCase on ORIGINAL case (before toLowerCase), then split underscores/hyphens
        const subWords = rawSubName.replace(/([a-z])([A-Z])/g, '$1 $2')
                                   .replace(/[_-]+/g, ' ')
                                   .toLowerCase()
                                   .split(/\s+/);
        const subText = ' ' + subWords.join(' ') + ' '; // pad for boundary matching

        for (const keyword of HARD_PORN_KEYWORDS) {
          // Word-boundary match (from camelCase / separator split)
          if (subText.includes(' ' + keyword + ' ') || subName === keyword) {
            return { blocked: true, reason: 'reddit_hard_keyword', match: keyword, tier: 'blacklist', hostname };
          }
          // Substring match for longer keywords (≥4 chars) — safe from false positives
          if (keyword.length >= 4 && subName.includes(keyword)) {
            return { blocked: true, reason: 'reddit_hard_keyword', match: keyword, tier: 'blacklist', hostname };
          }
        }
        
        for (const keyword of SOFT_PORN_KEYWORDS) {
          if (subText.includes(' ' + keyword + ' ') || subName === keyword) {
            return { blocked: true, reason: 'reddit_soft_keyword', match: keyword, tier: 'blacklist', hostname };
          }
          if (keyword.length >= 4 && subName.includes(keyword)) {
            return { blocked: true, reason: 'reddit_soft_keyword', match: keyword, tier: 'blacklist', hostname };
          }
        }
      }

      // 4c. NUCLEAR Reddit SEARCH filtering — block the search outright if the
      //     query contains ANY NSFW keyword, soft OR hard. Reddit stays usable
      //     for legit purposes, but every adult search dies. Whole-word match for
      //     short keywords (ass/sex/cum…) so we don't Scunthorpe innocent queries
      //     (essex/massachusetts/document); substring for ≥4-char keywords so
      //     run-together terms ("milfhunter", "hotbabes") are still caught.
      const redditSearchHit = matchSearchQueryPorn(urlObj.searchParams.get('q'));
      if (redditSearchHit) {
        return { blocked: true, reason: 'reddit_search_keyword', match: redditSearchHit, tier: 'blacklist', hostname };
      }
    }

    // STEP 5: PATREON SEARCH — NUCLEAR keyword filter (mirrors Reddit §4c).
    //   Patreon labels its adult creators/posts well (the DOM scrub in content.js
    //   hides every 18+-chipped card), but SEARCH still surfaces suggestive content
    //   the platform leaves UNLABELLED — under-tagging the ground-truth filter is
    //   blind to. So we kill the adult search outright. Patreon stays fully usable
    //   for legit creators; only NSFW-keyword searches die. Search lives at
    //   /explore/search?query=… (a typed /search?q=… redirects there) — handle both.
    if (hostname === 'patreon.com' || hostname.endsWith('.patreon.com')) {
      const p = urlObj.pathname.toLowerCase();
      if (p === '/search' || p === '/explore/search' || p.startsWith('/explore/search/')) {
        const patreonSearchHit = matchSearchQueryPorn(
          urlObj.searchParams.get('query') || urlObj.searchParams.get('q')
        );
        if (patreonSearchHit) {
          return { blocked: true, reason: 'patreon_search_keyword', match: patreonSearchHit, tier: 'blacklist', hostname };
        }
      }
    }

    // STEP 6: GRAYLIST SEARCH — nuclear keyword filter on every OTHER graylisted
    // site's search endpoint (report §3.4 + §6.1). Kills the adult search before
    // the SSR first paint the JSON scrub can't reach (Tumblr/Wattpad/Minds/…).
    const graylistSearchHit = checkGraylistSearch(hostname, urlObj);
    if (graylistSearchHit) {
      return { blocked: true, reason: 'graylist_search_keyword', match: graylistSearchHit, tier: 'blacklist', hostname };
    }

    // (Trusted-host adult-path check moved to STEP 1.5 — see above — so it
    // applies to whitelisted hosts too.)

    // STEP 7: URL PATH / QUERY KEYWORD LAYER (3.7) — Strict-and-above only.
    // Deliberately LAST: by here the host is genuinely unknown (not
    // whitelisted, blacklisted, graylisted, or hostname-keyword matched), so
    // this can only ever ADD a block, never suppress an allow decision made
    // above it. See `checkUrlPathKeywords` for why it's this conservative.
    const pathKw = checkUrlPathKeywords(urlObj);
    if (pathKw) {
      return { blocked: true, reason: pathKw.reason, match: pathKw.match, tier: 'keyword', hostname };
    }

    return { blocked: false, tier: 'unknown', hostname };

  } catch (error) {
    console.error(' Error checking URL:', error);
    return { blocked: false };
  }
}