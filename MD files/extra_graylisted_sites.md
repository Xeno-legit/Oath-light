# Extra Graylisted Sites — Feasibility-Corrected List

> **Corrected pass.** The previous version rated candidates by *"does it have a Mature
> flag?"* — which is the exact assumption that forced DeviantArt and Bluesky to a
> whole-site blacklist. A flag *existing* ≠ the community *using* it. This version
> re-rates every candidate by **what can actually be enforced**, and is explicit about
> what **cannot** be cleanly done.
>
> Mechanism claims below marked _(unverified)_ are hypotheses that still need a live
> visual recon pass (browse the rendered feeds/grids and count leaks) before we trust
> them — per `GRAYLIST_V2_TEST_REPORT.md` and the "verify visually" rule.

---

## Enforcement ladder (what "doable" means)

Ranked best → worst. A site is only "easy" if it sits near the top.

1. **Force server-side SFW mode** — pin a cookie/param so the server returns SFW only
   (like reddit `over18=0`, pixiv `R18=0`, x `sensitive=false`). Robust; kills SSR +
   search in one move. *Best case.*
2. **Scrub the JSON feed** (`graylist-inject.js`) — only works if labeling is honest
   **and** the transport is fetch/XHR (not SSR/WebSocket).
3. **DOM-hide + page-block** (the Patreon playbook in `content.js`) — needed when the
   site server-renders (SSR) so the feed never passes through fetch.
4. **Nuclear search-keyword filter** (the Reddit/Patreon overlay in `background.js`) —
   the **only** layer that touches *under-tagged* suggestive content. Independent of
   the site's labels.
5. **Blacklist** — when NSFW density is so high, or labeling so absent, that 1–4 can't
   keep up. The correct answer for porn-primary sites; not a failure.

**Hard blockers that make a site "cannot do cleanly":**
- **Under-tagging** (art/photo/RP communities self-label nudity as SFW) → label layers
  are blind; only search-filter or blacklist help.
- **Live video / WebSocket** (no JSON to scrub, no per-item DOM rating) → no good hook.
- **Login-gated** → can't even verify or test without an account.
- **Educational/library framing** → high SFW collateral + philosophically borderline.

---

## ✅ TIER A — Doable, high value (do these first)

| Site | Mechanism | Notes |
|---|---|---|
| **sketchfab.com** | **JSON scrub** (strip `isAgeRestricted:true`) — ✅ **BUILT (2026-06-18)** | `S.sketchfab` + RULES row + QUICK in graylist-inject.js; registered in graylist-sites.js + store.js. Field re-verified live on `/v3/models` + `/v3/search` (present on every model); scrub replay-verified; live extension processes the API without corruption. Logged-out server already returns SFW-only, so the scrub matters for logged-in/opted-in users. |
| **500px.com** | **JSON scrub** (strip `notSafeForWork:true` nodes) — ✅ **BUILT (2026-06-18)** | `S.px500` (targets `notSafeForWork`, NOT the viewer-pref `showNude`) + RULES + QUICK. Field verified live off rendered card props (58/60). GraphQL `api.500px.com/graphql` relay `edges[].node`; scrub replay-verified incl. the negative test (a `showNude`-only photo is NOT stripped). |
| **subscribestar.com** | **RESOLVED — clean domain split. ✅ done** | Adult creators live on `subscribestar.adult`, which is **now blacklisted** (this session). `.com` is the SFW main site → **allow, no system needed.** Spot-verify `.com` later for stray under-tagged creators. |
| **ko-fi.com** | **DOM page-block** (`.label-tag` "Nsfw" pill) — ✅ **BUILT + LIVE-VERIFIED (2026-06-19)** | content.js `DOM_LABEL_RULES['ko-fi.com']`. Keys on the persistent server-rendered NSFW page-category pill (not the transient "Agree and Continue" age gate). Fires on an NSFW creator page, silent on SFW. See session-3 build status + [GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md). |
| **fanbox.cc** | **JSON scrub** (`hasAdultContent` + tag fallback) — ✅ **BUILT + LIVE-VERIFIED (logged-in)** | api.fanbox.cc. Adult creators stripped; R-18 tag feed 38→0. Tag fallback handles creator-scoped-flag under-tagging. See build-status section + memory `fanbox-creator-flag-tag-leak`. |

---

## 🟡 TIER B — Doable but gated or higher-effort

| Site | Mechanism | Blocker |
|---|---|---|
| **behance.net** | **DOM-hide + page-block** (Patreon mold) — RECON CONFIRMED | ✅ Server enforces `isSafeBrowsing:true` + `showMature:false` by default (logged-out is already safe; mature thumbnails blurred). SSR first-paint → needs DOM-hide for opted-in users + mature-gallery page-block. Honest mature flag, not under-tagged. Medium effort (SSR, like Patreon). |
| **gamebanana.com** | **JSON scrub** (apiv11 feeds) — ✅ **BUILT + LIVE-VERIFIED (2026-06-18)** | Turned out to be a clean logged-out JSON scrub, not a login-gated pref. `S.gamebanana` strips mods GameBanana itself gates as sexual (`_sInitialVisibility` `hide`/`warn` — gore/flashing-lights stay `show`, verified live) + any detail object with a sexual content-rating code (`nu/pn/sa/sc/st/su`). **Live end-to-end:** through the loaded extension, the `nude` search dropped 13→0; mixed feeds (FNF subfeed, `skin` search) kept all 15 `show` mods, 0 hide/warn leaked, the gore mod survived. Records live in `_aRecords[]`. _Follow-up: per-mod page hard-block (single profile JSON isn't an array, so the feed scrub doesn't block a direct mod-page visit)._ |
| **writing.com** | **DOM listing-hide + page-block** (crating code) — 🔓 **UNBANNED, RECON COMPLETE, rule ready (2026-06-19)** | Was blacklisted; user confirmed legit → unbanned. Ground-truth = `crating` code on each item's `a.blue2roll` rating badge (40=18+/50=GC/60=XGC). Hide adult cards (`item:'table.norm'`) + page-block adult item pages. Rule + remaining live test in [GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md) §2. |
| **pillowfort.social** | Force account "show NSFW" toggle _(unverified)_ | ⛔ **DEFERRED** — login-walled (couldn't recon); real domain is `.social`, not `.io`. Tumblr-like, small userbase → low priority. |

---

## ♻️ TIER C — Doable by reusing an existing pattern

| Site | Mechanism | Notes |
|---|---|---|
| **scribblehub.com** | DOM genre-tag hide + page-block — ✅ **BUILT (2026-06-18)** | DOM_LABEL_RULES row in content.js. Ground-truth = the series' own genre anchors (`/genre/smut|adult|ecchi|mature|hentai|lolicon|shotacon/`), present identically on cards AND series pages → one selector drives item-hide + series-page hard-block; explicit `/genre/<adult>/` browse pages whole-blocked. **Live-verified:** `/genre/mature/` 25/25 caught, top-rated ranking 19/25 caught (all genuinely adult by title, 6 SFW kept), adult series page → block. Explicit erotica IS pervasive here → high value. |
| **royalroad.com** | — | ⛔ **DEFERRED (recon 2026-06-18).** RoyalRoad's content rules **prohibit explicit pornography**; its "mature" toggle gates gore/language/suggestive themes, not porn. Low value for an anti-PORN blocker + rot surface → not built. |
| **gog.com** | — | ⛔ **DEFERRED (recon 2026-06-18).** Tiny adult catalog (GOG historically purged adult VNs; "negligee" → 3 results, most delisted) and a fragile web-component/shadow-DOM store. High rot surface, near-zero payoff → not built. |
| **wattpad.com** | **JSON scrub** (`mature` bool) — ✅ **BUILT + LIVE-VERIFIED (logged-in)** | See build-status section. 18 mature stripped / 0 leaked; 16 SFW classics kept. |
| **tapas.io / webtoons.com** | Page-block (mature icon / gate) — ✅ **BUILT + selector-verified; live as of 2026-06-19 reload** | content.js `DOM_LABEL_RULES`. Tapas keys on `.filter--mature` gate + `.sp-ico-mature` icon (Tapas hosts genuine adult comics); Webtoons keys on the `ico_mature_15/18` tier icon on `title_no=` pages (mostly SFW, age-gated Canvas). Final E2E navigation pending. |
| **dreamwidth.org** | DOM adult-flag + page-gate (AO3 mold) | **ALLOWED (un-banned earlier).** Mostly SFW fandom/journaling → keep accessible. Optional light page-gate later; low priority, text-based. Not built. |

---

## ⛔ TIER D — Blacklist (porn-primary / density too high / not worth a system)

| Site | Status | Why |
|---|---|---|
| **civitai** (`.com`/`.red`/`.green`) | ✅ banned (keyword stem `civitai`) | Domain split doesn't isolate cleanly — `.green` redirects to `.com`, NSFW gated by account-level `browsingLevel` (server-side, not a pinnable cookie), SSR, very high density. No clean mechanism → blacklist. The `civitai` substring stem already covers every TLD/subdomain. |
| **fantia.jp** | ✅ banned (domain, `domains_part1.json`) | Japanese creator network, high R-18 density, login-gated. Not worth a system. |
| **ci-en.dlsite.com** | ✅ banned (domain `domains_part3.json` + already caught by `dlsite` stem) | DLsite's creator/dev-blog subdomain, heavily R-18. No system. |
| **plurk.com** | ✅ banned (domain `domains_part3.json`) | Asian microblog; NSFW is self-tagged → under-tagging. Niche; user OK'd blacklist. |
| **dlsite.com** (whole brand) | ✅ banned (keyword stem `dlsite`) | Primarily an adult doujin marketplace. **Not cleanly separable** — adult vs all-ages is split by PATH on the *same* domain (`/maniax` etc. adult vs `/home` all-ages), not a separate domain. User rule was "don't ban *if* separate" → condition not met, so **stays banned**. Carving out `/home` would need removing the `dlsite` stem + adult-path logic (leak-prone on an adult-heavy store); not done. |
| **derpibooru.org** | ✅ banned (keyword stem `derpibooru`) | A booru — high NSFW density. Good rating system, but boorus are blacklist-by-default for us. Already keyword-blocked. |

---

## ⚠️ TIER E — RECON'D: NOT traps after all (reclassified up)

> **Live Playwright recon (2026-06-18) overturned the earlier pessimism.** I had
> assumed 500px/Behance/Sketchfab were DeviantArt-style under-tagging traps. They are
> **not** — each has an honest, structured NSFW flag, and two ship it as client-side
> JSON our interceptor already scrubs. All three moved UP:
>
> - **sketchfab.com → Tier A** — `isAgeRestricted` bool, client JSON, SFW-by-default
>   logged-out (`q=nude` → 0 results). Clean JSON scrub.
> - **500px.com → Tier A** — `notSafeForWork` bool, client GraphQL. Live feed contained
>   a `notSafeForWork:true` "Nude"; scrub strips it.
> - **behance.net → Tier B** — server `isSafeBrowsing:true`/`showMature:false` default;
>   SSR first-paint → DOM-hide + page-block (Patreon mold).
>
> **Residual (all three):** suggestive-but-unflagged content (bikini/glamour the
> platform doesn't mark NSFW) still slips the flag — the same tail every graylist site
> has — backstopped by the nuclear search-keyword filter. **None warrants a blacklist**
> (user-confirmed legit professional use). `plurk.com` had no such use case → Tier D.

---

## 🚫 TIER F — Out of scope / defer (low payoff, high collateral, or not a porn problem)

| Site | Why cut/deferred |
|---|---|
| **twitch.tv / kick.com** | Live video, **WebSocket transport** (no JSON labels, no per-item DOM rating), and suggestive content is exactly what streamers don't flag. Mostly SFW → blacklist is huge collateral. No good hook. **Defer.** |
| **substack.com** | Overwhelmingly SFW (journalism/essays); tiny adult fraction behind an 18+ splash. Page-gate only if ever; low payoff. **Defer.** |
| **commons.wikimedia.org** | Educational/anatomical content, categorized but complex; huge SFW/educational value; philosophically borderline (educational ≠ porn). **Defer / special-case only.** |
| **archive.org** | Public library; inconsistent user metadata; millions of SFW items. Can't cleanly filter; very high collateral. **Defer.** |
| **vk.com** | Piracy + everything, weak labeling, Russian-language, hard to test. Not an NSFW-primary platform. **Defer.** |
| **bitchute.com / rumble.com / parler.com / mewe.com / speakbits.com** | Fringe-political / "free speech" / niche social — **misinformation, not pornography.** Including these dilutes an *NSFW* blocker's scope. **Cut from roadmap.** |
| **buymeacoffee.com** | Tip platform with minimal NSFW (much less permissive than ko-fi/subscribestar). Low density. **Defer.** |

---

## Executed this session (2026-06-18)

- **Blacklisted (new domain entries, `domains_part3.json`, manifest → 3.1.4):**
  `ci-en.dlsite.com`, `plurk.com`, `subscribestar.adult`.
- **Confirmed already-banned (no change needed):** `civitai` (keyword stem),
  `fantia.jp` (domain, part1), `dlsite` + `derpibooru` (keyword stems).
- **Kept allowed:** `subscribestar.com` (clean split — only `.adult` is NSFW).
- **Un-banned (user reversal):** `dreamwidth.org` — mostly-SFW fandom/journaling;
  allow for writers/journalists (optional AO3-mold filter later).
- **Stays banned (user condition not met):** `dlsite` — not domain-separable
  (path-split on one domain), so the "don't ban if separate" rule didn't trigger.
- **RECON'D doable, reclassified up (NOT blacklisted):** `sketchfab.com` + `500px.com`
  (Tier A, JSON scrub) and `behance.net` (Tier B, Patreon-mold DOM). Live-confirmed
  honest NSFW flags — see Tier E note.

## Phased build status (2026-06-18, session 2)

Sites were phased easiest→hardest by **mechanism reuse + verifiability**, then built with
live Playwright recon. Recon overturned several Phase assumptions (verify, don't assume):

**✅ Built + verified this session (6) — all JSON scrub except ScribbleHub:**
- **sketchfab.com**, **500px.com** — JSON scrub (graylist-inject.js). Fields verified live;
  scrub replay-verified; live extension processes the API without corruption. (Logged-out
  the servers pre-filter, so the strip is for logged-in/opted-in users.)
- **gamebanana.com** — JSON scrub. **Observable live strip** (nude search 13→0; SFW `show`
  mods survive). `_sInitialVisibility` hide/warn + sexual rating codes.
- **wattpad.com** — JSON scrub (`mature` bool, /v4/ + /api/v3/). **Live-verified end-to-end
  on the logged-in account:** smut&mature=1 → 18 stripped/0 leaked; "jane austen classics"
  → 16 SFW all kept. Reader part/text endpoints excluded from scrub.
- **fanbox.cc** — JSON scrub (`hasAdultContent`, api.fanbox.cc). **Live-verified:** adult
  creators stripped; R-18 tag feed 38→0. Handles the under-tagging leak: hasAdultContent is
  CREATOR-scoped, so a tag-fallback (`/r-?18|18禁|成人向|nsfw|エロ/`) catches R-18 posts by
  un-flagged creators. See memory `fanbox-creator-flag-tag-leak`.
- **scribblehub.com** — DOM (content.js). Genre-anchor ground truth; selector-verified live
  (25/25 on /genre/mature/, 19/25 adult on top-rated, adult series → block). _Needs extension
  reload to activate (content script)._

**⛔ Deferred — recon proved low value (2):**
- **royalroad.com** — platform prohibits explicit porn ("mature" = gore/language).
- **gog.com** — tiny adult catalog (historically purged) + fragile web-component DOM.

**🧱 Remaining tail — DOM / SSR / per-creator age-gate (no clean JSON flag):**
- **ko-fi.com** — feed is HTML partials (no JSON scrub); adult is per-creator age-gated, no
  global adult browse. Needs a content.js page-block on the age-gate interstitial + an adult
  creator sample to verify.
- **tapas.io** — utility-CSS SSR, mature login/age-gated → page-block on the age interstitial.
- **webtoons.com** — mostly SFW; age-gated mature Canvas → page-block.
- **pillowfort.io**, **writing.com** — small; page-gate/account-toggle.
- **behance.net** — Vue SSR, mature hidden from anonymous; NOT logged in on this browser
  (others were). Needs login + opted-in DOM recon. CSS-modules card prefix `ProjectCoverNeue-`.
- **dreamwidth.org** — optional, low priority.

  These are a distinct batch: all need a content.js DOM rule (→ **extension reload to verify**,
  unlike the WAR-served JSON scrubs which went live immediately) + an adult-content sample.

**Reload note:** `graylist-inject.js` is a web-accessible resource re-injected fresh on each
page load → the 3 JSON-scrub sites went live immediately (confirmed). `content.js` is a
content script → **ScribbleHub needs a manual extension reload** (chrome://extensions →
reload) to activate, as does the 6-site verification pass.

## Phased build status (2026-06-19, session 3) — DOM/age-gate tail

Continued the DOM tail. The 4 content.js DOM rules below all need **one extension reload**
(chrome://extensions → reload) to go live + be E2E-verified — content scripts don't hot-reload
like the WAR-served JSON scrubs.

**✅ Built this session:**
- **ko-fi.com** — DOM page-block (content.js). Recon (logged-in): adult creators flag the page
  with the **"Nsfw" page-category** rendered server-side as `<span class="label-tag">Nsfw</span>`
  in `.tag-container`, and gate it with an "Agree and Continue" SweetAlert for un-age-confirmed
  visitors. The interstitial is transient (skipped once age-confirmed), but the **label-tag
  persists regardless of viewer state** → we key on it, not the gate. **Verified live:** fires
  on an NSFW creator page (ciaracruz13) while logged-in+age-confirmed; does NOT fire on SFW
  pages (feed, supportkofi). Ko-fi policy bars explicit porn → gates suggestive/mature art
  (Webtoons tier). _Extension reloaded this session → rule is live; final E2E navigation pending._
- **tapas.io**, **webtoons.com** — DOM page-block (built session 2/3, selector-verified live).
  _Extension reloaded → live; final E2E navigation pending._

**⛔ Deferred this session (2):**
- **behance.net** — now logged-in on the bridge, but mature content is **off by default** and
  filtered entirely from feeds/search (a "boudoir nude" search returned 48 cards, **zero**
  mature markers — the mature ones simply aren't shown). Only direct-link mature projects gate
  behind an interstitial, which I can't sample because they're filtered everywhere. Compounded
  by **hashed CSS-module classnames** (`ProjectCover-root-X6u`, build-dependent → fragile).
  Adobe bars porn → artistic nudity only. Low leak + high rot → defer.
- **dreamwidth.org** — niche/low-traffic journaling site; no adult-journal sample available to
  verify its interstitial. Optional, low priority → defer.
- **pillowfort** — still deferred (login-walled; real domain is pillowfort.social, not .io).

**🔓 writing.com — UNBANNED (user-requested); RECON COMPLETE, rule ready to write:**
- Was on the curated **blacklist** (`blocklists/domains_part3.json`) → hard-blocked outright.
  User confirmed it's a legit (mostly-SFW) creative-writing community and asked to unban + build
  a graylist rule. **Removed the `"writing.com"` blacklist line.** The blacklist is re-seeded
  from the JSON into chrome.storage only on install/**update**, so the **manifest version bump
  (3.1.7→3.1.8) + an extension reload applied the unban** (confirmed: site now loads in the
  bridge, logged in as `nsfwspy`).
- **Recon done live (post-reload).** Content rating is ground-truth: every item carries a
  `<a class="blue2roll" href="…pop_rhelp&crating=<CODE>">` badge, where **10=E, 20=ASR, 30=13+,
  40=18+, 50=GC, 60=XGC** (40 & 60 confirmed against Writing.Com's own rating-help pages; adult =
  code ≥ 40). Listings/feed put each item in its own `table.norm` (one item + one badge, 27/27);
  an item's OWN rating is the badge preceded by exactly "Rated:" and NOT inside a `table.norm`
  (the preview's "Intro Rated:" and all listing rows are thereby excluded). So one rule hides
  adult listing cards (`markers` + `item:'table.norm'`) AND page-blocks adult item pages
  (`pageLabel`), URL-agnostically.
- **Rule not yet written into code** (another agent is taking the rest). The exact, verified rule
  + the one remaining live test (a rendered adult item — the account ceiling currently blocks 18+)
  are in **[GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md) §2**.

**Manifest:** bumped to **3.1.8** (forced the blocklist re-seed on reload = writing.com unban,
and activated all new content.js DOM rules, incl. Ko-fi).

> **Full session-3 testing method + writing.com findings + remaining-work handoff:**
> [GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md).

## Bottom line (remaining work)

> ⚠️ The per-Tier tables above are the original feasibility analysis. **Build status is
> superseded by the dated session sections** ("Phased build status" 2026-06-18 sessions 1–2 &
> 2026-06-19 session 3) and **[GRAYLIST_SESSION3_HANDOFF.md](GRAYLIST_SESSION3_HANDOFF.md)**.

**Built since this analysis:** sketchfab, 500px, gamebanana, wattpad, fanbox (JSON scrub);
scribblehub, webtoons, tapas, ko-fi (DOM). **Deferred:** royalroad, gog, behance, dreamwidth,
pillowfort. **Unbanned + recon-complete, rule pending:** writing.com.

- **Still to do (handed off):** write the writing.com rule (§2 of the session-3 handoff) + its
  one live positive test; full live E2E pass (ko-fi/scribblehub/webtoons/tapas + the 6-site
  re-verify); **pre-ship cleanup** (`PP_TESTING=false`, restore Newgrounds → blocked.html).
- **Out of scope:** live-video (twitch/kick), libraries (archive, wikimedia), fringe-political
  social — not this product's problem.
- **Scope caution:** every added site is rot surface (Tumblr casing drift + ArtStation
  patch-clobber both bit us). Add high-reach, *verifiable* sites; iterate.
