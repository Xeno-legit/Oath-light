# Oath Light — Roadmap

> **The only document that tracks what is left.** If work is not listed here, it
> is either shipped or it is not planned. Update this file in the PR that
> changes its status — never in a separate "handoff" doc.
>
> **Last updated:** 2026-07-27 · **Branch:** `pre-alpha/release` ·
> **Phase:** 4 (pre-Alpha)
>
> Companions: [docs/VISION.md](docs/VISION.md) (why, and the phase plan) ·
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it works today) ·
> [SECURITY.md](SECURITY.md) (what it deliberately doesn't cover).

---

## Status in one paragraph

Every layer of the product exists and runs: the 385k-domain curated blacklist,
the 41-language keyword engine, Graylist V2 across 35 platforms, SafeSearch and
bypass defense, the system DNS filter with DoH defense, process and
evasion-browser blocking, the on-device AI ensemble **with its action layer**,
the generalized friction system, master password, clock-tamper immunity,
lockdown mode, the tamper-evident event log, trusted-contact notification, the
recovery/urge/streak layer, Serious Mode, the voice layer, the first-run wizard,
and signed over-the-air list updates. The extension is published on the Chrome
Web Store and Firefox AMO, and force-install is live on both engines.

**Everything that can be finished at a keyboard is finished.** What remains
splits into four buckets: work that needs the target platforms actually loaded,
work that needs model compute, work that is content authoring, and work that
needs iteration against real CI runners — plus the release chores below.

---

## 0. Ship-blockers

Small, mechanical, and in the way of everything else.

| # | Item | Detail |
| :-- | :-- | :-- |
| 0.1 | **Commit the working tree** | ~39 modified files sit uncommitted on `pre-alpha/release` — an entire session of work with no commit behind it |
| 0.2 | **Rebuild the store zips** | `oathlight-extension-{store,firefox}.zip` predate `strings.js`, `voice-sync.js` and the manifest change. Mind the AMO forward-slash-path gotcha — see [docs/RELEASE.md](docs/RELEASE.md) |
| 0.3 | **OTA production keys** (owner-only) | Still DEV keys. See [docs/OTA_KEYS.md](docs/OTA_KEYS.md) |
| 0.4 | **Smoke-test the Firefox force-install** | The `ExtensionSettings` registry write has never been run against a live admin Firefox |
| 0.5 | **Pre-Alpha launch test** | The Phase-4 exit gate: everything again, at full scale, pushed to its limits |

Two things the last verification pass could not reach and that need a real
run: the overlay's "This was wrong" control (needs a live monitor escalation)
and the grayscale toggle (needs a real Windows registry write).

---

## 1. Needs the target platforms loaded

Written from memory these would look correct and silently not work — which for
a filter is worse than not shipping them. Do them in a session where the sites
can actually be opened and the result visually verified.

### 1.1 Graylist the big five — `3.1` · `P0 · L`
Instagram, TikTok, YouTube Shorts, Twitch, Kick. The most-used apps on earth;
not covering them undercuts the whole per-item-filtering pitch.

Extend the existing plumbing — `graylist-sites.js` (routing) + `graylist-inject.js`
(filtering) + `bg/graylist.js` — one platform at a time, in ascending order of
effort:

| Platform | Method |
| :-- | :-- |
| YouTube | Shorts shelf removal, thumbnail filtering; `ageRestricted` in `ytInitialData` is server-provided ground truth |
| Twitch | Mature flag on stream cards, in the GraphQL payload rendered into the DOM |
| Kick | Same shape as Twitch |
| Instagram | No labels — structural: hide Explore, gate Reels behind a setting |
| TikTok | Same structural treatment; the For-You page *is* the product, so offer feed-off / search-only |

Rule: where labels exist, strip per item (ground truth). Where they don't,
remove the *surface* (the algorithmic feed) and keep search/subscriptions/DMs,
as a per-platform toggle like every other graylist platform.

**Risk:** DOM churn on Instagram/TikTok breaking selectors. Prefer structural
removals (whole feed containers by aria/role) over deep selectors, and lean on
OTA updates to ship selector fixes without a reinstall.

### 1.2 Messaging & web-app surfaces — `3.2` · `P1 · M`
Telegram Web (block `t.me` invite resolution to flagged channels; blur media in
channels outside the user's allow set), WhatsApp Web link previews (strip
preview images on gray/unknown targets), Discord embeds
(`cdn.discordapp.com` / `media.discordapp.net` media from non-allowed guilds).
Channel blocking already exists; embed/CDN media filtering does not.

Same pattern as 1.1. The Discord media piece is the only genuinely new
mechanism and should wait for in-page image scoring (2.3) — until then,
keyword-filter the embed URLs.

---

## 2. Needs model compute

Bench runs and GPU time, not editing time.

### 2.1 Model diet — `2.3` · `P1 · M`
1. In `ml/export_onnx.py`, add INT8 (`onnxruntime.quantization.quantize_dynamic`)
   and FP16 (`onnxconverter-common`) post-export steps. Re-run
   `bench_combined.py` on the same eval set; accept the smallest variant within
   ~0.5pt of FP32 residual accuracy. NudeNet (12MB) isn't worth quantizing.
2. Enable ort's DirectML execution provider in `nsfw.rs`/`nudenet.rs` behind a
   cargo feature with runtime fallback to CPU; log the active EP into the
   `ScanEvent` so the monitor page shows it.
3. Adaptive cadence: if the foreground window is fullscreen, halve
   `SCAN_MIN_GAP` and lower `SCAN_CHANGE_THRESH` — video defeats change
   detection least when sampled faster.

**Risk:** SigLIP transformers sometimes lose disproportionate accuracy under
INT8. The bench gate is the acceptance criterion, not a formality; FP16 is the
safe fallback (half the size, ~zero loss).

**Prerequisite for:** Android (5.2) — mobile can't ship 343MB FP32.

### 2.2 A real eval set — `AI_PLAN §11.1`
The current numbers come from **30 images** — directional, not production-grade.
Build a 200–400 image labelled set with the same capture discipline and re-run
the harness before anyone quotes an accuracy number publicly. The capture
protocol and handling constraints are in
[docs/reference/ai-eval-capture.md](docs/reference/ai-eval-capture.md).

### 2.3 In-page image scoring — `2.6` · `P2 · L`
Canopy's flagship feature, matched locally. `content.js` on gray/unknown
domains collects `<img>` and CSS-background candidates above a size floor
(≥128px), downscales to ≤224px on an `OffscreenCanvas`, JPEG-encodes and sends
batches over the native bridge; the desktop scores them with the existing
ensemble and replies; `content.js` applies `blur(40px)` and click-to-nothing on
flagged ids, cached by image-URL hash in `chrome.storage.session`.

**Protocol note:** `read_tcp_message` caps messages at 1MB and Chrome native
messaging caps extension→host at 1MB — batch ≤6 thumbnails per message and
chunk. Do not raise the cap.

Images render before scoring returns, so on gray/unknown domains the CSS
default must be *blurred-until-cleared* for candidates, or the feature is
cosmetic. **Risk:** latency and jank on image-heavy pages; the size floor,
session cache and unknown-domains-only scope are the mitigations — measure
before widening scope.

### 2.4 On-device text classification — `2.5` · `P2 · L`
The biggest unfiltered medium is text: unlisted erotica, AI-chatbot smut,
fanfic on generic hosts. A distilled multilingual classifier (4-layer
DistilBERT class, binary erotica/clean, quantized <20MB) on the same ONNX/ort
stack. `content.js` samples ~2kB of visible text on **unknown** domains only —
not allowlisted, blacklisted or graylisted — sends `{type:"classify_text"}`
over the existing bridge, and calls `handleBlock` on a positive. Once per
(tab, host), verdict cached per host for the session.

**Risk:** a false positive here costs a *blocked page*, far more than an
overlay. Gate behind Strict initially and threshold for precision over recall.

### 2.5 AI strictness knob — `AI_PLAN §11.4`
`COVERED_LBL` (bikini/lingerie tier) is already computed in `nudenet.rs` but is
not user-configurable, and there is no WARN tier — the ensemble thresholds are
hard constants in `lib.rs`. Expose EXPOSED-only vs +COVERED as a setting, with
an optional warn-instead-of-act tier.

### 2.6 Foreground-window attribution + context gate — `AI_PLAN §8.5, §8.8`
Neither exists — there is no `GetForegroundWindow` call anywhere in the tree.
Two consequences today: the overlay is *monitor*-granularity rather than
*window*-granularity, and the monitor scans regardless of which app is in
front. The gate is a default-deny allowlist keyed on code signature (browsers
never trusted, image/web-feed apps excluded, instant re-arm); the attribution
routes a detection browser → extension hand-off, non-browser → overlay. One
shared Win32 primitive serves both.

---

## 3. Needs content authoring

Budget these like features, not afterthoughts.

### 3.1 Recovery program v2 / v3 — `5.3` · `P1 · L`
v1 (the scripted CBT/ACT flow) ships. What's left:
- **v2** — a structured 90-day course: daily 3-minute lessons on the
  neuroscience of the habit, trigger mapping, habit replacement. Fortify and
  QUITTR paywall exactly this; Oath Light ships it free, offline, in-app.
- **v3** — the BYO-API-key mentor (UX Direction §8): off by default, clearly
  labelled, direct to the user's own provider under their own key, so the
  zero-telemetry promise stays absolute. System-prompt guardrails: never
  negotiates about disabling protections, hands off to crisis resources.

Content is data, not code: `renderer/assets/program/` JSON flows
(`{id, title, steps:[{kind: breathing|text|input|choice, …}]}`) rendered by the
single `FlowRunner` in `pages-mentor.jsx` that already runs the panic flow and
v1. The 90-day course is one JSON per day, unlocked by streak day. A later
`chat` step kind is the door v3 walks through.

**Ship 5 flows done well over 30 done thin.**

### 3.2 The website's trust pitch — `6.4`
The site exists; the how-it-works page still needs the actual pitch — *how* it
blocks, what leaves the device (nothing), and how to verify a build.

### 3.3 Localization — `6.6` · `P2 · L`
The keyword engine speaks 41 languages; the UI speaks one. Key-based i18n:
`renderer/i18n/<lang>.json` + a `t()` helper (no framework needed at this size);
extension pages use `chrome.i18n`/`_locales`. Prioritize where the keyword
engine proves demand: **Arabic** (RTL — the layout audit is the real work),
Spanish, Portuguese, Hindi, Indonesian.

**Extract strings as part of each feature PR from now on** — retrofitting is
the expensive part.

---

## 4. Needs CI iteration

### 4.1 Reproducible builds — `6.2` · `P1 · M`
For a tamper-resistance product this is the ultimate trust story, and no
proprietary competitor can match it. CI job on tag: pin exact toolchains
(`rust-toolchain.toml`, `package-lock`), set `SOURCE_DATE_EPOCH` from the tag
commit, build the extension zip with sorted/zeroed-timestamp entries (a 20-line
pack script, not `zip`), build the installer twice on independent runners, diff
hashes, publish `SHA256SUMS` + minisign signature as release assets. Document
one-command local verification.

NSIS determinism is the hard part. If the installer won't reproduce, publish
reproducibility for the zip and the exe payloads inside it first — and say so
honestly.

---

## 5. Large and deliberately last

### 5.1 UI rebuild completion — `UX Direction §6`
Partial. Pillar 5 pages, Themes, Settings and the wizard are on the design
system. **Blocking, Blocklist and Monitor are not.** Until they are, those
screens are functional placeholders — don't polish them, rebuild them.

### 5.2 Mobile — `Pillar 7` · `P2–P3 · L`
Phase 5 opens this; it gets its own plan when it does.
- **Android:** local `VpnService` DNS filter reusing the `oathlight-dns`
  resolver core, accessibility-service screen capture feeding the quantized
  ensemble (2.1 is a hard prerequisite), device-admin + friction against
  weak-moment uninstall.
- **iOS:** Screen Time / Network Extension within Apple's constraints; per-item
  graylist is likely impossible — Safari content-blocker rules + a DNS profile
  is the realistic ceiling.
- **Cross-device streak sync:** end-to-end encrypted, user-held key, no
  readable server data.

Architectural discipline until then: keep `oathlight-core` free of Windows-only
dependencies outside `#[cfg]` blocks and UniFFI-friendly (plain structs, no
Tauri types). The crate boundary *is* the mobile strategy.

### 5.3 WFP filter driver — `1.4` · `P3 · L`
True per-connection enforcement, immune to DNS tricks. **Do not write a signed
kernel driver.** Prototype with **WinDivert** (signed, redistributable,
user-mode): intercept outbound 443, parse the TLS ClientHello SNI, drop the
handshake if the hostname fails `oathlight-core::matching`. That validates the
approach at zero signing cost; a real WFP callout is only worth it if
WinDivert's performance or AV-flagging proves unacceptable. The DNS resolver
covers ~95% of the need until then.

### 5.4 Residual honesty items — `6.5`
Profile and streak data behind `SettingsV1` (`A.3`). The streak already moved
to `recovery.rs`; the profile block did not.

---

## 6. Phase plan

From the original master plan, with today's reality.

| Phase | Scope | State |
| :-- | :-- | :-- |
| 1 | Extension skeleton, domain + keyword blocking | Complete |
| 2 | Desktop app, blocking-logic remaster, 500k+ domains, domain-name keyword layer | Complete |
| 3 | Theme unison, desktop UI/UX remake, cross-browser fixes, speed, Graylist V2 | Complete (open beta cancelled — straight to Alpha) |
| **4** | **Friction + watchdog systems, extension + AI monitoring, desktop-app blocking, everything above** | **In progress — §0 is the exit gate** |
| 5 | Desktop Alpha launch · Android with built-in AI scanner · anti-deletion permissions · phone Alpha | Not started |
| 6 | Domain expansion · multi-language · the site · donation booth · full launch | Not started |
| 7 | Continuous bug monitoring and improvement · "Oath Light Plus" faith content packs (also free) | Not started |

---

## 7. Explicitly not doing

Recording these so they stop being re-proposed.

| Thing | Why not |
| :-- | :-- |
| Microsoft Edge Add-ons | The submission process isn't worth the effort; Edge users are covered by the Chrome Web Store listing and force-install |
| Safari | Cost and effort, and no `nativeMessaging` — the desktop bridge can't exist |
| A mobile port of the *browser extension* | Phones get the AI scanner + DNS filtering instead (Phase 5), not an extension port |
| Score-based blocking in the filter | Unpredictable and undebuggable. The deterministic layers decide; the AI only ever scores the residual |
| A multi-million-entry scraped blocklist | Reintroduces the Phase-1 dead-site and false-positive problem at scale. Quality beats quantity |
| Multiple curated themes | Noir plus full user-custom colours. Nobody wants to maintain six palettes |
| Cash bug bounty | Recognition works — see [BYPASSES.md](BYPASSES.md) |

Opera Add-ons remains the one optional store left (same Chromium zip).
