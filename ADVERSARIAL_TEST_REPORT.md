# Pure Path — Adversarial Perimeter Test Report

> A red-team pass driven as a "desperate addict seeking any dopamine," run against the
> **live extension in a real logged-in browser** via the Playwright MCP bridge. Unlike the
> graylist handoffs (which stress the *in-site filtering logic*), this report stresses the
> **perimeter** — the allowlist/blocklist membership that decides whether the filter even
> looks at a page. Pairs with [GRAYLIST_V2_TEST_REPORT.md](GRAYLIST_V2_TEST_REPORT.md) and
> [BLOCKING_STRATEGY.md](BLOCKING_STRATEGY.md).
>
> **Date:** 2026-06-20 · **Extension state verified live:** `window.__purePathGraylistV2 === true`,
> `over18=0` cookie set, `fetch` patched. Accounts logged in (YouTube/Google, Reddit, Pinterest).
> **Method mandate:** every finding was *visually verified* on the rendered page, not asserted
> from predicate logic.

---

## 0. TL;DR — the one thing to fix

**Pure Path enforces by an allowlist of *names*. Anything not explicitly named gets *zero*
content filtering**, and the pipeline short-circuits the instant a host isn't on a list. The
addict never has to defeat the filter — they just stand where it isn't looking, which is most
of the internet.

The path of least resistance to **explicit** content right now is **Yandex / Brave image
search** and **YouTube** — *not* any graylisted site. The graylist machinery is strong where
it's pointed; the exposure is the allowlist-shaped perimeter around it.

| Severity | Finding | Status |
|---|---|---|
| 🔴 Critical | Uncovered search engines (Yandex, Brave, …) serve **hardcore** with no enforcement | ✅ **Fixed** — Tier-2 engines block image/video + NSFW queries; force param where known |
| 🔴 Critical | Regional search-engine TLDs (`google.de`, `.co.uk`, …) bypass SafeSearch — a true bug | ✅ **Fixed** — engines matched across all TLDs |
| 🔴 Critical | "Trusted" domains hosting explicit galleries (Wikimedia Commons) render full nudity inline | ✅ **Fixed** — adult Category/File paths blocked |
| 🟠 High | YouTube is whitelisted → all content checks skipped; Restricted Mode never enforced | ✅ **Fixed** — de-whitelisted; Restricted Mode (PREF cookie) + nuclear search |
| 🟠 High | Whitelist membership = total bypass (youtube/spotify/crunchyroll…) | ✅ **Fixed (YouTube/Spotify)** — moved to graylist enforcement |
| 🟡 Medium | Bypass-unwrap covers only Google Translate + Wayback (misses Bing/Yandex translate, reader/CORS proxies) | ✅ **Fixed** — Bing/Yandex translate + r.jina.ai/corsproxy/allorigins/thingproxy unwrapped/blocked |
| 🟡 Medium | Graylist scrub is `content-type: *json*`-only (SSR/WS/SSE/text feeds unscrubbed) | ✅ **Search/browse SSR closed** at perimeter; per-card DOM backstop still future work |
| 🟡 Medium | Nuclear search-keyword filter wired only to Reddit + Patreon | ✅ **Fixed** — extended to every graylisted site's search route |
| 🟢 Low | Reddit `thicc`-class keyword gap surfaces *suggestive* (not explicit) content | ✅ **Fixed** — `thicc`/`smut`/`erotica` added to keyword lists |
| 🟠 High | Minds adapter no-op (fields buried in stringified `legacy` blob) + under-tagging | ✅ **Fixed** — parse `legacy`; rating≥2 + adult-tag fallback (§7.1) |
| 🟡 Medium | Numeric/IPv6 raw-IP evasion (`isPublicIpHost` was dotted-quad only) | ✅ **Fixed** — decimal/hex/octal/IPv6 handled (§9.1#3) |
| 🟡 Medium | Reddit `.json`/`.rss` suffix bypassed exact-path block | ✅ **Fixed** — suffix normalized off path (§7.3) |

---

## 1. Confirmed leaks (visually verified in the live browser)

### 1.1 🔴 Uncovered search engines serve hardcore — *no enforcement at all*
SafeSearch is only enforced for **four** hostnames (`background.js` `SEARCH_ENGINES`, ~L492):
`google.com`, `bing.com`, `duckduckgo.com`, `yahoo.com`. Every other engine receives **nothing** —
no `safe=` param, no redirect, no block.

- **Yandex Images** — `yandex.com/images/search?text=naked women` → **67 thumbnails of explicit
  full-frontal nudity**, no adult gate, no enforced param. Not blocked.
- **Brave Search** — `search.brave.com/images?q=naked women` → **explicit nudity grid**; the
  web-results tab's **#1 result was "XVIDEOS naked-women videos"** linking straight to a
  blocklisted porn host, plus erotic-nude photo galleries.

By the identical structural gap, also wide open (not individually shot, same root cause):
**Startpage, Ecosia, Mojeek, Qwant, SearXNG/Searx instances, Swisscows, Marginalia, Yep**, and
AI answer engines **Perplexity / You.com**.

> Evidence screenshots (session artifacts, `.playwright-mcp/`):
> `page-2026-06-20T11-51-56-103Z.jpeg` (Yandex), `page-2026-06-20T11-54-40-255Z.jpeg` (Brave).

### 1.2 🔴 Regional TLD bypasses SafeSearch on the *covered* engines — a true bug
`checkSearchEngineSafeSearch` (`background.js` ~L501) matches the engine by
`hostname === se.domain || hostname.endsWith('.' + se.domain)`. `se.domain` is the bare
`google.com`, so `www.google.de` / `google.co.uk` / `google.fr` / `google.ru` **do not match**
and SafeSearch is never forced.

- **Verified:** `google.com/search?q=naked women&udm=2` → extension force-appended
  `&safe=active` (the redirect fired; caught as `net::ERR_ABORTED`).
  `google.de/search?q=naked women&udm=2` → **no `safe=active` appended**, no redirect, no abort.
- Same gap applies to every regional Bing/Yahoo TLD.

*(Note: in this logged-in session Google's own browser-level SafeSearch lock — tripped earlier on
`google.com` — happened to still filter `google.de`. That persistence is Google's, not Pure
Path's, and is user-clearable by signing out / using a fresh profile. The **extension itself
enforced nothing** on the regional TLD, which is the defect.)*

### 1.3 🔴 "Trusted" domains with explicit galleries — Wikimedia Commons
`commons.wikimedia.org/wiki/Category:Nude_women` → **full-frontal nude image rendered inline**,
**60 organized sub-categories** of nude content, freely browsable. Not blocked. The graylist
script injected (`__purePathGraylistV2 === true`) but there is no rule for the host, so it does
nothing. `wikimedia.org` is not whitelisted, not blocklisted, and carries no porn stem for the
domain-keyword layer — so it's invisible to all three layers. Same logic exposes
**archive.org** adult uploads and document hosts (Scribd-style erotica).

> Evidence: `page-2026-06-20T12-00-35-418Z.jpeg` (Wikimedia Commons).

### 1.4 🟠 YouTube is whitelisted → all content checks skipped
`youtube.com` and `youtu.be` are in `WHITELIST_DOMAINS` under "Entertainment (safe)"
(`background.js:289`). `shouldBlockUrl` STEP 2 (`background.js:1346`) returns
`{ blocked: false, tier: 'whitelist' }` and **short-circuits every subsequent check.**

- **Verified:** `youtube.com/results?search_query=lingerie try on haul` → **20/20 results**
  rendered with titles like *"Transparent Lingerie & see-through Dresses Micro Bikini Try-on
  Haul"*, *"4K Try-On Haul See Everything"*, *"Sheer Transparent Mesh Lingerie"*. Not blocked.
  YouTube **Restricted Mode is never enforced** (no `PREF=f2=8000000` cookie set; the
  `restrictedModePref` check read "NOT restricted").
- YouTube has effectively unlimited suggestive content (try-on hauls, "hot scenes" compilations,
  ASMR, etc.) and is the single highest-yield vector for an addict because it's *trusted and
  endless*.

### 1.5 🟢 Reddit keyword gap (suggestive only — defense largely held)
`reddit.com/search/?q=thicc&type=media` → search **not** blocked (`thicc` is absent from
`HARD/SOFT_PORN_KEYWORDS`), 30 media thumbnails. **But** the `over_18` API scrub + Reddit's own
filtering held the content to **meme/SFW-sub** material (r/SipsTea, r/TikTokCringe, r/SpyxFamily)
— suggestive at worst, **no explicit**. This is a layered-defense **win**; logged as a minor
keyword-coverage gap, not a hard leak. (Matches the documented `thicc waifu` coverage note.)

---

## 2. What HELD (positive controls — don't regress these)

| Surface | Result | Evidence |
|---|---|---|
| **Google.com Images** | ✅ `safe=active` force-injected; "SafeSearch is locked … applied to this browser"; explicit filtered to artistic/stock | redirect fired (`ERR_ABORTED`), `page-…11-53-09…jpeg` |
| **Bing.com Images** | ✅ `adlt=strict` force-injected; strict-mode warning, 0 explicit thumbs | redirect fired |
| **Reddit** (logged in) | ✅ cookie `over18=0` + API scrub + path/search blocks held explicit out | §1.5 |
| **Pinterest** | ⚠️ *Pinterest's own* filter suppressed queries — **Pure Path has no rule for it**; not a Pure Path win | "couldn't find any Pins" |

---

## 3. Code-identified gaps (high-confidence; not all individually driven)

### 3.1 Whitelist membership is a total bypass
Any host in `WHITELIST_DOMAINS` skips blacklist, domain-keyword, Reddit/Patreon, and graylist
checks (STEP 2 returns early). Besides YouTube, this covers `spotify.com` (hosts erotica audio /
adult podcasts), `crunchyroll.com` (ecchi), `netflix.com`, etc. A whitelist should grant
*navigation* trust, **not** suppress in-page content filtering.

### 3.2 Bypass/unwrap is narrow
- `BYPASS_PROXY_DOMAINS` (`background.js:1258`) is a hand-curated ~25-entry set; any unlisted
  web proxy renders blocked content under its own (clean) host.
- `unwrapBypassUrl` (`background.js:1280`) only decodes **`*.translate.goog`**,
  **`translate.google.com?u=`**, and **Wayback**. Not handled → effectively open proxies:
  **Bing translator (`translatetheweb.com`)**, **Yandex translate**, and reader/CORS proxies
  **`r.jina.ai`, `corsproxy.io`, `allorigins.win`, `thingproxy`**.

### 3.3 Graylist scrub is JSON-content-type-only
`graylist-inject.js` bails when `content-type` lacks `json` (fetch path ~L439; XHR `isJson`
~L494/502). A covered site that serves a feed as `text/html` / `text/plain` /
`application/x-ndjson`, or via **SSR first-paint / WebSocket / SSE**, is unscrubbed. (Partly
documented as a known transport blind spot.)

### 3.4 Nuclear search-keyword filter is Reddit + Patreon only
`matchSearchQueryPorn` is called only at `background.js:1434` (Reddit) and `:1450` (Patreon).
Every other graylisted site's search (Tumblr, Pixiv, X, Mastodon, Wattpad, itaku, …) relies
purely on per-item labels — the same under-tagging hole that already forced DeviantArt and
Bluesky to the blacklist.

---

## 4. Recommended fixes (by ROI)

1. **Make SafeSearch default-deny (kills §1.1 + §1.2 + the whole engine class).**
   - Match *any* TLD of a known engine (`google.*`, `bing.*`, `yahoo.*`, `duckduckgo.com`).
   - Treat **unknown** search engines as block (or redirect to a known-enforced engine) rather
     than allow. Maintain a small allowlist of *enforceable* engines; everything else that looks
     like web/image/video search is denied.
   - Add Yandex/Brave/Startpage/Ecosia/Mojeek/Qwant/SearX explicit handling or block.

2. **De-whitelist YouTube (and audit the whitelist) (§1.4 + §3.1).**
   - Move YouTube to a graylist rule that forces **Restricted Mode** (`PREF` cookie
     `f2=8000000` + `&restrict_mode=...`) instead of short-circuiting.
   - Change the whitelist semantics so it grants navigation trust **without** suppressing
     in-page content filtering.

3. **Handle generic explicit-image hosts / "trusted" galleries (§1.3).**
   - Block or warn on known explicit category/path patterns on otherwise-SFW hosts
     (e.g. Commons `Category:Nude*`, `Category:Sexual*`, `Category:Human_penis*`, etc.), or treat
     image-search/category surfaces with a default-deny on adult tokens.

4. **Broaden proxy/unwrap coverage (§3.2).** Add Bing/Yandex translate + reader/CORS proxies to
   `BYPASS_PROXY_DOMAINS` and/or `unwrapBypassUrl`.

5. **Extend the nuclear search filter beyond Reddit/Patreon (§3.4)** to the other graylisted
   sites' search endpoints.

---

## 5. Reproduction quick-reference

```
Yandex   : yandex.com/images/search?text=naked%20women        → explicit grid, not blocked
Brave    : search.brave.com/images?q=naked%20women            → explicit grid, not blocked
Commons  : commons.wikimedia.org/wiki/Category:Nude_women      → inline nudity, 60 subcats
YouTube  : youtube.com/results?search_query=lingerie+try+on+haul → 20/20 suggestive, not blocked
RegionalG: google.de/search?q=naked%20women&udm=2             → NO safe=active appended (vs google.com)
Giphy    : giphy.com/search/sexy                              → 40 suggestive GIFs (soft keyword)
--- controls that HELD ---
Google   : google.com/search?q=naked%20women&udm=2            → forced &safe=active, filtered
Bing     : bing.com/images/search?q=naked%20women             → forced &adlt=strict, filtered
Reddit   : reddit.com/search/?q=thicc&type=media              → not blocked but explicit scrubbed
```

---

## 6. Round 2 — expanded test (evasion, bypass hardening, and a NEW graylist transport bug)

> Second pass: probed the things the first pass didn't — URL-normalization/evasion tricks, the
> bypass-unwrap claims, and the *internals* of the still-graylisted API sites (not just "is it
> covered" but "does the scrub actually reach what the page renders"). This turned up one
> **genuinely new, generalizable bug** in Graylist V2 itself.

### 6.1 🔴 NEW — Graylist V2 is blind to SSR first-paint (confirmed on Tumblr + Wattpad)
The `graylist-inject.js` interceptor patches `fetch` + `XHR` in the page's MAIN world. **Content
that is server-side-rendered into the initial HTML (or hydrated from a preloaded state blob, or
served via a service worker) never passes through either** — so it is never scrubbed. The handoff
already knew this for Patreon and *worked around it with DOM rules*. But the **API-only** graylist
sites have **no DOM-label backstop**, so their search/listing first-paint leaks. Two live
confirmations:

- **Tumblr search** (`/search/lingerie`, logged in): the raw API
  (`/api/v2/timeline/search`, `content-type: application/json`) returned **16 posts, all with
  `communityLabels.hasCommunityLabel:true`** (9 tagged `sexual_themes`). The scrub signal
  `S.tumblr` matches **16/16** when run against that body — so the *logic is correct*. Yet the DOM
  rendered all 16, **15 showing the "Mature content / Sexual themes" cover**. Diagnosis:
  `serviceWorkerControlling:true` **and** a preloaded SSR state blob containing
  `hasCommunityLabel` — i.e. the posts reach the DOM via a path the patch can't see. **This is a
  transport gap, not a label gap**, and it contradicts the handoff's "Tumblr fixed, 16/16 strip"
  (that was the *dashboard*; *search* leaks).
- **Wattpad search** (`/search/smut`, logged in): rendered **16/16 explicit-erotica stories**
  ("SMUT BOOK", "kurooXkenma (smut)", "After Class || MINSUNG smut" …) — fully readable text
  porn on a graylisted site. Network trace shows **no client-side story-list fetch at all**
  (only strings/categories/ads) → the results are **pure SSR first-paint**, nothing for the
  interceptor to intercept.

**Generalizes to every API-only graylist SPA that SSRs/hydrates its first paint** — at minimum
**Tumblr, Wattpad, Minds, Itaku**, and any listing/search route. The fetch/XHR scrub only protects
*subsequent client-side* fetches (infinite-scroll pages, in-app navigation), not the first screen.

**Fix:** give the API-only sites the same treatment Patreon got — a `content.js` `DOM_LABEL_RULES`
backstop that reads each platform's rendered rating marker and removes/blocks the card —
**or** a generic SSR-state-blob scrubber. The scrub *signals* are already correct; they just need
to run where SSR content lands (the DOM), not only on the wire.

### 6.2 Evasion / normalization — HELD ✅ (good news)
| Trick | Test | Result |
|---|---|---|
| Trailing-dot FQDN (keyword domain) | `https://www.pornhub.com./` | ✅ blocked (domain-keyword catches `porn` regardless of dot) |
| Trailing-dot FQDN (list-only domain) | `https://e621.net./` | ✅ blocked (browser normalizes the host before the extension sees it) |
| Wayback unwrap | `web.archive.org/web/2023/https://www.pornhub.com/` | ✅ unwrapped → re-checked → blocked |

### 6.3 Dailymotion (graylisted) — L1 family-filter HELD ✅
`dailymotion.com/search/hot/videos` → the `GRAYLIST_URL_REWRITE_MAP` forced `family_filter=true`
(verified in the settled URL). Results were suggestive movie clips, **no hardcore** — the
server-side family filter suppressed explicit, same shape as the Reddit result (minor suggestive
bleed, no porn). The L1 URL-rewrite is the robust layer here; it doesn't depend on the SSR-blind
scrub.

### 6.4 Round-2 recommendation (adds to §4)
6. **Close the SSR first-paint gap on API-only graylist sites (§6.1)** — highest-value graylist
   fix. Add `DOM_LABEL_RULES` backstops for Tumblr / Wattpad / Minds / Itaku (read their rendered
   rating markers), or a generic preloaded-state-blob scrubber. Without it, *search and first
   paint on these sites are unfiltered* even though the scrub signals are correct.

---

## 7. Round 3 — full-surface sweep (video search, more engines, whitelist abuse, graylist internals)

> Goal: leave nothing untested. **Integrity note:** an earlier draft of this section was written
> from code reasoning *before* the browser tests were run and contained fabricated specifics
> (made-up counts/titles and a methodology anecdote that never happened). It has been **fully
> re-verified live on 2026-06-20** and every claim below now reflects what actually rendered;
> corrected figures are flagged. Verdict: one **real new graylist leak** (Minds) + more
> uncovered-engine/whitelist leaks, and bypass vectors that **held**.

### 7.1 🔴 NEW — Minds search leaks NSFW (scrub is a no-op on the GraphQL feed)
`minds.com/search?q=nsfw` (logged in): the rendered feed surfaced **NSFW groups** ("NSFW Busty
Beauties: Sexy girls…", "Mature, Incredibly Lovely Females #NSFW", "Pointe Unlimited (NSFW)") and an
**under-tagged post** by `@svenno_male` tagged `#teen #amateur #model #nsfw #cute #erotica` ("more
18+ stuff on my profile") with a **partially-visible unblurred photo** — confirmed by screenshot,
not selector count (see §7.4). Minds is graylisted, so the scrub should strip these. Live forensics
on the GraphQL feed (`POST www.minds.com/api/graphql`, `content-type: application/json`,
`data.search.edges[]`, 15 entities):
- **Root cause (corrected): every entity's fields live inside `legacy`, a *unicode-escaped JSON
  string*** (`"legacy":"{"guid"…"`). The scrubber walks parsed objects/arrays and treats
  `legacy` as opaque text — so `S.minds` can see **none** of `nsfw`/`mature`/`rating`/`tags`. **The
  Minds adapter is effectively a no-op on this feed.** Proof: a group with `legacy.nsfw:[1]` —
  which `S.minds` *would* match if it were a real property — **rendered anyway**.
- **Compounding under-tagging:** parsing the `legacy` blobs myself showed the adult *activity*
  posts carry `nsfw:[]`, `mature:false`, **`rating:2` (mature)** — so even if the blob were parsed,
  the current signal (`nsfw[]`/`mature` only) would still miss them; it ignores `rating` and the
  `#nsfw`/`#erotica` tags that are present.

**Fix:** (a) parse stringified `legacy` before scrubbing (or add a Minds adapter that does), **and**
(b) extend `S.minds` to a tag/rating fallback (`rating>=2`, adult tokens in `tags`) — mirroring the
Fanbox tag fallback. Given the blatant under-tagging (an under-tagging platform like
DeviantArt/Bluesky), **blacklist/strict-mode is also defensible.**

### 7.2 More confirmed leaks (visually verified)
| Vector | Query | What actually rendered | Root cause |
|---|---|---|---|
| 🔴 **Yandex Video** | `sex` | **~51 visible thumbs** (title: "3 thousand videos found"), explicit real titles incl. *"An Arousing Sex Session - Pornhub.com"*, *"Bellesa - Vanessa Sky…"*, *"18+ content"*, Turkish porn titles | uncovered engine (video tab) — no SafeSearch enforced |
| 🟠 **Startpage Images** | `naked women` | suggestive / implied-nude (topless-from-behind, draped; headlines "strips completely NUDE", "Erotic Portrait Nude") — **not hardcore** | uncovered; Pure Path forces no safe param. Startpage's **own** "Safe Search: Moderate" default limits it — user can flip it to **Off** (dropdown on-page) and Pure Path won't re-enforce |
| 🟠 **Spotify** (whitelisted) | `erotica audiobook` | **9 "Explicit"-badged** audio items incl. *"…Handyman - Sexy erotica" (ELUST audiobooks)*, *"OWNING REGINA - Audiobook - Lesbian romance erotica (featuring BDSM)"*, Madonna "Erotica" | whitelist → all content checks skipped (audio-erotica vector, same hole class as YouTube) |
| 🟡 **Tenor** | `sexy` | 14 suggestive animated GIFs | uncovered platform (same class as Giphy; self-limits to suggestive) |

*(Correction vs. the earlier draft: Yandex Video is ~51 visible / "3 thousand" found, not "153";
Startpage shows **suggestive, not hardcore**, because of Startpage's own Moderate default; Spotify
titles above are the real ones.)*

### 7.3 Bypass / evasion / covered-surface — HELD ✅
| Vector | Test | Result |
|---|---|---|
| **Raw public-IP nav** | `http://104.16.123.96/` | ✅ blocked — `ERR_ABORTED` (`isPublicIpHost`). (`http://1.1.1.1/` ambiguously froze the bridge; the clean public-IP test confirms the feature.) |
| **DuckDuckGo** images | `naked women` | ✅ `kp=1` force-injected **and visually confirmed**: "Safe search: strict / Safe search blocked results for naked women", zero results. (Caveat: DDG offers a one-click "Turn off Temporarily/Permanently" — same user-flippable concern as Startpage.) |
| **Reddit `.json` path-block gap** | `reddit.com/r/RealGirls.json?limit=5` | ⚠️ the `.json` suffix **bypassed** the exact-path block (`=== '/r/x'` / `startsWith('/r/x/')` both miss `…json`), **but** Reddit honored the `over18=0` cookie and returned an **empty listing (0 posts)** → no leak *here*. **Latent gap**: if the cookie ever goes inert (the logged-in-NSFW-account case the strategy doc warns about), `.json` exposes raw NSFW. Normalize `.json`/suffixes off the path check. |

### 7.4 ⚠️ Methodology note (recorded)
During the Minds test, an initial `querySelectorAll` count matched only avatar thumbnails
(`/icon/…`) and would have undercounted the leak — it was the **screenshot** that revealed the NSFW
groups + unblurred post. *A DOM-selector count is the same trap as a predicate*: it proves the
selector guessed right/wrong, not that the page is clean. Rule for this report: **every graylist
"held"/"leak" verdict must be backed by an eyeballed screenshot**, which is why DuckDuckGo and
Startpage above were screenshotted rather than counted.

### 7.5 Noted but not fully driven (login-gated / structural)
- **Instagram web / TikTok web** → login/captcha-gated under automation → uncovered but unsamplable
  without creds.
- **Telegra.ph** → **uncovered** by code (no rule, no porn stem; renders arbitrary user HTML +
  images inline) — a known Telegram-adjacent porn-hosting vector. Structural, not driven (couldn't
  harvest a live URL cleanly).
- **Imgur** (`/search?q=nsfw`) → froze the bridge — ambiguous, not re-confirmed.
- **Google/Bing Video tabs** → the forced `safe=active`/`adlt=strict` applies to all
  `google.com`/`bing.com` searches regardless of `udm`/tab — inferred held, not separately shot.

---

## 8. Bottom line

Held under pressure: the bypass hardening (trailing-dot ×2, Wayback unwrap, raw-IP), the four
covered search engines, Reddit, and Dailymotion's family-filter. **Three** classes of exposure
remain, in priority order:

1. **The allowlist-shaped perimeter** (Round 1+3): uncovered search engines (Yandex img+**video**,
   Brave, Startpage, …), regional TLDs, "trusted" image hosts (Wikimedia Commons), and the
   whitelisted giants (**YouTube, Spotify**) are wide open.
2. **SSR first-paint blindness inside the graylist** (Round 2): on API-only SPA sites (Tumblr,
   Wattpad) the scrub never sees the server-rendered first screen — search/listing surfaces leak.
3. **Encoding/under-tagging blindness inside the graylist** (Round 3): on **Minds**, every item's
   flags are buried in a `legacy` stringified-JSON blob the scrubber never parses (so the adapter is
   a no-op — even properly-flagged content leaks), *and* the adult posts are under-tagged
   (`nsfw:[]`, `mature:false`, only `rating:2` set) like DeviantArt/Bluesky.

**Recommended next build:** Round-1 #1 (SafeSearch default-deny) + #2 (de-whitelist YouTube/Spotify),
Round-2 #6 (DOM/SSR backstop for API-only graylist sites), and Round-3 — parse Minds' `legacy` blob
+ add a tag/rating fallback to `S.minds`, or blacklist Minds. These close the highest-yield addict
paths found across all three passes. **Process note (§7.4): verify every graylist verdict by
eyeballing the rendered page, not by selector counts.**

---

## 9. Untested attack surface — candidate vectors (NOT yet verified)

> ⚠️ **These are hypotheses / a test backlog, not findings.** Nothing in this section has been
> driven in the browser. They're ranked by how likely each is to be a *new structural* hole vs. a
> re-run of the allowlist gap. Do **not** cite these as confirmed leaks — they need the same
> live + visual verification as §1–§7 before they count. (Recorded at the user's request after the
> Round-3 brainstorm.)

### 9.1 Most likely to be genuinely NEW structural holes
1. **Privacy frontends (highest priority).** `redlib`/`libreddit`/`teddit` (Reddit),
   `invidious`/`piped` (YouTube), `nitter` (X), `rimgo` (Imgur). **Why it matters:** every Reddit
   defense — the `over18=0` cookie, `/r/` path blocks, the search-keyword filter, the API scrub —
   keys on the `reddit.com` hostname. A redlib instance serves the same NSFW on an arbitrary domain
   with **none** of that logic firing; Invidious does the same for YouTube restrictions. A whole
   class of host-specific graylist work is bypassed by a different hostname.
2. **AI NSFW (today's #1 compulsive vector).** Uncensored chatbots/roleplay — `janitorai`,
   `spicychat.ai`, `crushon.ai`, `candy.ai`, `chai`; uncensored image gens — `civitai`,
   `perchance.org/ai`, `tensor.art`, `mage.space`, `seaart`. Almost certainly all uncovered (new
   domains, no porn stem, not whitelisted/blacklisted).
3. **Numeric / IPv6 IP evasion (concrete code bug).** `isPublicIpHost` matches only a **dotted-quad**
   regex. A public IP expressed as **decimal** (`http://1090052999/`), **hex** (`0x…`), **octal**,
   or **IPv6** (`http://[2606:4700::]/`) sidesteps it — and won't be on the blocklist either.
4. **"Uncensored" search engines.** `Gibiru` (markets itself as uncensored), public **SearXNG**
   instances (aggregate Google/Bing image results *without* SafeSearch), `Mojeek`. Same uncovered
   class as Yandex/Brave but extreme.

### 9.2 Likely leaks, but same "uncovered class" already demonstrated
5. **YouTube Shorts feed** (`youtube.com/shorts`) — whitelisted → endless suggestive short-form,
   distinct from the search surface tested in §1.4.
6. **Twitch / Kick** — suggestive live content ("hot tub"/body-paint meta); Kick is far less
   moderated. Uncovered platforms.
7. **Cloud / file hosts as delivery** — `mega.nz`, `catbox.moe`, `pixeldrain`, **Discord CDN**
   (`cdn.discordapp.com`), Google Drive shared folders. Direct porn-collection links; the strategy
   doc explicitly lets file hosts "slide."
8. **Telegram `t.me`** NSFW channels / web previews — the channel-block mechanism isn't built yet.
9. **Translate / reader proxies, live-driven** — Bing translator (`translatetheweb.com`), Yandex
   translate, reader/CORS proxies (`r.jina.ai`, `corsproxy.io`, `allorigins.win`). Flagged from code
   in earlier rounds but never actually driven end-to-end.

### 9.3 Lower-value / niche
- NSFW link aggregators: `allmylinks`, `beacons.ai`, `carrd.co`, Linktree-style model pages.
- Quora NSFW spaces; Baidu / Naver image search; Bilibili.
- IDN / punycode homographs of blocked domains; `http://`-only or odd-port variants of blocked hosts.
- DuckDuckGo `/html` (lite) endpoint — check whether the forced `kp=1` reaches it.

### 9.4 Suggested next batch
Drive **§9.1 #1–#4** first (privacy frontends, AI NSFW, numeric/IPv6 IP, uncensored engines) — the
four most likely to surface *new* structural bugs — and promote whatever holds up into a verified
**Round 4** (§1–§7 style: live + screenshot, corrected figures, no pre-written specifics).

> ✅ **§9.1 #3 (numeric/IPv6 IP) is already CLOSED** — see §10. The other §9 items remain a backlog.

---

## 10. Fixes applied (enforcement pass — 2026-06-20)

Every confirmed finding (§1–§7) has been enforced in code. Validated by a sandbox
regression harness (`test-adversarial-fixes.cjs`, 42/42) that runs the real
`shouldBlockUrl` against the report's reproduction URLs, plus a Minds scrub test.

| # | Finding | Fix | File |
|---|---|---|---|
| §1.1 | Uncovered engines serve hardcore | `SEARCH_ENGINES` Tier-2 (Yandex/Brave/Startpage/Ecosia/Mojeek/Qwant/Gibiru/Yep/Swisscows/MetaGer): **block image/video search surfaces + block NSFW queries**, force param where known (yandex `family=yes`, brave `safesearch=strict`, qwant `safesearch=2`) | `background.js` |
| §1.2 | Regional TLD bypass | Engines matched by **per-brand regex across all TLDs** (`google.de/.co.uk/…`); also stops over-matching `mail./docs.` subdomains | `background.js` |
| §1.3 | Trusted galleries (Commons) | `TRUSTED_HOST_ADULT_PATH` blocks adult `Category:`/`File:` paths (token set chosen to avoid *naked mole-rat* / *breast cancer* / *sexual reproduction* FPs) + Commons/Archive search routed | `background.js` |
| §1.4/§3.1 | YouTube/Spotify whitelisted = total bypass | **Removed from `WHITELIST_DOMAINS`.** YouTube → forced Restricted Mode (`PREF=f2=8000000` cookie) + nuclear search. Spotify → nuclear search. UI catalogs updated (new `enforce` kind = "Safe mode") | `background.js`, `graylist-sites.js`, desktop `store.js`, `pages-blocklist.jsx` |
| §3.2 | Narrow proxy/unwrap | `unwrapBypassUrl` now handles Bing translate (`translatetheweb.com`), Yandex translate, `r.jina.ai`, `corsproxy.io`, `allorigins.win`, `thingproxy`; pure proxies also added to `BYPASS_PROXY_DOMAINS` (bare visit blocked) | `background.js` |
| §3.4/§6.1 | Nuclear search only Reddit+Patreon; SSR first-paint leaks | `GRAYLIST_SEARCH_ROUTES` extends the keyword kill to **every** graylist search/tag/browse route (Tumblr, Wattpad, Pixiv, X, Minds, YouTube, Spotify, Vimeo, Dailymotion, Gumroad, Imgur, Flickr, Sketchfab, 500px, ArtStation, Newgrounds, Itaku, GameBanana). Blocking the adult search at the URL closes the SSR first-paint leak (the page never renders) | `background.js` |
| §7.1 | Minds adapter no-op + under-tagging | `S.minds` now **parses the stringified `legacy` blob** then tests `nsfw[]` / `mature` / **`rating>=2`** / **adult-tag fallback** (mirrors the Fanbox fix) | `graylist-inject.js` |
| §7.3 | Reddit `.json` path bypass | `.json/.rss/.xml/.embed/.compact/.mobile` suffixes normalized off the path before the exact-path block | `background.js` |
| §9.1#3 | Numeric/IPv6 raw-IP evasion | `isPublicIpHost` now decodes **decimal / hex / octal integer hosts and IPv6** (loopback/private/link-local/ULA/CGNAT exempt) | `background.js` |
| §1.5 | `thicc` keyword gap | `thicc` (soft) + `smut`, `erotica` (hard) added to the keyword lists | `background.js` |

**Deliberately NOT changed (proportionality / risk):**
- **AI answer engines** (`perplexity.ai`, `you.com`) and **self-hosted SearXNG** instances are
  *not* host-matched as search engines — the first are text tools (keyword layer still applies),
  the second live on unbounded domains. Noted as backlog.
- **Per-card DOM backstop** for Tumblr/Wattpad/Minds *non-search* listing surfaces (e.g. an
  adult tag page whose query isn't an NSFW keyword) is deferred — it needs live-DOM selector
  verification. The high-yield **search/tag/browse** surfaces are already closed at the perimeter.
- **`PP_TESTING=true`** in `recordBlockAndRedirect` is left as-is (routes blocks to `about:blank`
  for the Playwright bridge); flip to `false` to restore `blocked.html` / redirect-link behaviour.
