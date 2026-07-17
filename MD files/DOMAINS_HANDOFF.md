# Domains System — Handoff

> For the next agent. Covers the Phase-2 domain-blocking engine, the multilingual
> keyword rollout, the blocklist pruner, how to test, and what's left.
> Companion doc with the *why*/decisions: [BLOCKING_STRATEGY.md](BLOCKING_STRATEGY.md).
> Last updated: 2026-06-09.

---

## 1. What the domains system is

All blocking logic lives in **[extension/background.js](extension/background.js)** (MV3 service
worker, plain JS, **no build step** — keep it dependency-free). The entry point is
`shouldBlockUrl(url, depth=0)`. It is **deterministic** (no scoring) and **hostname-only**
(never matches paths/queries/page content — that's what caused Phase-1 false positives).

### Pipeline order inside `shouldBlockUrl`
1. **STEP 0 — bypass unwrap.** `unwrapBypassUrl()` decodes translate.goog / `translate.google.com?u=` /
   `web.archive.org/web/<url>` wrappers and **re-checks the real target** recursively (`depth<3`).
   Runs *before* the whitelist so a wrapper on a whitelisted host (translate.google.com) can't slip through.
2. **STEP 1 — SafeSearch** enforcement (Google/Bing/DDG/Yahoo).
3. **STEP 2 — WHITELIST** (`WHITELIST_DOMAINS`, ~110 mainstream domains incl. youtube). Never blocked.
4. **STEP 2b — bypass tools** (`matchesBypassProxy` vs `BYPASS_PROXY_DOMAINS`: proxysite, croxyproxy,
   12ft.io, archive.today…). Blocked outright.
5. **STEP 2c — raw public-IP** navigation (`isPublicIpHost`); private/loopback ranges exempt.
6. **STEP 3 — BLACKLIST** exact/parent-domain match against `blocklistSet` (the curated list).
7. **STEP 3b — DOMAIN-NAME KEYWORD LAYER** (`checkDomainKeywords`) — the heuristic wall. Runs even if
   the list is empty.
8. **STEP 4 — Reddit** path/subreddit keyword filtering.
9. else → `{blocked:false, tier:'unknown'}`.

---

## 2. The keyword layer (`checkDomainKeywords`)

Tiered, all matched against the **lowercased hostname** (after IDN decode). Tiers:

- **`ADULT_TLDS`** — `.xxx .porn .adult .sex .sexy` → instant block.
- **`KEYWORD_STEMS_STRONG`** — long/unambiguous stems, **substring match anywhere** (`porn`, `hentai`,
  `xvideos`, multilingual survivors like `sharmota`, `bokep`, `chudai`, `caonima`…). ~600 entries.
- **`KEYWORD_COMPOUNDS`** — explicit porn compounds that let collision-heavy 3-letter roots match only
  in context (`cumshot`, `asshole`, `bigtits`…). Bare `cum`/`ass`/`tit`/`pussy` are **never** matched.
- **`KEYWORD_ROOTS_GUARDED`** — ambiguous roots matched as substring **but excused by whitelist
  coverage** (`sex`→essex, `anal`→analytics, `puta`→reputable, `seks`→seksen, `chod`→chodron…).
  Coverage logic: `isCoveredByWhitelist()` — a root occurrence is ignored if a `KEYWORD_WHITELIST_WORDS`
  entry (indexed per-root in `WHITELIST_BY_ROOT`) fully spans it.
- **Leetspeak** — `normalizeLeet()` (`LEET_MAP`: 0→o,1→i,3→e,4→a,5→s,7→t,@→a,$→s) applied before matching.
- **Native-script IDN** — `idnToUnicode()` decodes punycode (`xn--`) via a vendored RFC-3492
  `punycodeDecode()`, then matches `NATIVE_STEMS` (~70 multi-codepoint terms: Arabic سكس, Chinese 色情,
  Cyrillic секс, Japanese 変態, Korean 야동, Greek μουνί, Hebrew סקס, Bengali চোদা). Decode happens
  FIRST so a benign ACE string can't coincidentally hit a Latin stem.
- **Homoglyph fold** (Batch 6) — `foldConfusables()` (`CONFUSABLE_MAP`) maps Cyrillic/Greek/Coptic/
  fullwidth lookalikes to Latin so `pоrn.com` (Cyrillic о) folds to `porn`. The folded form is matched
  against **STRONG stems + compounds ONLY — never the guarded roots** — so a legit native word that
  folds into a short root (Russian `соска` → `cocka`) can't become a false positive.

### Adding stems safely (the rule that keeps this from regressing)
For every new term decide a tier by collision risk:
- unique/long & adult → **strong**
- common/short (≤4) or a real word/name/place in *any* language → **guarded** (with whitelist trap words)
  or **compound-only**, or **exclude** entirely (defer to the curated list / native-IDN).
- **Always add the false-positive trap words** to `KEYWORD_WHITELIST_WORDS` and prove them in a regression.

---

## 3. Multilingual rollout — COMPLETE (5 batches)

All of `nsfw_multilingual_keywords.md` (41 languages + Anime/3D, fetish/leak slang, adult-gaming,
AI/deepfake, native-script IDN) is implemented. Per-batch TP/FP counts and the full guarded-root list
are tracked in **[BLOCKING_STRATEGY.md §6](BLOCKING_STRATEGY.md)**. Heavy, deliberate deferral of
short/colliding terms (am, cu, se, av, lund, bund, kuma, mole, ben, rand…) — these go to the curated
list + native-IDN, NOT the substring layer. Graylist sites (furaffinity, boorus…) and `nofap.com`
(recovery resource) are intentionally **not** keyword-blocked.

---

## 4. The blocklist pruner — APPLIED

**[prune-blocklist.cjs](prune-blocklist.cjs)** (repo root, **keep this — reusable tool**). Loads the
real `shouldBlockUrl` (blacklist empty), and for every domain in `extension/blocklists/domains_part{1,2,3}.json`:
removes it if the *logic* already blocks it (keyword/TLD/native/bypass), keeps it otherwise.

Already applied once: **545,762 → 385,588 domains (−160,174, 29.3% redundant)**. Coverage is identical
(the engine catches every removed domain *and* its subdomains, since a subdomain always contains the
parent label/stem). The remaining 385k are domains with **no engine-detectable stem** — the "solid wall".

- `node prune-blocklist.cjs`          → dry-run report
- `node prune-blocklist.cjs --apply`  → write pruned files
- Revert raw list: `git checkout extension/blocklists/`

**Workflow going forward:** add popular domains to the lists → run `--apply` → redundant ones auto-drop.

---

## 5. How to test (IMPORTANT — reuse this)

> **There is now a committed FP corpus: [test-domains.cjs](test-domains.cjs) (repo root, 288 cases).**
> Run `node test-domains.cjs` (full report), `--quiet` (failures + gaps only), or `--fp` (must-allow
> corpus only). It loads the real `shouldBlockUrl` with the shim below and asserts both TP (must block)
> and FP (must allow), plus a `gap()` bucket for documented under-blocks. **Re-run it after any keyword
> edit; keep it green.** Add new collisions there rather than writing new throwaway scripts.

There is no test framework; the corpus and any ad-hoc tests are Node scripts that load the **real**
`background.js` with a `chrome` shim and assert outcomes. Template:

```js
const fs = require('fs');
let code = fs.readFileSync('extension/background.js','utf8') + '\nreturn { shouldBlockUrl };';
const noop=()=>{}, L={addListener:noop};
const chrome={ runtime:{onInstalled:L,onStartup:L,onMessage:L,connectNative:()=>({onMessage:L,onDisconnect:L,postMessage:noop}),getManifest:()=>({version:'t'}),getURL:s=>s,lastError:null},
  storage:{local:{get:()=>Promise.resolve({}),set:()=>Promise.resolve(),remove:()=>Promise.resolve()}},
  tabs:{onRemoved:L,onUpdated:L,get:()=>Promise.resolve({}),update:noop},
  webNavigation:{onBeforeNavigate:L,onHistoryStateUpdated:L},cookies:{set:noop} };
const { shouldBlockUrl } = new Function('chrome','console',code)(chrome,console);
const blocked = u => !!(shouldBlockUrl('https://'+u+'/')||{}).blocked;
// tp(u): expect blocked===true ; fp(u): expect blocked===false
process.exit(0); // background.js sets timers; must exit or it hangs
```
Convention: name them `_*test.cjs` and **delete after running** (`node x.cjs; rm -f x.cjs`). Every batch
was validated TP (must block) + **FP (must allow)**, with FP cases taken from the doc's own WARNING blocks
(essex, diputados, future, curvature, Bundesliga, Samarkand, broccoli, molecule, nofap, Lebanese, Coomera,
Findomestic, münchen, 色彩…).

### ⚠️ Editing gotcha
The Edit tool **interprets `\x00`/`\uXXXX` escape text into raw bytes**. Writing a regex like
`/[^\x00-\x7F]/` via Edit can inject literal NUL/DEL bytes (corrupts the file → flagged binary).
If it happens: find offsets with PowerShell `[Array]::IndexOf($bytes,[byte]0)` and fix via
`[System.IO.File]::ReadAllText/WriteAllText` with explicit `[char]` codes. Verify with
`node -e "new Function(require('fs').readFileSync('extension/background.js','utf8'))"`.

---

## 6. What's left / next tasks

1. **(User is doing this)** Gather more **popular** (not random) domains, append to the JSON lists,
   then run `node prune-blocklist.cjs --apply`.
2. ✅ **DONE (Batch 6)** — committed FP corpus [test-domains.cjs](test-domains.cjs) (288 cases) +
   homoglyph fold. Fixed 20 false positives, demoted 4 over-broad stems, dropped 10 too-ambiguous ones.
   **Keep extending it** with new top-sites/brands/place-names/multi-language words — FP hunting is the
   highest-value safety work and the engine is broad. Run it after every keyword edit.
3. Native-script `NATIVE_STEMS` could be expanded (currently the high-confidence subset).
4. Phases beyond 2 (Graylist V2 API-interception → Phase 3; watchdog/friction → Phase 4) are separate;
   see the master plan.

---

## 7. State at handoff (uncommitted unless noted)
- `extension/background.js` — full engine (bypass + tiered keyword + leet + native-IDN + ~700 stems)
- `extension/blocklists/domains_part{1,2,3}.json` — **pruned** (385,588 total)
- `prune-blocklist.cjs` — pruner tool (untracked)
- `BLOCKING_STRATEGY.md` — strategy/decisions + rollout tracker
- `Oath_Light_Master_Plan.md` — Phase 2 items (keyword layer, bypass-vector)
- Only **Batch 1** of the keyword work was committed earlier; Batches 2–5, the prune, and the tool are uncommitted.

### Non-negotiable principle
**No false positives.** Deterministic only (no scoring). Hostname-only. Every new stem is collision-checked
against an FP regression before it lands. A blocked legit site is worse than a missed porn site, because
the missed one is caught by the curated list / accountability layer.
