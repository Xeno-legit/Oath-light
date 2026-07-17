# Graylist System — Handoff

> For the next agent. The graylist is the **mixed-content** problem: sites that are
> legit but also host NSFW (Reddit, X, Pixiv, Discord…). This summarizes the site
> inventory (counts), the chosen approach, and what's needed to build **Graylist V2**.
> Decisions/rationale live in [BLOCKING_STRATEGY.md §2–§3](BLOCKING_STRATEGY.md);
> raw site list in [Graylistfoundomains.txt](Graylistfoundomains.txt).
> Graylist V2 is **Phase 3** (not built yet). Last updated: 2026-06-09.

---

## 1. The problem & the chosen approach

A graylist site can't be whole-site blocked (people need it) and can't be left alone
(it hosts NSFW). The **V1 approach** (current [extension/content.js](extension/content.js),
~50 sites) hides each site's NSFW-filter UI with hand-tuned CSS + forces toggles. **It rots**
— every site redesign breaks the selectors, and cookies mostly don't work anymore (sites moved
NSFW prefs server-side).

**Graylist V2 (the plan): read the site's OWN per-item NSFW label in the JSON it fetches and
strip the flagged items before render.** Ground-truth, not heuristics; survives redesigns because
API fields stay stable for years. You become the filter instead of fighting the site's toggle.

---

## 2. Site inventory — ~102 candidate domains, triaged

Counts from `Graylistfoundomains.txt` (4 dead domains already removed: cohost, koo, gfycat, omegle).

| Bucket | # | Mechanism | Sites |
|---|---:|---|---|
| **API-intercept** (V2 core) | ~24 | strip items where NSFW flag true, in fetched JSON | reddit, x/twitter, **6 Mastodon** (mastodon.social/.online, mas.to, mstdn.social, fosstodon, techhub), bluesky (bsky.app + bluesky.social), tumblr, minds, gab, pixiv, deviantart, vimeo, dailymotion, odysee, patreon, gumroad, nexusmods, itaku, imgur, **boorus** (danbooru, konachan, safebooru) |
| **DOM-label** (SSR) | 6 | read stable rating class/attr, remove | newgrounds, archiveofourown, furaffinity, inkbunny, sofurry, fanfiction.net |
| **Block NSFW sub-units** | ~19 | block the NSFW channel/board, keep platform | messaging (discord.com, discord.gg, telegram, t.me, kik, snapchat, whatsapp = 7); chans (4chan, 8kun, endchan, 7chan, 420chan, lainchan, wizchan = 7 — already blacklisted); Discord dirs (disboard, discadia, discord.me, discordlist.io, top.gg = 5 — **drop** once Discord blocking exists). **Discord is the only feasible target**; the rest are E2E/un-flagged → minimal. |
| **Block whole site** | 9 | no per-item label exists | video-chat: ome.tv, chatroulette, chathub.cam, strangercam, shagle, dirtyroulette, camgo, bazoocam, coomeet |
| **Move to blacklist** | ~16 | entirely NSFW → curated list (most already there) | redgifs, rule34.xxx, rule34.paheal, e621, tbib, yande.re, literotica, chyoa, writing.com, loverslab, f95zone, lewdrg, subscribestar.adult, baraag, pawoo, poa.st |
| **Don't block** | 4 | too much collateral → resolve-and-check later | shorteners: bit.ly, tinyurl, t.ly, shorturl.at |
| **Let slide** | ~8 | general-purpose, not *mainly* NSFW | file hosts: catbox.moe, litterbox, files.catbox.moe, pomf.cat, uguu.se, postimg (+ imagebam/imagevenue borderline — block only if going strict) |
| **Best-effort / low-priority** | ~11 | generic filter or accept leakage | vk, mewe, parler, pillowfort, speakbits, bitchute, rumble, streamable, ko-fi, buymeacoffee, subscribestar.com |

So the **real V2 build is ~24 API-intercept + 6 DOM-label + Discord = ~31 sites**. Everything else is
already handled (blacklist / chans), deferred (shorteners), or dropped (file hosts, directories).

---

## 3. Stable per-item NSFW fields (the API-intercept adapter data)

The whole engine is ~90% shared code + a tiny adapter row per site:
`{ endpoint URL pattern, path to items array, NSFW predicate }`.

| Site | NSFW field |
|---|---|
| Reddit | `data.over_18` |
| X / Twitter | `possibly_sensitive` |
| Pixiv | `xRestrict > 0` |
| Mastodon (all instances) | `sensitive` |
| Bluesky | `labels` (porn / sexual / nudity) |
| Tumblr | `is_nsfw` / `is_adult` |
| Boorus (danbooru…) | `rating` (s/q/e) |
| DeviantArt | `is_mature` |
| Vimeo | `content_rating` |
| Odysee | `mature` |
| Patreon | `is_nsfw` |
| NexusMods | `contains_adult_content` |
| Imgur | `nsfw` |

---

## 4. What's needed to BUILD Graylist V2

1. **A `world: "MAIN"` injected script** — the current content.js runs in the *isolated* world and
   can't patch the page's `fetch`. Add a `content_scripts` entry with `"world": "MAIN"` (Chrome 111+)
   or inject a `<script>` tag.
2. **The interception engine (write once)** — monkey-patch `window.fetch` + `XMLHttpRequest`: on a
   matching content endpoint, parse the JSON, walk to the items array, drop items where the predicate
   is true, hand back the cleaned response. React then renders a feed that never contained NSFW.
3. **The per-site adapter table** (~24 rows, the data in §3). A few (Bluesky nested labels, deeply-nested
   GraphQL) need a small custom extractor.
4. **DOM-label adapters** (~6 SSR sites) — read a stable rating class/data-attr (V1 already does Newgrounds + AO3).
5. **Discord channel/server blocking** — detect the age-restricted channel flag; block just those.
6. **Decouple graylist rules from the extension binary** — push the adapter config via the
   desktop↔extension sync (already exists for blocklists) so an endpoint/selector change doesn't need a
   store release. Critical, because these *will* rot.
7. **Strictness model** — Standard (best-effort in-site filtering) vs Strict (block the whole site /
   allowlist-only). Anti-addiction → bias defaults toward blocking; half-working enforcement gives false
   security.

**Boundary (can't be solved by interception):** SSR sites with no JSON → DOM-label or block; hostile
APIs (protobuf/heavy signing, e.g. TikTok) → block; E2E messaging (WhatsApp) → nothing visible.

---

## 4b. BUILD STATUS — what's actually implemented (updated 2026-06-11)

V2 is now live in code, not just planned:
- **MAIN-world interceptor:** `extension/graylist-inject.js`, injected by `content.js` as an
  external web-accessible `<script>` (CSP-safe, works on FF 109+; no `world:"MAIN"` manifest key
  needed). Patches `fetch`, runs a depth-first scrubber driven by a per-host `RULES` table.
  **fetch-only for now** (the listed SPAs all use fetch); XHR is a documented follow-up.
- **API-intercept RULES shipped:** reddit (`over_18`/`isNsfw`), x/twitter (`possibly_sensitive`),
  pixiv (`xRestrict`), tumblr (`is_nsfw`/`is_adult`), bluesky (`labels`), **Mastodon — ALL
  instances** (matched by stable REST paths, not a host list; this also incidentally covers
  **gab**, a Mastodon fork), boorus (danbooru/gelbooru/konachan/yande.re/tbib/safebooru, `rating`),
  **imgur** (`nsfw`), **nexusmods** (`contains_adult_content`/`adultContent`), **deviantart**
  (`is_mature`/`isMature`). Validated against real response shapes in a sandbox harness.
- **DOM-label engine shipped:** `content.js` `DOM_LABEL_RULES` — reads each SSR site's per-item
  rating marker and removes the item (JS + MutationObserver for lazy-load; cross-browser, no
  `:has` dependency). Sites: newgrounds, archiveofourown, furaffinity (solid selectors);
  inkbunny, sofurry (best-effort — **verify against live DOM**); fanfiction.net (text-scan
  "Rated: M/MA", no rating class exists).
- **Old V1 layer removed:** the per-site CSS UI-hiding, content-hiding, toggle-forcing, shadow-DOM
  enforcement, and cheeky popup are **deleted**. Kept: SafeSearch UI lock, Newgrounds bypass-page
  block, SPA URL monitoring, and the `background.js` cookie/URL-rewrite first layer.
- **Page-level label block (DOM sites):** beyond cleaning listings, each SSR rule has a
  `pagePath` + `pageLabel()` that reads the content page's OWN rating (newgrounds
  `meta[name=rating]`, AO3 `dd.rating` tag, FA rating-box, FF.net "Rated: M/MA") and
  **hard-blocks the whole tab** if adult. Closes the leak where the user's "show adult"
  preference is already enabled server-side (no interstitial, page just renders). We do NOT
  force their toggle — we kill the page.
- **Reddit "nuclear" search (reddit-only):** the `q=` search param is now matched against BOTH
  the soft AND hard keyword lists (was hard-only). Whole-word match for short keywords so
  `essex`/`massachusetts`/`ford escort` don't trip; substring for ≥4-char. Lives entirely inside
  the reddit-hostname branch of `shouldBlockUrl` — fires on no other site. 43-case test, 0 FPs.
- **UI:** the canonical covered-site list now ships in `extension/graylist-sites.js` and renders
  in the extension's Blocklist Manager + the desktop app's Blocklist page (kept in sync with
  `desktop-app store.js`). Replaced the old stale placeholder list (youtube/discord).
- **Booru triage RESOLVED:** every booru (danbooru, gelbooru, konachan, yande.re, tbib, safebooru)
  **and** all NSFW fediverse instances (pawoo, baraag, poa.st) are already on the curated
  BLACKLIST — confirmed by grep. So the booru API rule + the mastodon-path rule are *dormant
  backstops* on those hosts (navigation block fires first). Left in for if any is ever un-blacklisted.

- **Stats:** stripped counts post-message → `content.js` → `background.js` → `stats.graylistFiltered`.

- **The 7 deferred API rules shipped** (best-effort field names, validated against synthetic
  payloads, 0 cross-fire): vimeo (`content_rating[]`), dailymotion (`explicit`), odysee
  (`mature`/tag), patreon (`is_nsfw`), gumroad (`is_adult`), minds (`nsfw[]`), itaku
  (`maturity_rating`). Wrong field = harmless no-op until verified on live traffic.
- **Discord shipped (best-effort, DOM)** in `content.js` `setupDiscordFiltering()`: Discord is
  WebSocket/gateway-driven so the fetch interceptor can't reach it. We detect Discord's OWN
  age-gate text ("marked as age-restricted…") and hard-block the tab, + hide NSFW channels in the
  sidebar. KNOWN GAP: a user who already enabled "Display age-restricted content" sees NSFW
  channels with no gate — catching that needs the hashed header marker (deferred). Discord
  directories (disboard/discadia/discord.me/discordlist.io/top.gg) are now redundant but still
  un-handled — drop/blacklist later.
- **Live triage status** now lives in `Graylistfoundomains.txt` (rewritten as a per-domain status
  table). ~110 domains · ~79 handled · ~31 not (5 Discord dirs, 13 low-priority, 5 messaging=CANT,
  ~8 best-effort verifies).
- **+8 sites the original 2026-04-27 scrape missed** (the inventory was never complete — audit for
  more before trusting it). API: PeerTube (`nsfw`, all instances via REST path), Lemmy (`nsfw`, all
  instances via /api/v3), Mangadex (`contentRating` erotica/pornographic), ArtStation
  (`adult_content`), Flickr (`safety_level` 2/3, best-effort). DOM/page-block: Steam (store
  `/agecheck/` + mature gate; community mature overlay), itch.io (content-warning gate), Weasyl
  (rating, DOM-label like FA). Gaming storefronts were the biggest blind spot.

**Still open:** Discord opted-in header-marker case; inkbunny/sofurry + the best-effort API field
verifications (live DOM/traffic). The 13 low-priority sites (deferred on purpose). The 5 messaging
apps are a dead end (E2E). Decoupling the adapter config from the binary via desktop↔extension sync.
Strict whole-site mode.

---

## 5. Current state
- **V1 (live in [content.js](extension/content.js))**: ~50 sites, CSS UI-hiding + toggle-forcing +
  SafeSearch UI lock + "cheeky" popups. Works but fragile (selector rot). V2 replaces the fragile parts;
  keep the SafeSearch-UI lock and the cheeky-popup UX.
- **Already done elsewhere:** chans + entirely-NSFW sites are in the curated blacklist; 4 dead domains
  removed; cookie/URL-rewrite enforcement for reddit/pixiv/twitter/x/AO3/dailymotion exists in
  `background.js` (`GRAYLIST_COOKIE_MAP`, `GRAYLIST_URL_REWRITE_MAP`) — keep as a cheap first layer.
- **Not built:** the API-interception engine (the V2 core). This is the Phase-3 task.
