// ════════════════════════════════════════════════════════════════════════════
// Canonical Graylist V2 site list (the single source of truth for the UI).
// ════════════════════════════════════════════════════════════════════════════
// These are the mixed-content platforms Pure Path filters IN PLACE instead of
// blocking outright. Each entry mirrors a live rule:
//   kind:'api' → a RULES row in graylist-inject.js (strips NSFW items from the
//                JSON the site fetches, before render)
//   kind:'dom' → a DOM_LABEL_RULES row in content.js (removes adult items from
//                server-rendered pages + hard-blocks adult content pages)
//
// Keep this in sync with desktop-app/src/renderer/js/store.js → blocklist.graylist.
// (Booru sites — danbooru, gelbooru, yande.re… — are NOT here: they're entirely/
//  mostly adult and live on the curated BLACKLIST, so they're blocked outright.)
const GRAYLIST_SITES = [
  // ── API / network-layer interception ──────────────────────────────────────
  { url: 'reddit.com',          kind: 'api', desc: 'NSFW posts stripped from feeds; explicit search & subreddits blocked' },
  { url: 'x.com',               kind: 'api', desc: 'Sensitive media stripped from timelines (also twitter.com)' },
  { url: 'tumblr.com',          kind: 'api', desc: 'NSFW posts stripped from the dashboard' },
  { url: 'pixiv.net',           kind: 'api', desc: 'R-18 artwork stripped from listings' },
  { url: 'bsky.app',            kind: 'api', desc: 'Bluesky — adult-labelled posts stripped' },
  { url: 'mastodon.social',     kind: 'api', desc: 'Mastodon (all instances) — sensitive posts stripped' },
  { url: 'deviantart.com',      kind: 'api', desc: 'Mature deviations stripped from listings' },
  { url: 'imgur.com',           kind: 'api', desc: 'NSFW images stripped from galleries' },
  { url: 'nexusmods.com',       kind: 'api', desc: 'Adult mods stripped from listings' },
  { url: 'vimeo.com',           kind: 'api', desc: 'Adult-rated videos stripped from feeds' },
  { url: 'dailymotion.com',     kind: 'api', desc: 'Explicit videos stripped; family filter enforced' },
  { url: 'odysee.com',          kind: 'api', desc: 'Mature content stripped from feeds' },
  { url: 'patreon.com',         kind: 'api', desc: 'NSFW posts stripped from feeds' },
  { url: 'gumroad.com',         kind: 'api', desc: 'Adult products stripped from listings' },
  { url: 'minds.com',           kind: 'api', desc: 'NSFW posts stripped from feeds' },
  { url: 'itaku.ee',            kind: 'api', desc: 'NSFW & questionable art stripped' },
  { url: 'PeerTube',            kind: 'api', desc: 'PeerTube (all instances) — NSFW videos stripped' },
  { url: 'Lemmy',               kind: 'api', desc: 'Lemmy (all instances) — NSFW posts & communities stripped' },
  { url: 'mangadex.org',        kind: 'api', desc: 'Erotica & pornographic manga stripped' },
  { url: 'artstation.com',      kind: 'api', desc: 'Adult-content artwork stripped' },
  { url: 'flickr.com',          kind: 'api', desc: 'Moderate & restricted photos stripped' },
  // ── DOM-label filtering (server-rendered sites) ───────────────────────────
  { url: 'newgrounds.com',      kind: 'dom', desc: 'Adult (A-rated) work removed; adult pages blocked' },
  { url: 'archiveofourown.org', kind: 'dom', desc: 'Explicit & Mature works removed' },
  { url: 'furaffinity.net',     kind: 'dom', desc: 'Adult & Mature submissions removed' },
  { url: 'fanfiction.net',      kind: 'dom', desc: 'M/MA-rated stories removed' },
  { url: 'inkbunny.net',        kind: 'dom', desc: 'Adult submissions removed' },
  { url: 'sofurry.com',         kind: 'dom', desc: 'Adult content removed' },
  { url: 'weasyl.com',          kind: 'dom', desc: 'Mature & explicit submissions removed' },
  { url: 'itch.io',             kind: 'dom', desc: 'Adult games blocked at the content-warning gate' },
  { url: 'steampowered.com',    kind: 'dom', desc: 'Adult games age-gated → blocked; mature community content blocked' },
  // ── Discord (NSFW channels/servers blocked, platform kept) ────────────────
  { url: 'discord.com',         kind: 'discord', desc: 'Age-restricted channels & servers blocked' }
];

if (typeof window !== 'undefined') window.GRAYLIST_SITES = GRAYLIST_SITES;
