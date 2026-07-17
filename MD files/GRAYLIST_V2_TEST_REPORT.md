# Graylist V2 — Live Test & Fix Report

> Handoff for the next agent. Records a full live-testing pass of the Graylist V2
> system against real sites (via the Playwright MCP **extension bridge**, driving
> the real browser with Oath Light installed), the bugs found, the fixes applied,
> and what remains. Pairs with [GRAYLIST_HANDOFF.md](GRAYLIST_HANDOFF.md) (design)
> and [BLOCKING_STRATEGY.md](BLOCKING_STRATEGY.md) (rationale).
>
> **Date:** 2026-06-17 · **Tested on:** real logged-in browser (extension id
> `lknpaoecooklfjgenmjpkdkahgoofank`), accounts logged in for X/Pixiv/Tumblr/
> Bluesky/Reddit/NexusMods/DeviantArt/Newgrounds + a Discord test account.

---

## 0. TL;DR

- **Two engine-level bugs found and fixed** — both affected *many* sites at once:
  1. **`scrub` orphaned nested-flag rows** (Reddit/Lemmy/Mangadex/Bluesky/X/Patreon shape) — the flagged item stayed in the list with only its child object deleted. **Fixed.**
  2. **The interceptor was `fetch`-only** — feeds loaded via **XMLHttpRequest** (DeviantArt, and any XHR SPA) were **100% unfiltered**. **Fixed (added XHR interception).**
- **Several site adapters fixed** (Newgrounds selectors, Discord, Tumblr field).
- **Five sites moved to whole-site blocking** by user decision (FurAffinity, SoFurry, Inkbunny, Weasyl, DeviantArt).
- **`PP_TESTING` is currently `true`** — **both** block destinations are PAUSED: the `blocked.html` screen **and** the user-configured "Redirect link". Both can crash/hang the Playwright automation bridge, so every block routes to a light `about:blank` instead. **Must be reverted before shipping** (this disables the real block screen *and* the redirect-link feature).

---

## 0.5 Session 2 update (2026-06-17, second pass) — VISUAL re-verification

> Methodology this pass: don't trust the site's own NSFW label or search alone —
> **browse the rendered page and look**. If a site routinely shows NSFW the platform
> itself leaves unlabeled (the DeviantArt problem), the label-based interceptor is
> structurally blind to it → **straight to the blacklist** (user directive, emphatic).

**Changes made (ALL need an extension reload to go live — see §6):**

1. **Bluesky → BLACKLISTED.** The label filter *works* (every `porn`-labelled search
   result was stripped from the DOM), but **~33% of NSFW results carry no Bluesky
   content label at all** — just `#nsfw` hashtags — and render fully (incl. explicit
   nudity). Raw `searchPosts` differential: of the first 12 results, 8 labelled
   (`porn`, all stripped) + **4 unlabelled NSFW that leaked**. Ground-truth filtering
   cannot reach those. Added `bsky.app` + `bsky.social` to `domains_part3.json`;
   removed the `bluesky` rule / `S.bsky` / `BSKY_NSFW` / `bsky.`+`/xrpc/` quick-match
   from `graylist-inject.js`; removed from both graylist UIs.

2. **Tumblr → CASING BUG FIXED (was a silent no-op).** The `www.tumblr.com` web API
   returns **camelCase** (`communityLabels.hasCommunityLabel`, `isNsfw`) but `S.tumblr`
   only checked **snake_case** (`community_labels.has_community_label`, `is_nsfw`).
   Against a live `/api/v2/timeline/search` response the OLD signal stripped **0/16**;
   the fixed signal (handles both casings) strips **16/16**. Tumblr's label *coverage*
   is good (16/16 NSFW posts were community-labelled) and explicit porn is banned
   platform-wide since 2018 → low under-tagging → **stays on the graylist**, fixed.

3. **Lemmy → `lemmynsfw.com` BLACKLISTED.** Entirely-NSFW instance (the NSFW split-off
   of lemmy.world); confirmed a live Lemmy API host. lemmy-ui is SSR (first-paint
   blind spot) so the per-item adapter can't cover an all-NSFW instance → blacklist.
   The mixed-instance Lemmy adapter stays (labeling is *structural* — NSFW communities
   enforce the `nsfw` flag → low under-tag risk; shares the proven `nsfwBool` scrubber).

4. **itch.io listing → PATH-BLOCK IMPLEMENTED.** The adult browse grid has no per-cell
   DOM marker, so item-hiding couldn't touch it. The itch.io `pageLabel` now hard-blocks
   adult browse paths: `/games/nsfw` and `/games/(tag|genre)-<adult-slug>`
   (nsfw/adult/hentai/eroge/porn/erotic/lewd/sex/r18/18-plus/futanari…). Regression
   22/22: adult paths blocked, SFW tags (adventure, 1800s, sexton, essex, horror) pass.

5. **Patreon → DOM SCRUB + PAGE-BLOCK (NOT blacklisted).** Initially flagged for
   blacklist (33% NSFW density on explore + the API scrub was provably bypassed),
   but that verdict was **wrong** and reversed: Patreon is the *opposite* of the
   under-tagged blacklist sites — it labels adult content **impeccably**. The only
   leak was a **transport blind spot**, not a labeling gap: Patreon is a Next.js app
   that **server-renders the first paint**, so `graylist-inject.js` (which only
   patches client `fetch`/XHR) never sees the initial explore/feed/creator HTML.
   Blacklisting would have destroyed thousands of SFW creators (journalism, podcasts,
   art) over a closable gap. Fix added to **`content.js` `DOM_LABEL_RULES`** (the SSR
   DOM-label engine), keyed on Patreon's own ground truth:
   - **Listings** (`/explore`, `/home`, recommendation rails): every adult card
     carries **`data-tag="nsfw-chip"`**. Hide the enclosing card. Live validation:
     **34/34 chips → 34 cards hidden, 0 SFW collateral, 238 SFW tiles preserved** (of
     272 total). Card boundary uses the **stable CSS-Modules prefix**
     `[class*="CreatorTile-module__"]` (the `sc-*` styled-component hashes rotate).
   - **Direct creator page** (`/<vanity>` → redirects to `/cw/<vanity>`): no chip
     rendered; the campaign's `is_nsfw` flag lives only in the SSR payload.
     `pageLabel` scans the SSR scripts but **scopes the flag to the current creator**
     (matches `is_nsfw:true` in the campaign object tied to `checkout/<slug>`),
     because recommended adult creators *also* embed `is_nsfw:true` on SFW pages.
     Live validation: **Diivesgames (adult) → BLOCK, Kurzgesagt (SFW) → ALLOW** even
     though Kurzgesagt's page contained 2 recommended-creator `is_nsfw:true` entries.
   - **Stays on the graylist** too — `graylist-inject.js` `S.patreon` (`is_nsfw`,
     snake-case, confirmed correct) still scrubs client-side fetches during in-app
     navigation (the SSR gap is first-paint only). Both layers now cover it.
   - ⚠️ **Not yet live-tested through the actual extension** — in the bridge browser
     `window.__oathLightGraylistV2 === false` and `fetch` was native, i.e. **the
     extension wasn't injecting this session**. The rule logic + selectors were
     validated by replaying them in-page via the DevTools bridge; needs an extension
     reload + live confirmation (see §6 / per-site table).

6. **Patreon SEARCH → NUCLEAR keyword filter (the Reddit §4c treatment).** Card-hiding
   only removes what Patreon *labels* (`nsfw-chip`); **search still surfaces under-tagged
   suggestive content the platform leaves unlabelled** (the "privates covered by one extra
   pixel → not 18+" leak — same structural blind spot as DeviantArt, confined to search).
   Ground-truth filtering can't reach it, so we kill the adult *search itself*, exactly like
   Reddit. Added to **`background.js` `checkUrl` STEP 5**: on `patreon.com` search paths
   (`/explore/search?query=…`; a typed `/search?q=…` redirects there — both handled) the
   query is matched against `HARD_PORN_KEYWORDS` + `SOFT_PORN_KEYWORDS`; any hit blocks the
   whole search. Patreon stays fully usable for legit creators; only NSFW-keyword searches
   die. Runs inside `checkUrl` so SPA search (content.js pushState relay) is covered too.
   - **Refactor:** extracted the inline Reddit §4c query logic into a shared
     `matchSearchQueryPorn()` helper (Reddit now calls it too — identical behaviour).
   - **False-positive fix (benefits Reddit too):** six ≥4-char keywords that are
     substrings of common words are now **whole-word-only** (`SUBSTRING_UNSAFE_KEYWORDS`:
     cock, butt, dick, balls, rape, milf) — previously `cocktail`/`button`/`Dickens`/
     `footballs`/`grape`/`Milford` were wrongly blocked. Node regression: **28 NSFW
     queries blocked / 36 SFW allowed, 0 failures.**
   - ⚠️ Keyword *coverage* gap (not a logic bug): purely-suggestive slang absent from the
     lists (e.g. `thicc waifu`) still passes. List-tuning is a judgement call — flagged to
     the user, not unilaterally expanded.

**Observations / caveats (not yet acted on):**
- **`fetch`/XHR patch can be clobbered per-site.** On **ArtStation** a page library had
  *replaced* `window.fetch` (axios-style) and **Rollbar** had wrapped XHR — our patch may
  not be in the chain there. On Bluesky/Tumblr our patches were intact. The methodology
  check `window.__oathLightGraylistV2===true` only proves the script *ran*, NOT that the
  patch *survived* — verify behaviourally (`String(window.fetch)` should start with our
  `function (input, init)` wrapper). ArtStation is also login-gated (mature hidden
  logged-out) so it's vacuous without creds → deferred.
- **The `[native code]` toString cloak isn't applying** (cosmetic anti-detection only;
  functionally irrelevant) — `String(window.fetch)` returns our real source on bsky/tumblr.
- **Casing audit:** the Tumblr bug class may also affect untested snake_case signals on
  web-internal APIs — **vimeo (`content_rating`), patreon (`is_nsfw`), gumroad (`is_adult`),
  flickr (`safety_level`)**. Add camelCase variants when verifying each live. (reddit/nexus
  already dual-cased; x/itaku/artstation confirmed snake_case live.)

**Pending live re-verification (blocked on a reload — I can't reload from the bridge):**
Tumblr 16/16 strip in the rendered dashboard; bsky.app / lemmynsfw.com / itch `/games/nsfw`
navigations → block.

---

## 0.6 Session 3 update (2026-06-19) — DOM/age-gate tail + writing.com

> Full session-3 write-up (testing method, complete writing.com findings + ready-to-paste
> rule, remaining work): **[GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md).**

- **Ko-fi → BUILT (DOM page-block), live-verified.** `content.js` `DOM_LABEL_RULES['ko-fi.com']`
  keys on the persistent server-rendered `<span class="label-tag">Nsfw</span>` page-category pill
  (the "Agree and Continue" age gate is transient/skipped once age-confirmed, so we don't rely on
  it). `true` on an NSFW creator page (logged-in + age-confirmed), `false` on SFW pages. Ko-fi
  policy bars explicit porn → suggestive/mature tier.
- **writing.com → UNBANNED + recon complete; rule ready, not yet written.** Was blacklisted;
  user confirmed legit (mostly-SFW writing community). Removed the blacklist line; bumped manifest
  **3.1.7→3.1.8** (the version bump + reload re-seeds the blocklist = applies the unban). Ground
  truth = the `crating` code on each item's `a.blue2roll` rating badge (**10=E,20=ASR,30=13+,
  40=18+,50=GC,60=XGC**; adult ≥ 40). Listing/feed cards are each a `table.norm`; an item's own
  rating badge is preceded by exactly "Rated:" and sits outside `table.norm`. Rule + the one
  remaining live test are in the session-3 handoff §2.
- **Deferred:** Behance (mature off-by-default, filtered everywhere → unsamplable; hashed CSS),
  Dreamwidth (niche, no sample), Pillowfort (login-walled; domain is `.social`).
- **Manifest:** **3.1.8**. All session-3 `content.js` rules need a reload (done once this session).
- **`PP_TESTING` is still `true`** — §6 pre-ship reverts still pending.

---

## 1. Engine fixes (apply to ALL graylist API sites)

### 1.1 `scrub` nested-flag bug — FIXED ✅
**File:** [extension/graylist-inject.js](extension/graylist-inject.js) (`scrub`)

**Symptom:** when an item's NSFW flag sits on a *named child object* of the array
element — e.g. Reddit `child.data.over_18`, Mangadex/Patreon `attributes.*`,
Bluesky `feed[].post.labels`, X `…result.legacy.possibly_sensitive` — the old
object-branch deleted just that child and left the **row in the array** (broken
card; on Mangadex the NSFW cover still rendered via `relationships`).

**Why it was masked:** Reddit/X are also covered by the Layer-1 cookie, and the
only sites that "worked" (Mastodon `status.sensitive`, PeerTube `video.nsfw`) put
the flag as a **primitive directly on the array element**.

**Fix:** the object-map deletion is now suppressed while inside an array element's
subtree (`insideArrayItem`, propagated through nested objects, reset only on a
nested array). The enclosing array drops the whole element via `subtreeFlagged`;
deepest-array-wins is preserved (X `entries[]` drop individually, the batch
survives); genuine id→item maps (pixiv) still work.

**Verified:** Mangadex live **60 → 46** (14 removed, 0 orphaned). Synthetic suite
across Reddit / X (partial-batch) / Bluesky / pixiv-map / Mastodon all correct.

### 1.2 XHR interception — ADDED ✅
**File:** [extension/graylist-inject.js](extension/graylist-inject.js) (XHR patch after the fetch patch)

**Symptom:** **DeviantArt** showed NSFW even though the rule + field were correct.
Root cause: its feed (`_puppy/dabrowse/...`) loads via **`XMLHttpRequest`**, and
the interceptor only patched `fetch`. The handoff had flagged XHR as "a documented
follow-up." This silently broke every XHR-based graylist site.

**Fix:** patches `XMLHttpRequest` by shadowing the per-instance `responseText` /
`response` getters and lazily scrubbing the JSON at `readyState 4` (handles text
and `responseType:"json"`). Order-independent of the page's own load handler.
Non-matching XHRs are pass-through.

**Verified:** DeviantArt feed mature **9 → 0 rendered** (raw had 9 `isMature:true`,
none reached the DOM). NexusMods adult mods **18,207 exist → 0 returned**.

---

## 2. Architecture recap (important for interpreting results)

There are **two enforcement layers**; a site can be covered by either/both:

- **Layer 1 — `background.js` cookie / URL rewrite** (`GRAYLIST_COOKIE_MAP`,
  `GRAYLIST_URL_REWRITE_MAP`): forces SFW *server-side* so NSFW never arrives.
  Covers **reddit** (`over18=0`), **pixiv** (`R18=0`), **x/twitter**
  (`sensitive_content_flag=false`), **AO3** (exclude Explicit/Mature tags),
  **dailymotion** (`family_filter=true`). For these, even the SSR/first-paint is clean.
- **Layer 2 — `graylist-inject.js` fetch+XHR interceptor**: strips flagged items
  from JSON before render. The only defense on every other API site.

**Boundary / inherent limits (not bugs):**
- **Under-tagged content** the platform itself marks SFW is invisible to a
  ground-truth filter (DeviantArt suggestive art `isMature:false`; Discord channels
  the server never flagged). Only keyword heuristics or whole-site/server blocking
  can touch it.
- **SSR-embedded first-paint data** and **WebSocket/gateway** transports bypass the
  interceptor (Discord is gateway-driven → handled via DOM instead).

---

## 3. Per-site results

| Site | Mechanism | Result | Evidence |
|---|---|---|---|
| Reddit | L1 cookie + API | ✅ | `over18=0`; harness `r/nsfw` 50→0; live patched-fetch 0 over_18 |
| Pixiv | L1 cookie | ✅ | `R18=0` confirmed; R-18 never reaches page |
| X / Twitter | L1 cookie | ✅ | `sensitive_content_flag=false` |
| Dailymotion | L1 rewrite | ✅ | `family_filter=true` |
| AO3 | L1 rewrite + DOM + **whole-page block** | ✅ | navigation → about:blank |
| Mastodon (all instances) | API | ✅ | live **40→35**, 5 sensitive removed (incl. reblogs) |
| PeerTube (all instances) | API | ✅ | SepiaSearch **2→0** |
| Lemmy (all instances) | API | ⚠️ field-confirmed | `nsfw` present + rule matches; structural labeling (low under-tag risk). **`lemmynsfw.com` → BLACKLISTED** (entirely-NSFW instance, SSR leak) |
| Mangadex | API | ✅ | **60→46** after scrub fix |
| Itaku | API | ✅ | **34→0** (NSFW+Questionable) live |
| NexusMods | API (GraphQL/fetch) | ✅ | **18,207 adult → 0** returned; `adultContent` field correct |
| Imgur | API | ⛔ untested | hides NSFW logged-out → vacuous |
| ArtStation | API | ⚠️ field-confirmed / ⛔ patch-clobber risk | `hide_as_adult` present; login-gated (mature hidden logged-out); page libs **replaced fetch + Rollbar-wrapped XHR** — verify patch survives (§0.5) |
| Tumblr | API (fetch+XHR) | ✅ **casing bug FIXED** | web API is camelCase (`communityLabels.hasCommunityLabel`); old snake-only signal stripped 0/16, fixed strips 16/16. Good label coverage → stays graylisted (§0.5) |
| Bluesky | ~~API~~ → **BLACKLISTED** | ⛔ blocked | label filter works on labelled posts, but ~33% of NSFW search results are **unlabelled** & render (explicit nudity). Unhandleable by ground-truth → blacklist (§0.5) |
| DeviantArt | API → **BLACKLISTED** | ✅ blocked | XHR fix stripped flagged 9→0; user chose whole-site block (suggestive `isMature:false` art can't be caught) |
| Newgrounds | DOM | ✅ fixed | front page 11/11 + browse grid 6/6 adult cards hidden |
| fanfiction.net | DOM | ✅ | 11/11 M-rated hidden |
| itch.io | DOM | ✅ **page-gate + listing path-block** | adult game page → blocked; adult browse paths (`/games/nsfw`, `/games/tag-<adult>`) now hard-blocked by path (§0.5, regression 22/22) |
| Steam | DOM page-gate | ✅ | AO games login-gated by Steam; birthday-gate game blocked |
| FurAffinity / SoFurry / Inkbunny / Weasyl | **BLACKLISTED** | ✅ | moved off graylist; FA navigation → about:blank confirmed |
| Discord | DOM (3-tier) | ✅ fixed | see §4 |
| Patreon | API + **DOM scrub & page-block** | ✅ **handled (NOT blacklisted)** | well-labeled; SSR first-paint bypassed the API scrub. `content.js` now hides cards by `data-tag="nsfw-chip"` (34/34, 0 SFW collateral, 238 SFW kept) + slug-scoped SSR `is_nsfw` page-block (Diivesgames→block, Kurzgesagt→allow). Stays graylisted for client fetches. Logic validated in-page; needs extension-reload live test (§0.5 #5) |
| Ko-fi | DOM page-block | ✅ **built + verified (S3)** | keys on persistent `<span class="label-tag">Nsfw</span>` pill; `true` on NSFW creator page, `false` on SFW (feed/supportkofi). Suggestive tier (no explicit porn allowed) |
| writing.com | DOM listing-hide + page-block | 🔓 **unbanned, recon done, rule ready (S3)** | `crating` code ground truth (40=18+/50=GC/60=XGC); `table.norm` cards; own rating = "Rated:" badge outside `table.norm`. Rule + last live test → session-3 handoff §2 |
| Vimeo / Odysee / Gumroad / Minds / Flickr | API (best-effort) | ⛔ untested | login/key-gated or hide NSFW logged-out |

---

## 4. Discord (rewritten — `content.js` `setupDiscordFiltering`)

Tested live on a real NSFW server. **Two failures found, both fixed:**
- **Opt-in gate bypass:** an account with "Display age-restricted content" enabled
  sees NSFW with **no gate**, so the old text-only detection never fired. **Fix:**
  block when the *open channel* is age-restricted (mapped via its sidebar
  `aria-label="… (Age-Restricted) icon"`).
- **Sidebar hide missed 10/12:** old selector required `<a aria-label*="nsfw">`;
  the real marker is a `<div aria-label="Text (Age-Restricted) icon">`. **Fix:**
  match the icon on any element → hide the channel row.

**New 3-tier model:**
1. **Whole-server block** when a server has **≥ 2** age-restricted channels
   (`NSFW_SERVER_THRESHOLD`, tunable). This also neutralizes channels the server
   left **unflagged** (policy-non-compliant) — once the server is known-NSFW we
   stop relying on per-channel signals.
2. **Per-channel block** on opening an age-restricted channel.
3. **Sidebar hide** of age-restricted channels + the original gate-text block.

**Residual:** channels with NSFW content the server never flagged as
age-restricted have *no* machine signal — the whole-server block is the only thing
that catches them.

---

## 5. Files changed this session

- [extension/graylist-inject.js](extension/graylist-inject.js) — scrub fix (§1.1), XHR interceptor (§1.2), Tumblr `community_labels` signal, removed DeviantArt rule/`S.deviant`/quick-match entry.
- [extension/content.js](extension/content.js) — Newgrounds markers (`[class*="rated-a"]`/`rated-m`), removed FA/SoFurry/Inkbunny/Weasyl DOM rules, Discord 3-tier rewrite, Newgrounds-bypass → `about:blank` (TEST).
- [extension/background.js](extension/background.js) — `PP_TESTING` block routing → `about:blank` + `[OathLight][TEST] BLOCK` log.
- [extension/blocklists/domains_part3.json](extension/blocklists/domains_part3.json) — added `furaffinity.net`, `sofurry.com`, `inkbunny.net`, `weasyl.com`, `deviantart.com`.
- [extension/graylist-sites.js](extension/graylist-sites.js) + [desktop-app/src/renderer/js/store.js](desktop-app/src/renderer/js/store.js) — removed the 5 now-blocked sites from the graylist UI.
- [extension/manifest.json](extension/manifest.json) — version bumped (forces blacklist re-seed on reload via `onInstalled`).

**Session 2 (§0.5) additionally changed:**
- [extension/blocklists/domains_part3.json](extension/blocklists/domains_part3.json) — added `bsky.app`, `bsky.social`, `lemmynsfw.com`.
- [extension/graylist-inject.js](extension/graylist-inject.js) — removed Bluesky (rule/`S.bsky`/`BSKY_NSFW`/`bsky.`+`/xrpc/` quick-match); **fixed Tumblr signal casing** (camelCase `communityLabels.hasCommunityLabel`/`isNsfw` + snake_case).
- [extension/content.js](extension/content.js) — itch.io `pageLabel` now path-blocks adult browse routes.
- [extension/graylist-sites.js](extension/graylist-sites.js) + [desktop-app/src/renderer/js/store.js](desktop-app/src/renderer/js/store.js) — removed Bluesky from the graylist UI.
- [extension/manifest.json](extension/manifest.json) — bumped `3.1.2 → 3.1.3`.

---

## 6. ⚠️ MUST DO before shipping

1. **Revert test-mode block routing** (both block destinations are currently paused):
   - [extension/background.js](extension/background.js): set `PP_TESTING = false`. This restores **both** `blocked.html` **and** the user-configured **"Redirect link"** — while `PP_TESTING` is true, `blockedUrl` is forced to `about:blank` *and* `redirectTarget` is nulled, so neither fires.
   - [extension/content.js](extension/content.js): the Newgrounds-bypass `window.location.replace('about:blank')` → restore `chrome.runtime.getURL('blocked.html')`.
   - Reason: navigating to `blocked.html` **or** an arbitrary redirect URL can crash/hang the Playwright bridge during testing, so all blocks were routed to `about:blank`. **Leaving this in disables the real block screen AND the redirect-link feature.**
2. **Reload the extension** after the above (and to pick up the Tumblr `community_labels` signal).

---

## 7. What's LEFT for the next agent

> **NOTE (Session 2, §0.5):** Tumblr (casing FIXED), Bluesky (BLACKLISTED), and the
> itch.io listing decision (path-block IMPLEMENTED) below are now **resolved** — see §0.5.
> Everything in §0.5 still needs a one-time **extension reload** for live confirmation.

**Verification gaps (fix applied, not confirmed live):**
- ~~Tumblr `community_labels`~~ — **FIXED** in Session 2 (it was a snake_case vs camelCase
  bug, 0/16→16/16). Live re-verify after reload on a dashboard/search with labelled posts.
- ~~Bluesky~~ — **BLACKLISTED** in Session 2 (unlabelled-NSFW leak too large).
- **Lemmy / ArtStation** — field + rule confirmed but never saw a live NSFW item stripped
  (Lemmy adapter is low-risk/structural; `lemmynsfw.com` blacklisted. ArtStation is
  login-gated + has a patch-clobber risk — see §0.5).

- ~~Patreon~~ — **HANDLED** in Session 2 via `content.js` DOM scrub + slug-scoped SSR
  page-block (logic validated in-page; needs extension-reload live test). See §0.5 #5.

**Untested adapters (best-effort field names — the handoff's open list):**
- **Imgur, Vimeo, Odysee, Gumroad, Minds, Flickr** — need login / API keys / NSFW opt-in to surface flagged content.

**Open product decisions:**
- ~~itch.io listing~~ — **DONE** (Session 2): adult browse paths are now hard-blocked.
- **DeviantArt-style under-tagging** generally — policy now has precedent: when the
  unlabelled-NSFW leak is large/unhandleable, **whole-site blacklist** (DeviantArt,
  FurAffinity, SoFurry, Inkbunny, Weasyl, **Bluesky**). Ground-truth-only filtering is
  kept only where the platform's own labelling is thorough (Tumblr, Mastodon, Reddit…).

**Known fragility (monitor):**
- **DOM-label selectors rot** (Newgrounds drifted to a new markup mid-test; it uses *different* rating markup per page type). Re-audit AO3/itch/Steam/Newgrounds periodically.
- **Transport drift** — sites can move feeds between fetch/XHR/GraphQL/SSR. The interceptor now covers fetch+XHR; SSR-embedded first-paint and WebSocket remain blind spots.

---

## 8. Testing methodology (reuse this)

- Drive the **real browser** via Playwright MCP **extension bridge** (`--extension`).
  The extension only injects on graylist hosts, so check `window.__oathLightGraylistV2`
  on an actual graylist page, not `example.com`. The patched `fetch.toString()`
  deliberately reports `[native code]`.
- **Differential per site:** before the XHR patch, XHR = raw vs fetch = stripped.
  After the XHR patch, both are patched — instead use:
  - **`browser_network_request` → `response-body`** for the **raw** server response (pre-JS), then cross-reference flagged item IDs against the **rendered DOM**.
  - Or a **`totalCount`-style metadata field** (NexusMods) as the raw baseline since the scrub doesn't touch scalars.
- **Gotchas:** a block → `about:blank` **freezes the bridge** (can't attach to about:blank) — open a fresh tab to recover. Cloudflare challenges (lemmy.world, NexusMods) block the automated session; raw API endpoints carry `CSP default-src 'none'` (run from the web-app page, not the raw JSON URL); cross-origin `fetch` with `credentials:'include'` fails against `ACAO:*`.
