let isExtensionEnabled = true;
let blocklistDomains = [];
let blocklistSet = new Set(); // O(1) domain lookup

let defaultDomains = [];

// Cached Set of the built-in domains, for fast "is this a default?" checks.
let defaultSetCache = null;
function getDefaultSet() {
  if (!defaultSetCache || defaultSetCache.size !== defaultDomains.length) {
    defaultSetCache = new Set(defaultDomains);
  }
  return defaultSetCache;
}

// On a cold/revived service worker the in-memory list can be empty; reload it
// from storage before any mutation so we never overwrite the saved blocklist.
// A single shared promise dedupes the cold-start bootstrap and the first
// navigation racing to load the same 385k list.
let blocklistLoadPromise = null;
async function ensureBlocklistLoaded() {
  if (blocklistSet && blocklistSet.size > 0) return;
  if (!blocklistLoadPromise) {
    blocklistLoadPromise = loadBlocklistsFromStorage()
      .finally(() => { blocklistLoadPromise = null; });
  }
  await blocklistLoadPromise;
}

// User-added domains are tracked in their own storage key (the source of truth
// for "my blocklist"), independent of the large merged blocklistDomains list.
async function getCustomList() {
  const { customDomains } = await chrome.storage.local.get(['customDomains']);
  return Array.isArray(customDomains) ? customDomains : [];
}

// Deduplication maps: prevents multi-firing stats while allowing re-blocks
const tabLastChecked = new Map();
const tabLastCheckedTime = new Map();

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Pure Path installed');

  // Load defaults into memory for sync reference
  await loadDefaultListsIntoMemory();

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
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Pure Path starting up');
  await loadDefaultListsIntoMemory();
  await loadBlocklistsFromStorage();
});

// Cold-start: an idle-revived MV3 service worker re-evaluates this script but
// fires NEITHER onInstalled NOR onStartup — so without this the blacklist Set
// would sit empty (only the keyword layer firing) until the next browser
// restart. Load eagerly on every worker spawn; ensureBlocklistLoaded dedupes
// against the first navigation that also triggers a load.
ensureBlocklistLoaded();
loadDefaultListsIntoMemory();

// Cache default lists into variables to send to Desktop app
// Loads all 3 part files in parallel for fastest cold-start
async function loadDefaultListsIntoMemory() {
  try {
    const [r1, r2, r3] = await Promise.all([
      fetch(chrome.runtime.getURL('blocklists/domains_part1.json')),
      fetch(chrome.runtime.getURL('blocklists/domains_part2.json')),
      fetch(chrome.runtime.getURL('blocklists/domains_part3.json')),
    ]);
    const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
    defaultDomains = [
      ...(d1.domains || []),
      ...(d2.domains || []),
      ...(d3.domains || []),
    ];
  } catch(e) {
    console.error('Error caching default lists:', e);
  }
}

async function initializeBlocklistsFromJSON() {
  try {
    console.log('Pure Path: Initializing blocklists from JSON files...');
    
    // Ensure we have default domains loaded
    if (!defaultDomains || defaultDomains.length === 0) {
      console.log(' defaultDomains empty, fetching now...');
      await loadDefaultListsIntoMemory();
    }
    
    if (!defaultDomains || defaultDomains.length === 0) {
      throw new Error('Could not load domains from JSON file');
    }

    // Save to storage
    await chrome.storage.local.set({
      blocklistDomains: defaultDomains
    });

    console.log(`Pure Path: Initialized ${defaultDomains.length} domains in storage`);
  } catch (error) {
    console.error('Pure Path: Error initializing blocklists from JSON:', error);
  }
}

async function loadBlocklistsFromStorage() {
  try {
    console.log('Pure Path: Loading blocklists from storage...');
    const result = await chrome.storage.local.get(['blocklistDomains']);

    if (result.blocklistDomains && result.blocklistDomains.length > 0 && result.blocklistDomains.length < 600000) {
      blocklistDomains = result.blocklistDomains;
      // Build the Set for O(1) lookups — more memory efficient for-loop
      blocklistSet = new Set();
      for (let i = 0; i < blocklistDomains.length; i++) {
        blocklistSet.add(blocklistDomains[i].toLowerCase());
      }
      console.log(`Pure Path: Loaded ${blocklistDomains.length} domains from storage`);
    } else {
      if (result.blocklistDomains && result.blocklistDomains.length >= 600000) {
         console.log('Pure Path: Detected old unoptimized blocklist in storage. Forcing re-initialization...');
         await chrome.storage.local.remove('blocklistDomains');
      }
      // If not in storage, initialize from JSON
      console.log('️ Pure Path: Blocklists empty or not found in storage, initializing from JSON...');
      await initializeBlocklistsFromJSON();
      
      // Load again after initialization
      const retryResult = await chrome.storage.local.get(['blocklistDomains']);
      if (retryResult.blocklistDomains && retryResult.blocklistDomains.length > 0) {
          blocklistDomains = retryResult.blocklistDomains;
          blocklistSet = new Set();
          for (let i = 0; i < blocklistDomains.length; i++) {
            blocklistSet.add(blocklistDomains[i].toLowerCase());
          }
          console.log(`Pure Path: Successfully initialized ${blocklistDomains.length} domains`);
      } else {
          console.error('Pure Path: Failed to load blocklists even after initialization');
      }
    }
  } catch (error) {
    console.error('Pure Path: Error loading blocklists from storage:', error);
  }
}

async function loadBlocklists() {
  await loadBlocklistsFromStorage();
}

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
  'youtube.com',
  'youtu.be',
  'spotify.com',
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
  // Bare unambiguous terms — safe under whole-word matching (used only in the
  // Reddit subreddit/search checks). 'xxx'/'cum' are whole-word-only (len < 4),
  // so they can't Scunthorpe; 'gonewild'/'r34'/'lewd' are long enough to substring.
  'xxx', 'cum', 'gonewild', 'r34', 'lewd'
].map(k => k.toLowerCase());

// SEARCH ENGINE SAFESEARCH ENFORCEMENT

const SEARCH_ENGINES = [
  { domain: 'google.com', queryParam: 'q', safeParam: 'active' },
  { domain: 'bing.com', queryParam: 'q', safeParam: 'strict' },
  { domain: 'duckduckgo.com', queryParam: 'q', safeParam: '1' },
  { domain: 'yahoo.com', queryParam: 'p', safeParam: 'r' }
];

// SAFESEARCH ENFORCEMENT (always-on)

function checkSearchEngineSafeSearch(url, hostname) {
  const searchEngine = SEARCH_ENGINES.find(se =>
    hostname === se.domain || hostname.endsWith('.' + se.domain)
  );

  if (!searchEngine) return null;

  try {
    const urlObj = new URL(url);

    // Block attempts to disable SafeSearch
    const hasSafeSearchOff = url.includes('safe=off') || url.includes('safesearch=off') || url.includes('safe=0');
    if (hasSafeSearchOff) {
      console.log('SafeSearch disabled - blocking bypass attempt');
      return {
        blocked: true,
        reason: 'safesearch_bypass',
        match: 'SafeSearch disabled',
        severity: 'bypass_attempt'
      };
    }

    // ALWAYS enforce SafeSearch on search engines (regardless of query)
    const currentUrl = new URL(url);
    let paramName = 'safe';
    if (searchEngine.domain.includes('bing.com')) paramName = 'adlt';
    if (searchEngine.domain.includes('duckduckgo.com')) paramName = 'kp';
    if (searchEngine.domain.includes('yahoo.com')) paramName = 'vm';

    if (currentUrl.searchParams.get(paramName) !== searchEngine.safeParam) {
      currentUrl.searchParams.set(paramName, searchEngine.safeParam);
      return {
        safesearch: true,
        redirectUrl: currentUrl.toString(),
        reason: 'safesearch_always_on',
        match: 'SafeSearch enforced'
      };
    }
  } catch (error) {
    console.error(' Error checking search engine:', error);
  }

  return null;
}

// GRAYLIST ENFORCEMENT — Cookies & URL rewrites for gray-area domains
// Forces maximum restriction on sites that have NSFW filters.

// Pre-built Map: base domain → array of cookie configs (O(1) lookup)
const GRAYLIST_COOKIE_MAP = new Map([
  ['reddit.com', [
    { domain: 'reddit.com',  name: 'over18', value: '0', path: '/' },
    { domain: '.reddit.com', name: 'over18', value: '0', path: '/' }
  ]],
  ['pixiv.net', [
    { domain: 'pixiv.net',  name: 'R18', value: '0', path: '/' },
    { domain: '.pixiv.net', name: 'R18', value: '0', path: '/' }
  ]],
  ['twitter.com', [
    { domain: 'twitter.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.twitter.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]],
  ['x.com', [
    { domain: 'x.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.x.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]]
]);

// Pre-built Map: base domain → enforce(urlObj) function
const GRAYLIST_URL_REWRITE_MAP = new Map([
  ['archiveofourown.org', (urlObj) => {
    const p = urlObj.pathname;
    if (p.includes('/works') || p.includes('/tags') || p.includes('/search')) {
      let changed = false;
      const params = urlObj.searchParams;
      if (!params.getAll('work_search[excl_tag_names][]').includes('Explicit')) {
        params.append('work_search[excl_tag_names][]', 'Explicit');
        changed = true;
      }
      if (!params.getAll('work_search[excl_tag_names][]').includes('Mature')) {
        params.append('work_search[excl_tag_names][]', 'Mature');
        changed = true;
      }
      return changed ? urlObj.toString() : null;
    }
    return null;
  }],
  ['dailymotion.com', (urlObj) => {
    if (urlObj.searchParams.get('family_filter') !== 'true') {
      urlObj.searchParams.set('family_filter', 'true');
      return urlObj.toString();
    }
    return null;
  }]
]);

// Fast set of all graylist domains that need any enforcement
const GRAYLIST_ENFORCE_DOMAINS = new Set([
  ...GRAYLIST_COOKIE_MAP.keys(),
  ...GRAYLIST_URL_REWRITE_MAP.keys()
]);

// Match hostname to a graylist enforcement domain (or null)
function matchGraylistEnforceDomain(hostname) {
  if (GRAYLIST_ENFORCE_DOMAINS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (GRAYLIST_ENFORCE_DOMAINS.has(parent)) return parent;
  }
  return null;
}

// Set restrictive cookies — only called for matching domains
async function enforceGraylistCookies(baseDomain) {
  const cookies = GRAYLIST_COOKIE_MAP.get(baseDomain);
  if (!cookies) return;
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.replace(/^\./, '');
    try {
      await chrome.cookies.set({
        url: `https://${cleanDomain}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: true,
        sameSite: 'lax'
      });
    } catch (e) {
      // chrome.cookies may not be available
    }
  }
}

// Rewrite URL with safe-mode params — only called for matching domains
function enforceGraylistUrlRewrite(url, baseDomain) {
  const enforce = GRAYLIST_URL_REWRITE_MAP.get(baseDomain);
  if (!enforce) return null;
  try {
    return enforce(new URL(url));
  } catch (_) {
    return null;
  }
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
  // Source: nsfw_multilingual_keywords.md. Only unique/long terms that survived
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
  'bocha'
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
  'zoophilou', 'zoophily'
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
  'archive.vn', 'archive.fo'
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

  return null;
}

// Raw public-IP host? (private / loopback / link-local ranges are exempt.)
function isPublicIpHost(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = [m[1], m[2], m[3], m[4]].map(Number);
  if (o.some(n => n > 255)) return false;
  if (o[0] === 0 || o[0] === 10 || o[0] === 127) return false;   // this-net / private / loopback
  if (o[0] === 192 && o[1] === 168) return false;                // private
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;    // private
  if (o[0] === 169 && o[1] === 254) return false;                // link-local
  return true;
}

// URL BLOCKING LOGIC — blocklist + keyword layer + bypass-vector

function shouldBlockUrl(url, depth = 0) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

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

    // STEP 3b: DOMAIN-NAME KEYWORD LAYER — catches unlisted porn domains
    // (e.g. sex4arabs.com). Hostname-only; runs even if the blocklist is empty.
    const kw = checkDomainKeywords(hostname);
    if (kw.hit) {
      return { blocked: true, reason: 'domain_keyword', match: kw.match, tier: 'keyword', hostname };
    }

    // STEP 4: REDDIT-SPECIFIC CONTENT FILTERING (Paths and Keywords)
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
      const pathname = urlObj.pathname.toLowerCase();
      
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
      const searchQuery = urlObj.searchParams.get('q');
      if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        // Boundary-padded, separator-normalised form for whole-word checks.
        // NB: don't strip '+' — searchParams already turned URL '+' into spaces,
        // so a surviving '+' is a literal one we must keep (e.g. the "18+" keyword).
        const qText = ' ' + queryLower.replace(/[_\-.,]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
        const queryHasKeyword = (keyword) => {
          // Whole-word (handles single- and multi-word keywords).
          if (qText.includes(' ' + keyword + ' ')) return true;
          // Run-together substring — only safe for longer, unambiguous keywords.
          if (keyword.length >= 4 && queryLower.includes(keyword)) return true;
          return false;
        };
        for (const keyword of HARD_PORN_KEYWORDS) {
          if (queryHasKeyword(keyword)) {
            return { blocked: true, reason: 'reddit_search_keyword', match: keyword, tier: 'blacklist', hostname };
          }
        }
        for (const keyword of SOFT_PORN_KEYWORDS) {
          if (queryHasKeyword(keyword)) {
            return { blocked: true, reason: 'reddit_search_keyword', match: keyword, tier: 'blacklist', hostname };
          }
        }
      }
    }

    return { blocked: false, tier: 'unknown', hostname };

  } catch (error) {
    console.error(' Error checking URL:', error);
    return { blocked: false };
  }
}

// SHARED BLOCK HANDLER — single source of truth for blocking + stats
// Deduplicates across the 3 navigation listeners per tabId+URL pair.

function isIgnoredUrl(url) {
  return url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://');
}

async function recordBlockAndRedirect(tabId, url, reason, match, skipTabUpdate = false) {
  const lastUrl = tabLastChecked.get(tabId);
  const lastTime = tabLastCheckedTime.get(tabId) || 0;
  const now = Date.now();

  // Deduplicate stats: skip if same URL within 2 seconds
  const isDuplicateStat = (lastUrl === url && (now - lastTime) < 2000);

  if (!isDuplicateStat) {
    tabLastChecked.set(tabId, url);
    tabLastCheckedTime.set(tabId, now);

    const { stats: s } = await chrome.storage.local.get(['stats']);
    const updatedStats = s || { totalBlocks: 0, installDate: new Date().toISOString() };
    updatedStats.totalBlocks = (updatedStats.totalBlocks || 0) + 1;
    updatedStats.lastBlockDate = new Date().toISOString();
    await chrome.storage.local.set({ stats: updatedStats });

    if (typeof NativeMessagingBridge !== 'undefined') {
      NativeMessagingBridge.sendStatsUpdate();
    }
  }

  const blockedPrefix = chrome.runtime.getURL('blocked.html');
  if (url.startsWith(blockedPrefix)) return null;

  const blockedUrl = blockedPrefix + `?reason=${reason}&match=${encodeURIComponent(match)}`;
  
  if (!skipTabUpdate) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && !tab.url.startsWith(blockedPrefix)) {
        await chrome.tabs.update(tabId, { url: blockedUrl });
      }
    } catch (e) {
      chrome.tabs.update(tabId, { url: blockedUrl }).catch(() => {});
    }
  }

  return blockedUrl;
}

async function handleBlock(tabId, url, skipTabUpdate = false) {
  // Make sure the blacklist is loaded (cold-revived worker). Returns instantly
  // once warm, so this adds no per-navigation cost — and removes the previous
  // per-navigation chrome.storage round-trip that gated every check.
  await ensureBlocklistLoaded();

  const result = shouldBlockUrl(url);

  // Handle silent SafeSearch enforcement
  if (result && result.safesearch) {
    if (url !== result.redirectUrl) {
      console.log(`Forcing SafeSearch: ${result.match}`);
      chrome.tabs.update(tabId, { url: result.redirectUrl });
    }
    return;
  }

  if (!result || !result.blocked) {
    // Not blocked — check if this is a graylist enforcement domain
    // Reuse hostname from shouldBlockUrl result to avoid re-parsing
    const hn = result?.hostname;
    if (hn) {
      const baseDomain = matchGraylistEnforceDomain(hn);
      if (baseDomain) {
        // Set restrictive cookies (fire-and-forget)
        enforceGraylistCookies(baseDomain);
        // Rewrite URL with safe-mode params
        const rewrittenUrl = enforceGraylistUrlRewrite(url, baseDomain);
        if (rewrittenUrl && rewrittenUrl !== url) {
          console.log(`Graylist URL rewrite: ${baseDomain}`);
          chrome.tabs.update(tabId, { url: rewrittenUrl });
        }
      }
    }
    return;
  }

  return await recordBlockAndRedirect(tabId, url, result.reason, result.match, skipTabUpdate);
}

// Clean up dedup maps when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabLastChecked.delete(tabId);
  tabLastCheckedTime.delete(tabId);
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

  if (request.action === 'getBlocklists') {
    sendResponse({
      domains: blocklistDomains
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

    chrome.storage.local.set(updates, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('Pure Path: Blocklists updated in storage');
        sendResponse({ success: true });
        // Notify desktop app of the change
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendBlocklistUpdate();
        }
      }
    });
    return true;
  }

  if (request.action === 'getCustomDomains') {
    // The user's own list (small) + the built-in count for display.
    (async () => {
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      sendResponse({ custom: await getCustomList(), builtIn: getDefaultSet().size });
    })();
    return true;
  }

  if (request.action === 'checkDomainBlocked') {
    // Yes/no check against the built-in blacklist (exact or parent-domain match).
    (async () => {
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      const d = (request.domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      const dset = getDefaultSet();
      let blocked = dset.has(d);
      if (!blocked && d.includes('.')) {
        // also match if a parent registrable domain is blocked (sub.x.com -> x.com)
        const parts = d.split('.');
        for (let i = 1; i < parts.length - 1 && !blocked; i++) {
          if (dset.has(parts.slice(i).join('.'))) blocked = true;
        }
      }
      sendResponse({ domain: d, blocked });
    })();
    return true;
  }

  if (request.action === 'addCustomDomain') {
    (async () => {
      const domain = (request.domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!domain) { sendResponse({ success: false, reason: 'empty' }); return; }
      if (!defaultDomains || !defaultDomains.length) await loadDefaultListsIntoMemory();
      if (getDefaultSet().has(domain)) { sendResponse({ success: false, reason: 'default' }); return; }
      const custom = await getCustomList();
      if (custom.includes(domain)) { sendResponse({ success: false, reason: 'exists' }); return; }
      await ensureBlocklistLoaded();
      const nextCustom = [...custom, domain];
      if (!blocklistSet.has(domain)) { blocklistDomains = [...blocklistDomains, domain]; blocklistSet.add(domain); }
      chrome.storage.local.set({ customDomains: nextCustom, blocklistDomains }, () => {
        if (chrome.runtime.lastError) { sendResponse({ success: false, reason: 'storage' }); return; }
        if (typeof NativeMessagingBridge !== 'undefined') NativeMessagingBridge.sendBlocklistUpdate();
        sendResponse({ success: true });
      });
    })();
    return true;
  }

  if (request.action === 'removeCustomDomain') {
    (async () => {
      const domain = (request.domain || '').trim().toLowerCase();
      await ensureBlocklistLoaded();
      const nextCustom = (await getCustomList()).filter((d) => d !== domain);
      blocklistDomains = blocklistDomains.filter((d) => d !== domain);
      blocklistSet.delete(domain);
      chrome.storage.local.set({ customDomains: nextCustom, blocklistDomains }, () => {
        if (chrome.runtime.lastError) { sendResponse({ success: false }); return; }
        if (typeof NativeMessagingBridge !== 'undefined') NativeMessagingBridge.sendBlocklistUpdate();
        sendResponse({ success: true });
      });
    })();
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
    if (sender.tab && sender.tab.id) {
      handleBlock(sender.tab.id, request.url, true).then((blockedUrl) => {
        if (blockedUrl) {
          sendResponse({ blocked: true, blockedUrl: blockedUrl });
        } else {
          sendResponse({ blocked: false });
        }
      }).catch(() => {
        sendResponse({ blocked: false });
      });
    } else {
      sendResponse({ blocked: false });
    }
    return true;
  }

  if (request.action === 'notifyBlock') {
    // Explicit block report from content script
    if (sender.tab && sender.tab.id) {
      recordBlockAndRedirect(
        sender.tab.id,
        request.url || sender.tab.url,
        request.reason,
        request.match
      ).then(() => {
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === 'graylistFiltered') {
    // Graylist V2 stripped N site-labelled NSFW items from a JSON response.
    // Track it separately from navigation blocks (it's filtering, not a redirect).
    const n = Number(request.count) || 0;
    if (n > 0) {
      (async () => {
        const { stats } = await chrome.storage.local.get(['stats']);
        const s = stats || { totalBlocks: 0, installDate: new Date().toISOString() };
        s.graylistFiltered = (s.graylistFiltered || 0) + n;
        await chrome.storage.local.set({ stats: s });
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendStatsUpdate();
        }
      })();
    }
    return false;
  }

  if (request.action === 'isDomainSafe') {
    // Unified whitelist check — single source of truth
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

// NATIVE MESSAGING BRIDGE — Desktop App Communication
// Connects to Pure Path desktop companion via chrome.runtime.connectNative()

const NativeMessagingBridge = (function () {
  const HOST_NAME = 'com.purepath.companion';
  const HEARTBEAT_INTERVAL = 15000;  // 15 seconds — keeps connection alive
  const SYNC_INTERVAL = 60000;       // 60 seconds — full data refresh
  const MAX_RECONNECT_DELAY = 15000; // 15 seconds max backoff

  let port = null;
  let heartbeatTimer = null;
  let syncTimer = null;
  let reconnectDelay = 250;
  let reconnectTimer = null;
  let isConnected = false;
  let profileId = null;

  // ─ Stable per-profile id ───────────────────────────────────
  // Each Chrome profile has its own extension storage, so a value stored here
  // is unique to (and stable for) this profile. The desktop app uses it to tell
  // multiple connected profiles of the same browser apart.
  async function ensureProfileId() {
    if (profileId) return profileId;
    try {
      const { ppProfileId } = await chrome.storage.local.get(['ppProfileId']);
      if (ppProfileId) { profileId = ppProfileId; return profileId; }
      profileId = (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await chrome.storage.local.set({ ppProfileId: profileId });
    } catch (e) {
      profileId = profileId || ('p-' + Math.random().toString(36).slice(2, 10));
    }
    return profileId;
  }

  // ─ Connect to desktop app ──────────────────────────────────
  function connect() {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.log(`Native host disconnected${err ? ': ' + err.message : ''}`);
        cleanup();
        scheduleReconnect();
      });

      // Send handshake immediately
      sendHandshake();

      // Start periodic heartbeat and sync
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
      syncTimer = setInterval(sendFullSync, SYNC_INTERVAL);

      isConnected = true;
      reconnectDelay = 250; // Reset backoff on successful connect
      console.log('Connected to Pure Path desktop app');
    } catch (err) {
      console.log('️ Native messaging connect failed:', err.message);
      scheduleReconnect();
    }
  }

  // ─ Cleanup on disconnect ───────────────────────────────────
  function cleanup() {
    isConnected = false;
    port = null;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  // ─ Reconnect with exponential backoff ──────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(` Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  // ─ Send a message to the desktop app ───────────────────────
  function send(msg) {
    if (!port || !isConnected) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch (err) {
      console.log('️ Native send failed:', err.message);
      return false;
    }
  }

  // ─ Handshake ───────────────────────────────────────────────
  async function sendHandshake() {
    await ensureProfileId();
    const { stats } = await chrome.storage.local.get(['stats']);
    send({
      type: 'handshake',
      profileId,
      extensionVersion: chrome.runtime.getManifest().version,
      installDate: stats?.installDate || new Date().toISOString()
    });
    // Send full sync immediately — no delay
    sendFullSync();
  }

  // ─ Heartbeat ───────────────────────────────────────────────
  function sendHeartbeat() {
    send({
      type: 'heartbeat',
      profileId,
      timestamp: Date.now()
    });
  }

  // ─ Full sync (stats + blocklists) ──────────────────────────
  async function sendFullSync() {
    // Send stats
    const { stats } = await chrome.storage.local.get(['stats']);
    if (stats) {
      const installDate = stats.installDate ? new Date(stats.installDate) : new Date();
      const daysProtected = Math.floor((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24));
      send({
        type: 'stats_sync',
        totalBlocks: stats.totalBlocks || 0,
        installDate: stats.installDate || '',
        lastBlockDate: stats.lastBlockDate || '',
        daysProtected: daysProtected
      });
    }

    // Send blocklists
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─ Incremental stats update (called after each block) ──────
  async function sendStatsUpdate() {
    const { stats } = await chrome.storage.local.get(['stats']);
    if (stats) {
      const installDate = stats.installDate ? new Date(stats.installDate) : new Date();
      const daysProtected = Math.floor((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24));
      send({
        type: 'stats_update',
        totalBlocks: stats.totalBlocks || 0,
        lastBlockDate: stats.lastBlockDate || '',
        daysProtected: daysProtected
      });
    }
  }

  // ─ Blocklist change notification ───────────────────────────
  async function sendBlocklistUpdate() {
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─ Handle messages FROM the desktop app ────────────────────
  function handleMessage(msg) {
    console.log(' Message from desktop app:', msg.type);

    switch (msg.type) {
      case 'ack':
        console.log('Desktop app acknowledged connection');
        break;

      case 'request_sync':
        // Desktop app wants fresh data
        sendFullSync();
        break;

      case 'update_blocklist':
        // Desktop app pushed a blocklist change
        handleBlocklistUpdate(msg);
        break;

      case 'set_theme':
        // Desktop app pushed its selected theme/palette — mirror it so every
        // extension page matches (theme-sync.js / blocked.js read this).
        handleSetTheme(msg);
        break;

      case 'set_app_data':
        // Desktop app pushed the canonical day-streak + global block total
        // (summed across every browser/profile). Pages read `ppAppData`.
        handleSetAppData(msg);
        break;

      default:
        console.log('Unknown message from desktop:', msg.type);
    }
  }

  // ─ Mirror the app's day streak + global block total into storage ──
  async function handleSetAppData(msg) {
    const data = {};
    if (typeof msg.streak === 'number') data.streak = msg.streak;
    if (typeof msg.globalBlocks === 'number') data.globalBlocks = msg.globalBlocks;
    if (Object.keys(data).length === 0) return;
    const { ppAppData } = await chrome.storage.local.get(['ppAppData']);
    await chrome.storage.local.set({ ppAppData: Object.assign({}, ppAppData, data) });
  }

  // ─ Mirror the desktop app's theme into storage ─────────────
  async function handleSetTheme(msg) {
    const d = (msg.display && typeof msg.display === 'object') ? msg.display : msg;
    const display = {};
    if (d.theme) display.theme = d.theme;
    if (d.style) display.style = d.style;
    if (d.bg) display.bg = d.bg;
    if (typeof d.intensity !== 'undefined') display.intensity = d.intensity;
    if (Object.keys(display).length === 0) return;
    // Store the object plus mirrored top-level keys (blocked.js reads either).
    await chrome.storage.local.set({ display, ...display });
  }

  // ─ Handle blocklist updates from desktop ───────────────────
  async function handleBlocklistUpdate(msg) {
    const updates = {};

    if (msg.listType === 'domains' && Array.isArray(msg.data)) {
      updates.blocklistDomains = msg.data;
      // Update in-memory blocklists
      blocklistDomains = msg.data;
      blocklistSet = new Set(msg.data.map(d => d.toLowerCase()));
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('Blocklist updated from desktop app:', msg.listType);
    }
  }

  // ─ Public API ──────────────────────────────────────────────
  return {
    connect,
    sendStatsUpdate,
    sendBlocklistUpdate,
    isConnected: () => isConnected
  };
})();

// ─ Connect immediately on startup ───────────────────────────
NativeMessagingBridge.connect();

// Also connect/reconnect when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // The main onInstalled listener (line 12) handles blocklist init.
  // This ensures the native bridge connects after setup.
  setTimeout(() => NativeMessagingBridge.connect(), 500);
});
