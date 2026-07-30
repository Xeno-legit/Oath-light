# Oath Light — Architecture

> How Oath Light actually blocks, today. This is the working reference for
> anyone changing the filter: the layer stack, the decision pipeline, the rules
> that keep the keyword engine from producing false positives, and how the
> desktop app enforces what the extension can't.
>
> For *why* the product exists and where it's going: [MASTER_PLAN.md](MASTER_PLAN.md)
> and [../ROADMAP.md](../ROADMAP.md). For what it does with your machine:
> [../SECURITY.md](../SECURITY.md).

---

## 1. The layer stack

A request is blocked if **any** layer matches. They are deliberately redundant —
each one is built to catch what the one before it was never designed to see.

| # | Layer | Lives in | What it catches |
| :-- | :-- | :-- | :-- |
| 1 | Curated blacklist (385k domains) | extension + DNS resolver | Known NSFW domains |
| 2 | Keyword engine (41 languages) | `bg/matching.js` + `core/matching.rs` | Unlisted domains whose name gives them away |
| 3 | Graylist V2 (per-item stripping) | `graylist-inject.js`, `content.js` | NSFW items inside legitimate platforms |
| 4 | SafeSearch + search-query filter | `bg/matching.js` | Search as a discovery path |
| 5 | Bypass defense | `bg/matching.js` | Proxies, translate/archive wrappers, raw IPs |
| 6 | System DNS filter | `dns/` crate | Every app on the machine, not just browsers |
| 7 | On-device AI monitor | `src-tauri/src/nsfw.rs` + `nudenet.rs` | What no list can name — the visual residual |
| 8 | Friction + watchdog | `friction.rs`, `uninstall.rs`, `guardian/` | The user's own weak moment |

**Design rule:** the DNS layer (6) is a *backstop*, never a replacement. It
answers "is this whole domain allowed?" — per-item stripping, SafeSearch and
block pages are extension work. The extension stays the precision layer.

---

## 2. Extension

Plain JavaScript, **no build step** — keep it dependency-free. MV3 service
worker.

| File | Responsibility |
| :-- | :-- |
| `background.js` | Service-worker entry: navigation listeners, block routing, stats, module load order |
| `bg/matching.js` | `shouldBlockUrl()` — the whole decision pipeline and the keyword engine |
| `bg/blocklists.js` | Loads/caches the sharded curated lists, exact-and-parent matching |
| `bg/graylist.js` | Graylist site table and per-host rule lookup |
| `bg/native-bridge.js` | Native-messaging channel to the desktop service |
| `bg/ota.js` + `bg/noble-ed25519.js` | Signed over-the-air blocklist updates |
| `bg/reminders.js` | Vulnerable-hours reminders and window signalling |
| `content.js` | Isolated-world: SafeSearch UI hiding, DOM-label filtering for SSR sites, SPA URL monitoring |
| `graylist-inject.js` | MAIN-world: patches `fetch` and strips flagged items before render |
| `strings.js` + `voice-sync.js` | The voice layer — copies of `design-system/`, see §6 |

### 2.1 `shouldBlockUrl(url, depth)` — pipeline order

Deterministic, no scoring. Order matters; each step exists to close a hole the
previous one left.

| Step | Check |
| :-- | :-- |
| **-1** | **Lockdown Mode** — allowlist-only browsing; the first check, before everything |
| **0** | **Bypass unwrap** — decode `.translate.goog`, `translate.google.com?u=`, `web.archive.org/web/<url>` and re-check the real target recursively (`depth < 3`). Runs *before* the whitelist so a wrapper on a whitelisted host can't slip through |
| **1** | SafeSearch enforcement (Google, Bing, DDG, Yahoo) |
| **1.5** | Trusted hosts with explicit galleries / sex-act articles |
| **1.6** | Adult **search** on a whitelisted host (Quora, Amazon, eBay, Crunchyroll) |
| **2** | **Whitelist** — ~110 mainstream domains, never blocked |
| **2b** | Bypass tools (proxysite, croxyproxy, 12ft.io, archive.today…) — blocked outright |
| **2c** | Raw public-IP navigation; loopback and private ranges exempt |
| **3** | **Blacklist** — exact-and-parent match against the curated list |
| **3a** | Supplemental curated list — uncensored AI / late additions |
| **3b** | **Domain-name keyword layer** (§2.2) — runs even when the list is empty |
| **4** | Reddit path/subreddit keyword filtering |
| **5** | Patreon search — nuclear keyword filter |
| **6** | Graylist search — nuclear keyword filter on every other graylisted host |
| **7** | **URL path/query keyword layer** — Strict/Lockdown/Serious only, evaluated last |
| — | else → `{ blocked: false, tier: 'unknown' }` |

### 2.2 The keyword engine

Matched against the **lowercased hostname** — never paths or page content
(step 7 is the one deliberate, gated exception). Hostname-only scoping is what
killed the Phase-1 false positives.

- **`ADULT_TLDS`** — `.xxx .porn .adult .sex .sexy` → instant block.
- **`KEYWORD_STEMS_STRONG`** (~600) — long, unambiguous, substring-matched
  anywhere: `porn`, `hentai`, `xvideos`, `sharmota`, `bokep`, `chudai`…
- **`KEYWORD_COMPOUNDS`** — lets collision-heavy 3-letter roots match only in
  context (`cumshot`, `asshole`, `bigtits`). Bare `cum`/`ass`/`tit`/`pussy` are
  **never** matched. Same for `cock`/`dick` — as bare roots they collided with
  ~190 real words (woodcock, Dickens, Moby-Dick).
- **`KEYWORD_ROOTS_GUARDED`** — ambiguous roots matched as substring but excused
  when a whitelist word fully spans the hit (`sex`→essex, `anal`→analytics,
  `curva`→curvature, `sesso`→assessor, `bocha`→turbocharger).
- **Leetspeak** — `normalizeLeet()` before matching (`p0rn`→porn).
- **Native-script IDN** — vendored RFC-3492 punycode decode **first**, then ~70
  native stems (Arabic سكس, Chinese 色情, Cyrillic секс, Japanese 変態, Korean
  야동, Greek μουνί, Hebrew סקס, Bengali চোদা). Decoding first stops a benign
  ACE string coincidentally hitting a Latin stem.
- **Homoglyph fold** — `foldConfusables()` maps Cyrillic/Greek/Coptic/fullwidth
  look-alikes to Latin (`pоrn.com` → `porn`). The folded form is checked against
  **strong stems and compounds only, never guarded roots**, so a legitimate
  native word that folds into a short root (Russian `соска` → `cocka`) cannot
  become a false positive.

**The non-negotiable principle: no false positives.** A blocked legitimate site
is worse than a missed porn site, because the missed one gets caught by the
curated list, the DNS layer, or the accountability layer — while a wrong block
destroys trust in the whole tool.

**Adding a stem safely** — pick a tier by collision risk:

| Term shape | Tier |
| :-- | :-- |
| Unique / long / unmistakably adult | `strong` |
| Common, short (≤4), or a real word/name/place in *any* language | `guarded` + trap words, or compound-only |
| Still ambiguous after that | **exclude** — defer to the curated list and native-IDN matching |

Always add the false-positive trap words to `KEYWORD_WHITELIST_WORDS` and prove
them with a regression case before landing.

**Known collateral, accepted on purpose:** the `porn` stem catches Pornic and
Pornichet (French towns) and the bird terms `agapornis`/`epornitic` — the core
stem is not guardable, and the trade is worth it. The archaic-dictionary long
tail (`analgesidae`, `aporrhais`) is ignored: those aren't real sites.

Hardening cases that are still open live in `extension/tests/` as `gap()`
entries, not in this document — that way closing one means deleting a line from
a test file rather than editing prose.

### 2.3 Graylist V2 — per-item stripping

The problem: mixed-content platforms can't be whole-site blocked (people need
them) and can't be left alone. The V1 answer — per-site CSS hiding and toggle
forcing — rotted on every redesign and enforced nothing; it only hid the lever.
Cookies stopped working when Reddit and X moved the NSFW preference server-side.

The V2 answer: read the platform's **own per-item NSFW label** out of the JSON
it fetches and remove flagged items before render. Ground truth, not a
heuristic — the same boolean the site uses to decide whether to blur — and it
survives redesigns because API fields stay backward-compatible for years while
React components change monthly.

- `graylist-inject.js` runs in the **MAIN world**, injected by `content.js` as
  an external web-accessible `<script src>` so strict page CSP can't stop it
  (the isolated world can't patch the page's `fetch`).
- Config-driven scrubber, one `RULES` entry per host. Labels in use: Reddit
  `over_18`, X `possibly_sensitive`, Pixiv `xRestrict`, Mastodon `sensitive`,
  Bluesky `labels`, Tumblr `is_nsfw`, boorus `rating`, NexusMods
  `contains_adult_content`, Mangadex `contentRating`, Writing.com `crating`.
- **Depth-first removal** at the finest array level: X buries
  `possibly_sensitive` under `instructions[] → entries[]`, so cleaning
  `entries[]` first lets the batch, its cursor and its safe items survive
  instead of nuking the whole instruction.
- Self-gates on a cheap URL substring before any parse or body read, so it is
  near-free on the ~99.9% of requests that don't match. All-safe responses are
  returned untouched.
- SSR sites with no JSON feed (Newgrounds, AO3, FanFiction.net, Webtoons,
  Tapas, Ko-fi, Writing.com) are handled by `DOM_LABEL_RULES` in `content.js`:
  listing items removed by their own rating marker, content pages hard-blocked
  by a page-level rating read — which closes the "adult preference already
  enabled server-side" leak that item-hiding can't reach.

**Triage rule for a new platform:** filter in place only when there is real SFW
value *and* a per-item label exists. Mostly-NSFW or unlabelled platforms go to
the blacklist; messaging platforms are never whole-site blocked — block the
NSFW sub-unit (Discord age-restricted channels/servers) instead.

### 2.4 Blocklist maintenance

- Lists live in `extension/blocklists/domains_part{1,2,3}.json`, sharded and
  loaded into the worker at startup.
- **`scripts/prune-blocklist.cjs`** removes every domain the *engine* already
  blocks: a domain with a detectable stem is redundant, because the keyword
  layer catches it and all its subdomains. Applied once already: 545,762 →
  385,588 (−29.3%); the list stands at 385,597 today. The remainder is the
  "solid wall" — domains with no machine-detectable stem.
  - `node scripts/prune-blocklist.cjs` → dry run · `--apply` → write
  - Revert with `git checkout extension/blocklists/`
  - Workflow: add popular domains → run `--apply` → redundant ones drop out
- **Quality beats quantity.** Do not dilute the curated list with a stale
  multi-million-entry scrape; that reintroduces the Phase-1 dead-site and
  false-positive problem at scale. 100% domain coverage is unreachable — the
  friction and accountability layers are the real moat, not list size.
- Community list PRs are gated by `scripts/ci/check-list-pr.mjs`; see
  [../CONTRIBUTING.md](../CONTRIBUTING.md).
- Shipped lists are updated over the air: signed manifest (ed25519), fetched and
  verified by `bg/ota.js`. Key handling is in [OTA_KEYS.md](OTA_KEYS.md).

### 2.5 Tests

No framework — Node scripts that load the **real** `background.js`/`matching.js`
with a `chrome` shim and assert outcomes. `node extension/tests/run-all.cjs`
runs every suite (632 cases across 9 suites at last count).

Re-run after **any** keyword edit and keep it green. Add new collisions to the
committed corpus rather than writing throwaway scripts.

---

## 3. Desktop app

Tauri 2, Rust core, plain-JSX renderer transpiled in-browser by
babel-standalone (no bundler).

### 3.1 Crates

| Crate | Owns |
| :-- | :-- |
| `core/` (`oathlight-core`) | Everything used by more than one binary and everything mobile will need: domain matching, the Rust keyword engine, the hash-chained event log, DoH endpoint data, list loading, OTA verification |
| `src-tauri/` | The app: commands, state, monitor loop, all the feature modules below |
| `dns/` (`oathlight-dns`) | The filtering resolver: packet parse, decide, upstream forward, adapter takeover |
| `guardian/` | The watchdog process that keeps the service alive (and is kept alive by it) |
| `native-host/` | The native-messaging host binary the browsers launch |

`oathlight-core` is deliberately the mobile strategy: Pillar 7 becomes "bind
core via UniFFI", not a rewrite. Keep Windows-only dependencies behind `#[cfg]`
and keep the surface UniFFI-friendly (plain structs, no Tauri types).

### 3.2 `src-tauri/src` modules

| Module | Responsibility |
| :-- | :-- |
| `lib.rs` | Commands, `AppState`, the monitor loop and its Clear→Suspect→Acting escalation, process enforcement |
| `settings.rs` | `SettingsV1` — the single versioned settings struct and the one sync channel |
| `friction.rs` | The generalized delayed-weakening state machine. Strengthening instant, weakening delayed |
| `uninstall.rs` | 24h cool-off, random 12-word confirmation phrase, double autostart registration |
| `lockdown.rs` | Allowlist-only browsing; clock-tamper-immune store |
| `auth.rs` | Argon2 master password / second-keyholder gate |
| `watchdog.rs` | Service/guardian mutual supervision |
| `browsers.rs` | Policy-hive writes: force-install, DoH disable, incognito/guest blocking, evasion-browser detection |
| `profiles.rs` | Per-browser profile discovery and extension-presence checks |
| `dns_filter.rs` | Wraps the `dns` crate: enable/disable, adapter takeover, friction gating |
| `nsfw.rs` + `nudenet.rs` | The ONNX ensemble — SigLIP Image-Guard for the whole frame, NudeNet for localized detection |
| `screen.rs` | Multi-monitor capture and cheap per-monitor change fingerprinting |
| `overlay.rs` | The AI's only actuator: fullscreen dwell-gated overlay, server-side dismiss check |
| `evallog.rs` | False-positive log (scores + FNV frame digest, never the frame) and dwell auto-tune |
| `recovery.rs` | Urge log, slip log, streak — backend-owned, with everything derived computed once |
| `grayscale.rs` | Windows colour-filter control during vulnerable hours, restored on an absolute deadline |
| `notify.rs` | Trusted-contact notification (SMTP, `mailto:` fallback) |
| `ota.rs` | Signed list-update fetch/apply |

### 3.3 Extension ↔ desktop bridge

```
 ┌──────────────┐  connectNative   ┌─────────────────┐  TCP 127.0.0.1:17243  ┌──────────────┐
 │  extension   │ ───────────────► │   native host   │ ────────────────────► │  desktop app │
 │ background.js│ ◄─────────────── │ oath-light-host │ ◄──────────────────── │ (Tauri/Rust) │
 └──────────────┘  stdin/stdout    └─────────────────┘  length-prefixed JSON └──────────────┘
        (one host process per running browser)                                      │
                                                                        monitor loop (sysinfo)
```

Each **running** browser that has the extension spawns its own host process and
its own TCP connection. The host walks the parent PID chain to identify its
browser and sends `host_hello { browser, extOrigin }` as its first message, so
the app tracks every browser independently in a `connections` map reconciled
every 3s against what `sysinfo` says is actually running.

| Per-browser state | Meaning |
| :-- | :-- |
| `not_installed` | Browser not detected on the machine |
| `idle` | Installed, not running |
| `connecting` | Running, inside the 45s grace window, extension not yet talking |
| `running_connected` | Running with a fresh heartbeat (≤40s) — protected |
| `extension_missing` | Running >45s with no live extension — disabled or removed |

Settings flow one way: `SettingsV1` → `broadcast_blocking` → one extension
storage key, applied by one reducer. Security-relevant values (Serious Mode,
lockdown state) are injected from the backend's own settings, never echoed back
from the renderer — the webview is not a trust boundary.

**Two extension IDs exist and both matter.** The manifest pins a public `key`,
so unpacked/dev builds get a stable ID (`lknpaoec…`) that matches the native
host manifest's `allowed_origins`. The Chrome Web Store ignores that key and
assigns its own (`oigdpcd…`, `STORE_EXTENSION_ID` in `browsers.rs`). Both are
recognised; getting this wrong once broke the bridge, profile detection and
force-install simultaneously — see [RELEASE.md §1](RELEASE.md). To recompute an
ID from a key: `sha256(SPKI DER)`, first 16 bytes, each nibble `0..f` → `a..p`.

`BROWSERS` in `browsers.rs` is the one table driving detection, registration and
enforcement — Chrome, Edge, Brave, Opera, Vivaldi, Chromium and Firefox. Host
manifests come in two flavours: Chromium `com.oathlight.companion.json`
(`allowed_origins`) and Gecko `com.oathlight.companion.firefox.json`
(`allowed_extensions`, `oathlight@xeno-legit.github.io`). Registration is
written broadly to every vendor's `NativeMessagingHosts` key on startup — a
stray key for an absent browser is harmless; monitoring and enforcement target
only running browsers.

Force-install is live on both engines: Chromium via `ExtensionInstallForcelist`
pointed at the Web Store update URL, Firefox via the `ExtensionSettings` policy
pointed at AMO (one `REG_MULTI_SZ` value holding the whole JSON, merged
collision-safe — not per-key subkeys). `HKLM` is preferred (machine-wide, needs
elevation) with an `HKCU` fallback. A removed extension returns on the **next
browser launch or policy refresh**, not instantly, and the UI says so.

### 3.4 Building

```
# native host first — registration looks for the binary
cd desktop-app/native-host && cargo build --release

# then the app
cd desktop-app && npm run tauri dev        # or: npm run tauri build
```

`resolve_host_binary()` finds the host next to the Tauri exe in production, or
in `native-host/target/{debug,release}` in development.

---

## 4. Standing engineering rules

These are load-bearing. A change that needs to break one is designed wrong.

1. **One write path per invariant.** Settings go through `apply_settings`,
   friction through `FrictionStore`, protective events through the event log.
2. **The webview is not a trust boundary.** Anything security-relevant is
   enforced in Rust, never only in JSX.
3. **Fail open on infrastructure, fail closed on policy.** Broken resolver →
   restore real DNS. Missing password file → settings stay locked.
4. **Every bypass fix lands with a regression test** in the shared corpus or the
   adversarial suite. No exceptions — this is what makes the bounty viable.
5. **Strengthening instant, weakening delayed.** When unsure which a change is,
   it's a weakening.
6. **Nothing leaves the device by default.** Any feature that transmits states
   exactly what it sends, in the UI and in the docs, and is verifiable in source.
7. **Deterministic, not score-based, in the filter.** Scoring is unpredictable
   and undebuggable — the "why did it block my download?" nightmare. The AI layer
   is the one probabilistic component, and it only ever scores the residual after
   the deterministic layers have had their say.
8. **Verify visually.** A filter rule is proven by looking at the rendered page,
   not by reasoning about the predicate. A syntax check cannot catch a layer that
   silently doesn't run.

---

## 5. Design system

`design-system/` is the source of truth for all four surfaces (extension,
desktop renderer, website, store assets):

- `tokens.css` — every `--ol-*` token. Dark in `:root`, light in
  `[data-theme="light"]`, Serious Mode hook in `[data-serious]`.
- `tokens.js` — the metadata manifest the Themes colour editor builds from.
- `strings.js` — the voice layer: every user-facing string in both voices
  (Companion / Coach), `t(key, params)`, Serious Mode force-override.
- `VOICE.md` — copy rules, banned language, the "status yes, map no" content rule.
- `preview.html` — the live editor and style guide.

Copies live in `extension/` and `desktop-app/src/renderer/`, and
`scripts/ci/check-design-system-sync.mjs` **fails the build** if any copy drifts
byte-for-byte. Elements bind declaratively — `data-ol-str="key"` (and
`data-ol-str-attr` for attributes) repaints on load and on every voice flip, so
one flip repaints a whole page with no per-page code.

**Noir is the only built-in theme.** Custom colours are runtime `--ol-*`
overrides on top of it; there are no palette presets to maintain.

---

## 6. In-app content rule

Status yes, map no. The app shows honest, *actionable* status ("Protection
active", "Extension missing — fix"). It never explains what a setting defends
against, and it never describes where protection is thinner than elsewhere.

The same rule applies to this repository. [../SECURITY.md](../SECURITY.md) says
what the app does, what it touches, and what it never does — it is not a list of
ways around it. Nothing we publish should read as a challenge to the person the
app exists to protect.
