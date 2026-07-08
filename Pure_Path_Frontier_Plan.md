# Pure Path — Frontier Plan

**Goal:** Not *a* frontier blocker. **THE** frontier blocker.
**Date:** 2026-07-07 · **Status:** Living document · **Companion to:** [Pure_Path_Master_Plan.md](Pure_Path_Master_Plan.md)

This document is the product of a full audit of the codebase (extension, desktop app,
ML layer, watchdog, uninstall flow) compared against the 2026 commercial frontier:
Covenant Eyes, Canopy, BlockerX, Cold Turkey, Plucky, Truple, Ever Accountable, and the
recovery-app wave (QUITTR, Fortify, Brainbuddy).

---

## 0. The Thesis

Every competitor wins on exactly **one** axis and neglects the rest:

| App | Wins on | Neglects |
| :-- | :-- | :-- |
| Covenant Eyes | Accountability | Privacy (cloud surveillance), cost, filtering depth |
| Canopy | In-page image filtering | Recovery support, tamper depth, cost |
| Cold Turkey | Lockdown friction | NSFW-specific filtering, recovery, mobile |
| BlockerX | Community + panic tools | Filtering quality, privacy |
| QUITTR / Fortify | Recovery science | Actual blocking (weak filters) |

**Pure Path already wins on filtering quality** (graylist ground-truth per-item stripping,
41-language homoglyph/punycode keyword engine, 385k curated domains) **and on trust**
(GPLv3, free, zero telemetry). Nobody else has either.

To be THE frontier blocker, Pure Path must win on **all five axes at once**:

1. **Containment** — nothing NSFW reaches the eyes, on any surface, in any app.
2. **Intelligence** — on-device AI that catches what lists can't, and *acts*.
3. **Humanity** — recovery support in the weak moment, not just a wall.
4. **Tamper resistance** — the weak-moment self cannot outvote the strong-moment self.
5. **Trust** — verifiable, free, private. The only blocker you never have to trust blindly.

Axis 5 is the moat. Axes 1–4 are the build plan. Everything below is organized into
those pillars, each item tagged:

- **Priority:** `P0` (Phase 4 / now) · `P1` (Alpha) · `P2` (post-Alpha) · `P3` (horizon)
- **Effort:** `S` (days) · `M` (weeks) · `L` (month+)
- **Type:** `PARITY` (frontier has it, we must too) · `EDGE` (nobody has it — this is what makes us THE frontier)

---

## Pillar 1 — Containment: escape the browser

> Today every enforcement path lives inside the MV3 extension. Tor Browser, portable
> browsers, Electron apps, embedded webviews, and any browser without our extension are
> completely open. This is the single largest structural gap vs. Covenant Eyes / Canopy,
> which run system-level filter drivers.
>
> **Scope note:** everything in this pillar is a *backstop*, never a replacement.
> DNS can only answer "is this whole domain allowed?" — it cannot do per-item
> graylist stripping, SafeSearch enforcement, in-page filtering, or block-page
> redirects. The extension remains the precision layer and the heart of the
> product; the system layer exists to cover the surfaces the extension can't reach.

### 1.1 System-level DNS filtering — `P0 · L · PARITY`
A local filtering DNS resolver (Rust, inside the existing desktop service) set as the
system DNS. Answers NXDOMAIN/blockpage-IP for blacklisted domains, forwards the rest.
- Better than a hosts file: 385k entries in `hosts` degrades Windows DNS cache
  performance and can't wildcard; a resolver reuses the existing exact-and-parent
  matching logic from the extension verbatim.
- The keyword engine runs on every queried hostname too — the "solid wall" plus the
  pattern layer, now system-wide, including apps that aren't browsers.
- Watchdog already exists to keep the service alive; the resolver rides inside it.
- Fallback v1 if the resolver slips: hosts-file sync of the top ~20k domains.

### 1.2 DoH / DoT / DNS-change bypass defense — `P0 · M · PARITY`
System DNS filtering is trivially bypassed by DNS-over-HTTPS. Close the loop:
- Write browser policy keys to disable built-in DoH (Chrome/Edge/Brave/Firefox all
  expose this via the same policy hives `browsers.rs` already writes).
- Block well-known DoH endpoints (cloudflare-dns.com, dns.google, …) in the resolver.
- Watchdog detects manual DNS-server changes on network adapters and reverts them
  (with the same friction rules as any weakening change — see Pillar 4).

### 1.3 Process-level app blocking — `P0 · M · PARITY`
Already on the Phase 4 list ("Blocking certain desktop versions of apps"). Concretize:
- Configurable blocked-process list (Discord, Telegram Desktop, qBittorrent, …) enforced
  by the watchdog, which already enumerates processes in `browsers.rs`.
- **Evasion-browser detection** `EDGE`: treat Tor Browser, portable Chromium/Firefox
  builds (running from non-standard paths, no policy hive), and fresh unknown browsers
  as evasion attempts — block the process and surface it in the app. Plucky is the only
  competitor that does this, and only partially.
- VPN-client detection during Lockdown Mode (VPNs bypass DNS filtering): warn or block
  known VPN client processes while a lockdown window is active.

### 1.4 Windows filter driver (WFP) — `P3 · L · PARITY`
The endgame: a Windows Filtering Platform callout driver for true per-connection
enforcement (SNI/hostname inspection), immune to DNS tricks. Requires driver signing;
do this after Alpha revenue-free sustainability is figured out. The DNS resolver (1.1)
covers ~95% of the need until then.

### 1.5 All-browser enforcement, activated — `P0 · S · PARITY`
`browsers.rs` already implements force-install via `ExtensionInstallForcelist` /
Firefox `ExtensionSettings`, but it is **dormant** until the extension has a store or
self-hosted update URL. Publishing (see Pillar 6) is therefore a *containment* feature,
not just distribution. Also enforce via policy while we're in the hive:
- Force extension in incognito, block guest-profile browsing, block browser
  developer-mode extension unloading where the policy exists.

---

## Pillar 2 — Intelligence: AI that acts

> The ensemble (SigLIP Image-Guard + NudeNet, 95.8% residual accuracy) is measured,
> built, and running — but it only **displays** scores. `blocked: true` currently
> triggers nothing. AI_PLAN.md §8 already designed the action layer; it needs to ship.

### 2.1 Ship the §8 action layer — `P0 · M · EDGE`
On a persistent positive verdict: full-screen blur/dim overlay + open the user's
configured redirect (motivational video), dismissible after a short dwell. Escalation
driven by *persistence across frames*, never single-frame confidence. AI gets no
irreversible actuator. This is the flagship Phase-4 feature — until it acts, it's a
dashboard. **No competitor has free, local, on-device AI screen protection. This alone
is a category-defining feature.**

### 2.2 Multi-monitor capture — `P0 · S · PARITY`
`screen.rs::capture_primary()` watches only the primary monitor. A second monitor is
a complete blind spot. Enumerate and fingerprint all monitors (xcap already returns
`Monitor::all()`); scan whichever changed.

### 2.3 Model diet: quantization + hardware acceleration — `P1 · M`
- INT8/FP16 quantize Image-Guard (343 MB FP32 → ~90 MB) with an accuracy re-run of the
  bench suite; smaller download, faster inference, mobile-ready.
- DirectML / NPU execution provider on Windows via ort, CPU fallback.
- Adaptive scan cadence: raise polling rate when a fullscreen video player is
  foregrounded (video is where single-frame sampling misses the most).

### 2.4 False-positive feedback loop — `P1 · S · EDGE`
"This was wrong" button on the block overlay → appends the (hashed screen fingerprint,
scores, verdict) to a **local** eval log the user can review, and locally auto-tunes the
dwell threshold. Open-source + local means users can even contribute anonymized score
distributions voluntarily via GitHub. Commercial blockers can't expose their model's
mistakes; we can make transparency a feature.

### 2.5 On-device text NSFW classification — `P2 · L · EDGE`
The biggest unfiltered medium is **text**: erotica sites not yet listed, AI-chatbot
smut, fanfic on generic hosts. A tiny on-device text classifier (few-MB ONNX, runs on
page text sent over the existing native-messaging bridge) scoring visible text on
*unknown* domains would be a first-in-market capability. Ties into 3.3 (AI erotica).

### 2.6 In-page image scoring for the extension — `P2 · L · PARITY→EDGE`
Canopy's flagship is in-page image filtering (cloud-based). We can match it **locally**:
extension sends suspect `<img>` bytes from unknown/gray domains over native messaging;
desktop ensemble scores them; extension blurs/hides. Canopy-grade filtering, zero cloud.

---

## Pillar 3 — Coverage & freshness: the 2026 surfaces

> The 35-platform graylist is the crown jewel, but it skips where relapses actually
> start in 2026: short-form video and AI erotica.

### 3.1 Graylist the big five mainstream surfaces — `P0 · L · PARITY`
Instagram (Reels/explore), TikTok, YouTube (Shorts/thumbnails), Twitch, Kick.
Same ground-truth method where labels exist (YouTube `ageRestricted`, Twitch mature
flags); server-DOM filtering where they don't. These are the most-used apps on earth;
not covering them undercuts the "per-item filtering" pitch.

### 3.2 Messaging & web-app surfaces — `P1 · M`
Telegram Web (NSFW channels/bots), Snapchat Web, WhatsApp Web link previews,
Discord embeds (channel blocking exists; embed/CDN media filtering does not —
`cdn.discordapp.com` media in non-restricted channels).

### 3.3 AI erotica category — `P0 · M · EDGE`
The fastest-growing NSFW surface in 2026 and **no blocker addresses it seriously**:
- Blacklist category: AI-girlfriend/companion sites, NSFW image generators,
  jailbroken chat frontends. Maintain as a tagged category in the curated list.
- Graylist treatment for mainstream AI platforms with NSFW corners (character
  platforms with filters off, image-gen galleries, model hubs like civitai NSFW tabs).
- Keyword-engine stems for the naming patterns of this ecosystem (`waifu`, `nsfw-ai`,
  companion-bot naming conventions, …) across the 41 languages.

### 3.4 SafeSearch expansion — `P0 · S · PARITY`
Currently: Google, Bing, DDG, Yahoo. Add Yandex (the notorious leak), Brave Search,
Ecosia, Startpage, Searx instances, and image-CDN direct access patterns. Also force
YouTube Restricted Mode via the existing header/policy mechanisms as an optional
strictness level.

### 3.5 Over-the-air blocklist updates — `P0 · M · PARITY`
Lists are baked into the extension; a new porn domain requires a reinstall from source.
- Signed manifest (minisign/ed25519) published from the GitHub repo; extension and
  desktop app fetch weekly, verify signature, apply deltas.
- Keeps the zero-server promise: GitHub is the CDN, the signature is the trust.
- Rollback safety: a bad list can never brick browsing (allowlist floor stays local).

### 3.6 Community blocklist pipeline — `P1 · M · EDGE`
We are the only open-source player — weaponize it. `CONTRIBUTING.md` flow where a list
PR triggers CI that: validates format, checks against the allowlist and trap-word
whitelist, runs the adversarial test suite, and posts a diff summary. Community-driven
freshness at a pace no vendor's internal team can match. (This is how uBlock Origin won
its category.)

### 3.7 URL-path & query keyword layer — `P2 · M`
The keyword engine runs on hostnames only. A conservative path/query layer (`/porn/`,
`tag=nsfw`, …) with the same trap-word whitelist discipline catches NSFW sections of
unlisted mixed sites. Higher FP risk — gate behind the Strict preset (5.4).

---

## Pillar 4 — Tamper resistance: friction everywhere it matters

> The uninstall flow has a friction state machine (timer currently 10s for testing —
> intentional until near Alpha). But **every other** weakening action is instant:
> stop the AI monitor, disable reminders, remove a custom block, turn off vulnerable
> hours. One click each, in the weakest moment. Cold Turkey and Plucky are built
> entirely on closing this hole.

### 4.1 Generalized friction: delayed weakening — `P0 · M · PARITY→EDGE`
Reuse the existing uninstall request/reset/cancel state machine for **any protective
downgrade**: disabling the AI monitor, removing custom blocks, shrinking vulnerable
hours, turning off a graylist platform, changing DNS settings. Strengthening is always
instant; weakening takes the configured delay. The asymmetry *is* the product.

### 4.2 Master password / second-keyholder code — `P0 · M · PARITY`
README already promises it; the code doesn't have it. Argon2-hashed master password
gating the settings surfaces (desktop + extension options via native bridge). Optional
**second-keyholder** variant: the password is set by any trusted person — a parent,
sibling, friend, or mentor — so the user *cannot* self-unlock; the strongest
configuration Covenant Eyes offers, minus the cloud. Strictly optional: a solo user
gets equivalent strength from the friction delays alone (recovery from a forgotten or
self-set password = waiting out the delay, same asymmetry as everything else).

### 4.3 Clock-tamper immunity — `P0 · S`
The uninstall timer trusts wall-clock time; rolling the system clock forward skips the
wait. Persist a monotonic anchor (boot-time counter + last-seen timestamp); if wall
clock jumps implausibly, freeze the timer and log the event.

### 4.4 Lockdown Mode (whitelist-only) — `P0 · M · PARITY`
Cold Turkey's killer feature, NSFW-flavored: during vulnerable hours (or on demand),
browsing is **allowlist-only** — the ~110-domain mainstream allowlist plus user
additions. Currently vulnerable hours only schedule reminder popups; letting them
escalate to lockdown turns a nudge into a wall exactly when it's needed.
- "Frozen" variant: a lockdown in progress cannot be cancelled, only waited out.

### 4.5 Tamper-evident event log — `P1 · M · EDGE`
Hash-chained local log (each entry contains the previous entry's hash) of protective
events: uninstall requests, extension removals, monitor stops, clock anomalies, DNS
changes. Anyone — a trusted contact, a parent, the user's future self — can verify nothing was
deleted from history. **Accountability integrity without any server.** No competitor
can offer this because their logs live in *their* cloud.

### 4.6 Uninstall hardening (near-Alpha) — `P1 · S`
When the timer is raised to its real value: add type-this-random-paragraph friction on
top of the wait (Cold Turkey style), optional trusted-contact notification on request
(see 5.2), and a
scheduled-task + service double-registration so Safe Mode boots don't orphan the
watchdog.

---

## Pillar 5 — Humanity: win the weak moment

> A wall stops a request. It doesn't stop an urge. The recovery-app wave (QUITTR,
> Fortify, Brainbuddy) proved people pay $20/month just for this layer. Pure Path can
> ship it free, private, and integrated with the actual blocking data.

### 5.1 Panic / SOS button — `P0 · S · PARITY`
On the block screen, in the tray menu, and as a global hotkey: one press opens a
full-screen urge-surfing flow — breathing timer (box breathing), the 20-minute wave
message (already written in the Mentor copy), grounding exercise, then the user's own
motivational redirect. All assets already exist in the codebase; this is assembly, not
invention. Highest emotional-value-per-line-of-code item in this document.

### 5.2 Privacy-first accountability — `P0 · L · EDGE`
**Design principle first: Pure Path is solo-first.** Many users — a teenager, someone
isolated, someone too ashamed to tell anyone — have no partner to name, and the app
must be *fully* effective for them. "Accountability" in Pure Path is therefore a
ladder, and the bottom rungs need no other human:

- **Tier 0 — the app holds you accountable (default, solo):** the friction system
  (4.1), frozen lockdown (4.4), and clock immunity (4.3) mean the weak-moment self
  cannot outvote the strong-moment self. This is pre-commitment, not willpower — the
  user sets the rules when strong, and the app enforces them when they're not.
- **Tier 1 — accountable to your future self (solo):** the tamper-evident log (4.5).
  Tomorrow-morning-you always sees what last-night-you tried: uninstall requests,
  cancelled lockdowns, killed monitors. Nothing can be quietly deleted and forgotten.
- **Tier 2 — a trusted human (optional):** the market leader's entire business,
  rebuilt without the surveillance. The user *may* designate a trusted contact —
  a parent, sibling, close friend, or mentor, not necessarily a spouse:
  - App notifies them **only on discrete events**: uninstall requested, extension
    removed and not restored within N minutes, lockdown cancelled, X blocks within an
    hour during vulnerable hours. Never browsing history, never screenshots.
  - Delivered via user's own mail (mailto/SMTP) or a stateless relay — nothing stored.
  - Pairs with 4.2 (second-keyholder code) and 4.5 (verifiable event log).

Tier 2 is a genuinely good feature — for those who have someone. It is an amplifier
on top of Tiers 0–1, never the foundation, and the UI never nags a solo user about it.
Positioning: **"Covenant-Eyes accountability, zero surveillance — and zero
accountability-partner required."** Nobody else can say either half.

### 5.3 Real recovery program — `P1 · L · PARITY`
Replace the coming-soon Mentor stub with something honest (a fake-typing regex chatbot
will destroy trust the moment a vulnerable user notices):
- **v1 (honest + shippable):** a *scripted* CBT/ACT flow — urge → grounding →
  reflection → plan — presented as guided exercises, not as "AI".
- **v2:** structured 90-day course: daily 3-minute lessons on the neuroscience of the
  habit, trigger mapping, habit replacement. Fortify/QUITTR paywall exactly this;
  Pure Path ships it free, offline, in-app.
- **v3 (optional):** local small-LLM mentor via the existing ONNX/ort stack, or
  bring-your-own-API-key. Strictly opt-in, clearly labeled.

### 5.4 Journaling, urge log & trigger analytics — `P1 · M · EDGE`
The app already collects per-profile block counts and dates and shows one number.
- Urge log: one-tap "I had an urge" (from tray/panic flow) with optional trigger tag
  (bored / stressed / late / lonely).
- Local analytics: blocks and urges by hour-of-day and day-of-week, streak
  correlations → "your risk window is Tue/Fri 11pm–1am" → **one-click: set these as
  vulnerable hours."** Blocking data feeding recovery insight, fully locally, is a
  combination no competitor has (blockers don't do recovery; recovery apps don't
  have blocking data).

### 5.5 Compassionate streak design — `P1 · S`
Relapse currently just resets the counter. Shame-driven design causes abandonment:
- Track "clean days this month" alongside the streak; a slip dents, not erases.
- Post-relapse flow: the Mentor "slip" script (already written), a 24h gentle-mode,
  then re-engagement — not a zeroed dashboard.
- Milestone celebrations already exist as notification stubs; wire them.

### 5.6 Environment tools — `P2 · M · EDGE`
- **Grayscale vulnerable hours:** force the Windows color filter (grayscale) during
  the risk window — desaturation measurably reduces stimulation-seeking. One registry
  toggle; no blocker does this.
- Habit replacement: block screen offers the user's own pre-configured alternatives
  ("Go do 20 pushups", "Message Ahmad", link to a book/app).
- Optional faith content packs (Phase 7's "Pure Path Plus"): pluggable motivation
  packs — secular / Islamic (prayer-time-aware lockdown windows, Quranic reminders) /
  Christian — as data, not forks.

---

## Pillar 6 — Trust & distribution: the open-source moat

> "Auditable and free" only compounds into a moat if people can actually install it
> and verify it. Today the install path is git-clone + developer mode.

### 6.1 Store publication — `P0 · M`
Chrome Web Store, Edge Add-ons, Firefox AMO. This is not just adoption — the dormant
force-install enforcement in `browsers.rs` **cannot activate** until an update URL
exists (1.5). Signed MSI/NSIS desktop installer + Tauri auto-updater alongside.

### 6.2 Reproducible builds — `P1 · M · EDGE`
CI that builds the extension zip and desktop installer deterministically and publishes
hashes; anyone can verify the store binary matches the GitHub source. For a
tamper-resistance product this is the ultimate trust story, and no proprietary
competitor can ever match it.

### 6.3 "Break Pure Path" bypass bounty — `P1 · S · EDGE`
A standing community challenge: documented threat model + a `BYPASSES.md` hall of fame
for reported holes (no cash needed; recognition works). The adversarial test suite
already exists — let the internet extend it. Turns the biggest fear (a public bypass
list) into a hardening engine. Only an open-source project can do this in the open.

### 6.4 Docs, website, onboarding — `P1 · M`
- Website with plain-language explanation of *how* it blocks (the trust pitch).
- First-run wizard (README already promises one): choose a strictness preset
  (**Standard / Strict / Lockdown**), set vulnerable hours, optional master password
  and trusted contact (both clearly skippable — the solo path is first-class),
  then a live test block so the user sees it working.
- Fix README drift: it currently advertises password protection and a setup wizard
  that don't exist in code. For a project whose pitch is auditability, overclaiming
  in the README is expensive. Ship the features or trim the claims (prefer: ship).

### 6.5 Settings page honesty — `P0 · S`
Profile name/email/notification toggles persist locally but "Edit profile" does
nothing and the email field is never used. Wire the email to 5.2 (trusted-contact/self
notifications) or cut it. Dead controls erode trust in a tamper-resistance product.
This item was expanded into a full audit-and-fix pass of every placebo control,
hardcoded number, and non-persisting toggle (the since-completed-and-retired UI
Truth plan, executed 2026-07-07): "Edit profile" is wired, the dead notif
toggles were collapsed into the real `blocking.alerts` config plus honest
disabled coming-soon rows, custom sites now sync end-to-end to the extension,
and the hardcoded "4.2M+" was replaced by the live blocklist count. Still open
here: the trusted-contact email wire (5.2) and moving profile/streak behind
`SettingsV1` (A.3).

### 6.6 Localization — `P2 · L`
The keyword engine speaks 41 languages; the UI speaks one. Phase 6 already plans
this — the point here: prioritize the languages the keyword engine proves demand for
(Arabic, Spanish, Portuguese, Hindi, Indonesian first — largest underserved markets;
zero good free blockers exist in most of them).

---

## Pillar 7 — Mobile (Phase 5 groundwork)

> Every hour spent on desktop architecture should anticipate that mobile is where
> most consumption happens. The AI plan already designates the ensemble as the *main*
> mobile mechanism.

- **Android** `P2 · L`: local VPN-service DNS filter (same resolver core as 1.1 —
  build it as a shared Rust crate now), accessibility-service screen capture feeding
  the quantized ensemble (2.3 is a prerequisite), device-admin + friction against
  weak-moment uninstall.
- **iOS** `P3 · L`: Screen Time / Network Extension content filter within Apple's
  constraints; per-item graylist likely impossible — Safari content-blocker rules +
  DNS profile is the realistic ceiling.
- **Cross-device streak sync** `P3`: end-to-end-encrypted sync (user-held key) so the
  streak/urge log follows the user without any readable server data.

---

## Sequencing

### Phase 4 (now) — "The app defends itself and acts"
1. §8 AI action layer (2.1) + multi-monitor (2.2)
2. Generalized weakening friction (4.1) + master password (4.2) + clock immunity (4.3)
3. Panic button (5.1)
4. Local DNS resolver v1 (1.1) + DoH defense (1.2)
5. Process/app blocking + evasion-browser detection (1.3)
6. OTA blocklists (3.5) · SafeSearch expansion (3.4) · AI-erotica category (3.3)
7. Settings honesty (6.5)

### Alpha — "The human layer + the trust layer"
8. Privacy-first accountability (5.2) + tamper-evident log (4.5)
9. Lockdown Mode (4.4) + uninstall hardening at real timer value (4.6)
10. Store publication (6.1) → activates dormant force-install (1.5)
11. Instagram/TikTok/YouTube/Twitch graylist (3.1)
12. Recovery program v1 + compassionate streaks + trigger analytics (5.3–5.5)
13. Onboarding wizard + presets (6.4), FP feedback loop (2.4)

### Post-Alpha — "Category king"
14. In-page image scoring (2.6) · text classifier (2.5) · model quantization (2.3)
15. Community list pipeline (3.6) · reproducible builds (6.2) · bypass bounty (6.3)
16. Messaging surfaces (3.2) · path/query layer (3.7) · grayscale hours (5.6)
17. Android (Pillar 7) · localization (6.6) · WFP driver (1.4)

---

## The pitch, when it's all built

> **Pure Path** — the only blocker that filters *inside* the platforms you use, watches
> the screen with AI that never leaves your device, cannot be talked out of protecting
> you at 1 a.m., supports you like a coach instead of shaming you like a warden, and
> proves every one of those claims with open source code.
>
> Free forever. Private by architecture. Verifiable by anyone.

That sentence is impossible for Covenant Eyes (privacy), Canopy (cost, recovery),
Cold Turkey (filtering, humanity), BlockerX (privacy, depth), and QUITTR (blocking) —
and every clause maps to a pillar above.
