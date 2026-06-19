# Graylist V2 — Session 3 Handoff (Testing Method · writing.com · Full State)

> For the next agent. This is a **self-contained** handoff: how we test, the complete
> **writing.com** findings + a ready-to-paste rule, and the current state of everything
> with what's left to do. Pairs with [GRAYLIST_HANDOFF.md](GRAYLIST_HANDOFF.md) (design),
> [GRAYLIST_V2_TEST_REPORT.md](GRAYLIST_V2_TEST_REPORT.md) (sessions 1–2 live testing),
> and [extra_graylisted_sites.md](extra_graylisted_sites.md) (candidate triage).
>
> **Date:** 2026-06-19 · **Extension id:** `lknpaoecooklfjgenmjpkdkahgoofank` ·
> **Bridge account for writing.com:** `nsfwspy` (logged in). Also logged in for Ko-fi,
> Wattpad, Fanbox, Webtoons, Tapas.

---

## 1. How we test (reuse this exactly)

### 1.1 The harness
- We drive a **real Chrome** through the **Playwright MCP extension bridge**
  (`mcp__playwright__*` tools). That Chrome has **Pure Path installed** and is **logged
  into the test accounts**, so we see what a real opted-in user sees.
- The user toggles the bridge extension on/off. If a tool errors with
  **`Target page, context or browser has been closed`**, the bridge dropped — recover with
  `browser_tabs(list)` then `browser_navigate` again (don't assume it's dead).

### 1.2 The workhorse: `browser_evaluate`
DOM rules are verified by **running the candidate rule's own predicate in-page** against a
live page and asserting the result:
- **Positive control:** on a known-adult page, the predicate must return `true`.
- **Negative control:** on a known-SFW page, it must return `false`.
- Also use it to **count markers**, **dump ancestor chains** (to pick the right `item`
  container), and **enumerate distinct values** (e.g. how many `table.norm` per page).

This validates rule *logic* without a reload. But the rule only goes **live** after the
reload semantics below.

Other tools: `browser_navigate`, `browser_tabs` (list / new / recover), `browser_snapshot`
(accessibility tree). **`browser_take_screenshot` times out (~5 s) on long pages** (webtoon
viewers etc.) — rely on `browser_evaluate` instead.

### 1.3 Reload semantics — WHAT GOES LIVE WHEN (critical)
| Change | File | Goes live… |
|---|---|---|
| JSON scrub rule | `graylist-inject.js` | **Immediately** — it's a web-accessible resource re-fetched fresh on every page load. No reload. |
| DOM rule (`DOM_LABEL_RULES`, `pageLabel`) | `content.js` | **Only after a manual extension reload** (chrome://extensions → reload) — it's a content script. |
| Blacklist domain add/remove | `blocklists/domains_part*.json` | **Only on install/update** — the JSON is seeded into `chrome.storage` once. To apply: **bump `manifest.json` version + reload** (fires `onInstalled('update')` → re-seed). |

### 1.4 `PP_TESTING` — blocks route to `about:blank` right now
[background.js:1509](extension/background.js#L1509) has `PP_TESTING = true`. While true, **every
block routes to `about:blank`** instead of `blocked.html` (and the user's redirect-link is
suppressed) — because navigating to `blocked.html` can hang the bridge.
- **Consequence for testing:** a *successful* page-block shows up as **the tab becoming
  `about:blank`**, not the block screen.
- **`about:blank` freezes the bridge** (can't attach) → open a fresh tab to recover.
- The Newgrounds bypass-page block at [content.js:153](extension/content.js#L153) is likewise
  routed to `about:blank` for the same reason.
- **Both must be reverted before shipping** (see §5).

### 1.5 The decision framework (unchanged, but you must follow it)
- **Verify, don't assume.** Confirm field names / DOM markers / codes on the live page —
  never from memory or search-result labels.
- **Visually check for leaks.** Browse the rendered mature feed and *look* for under-tagged
  porn the platform left unlabelled.
- **Classify the leak type before deciding** (this is the whole game):
  - **Under-tagging** (community labels NSFW as SFW) → label filtering is blind → **blacklist**.
  - **Well-labelled but SSR / transport blind-spot** → **DOM-hide + page-block** (don't blacklist).
- **Enforcement ladder, best→worst:** (1) force server-side SFW → (2) JSON feed scrub →
  (3) DOM-hide + page-block → (4) nuclear search-keyword filter → (5) blacklist.

---

## 2. writing.com — findings (recon COMPLETE, rule NOT yet written)

### 2.1 Status
- Was on the **blacklist** (`blocklists/domains_part3.json`, line ~89411) → hard-blocked
  outright. The user confirmed it's a **legit, mostly-SFW creative-writing community** and
  asked to **unban it and build a graylist rule**.
- **Unbanned:** the `"writing.com"` line was removed from the blacklist JSON; manifest bumped
  **3.1.7 → 3.1.8**; the user reloaded → writing.com now loads in the bridge (logged in as
  `nsfwspy`). Confirmed live, no longer blocked.

### 2.2 The content-rating system (the ground truth)
Writing.Com rates **every** item on a fixed 6-level scale. The rating renders as a link:

```html
<a rel="nofollow" class="blue2roll"
   href="javascript:LaunchPop('https://www.Writing.Com/main/tools.php?action=pop_rhelp&crating=<CODE>', …)">TEXT</a>
```

The **`crating=<CODE>` number is the ground truth** (the visible TEXT can vary; the code can't):

| Code | Rating | SFW? | How verified |
|---:|---|---|---|
| 10 | E (Everyone) | ✅ | live listings |
| 20 | ASR (Anyone, Some Restrictions) | ✅ | live listings |
| 30 | 13+ | ✅ | live listings |
| **40** | **18+** | ❌ adult | **Writing.Com `pop_rhelp&crating=40` help page = "The 18+ Rating"** |
| **50** | **GC** (Graphic Content) | ❌ adult | inferred (strict +10 over the fixed order) |
| **60** | **XGC** (Extreme Graphic Content) | ❌ adult | **Writing.Com `pop_rhelp&crating=60` help page = "The XGC Rating"** |

→ **Adult threshold = `crating >= 40`.**

### 2.3 Where the rating lives (verified live)
- **Listings & feed** (`/main/list_items/…`, `/main/newsfeed`): **every item card is its own
  `table.norm`**, containing **exactly one item + one rating badge** (verified **27/27** on the
  Adult-genre list; the newsfeed's 18+ item was also inside a `table.norm`). The card metadata
  line reads `Rated: <badge> · <Type> · <Genre> · #<itemid>`.
- **Item content pages** (`/main/view_item/item_id/…`, `/main/books/item_id/…` — which can
  redirect to `/main/profile/blog/<user>` — `/main/forums/item_id/…`, interactives, etc.):
  show **exactly two** rating badges, both pertaining to that item:
  1. the item's **own** rating — immediately preceded by the text **`Rated:`**, and **NOT
     inside any `table.norm`** (it's in a bare header table);
  2. the preview's rating — preceded by **`Intro Rated:`**.
  No sponsored/sidebar rating badges appeared despite a "SPONSORED ITEMS" block (verified on
  `/view_item/` and on a blog-style book).

**Key separability result:** the item's *own* rating badge is the one with `prev text === "Rated:"`
**and** `closest('table.norm') === null`. Listing/feed badges are always **inside** a `table.norm`.
So one predicate can both (a) hide adult listing cards and (b) page-block a single adult item
page **without ever firing on a listing**, and **without** needing URL patterns (item URLs vary).

### 2.4 The "Access Restricted; Details Below" page — deliberately NOT used as a signal
When an item is above the viewer's content-rating ceiling, Writing.Com shows its own
"Access Restricted" interstitial and **does not render the content** — so there's no leak to
catch. (Note: that same interstitial also covers **private** items — the one 18+ item I hit in
the feed was actually *private*, not rating-gated.) When a user **raises** their ceiling to view
adult content, the item **renders with its `Rated:` badge** → our `pageLabel` catches it. So we
key on the rendered rating, not the restriction page.

### 2.5 THE RULE TO ADD (verified structurally; one live test remains — see §2.6)
Add to `DOM_LABEL_RULES` in [content.js](extension/content.js) (it's keyed by registrable domain,
so `'writing.com'` covers `www.writing.com`):

```js
'writing.com': {
  // Writing.Com rates every item E / ASR / 13+ / 18+ / GC / XGC. The rating renders as
  //   <a class="blue2roll" href="javascript:LaunchPop('…pop_rhelp&crating=<CODE>'…)">TEXT</a>
  // and the crating CODE is the ground truth (visible text can vary; the code can't):
  //   10=E  20=ASR  30=13+  40=18+  50=GC  60=XGC   → adult = code >= 40.
  //   (40=18+ and 60=XGC confirmed against Writing.Com's OWN rating-help pages;
  //    10/20/30 confirmed off live listings.)
  //
  // LISTINGS & FEED: every item card is its own `table.norm` holding exactly ONE item + ONE
  // rating badge (verified 27/27 on the /list_items Adult genre; newsfeed items too). Hide any
  // card whose badge is 18+/GC/XGC.
  markers: 'a.blue2roll[href*="crating=40"], a.blue2roll[href*="crating=50"], a.blue2roll[href*="crating=60"]',
  item: 'table.norm',
  // ITEM PAGES (any type — /view_item/, /books/→/profile/blog/, /forums/, interactives…):
  // the item's OWN rating is the badge whose immediately-preceding text node is exactly
  // "Rated:" (the header line "Rated: <r> · <Type> · … · #<id>") AND which is NOT inside a
  // `table.norm`. That excludes (a) the preview's "Intro Rated:" badge and (b) every
  // listing/feed row (those badges sit inside a table.norm). So it fires on exactly one adult
  // item page and never on a listing. URL-agnostic on purpose (item URLs vary wildly).
  pageLabel: () => {
    const links = document.querySelectorAll('a.blue2roll[href*="crating="]');
    for (const a of links) {
      const prev = a.previousSibling ? (a.previousSibling.textContent || '').trim() : '';
      if (prev !== 'Rated:') continue;          // the item's own rating (excludes "Intro Rated:")
      if (a.closest('table.norm')) continue;     // exclude listing/feed rows
      const m = (a.getAttribute('href') || '').match(/crating=(\d+)/);
      if (m && parseInt(m[1], 10) >= 40) return true;   // 40=18+, 50=GC, 60=XGC
    }
    return false;
  }
}
```
Then **register it** (keep the two lists in sync):
- [graylist-sites.js](extension/graylist-sites.js): `{ url: 'writing.com', kind: 'dom', desc: 'Adult (18+/GC/XGC) items removed from listings & feeds; adult item pages blocked' }`
- [desktop-app store.js](desktop-app/src/renderer/js/store.js): `{ id: 'writingcom', url: 'writing.com', kind: 'dom', on: true, desc: '…' }`
- Bump `manifest.json` version, **reload**.

### 2.6 The ONE remaining verification (do this with the rule)
The negative case is verified (a 13+ item page → `pageLabel` returns **false**). The **positive
case is structurally identical** to the 13+ template (only the crating number differs, and the
codes are confirmed) but was **not** yet seen rendering, because the `nsfwspy` account's
content-rating **ceiling currently blocks 18+** (adult items show the restriction page). To get a
live positive:
- **Easiest:** raise the content-rating preference in the account's settings (it's a dedicated
  NSFW test account) to XGC, open an 18+/GC/XGC item, confirm `pageLabel` → `true` (tab →
  `about:blank` under `PP_TESTING`), then revert the preference; **or**
- find a **public** adult item that renders at the current ceiling.
- Also confirm the listing-hide: on an adult listing/feed, the 18+/GC/XGC `table.norm` cards get
  `display:none`.

**Robustness note:** the predicate keys on `a.previousSibling` being the text node `"Rated:"`.
This held on `/view_item/` and on a blog-style book. If a future layout puts whitespace/an element
between the label and the badge, fall back to testing the badge's parent line text against
`/(^|[^A-Za-z])Rated:\s*$/` (i.e. "Rated:" but not "Intro Rated:").

---

## 3. What was done this session (DOM/age-gate tail)

**✅ Built + live-verified**
- **Ko-fi** ([content.js](extension/content.js) `DOM_LABEL_RULES['ko-fi.com']`) — page-block on the
  persistent `<span class="label-tag">Nsfw</span>` page-category pill inside `.tag-container`. The
  age gate itself is a transient "Agree and Continue" SweetAlert (skipped once age-confirmed), so we
  key on the **pill**, which persists regardless of viewer state. **Verified live:** `true` on
  `ko-fi.com/ciaracruz13` (NSFW, while logged-in + age-confirmed); `false` on SFW pages (feed,
  `supportkofi`). Ko-fi policy bars explicit porn → this gates suggestive/mature art (Webtoons tier).
  Added to both lists; manifest at **3.1.8**.

**⛔ Deferred (documented)**
- **Behance** — mature is **off by default** and filtered from *all* feeds/search (a "boudoir nude"
  search → 48 cards, **zero** mature markers). Only direct-link projects gate, and those can't be
  sampled because they're filtered everywhere. Plus hashed CSS-module classnames (build-fragile).
  Low leak + high rot → defer.
- **Dreamwidth** — niche/low-traffic; no adult sample to verify against. Optional.
- **Pillowfort** — login-walled; real domain is `pillowfort.social` (our list had `.io`).

**🔓 writing.com** — unbanned + fully reconned; rule ready to write (see §2).

---

## 4. Current state of the whole graylist (for orientation)

**API / JSON-scrub** (`graylist-inject.js`, live without reload):
reddit, x/twitter, tumblr, pixiv, mastodon (all instances), imgur, nexusmods, vimeo,
dailymotion, odysee, patreon, gumroad, minds, itaku, peertube (all), lemmy (all), mangadex,
artstation, flickr, **sketchfab**, **500px**, **gamebanana**, **wattpad**, **fanbox**
(the last five built in session 2; all live-verified).

**DOM page-block / item-hide** (`content.js` `DOM_LABEL_RULES`, needs reload):
newgrounds, archiveofourown, fanfiction, **scribblehub**, itch, steampowered/steamcommunity,
**webtoons**, **tapas**, **ko-fi** (this session), Discord (special).

**Blacklisted this/last session:** bluesky, deviantart, furaffinity, sofurry, inkbunny, weasyl,
lemmynsfw.com, civitai, fantia, dlsite, derpibooru, plurk, subscribestar.adult.

**Unbanned:** dreamwidth.org, **writing.com**.

---

## 5. What's LEFT for the next agent

1. **writing.com** — write the rule (§2.5), register it in both lists, bump manifest, reload,
   then do the live positive test (§2.6).
2. **Live E2E pass** (extension was reloaded once this session; re-reload after any new edits):
   - **Ko-fi** → `ko-fi.com/ciaracruz13` should block (tab → `about:blank`); a SFW creator stays.
   - **ScribbleHub, Webtoons, Tapas** → open a known adult series/episode; confirm page-block +
     adult cards hidden in listings.
3. **6-site re-verify** (per session-2 carryover): **Patreon, Tumblr, lemmynsfw (→ blocked),
   itch.io (`/games/nsfw` → blocked), Newgrounds** + the new blacklist entries.
4. **Pre-ship cleanup (MUST):**
   - [background.js:1509](extension/background.js#L1509): `PP_TESTING = false` (restores both
     `blocked.html` and the redirect-link feature).
   - [content.js:153](extension/content.js#L153): Newgrounds bypass `window.location.replace('about:blank')`
     → `chrome.runtime.getURL('blocked.html')`.
   - Reload after.

---

## 6. Gotchas worth repeating
- Block → `about:blank` **freezes the bridge**; open a fresh tab to recover.
- Content scripts (`content.js`) **don't hot-reload**; the WAR (`graylist-inject.js`) does.
- Blacklist edits need a **manifest version bump + reload** to re-seed.
- writing.com is **CAPTCHA/bot-protected** to anonymous fetchers (WebFetch + archive.org both
  403) — you can only recon it through the logged-in bridge.
- Ko-fi help docs return **403** to WebFetch; recon the live page instead.
