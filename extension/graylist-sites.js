// ════════════════════════════════════════════════════════════════════════════
// Canonical Graylist V2 site list (the single source of truth for the UI).
// ════════════════════════════════════════════════════════════════════════════
// These are the mixed-content platforms Oath Light filters IN PLACE instead of
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
  { url: 'mastodon.social',     kind: 'api', desc: 'Mastodon (all instances) — sensitive posts stripped' },
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
  { url: 'sketchfab.com',       kind: 'api', desc: 'Age-restricted 3D models stripped from listings & search' },
  { url: '500px.com',           kind: 'api', desc: 'NSFW (notSafeForWork) photos stripped from feeds & search' },
  { url: 'gamebanana.com',      kind: 'api', desc: 'NSFW/sexual mods stripped from browse & search feeds' },
  { url: 'wattpad.com',         kind: 'api', desc: 'Mature-rated stories stripped from search, browse & feeds' },
  { url: 'fanbox.cc',           kind: 'api', desc: 'R-18 creators & posts stripped from feeds (Pixiv Fanbox)' },
  // Live video. Both platforms label their own streams and serve those labels as
  // ordinary JSON — Twitch over gql.twitch.tv, Kick over its REST API — so the
  // same per-item stripper works here. A labelled channel opened directly can't be
  // stripped (the flag isn't in an array), so it blocks the tab instead.
  { url: 'twitch.tv',           kind: 'api', desc: 'Sexually-labelled streams stripped from directories & search; labelled channels blocked' },
  { url: 'kick.com',            kind: 'api', desc: 'Mature-flagged streams stripped from browse & search; mature channels blocked' },
  // ── DOM-label filtering (server-rendered sites) ───────────────────────────
  { url: 'newgrounds.com',      kind: 'dom', desc: 'Adult (A-rated) work removed; adult pages blocked' },
  { url: 'archiveofourown.org', kind: 'dom', desc: 'Explicit & Mature works removed' },
  { url: 'fanfiction.net',      kind: 'dom', desc: 'M/MA-rated stories removed' },
  { url: 'scribblehub.com',     kind: 'dom', desc: 'Adult/smut web-fiction removed; adult series & genre pages blocked' },
  { url: 'itch.io',             kind: 'dom', desc: 'Adult games blocked at the content-warning gate' },
  { url: 'steampowered.com',    kind: 'dom', desc: 'Adult games age-gated → blocked; mature community content blocked' },
  { url: 'webtoons.com',        kind: 'dom', desc: 'Mature (15+/18+) series & episodes blocked' },
  { url: 'tapas.io',            kind: 'dom', desc: 'Mature series & episodes removed/blocked at the content gate' },
  { url: 'ko-fi.com',           kind: 'dom', desc: 'NSFW-tagged creator pages blocked at the adult-content gate' },
  { url: 'writing.com',         kind: 'dom', desc: 'Adult (18+/GC/XGC) items removed from listings & feeds; adult item pages blocked' },
  // ── Safe-mode enforcement (platform kept, restricted in place) ────────────
  // Previously whitelisted (total bypass) — now filtered (adversarial report §1.4/§3.1).
  { url: 'youtube.com',         kind: 'enforce', desc: 'Restricted Mode forced (PREF cookie); explicit/suggestive searches blocked' },
  { url: 'spotify.com',         kind: 'enforce', desc: 'Explicit erotica/adult audio searches blocked' },
  // ── Mainstream AI platforms with NSFW corners (plan 3.3) ──────────────────
  // The dedicated AI-erotica sites are blocked outright (blocklists/
  // domains_ai.json + the civitai/undressai/nudify stems). These four are
  // mainstream tools people have real reasons to use, so they're filtered in
  // place instead: the platform works, the adult search doesn't.
  { url: 'character.ai',        kind: 'enforce', desc: 'NSFW character searches blocked; the platform stays usable' },
  { url: 'poe.com',             kind: 'enforce', desc: 'NSFW bot searches blocked; the platform stays usable' },
  { url: 'huggingface.co',      kind: 'enforce', desc: 'NSFW model & dataset searches blocked; ordinary model browsing untouched' },
  // ── Discord (NSFW channels/servers blocked, platform kept) ────────────────
  { url: 'discord.com',         kind: 'discord', desc: 'Age-restricted channels & servers blocked' }
];

if (typeof window !== 'undefined') window.GRAYLIST_SITES = GRAYLIST_SITES;
