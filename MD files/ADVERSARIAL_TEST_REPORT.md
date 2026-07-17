# Oath Light — Adversarial Perimeter Test Report

> A red-team pass driven as a "desperate addict seeking any dopamine," run against the
> **live extension in a real logged-in browser** via the Playwright MCP bridge. Unlike the
> graylist handoffs (which stress the *in-site filtering logic*), this report stresses the
> **perimeter** — the allowlist/blocklist membership that decides whether the filter even
> looks at a page. Pairs with [GRAYLIST_V2_TEST_REPORT.md](GRAYLIST_V2_TEST_REPORT.md) and
> [BLOCKING_STRATEGY.md](BLOCKING_STRATEGY.md).
>
> **Date:** 2026-06-20 · **Extension state verified live:** `window.__oathLightGraylistV2 === true`,
> `over18=0` cookie set, `fetch` patched. Accounts logged in (YouTube/Google, Reddit, Pinterest).
> **Method mandate:** every finding was *visually verified* on the rendered page, not asserted
> from predicate logic.

---

## 0. TL;DR — the one thing to fix

**Oath Light enforces by an allowlist of *names*. Anything not explicitly named gets *zero*
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
| 🔴 Critical | Whitelisted **Wikipedia** serves explicit sex-act photos + **inline video**, fully unfiltered (§3.1 whitelist short-circuit, only YouTube/Spotify were ever de-whitelisted) | ✅ **Fixed (Round 5)** — adult-path check moved **before** the whitelist; Wikipedia sex-act articles path-blocked (§12) |
| 🔴 Critical | **Obfuscated search queries** (`h3ntai`/`p0rn`/`p.o.r.n`/`pron`) bypass the nuclear keyword filter on **every** search surface — host layer normalized leet, query layer never did (Round 7, confirmed live on Mojeek + YouTube) | ✅ **Fixed (Round 7)** — `matchSearchQueryPorn` now de-spaces + leet-normalizes (Scunthorpe guards intact); `pron` added (§14) |

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
script injected (`__oathLightGraylistV2 === true`) but there is no rule for the host, so it does
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
| **Pinterest** | ⚠️ *Pinterest's own* filter suppressed queries — **Oath Light has no rule for it**; not a Oath Light win | "couldn't find any Pins" |

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
| 🟠 **Startpage Images** | `naked women` | suggestive / implied-nude (topless-from-behind, draped; headlines "strips completely NUDE", "Erotic Portrait Nude") — **not hardcore** | uncovered; Oath Light forces no safe param. Startpage's **own** "Safe Search: Moderate" default limits it — user can flip it to **Off** (dropdown on-page) and Oath Light won't re-enforce |
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

---

## 11. Round 4 — pre-beta sweep of the §9 backlog (privacy frontends, AI gen, SearXNG)

> Run **2026-06-21** (open-beta eve), live in the same logged-in browser (`__oathLightGraylistV2 === true`,
> `fetch` patched). This pass drives the **untested §9 backlog** — the vectors §1–§7 only *hypothesised*.
> Method mandate unchanged: every leak below was confirmed by what actually **rendered** (rendered NSFW
> post titles + real loaded `img` natural-dimensions / result counts), every "blocked" by a real
> `net::ERR_ABORTED` / `about:blank` route. Verdict: **three new structural leak classes** confirmed,
> and the Round 1–3 fixes that were re-probed all **held**.

### 11.1 🔴 NEW (highest value) — Privacy frontends bypass the *entire* host-keyed defense stack
Every Reddit/YouTube/X defense keys on the real hostname (`reddit.com` / `youtube.com` / `x.com`).
An open-source **mirror** serves the same content on an arbitrary community domain, where the graylist
content script still injects (`__oathLightGraylistV2 === true`) but **does nothing** — there is no rule
for the host. Confirmed live:

| Frontend (software) | URL driven | What rendered | Defenses bypassed |
|---|---|---|---|
| **Redlib** (Reddit) | `safereddit.com/r/nsfw` → redirected to `redlib.catsarch.com/r/nsfw` | Page title **"Not Safe for Work"**, **275** post elements, NSFW titles (e.g. *"Her face is the best seat in the house NSFW"*), **full-resolution media loaded** (4032×6048, 683×1024, 800×1100 jpeg) **proxied through `redlib.catsarch.com/img/`** | `over18=0` cookie, `/r/` path block, `over_18` API scrub, nuclear search-keyword filter — **all** key on `reddit.com`, none fire |
| **Invidious** (YouTube) | `yewtu.be/search?q=lingerie+try+on+haul` | **117** video result elements (title *"Lizeth Ramirez Savage X Fall Try-On Haul"* …) | Forced Restricted Mode (`PREF` cookie) + `GRAYLIST_SEARCH_ROUTES` nuclear keyword block — both key on `youtube.com` |
| **Nitter** (X) | `xcancel.com/search?f=media&q=nsfw` | Reached the instance's **own error page** (X upstream rate-limit), **not** a Oath Light block — host is uncovered | X `possibly_sensitive` scrub keys on `x.com` |

**Why it's the worst hole on the board:** redlib **re-proxies the images through its own domain**
(`/img/…`), so even a hypothetical CDN-level block wouldn't help; and the class is open-ended —
**libreddit, teddit, safereddit, redlib.*** (Reddit); **piped, viewtube** (YouTube); **rimgo** (Imgur);
**quetre** (Quora); **scribe.rip** (Medium); **proxitok** (TikTok). Nitter is structurally uncovered too
but **low-yield today** because X's API lockdown breaks most instances (as seen).

**Fix (the important one):** you cannot enumerate the infinite set of instance hostnames. Detect the
**software fingerprint** instead — these frontends emit stable, instance-independent markers:
`<meta>`/footer "redlib"/"libreddit" branding + the `/img/` & `/vid/` proxy paths; Invidious's
`<html>` / `window` globals + `/vi/` proxy; Nitter's `<meta name="generator">`. A generic `content.js`
detector that recognises a frontend and then **blocks (or applies the upstream platform's NSFW filter)**
regardless of host is the same label-over-host philosophy the graylist already uses — applied to the
perimeter. (Hostname allow/deny will always lose this race.)

### 11.2 🔴 NEW — "Uncensored" AI gen / character platforms slip the stem layer
The domain-keyword stems (`civitai`, `spicychat`, `janitorai`, `crushonai`, `dreamgf` …) match only the
**registrable label**, and the curated blacklist covers the **brand-name companion** apps — but the
general-purpose "uncensored" generators/hubs are uncovered:

| Site | Result | Note |
|---|---|---|
| `perchance.org/ai-text-to-image-generator` | 🔴 **reachable** | own title *"AI Image Generator (free, no sign-up, unlimited)"*; label `perchance` ∉ stems, not listed |
| `mage.space` | 🔴 **reachable** | own title literally *"Mage — Unlimited & **Uncensored** AI Image & Video Generator"* |
| `tensor.art` | 🔴 **reachable** | R-18 AI-art platform (Cloudflare challenge, not a PP block) |
| `chub.ai` | 🔴 **reachable** | major uncensored NSFW character-card / roleplay hub |
| `candy.ai` | ✅ **blocked** (`ERR_ABORTED`) | on curated list |
| `crushon.ai` | ✅ **blocked** | on curated list |
| `seaart.ai` | ✅ **blocked** | on curated list |

**Fix:** add `perchance.org` (at least the AI generator/chat paths), `mage.space`, `tensor.art`,
`chub.ai`/`chub.ai/venus`, plus the obvious neighbours (`yodayo.com`, `pixai.art`, `figgs.ai`) to the
blacklist. A bare `perchance`/`mage`/`tensor` stem would over-match SFW words — prefer explicit hosts.

### 11.3 🔴 NEW (visually confirmed) — SearXNG instances serve unfiltered aggregated image search
`searx.be/search?q=naked+women&categories=images&safesearch=0` → **100 result articles, 100 loaded
thumbnails**, all proxied through `searx.be/image_proxy?url=…` (the live **Google/Bing image index with
SafeSearch stripped**). Oath Light appended **no** forced param and did **not** block — `SEARCH_ENGINES`
can't host-match the unbounded SearXNG instance space (the exact reason §10 left it as backlog). This is
the Yandex/Brave class but worse: it's the mainstream engines' own index, unfiltered, on an arbitrary host.

**Fix:** SearXNG is also **fingerprintable** — `<meta name="generator" content="searxng/…">`, the
`/image_proxy` path, the `categories=`/`safesearch=` params. Same generic `content.js` detector as §11.1:
recognise a Searx/SearXNG instance → force `safesearch=2` (redirect) or deny the `categories=images`
surface. Folds into one mechanism with the privacy-frontend fix.

### 11.4 🟡 Proxy list is finite — concrete new example (re-confirms §3.2)
`api.codetabs.com/v1/proxy/?quest=<blocked-url>` → **not blocked**; the host isn't in
`BYPASS_PROXY_DOMAINS` and `unwrapBypassUrl` doesn't recognise the `quest=` param, so the wrapped target
is never extracted/re-checked. (codetabs' *own* API returned "Bad request" on the test URLs, so no porn
actually rendered — but the **Oath Light defect** — an uncovered proxy host + unparsed wrapper param —
is real.) Generalises to any reader/CORS/web proxy off the ~25-entry list. Add `api.codetabs.com` and the
generic `?url=`/`?quest=`/`?u=` unwrap; longer-term the finite-list approach needs a generic
"this response is a proxied foreign page" heuristic.

### 11.5 ✅ Regressions re-probed — all HELD (don't lose these)
| Surface | Test | Result |
|---|---|---|
| **Yandex Images** (§1.1 fix) | `yandex.com/images/search?text=naked women` | ✅ blocked — `ERR_ABORTED` (Tier-2 media-surface deny) |
| **Reader-proxy unwrap** (§3.2 fix) | `r.jina.ai/https://www.pornhub.com/` | ✅ blocked — `ERR_ABORTED` (unwrap → re-check) |
| **YouTube Restricted Mode reaches Shorts** (§1.4 fix) | `youtube.com/shorts/` | ✅ `PREF` cookie = `f2=8000000` (Restricted Mode ON); Shorts feed restricted |
| **NSFW companion brands** | candy.ai / crushon.ai / seaart.ai | ✅ all blocked |
| **NSFW file host** | `catbox.moe` | ✅ blocked — `ERR_ABORTED` |

### 11.6 Noted but not a new finding
- **Twitch** `directory/all/tags/Hot Tub` → reachable, uncovered platform; suggestive-class only (Twitch
  ToS caps it), same bucket as Giphy/Tenor. Not driven to a hardcore leak.
- **Telegram `t.me`** channel-block still not built (known backlog) — not driven to a specific channel.
- **File hosts** are mixed: `catbox.moe` is blocked, but `mega.nz`/`pixeldrain`/Discord-CDN were not
  individually driven this round.

### 11.7 Round-4 bottom line
The Round 1–3 enforcement held everywhere it was re-tested. The remaining exposure is now clearly
**one shape: open-ended hostnames that Oath Light can't enumerate** — privacy frontends (§11.1), SearXNG
instances (§11.3), and off-list proxies (§11.4). All three want the *same* fix the graylist already
proved out: **stop matching hosts, start matching software/content fingerprints in `content.js`** (stable
across instances, survives the domain churn). Plus a small blacklist top-up for the uncovered AI
platforms (§11.2). Highest ROI before beta: the generic frontend/SearXNG fingerprint detector — it closes
the single highest-yield addict path found in this entire report.

### 11.8 Fixes applied (enforcement pass — 2026-06-21, manifest 3.2.0)

Every Round-4 finding is enforced in code. Validated by the regression harness
(`test-adversarial-fixes.cjs`, **69/69**) plus live re-test in the reloaded extension.

| # | Finding | Fix | File |
|---|---|---|---|
| §11.1 | Privacy frontends bypass all host-keyed defenses | **(a)** `content.js` `setupFrontendSoftwareBlock()` — a generic, instance-independent **fingerprint detector** (top-frame only): Redlib/Libreddit via the stable `<meta name=description>` "front-end to Reddit" (+ source-repo links), Invidious via the "- Invidious" title (+ `iv-org/invidious` link), Nitter via its generator meta, Piped/rimgo/teddit/quetre/scribe/proxitok via their source-repo footer links → hide page + `notifyBlock`. **(b)** `FRONTEND_INSTANCE_DOMAINS` seed list hard-blocks ~40 popular redlib/invidious/piped/nitter/rimgo instances at the **navigation layer** (fires before their anti-bot challenge even loads). Code-host domains (github/gitlab/codeberg…) are exempted to avoid FPs. | `content.js`, `background.js` |
| §11.2 | Uncovered "uncensored" AI gen/character platforms | `EXTRA_BLACKLIST_DOMAINS` (STEP 3a) blocks `mage.space`, `tensor.art`, `tusiart.com`, `chub.ai`/`characterhub.org`, `yodayo.com`, `pixai.art`, `figgs.ai`, `sakura.fm`. `perchance.org` is **path-scoped** (`isBlockedPerchancePath`): only `/ai-*`, image-generator, character-chat & nsfw paths block — the SFW generators survive. (candy.ai/crushon.ai/seaart.ai were already listed.) | `background.js` |
| §11.3 | SearXNG serves unfiltered aggregated image search | The same `content.js` detector recognises a Searx/SearXNG instance (generator meta / `docs.searxng.org` link / `/image_proxy`) and **scope-blocks only the leak surface** (`categories=images/videos`, `safesearch=0/1`, or a rendered `image_proxy` thumbnail) → general private **text** search stays usable. Deliberately *not* navigation-blacklisted (preserves the legit use). | `content.js` |
| §11.4 | Finite proxy list / unparsed wrapper param | `unwrapBypassUrl` now also reads the `quest=` param (codetabs) alongside `url`/`u`; `corsproxy.org`, `proxy.cors.sh`, `whateverorigin.org`, `api.codetabs.com` added to both the unwrap branch and `BYPASS_PROXY_DOMAINS` (bare visit blocked). | `background.js` |

**Live-verified after reload (2026-06-21):**
- `mage.space` → `ERR_ABORTED`; `perchance.org/ai-text-to-image-generator` → `ERR_ABORTED` while `perchance.org/welcome` (SFW) renders normally.
- `redlib.catsarch.com/r/nsfw`, `yewtu.be` (invidious) search, `xcancel.com` (nitter) → **`ERR_ABORTED` at navigation**, instant, *before* their anti-bot challenge loads (seed list). The content.js detector independently routed them to `about:blank` post-challenge before the seed list was added — both layers confirmed.
- **SearXNG** (`searx.be`): image search (`categories=images&safesearch=0`) → `about:blank` (blocked); **text** search (`categories=general`) → renders 10 results, page not hidden — **stays usable**.
- Controls: `en.wikipedia.org/wiki/Cat`, `perchance.org/welcome` → untouched.
- **FP caught & fixed during this verification:** the first searx implementation triggered on any rendered `/image_proxy` thumbnail and wrongly blocked *text* search (SearXNG proxies favicons through `/image_proxy` on general search too). Re-gated to block on the URL only (`categories=images/videos`, `safesearch=0/1`). Exactly the kind of leak-vs-overblock the "verify on the rendered page" rule exists to catch.

**Validation:** regression harness `test-adversarial-fixes.cjs` → **69/69**.

**Design note (per project triage rule):** pure-proxy frontends (redlib/invidious/nitter/piped/rimgo) have **no SFW value to preserve** — the canonical platform is the legit path — so they're hard-blocked. SearXNG and perchance **do** have legit surfaces, so they're filtered/path-scoped instead of blanket-blocked. The fingerprint detector is the durable catch-all; the seed lists are the immediate belt-and-suspenders for the highest-traffic instances.

---

## 12. Round 5 — the whitelist perimeter ("trusted" hosts), driven again

> Run **2026-06-21**, live in the same logged-in browser (`__oathLightGraylistV2 === true`,
> `fetch` patched). This pass re-attacked the one class Round 1–4 *named but never fully closed*:
> the **§3.1 whitelist short-circuit** — any host in `WHITELIST_DOMAINS` returns
> `{ blocked:false, tier:'whitelist' }` at `shouldBlockUrl` STEP 2 and skips **every** content
> check. Round 1 only de-whitelisted YouTube/Spotify; the rest of the whitelist stayed a total
> bypass. Method mandate unchanged: the leak below was confirmed by what actually **rendered**
> (real inline media + same-origin article sweep), not by predicate logic.

### 12.1 🔴 NEW (highest value) — whitelisted **Wikipedia** serves explicit sex-act photos *and inline video*, fully unfiltered
`wikipedia.org` is whitelisted (`background.js` ~L232), so `en.wikipedia.org` short-circuits at
STEP 2. The `checkTrustedAdultPath` block that protects **Wikimedia Commons** ran at STEP 7 —
*after* the whitelist already returned — and was scoped to `commons.wikimedia.org` only. Net
result: Wikipedia's explicit articles got **zero** filtering. Confirmed live:

- **`/wiki/Ejaculation`** → rendered, **not blocked** (`tier:'whitelist'`); DOM carried **2 inline
  `.mw-tmh-player` video players**, one captioned **"Video of a human male ejaculating"**, plus a
  photographic ejaculation sequence. (Screenshot tool timed out on the live video element; the
  leak is evidenced by the DOM inventory + caption on the rendered, unblocked page.)
- **Same-origin sweep** of 12 sex-act articles — **all HTTP 200, all `tier:'whitelist'`:**

  | Article | Inline video players | Explicit photos (filename-matched) |
  |---|---|---|
  | `Oral_sex` | 1 | 4 |
  | `Fellatio` | 1 | 4 |
  | `Orgasm` | 1 | 6 |
  | `Anal_sex` | 0 | 10 |
  | `Cunnilingus` | 0 | 7 |
  | `Masturbation` | 0 | 6 |
  | `Sexual_intercourse` | 0 | 5 |
  | `Cum_shot` / `Facial_(sex_act)` / `Creampie_(sexual_act)` / `Pearl_necklace_(sexuality)` | 0 | 2–4 each |

**Why it's high-value:** Wikipedia is the single most *trusted, endless, never-suspect* host on
the board — the perfect relapse vector precisely because no filter is expected to be watching it.
The class is not Wikipedia-specific: **every** whitelisted domain (`quora.com` NSFW spaces,
`amazon.com`/`ebay.com` adult listings, …) inherits the same total bypass. Quora was Cloudflare-
challenge-walled under automation but is structurally identical (code-confirmed `tier:'whitelist'`).

### 12.2 Other results
| Vector | Result | Note |
|---|---|---|
| **telegra.ph** (`/Sample-Page-…`) | 🟡 **uncovered** (re-confirmed) | Renders arbitrary user HTML + images inline; no rule, no porn stem, not whitelisted/blacklisted. The known §7.5/§9 Telegram-adjacent host vector — any porn link shared in a Telegram channel renders fully unfiltered. Backlog (needs a content/host heuristic). |
| **Privacy-frontend fresh instances** (off-seed redlib `redlib.private.coffee`, invidious `invidious.f5.si`, libreddit `libreddit.bus-hit.me`) | ⚪ **inconclusive** | Every instance tried was Anubis/Cloudflare **anti-bot challenge-walled** (HTTP 418 → 502) or dead (`ERR_NAME_NOT_RESOLVED`). That's the *instance's* bot defense fighting the Playwright bridge — **not** a Oath Light result — so the content.js fingerprint detector (the Round-4 keystone, which fires only once real content renders) could **not** be exercised end-to-end. Honest non-result; needs a non-challenge instance or a manual (human-driven) pass to verify. The seed-list navigation block (§11.1) is unaffected and still 6/6 in the harness. |

### 12.3 Fix applied (enforcement pass — 2026-06-21, manifest 3.3.0)
User decisions for this round: **(scope)** block explicit **sex-ACT/practice** articles only —
keep pure anatomy / reproduction / health / sex-education articles allowed; **(architecture)** the
proper §3.1 fix — the whitelist grants *navigation trust* but **no longer suppresses** the
trusted-host adult-path content check.

| # | Finding | Fix | File |
|---|---|---|---|
| §12.1 / §3.1 | Whitelist short-circuit hides explicit content on trusted hosts | **(architecture)** `checkTrustedAdultPath` **moved to STEP 1.5 — before the whitelist** (was STEP 7, after it). The whitelist now grants navigation trust without suppressing the adult-path block, so it fires on whitelisted hosts. Generalizes: any whitelisted host can be added to `TRUSTED_HOST_ADULT_PATH`. | `background.js` |
| §12.1 | Wikipedia explicit sex-act articles unfiltered | **(scope)** `TRUSTED_HOST_ADULT_PATH` gains a `wikipedia.org` entry (covers ALL language + `m.` subdomains via the parent-domain fallback) matching the explicit **sex-act/practice** article slugs (ejaculation, oral/anal/group sex, masturbation, orgasm, fellatio, cunnilingus, creampie, cum_shot, facial/pearl_necklace/fingering `_(sex…)`, bukkake, gangbang, list_of_sex_positions, fisting, coprophilia, urolagnia, hentai, ahegao, sexual_intercourse, …). Each slug is anchored at `/wiki/` and bounded by `(?![a-z])`. | `background.js` |
| §12.1 | Over-block risk (educational / homographs) | Scope is **sex-acts only**: pure anatomy/reproduction/health/sex-ed articles stay allowed, and SFW-colliding slugs are deliberately omitted — `squirting` (→ *Squirting_cucumber*), `golden_shower` (→ *Golden_shower_tree*), `deep_throat` (→ Watergate / X-Files). Verified non-blocked: `Sexual_reproduction`, `Sex_education`, `Human_sexuality`, `Puberty`, `Pregnancy`, `Oral_history`, `Analysis`, `Cream_pie` (food), `Facial` (beauty), `Fingering_(guitar)`. | `test-adversarial-fixes.cjs` |

**Validation:** regression harness `test-adversarial-fixes.cjs` → **92/92** (was 69; +23 Round-5
cases: 11 sex-act blocks incl. de./en.m. subdomains + paren-disambig titles, 12 educational/FP
allows). The harness executes the **real** edited `background.js` via `vm`, so it faithfully tests
`shouldBlockUrl`. **Live re-test after extension reload — PASSED ✅:** `/wiki/Ejaculation` and
`/wiki/Oral_sex` → `net::ERR_ABORTED` (blocked); `/wiki/Sexual_reproduction` (educational),
`/wiki/Squirting_cucumber` (→ *Ecballium* plant), `/wiki/Oral_history` → render normally (no
over-block, homograph + anchoring FPs avoided). (The pre-reload live check still rendered
`/wiki/Ejaculation` only because Chrome doesn't hot-reload unpacked extensions on file change —
the running service worker held the pre-edit `background.js`.) Same harness-then-reload process as
Round 4.

### 12.4 Round-5 bottom line
The deferred **§3.1 whitelist class is real and was exploitable on the highest-trust host in the
allowlist.** It's now closed architecturally (adult-path check runs *before* the whitelist) and
scoped on Wikipedia to explicit sex-acts only. Remaining exposure carried forward as backlog:
the **other** whitelisted hosts (Quora/Amazon — the mechanism now supports them, pending
verified adult paths), **telegra.ph** and similar uncovered user-content hosts, and a
**human-driven re-verification of the privacy-frontend fingerprint detector** (automation can't
clear the instances' anti-bot challenges).

---

## 13. Round 6 — the "stand where it isn't looking" perimeter, re-driven

> Run **2026-06-22**, live in the same logged-in browser (`__oathLightGraylistV2 === true`,
> enforcement confirmed by the Round-5 control: `/wiki/Ejaculation` → `net::ERR_ABORTED`). This
> pass went back to the report's own TL;DR thesis — *the addict never defeats the filter, they
> stand where it isn't looking* — and swept the **uncovered-host classes** the earlier rounds
> named but never enumerated. **Ethics line held:** no NCII / "leaked"-content URLs were sourced
> (the search for that was refused on purpose); leaks are evidenced by what *rendered* on benign
> probes + the real `shouldBlockUrl` coverage map (`round6-probe.cjs`, which loads the actual
> 100k-domain blacklist so blacklist-dependent rows are authoritative — controls redgifs/catbox/
> imagebam/baraag all resolve via blacklist, pornhub/bunkrr via keyword, Ejaculation via trusted-
> path, yewtu.be via frontend-instance). **34 perimeter leaks flagged**, in five classes.

### 13.1 🔴 NEW (highest value) — whitelisted **cloud file hosts** are a hardcore-capable total bypass
Round 5 closed the §3.1 whitelist short-circuit *only* for Wikipedia/Commons (via
`checkTrustedAdultPath` at STEP 1.5) and explicitly carried "the other whitelisted hosts" forward
as backlog. The dangerous members of that backlog are the **cloud file hosts**, which — unlike
Quora/Amazon — render **arbitrary user-uploaded files with no self-censorship at all** (i.e.
hardcore-capable). All short-circuit at STEP 2 (`tier:'whitelist'`), so blacklist/keyword/graylist
never run:

| Whitelisted host | `shouldBlockUrl` | Why it's a leak |
|---|---|---|
| `drive.google.com` | `allow (whitelist)` | a shared Drive **folder of porn** renders inline previews, fully unfiltered |
| `docs.google.com` | `allow (whitelist)` | embedded images in a public doc |
| `dropbox.com` | `allow (whitelist)` | public file/folder shares |
| `onedrive.live.com` | `allow (whitelist)` | public OneDrive shares |
| `quora.com` / `crunchyroll.com` / `amazon.com` / `ebay.com` | `allow (whitelist)` | NSFW spaces / ecchi / sexual-wellness listings (suggestive-capped) |

**Fix:** the architecture for this already exists (Round 5 moved `checkTrustedAdultPath` ahead of
the whitelist). Cloud file hosts have **no enumerable adult path** (the porn is in opaque file IDs),
so a path rule can't catch them — they need either (a) removal from the whitelist so they flow
through the normal pipeline + a graylist DOM/preview backstop, or (b) acceptance as a documented
residual (file-host delivery, per the strategy doc's "file hosts slide" note). At minimum
Quora/Amazon/eBay should get `TRUSTED_HOST_ADULT_PATH` entries like Wikipedia did.

### 13.2 🔴 NEW — generic image / file hosts with no porn stem (blacklist-only coverage misses them)
These have **no porn stem** in the registrable label and are **not on the blacklist**, so all three
host layers are blind. They are classic NSFW gallery/CDN hosts and render arbitrary uploads with no
self-censorship. **Live-confirmed reachable, PP-injected, no block:** `pixhost.to` (upload UI
rendered), `cdn.discordapp.com` (served `0.png 256×256` directly — i.e. any Discord-shared NSFW
attachment streams unfiltered). Structurally uncovered (probe + grep): `imgbox.com`, `imx.to`,
`vipr.im`, `ibb.co`, `imgbb.com`, `imgchest.com`, `jpg.church`/`jpg5.su`, `media.discordapp.net`.
*(Positive control: the **stem'd / listed** neighbours `imagebam.com`, `imagevenue.com`,
`litterbox.catbox.moe` are correctly blocked — so the gap is specifically the no-stem hosts.)*

**Fix:** add the popular no-stem image/album hosts to the blacklist (`pixhost.to`, `imgbox.com`,
`imx.to`, `vipr.im`, `ibb.co`/`imgbb.com`, `imgchest.com`, `jpg.church`+aliases). Discord CDN
(`cdn.discordapp.com`/`media.discordapp.net`) is mixed-use (every Discord image rides it) — same
class as the strategy doc's file-host call; treat as residual or block only on a referer/heuristic.

### 13.3 🔴 NEW — Telegram-adjacent publishing / paste hosts (named ×3, finally enumerated)
`telegra.ph` was flagged uncovered in §7.5, §9, and §12.2 but never driven; Round 6 confirms it
**and its whole class**. All render arbitrary user HTML + inline images (Telegram CDN for
telegra.ph), no porn stem, not listed, not whitelisted. **Live-confirmed reachable + PP-injected +
no block:** `telegra.ph`, `justpaste.it`. Structurally uncovered: `graph.org` (telegra.ph alias),
`teletype.in`, `rentry.co`/`rentry.org`, `write.as`, and `t.me/s/<channel>` web previews.

**Fix:** blacklist the publishing/paste hosts that are predominantly abused for NSFW dumps
(`telegra.ph`+`graph.org`, `justpaste.it`, `rentry.co/org`), or give them a graylist DOM image
backstop. `t.me/s/` channel previews remain the long-standing un-built Telegram vector.

### 13.4 🟡 Foreign search engines — uncovered Tier-2 class, but self-censor-capped
The Round-1 `SEARCH_ENGINES` Tier-2 list omits the major **non-Western** engines. Oath Light forces
no param and blocks no media surface on them. **Live-driven:**
- **Baidu Images** (`image.baidu.com`, query `naked woman nude`) → **49 images rendered, not
  blocked** — but Baidu's state-mandated censorship held them to **artistic/suggestive** (sculpture,
  partial-nude art, lingerie), **no hardcore**. Evidence: `round6-baidu-naked.jpeg`.
- **Naver Images** (`search.naver.com`, `naked woman`) → not blocked, but Naver's real-name adult
  gate returned **"no results"** (`검색결과가 없습니다`). Evidence: `round6-naver-naked.jpeg`.
- Structurally uncovered too: `pic.sogou.com`, `search.seznam.cz/obrazky`, `ask.com`.

This is the **Startpage/DuckDuckGo pattern**: a real enforcement gap whose realized severity is
capped by the engine's *own* strong self-censorship. Lower priority than §13.1–§13.3.
**Fix:** add Baidu/Naver/Sogou/Seznam to Tier-2 (block image/video surface + NSFW query) for
defense-in-depth; the engines that *don't* self-censor (Yandex/Brave) are already covered.

### 13.5 🟡 Federated platforms — navigation-allow is by-design; the gap is SSR first-paint (§6.1)
`lemmy.world`, `kbin.social`, `mastodon.social` are `allow` at navigation **by design** —
`graylist-inject.js` has Lemmy/Mastodon API rules that scrub `nsfw`/`sensitive` from the JSON.
The residual is the **known §6.1 SSR first-paint gap**: lemmy-ui is server-rendered, so a NSFW
community's first screen lands in the DOM before any XHR the patch can see. Not a new class — it's
the carried-forward SSR backstop. *(NSFW-permissive instances `baraag.net`/`pawoo.net` are already
blacklisted — good.)*

### 13.6 Round-6 bottom line
The graylist machinery and the host-keyed defenses (keyword stems, the 100k blacklist, frontend
fingerprinting, the Round-5 whitelist-path fix) **all held where they're pointed** — every control
blocked correctly. The exposure is unchanged in *shape* from the report's own thesis and now
enumerated concretely: **uncovered hosts that render arbitrary content with no self-censorship** —
the whitelisted **cloud file hosts** (§13.1, the hardcore-capable one), the no-stem **image/CDN
hosts** (§13.2), and the **paste/publishing hosts** (§13.3). Highest ROI before shipping: blacklist
top-ups for §13.2/§13.3 (cheap, immediate) and a whitelist-semantics decision for the cloud file
hosts in §13.1 (the only hardcore-capable leak on the board). Artifacts: `round6-probe.cjs`
(coverage map, 34 leaks), `round6-baidu-naked.jpeg`, `round6-naver-naked.jpeg`.

### 13.7 Fixes applied (enforcement pass — 2026-06-22, manifest 3.4.0)

Every actionable Round-6 finding is enforced in code. Validated by `round6-probe.cjs` (now a
**48/48** pass/fail retest with the real 100k blacklist loaded — it asserts the new blocks AND
that normal/SFW use on the same hosts still passes) plus the full regression harness
`test-adversarial-fixes.cjs` (**92/92**, no Round 1–5 regressions). Both run the real edited
`background.js` in a vm, so they faithfully test `shouldBlockUrl`.

| # | Finding | Fix | File |
|---|---|---|---|
| §13.1 | Whitelisted hosts' on-site adult **search** waved through | New `TRUSTED_HOST_SEARCH` + `checkTrustedHostSearch`, wired at **STEP 1.6 (before the whitelist)** like the Round-5 adult-path check: a porn-keyword query on `quora.com`/`amazon.com`/`ebay.com`/`crunchyroll.com` → block; every SFW search/browse on those hosts stays usable. | `background.js` |
| §13.1 | Whitelisted **cloud file hosts** (drive/docs/dropbox/onedrive) | **Documented residual** (in code + report): core productivity tools, no enumerable adult path, can't be blacklisted — same call as the strategy doc's "file hosts slide." The architecture (STEP 1.5/1.6 before whitelist) is ready if a future enumerable surface appears. | — |
| §13.2 | No-stem image/album hosts blind to all 3 host layers | `EXTRA_BLACKLIST_DOMAINS` += `pixhost.to`, `imgbox.com`, `imx.to`, `vipr.im`, `imagetwist.com`, `imgdrive.net`, `acidimg.cc`, `imgview.net`, `pixroute.com`, `imgadult.com`, `turboimagehost.com`, the `jpg.*`/`host.church` chevereto family, and the mixed-use `ibb.co`/`imgbb.com`/`imgchest.com` (flagged removable). Discord CDN left as a mixed-use residual. | `background.js` |
| §13.3 | Telegram-adjacent paste/publishing hosts | `EXTRA_BLACKLIST_DOMAINS` += `telegra.ph`, `graph.org`, `justpaste.it`, `teletype.in`, `rentry.co`, `rentry.org`, `write.as`, `controlc.com`, `ctxt.io`. `t.me/s/` channel previews remain the un-built Telegram vector. | `background.js` |
| §13.4 | Foreign engines (Baidu/Naver/Sogou/Seznam) uncovered | `SEARCH_ENGINES` Tier-2 += the four engines (narrow host regexes so `tieba.`/`baike.`/`fanyi.baidu.com`, `mail.naver.com` are untouched); `isMediaSearchSurface` made **host-aware** (`image.`/`pic.`/`video.` subdomains) + `where=`/`tn=` params + `obrazky` path → image surfaces & NSFW queries blocked, SFW web search preserved. | `background.js` |
| (cosmetic) | reason label | STEP 3a return relabelled `blacklist_ai_platform` → `blacklist_supplemental` (the set now spans AI + image + paste hosts). | `background.js` |

**Deliberately NOT changed (proportionality):** cloud file hosts (§13.1 residual), Discord CDN /
`media.discordapp.net` (every Discord image rides it — mixed-use), `t.me/s/` previews (separate
channel-block mechanism, still backlog), and the §13.5 federated SSR first-paint gap (the known
§6.1 DOM-backstop work, unchanged).

**Live re-verification — PASSED ✅** (2026-06-22, after extension reload to 3.4.0):
- **Blocked live** (all were leaking before the fix): `telegra.ph` → `net::ERR_ABORTED` (§13.3);
  `pixhost.to` → `net::ERR_ABORTED` (§13.2); `image.baidu.com/...word=naked%20woman` → routed to
  `about:blank` (§13.4, was 49 rendered images in §13.4 above); `quora.com/search?q=porn` →
  `net::ERR_ABORTED` (§13.1 — blocked despite Quora being whitelisted, i.e. STEP 1.6 fired).
- **No over-block** (rendered normally): `en.wikipedia.org/wiki/Cat`,
  `quora.com/search?q=how+to+learn+python` (SFW search stays usable),
  `baike.baidu.com/item/猫` (the narrow Baidu regex left the encyclopedia untouched).

Live behaviour matched the harness exactly. (Same harness-then-reload process as Rounds 4 & 5;
Chrome doesn't hot-reload unpacked extensions, so the reload was required for the running service
worker to pick up the edited `background.js`.)

---

## 14. Round 7 — obfuscated search queries ("type it weird, walk right through")

> Run **2026-06-22**, live in the same logged-in browser (extension attached — confirmed by the
> control `yandex.com/images/search?text=naked women` → `net::ERR_ABORTED`). After six rounds of
> closing *host*-shaped holes, this pass went after the one normalization the **query** layer never
> got. The hostname layer has normalized leetspeak since Batch-5 (`checkDomainKeywords` →
> `normalizeLeet`, plus full punycode IDN decoding), so `p0rnhub.com` is blocked. But the **nuclear
> search-keyword filter** (`matchSearchQueryPorn`) — the ground-truth-independent layer that backs
> Tier-2 engines, every graylist search route, the trusted-host search, and Reddit/Patreon — only
> lowercased and stripped `[_-.,]`. It **never de-obfuscated**. So the addict doesn't defeat the
> filter; they just *spell the word funny*. Method mandate unchanged: the leak was confirmed by what
> actually **rendered**, and the coverage map is the real `shouldBlockUrl` (`round7-probe.cjs`).

### 14.1 🔴 NEW (headline) — leetspeak / separator queries bypass the nuclear keyword filter on EVERY search surface
`matchSearchQueryPorn` (`background.js` ~L481) built one haystack:
`' ' + q.toLowerCase().replace(/[_\-.,]+/g,' ')…`, then whole-word + `≥4`-char run-together matched
the keyword lists. No leet map, no de-spacing. The asymmetry is the bug: **the host layer normalizes,
the query layer doesn't.** Trivial obfuscations therefore sail through:

| Obfuscation | Why it slips | Example that bypassed |
|---|---|---|
| **Leetspeak** (`0→o 3→e 4→a 1→i 5→s 7→t`) | keyword list is ASCII; `h3ntai ≠ hentai` | `h3ntai`, `p0rn`, `pu55y`, `b00bs`, `s3x`, `n4ked` |
| **Separators between letters** | `replace(/[_\-.,]/)` → `"p o r n"` (4 single tokens), never reforms `porn` | `p.o.r.n`, `p o r n`, `h-e-n-t-a-i` |
| **Metathesis / slang** | not a substitution at all — `pron` wasn't a listed term | `pron`, `pr0n` (`→pron`) |

**Confirmed live (two independent surfaces):**
- **Mojeek** (Tier-2 engine): `mojeek.com/search?q=hentai` → `net::ERR_ABORTED` (blocked), but
  `mojeek.com/search?q=h3ntai` → **rendered**, page title *"h3ntai - Mojeek Search"*, and the web
  results **surfaced an actual hentai-porn link** — `hentai69.hotviber.fr` *"H3ntai 69, le Sexe
  Orientale"*. Porn hosts self-index under leet SEO, so the obfuscated query both bypasses Oath Light
  **and** realizes content.
- **YouTube** (graylist route): `youtube.com/results?search_query=porn` → blocked, but
  `youtube.com/results?search_query=p0rn` → **rendered** (title *"p0rn - YouTube"*, not `about:blank`)
  — Oath Light's nuclear search layer took no action (YouTube's own Restricted Mode still caps the
  results, but the PP layer demonstrably failed).

**Authoritative coverage** (`round7-probe.cjs`, real `shouldBlockUrl` + real 100k blacklist) — pre-fix
the obfuscated query bypassed **12/12** surfaces while the plain keyword blocked: Tier-2 engines
(Mojeek/Gibiru/Brave), graylist routes (YouTube/Pixiv/Tumblr), trusted-host search on whitelisted
**Quora**, and Reddit. The same `matchSearchQueryPorn` backs ~25 graylist search routes + 4 Tier-1 +
14 Tier-2 engines + 4 trusted hosts + Reddit/Patreon, so the gap was **board-wide** for the keyword
layer (the image-surface deny on Tier-2 still held independently — `yandex.com/images` stayed blocked).

### 14.2 🟡 Reddit media subdomains (`redd.it`) — host-keyed defenses all miss the CDN
Every Reddit defense (`over18=0` cookie, `/r/` path block, `over_18` scrub, search-keyword filter)
keys on `reddit.com`. The media CDNs **`i.redd.it` / `preview.redd.it` / `v.redd.it`** and `redd.it`
short links are a **different registrable domain** with no rule, not on the blacklist — `shouldBlockUrl`
returns `allow` for all four (probe §B). A direct NSFW Reddit-hosted image/video hotlink renders
unfiltered. **Realized yield is low** (you must already hold the direct file URL — it's not a discovery
surface) and the host is **mixed-use** (every SFW Reddit upload rides the same CDN, with no per-URL NSFW
signal), so a blanket host-block would break SFW image opens. Same class as `cdn.discordapp.com` (§13.2):
**left as a documented residual**, flagged here for the record.

### 14.3 What HELD (controls re-probed)
The image/video-surface denies, the 100k blacklist, the trusted-path block, and the whitelist-search
block all fired correctly (`pornhub.com`, `yandex.com/images`, `/wiki/Ejaculation`, plain-keyword
searches → all blocked). SFW searches stayed usable (`weather`, `python tutorial`, `minecraft`,
`r/aww`). No regression in the full harness (92/92).

### 14.4 Fix applied (enforcement pass — 2026-06-22, manifest 3.5.0)

| # | Finding | Fix | File |
|---|---|---|---|
| §14.1 | Leet/separator/metathesis queries bypass the nuclear keyword filter | `matchSearchQueryPorn` rebuilt to test a small set of **de-obfuscated variants** with the *same* whole-word + `≥4`-run-together rule (so the `SUBSTRING_UNSAFE` + `len<4` Scunthorpe guards still hold): **(a)** new `deSpaceLetters()` folds runs of `≥3` single chars separated by `[\s._\-+*|/~]` back into a word (`"p o r n"`/`"p.o.r.n"`→`porn`) — requires single-char tokens so `"pen island"`/`"the rapist"` are untouched; **(b)** `normalizeLeet()` (the same map the host layer uses) applied to each base; **(c)** the **RAW** variant is always kept so digit-bearing keywords (`r34`/`rule34`/`18+`) — which leet-normalization would corrupt — still match. | `background.js` |
| §14.1 | `pron`/`pr0n` slang (metathesis, not a substitution) | Added `pron` to `HARD_PORN_KEYWORDS` + `SUBSTRING_UNSAFE_KEYWORDS` (whole-word only, so `apron`/`prone`/`pronoun` don't trip). | `background.js` |
| §14.2 | Reddit `redd.it` media CDN uncovered | **Documented residual** (mixed-use CDN, no per-URL NSFW signal, no discovery value) — same call as Discord CDN. | — |

**Validation:** `round7-probe.cjs` → **37/37** (12 obfuscation blocks across all surface types + 11
FP controls proving `pen island`/`the rapist`/`ps5`/`areas 51`/`apron`/`prone`/`rule34`/`18+` are
handled correctly + the redd.it residual rows). Full regression harness `test-adversarial-fixes.cjs`
→ **92/92** (no Round 1–6 regression). Both run the real edited `background.js` in a `vm`.

**Live status:** the *bug* was confirmed live pre-fix (Mojeek `h3ntai` rendered a porn link; YouTube
`p0rn` rendered). The *fix*'s live re-verification is pending the usual manual extension reload (Chrome
doesn't hot-reload unpacked extensions, so the running service worker still holds the pre-edit
`background.js` — same harness-then-reload caveat as Rounds 4–6; the harness is authoritative).

### 14.5 Round-7 bottom line
Six rounds hardened the *perimeter by host*; Round 7 found the perimeter was **phonetically porous** —
the keyword layer that every search surface leans on read only literal ASCII. One normalization
(`deSpaceLetters` + `normalizeLeet`, mirroring the host layer) closes leet, separator, and slang
obfuscation board-wide in a single function, with the Scunthorpe guards intact. The only carried-forward
residual is the mixed-use `redd.it` CDN (low-yield, no discovery value). The graylist machinery and all
host-keyed defenses held everywhere they were re-probed.
