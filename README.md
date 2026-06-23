# Pure Path

Pure Path is a free, open-source content-filtering system that blocks pornographic and
other NSFW material at the network, page, and platform level. It comprises a Manifest V3
browser extension for real-time request and content filtering and a Tauri (Rust) desktop
application for system-level persistence and tamper resistance.

![Pure Path Demonstration](Demogif.gif)

## Core Philosophy

Pure Path is built on the principle of accessible protection. The application is free and
licensed under the GNU General Public License v3.0. It contains no paid subscriptions, no
premium tiers, no locked features, and no advertising. The objective is a robust, auditable
tool available to anyone, without financial or data-collection barriers.

## Architecture

| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| Browser extension | Manifest V3 service worker, plain JavaScript (no build step) | URL filtering, keyword detection, SafeSearch enforcement, graylist interception |
| MAIN-world interceptor | Injected web-accessible script (`graylist-inject.js`) | Strips NSFW items from in-page `fetch`/XHR JSON before render |
| Desktop application | Tauri 2 (Rust core, web UI) | Persistence, native-messaging bridge, watchdog, uninstall friction |
| Native messaging host | Rust | Secure channel between the extension and the desktop service |

The extension's blocking logic is deterministic and hostname-based; it does not score pages
or transmit data for evaluation. All processing is local.

## Protection Layers

Pure Path applies independent, complementary layers. A request is blocked if any layer matches.

### 1. Curated domain blacklist
- **385,588 curated domains** bundled with the extension, sharded across three JSON files and
  loaded into the service worker at startup.
- This list was reduced from an original **545,762 entries** (a 29.3% reduction) by removing
  every domain the keyword engine already catches; the remainder are domains with no
  machine-detectable stem (the "solid wall"). See [DOMAINS_HANDOFF.md](DOMAINS_HANDOFF.md).
- Matching is exact-and-parent: a blocked domain also blocks its subdomains.

### 2. Multilingual keyword engine
A pattern layer that runs on the lowercased hostname even when the blacklist does not match:
- **41 languages** plus anime/3D, fetish and leak slang, and adult-gaming terminology.
- Approximately 600 unambiguous "strong" stems (substring match), explicit compounds, and
  ambiguous roots guarded by a whitelist of trap words (for example, `sex` is excused inside
  "essex", `anal` inside "analytics").
- **Leetspeak normalization** (for example, `p0rn` to `porn`) before matching.
- **Native-script detection** via vendored RFC-3492 punycode decoding, covering Arabic,
  Chinese, Cyrillic, Japanese, Korean, Greek, Hebrew, and Bengali terms.
- **Homoglyph folding** maps Cyrillic, Greek, Coptic, and full-width look-alikes to Latin so
  that, for example, `pоrn.com` (Cyrillic "о") folds to `porn`.
- Adult top-level domains (`.xxx`, `.porn`, `.adult`, `.sex`, `.sexy`) are blocked outright.

### 3. Graylist V2 — platform-level interception
Mixed-content platforms (Reddit, X, Pixiv, and similar) cannot be whole-site blocked without
removing legitimate use, and cannot be left untouched. Pure Path reads each platform's **own
per-item NSFW label** and removes the flagged items before they render. This is ground-truth
filtering rather than heuristics, and it survives site redesigns because the underlying API
fields are stable.

- **35 platforms covered**: 24 via JSON/API interception, 10 via server-rendered DOM filtering
  with whole-page blocking of adult content pages, and Discord via age-restricted channel and
  server blocking.
- Examples of the labels used: Reddit `over_18`, X `possibly_sensitive`, Pixiv `xRestrict`,
  Mastodon `sensitive`, Mangadex `contentRating`, NexusMods `contains_adult_content`,
  Writing.Com content rating (`crating` 18+/GC/XGC).

### 4. SafeSearch and search enforcement
- SafeSearch is forced on **Google, Bing, DuckDuckGo, and Yahoo** by URL parameter, and the
  toggle UI is hidden to prevent disabling it.
- Explicit search queries are blocked, including a keyword filter on Reddit and Patreon search
  paths.

### 5. Bypass and evasion defense
- Translation and archive wrappers (`translate.google`, `web.archive.org`) are unwrapped and
  the real target is re-checked recursively.
- Known bypass proxies (for example, croxyproxy, 12ft.io, archive.today) are blocked.
- Raw public-IP navigation is blocked; loopback and private ranges are exempt.
- An allowlist of approximately 110 mainstream domains is never blocked.

## Desktop Integration

- **System-level persistence** via a lightweight Tauri (Rust) companion application.
- **Dual-process watchdog**: a secondary process monitors the main service and restarts it,
  resisting unauthorized termination.
- **Native messaging**: an authenticated bridge between the extension and the desktop service.
- **High-friction uninstall**: a configurable waiting period (for example, 48 hours) before
  removal, with options to reset, cancel, or proceed.

## Comparison with Existing Tools

The following table compares Pure Path against widely used alternatives on attributes that are
publicly documented and structurally stable. Vendor pricing and feature sets change over time;
verify current details independently before relying on them.

| Attribute | Pure Path | Covenant Eyes | BlockerX | Cold Turkey Blocker | Net Nanny |
| :--- | :---: | :---: | :---: | :---: | :---: |
| License | GPLv3 (open source) | Proprietary | Proprietary | Proprietary | Proprietary |
| Cost model | Free | Subscription | Freemium (paid premium) | Freemium (paid Pro) | Subscription |
| Primary purpose | NSFW content filter | Accountability and filtering | NSFW blocker and accountability | General website/app blocker | Parental-control suite |
| Per-item filtering on mixed platforms (Reddit, X, Pixiv) | Yes | No | No | No | No |
| Multilingual, native-script keyword engine | Yes (41 languages) | Limited | Limited | User-defined lists | Cloud content analysis |
| Local-only processing, no activity reporting | Yes | No (reports to a partner) | Optional accountability | Yes | No (cloud-based) |
| Tamper resistance / high-friction uninstall | Yes | Yes | Yes | Yes (Pro) | Yes |
| Open codebase for audit | Yes | No | No | No | No |

Pure Path's principal differentiators are its open-source GPLv3 licensing at no cost, its
platform-level per-item NSFW stripping (the graylist), and a multilingual keyword engine with
native-script and homoglyph handling, all executed locally with no telemetry.

## Covered Graylist Platforms

Each platform below is filtered in place rather than blocked outright.

### API / network-layer interception (24)
reddit, x / twitter, tumblr, pixiv, mastodon (all instances), imgur, nexusmods, vimeo,
dailymotion, odysee, patreon, gumroad, minds, itaku, peertube (all instances), lemmy (all
instances), mangadex, artstation, flickr, sketchfab, 500px, gamebanana, wattpad, fanbox.

### Server-rendered DOM filtering and page blocking (10)
newgrounds, archiveofourown, fanfiction.net, scribblehub, itch.io, steam, webtoons, tapas,
ko-fi, writing.com.

### Sub-unit blocking (1)
discord (age-restricted channels and servers).

Entirely or predominantly adult platforms (for example, image boards) are not graylisted; they
are blocked outright by the curated blacklist.

## How Blocking Is Applied

| Method | Description | Target |
| :--- | :--- | :--- |
| Blacklist | Exact and parent-domain matching against 385,588 curated entries. | Known NSFW domains |
| Keyword engine | Multilingual stem, compound, leetspeak, native-script, and homoglyph matching on the hostname. | Unlisted NSFW domains |
| Graylist | Per-item NSFW stripping from JSON and server-rendered pages on mixed platforms. | NSFW items on legitimate sites |
| Search filter | Forced SafeSearch parameters and explicit-query blocking. | Search engines |
| Bypass defense | Unwrapping of translation/archive wrappers and blocking of proxies and raw IPs. | Evasion attempts |
| Host blocking | (Planned) System-level blocks managed by the desktop application. | System-wide |

## Development Status

### Phase 1: Browser extension (Completed)
- Core deterministic blocking logic and Manifest V3 compliance.
- Password protection for extension settings.
- Statistics tracking.

### Phase 2: Domain and keyword engine (Completed)
- 385,588-domain curated blacklist with a deduplicating pruner.
- Multilingual keyword engine across 41 languages with native-script and homoglyph handling.

### Phase 3: Desktop integration and Graylist V2 (Near completion)
- Tauri desktop application, native-messaging bridge, and dual-process watchdog.
- High-friction uninstall system.
- Graylist V2 covering 35 mixed-content platforms.
- Redesigned desktop interface.

### Phase 4: Friction and watchdog systems (In progress)
- 48-hour uninstall-request workflow.
- Extension monitoring and optional AI-assisted monitoring.

## Installation

The project is in beta and is currently installed from source.

| Step | Action | Details |
| :--- | :--- | :--- |
| 1 | Clone the repository | `git clone https://github.com/Xeno-legit/Pure-Path-NSFW-blocker.git` |
| 2 | Load the extension | Load the `extension` folder as an unpacked extension in your browser's developer mode. |
| 3 | Build the desktop app | In `desktop-app`, follow the build instructions in that directory's README. |
| 4 | Configure | Complete the setup wizard to set a master password and goals. |

## Security and Privacy

- **Local processing**: all blocking logic and content analysis run on the local machine.
- **Zero telemetry**: no browsing data, statistics, or personal information is transmitted to
  any external server.
- **Open source**: the entire codebase is available for audit under GPLv3.

## Contributing

| Area | Process |
| :--- | :--- |
| Bug reports | Open a GitHub issue with reproduction steps and environment details. |
| Feature requests | Open an issue describing the feature and its alignment with the project's goals. |
| Code changes | Fork the repository, create a feature branch, and open a pull request. |
| Blocklist updates | Edit the relevant blocklist or keyword file and open a pull request. |

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE)
file for details.

---

Pure Path is founded and maintained by [Xeno-legit](https://github.com/Xeno-legit).
