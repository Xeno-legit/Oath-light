# Oath Light

Oath Light is a free, open-source anti-addiction system that blocks pornographic
and other NSFW material at the network, page, and platform level. It comprises a
Manifest V3 browser extension for real-time request and content filtering, and a
Tauri (Rust) desktop application for system-level filtering, on-device AI
screen protection, and tamper resistance.


## Core philosophy

Oath Light is built on the principle of accessible protection. It is licensed
under the GNU General Public License v3.0, with no paid subscriptions, no
premium tiers, no locked features, and no advertising. The objective is a
robust, auditable tool available to anyone, without financial or data-collection
barriers.

It is built for one user in particular: the person who seriously wants this
over. Commitments made in the strong moment are made binding in the weak
moment — protections turn **on** instantly and turn **off** only after a
cool-off. That asymmetry is the product.

## Documentation

| Document | What's in it |
| :-- | :-- |
| [ROADMAP.md](ROADMAP.md) | **What's left.** The only place work is tracked |
| [docs/LAUNCH_GATES.md](docs/LAUNCH_GATES.md) | What stands between here and each launch, and who can clear it |
| [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) | What it is, the phases, and the rules we don't break |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it blocks — layers, pipeline, engine rules |
| [SECURITY.md](SECURITY.md) | What it does, what it touches, and what it never does |
| [docs/HARDENING.md](docs/HARDENING.md) | Tamper resistance: what stops removal, what doesn't, what would |
| [BYPASSES.md](BYPASSES.md) | Found a hole? Report it here |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, tests, and the blocklist-PR rules |
| [docs/RELEASE.md](docs/RELEASE.md) | Store publication, zip builds, OTA releases |

## Architecture

| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| Browser extension | Manifest V3 service worker, plain JavaScript (no build step) | URL filtering, keyword detection, SafeSearch enforcement, graylist interception |
| MAIN-world interceptor | Injected web-accessible script (`graylist-inject.js`) | Strips NSFW items from in-page `fetch`/XHR JSON before render |
| Desktop application | Tauri 2 (Rust core, web UI) | System DNS filtering, AI screen monitor, friction, watchdog, native bridge |
| Filtering DNS resolver | Rust (`oathlight-dns`) | System-wide domain filtering for apps the extension can't reach |
| Native messaging host | Rust | Authenticated channel between the extension and the desktop service |
| Guardian process | Rust | Mutual watchdog — keeps the service alive, and is kept alive by it |

The extension's blocking logic is deterministic and hostname-based; it does not
score pages or transmit data for evaluation. All processing is local.

## Protection layers

A request is blocked if any layer matches. They are deliberately redundant —
each one catches what the one before it was never designed to see. The full
pipeline is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### 1. Curated domain blacklist
- **385,597 curated domains** bundled with the extension, sharded across three
  JSON files and loaded into the service worker at startup.
- Reduced from an original **545,762 entries** (−29.3%) by removing every domain
  the keyword engine already catches; the remainder are domains with no
  machine-detectable stem — the "solid wall".
- Matching is exact-and-parent: a blocked domain also blocks its subdomains.
- Updated over the air between releases via a **signed** manifest (Ed25519),
  verified before use. A bad list can never brick browsing.

### 2. Multilingual keyword engine
Runs on the lowercased hostname even when the blacklist doesn't match:
- **41 languages** plus anime/3D, fetish and leak slang, and adult-gaming terms.
- ~600 unambiguous "strong" stems, explicit compounds, and ambiguous roots
  guarded by a whitelist of trap words (`sex` excused inside "essex", `anal`
  inside "analytics").
- **Leetspeak normalization** (`p0rn` → `porn`) before matching.
- **Native-script detection** via vendored RFC-3492 punycode decoding, covering
  Arabic, Chinese, Cyrillic, Japanese, Korean, Greek, Hebrew and Bengali terms.
- **Homoglyph folding** maps Cyrillic, Greek, Coptic and full-width look-alikes
  to Latin, so `pоrn.com` (Cyrillic "о") folds to `porn`.
- Adult TLDs (`.xxx`, `.porn`, `.adult`, `.sex`, `.sexy`) are blocked outright.

### 3. Graylist V2 — platform-level interception
Mixed-content platforms can't be whole-site blocked without removing legitimate
use, and can't be left untouched. Oath Light reads each platform's **own
per-item NSFW label** and removes flagged items before they render — ground
truth rather than heuristics, and it survives redesigns because the underlying
API fields stay stable.

- **35 platforms**: 24 via JSON/API interception, 10 via server-rendered DOM
  filtering with whole-page blocking of adult content pages, and Discord via
  age-restricted channel and server blocking.
- Labels used include Reddit `over_18`, X `possibly_sensitive`, Pixiv
  `xRestrict`, Mastodon `sensitive`, Mangadex `contentRating`, NexusMods
  `contains_adult_content`, Writing.com `crating`.

### 4. SafeSearch and search enforcement
SafeSearch is forced on Google, Bing, DuckDuckGo and Yahoo by URL parameter and
the toggle UI is hidden; YouTube Restricted Mode is applied by header rule. Both
are permanent — neither has a switch. Explicit search queries are blocked,
including a keyword filter on Reddit and Patreon search paths.

### 5. Bypass and evasion defense
- Translation and archive wrappers are unwrapped and the real target re-checked.
- Known bypass proxies (croxyproxy, 12ft.io, archive.today…) are blocked.
- Raw public-IP navigation is blocked; loopback and private ranges are exempt.
- An allowlist of ~110 mainstream domains is never blocked.

### 6. System DNS filtering
A local filtering resolver takes over the system DNS, so the same blacklist and
keyword engine apply to **every application**, not just browsers with the
extension. DNS-over-HTTPS is closed off by policy where browsers expose it and
by blocking well-known DoH endpoints in the resolver. Always on and not
disableable; it needs admin once to point the adapters at itself, and keeps
retrying — including the takeover — until it gets it. If the resolver ever stops
answering, real DNS is restored immediately and the filter restarts itself.

### 7. On-device AI screen protection
An ONNX ensemble (SigLIP Image-Guard + NudeNet) runs **entirely locally** —
no frame ever leaves the device. It escalates only on persistence across frames,
never single-frame confidence, and its only actions are a dwell-gated overlay
and opening the user's own redirect. Reporting a false positive shortens the
pause without ever making the filter catch less.

## Tamper resistance

- **No off switch on the core.** The uninstall guard, SafeSearch, YouTube
  Restricted Mode, the extension requirement and the system DNS filter cannot be
  turned off — not with the master password, not by waiting, not by editing the
  settings file (the floor is re-applied on every load).
- **Delayed weakening.** For everything that *is* a choice: turning it *on* is
  instant, turning it *off* — the AI monitor, lockdown, Serious Mode, a blocked
  app, a custom block — files a request with a 24-hour cool-off. Uninstall
  additionally requires typing a random 12-word phrase minted when the request
  was filed.
- **Clock-tamper immunity.** Timers use a monotonic anchor; rolling the system
  clock forward freezes the timer and logs the event instead of skipping it.
- **Lockdown Mode.** Allowlist-only browsing during vulnerable hours or on
  demand, with a "frozen" variant that can only be waited out.
- **Master password / second keyholder.** Argon2-hashed, optional, and settable
  by a trusted person so the user cannot self-unlock.
- **Tamper-evident event log.** Hash-chained locally: uninstall requests,
  extension removals, monitor stops, clock anomalies. Nothing can be quietly
  deleted from history — accountability integrity with no server.
- **Dual-process watchdog** and double autostart registration (Run key **plus**
  a logon scheduled task), each self-healing the other.
- **Self-repairing companions.** The watchdog guardian and the native-messaging
  host are embedded in the app binary and checked against it on every launch.
  Both are normally running when an update lands, and Windows will not let an
  installer overwrite a locked executable — so an upgrade could otherwise leave
  a new app driving two old companions. Anything that doesn't match is rewritten
  before the watchdog starts; a missing one is restored.
- **All-browser enforcement.** Force-install via browser policy on Chromium and
  Firefox, plus incognito/guest blocking and evasion-browser detection. Edge
  cannot be force-installed on a consumer PC (Microsoft only permits it from
  Edge Add-ons), so Edge is instead held shut until it is carrying the
  extension — with a short, repeatable recovery window from the app.

## Recovery layer

Blocking stops a request; it doesn't stop an urge.

- Panic/SOS flow — breathing, the 20-minute wave, grounding, then the user's own
  redirect — from the block screen, the tray, and a global hotkey.
- Urge and slip logging with trigger tags, and local analytics that turn the
  user's own risk window into one-click vulnerable hours.
- **Compassionate streaks:** best streak never regresses, a slip dents rather
  than erases, and a 24-hour gentle mode follows one. Shame-driven design causes
  abandonment.
- Guided CBT/ACT exercises for the hard moments — scripted, not a chatbot, and
  nothing written in them ever leaves the device.
- An **optional** AI mentor for when someone would rather talk than follow a
  script. Off until you add your own Anthropic API key, kept separate from the
  exercises so their promise still holds, and structurally unable to help
  weaken the filter: it has no tools and no route to any protection command,
  requests to turn protection off are answered locally without reaching the
  API, and any reply naming a blocked site is discarded before it is shown.
- Optional trusted contact, notified on discrete events only — never browsing
  history, never screenshots.

## Comparison with existing tools

Attributes below are publicly documented and structurally stable. Vendor pricing
and features change; verify independently before relying on them.

| Attribute | Oath Light | Covenant Eyes | BlockerX | Cold Turkey | Net Nanny |
| :--- | :---: | :---: | :---: | :---: | :---: |
| License | GPLv3 (open source) | Proprietary | Proprietary | Proprietary | Proprietary |
| Cost | Free | Subscription | Freemium | Freemium | Subscription |
| Per-item filtering on mixed platforms | Yes | No | No | No | No |
| Multilingual native-script keyword engine | Yes (41 languages) | Limited | Limited | User lists | Cloud analysis |
| On-device AI screen protection | Yes | No | No | No | No |
| Local-only processing, no reporting | Yes | No | Optional | Yes | No |
| Tamper resistance / delayed uninstall | Yes | Yes | Yes | Yes (Pro) | Yes |
| Open codebase for audit | Yes | No | No | No | No |

## Covered graylist platforms

Filtered in place rather than blocked outright.

**API / network interception (24):** reddit, x/twitter, tumblr, pixiv, mastodon
(all instances), imgur, nexusmods, vimeo, dailymotion, odysee, patreon, gumroad,
minds, itaku, peertube (all instances), lemmy (all instances), mangadex,
artstation, flickr, sketchfab, 500px, gamebanana, wattpad, fanbox.

**Server-rendered DOM filtering (10):** newgrounds, archiveofourown,
fanfiction.net, scribblehub, itch.io, steam, webtoons, tapas, ko-fi,
writing.com.

**Sub-unit blocking (1):** discord (age-restricted channels and servers).

Mainstream AI platforms (character.ai, poe.com, huggingface.co) keep working
while their NSFW search dies. Entirely or predominantly adult platforms are not
graylisted — they are blocked outright.

## Installation

The project is in pre-Alpha. The extension is published; the desktop app is
built from source.

| Step | Action |
| :--- | :--- |
| 1 | Install the extension — [Chrome Web Store](https://chromewebstore.google.com/detail/oigdpcdgmldgjalfnlgekcbkmniplnad) (also covers Edge, Brave and other Chromium browsers) or [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/oath-light-content-filter/) |
| 2 | `git clone https://github.com/Xeno-legit/Oath-light.git` |
| 3 | Build the desktop app — see [CONTRIBUTING.md](CONTRIBUTING.md) |
| 4 | Run it. The first-run wizard covers voice, strictness preset, vulnerable hours, and the optional master password and trusted contact — then shows you a live block so you can see it working |

The desktop app is optional but strongly recommended: the extension alone cannot
enforce cool-off delays, run the AI monitor, filter outside the browser, or keep
itself installed.

## Security and privacy

- **Local processing** — all blocking logic and content analysis run on device.
- **Zero telemetry** — no browsing data, statistics or personal information is
  transmitted anywhere. The only network calls are the signed blocklist fetch
  and, if the user configures them, their own trusted-contact mail and their own
  AI provider under their own key.
- **Open source** — the entire codebase is auditable under GPLv3.
- **Written down plainly** — what the app installs, what each permission is for,
  and what it never does, all in [SECURITY.md](SECURITY.md).
- **Interface language** is separate from the 41 languages the keyword engine
  detects: the UI itself is English, with the locale layer and right-to-left
  support in place and an Arabic draft awaiting review. Direction follows the
  language automatically, so a translation can never land in a mirrored layout.
- **Misses and false positives handled in the open** — [BYPASSES.md](BYPASSES.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the test suites, and the rules
for blocklist PRs (which are CI-checked against the allowlist floor and the
adversarial suite). The one rule that governs everything: **no false positives**
— a blocked legitimate site is worse than a missed porn site.

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

---

Oath Light is founded and maintained by [Xeno-legit](https://github.com/Xeno-legit).
