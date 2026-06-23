# Pure Path — Blocking Strategy

> Reference doc for the domain-blocking and graylist rework.
> Last updated: 2026-06-05

This captures the decisions behind how Pure Path blocks, so the reasoning travels
with the code and isn't lost. It feeds two planned items in the master plan:
**Domain-name keyword layer (Phase 2)** and **Graylist V2 — API interception (Phase 3)**.

---

## 1. Domain blocking (the blacklist)

**Problem:** A pure list misses unlisted sites (e.g. `sex4arabs.com`), but the old
"smart" keyword blocking caused false positives — a YouTube short or a download link
containing "ass" got blocked. This is the *Scunthorpe problem*: short tokens collide
with innocent text (`sex` in Sussex/Essex, `cum` in document/cumulative, `ass` in
assassin/class/embassy).

### Fix — Domain-name keyword layer  *(→ Phase 2)*
- **Deterministic, not score-based** — a binary rule, same authority as the list.
  (Score-based blocking is rejected: it's unpredictable and undebuggable — the
  "why did it block my download" nightmare.)
- Matches strong stems (`sex`, `porn`, `xxx`, `hentai`, `nsfw`, `milf`, `camgirl`…)
  **only against the registrable domain label / eTLD+1** — never paths, queries,
  or page content. That scoping is what kills the false positives: `youtube.com`
  contains no stem; `sex4arabs` does.
- Runs **only after** the exact-list `Set` miss (`background.js`, after the blacklist
  loop). ~80 substring checks on a short string = microseconds. Not slower than the list.
- **Tier stems by collision risk** (this is the core false-positive safety):
  - *Tier A — long / unambiguous, match anywhere in the label:* `porn`, `pornhub`,
    `xvideos`, `xnxx`, `hentai`, `xxx`, `nsfw`, `milf`, `brazzers`, `onlyfans`, `camgirl`…
  - *Tier B — short, collision-prone, only with exception-list guard:* `sex`
    (→ essex, sussex, middlesex, sexton, sextant…).
  - *Tier C — 3-letter, NEVER match standalone, only inside known compounds:*
    `cum`→`cumshot`/`cumslut`, `ass`→`asshole`/`assfuck`. Bare `cum`/`ass` are banned —
    they collide with cumulative, document, circumstance, class, embassy, assassin…
- **Collision-exception (whitelist) list is mandatory** and must cover the
  `cum`/`ass`/`sex` families: `cumulative`, `cucumber`, `document`, `documentary`,
  `circumstance`, `accumulate`, `incumbent`, `cumberland`, `cumin`, `essex`, `sussex`,
  `middlesex`, `analytics`, `analysis`, `therapist`, `assassin`, `embassy`, `classic`,
  `assets`, `assignment`, `association`…
- **Leetspeak** normalization (`p0rn`→porn, `s3x`→sex) applied to the label *before*
  matching, kept conservative so it never creates new collisions. (Implemented before —
  reuse, but with the tiering + exception list above.)

```
if blocklistSet.has(domain)                          -> block   (curated list, exact)
else if domainLabel contains a strong stem
        AND label not in collision-exceptions         -> block   (the long tail)
else                                                  -> allow
```

### Supporting layers (optional)
- **RTA / adult `<meta>` scan** — `<meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">`
  and `content="adult"`. Adult sites self-declare this so filters catch them.
  Universal catch-net for *dedicated* porn domains, near-zero false positives.
  Already half-implemented on Newgrounds.
- **DNS categorization upstream** (HaGeZi adult list / Cloudflare Family `1.1.1.3` /
  NextDNS) in the desktop app — catches *cleverly* named domains with no keywords.
  This is where a large external feed belongs — **not** baked into the extension.

### Principle
Keep the **curated 500k active domains** as the backbone. Do **not** dilute it with a
stale 2–6M scrape — quality beats quantity. A raw mega-list reintroduces the Phase 1
dead-site / false-positive problem at scale. New porn domains spawn faster than any
list updates; 100% domain coverage is unreachable, so **Phase 4 friction/accountability
is the real moat**, not list size.

---

## 2. Graylist (mixed-content platforms)

**Problem:** Per-site CSS UI-hiding + DOM toggle-forcing **rots constantly** — selectors
break on every site redesign. Cookies mostly don't work anymore either: Reddit/X moved
their NSFW preference to **server-side, per-account** settings, so a client cookie can't
fake it. Out of ~50 graylist sites, only ~4 ever had cookie enforcement, and even those
are unreliable now.

Key realization: UI-hiding is the **weakest and highest-maintenance link**, and it
doesn't even enforce anything — it just hides the lever.

### Fix — Graylist V2: API / network-layer interception  *(→ Phase 3)*
- Read the site's **own per-item NSFW label** in the JSON it fetches, and **strip the
  flagged items before the page renders them.**
- **Ground-truth, not a heuristic** — it's the exact same boolean the site uses to
  decide whether to blur. As accurate as the site's own labeling.
- **Survives UI redesigns** because API fields stay backward-compatible for years
  (third-party clients depend on them). `over_18` hasn't moved in ~15 years; the React
  components that render it change every few months.
- You **become the filter** instead of depending on theirs — their broken/bypassed
  toggle no longer matters.
- Implementation: needs a **`world: "MAIN"` injected script** to patch `fetch`/XHR
  (the current content script runs in the isolated world, where patching `fetch`
  wouldn't affect the page).

Stable per-item NSFW fields:

| Site | Field |
|---|---|
| Reddit | `data.over_18` |
| X / Twitter | `possibly_sensitive` |
| Pixiv | `xRestrict` (0=safe, 1=R18) |
| Mastodon (all instances) | `sensitive` |
| Bluesky | label system (`porn`, `sexual`, `nudity`) |
| Tumblr | `is_nsfw` / `is_adult` |
| Boorus (danbooru etc.) | `rating` (s/q/e) |

### Strictness model
- **Standard** — best-effort in-site filtering (for people who need a site for work).
- **Strict** — block the whole site / allowlist-only.
- Anti-addiction → **bias defaults toward blocking.** Half-working enforcement gives a
  false sense of security, which is the exact failure mode this software exists to prevent.

---

## 3. Per-site triage (the ~50 graylist domains)

| Bucket | Mechanism | Sites |
|---|---|---|
| ✅ **API-intercept** | strip flagged items from JSON | reddit, x/twitter, **all Mastodon**, bluesky, tumblr, minds, gab, pixiv, deviantart, vimeo, dailymotion, odysee, patreon, nexusmods, gumroad, itaku, imgur (feeds), boorus (danbooru/konachan/safebooru) |
|  **DOM-label** | read stable rating class/attr (SSR sites) | newgrounds, archiveofourown, furaffinity, inkbunny, sofurry, fanfiction.net |
|  **Block whole site** | no per-item label exists | **video-chat** (ome.tv, chatroulette, shagle, strangercam, dirtyroulette, camgo, bazoocam, coomeet) |
|  **Block NSFW channels/servers, keep platform** | surgical sub-unit block | **Discord, Telegram, Kik, Snapchat, WhatsApp**; chans (block NSFW boards); Discord directories (drop once Discord blocking exists) |
|  **Move to blacklist** | entirely NSFW — filtering = blocking | redgifs, rule34.*, e621, literotica, chyoa, loverslab, f95zone, lewdrg, subscribestar.adult, baraag, pawoo, poa.st |
|  **Don't block** | too much collateral | shorteners (bit.ly, tinyurl, t.ly, shorturl.at) → resolve-and-check destination later, not a domain block |
|  **Let slide** | general-purpose, not *mainly* NSFW | file hosts: catbox family, pomf, uguu, postimg (direct-link only — can't be browsed). *imagebam / imagevenue borderline (heavy adult-gallery history) — block if going strict* |
|  **Dead → removed** | shut down | cohost.org, koo.app, gfycat.com, omegle.com |

### Messaging — never whole-site blocked
People need these for legit communication. Block the NSFW sub-units, not the domain:

- **Discord** — genuinely feasible. NSFW channels carry an **age-restricted flag**;
  NSFW servers are identifiable. The real target, worth building.
- **Telegram** (`t.me` / web) — no global flag; block specific NSFW channels/groups
  by handle, or keyword-match the channel name.
- **Snapchat / Kik** — limited. Mostly private 1:1 sharing, no public channel
  structure; little lever beyond Snapchat Spotlight/Discover.
- **WhatsApp** —  chats are end-to-end encrypted (invisible). Only the newer
  **Channels** feature is visible; private/group sharing can't be touched. Minimal —
  but still never whole-site blocked.

---

## 4. Hardening — anti-bypass  *(content-bypass → Phase 2)*

What separates a *filter* from an *anti-addiction tool*. Two failure modes:
- **Content bypass** — reach blocked content through a wrapper (handled here, blocking-logic level, **Phase 2**).
- **App-disable bypass** — turn the tool off (the Phase 4 watchdog's job, not this section).

**Core principle: unwrap, then re-check.** Most bypasses wrap the real destination inside
another URL. Pull the real target out of the wrapper and run it through the *normal*
blocking pipeline — that's low-collateral (a clean site through Translate stays allowed;
pornhub through Translate gets blocked). Only blanket-block tools that exist *purely* to bypass.

| Vector | Example | Handling |
|---|---|---|
| Web proxies / unblockers | proxysite.com, croxyproxy, 12ft.io, hide.me, kproxy | Block the domain outright — no legit use |
| Translation proxy | `pornhub-com.translate.goog`, `translate.google.com/?...&u=<target>` | **Unwrap** the target (decode the `.translate.goog` subdomain / read `u=`) and re-check. Don't blanket-block — translation is legit |
| Archive / cache viewers | archive.today (.ph/.is/.li), `web.archive.org/web/<url>` | **Unwrap** the embedded target URL and re-check. archive.today has little legit use → may block outright; Wayback → unwrap |
| Raw-IP navigation | `http://104.21.x.x` | Block direct-IP URLs; **exempt** private ranges (127.*, 10.*, 192.168.*, 172.16–31.*) and localhost |

Notes:
- DoH (DNS-over-HTTPS) bypass only matters once DNS-level blocking exists — **deferred**
  (not doing DNS yet).
- Seed the proxy/unblocker domain list manually; do **not** wire in a DNS feed yet.

---

## 5. Changes already applied
- Added `lewdrg.com` to `extension/blocklists/domains_part2.json` (only entirely-NSFW
  site that was missing — all chans, video-chat, and other NSFW sites were already blocked).
- Removed 4 dead domains from `Graylistfoundomains.txt` (both the category lists and
  the reliability analysis).
- Added **Domain-name keyword layer** to Phase 2 of `Pure_Path_Master_Plan.md`.
- Added **Graylist V2 (API interception)** to Phase 3.
- **Built Graylist V2 — API/network-layer interception** (`extension/graylist-inject.js`):
  - A `world:"MAIN"` script (injected by `content.js` as an external web-accessible
    `<script src>`, so it bypasses strict page CSP that blocks inline scripts) patches
    `window.fetch`, reads the site's own per-item NSFW label in the JSON it downloads, and
    **strips the flagged items before the page renders them** — we become the filter.
  - Config-driven scrubber with per-host rules + signals: reddit `over_18`/`isNsfw`,
    X/Twitter `possibly_sensitive`, pixiv `xRestrict`, Mastodon (any instance, matched by
    stable REST paths) `sensitive`, Bluesky `labels`, Tumblr `is_nsfw`/`is_adult`, boorus
    `rating`. New sites = one entry in the `RULES` table.
  - **Depth-first removal** at the finest array level: X buries `possibly_sensitive` under
    `instructions[] → entries[]`; cleaning `entries[]` first lets the batch (and its cursor
    + safe tweets) survive instead of nuking the whole instruction. Validated against real
    response shapes for all 7 sites + cursor-survival + all-safe-passthrough.
  - Self-gates on the request URL (cheap substring pre-filter before any URL parse / body
    read), so it's near-free on the ~99.9% of pages/requests that don't match. All-safe
    responses are returned untouched (no rebuild). fetch-only for now (the listed SPAs all
    use fetch); XHR-based legacy APIs are a documented follow-up.
  - Stripped-item counts post-message to `content.js`, which relays `graylistFiltered` to
    `background.js` → `stats.graylistFiltered` (tracked separately from navigation blocks).
  - The old per-site CSS layer in `content.js` (`GRAYLIST_FILTERS` UI/content hiding,
    `rawCSS`, the cheeky popup + click interception, Reddit/X/Newgrounds toggle-forcing,
    and shadow-DOM enforcement) was **removed entirely** — V2 fetch interception is the sole
    graylist mechanism now. Kept in `content.js`: SafeSearch UI hiding (search engines, not
    graylist), the Newgrounds "Content Filtered" bypass-page block (a hard redirect, not
    UI-hiding), and SPA URL monitoring (delegates to background navigation blocking).
    *Trade-off:* DOM-label/SSR-only sites with no JSON feed (newgrounds, AO3, furaffinity)
    are no longer content-filtered by CSS — a DOM-label pass for those is a follow-up.
- **Added the API-intercept rules** for reddit, x/twitter, pixiv, tumblr, bluesky, Mastodon
  (all instances, path-matched), boorus, **imgur** (`nsfw`), **nexusmods**
  (`contains_adult_content`), **deviantart** (`is_mature`). Depth-first scrubber, fetch-only.
- **Built the DOM-label engine** (`content.js` `DOM_LABEL_RULES`) for the SSR sites: newgrounds,
  AO3, furaffinity, fanfiction.net (+ best-effort inkbunny/sofurry). Listing items removed by
  their own rating marker; **content pages hard-blocked** by a page-level rating read
  (`pageLabel`/`pagePath`) — closes the "adult preference already enabled server-side" leak that
  item-hiding can't reach. No toggle-forcing (the rot-prone V1 mechanic) is restored.
- **Reddit search went nuclear** (reddit-only): the `q=` param is matched against the full soft +
  hard keyword lists (whole-word for short keywords to avoid Scunthorpe, substring for ≥4-char).
- **Surfaced the covered-site catalog** in both UIs (`extension/graylist-sites.js` + desktop store),
  replacing the stale placeholder list.

---

## 6. Multilingual keyword rollout

Source intel: `nsfw_multilingual_keywords.md` (41 languages + Anime, Internet-subculture,
Adult-gaming, AI/Deepfake sections, ~2,100 lines). Rolled out in **vetted batches**, not all
at once — most foreign transliterations collide with names/places/common words, so each term
is classified `strong` / `guarded` / `compound` / **excluded** using that language's own
WARNING block. Excluded short/ambiguous terms (`am`, `cu`, `se`, `av`, `lund`, family-relation
words…) are deferred to the curated list + native-script (IDN) matching.

| Batch | Scope | Status |
|---|---|---|
| **1** | ES, FR, DE, PT, AR, RU, ZH, TR, JA, HI | ✅ **done** — 58 TP / 53 FP-trap regression all pass |
| **2** | IT, NL, PL, KO, ID, VI, EL, RO, BN (+ TH deferred to IDN) | ✅ **done** — 50 TP / 56 FP-trap regression all pass |
| **3** | Scandinavian, CS, HU, TL, FA, UK, FI, HE, TA/TE, MS, PA, UR, SW, AF, SR, BG, SK, ML/KN, MR (GU via existing guards) | ✅ **done** — 70 TP / 56 FP-trap regression all pass |
| **4** | special sections: Anime/3D, fetish/leak slang, adult-gaming mods (incl. child-protection: robloxcondo/gachaheat), AI/deepfake (civitai/deepnude/undressai…) | ✅ **done** — 64 TP / 31 FP-trap regression all pass |
| **5** | **native-script IDN** — vendored RFC-3492 punycode decoder + ~70 native stems (Arabic سكس, Chinese 色情, Cyrillic секс, Japanese 変態, Korean 야동, Greek μουνί, Hebrew סקס, Bengali চোদা…) | ✅ **done** — 19 TP / 10 FP-trap regression all pass |
| **6** | **adversarial + wordlist hardening** — committed FP corpus `test-domains.cjs` (288 cases) + `audit-wordlist.cjs` (brute-forces a wordlist through the engine). Made `cock`/`dick` compound-only, dropped ~25 net-negative foreign stems, demoted several to guarded, added a homoglyph fold + real-website trap words. | ✅ **done** — 288/288 pass; of top-20k common English words only 53 block, **all genuine adult terms (0 FPs)** |

Each new term is collision-checked against the FP-trap regression before landing. Guarded roots
so far: `sex anal cock dick rape cunt milf` (EN) + `seks puta pute randi chut chod salope`
(B1) + `sesso figa puttane hoer dupa sperma curva malakia chikan` (B2)
+ `porr kunda picsa dengu poes picka ebane ebati tissi` (B3)
+ `thot findom coomer` (B4)
+ `luder rumpa titten kulli` (B6 — **demoted from `strong`** because they collided with
real words: ex/in/con-**cluder**, "**t-rump-a**rmy", **Tittensor**, **skull**-island).

### Batch 6 — adversarial + wordlist hardening (matches the code; see `test-domains.cjs`, `audit-wordlist.cjs`)
The strong tier is substring-matched with **no** whitelist guard, so any short/common term placed
there is an unfixable false positive. Two methods drove this batch: a hand-built adversarial corpus
(`test-domains.cjs`), and a brute-force of a wordlist through the real engine (`audit-wordlist.cjs`).
**Methodology note:** the wordlist audit targets *real-website vocabulary* (top-20k common English),
not the full dictionary — a blocked `turbocharger` matters; a blocked archaic relic (`analgesidae`,
`porringer`) does not and is intentionally left alone.

- **`cock` & `dick` made COMPOUND-ONLY** (removed from guarded; they live only in `KEYWORD_COMPOUNDS`
  now, like `cum`/`ass`/`tit`/`pussy`). As bare roots they collided with ~190 real words —
  `blackcock`/`woodcock`/`billycock`/`bibcock`/`peacock`, `medick`, `dickcissel`, `Moby-Dick`,
  `Dickens`. Added porn compounds to compensate (`hugecock cockslut dickslut dicksucking`…).
- **Dropped from `strong` entirely** (term value < English-collision cost — deferred to curated + IDN):
  `puku itil foder borsten sletten geci fudi pudi gasti naai` (adversarial) **+** `hure` (→ **brochure**),
  `tette` (→ quartette/octette), `peler` (→ gospeler), `siski` (→ siskin), `chinko` (→ **pachinko**),
  `mamme`, `airmani`, `zayin`, `zonot`, `ipella`, `jebat` (→ Hang Jebat) (wordlist audit).
- **Demoted `strong` → `guarded`** with trap words: `luder rumpa titten kulli` (adversarial) +
  `pillu` (→ lapillus), `gooning` (→ dragooning), `zoophil` (→ zoophilous), `bocha` (→ **turbocharger**).
- **`thot` dropped from `guarded`** — collided with `orthotic`/`lithotomy`/`lithotripsy` (slang, low value).
- **New FP-trap words** in the guarded whitelist (only ever *allow*, never block more): rape→`trapez
  serape crape traper parape`; sex→`sexsmith sexey desex bissext sextil`; anal→`kanal manali panal
  bacchanal analci analect analept`; randi→`mirandi prandi operandi jaborandi`; curva→`incurva curvat
  recurva`; sesso→`sessor` (**assessor**); bocha→`bochar` (**turbocharger**); tissi→`tissim`
  (**fortissimo**); chod→`nchod ychod` (**bronchodilator**/psychodrama); puta→`putamen laputa`;
  onani→`nonani`; kunda→`kundera mukunda kundan`; + ecchi/poes/chut/picka/dupa/etc.
- **Homoglyph / confusable fold** (`CONFUSABLE_MAP` + `foldConfusables`): Cyrillic/Greek/Coptic/
  fullwidth lookalikes fold to Latin so `pоrn.com` (Cyrillic о) → `porn`. Folded form is checked
  against **strong stems + compounds only, never the guarded roots** — so a legit native word that
  folds into a short root (Russian `соска` → `cocka`) cannot become a false positive.
- **Result:** of the top-20k common English words, **53 block — all genuine adult terms, 0 false
  positives**. `analysis`/`analytics`/`turbocharger`/`assessor`/`brochure` all pass.
- **Known residual gaps (documented, not fixed):** separator/truncation evasions
  (`p-o-r-n`, `pron-hub`, `chaturb8`, `x-h4mster`); the `porn`-core collateral on Pornic/Pornichet
  (French towns) and rare bird terms `agapornis`/`epornitic` (can't guard the core stem); and the
  archaic-dictionary long tail (`analgesidae`, `aporrhais` — not real sites, intentionally ignored).

---

## 7. Open decisions
- **File hosts — RESOLVED:** rule = "block only if *mainly* NSFW." None of the remaining
  hosts qualify (redgifs already moved to blacklist), so they **slide**. Only `imagebam` /
  `imagevenue` are borderline (heavy adult-gallery history) — block those if going strict.
- **Codify the triage** into a single machine-readable config (each domain tagged
  `api-intercept` / `dom-label` / `block` / `channel-block` / `blacklist` / `drop`) that
  the Graylist V2 build reads from as its source of truth.
