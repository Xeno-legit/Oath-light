//! core/src/matching.rs — function-for-function Rust port of the
//! hostname-level keyword engine in `extension/bg/matching.js` (plan A.2):
//! the whitelist-domain check, leetspeak/confusable folding, the hand-rolled
//! punycode decoder, and `checkDomainKeywords` itself. Everything else in
//! matching.js (full-URL `shouldBlockUrl`, search-query filtering, SafeSearch,
//! graylist paths) is extension-only and stays there — see the plan's A.2
//! scope note. Ported verbatim: same stems, same iteration order, same guard
//! logic, same early returns. Any future stem/whitelist edit MUST land in
//! `extension/bg/matching.js` AND here, pinned by a fixture case in
//! `extension/tests/fixtures/keyword-hostnames.json` (consumed by both).
//!
//! A note on string indexing: JavaScript strings index by UTF-16 code unit;
//! Rust `&str` indexes by UTF-8 byte. Every stem/root/whitelist-word table
//! below is pure ASCII, so a substring search for one of them can never land
//! on/inside a multi-byte UTF-8 continuation byte — ASCII bytes never appear
//! as part of a multi-byte encoding. That means byte-offset containment
//! checks (`isCoveredByWhitelist`'s "is this occurrence fully inside that
//! occurrence" test) give identical true/false answers to the JS UTF-16
//! version: containment between two substrings of the same parent string is
//! preserved under any order-preserving reindexing of the parent (char index
//! -> byte index is one), so the actual numeric offsets never need to match
//! JS's, only the relative order — which they do. IDN-decoded / native-script
//! text (all outside the BMP-vs-astral edge cases this project's stems ever
//! touch) is handled the same way: matched only via whole-string `contains`,
//! never index arithmetic, except inside `isCoveredByWhitelist`/root-finding,
//! which is exactly the ASCII-only case just justified.

use std::collections::HashMap;
use std::sync::OnceLock;

// ============================================================================
// WHITELIST — domains never blocked outright (mirrors bg/matching.js's
// WHITELIST_DOMAINS + the STEP 2 exact-or-subdomain check in shouldBlockUrl).
// ============================================================================

pub const WHITELIST_DOMAINS: &[&str] = &[
    // Search engines & AI
    "google.com",
    "bing.com",
    "duckduckgo.com",
    "yahoo.com",
    "gemini.google.com",
    "bard.google.com",
    "openai.com",
    "anthropic.com",
    "claude.ai",
    "chatgpt.com",
    // Development & Tech
    "github.com",
    "gitlab.com",
    "stackoverflow.com",
    "stackexchange.com",
    "microsoft.com",
    "apple.com",
    "developer.mozilla.org",
    "npmjs.com",
    "pypi.org",
    "crates.io",
    "hub.docker.com",
    "vercel.com",
    "netlify.com",
    "heroku.com",
    "aws.amazon.com",
    "cloud.google.com",
    "azure.microsoft.com",
    "bitbucket.org",
    "codepen.io",
    "replit.com",
    "figma.com",
    // Cloud & Productivity
    "notion.so",
    "camscanner.com",
    "docufiler.com",
    "sem-scanner.co.uk",
    "cambridgemanufacturing.com",
    "docs.google.com",
    "drive.google.com",
    "dropbox.com",
    "onedrive.live.com",
    "office.com",
    "slack.com",
    "zoom.us",
    "teams.microsoft.com",
    // Social Media (mainstream safe)
    "linkedin.com",
    // Education & Reference
    "wikipedia.org",
    "wikihow.com",
    "khanacademy.org",
    "coursera.org",
    "udemy.com",
    "edx.org",
    "mit.edu",
    "stanford.edu",
    "harvard.edu",
    "metrostate.edu",
    "ohiochristian.edu",
    "specialconnections.ku.edu",
    "frazer.rice.edu",
    "ieltsmarkcambridge.com",
    "w3schools.com",
    "freecodecamp.org",
    "codecademy.com",
    "brilliant.org",
    "merriam-webster.com",
    "dictionary.com",
    "wolframalpha.com",
    "quora.com",
    // E-commerce
    "amazon.com",
    "ebay.com",
    "walmart.com",
    "target.com",
    // News & Media
    "bbc.com",
    "cnn.com",
    "nytimes.com",
    "theguardian.com",
    "reuters.com",
    "washingtonpost.com",
    "wsj.com",
    "apnews.com",
    "aljazeera.com",
    "forbes.com",
    "techcrunch.com",
    "arstechnica.com",
    "theverge.com",
    "wired.com",
    "norwichcyclingcampaign.org",
    "thecambridgepestcontrolcompany.co.uk",
    // Banking & Finance
    "paypal.com",
    "stripe.com",
    "chase.com",
    "bankofamerica.com",
    // Health
    "webmd.com",
    "mayoclinic.org",
    "nih.gov",
    "who.int",
    // Government
    "nasa.gov",
    "irs.gov",
    "djj.nsw.gov.au",
    "primature.gov.gn",
    // Entertainment (safe) — youtube.com/youtu.be/spotify.com deliberately
    // excluded (see matching.js's note): they route through the normal
    // pipeline instead of an all-content-trusting whitelist entry.
    "netflix.com",
    "hulu.com",
    "disneyplus.com",
    "crunchyroll.com",
    "store.steampowered.com",
    "epicgames.com",
];

/// Exact match or subdomain of an entry in `WHITELIST_DOMAINS`, mirroring
/// `shouldBlockUrl` STEP 2's `hostname === d || hostname.endsWith('.' + d)`.
pub fn is_whitelisted_domain(host: &str) -> bool {
    WHITELIST_DOMAINS.iter().copied().any(|d| {
        host == d || (host.len() > d.len() && host.ends_with(d) && host.as_bytes()[host.len() - d.len() - 1] == b'.')
    })
}

// ============================================================================
// DOMAIN-NAME KEYWORD LAYER (mirrors matching.js's "DOMAIN-NAME KEYWORD LAYER"
// section). Catches porn domains that aren't on the exact blocklist (e.g.
// sex4arabs.com) WITHOUT Scunthorpe false positives:
//   - Stems match ONLY against the hostname — never paths/queries/content.
//   - Strong, unambiguous stems match as a substring anywhere.
//   - Collision-heavy 3-letter roots (cum/ass/tit/pussy) are NEVER matched
//     bare — only inside explicit porn compounds.
//   - Guarded roots (sex/anal/cock/dick/rape/cunt/milf/...) match as a
//     substring but are excused when the match sits inside a whitelisted
//     real word (essex, analytics, peacock, dickens, grape, scunthorpe,
//     milford, ...).
//   - Leetspeak (p0rn, s3x) is normalized before matching.
// Deterministic — a host either contains an unexcused stem or it doesn't.
// ============================================================================

pub const ADULT_TLDS: &[&str] = &[".xxx", ".porn", ".adult", ".sex", ".sexy"];

// Tier A — long / unambiguous. Substring match anywhere in the hostname.
pub const KEYWORD_STEMS_STRONG: &[&str] = &[
    "porn", "pornhub", "xvideos", "xvideo", "xnxx", "xhamster", "redtube", "youporn",
    "spankbang", "brazzers", "bangbros", "hentai", "doujin", "doujinshi", "rule34",
    "nsfw", "bukkake", "blowjob", "handjob", "rimjob", "cumshot", "creampie", "gangbang",
    "deepthroat", "fellatio", "cunnilingus", "masturbat", "dildo", "fleshlight",
    "onlyfans", "chaturbate", "livejasmin", "bongacams", "stripchat", "myfreecams",
    "camsoda", "futanari", "ahegao", "lolicon", "shotacon", "shemale", "cuckold",
    "femdom", "fisting", "jailbait", "bestiality", "camgirl", "camwhore",
    "titties", "boobies", "sexcam", "sexvideo", "sextape", "escortservice",
    // Spanish
    "follar", "mamada", "mamadas", "chupapollas", "desnuda", "desnudas", "tetas",
    "tetona", "tetonas", "partuza", "putita", "putitas", "putilla", "putillas",
    // French
    "branlette", "partouze", "godemichet", "suceuse", "avaleuse", "lesbienne",
    "dominatrice", "nichons",
    // German
    "ficken", "huren", "nutten", "schlampe", "schlampen", "muschi",
    "muschis", "fotze", "fotzen", "schwanz", "pimmel", "arschloch",
    "arschfick", "wichser", "wichsen", "abspritzen", "flittchen",
    // Portuguese
    "caralho", "boceta", "xereca", "bunduda", "punheta", "esporra",
    "cornudo",
    // Arabic (Arabizi)
    "sharmota", "sharmoota", "sharamit", "sharmotat", "qahba", "qahbat", "qa7ba",
    "neekat", "naykeen", "naykah", "zboub", "manyakeh", "manayeek", "dayoos",
    "dayooth", "niswanji", "fadiha", "fadi7a", "bzaz", "bzooz", "so7aq",
    "mamhoun", "mamhouna", "da3ara", "metnak", "mitnaka", "labwa",
    // Russian (translit)
    "porevo", "pizda", "shluha", "shluhi", "shalava", "shalavy", "prostitutka",
    "prostitutki", "eblya", "telki", "drochila", "zhopa",
    "popka", "popochka", "trahatsya", "minetchik", "gruppovuha", "lesbiyanki",
    // Chinese (pinyin; most ZH terms excluded as surnames/places)
    "caonima", "koujiao", "seqing",
    // Turkish
    "orospu", "orospular", "kaltak", "sikis", "sikerim", "masturbasyon",
    "lezbiyen", "otuzbir", "bosalma", "yarragi",
    // Japanese (romaji)
    "oppai", "paizuri", "omanko", "chinpo", "onani", "senzuri",
    "manzuri", "sukebe", "jukujo", "kyonyu", "ferachi", "hamedori", "deriheru",
    "netorare", "nakadashi", "gokkun", "tekoki", "ecchi",
    // Hindi/Hinglish
    "chudai", "chudu", "chudakkad", "choot", "gaand",
    // Italian
    "cazzo", "cazzi", "bagascia", "chiavare", "fottere", "bocchino",
    "pompino", "pompini", "sborra", "arrapato", "arrapata", "lesbica", "lesbiche",
    "frocio", "puttana", "fighe",
    // Dutch
    "neuken", "neuker", "hoeren", "kutten", "aftrekken", "pijpen",
    "lesbisch",
    // Polish
    "cipka", "chuj", "fiut", "jebac", "jebie", "dupy", "dziwka", "dziwki",
    "kurwa", "kurwy", "cycki", "cycek", "ruchac", "ciota", "wytrysk", "lesbijka",
    "lesbijki",
    // Korean (romanized)
    "shibal", "eongdeongi", "gaseumgol", "changnyo", "geolre",
    "rejeubieon",
    // Indonesian
    "bokep", "ngentot", "memek", "kontol", "titit", "colmek",
    "jablay", "lonte", "bugil", "toket", "bokong", "nyepong",
    "mengisap",
    // Vietnamese
    "thudam", "quaytay", "clipnong", "loanluan", "xuattinh", "khoathan", "gaixinh",
    // Greek (Greeklish)
    "poutsos", "poutsa", "gamisi", "vyzia", "tsoula", "arxidia", "malakies",
    "tsimpouki", "xysimo", "pousti",
    // Romanian
    "futut", "pizde", "labagiu", "poponar", "lesbiene", "dezbracat",
    // Bengali
    "khanki",
    // Scandinavian (SE/NO/DK)
    "fitta", "fittor", "fisse", "fisser", "kusse", "kusser", "knulla", "knulle",
    "kneppe", "knepper", "horor", "slampa", "slampor", "tuttar",
    "liderlig", "lesbisk",
    // Czech
    "mrdat", "mrdka", "mrdal", "kokot", "curak", "kurva", "devka", "prdel", "prcat",
    // Hungarian
    "szex", "baszni", "baszas", "fasz", "fasza", "faszfej", "kurvak",
    "gecik", "picsak", "csocs", "szopo", "szopni",
    // Tagalog
    "kantot", "kantutan", "iyot", "inyot", "pekpek", "jakol", "salsal", "libog",
    "malibog", "chupain",
    // Persian
    "jende", "jendeh", "gaeedam", "gaidam", "mameh", "sakzadan",
    // Ukrainian
    "shluhy", "yebaty",
    // Finnish
    "pillut", "kyrpa", "nussia", "bylsia", "huora", "tissit",
    "runkkari", "alaston", "alastonkuvat",
    // Hebrew
    "hizdayen", "shadayim",
    // Tamil / Telugu
    "pundai", "pundae", "koodhi", "koothi", "soothu", "mulaigal", "thayoli",
    "sallalu", "lanjalu",
    // Malay
    "lancap", "melancap", "tetek", "kongkek", "enjut", "sontot", "pelacur",
    // Punjabi
    "phudi", "chudva", "kanjar", "kanjri", "tattay", "chupo",
    "chupan",
    // Urdu
    "ghasti",
    // Swahili
    "mboro", "matako", "kunyandua", "nyandu", "kusagana", "punyeto", "mkundu",
    // Afrikaans
    "naaier", "naaifliek", "fokken",
    // Serbo-Croatian
    "jebanje", "jebati", "jebac", "kurac", "guzic", "drkanje", "drkat", "drolja",
    "drolje", "svrsavanje", "pusenje", "picajzla",
    // Bulgarian
    "pichka", "pichki", "guzove", "tsici", "kurvi", "shlaha", "shliha",
    // Slovak
    "jebanie", "kundy", "kokoty", "kurvy", "cecky", "vyfajcit",
    // Malayalam / Kannada
    "pooru", "thullu", "kazhappu",
    // Marathi
    "zhavne", "zhavadi", "zhavnya", "zhavade", "pucchi", "bochi", "lavda",
    "madarzat",
    // Anime / 3D / CGI
    "yiff", "eroguro", "waifu", "monstergirl", "hmanhua", "bdcul", "denpasoft",
    "mangagamer", "jastusa", "kaguragames", "filtfap", "fapnation", "fapgames",
    "tsumino", "pururin", "hanime", "erocosplay", "shadbase", "paheal", "koikatsu",
    "koikatu", "honeyselect", "aishoujo", "sankakucomplex", "derpibooru", "e621",
    // Fetish / leak / subculture slang
    "scalie", "murrsuit", "goonette", "paypig", "cashslave", "gloryhole",
    "femboy", "sissification", "gimpsuit", "necrophilia", "footfetish", "footjob",
    "shibari", "kinbaku", "cuckquean", "hotwife", "tribbing", "cfnm", "cmnf",
    "fapello", "bunkr", "simpcity", "ofleaks", "fansly", "cyberdrop", "bdsm",
    "gonewildaudio", "eraudica", "soundgasm",
    // Adult games / mods
    "jennymod", "elliemod", "wickedwhims", "summertimesaga", "beingadik",
    "robloxcondo", "rbxcondo", "condogames", "gachaheat", "sentrucondo", "nutaku",
    "dlsite", "fanza", "virtamate",
    // AI / deepfake
    "civitai", "deepnude", "undressai", "undressher", "clothoff", "nudify",
    "nudifier", "deepfake", "dezgo", "soulgen", "promptchan", "unstablediffusion",
    "spicychat", "janitorai", "crushonai", "dreamgf", "sillytavern", "lovense",
    "kiiroo", "autoblow", "sxyprn", "efukt", "venusai",
];

// Explicit porn COMPOUNDS — the collision-heavy roots (cum/ass/tit/pussy/
// cock/dick) match only inside an unambiguous context, plus the AI-erotica
// compounds (plan 3.3: the aigirlfriend/nsfwgpt family) which matching.js
// `.push()`es into the same runtime array. Kept merged here to match the JS
// array's final runtime contents exactly.
pub const KEYWORD_COMPOUNDS: &[&str] = &[
    "cumslut", "cumdump", "cumtribute", "cumpilation",
    "asshole", "assfuck", "assfucking", "asslick", "assporn",
    "bigtits", "hugetits", "nicetits", "titfuck", "titjob", "saggytits",
    "wetpussy", "tightpussy", "pussyfuck", "pussylick", "eatpussy",
    "bigcock", "suckcock", "cocksucker", "cocksucking", "monstercock", "horsecock",
    "hugecock", "thickcock", "cockslut", "cockwhore", "cockhungry", "gaycock", "cockpic",
    "bigdick", "suckdick", "dickpic", "dickslut", "dicksucking", "dickriding", "smalldick",
    "analsex", "analporn", "analcreampie",
    // AI-erotica compounds (plan 3.3) — see KEYWORD_COMPOUNDS_AI_EROTICA below
    // for the standalone list; both word orders plus the virtual* variants.
    "aigirlfriend", "girlfriendai", "virtualgirlfriend",
    "aiboyfriend", "boyfriendai", "virtualboyfriend",
    "nsfwai", "ainsfw", "nsfwgpt", "gptnsfw",
    "hentaiai", "aihentai",
    "aiwaifu", "waifuai",
    "lewdai", "nudeai", "ainude",
];

/// The AI-erotica compound subset of `KEYWORD_COMPOUNDS` (plan 3.3), exposed
/// standalone for callers/tests that want to reference just this family (e.g.
/// future data-driven additions) without re-deriving it from the merged list.
pub const KEYWORD_COMPOUNDS_AI_EROTICA: &[&str] = &[
    "aigirlfriend", "girlfriendai", "virtualgirlfriend",
    "aiboyfriend", "boyfriendai", "virtualboyfriend",
    "nsfwai", "ainsfw", "nsfwgpt", "gptnsfw",
    "hentaiai", "aihentai",
    "aiwaifu", "waifuai",
    "lewdai", "nudeai", "ainude",
];

// Guarded roots — substring match, but excused by whitelist coverage. cock &
// dick are NOT here (see KEYWORD_COMPOUNDS) — as bare roots they collide with
// ~190 real words (blackcock, woodcock, Moby-Dick, Dickens, ...).
pub const KEYWORD_ROOTS_GUARDED: &[&str] = &[
    "sex", "anal", "rape", "cunt", "milf",
    // multi-language ambiguous roots (whitelist-guarded below):
    "seks", "puta", "pute", "randi", "chut", "chod", "salope",
    "sesso", "figa", "puttane", "hoer", "dupa", "sperma", "curva", "malakia", "chikan",
    "porr", "kunda", "picsa", "dengu", "poes", "picka", "ebane", "ebati", "tissi",
    "findom", "coomer",
    // demoted from KEYWORD_STEMS_STRONG — too collision-prone to match bare;
    // whitelist-guarded (traps in KEYWORD_WHITELIST_WORDS):
    "luder", "rumpa", "titten", "kulli",
    "pillu", "gooning", "zoophil",
    "bocha",
    // AI-erotica (plan 3.3): every "-ai"-final word + "companion" contains
    // this, so it can't be a zero-escape compound like the aigirlfriend/
    // nsfwgpt family — it needs the whitelist-escape machinery.
    "aicompanion",
];

// Whitelist of real words that legitimately contain a guarded root. A guarded
// root is ignored when its occurrence sits fully inside one of these.
pub const KEYWORD_WHITELIST_WORDS: &[&str] = &[
    // sex
    "sexual", "sexuality", "sexualis", "sexualize", "sexualise", "sexology",
    "sexologist", "sexagenarian", "sexagesimal", "sexpartite", "sextant", "sextet",
    "sextett", "sextuple", "sextuplet", "sexton", "sexism", "sexist", "unisex",
    "intersex", "samesex", "sexed", "sexeducation", "essex", "sussex", "middlesex",
    "wessex", "transsexual", "homosexual", "heterosexual", "bisexual", "asexual",
    "pansexual", "demisexual",
    // anal
    "analysis", "analytic", "analytics", "analyst", "analytical", "analyze", "analyse",
    "analyzer", "analyser", "analyzed", "analysed", "analyzing", "analysing", "analog",
    "analogue", "analogy", "analogous", "analemma", "analgesic", "analgesia", "canal",
    "canals", "banal", "banality",
    // cock
    "peacock", "cocktail", "cockpit", "cockroach", "cockney", "hancock", "hitchcock",
    "babcock", "woodcock", "shuttlecock", "gamecock", "stopcock", "weathercock",
    "cockle", "cockerel", "cockatoo", "cockade", "cocker", "cockburn", "cockfosters",
    "cocksure", "petcock", "haycock",
    // dick
    "dickens", "dickinson", "dickson", "dicker", "dickey", "dicky", "benedick",
    // rape
    "grape", "grapes", "grapefruit", "grapevine", "drape", "drapes", "drapery", "draped",
    "scrape", "scraped", "scraper", "scraping", "trapeze", "therapeutic", "therapeutics",
    "rapeseed",
    // cunt
    "scunthorpe",
    // milf
    "milford", "milfoil", "milfont",
    // cum / ass / tit / pussy — these roots are compound-only (never matched
    // bare), so the following are belt-and-suspenders / future-proofing.
    "cumulative", "accumulate", "accumulation", "document", "documentary",
    "documentation", "circumstance", "circumstances", "circumvent", "cucumber", "scum",
    "cumin", "incumbent", "cumberland", "cumbersome", "encumber",
    "class", "classic", "classical", "classroom", "mass", "massive", "massachusetts",
    "passage", "password", "embassy", "ambassador", "assassin", "assault", "assemble",
    "assembly", "assess", "assessment", "asset", "assets", "assign", "assignment",
    "assist", "assistant", "associate", "association", "glass", "grass", "brass", "bass",
    "harass", "harassment", "bypass", "compass", "canvass", "molasses", "potassium",
    "title", "titles", "titan", "titanic", "titanium", "competitive", "constitution",
    "substitute", "institute", "petition", "repetition", "latitude", "altitude",
    "attitude", "gratitude", "multitude", "titration",
    "pussycat", "pussyfoot", "pussywillow", "octopus", "platypus", "opus",
    // Multi-language false-positive traps (Batch 1)
    "seksen", "seksenler", "seksiyon",
    "reputa", "computa", "amputa", "disputa", "imputa", "deputa", "putativ", "diputa",
    "compute", "dispute", "repute", "impute", "depute", "amputee",
    "grandi", "brandi", "randint",
    "parachut", "chutney", "chutzpah", "chute",
    "salopett", "escalope",
    "chodron", "chodorov",
    "caoliu", "macaoliu", "haose", "selang", "selangor", "yadong", "sneek",
    "design", "desire", "savita", "bhabhi", "java", "javelin", "heteroge",
    "erogen", "figaro", "possesso", "chikan", "lund", "manko", "mankato",
    "spermat", "spiegel", "marsch", "amsterdam", "huanghe", "citizen", "avatar",
    "sikhism", "nutter", "trafficker", "lauda", "boquete", "gostosa", "corrida",
    // Batch 2 traps
    "possesso",
    "puttanesca",
    "hoera",
    "dupage", "dupatta",
    "spermat", "spermac",
    "curvatur", "curvace",
    "malakian",
    "chikankari",
    "chodavaram", "chodankar",
    "seksualn", "seksuolog", "seksizm",
    // Batch 3 traps
    "porridge",
    "kundalini",
    "picsart",
    "dengue",
    "poesia", "poesie",
    "pickax", "pickard",
    "lebanese",
    "debati", "rebati",
    "patissier",
    // Batch 4 traps
    "thoth",
    "findomestic",
    "coomera",
    // Adversarial-corpus traps
    "trapez", "serape", "crape",
    "cockatiel", "cockaigne", "cockcroft",
    "alcock", "glasscock",
    "mobydick", "dickory",
    "sexsmith", "sexey",
    "mirandi",
    "incurva",
    "kanal", "manali", "panal", "bacchanal",
    "kundera", "mukunda", "kundan",
    "putamen", "saputar",
    "pickap", "pickab",
    "poesy",
    "cluder", "eluder", "lluder",
    "trumpa",
    "tittensor",
    "skulli",
    // Wordlist-audit traps
    "bissext", "desex", "sextil", "sexto", "sextain", "sextan",
    "analci", "analect", "analept", "analphabet", "analav",
    "traper", "parape", "broomrape", "igarape", "frape",
    "prandi", "operandi", "jaborandi", "randit", "randia", "farandi",
    "sessor",
    "nonani",
    "bochar",
    "tissim",
    "ychod", "nchod", "ichod",
    "curvat", "curvac", "recurva", "excurva", "decurva", "procurva", "transcurva",
    "ospermae", "spermaduct", "spermary", "spermaphyt",
    "laputa", "putamin", "putati", "sputa", "supputa",
    "hoopoes", "poesis", "poesil",
    "pillus", "pillula",
    "secchi", "zecchi", "becchi", "specchi", "orecchi", "libecchi",
    "chutist", "catechut",
    "pickaroon", "pickadil", "pickage",
    "dupab",
    "figary", "rufiga",
    "puteal", "puteli", "cajuputene",
    "sebane",
    "bakunda", "burkunda",
    "fittab", "fittag",
    "omalakia",
    "dragooning",
    "zoophilou", "zoophily",
    // aicompanion → "-ai"-final word + companion: bonsai/samurai/acai
    // companion apps (gardening guides, game-guide sites, nutrition). NB
    // deliberately NOT excusing thai/dubai + companion — "companion" in
    // those geo pairings is escort vocabulary, exactly what the root is for.
    "bonsaicompanion", "samuraicompanion", "acaicompanion",
];

/// Pre-indexed whitelist words per guarded root (perf + clarity — mirrors
/// matching.js's `WHITELIST_BY_ROOT`). Built once, on first use.
fn whitelist_by_root() -> &'static HashMap<&'static str, Vec<&'static str>> {
    static INDEX: OnceLock<HashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut m = HashMap::new();
        for root in KEYWORD_ROOTS_GUARDED.iter().copied() {
            let words: Vec<&'static str> =
                KEYWORD_WHITELIST_WORDS.iter().copied().filter(|w| w.contains(root)).collect();
            m.insert(root, words);
        }
        m
    })
}

// ============================================================================
// Leetspeak + confusable (homoglyph) folding
// ============================================================================

/// Leetspeak normalization — conservative map, applied before matching.
/// Operates on `char`s (Unicode scalar values), not JS's UTF-16 code units;
/// since every mapped character is ASCII, this produces byte-identical output
/// to the JS per-code-unit loop for any input this project ever normalizes
/// (any BMP or astral character not in the map passes through unchanged in
/// both implementations).
pub fn normalize_leet(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        out.push(leet_char(ch).unwrap_or(ch));
    }
    out
}

fn leet_char(ch: char) -> Option<char> {
    Some(match ch {
        '0' => 'o',
        '1' => 'i',
        '3' => 'e',
        '4' => 'a',
        '5' => 's',
        '7' => 't',
        '@' => 'a',
        '$' => 's',
        _ => return None,
    })
}

/// Homoglyph / confusable folding — maps non-Latin lookalikes to their Latin
/// twin so a spoofed host (pоrn.com with a Cyrillic о) folds back to "porn".
/// HIGH-CONFIDENCE visual confusables only. The folded form is checked
/// against the STRONG stems + compounds ONLY (never the short guarded roots)
/// by `check_domain_keywords` — see the CONFUSABLE_MAP note in matching.js:
/// a legit native-script word that happens to fold into a 3-4 letter root
/// can't create a false positive.
pub fn fold_confusables(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if let Some(mapped) = confusable_char(ch) {
            out.push(mapped);
            continue;
        }
        let cp = ch as u32;
        // Fullwidth Latin/digits (U+FF01-U+FF5E) -> ASCII.
        if (0xFF01..=0xFF5E).contains(&cp) {
            out.push(char::from_u32(cp - 0xFEE0).unwrap_or(ch));
        } else {
            out.push(ch);
        }
    }
    out
}

fn confusable_char(ch: char) -> Option<char> {
    Some(match ch {
        // Cyrillic -> Latin
        'а' => 'a', 'е' => 'e', 'ё' => 'e', 'о' => 'o', 'р' => 'p', 'с' => 'c',
        'х' => 'x', 'у' => 'y', 'і' => 'i', 'ј' => 'j', 'ѕ' => 's', 'к' => 'k',
        'м' => 'm', 'н' => 'h', 'т' => 't',
        // Greek -> Latin
        'ο' => 'o', 'ρ' => 'p', 'α' => 'a', 'ε' => 'e', 'ι' => 'i', 'κ' => 'k',
        'τ' => 't', 'χ' => 'x',
        // Coptic -> Latin
        'ⲟ' => 'o', 'ⲣ' => 'p', 'ⲭ' => 'x',
        _ => return None,
    })
}

/// Is the guarded-root occurrence at byte range `[idx, idx+len)` fully inside
/// one of `words`' occurrences in `host`? See the module doc for why plain
/// byte offsets are safe here despite `host` sometimes containing non-ASCII
/// text (root/words are always ASCII).
fn is_covered_by_whitelist(host: &str, idx: usize, len: usize, words: &[&str]) -> bool {
    for w in words.iter().copied() {
        let mut from = 0usize;
        while let Some(rel) = host[from..].find(w) {
            let w_idx = from + rel;
            if w_idx <= idx && w_idx + w.len() >= idx + len {
                return true;
            }
            from = w_idx + 1;
        }
    }
    false
}

/// Find the first unexcused occurrence of `root` in `host`, or `None` if
/// every occurrence is covered by a whitelist word. Mirrors the
/// `while ((idx = host.indexOf(root, from)) !== -1)` loop in
/// `checkDomainKeywords`.
fn find_unexcused_root(host: &str, root: &str, words: &[&str]) -> bool {
    let mut from = 0usize;
    while let Some(rel) = host[from..].find(root) {
        let idx = from + rel;
        if !is_covered_by_whitelist(host, idx, root.len(), words) {
            return true;
        }
        from = idx + 1;
    }
    false
}

// ============================================================================
// Native-script IDN support — punycode decode + native-script stems
// ============================================================================

const PUNY_BASE: u32 = 36;
const PUNY_TMIN: u32 = 1;
const PUNY_TMAX: u32 = 26;
const PUNY_SKEW: u32 = 38;
const PUNY_DAMP: u32 = 700;

/// `None` only on arithmetic overflow from a pathological `delta` (see the
/// overflow note on `punycode_decode`) — every legitimate/realistic input
/// stays well within `u32` and always returns `Some`.
fn puny_adapt(delta: u32, num_points: u32, first_time: bool) -> Option<u32> {
    let mut delta = if first_time { delta / PUNY_DAMP } else { delta >> 1 };
    delta = delta.checked_add(delta / num_points)?;
    let mut k: u32 = 0;
    let limit = ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1;
    while delta > limit {
        delta /= PUNY_BASE - PUNY_TMIN;
        k = k.checked_add(PUNY_BASE)?;
    }
    // By this point `delta <= limit` (455), so `36 * delta` (<=16380) plus
    // `k` (bounded by the handful of halvings above) can't overflow.
    Some(k + (PUNY_BASE - PUNY_TMIN + 1) * delta / (delta + PUNY_SKEW))
}

fn puny_digit(cp: u32) -> u32 {
    if (48..58).contains(&cp) {
        return cp - 22; // '0'-'9' -> 26-35
    }
    if (65..91).contains(&cp) {
        return cp - 65; // 'A'-'Z' -> 0-25
    }
    if (97..123).contains(&cp) {
        return cp - 97; // 'a'-'z' -> 0-25
    }
    PUNY_BASE
}

/// Hand-rolled punycode decoder (RFC 3492), ported from matching.js's
/// `punycodeDecode`. Operates on UTF-16 code units (via `encode_utf16`) to
/// mirror the JS implementation's `charCodeAt` indexing exactly, including
/// its behavior on malformed input: an astral or otherwise invalid "digit"
/// character decodes to a code-unit value >= `PUNY_BASE`, which correctly
/// fails the `digit >= PUNY_BASE` check below and returns `None` — matching
/// the JS `return null`.
///
/// Never panics on hostile input: JS numbers are f64 and simply keep growing
/// (however implausibly) without erroring, eventually bailing out at the
/// final `String.fromCodePoint` (caught by the JS `try`). Rust `u32` would
/// instead panic on overflow in a debug/test build for a pathological label
/// (e.g. many repeated high-value "digit" characters in a row with no
/// terminating low digit) — so every arithmetic op that JS would let run
/// unbounded uses `checked_*` here and bails to `None` on overflow, which is
/// strictly safe: `idn_to_unicode` already treats a failed decode as "keep
/// the raw label", the same fallback a `null` return gets in JS.
pub fn punycode_decode(input: &str) -> Option<String> {
    let units: Vec<u16> = input.encode_utf16().collect();
    let mut output: Vec<u32> = Vec::new();
    let mut n: u32 = 128;
    let mut i: u32 = 0;
    let mut bias: u32 = 72;

    let hyphen = units.iter().rposition(|&c| c == b'-' as u16);
    let basic = hyphen.unwrap_or(0);

    for &u in &units[0..basic] {
        let c = u as u32;
        if c >= 128 {
            return None;
        }
        output.push(c);
    }

    let mut index: usize = if basic > 0 { basic + 1 } else { 0 };
    while index < units.len() {
        let old_i = i;
        let mut w: u32 = 1;
        let mut k: u32 = PUNY_BASE;
        loop {
            if index >= units.len() {
                return None;
            }
            let digit = puny_digit(units[index] as u32);
            index += 1;
            if digit >= PUNY_BASE {
                return None;
            }
            i = i.checked_add(digit.checked_mul(w)?)?;
            let t = if k <= bias {
                PUNY_TMIN
            } else if k >= bias + PUNY_TMAX {
                PUNY_TMAX
            } else {
                k - bias
            };
            if digit < t {
                break;
            }
            w = w.checked_mul(PUNY_BASE - t)?;
            k = k.checked_add(PUNY_BASE)?;
        }
        let out_len = (output.len() + 1) as u32;
        bias = puny_adapt(i.checked_sub(old_i)?, out_len, old_i == 0)?;
        n = n.checked_add(i / out_len)?;
        i %= out_len;
        // A pathological label could in principle decode to more output
        // code points than fit in memory/addressable index space long
        // before this matters for a real hostname (max 63 chars/label); the
        // `as usize` here is infallible on any platform this ships on.
        output.insert(i as usize, n);
        i = i.checked_add(1)?;
    }

    let mut s = String::with_capacity(output.len());
    for cp in output {
        match char::from_u32(cp) {
            Some(c) => s.push(c),
            None => return None,
        }
    }
    Some(s)
}

/// Decode every `xn--`-prefixed label of `hostname` to Unicode; labels that
/// aren't ACE-prefixed, or that fail to decode, pass through unchanged.
/// Mirrors matching.js's `idnToUnicode`.
pub fn idn_to_unicode(hostname: &str) -> String {
    hostname
        .split('.')
        .map(|label| match label.strip_prefix("xn--") {
            Some(rest) => punycode_decode(rest).unwrap_or_else(|| label.to_string()),
            None => label.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

// Native-script NSFW stems (Batch 5) — only multi-codepoint / unambiguous
// terms; single common chars (色 colour, 性 nature, نم milk, کس short) are
// excluded per matching.js's note.
const NATIVE_STEMS: &[&str] = &[
    // Arabic / Persian (Perso-Arabic script)
    "سكس", "بورن", "نيك", "قحبة", "شرموطة", "دعارة", "عاهرة",
    "سکس", "پورن", "کیر", "جنده",
    // Cyrillic (RU / UK / BG)
    "секс", "порно", "порево", "порнуха", "пизда", "шлюха", "шлюхи", "ебать",
    "ебля", "сиськи", "минет", "сперма", "хуй", "жопа",
    // Chinese
    "色情", "做爱", "性爱", "肛交", "口交", "鸡巴", "巨乳", "裸体", "偷拍",
    "婊子", "淫荡", "操逼", "黄色电影", "成人电影",
    // Japanese (kana / kanji)
    "変態", "おっぱい", "まんこ", "ちんこ", "オナニー", "ぶっかけ", "ふたなり",
    "痴漢", "フェラ", "中出し", "手コキ", "ゴックン", "エッチ", "熟女",
    // Korean (Hangul)
    "섹스", "포르노", "야동", "보지", "자지", "자위", "강간", "창녀", "걸레", "펠라",
    // Thai
    "เย็ด", "ควย", "เซ็กส์", "โสเภณี",
    // Hebrew
    "סקס", "פורנו", "זין", "זונה",
    // Greek
    "μουνί", "πούτσος", "κώλος", "μαλακία", "γαμήσι",
    // Bengali
    "সেক্স", "চোদা", "গুদ", "খানকি",
];

// ============================================================================
// Core check
// ============================================================================

/// A positive keyword-layer hit, carrying the matched stem/root/TLD/native
/// stem — mirrors matching.js's `{ hit: true, match: "..." }`. `None` from
/// `check_domain_keywords` is the `{ hit: false }` case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeywordHit {
    pub matched: String,
}

impl KeywordHit {
    fn new(matched: &str) -> Self {
        KeywordHit { matched: matched.to_string() }
    }
}

/// Hostname-only keyword layer. Returns `Some(KeywordHit)` if `hostname`
/// contains an unexcused NSFW stem/compound/guarded-root/adult-TLD/native
/// stem, else `None`. Ported control-flow-for-control-flow from matching.js's
/// `checkDomainKeywords` — same order: native stems, then strong-stem/TLD/
/// compound/guarded-root pass over [host, leet(host)], then (non-ASCII hosts
/// only) a second pass over the confusable-folded form against strong
/// stems/compounds only (never guarded roots — see the module doc).
pub fn check_domain_keywords(hostname: &str) -> Option<KeywordHit> {
    // Decode IDN punycode once; match everything against the Unicode form so
    // a benign ACE string (xn--...) can't coincidentally hit a Latin stem.
    let host0 = if hostname.contains("xn--") { idn_to_unicode(hostname) } else { hostname.to_string() };
    let has_non_ascii = !host0.is_ascii();

    if has_non_ascii {
        for stem in NATIVE_STEMS.iter().copied() {
            if host0.contains(stem) {
                return Some(KeywordHit::new(stem));
            }
        }
    }

    let leet0 = normalize_leet(&host0);
    let variants: Vec<&str> = if leet0 != host0 { vec![host0.as_str(), leet0.as_str()] } else { vec![host0.as_str()] };
    let by_root = whitelist_by_root();

    // Consumes `variants` (moves the Vec<&str> rather than borrowing it) so
    // the loop binds plain `&str` items directly — borrowing via `&variants`
    // would yield the classic Rust double-reference (`&&str`), which doesn't
    // satisfy the `Pattern` bound `contains`/`ends_with` need below.
    for host in variants {
        for tld in ADULT_TLDS.iter().copied() {
            if host.ends_with(tld) {
                return Some(KeywordHit::new(tld));
            }
        }
        for stem in KEYWORD_STEMS_STRONG.iter().copied() {
            if host.contains(stem) {
                return Some(KeywordHit::new(stem));
            }
        }
        for c in KEYWORD_COMPOUNDS.iter().copied() {
            if host.contains(c) {
                return Some(KeywordHit::new(c));
            }
        }
        for root in KEYWORD_ROOTS_GUARDED.iter().copied() {
            let words = by_root.get(root).map(Vec::as_slice).unwrap_or(&[]);
            if find_unexcused_root(host, root, words) {
                return Some(KeywordHit::new(root));
            }
        }
    }

    // Homoglyph spoof pass — only when the host has non-ASCII. Fold
    // confusables to Latin and re-check STRONG stems + compounds ONLY
    // (deliberately NOT the short guarded roots).
    if has_non_ascii {
        let folded = fold_confusables(&host0);
        if folded != host0 {
            let fleet = normalize_leet(&folded);
            let fvariants: Vec<&str> =
                if fleet != folded { vec![folded.as_str(), fleet.as_str()] } else { vec![folded.as_str()] };
            for host in fvariants {
                for tld in ADULT_TLDS.iter().copied() {
                    if host.ends_with(tld) {
                        return Some(KeywordHit::new(tld));
                    }
                }
                for stem in KEYWORD_STEMS_STRONG.iter().copied() {
                    if host.contains(stem) {
                        return Some(KeywordHit::new(stem));
                    }
                }
                for c in KEYWORD_COMPOUNDS.iter().copied() {
                    if host.contains(c) {
                        return Some(KeywordHit::new(c));
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct FixtureCase {
        host: String,
        expect: String,
        #[allow(dead_code)]
        note: Option<String>,
    }

    /// The SAME fixture file `extension/tests/test-domain-keywords.cjs` loads
    /// (plan A.2) — one corpus, two runtimes, zero drift. Add new cases to
    /// the fixture, never here or in the JS suite directly.
    const KEYWORD_HOSTNAMES_FIXTURE: &str =
        include_str!("../../../extension/tests/fixtures/keyword-hostnames.json");

    #[test]
    fn golden_corpus_hostnames() {
        let cases: Vec<FixtureCase> =
            serde_json::from_str(KEYWORD_HOSTNAMES_FIXTURE).expect("fixture must parse as JSON");
        assert!(!cases.is_empty(), "fixture must not be empty");
        let mut failures = Vec::new();
        for case in &cases {
            let hit = check_domain_keywords(&case.host);
            let want_block = case.expect == "block";
            let got_block = hit.is_some();
            if got_block != want_block {
                failures.push(format!(
                    "{} — expected {}, got {:?} ({})",
                    case.host,
                    case.expect,
                    hit,
                    case.note.clone().unwrap_or_default()
                ));
            }
        }
        assert!(failures.is_empty(), "keyword-hostnames fixture mismatches:\n{}", failures.join("\n"));
    }

    #[test]
    fn normalize_leet_examples() {
        assert_eq!(normalize_leet("p0rn"), "porn");
        assert_eq!(normalize_leet("s3xy"), "sexy");
        assert_eq!(normalize_leet("clean"), "clean");
    }

    #[test]
    fn fold_confusables_examples() {
        assert_eq!(fold_confusables("pоrn"), "porn"); // Cyrillic о
        assert_eq!(fold_confusables("clean"), "clean");
    }

    #[test]
    fn is_whitelisted_domain_exact_and_subdomain() {
        assert!(is_whitelisted_domain("github.com"));
        assert!(is_whitelisted_domain("gist.github.com"));
        assert!(is_whitelisted_domain("camscanner.com"));
        assert!(is_whitelisted_domain("www.camscanner.com"));
        assert!(is_whitelisted_domain("metrostate.edu"));
        assert!(is_whitelisted_domain("ohiochristian.edu"));
        assert!(is_whitelisted_domain("specialconnections.ku.edu"));
        assert!(is_whitelisted_domain("djj.nsw.gov.au"));
        assert!(is_whitelisted_domain("ieltsmarkcambridge.com"));
        assert!(is_whitelisted_domain("norwichcyclingcampaign.org"));
        assert!(!is_whitelisted_domain("githubcom.evil.com"));
        assert!(!is_whitelisted_domain("notgithub.com"));
    }

    // ── punycode / IDN decode — ported from test-idn-punycode.cjs ─────────────
    #[test]
    fn idn_to_unicode_examples() {
        assert_eq!(idn_to_unicode("xn--m1abbbg.com"), "порно.com");
        assert_eq!(idn_to_unicode("xn--fiqs8s.com"), "中国.com");
        assert_eq!(idn_to_unicode("xn--wgv71a.jp"), "日本.jp");
        assert_eq!(idn_to_unicode("xn--mnchen-3ya.de"), "münchen.de");
        assert_eq!(idn_to_unicode("xn--kln-sna.de"), "köln.de");
        assert_eq!(idn_to_unicode("www.xn--fiqs8s.com"), "www.中国.com");
        assert_eq!(idn_to_unicode("github.com"), "github.com");
        assert_eq!(idn_to_unicode("sub.example.co.uk"), "sub.example.co.uk");
    }

    #[test]
    fn idn_to_unicode_never_panics_on_malformed_input() {
        // Degenerate/invalid punycode falls back to the raw label rather than
        // panicking — mirrors the JS decoder's null-fallback behavior.
        let _ = idn_to_unicode("xn--");
        let _ = idn_to_unicode("xn--!!!invalid");
        let _ = idn_to_unicode("xn--\u{1F600}\u{1F600}\u{1F600}"); // astral chars as "digits"
    }

    #[test]
    fn punycode_decode_examples() {
        assert_eq!(punycode_decode("m1abbbg").as_deref(), Some("порно"));
        assert_eq!(punycode_decode("fiqs8s").as_deref(), Some("中国"));
    }

    #[test]
    fn punycode_decode_never_panics_on_invalid_input() {
        // The safety property that matters: never throws/panics on hostile
        // input, whatever it returns (matches test-idn-punycode.cjs's stance).
        let _ = punycode_decode("!!!not-valid-digits");
    }
}
