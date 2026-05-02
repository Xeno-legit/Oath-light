// Background service worker for Pure Path
let isExtensionEnabled = true;
let passwordHash = null;
let blocklistDomains = [];
let blocklistSet = new Set(); // O(1) domain lookup

let defaultDomains = [];

// Deduplication maps: prevents multi-firing stats while allowing re-blocks
const tabLastChecked = new Map();
const tabLastCheckedTime = new Map();

// Initialize extension
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
  await loadDefaultListsIntoMemory();
  await loadBlocklistsFromStorage();
});

// Cache default lists into variables to send to Desktop app
async function loadDefaultListsIntoMemory() {
  try {
    const dRes = await fetch(chrome.runtime.getURL('blocklists/domains.json'));
    const dData = await dRes.json();
    defaultDomains = dData.domains || [];
  } catch(e) {
    console.error('❌ Error caching default lists:', e);
  }
}

// Initialize blocklists from JSON files (only on install/update)
async function initializeBlocklistsFromJSON() {
  try {
    console.log('📋 Pure Path: Initializing blocklists from JSON files...');
    
    // Ensure we have default domains loaded
    if (!defaultDomains || defaultDomains.length === 0) {
      console.log('🔄 defaultDomains empty, fetching now...');
      await loadDefaultListsIntoMemory();
    }
    
    if (!defaultDomains || defaultDomains.length === 0) {
      throw new Error('Could not load domains from JSON file');
    }

    // Save to storage
    await chrome.storage.local.set({
      blocklistDomains: defaultDomains
    });

    console.log(`✅ Pure Path: Initialized ${defaultDomains.length} domains in storage`);
  } catch (error) {
    console.error('❌ Pure Path: Error initializing blocklists from JSON:', error);
  }
}

// Load blocklists from Chrome storage
async function loadBlocklistsFromStorage() {
  try {
    console.log('📋 Pure Path: Loading blocklists from storage...');
    const result = await chrome.storage.local.get(['blocklistDomains']);

    if (result.blocklistDomains && result.blocklistDomains.length > 0) {
      blocklistDomains = result.blocklistDomains;
      // Build the Set for O(1) lookups — more memory efficient for-loop
      blocklistSet = new Set();
      for (let i = 0; i < blocklistDomains.length; i++) {
        blocklistSet.add(blocklistDomains[i].toLowerCase());
      }
      console.log(`✅ Pure Path: Loaded ${blocklistDomains.length} domains from storage`);
    } else {
      // If not in storage, initialize from JSON
      console.log('⚠️ Pure Path: Blocklists empty or not found in storage, initializing from JSON...');
      await initializeBlocklistsFromJSON();
      
      // Load again after initialization
      const retryResult = await chrome.storage.local.get(['blocklistDomains']);
      if (retryResult.blocklistDomains && retryResult.blocklistDomains.length > 0) {
          blocklistDomains = retryResult.blocklistDomains;
          blocklistSet = new Set();
          for (let i = 0; i < blocklistDomains.length; i++) {
            blocklistSet.add(blocklistDomains[i].toLowerCase());
          }
          console.log(`✅ Pure Path: Successfully initialized ${blocklistDomains.length} domains`);
      } else {
          console.error('❌ Pure Path: Failed to load blocklists even after initialization');
      }
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
// WHITELIST - Completely safe domains (never block)
// ============================================================================

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
  'spotify.com',
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'crunchyroll.com',
  'store.steampowered.com',
  'epicgames.com'
];

// ============================================================================
// REDDIT-SPECIFIC CONTENT FILTERING (Paths and Keywords)
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
  'shotacon', 'lolicon', 'doujinshi', 'ero manga', 'eroge'
].map(k => k.toLowerCase());

// ============================================================================
// SEARCH ENGINE SAFESEARCH ENFORCEMENT
// ============================================================================

const SEARCH_ENGINES = [
  { domain: 'google.com', queryParam: 'q', safeParam: 'active' },
  { domain: 'bing.com', queryParam: 'q', safeParam: 'strict' },
  { domain: 'duckduckgo.com', queryParam: 'q', safeParam: '1' },
  { domain: 'yahoo.com', queryParam: 'p', safeParam: 'r' }
];

// ============================================================================
// SAFESEARCH ENFORCEMENT (always-on)
// ============================================================================

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
      console.log('🚫 SafeSearch disabled - blocking bypass attempt');
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
    console.error('❌ Error checking search engine:', error);
  }

  return null;
}

// ============================================================================
// GRAYLIST ENFORCEMENT — Cookies & URL rewrites for gray-area domains
// Forces maximum restriction on sites that have NSFW filters.
// ============================================================================

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
// URL BLOCKING LOGIC — Domain-only blocking
// ============================================================================

function shouldBlockUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // ========================================================================
    // STEP 1: Check search engine SafeSearch enforcement
    // ========================================================================
    const searchCheck = checkSearchEngineSafeSearch(url, hostname);
    if (searchCheck && (searchCheck.blocked || searchCheck.safesearch)) {
      return searchCheck;
    }

    // ========================================================================
    // STEP 2: Check WHITELIST (never block these)
    // ========================================================================
    for (const whitelistDomain of WHITELIST_DOMAINS) {
      if (hostname === whitelistDomain || hostname.endsWith('.' + whitelistDomain)) {
        return { blocked: false, tier: 'whitelist', hostname };
      }
    }

    // ========================================================================
    // STEP 3: Check BLACKLIST (explicit NSFW domains from blocklist)
    // ========================================================================
    if (!blocklistSet || blocklistSet.size === 0) {
      return { blocked: false, tier: 'unknown', hostname };
    }

    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const domainToCheck = parts.slice(i).join('.');
      if (blocklistSet.has(domainToCheck)) {
        return { blocked: true, reason: 'blacklist_domain', match: domainToCheck, tier: 'blacklist', hostname };
      }
    }

    // ========================================================================
    // STEP 4: REDDIT-SPECIFIC CONTENT FILTERING (Paths and Keywords)
    // ========================================================================
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
      const decodedUrl = decodeURIComponent(url).toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();
      
      for (const keyword of HARD_PORN_KEYWORDS) {
        // Regex word boundary match for hard keywords
        const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (regex.test(decodedUrl)) {
          return { blocked: true, reason: 'reddit_hard_keyword', match: keyword, tier: 'blacklist', hostname };
        }
      }
      
      for (const keyword of SOFT_PORN_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (regex.test(decodedUrl)) {
          return { blocked: true, reason: 'reddit_soft_keyword', match: keyword, tier: 'blacklist', hostname };
        }
      }
      
      for (const path of GRAYLIST_EXPLICIT_PATHS) {
         if (pathname === path || pathname.startsWith(path + '/')) {
            return { blocked: true, reason: 'reddit_explicit_path', match: path, tier: 'blacklist', hostname };
         }
      }
    }

    return { blocked: false, tier: 'unknown', hostname };

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
  const { passwordHash: storedHash } = await chrome.storage.local.get(['passwordHash']);
  if (!storedHash) return; // Not set up yet

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
          console.log(`🔒 Graylist URL rewrite: ${baseDomain}`);
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
        console.log('✅ Pure Path: Blocklists updated in storage');
        sendResponse({ success: true });
        // Notify desktop app of the change
        if (typeof NativeMessagingBridge !== 'undefined') {
          NativeMessagingBridge.sendBlocklistUpdate();
        }
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

// ============================================================================
// NATIVE MESSAGING BRIDGE — Desktop App Communication
// Connects to Pure Path desktop companion via chrome.runtime.connectNative()
// ============================================================================

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

  // ─── Connect to desktop app ────────────────────────────────────
  function connect() {
    try {
      port = chrome.runtime.connectNative(HOST_NAME);

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.log(`🔌 Native host disconnected${err ? ': ' + err.message : ''}`);
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
      console.log('🔗 Connected to Pure Path desktop app');
    } catch (err) {
      console.log('⚠️ Native messaging connect failed:', err.message);
      scheduleReconnect();
    }
  }

  // ─── Cleanup on disconnect ─────────────────────────────────────
  function cleanup() {
    isConnected = false;
    port = null;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  // ─── Reconnect with exponential backoff ────────────────────────
  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`🔄 Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  // ─── Send a message to the desktop app ─────────────────────────
  function send(msg) {
    if (!port || !isConnected) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch (err) {
      console.log('⚠️ Native send failed:', err.message);
      return false;
    }
  }

  // ─── Handshake ─────────────────────────────────────────────────
  async function sendHandshake() {
    const { stats } = await chrome.storage.local.get(['stats']);
    send({
      type: 'handshake',
      extensionVersion: chrome.runtime.getManifest().version,
      installDate: stats?.installDate || new Date().toISOString()
    });
    // Send full sync immediately — no delay
    sendFullSync();
  }

  // ─── Heartbeat ─────────────────────────────────────────────────
  function sendHeartbeat() {
    send({
      type: 'heartbeat',
      timestamp: Date.now()
    });
  }

  // ─── Full sync (stats + blocklists) ────────────────────────────
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

  // ─── Incremental stats update (called after each block) ────────
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

  // ─── Blocklist change notification ─────────────────────────────
  async function sendBlocklistUpdate() {
    const { blocklistDomains } = await chrome.storage.local.get(['blocklistDomains']);
    send({
      type: 'blocklist_sync',
      domains: blocklistDomains || [],
      domainCount: (blocklistDomains || []).length,
      builtInDomains: defaultDomains
    });
  }

  // ─── Handle messages FROM the desktop app ──────────────────────
  function handleMessage(msg) {
    console.log('📩 Message from desktop app:', msg.type);

    switch (msg.type) {
      case 'ack':
        console.log('✅ Desktop app acknowledged connection');
        break;

      case 'request_sync':
        // Desktop app wants fresh data
        sendFullSync();
        break;

      case 'update_blocklist':
        // Desktop app pushed a blocklist change
        handleBlocklistUpdate(msg);
        break;

      default:
        console.log('❓ Unknown message from desktop:', msg.type);
    }
  }

  // ─── Handle blocklist updates from desktop ─────────────────────
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
      console.log('✅ Blocklist updated from desktop app:', msg.listType);
    }
  }

  // ─── Public API ────────────────────────────────────────────────
  return {
    connect,
    sendStatsUpdate,
    sendBlocklistUpdate,
    isConnected: () => isConnected
  };
})();

// ─── Connect immediately on startup ─────────────────────────────
NativeMessagingBridge.connect();

// Also connect/reconnect when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // The main onInstalled listener (line 12) handles blocklist init.
  // This ensures the native bridge connects after setup.
  setTimeout(() => NativeMessagingBridge.connect(), 500);
});
