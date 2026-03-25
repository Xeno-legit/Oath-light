// Background service worker for Pure Path
let isExtensionEnabled = true;
let passwordHash = null;
let blocklistDomains = [];
let blocklistKeywords = [];
let blocklistSet = new Set(); // O(1) domain lookup

// Deduplication map: tabId -> last checked URL (prevents triple-firing)
const tabLastChecked = new Map();

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Pure Path installed');
  
  // On first install or update, load blocklists from JSON and save to storage
  if (details.reason === 'install' || details.reason === 'update') {
    await initializeBlocklistsFromJSON();
  }
  
  // Load blocklists from storage
  await loadBlocklistsFromStorage();
  
  // Initialize stats if first install
  const result = await chrome.storage.local.get(['stats']);
  if (!result.stats) {
    await chrome.storage.local.set({ stats: { totalBlocks: 0, installDate: new Date().toISOString() } });
  }
  
  // Check if password is set
  const { passwordHash: storedHash } = await chrome.storage.local.get(['passwordHash']);
  if (!storedHash) {
    // Open setup page
    chrome.tabs.create({ url: 'setup.html' });
  }
});

// Load blocklists on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Pure Path starting up');
  await loadBlocklistsFromStorage();
});

// Initialize blocklists from JSON files (only on install/update)
async function initializeBlocklistsFromJSON() {
  try {
    console.log('📋 Pure Path: Initializing blocklists from JSON files...');
    const domainsResponse = await fetch(chrome.runtime.getURL('blocklists/domains.json'));
    const domainsData = await domainsResponse.json();
    const domains = domainsData.domains || [];
    
    const keywordsResponse = await fetch(chrome.runtime.getURL('blocklists/keywords.json'));
    const keywordsData = await keywordsResponse.json();
    const keywords = keywordsData.keywords || [];
    
    // Save to storage
    await chrome.storage.local.set({ 
      blocklistDomains: domains,
      blocklistKeywords: keywords
    });
    
    console.log(`✅ Pure Path: Initialized ${domains.length} domains and ${keywords.length} keywords in storage`);
  } catch (error) {
    console.error('❌ Pure Path: Error initializing blocklists from JSON:', error);
  }
}

// Load blocklists from Chrome storage
async function loadBlocklistsFromStorage() {
  try {
    console.log('📋 Pure Path: Loading blocklists from storage...');
    const result = await chrome.storage.local.get(['blocklistDomains', 'blocklistKeywords']);
    
    if (result.blocklistDomains && result.blocklistKeywords) {
      blocklistDomains = result.blocklistDomains;
      blocklistKeywords = result.blocklistKeywords;
      // Build the Set for O(1) lookups
      blocklistSet = new Set(blocklistDomains.map(d => d.toLowerCase()));
      console.log(`✅ Pure Path: Loaded ${blocklistDomains.length} domains and ${blocklistKeywords.length} keywords from storage`);
    } else {
      // If not in storage, initialize from JSON
      console.log('⚠️ Pure Path: Blocklists not found in storage, initializing from JSON...');
      await initializeBlocklistsFromJSON();
      await loadBlocklistsFromStorage(); // Reload after initialization
    }
  } catch (error) {
    console.error('❌ Pure Path: Error loading blocklists from storage:', error);
  }
}

// Load blocklists from JSON files (legacy function, kept for compatibility)
async function loadBlocklists() {
  await loadBlocklistsFromStorage();
}

// ============================================================================
// ENHANCED LEET SPEAK NORMALIZER (for search queries only)
// Pre-compiled regex for performance
// ============================================================================

const LEET_MAP_RAW = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'l', '(': 'c', ')': 'c', '<': 'c', '>': 'c',
  '+': 't', '&': 'and', '€': 'e', '£': 'l', '¥': 'y', '§': 's', '©': 'c', '®': 'r',
  '™': 't', '°': 'o', '²': '2', '³': '3', 'µ': 'u', '¶': 'p', '×': 'x', '÷': 'd'
};

// Pre-compile regex patterns once at load time
const LEET_MAP_COMPILED = Object.entries(LEET_MAP_RAW).map(([k, v]) => ([
  new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), v
]));

const SEPARATOR_REGEX = /[-_\.\s]/g;

function normalizeLeetSpeak(text) {
  if (!text) return '';
  
  let normalized = text.toLowerCase();
  
  // Remove common separator characters FIRST
  normalized = normalized.replace(SEPARATOR_REGEX, '');
  
  // Replace leet speak characters using pre-compiled patterns (3 passes)
  for (let pass = 0; pass < 3; pass++) {
    for (const [regex, replacement] of LEET_MAP_COMPILED) {
      normalized = normalized.replace(regex, replacement);
    }
  }
  
  return normalized;
}

// ============================================================================
// ENHANCED MULTI-TIERED DETECTION SYSTEM
// ============================================================================

// TIER 1: WHITELIST - Completely safe domains (never block)
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
  
  // Social Media (mainstream)
  'linkedin.com',
  
  // Education & Reference
  'wikipedia.org',
  'wikihow.com',
  'khanacademy.org',
  'coursera.org',
  'udemy.com',
  'edx.org',
  
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
  'reuters.com'
];

// TIER 2: GRAYLIST - Can contain NSFW but not primary focus (strict monitoring)
const GRAYLIST_DOMAINS = [
  'reddit.com',
  'discord.com',
  'twitter.com',
  'x.com',
  'tumblr.com',
  'newgrounds.com',
  'deviantart.com',
  'instagram.com',
  'facebook.com',
  'pinterest.com',
  'imgur.com',
  'twitch.tv',
  'youtube.com'
];

// TIER 3: BLACKLIST - Explicit NSFW domains (always block)
// This will be loaded from blocklists/domains.json

// ============================================================================
// GRAYLIST EXPLICIT PATHS — hoisted to module level, built once
// ============================================================================
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
  '/porn', '/sex', '/nude', '/adult', '/hentai', '/xxx'
];

// ============================================================================
// SEARCH QUERY DETECTION - Enhanced with Leet Speak Normalization
// ============================================================================

// Soft porn keywords (common bypass terms - less explicit)
const SOFT_PORN_KEYWORDS = [
  // Suggestive terms
  'sexy', 'hot babes', 'hot girls', 'hot women', 'hot chicks',
  'bikini babes', 'lingerie', 'underwear models', 'swimsuit models',
  'topless', 'bottomless', 'naked', 'nude', 'nudes',
  
  // Action terms
  'strip', 'stripping', 'stripper', 'striptease',
  'cam girl', 'camgirl', 'webcam girl', 'live cam',
  'onlyfans', 'only fans', 'patreon nsfw',
  
  // Euphemisms
  'adult content', 'mature content', '18+', 'nsfw',
  'not safe for work', 'explicit content'
];

// Explicit hard porn keywords (immediate block)
const HARD_PORN_KEYWORDS = [
  // Porn sites and terms
  'porn', 'pornography', 'pornhub', 'xvideos', 'xnxx', 'redtube',
  'hentai', 'doujin', 'rule34',
  'sex video', 'sex videos', 'porn video', 'porn videos',
  
  // Explicit body parts (moved from soft keywords)
  'boobs', 'boobies', 'tits', 'titties', 'breasts',
  'ass', 'butt', 'booty', 'pussy', 'vagina',
  'dick', 'cock', 'penis', 'balls', 'testicles',
  
  // Explicit acts
  'fuck', 'fucking', 'sex', 'sexual',
  'milf', 'gilf', 'dilf',
  'gangbang', 'orgy', 'threesome', 'foursome',
  'blowjob', 'handjob', 'footjob',
  'cumshot', 'creampie', 'facial',
  'lesbian porn', 'gay porn', 'shemale', 'trans porn',
  'incest', 'stepmom', 'stepsister', 'stepbrother',
  'rape', 'forced', 'bdsm', 'bondage',
  
  // Curated unambiguous terms from keywords.json (Section D)
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
  'suicidegirls', 'babestation', 'slutwife', 'hotwife'
];

// ============================================================================
// PRE-COMPILED WORD-BOUNDARY REGEX FOR KEYWORD MATCHING (Section B)
// Built once at load time, not per-check. Uses lookbehind/lookahead
// instead of \b to avoid false positives (e.g. 'ass' in 'class').
// ============================================================================

function buildWordBoundaryRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i');
}

const HARD_KEYWORD_REGEXES = HARD_PORN_KEYWORDS.map(kw => ({
  kw,
  regex: buildWordBoundaryRegex(kw)
}));

const SOFT_KEYWORD_REGEXES = SOFT_PORN_KEYWORDS.map(kw => ({
  kw,
  regex: buildWordBoundaryRegex(kw)
}));

// Contextual phrases that indicate NSFW intent
const NSFW_PHRASES = [
  'hot babes', 'sexy babes', 'hot girls', 'sexy girls',
  'hot women', 'sexy women', 'hot chicks', 'sexy chicks',
  'bikini babes', 'bikini girls', 'lingerie models',
  'nude models', 'naked models', 'topless models',
  'cam girls', 'webcam girls', 'live cams',
  'strip club', 'strip tease', 'lap dance',
  'adult entertainment', 'adult videos', 'adult content',
  'xxx videos', 'xxx images', 'xxx pics',
  'porn site', 'porn sites', 'sex site', 'sex sites',
  'free porn', 'free sex', 'free nudes',
  'watch porn', 'watch sex', 'download porn'
];

// ============================================================================
// SEARCH ENGINE DETECTION
// ============================================================================

const SEARCH_ENGINES = [
  { domain: 'google.com', queryParam: 'q', imageParam: 'tbm=isch' },
  { domain: 'bing.com', queryParam: 'q', imageParam: 'filters=filterui:photo' },
  { domain: 'duckduckgo.com', queryParam: 'q', imageParam: 'iax=images' },
  { domain: 'yahoo.com', queryParam: 'p', imageParam: 'fr2=piv-web' }
];

// ============================================================================
// ENHANCED SEARCH QUERY DETECTION WITH LEET SPEAK NORMALIZATION
// ============================================================================

function checkSearchEngineQuery(url, hostname) {
  const searchEngine = SEARCH_ENGINES.find(se => 
    hostname === se.domain || hostname.endsWith('.' + se.domain)
  );
  
  if (!searchEngine) return null;
  
  try {
    const urlObj = new URL(url);
    const searchParams = urlObj.searchParams;
    const query = searchParams.get(searchEngine.queryParam);
    
    if (!query) return null;
    
    const lowerQuery = query.toLowerCase();
    const isImageSearch = url.includes(searchEngine.imageParam);
    
    // SafeSearch detection: only block if user tries to DISABLE SafeSearch
    // SafeSearch being ON is a protective feature and should be allowed
    const hasSafeSearchOff = url.includes('safe=off') || url.includes('safesearch=off') || url.includes('safe=0');
    if (hasSafeSearchOff) {
      console.log('🚫 SafeSearch disabled - blocking bypass attempt');
      return {
        blocked: true,
        reason: 'safesearch_bypass',
        match: 'SafeSearch disabled',
        query: query,
        severity: 'bypass_attempt'
      };
    }
    
    // Normalize leet speak in the query
    const normalizedQuery = normalizeLeetSpeak(lowerQuery);
    
    // Check for hard porn keywords (immediate block) — word-boundary aware
    for (const { kw, regex } of HARD_KEYWORD_REGEXES) {
      if (regex.test(normalizedQuery)) {
        return {
          blocked: true,
          reason: isImageSearch ? 'search_images' : 'search_query',
          match: kw,
          query: query,
          severity: 'explicit',
          normalized: normalizedQuery
        };
      }
    }
    
    // Check for NSFW phrases (contextual block)
    for (const phrase of NSFW_PHRASES) {
      const normalizedPhrase = normalizeLeetSpeak(phrase.toLowerCase());
      if (normalizedQuery.includes(normalizedPhrase)) {
        return {
          blocked: true,
          reason: isImageSearch ? 'search_images' : 'search_query',
          match: phrase,
          query: query,
          severity: 'contextual',
          normalized: normalizedQuery
        };
      }
    }
    
    // Check for soft porn keywords — word-boundary aware
    let softMatches = [];
    for (const { kw, regex } of SOFT_KEYWORD_REGEXES) {
      if (regex.test(normalizedQuery)) {
        softMatches.push(kw);
      }
    }
    
    if (softMatches.length > 0) {
      
      // Always block on image search with any soft keyword
      if (isImageSearch) {
        return {
          blocked: true,
          reason: 'search_images',
          match: softMatches[0],
          query: query,
          severity: 'soft',
          normalized: normalizedQuery
        };
      }
      
      // For text search, block if 2+ soft keywords
      if (softMatches.length >= 2) {
        return {
          blocked: true,
          reason: 'search_query',
          match: softMatches.join(', '),
          query: query,
          severity: 'soft',
          normalized: normalizedQuery
        };
      }

    }

    
  } catch (error) {
    console.error('❌ Error checking search query:', error);
  }
  
  return null;
}

// ============================================================================
// URL BLOCKING LOGIC WITH MULTI-TIER SYSTEM (Simplified)
// ============================================================================

function shouldBlockUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    // Decode URL-encoded characters to prevent bypass (e.g. p%6Frn → porn)
    let fullUrl;
    try {
      fullUrl = decodeURIComponent(url).toLowerCase();
    } catch (e) {
      fullUrl = url.toLowerCase(); // Fallback for malformed URIs
    }
    const pathname = urlObj.pathname.toLowerCase();
    
    // ========================================================================
    // STEP 1: Check search engine queries FIRST (with leet speak detection)
    // ========================================================================
    const searchCheck = checkSearchEngineQuery(url, hostname);
    if (searchCheck && searchCheck.blocked) {
      return searchCheck;
    }
    
    // ========================================================================
    // STEP 2: Check WHITELIST (never block these)
    // ========================================================================
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        return { blocked: false, tier: 'whitelist' };
      }
    }
    
    // ========================================================================
    // STEP 3: Check BLACKLIST (explicit NSFW domains)
    // ========================================================================
    // O(1) Set lookup for exact match, then check subdomains
    if (blocklistSet.has(hostname)) {
      return { blocked: true, reason: 'blacklist_domain', match: hostname, tier: 'blacklist' };
    }
    // Check subdomain matches (e.g., sub.pornhub.com)
    for (const domain of blocklistSet) {
      if (hostname.endsWith('.' + domain)) {
        return { blocked: true, reason: 'blacklist_domain', match: domain, tier: 'blacklist' };
      }
    }
    
    // ========================================================================
    // STEP 4: Check if domain contains explicit NSFW keywords
    // ========================================================================
    const domainKeywords = ['porn', 'xxx', 'sex', 'adult', 'hentai', 'xnxx', 'xvideos',
                             'nude', 'erotic', 'fetish', 'escort', 'cam', 'onlyfans'];
    for (const keyword of domainKeywords) {
      if (hostname.includes(keyword)) {
        return { blocked: true, reason: 'explicit_domain', match: keyword, tier: 'blacklist' };
      }
    }
    
    // ========================================================================
    // STEP 5: Check GRAYLIST domains with basic monitoring
    // ========================================================================
    let isGraylist = false;
    for (const graylistDomain of GRAYLIST_DOMAINS) {
      if (hostname === graylistDomain || hostname.endsWith('.' + graylistDomain)) {
        isGraylist = true;
        break;
      }
    }
    
    if (isGraylist) {
      // Check against hoisted GRAYLIST_EXPLICIT_PATHS Set (O(1) per entry)
      for (const path of GRAYLIST_EXPLICIT_PATHS) {
        if (pathname.startsWith(path)) {
          return { blocked: true, reason: 'graylist_explicit', match: path, tier: 'graylist' };
        }
      }
      // Allow if no explicit NSFW paths found
      return { blocked: false, tier: 'graylist' };
    }
    
    // ========================================================================
    // STEP 6: Check unknown domains for explicit patterns
    // ========================================================================
    
    // Check for explicit patterns in path
    const explicitPatterns = [
      '/porn/', '/sex/', '/nude/', '/nsfw/', '/adult/', '/hentai/', '/xxx/'
    ];
    
    for (const pattern of explicitPatterns) {
      if (pathname.includes(pattern)) {
        return { 
          blocked: true, 
          reason: 'explicit_path', 
          match: pattern,
          tier: 'unknown'
        };
      }
    }
    
    // Check for multiple explicit keywords in URL (need 2+)
    const explicitKeywords = ['porn', 'sex', 'nude', 'xxx', 'adult', 'nsfw', 'hentai'];
    let keywordCount = 0;
    let matchedKeywords = [];
    
    for (const keyword of explicitKeywords) {
      if (fullUrl.includes(keyword)) {
        keywordCount++;
        matchedKeywords.push(keyword);
      }
    }
    
    if (keywordCount >= 2) {
      return { 
        blocked: true, 
        reason: 'multiple_explicit', 
        match: matchedKeywords.join(', '),
        tier: 'unknown'
      };
    }
    
    // Allow if no NSFW indicators found
    return { blocked: false, tier: 'unknown' };
    
  } catch (error) {
    console.error('❌ Error checking URL:', error);
    return { blocked: false };
  }
}

// ============================================================================
// SHARED BLOCK HANDLER — single source of truth for blocking + stats
// Deduplicates across the 3 navigation listeners per tabId+URL pair.
// ============================================================================

function isIgnoredUrl(url) {
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('about:') ||
         url.startsWith('edge://');
}

async function handleBlock(tabId, url) {
  // Deduplicate: skip if we already checked this exact URL for this tab
  if (tabLastChecked.get(tabId) === url) return;
  tabLastChecked.set(tabId, url);

  const { passwordHash: storedHash } = await chrome.storage.local.get(['passwordHash']);
  if (!storedHash) return; // Not set up yet

  const result = shouldBlockUrl(url);
  if (!result.blocked) return;

  // Atomically increment stats from storage (avoids MV3 service worker race)
  const { stats: s } = await chrome.storage.local.get(['stats']);
  const updatedStats = s || { totalBlocks: 0, installDate: new Date().toISOString() };
  updatedStats.totalBlocks = (updatedStats.totalBlocks || 0) + 1;
  updatedStats.lastBlockDate = new Date().toISOString();
  await chrome.storage.local.set({ stats: updatedStats });

  // Redirect to blocked page — pass reason/match but NOT the original URL
  const blockedUrl = chrome.runtime.getURL('blocked.html') +
    `?reason=${result.reason}&match=${encodeURIComponent(result.match)}`;
  chrome.tabs.update(tabId, { url: blockedUrl });
}

// Clean up dedup map when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabLastChecked.delete(tabId);
});

// Handle web requests (main navigation)
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (isIgnoredUrl(details.url)) return;
  await handleBlock(details.tabId, details.url);
});

// Handle SPA navigation
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (isIgnoredUrl(details.url)) return;
  await handleBlock(details.tabId, details.url);
});

// Handle tab address bar changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (isIgnoredUrl(changeInfo.url)) return;
  await handleBlock(tabId, changeInfo.url);
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStats') {
    // Read stats from storage (not in-memory) to avoid MV3 service worker race
    chrome.storage.local.get(['stats'], (result) => {
      sendResponse({ stats: result.stats || { totalBlocks: 0 } });
    });
    return true;
  }
  
  if (request.action === 'setPassword') {
    // Store hash and salt together for PBKDF2
    const updates = { passwordHash: request.hash };
    if (request.salt) updates.passwordSalt = request.salt;
    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
  
  if (request.action === 'verifyPassword') {
    // Compare provided hash with stored hash
    chrome.storage.local.get(['passwordHash', 'passwordSalt'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ valid: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ 
          valid: result.passwordHash === request.hash,
          salt: result.passwordSalt || null
        });
      }
    });
    return true;
  }
  
  if (request.action === 'getBlocklists') {
    sendResponse({ 
      domains: blocklistDomains, 
      keywords: blocklistKeywords 
    });
    return true;
  }
  
  if (request.action === 'updateBlocklists') {
    // Update blocklists in storage
    const updates = {};
    if (request.domains !== undefined) {
      blocklistDomains = request.domains;
      blocklistSet = new Set(request.domains.map(d => d.toLowerCase()));
      updates.blocklistDomains = request.domains;
    }
    if (request.keywords !== undefined) {
      blocklistKeywords = request.keywords;
      updates.blocklistKeywords = request.keywords;
    }
    
    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('✅ Pure Path: Blocklists updated in storage');
        sendResponse({ success: true });
      }
    });
    return true;
  }
  
  if (request.action === 'reloadBlocklists') {
    // Reload blocklists from storage
    loadBlocklistsFromStorage().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'checkUrl') {
    // Delegate to handleBlock — it deduplicates and handles stats (Section G)
    // handleBlock redirects via chrome.tabs.update if blocked
    if (sender.tab && sender.tab.id) {
      handleBlock(sender.tab.id, request.url).then(() => {
        sendResponse({ blocked: false }); // handleBlock redirects directly if needed
      }).catch(() => {
        sendResponse({ blocked: false });
      });
    } else {
      sendResponse({ blocked: false });
    }
    return true;
  }
  
  if (request.action === 'isDomainSafe') {
    // Unified whitelist check (Section C) — single source of truth
    const hostname = (request.hostname || '').toLowerCase();
    let safe = false;
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        safe = true;
        break;
      }
    }
    sendResponse({ safe });
    return true;
  }
  
  return false;
});

// Remove the periodic reload since we're using storage now
// Blocklists will persist and load automatically
