# Oath Light — Implementation Plan

**Companion to:** [Oath_Light_Frontier_Plan.md](Oath_Light_Frontier_Plan.md) — that document says *what and why*; this one says *how*.
**Date:** 2026-07-07 · **Status:** Living document

Item numbers mirror the Frontier Plan exactly (1.1 here implements 1.1 there).
Each item lists: the approach, the files/crates involved, what existing code gets
reused, and the main risk. A dependency graph and build-order live at the end.

---

## Part A — Cross-cutting foundations (do these first)

These four foundations are prerequisites for half the plan. They are the real
"step one."

### A.1 Cargo workspace + `oathlight-core` shared crate
Today `src-tauri`, `guardian/`, and `native-host/` are three unrelated crates.
Restructure into a workspace:

```
desktop-app/
  Cargo.toml            ← [workspace] members = core, app, guardian, native-host, dns
  core/                 ← NEW: oathlight-core
  src-tauri/            ← app (depends on core)
  guardian/             ← depends on core
  native-host/          ← depends on core
  dns/                  ← NEW: oathlight-dns (item 1.1)
```

`oathlight-core` owns everything used by more than one binary **and everything
mobile will need later** (Pillar 7 becomes "bind core via UniFFI" instead of a
rewrite):
- Domain matching (exact-and-parent walk over a `HashSet`, ported from `bg/blocklists.js`)
- The keyword engine (see A.2)
- The friction state machine (see 4.1 — extracted from `uninstall.rs`)
- The hash-chained event log (4.5)
- Config/schema types + versioned (de)serialization

### A.2 Port the keyword engine to Rust, once, with a golden corpus
The engine (stems, compounds, trap-word whitelist, leetspeak normalization,
homoglyph folding, punycode decode) lives in `extension/bg/matching.js`. The DNS
resolver (1.1), process-name checks (1.3), and Android (Pillar 7) all need it in
Rust.
- Port function-for-function into `oathlight-core::matching`.
- **Golden corpus:** the existing test data in `extension/tests/` (adversarial,
  IDN/punycode, domain-keywords, corpus) becomes shared JSON fixtures consumed by
  BOTH the `.cjs` harness and Rust `#[test]`s. One corpus, two runtimes, zero drift.
  Any future stem addition must land in the fixtures, not in either engine directly.
- CI (A.4) runs both suites on every PR.

### A.3 Versioned settings + one sync channel
`AppState.ext_blocking` already round-trips settings desktop↔extension via the
native bridge (`set_blocking_settings` → `blocklist_sync`-style push). Formalize it:
- A single `SettingsV1` struct in core with a `version` field and migration fn.
- Every new feature (lockdown mode, password gate, panic hotkey, monitor policy)
  is a field here — **never** a new ad-hoc message type.
- Extension mirrors it in `chrome.storage.local` under one key, applied by one
  reducer in `background.js`.

### A.4 CI on GitHub Actions
- Jobs: `cargo test --workspace`, `node extension/tests/run-all.cjs`, blocklist
  format validation (3.6), `cargo clippy`, extension zip build.
- This is also the skeleton that reproducible builds (6.2) and OTA signing (3.5)
  hang off — every later trust feature is "add a job to this workflow".
- **Main risk:** none technical; the discipline risk is merging features before
  the workspace restructure (A.1) and paying the port cost twice.

---

## Part B — Pillar 1: Containment

> **Scope note (mirrors the Frontier Plan):** the DNS layer is a coarse
> *backstop* for surfaces the extension can't reach (Tor, portable browsers,
> Electron apps). It answers only "is this whole domain allowed?" — per-item
> graylist stripping, SafeSearch, in-page filtering, and block-page redirects
> are extension-only capabilities and stay that way. Nothing in this pillar
> moves functionality *out* of the extension.

### 1.1 System-level DNS filtering
**Approach.** New crate `desktop-app/dns/` (`oathlight-dns`), built on
`hickory-server` + `hickory-resolver` (the maintained fork of trust-dns):

1. A `RequestHandler` that, for every query, extracts the QNAME and runs it
   through `oathlight-core::matching` — first the exact-and-parent domain walk
   (the same algorithm as `bg/blocklists.js`), then `checkDomainKeywords`'s Rust
   port. Blocked → answer `NXDOMAIN` (v1; a blockpage IP needs a local HTTPS
   server with cert problems — skip it). Clean → forward to upstream and relay.
2. Upstream = the adapter's *previous* DNS servers, captured before takeover and
   persisted to `<app_data_dir>/dns.json` (so uninstall can restore them);
   fallback 1.1.1.1 / 9.9.9.9. In-memory positive/negative cache honoring TTLs.
3. Listener on `127.0.0.1:53` (UDP + TCP). Windows takeover: enumerate adapters,
   save current servers, then `Set-DnsClientServerAddress -ServerAddresses
   127.0.0.1` (and `::1` for IPv6 — **must** set IPv6 too or Windows silently
   prefers the untouched IPv6 resolver and the whole feature is a no-op).
4. **Where it runs:** inside the watchdog/guardian pair, not the Tauri app —
   the app can be hidden/closed but DNS must never die. The resolver task is
   spawned from `watchdog.rs` alongside the existing resurrection loop, and the
   guardian (`guardian/src/main.rs`) restores adapter DNS to the saved upstreams
   as its *last act* in the sanctioned-shutdown path (`shutdown_requested()`),
   so a legitimate uninstall never leaves the machine without DNS.
5. Blocklist source: the same `extension/blocklists/domains_part*.json` the app
   already embeds via `include_str!` (lib.rs:54-57) — move that loading into
   core so app and resolver share one parsed `HashSet`.

**Reuses:** watchdog lifecycle, `built_in_lists()` parsing, matching engine (A.2).
**Files:** `dns/src/{lib,server,upstream,takeover}.rs`, `watchdog.rs` (spawn +
health check), `guardian/src/main.rs` (restore-on-shutdown), `uninstall`/self-
delete worker (restore-on-uninstall).
**Failsafe (the one that matters):** if the resolver stops answering (crash,
port conflict, machine resume), broken DNS bricks the user's whole machine and
they will uninstall. The watchdog health-checks `127.0.0.1:53` with a probe
query every tick and restores the saved upstream servers if the resolver can't
be revived within ~10s. Fail-open on infrastructure, fail-closed on policy.
**Main risk:** port 53 already taken (ICS, Docker, other filters) — detect at
bind time, surface a clear in-app error, and fall back to the hosts-file sync
of the top ~20k domains described in the Frontier Plan.

### 1.2 DoH / DoT / DNS-change bypass defense
**Approach.** Three independent layers:
1. **Browser policy:** extend `browsers.rs::enforce_policy` with a sibling
   `enforce_dns_policy(def)` that is **not** gated on `CHROMIUM_UPDATE_URL`
   (this works today, pre-publication): Chromium hives get
   `DnsOverHttpsMode = "off"` (Chrome/Edge/Brave/Vivaldi all read it under
   their existing `policy_subkey`), Firefox gets
   `SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS` → `Enabled = 0` (DWORD).
   Same `reg()` helper, same HKLM-then-HKCU fallback as the existing code.
2. **Resolver:** ship a `doh_endpoints.json` list (cloudflare-dns.com,
   dns.google, dns.quad9.net, mozilla.cloudflare-dns.com, …) in core; the 1.1
   resolver answers NXDOMAIN for them. Bootstrapping a DoH client requires a
   plain-DNS lookup of the endpoint hostname first, so killing that lookup
   kills DoH for anything that isn't hardcoding IPs.
3. **Watchdog revert:** each monitor tick (already every 3s in
   `start_monitor`), read adapter DNS (`Get-DnsClientServerAddress`, or the
   `NameServer` value under `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\
   Parameters\Interfaces\{GUID}` to avoid spawning PowerShell); if any active
   adapter no longer points at 127.0.0.1, set it back, and append a
   `dns_changed` event to the event log (4.5). Turning the DNS filter *off*
   goes through the friction store (4.1) like every other weakening.

**Files:** `browsers.rs`, `watchdog.rs`, `dns/`, `core/src/eventlog.rs`.
**Main risk:** legitimate DNS changes (VPN for work, new Wi-Fi with captive
portal) being fought by the reverter. Mitigation: only enforce on adapters
whose DNS *we* set, and pause reversion while a captive-portal probe
(`msftconnecttest.com`) is failing.

### 1.3 Process-level app blocking + evasion-browser detection
**Approach.** The watchdog already calls
`browsers::running_process_names()` every tick — extend, don't duplicate:
1. `SettingsV1.blocked_processes: Vec<String>` (image names, lowercased).
   Matching name → `taskkill /PID` (or `sysinfo`'s `Process::kill`), notify via
   the existing `app.emit` channel, log to the event log. Editing this list is
   a friction-gated weakening when removing, instant when adding (4.1).
2. **Evasion-browser detection:** for any process whose name matches a
   `BrowserDef.process_names` entry *or* a known-browser-family list
   (`tor.exe`, `librewolf.exe`, `waterfox.exe`, portable `chrome.exe` …),
   fetch its exe path (needs `ProcessRefreshKind::new().with_exe()` — a
   *second*, filtered refresh only for matched candidates, keeping the cheap
   name-only scan on the hot path). Flag as evasion if: path is outside
   `Program Files`/`AppData\Local\<vendor>` (portable build), or the browser
   is Firefox-family running from a directory containing `Tor Browser`, or
   the browser key has no extension heartbeat and no profile record
   (profiles.rs) after N minutes. Response is tiered: log → warn in app →
   kill (kill only when the user opted the browser into "block unknown
   browsers", or during Lockdown Mode 4.4).
3. **VPN detection during lockdown:** static list of client process names
   (openvpn.exe, wireguard.exe, nordvpn.exe, expressvpn.exe, …) checked only
   while a lockdown window is active; warn first, kill if lockdown is Frozen.

**Reuses:** process scan, `match_browser_process`, watchdog tick, event log.
**Files:** `watchdog.rs` (new `enforce_processes` fn), `core` (settings +
lists), `pages-settings.jsx` (UI), `browsers.rs` (family list next to BROWSERS).
**Main risk:** false positives killing a process the user needs (e.g. a
corporate VPN at work hours). Tiered response + per-entry user override is the
mitigation; never default any new entry to "kill".

### 1.4 WFP filter driver (horizon)
Do **not** write a signed kernel driver yet. When the time comes, prototype
with **WinDivert** (signed, redistributable, user-mode API): intercept outbound
443, parse the TLS ClientHello SNI, drop the handshake if the hostname fails
`oathlight-core::matching`. That validates the whole approach with zero signing
cost; a true WFP callout driver is only worth it if WinDivert's performance or
AV-flagging proves unacceptable. Everything else in this plan works without it.

### 1.5 All-browser enforcement, activated
**Approach.** This is configuration + publication, not new code:
1. After 6.1 ships, set `browsers.rs::CHROMIUM_UPDATE_URL` to
   `https://clients2.google.com/service/update2/crx` and `FIREFOX_XPI_URL` to
   the AMO XPI URL. The dormant `enforce_policy` machinery (already invoked
   from `start_monitor` on `extension_missing`/`running_partial`) activates by
   itself — that's the point of the gate.
2. While in the policy hive, write alongside the forcelist:
   `IncognitoModeAvailability = 1` (extensions can't be policy-forced *into*
   incognito, so the honest containment answer is disabling incognito),
   `BrowserGuestModeEnabled = 0`, and `ExtensionDeveloperModeSettings`
   (Chrome 128+) to stop dev-mode unloading. Firefox `ExtensionSettings`
   already carries `"private_browsing": true` — add it to the JSON policy.
3. All of these are weakening-gated to remove (4.1) and removed by
   `remove_policy` on sanctioned uninstall.

**Files:** `browsers.rs` only. **Effort:** genuinely `S`.
**Main risk:** users on managed (work) machines where we lose the policy fight
with real IT policy — detect `reg add` failure (already reported as
`EnforceOutcome::Failed`) and say so in the UI instead of silently looping.

---

## Part C — Pillar 2: Intelligence

### 2.1 Ship the §8 action layer
**Approach.** All changes concentrate in `run_monitor` (lib.rs:244) and one new
module `src-tauri/src/overlay.rs`:
1. **Persistence, not confidence:** keep the existing per-frame `blocked` bool,
   but act on a sliding window — e.g. `blocked` in ≥3 of the last 5 scans →
   escalate; 5 consecutive clean scans → de-escalate. State machine
   `Clear → Suspect → Acting` lives in the monitor loop; thresholds next to the
   existing `ENSEMBLE_*` consts so tuning stays in one place.
2. **The action:** `overlay.rs` builds one fullscreen always-on-top Tauri
   `WebviewWindow` per affected monitor (`.fullscreen(true)`,
   `.always_on_top(true)`, `.skip_taskbar(true)`, `.decorations(false)`)
   showing a local blur/dim page with the Mentor copy, a breathing prompt, the
   panic-flow entry (5.1), and — after a dwell timer (start 30s) — a dismiss
   button. On show, also call `open_external` on the user's configured
   redirect from `AppState.ext_blocking` (same target the extension's
   `getRedirectTarget` uses, so desktop and extension redirect identically).
3. **Critical detail — don't scan your own overlay:** set
   `WDA_EXCLUDEFROMCAPTURE` on the overlay HWND via `SetWindowDisplayAffinity`
   (one `windows`-crate call). The monitor keeps seeing the *underlying*
   screen, so de-escalation works while the overlay is up. Without this the
   capture sees its own blur and the state machine deadlocks at Acting.
4. Overlay dismissal, dwell length, and monitor on/off are `SettingsV1` fields;
   turning the monitor off or lengthening nothing/shortening dwell is a
   weakening → friction store (4.1). The AI never gets a stronger actuator
   than "overlay + redirect" — no killing apps, no shutdown.

**Reuses:** `run_monitor`, `ScanEvent.blocked`, `create_main_window` patterns,
`open_external`, Mentor copy, `ext_blocking` settings.
**Main risk:** false positives at full-screen severity. The dwell-dismiss (not
a hard lock) plus the FP feedback button (2.4) is the designed answer; keep the
Acting threshold conservative and tune from the local eval log.

### 2.2 Multi-monitor capture
**Approach.** Mechanical extension of `screen.rs`:
- `capture_all() -> Vec<(u32 /*monitor id*/, RgbaImage)>` over `Monitor::all()`
  (xcap already returns it — `capture_primary` at screen.rs:13 just filters to
  primary today).
- `run_monitor` keeps `prev_fp` and `last_scan` in a `HashMap<u32, _>` keyed by
  monitor id; each tick, fingerprint every monitor, classify only those whose
  `change_score` crossed the threshold (usually one — the classifier stays
  single-invocation per tick in practice).
- `ScanEvent` gains `monitor_id`; the overlay (2.1) targets the monitor(s) that
  triggered. Handle hot-plug: a vanished id drops its map entry; a new id gets
  `change = 255.0` (already the empty-fingerprint behavior) so first frame scans.
**Files:** `screen.rs`, `lib.rs::run_monitor`, `pages-monitor.jsx` (show
per-monitor thumbs). **Main risk:** none real; inference cost scales with
*changed* monitors, not monitor count.

### 2.3 Model diet: quantization + acceleration
**Approach.**
1. In `ml/export_onnx.py`, add a post-export step using
   `onnxruntime.quantization.quantize_dynamic` (INT8) and an FP16 conversion
   (`onnxconverter-common`); emit `image-guard-2.0-int8.onnx` etc. Re-run
   `bench_combined.py` against the same eval set; accept the smallest variant
   within ~0.5pt of FP32 residual accuracy. NudeNet (12MB) isn't worth
   quantizing.
2. In `nsfw.rs`/`nudenet.rs`, enable ort's DirectML execution provider behind a
   cargo feature + runtime fallback: try DirectML, on session-creation error
   fall back to CPU. Log which EP is active into the ScanEvent so the monitor
   page shows it.
3. Adaptive cadence: in `run_monitor`, if the foreground window
   (`GetForegroundWindow` + monitor bounds check) is fullscreen, halve
   `SCAN_MIN_GAP` and lower `SCAN_CHANGE_THRESH` — video defeats
   change-detection less when sampled faster.
**Main risk:** SigLIP transformers sometimes lose disproportionate accuracy
under INT8 — that's why the bench gate is the acceptance criterion, not a
formality. FP16 is the safe fallback (half the size, ~zero loss).

### 2.4 False-positive feedback loop
**Approach.** A "This was wrong" button on the 2.1 overlay (and on scan rows in
`pages-monitor.jsx`) invokes a `report_false_positive(ts)` command that appends
`{ts, fingerprint_hash, siglip_scores, nudenet_scores, verdict, dwell}` as one
JSONL line to `<app_data_dir>/eval_log.jsonl`. Never the thumbnail — scores and
a hash only, so the log is shareable without being sensitive. A settings toggle
"auto-tune": if ≥N FPs in 7 days, raise the Acting window (3-of-5 → 4-of-5)
locally, never touching model thresholds. A "copy anonymized log" button
formats it for a GitHub issue.
**Files:** `lib.rs` (command), overlay HTML, `pages-monitor.jsx`.
**Main risk:** users spamming the button to weaken the monitor — cap auto-tune
at one step, and make further weakening go through friction (4.1).

### 2.5 On-device text NSFW classification (post-Alpha)
**Approach.** Same ONNX/ort stack, new tiny model:
- Model: a distilled multilingual sentence classifier (e.g. a 4-layer
  DistilBERT-class model fine-tuned binary erotica/clean, quantized to <20MB).
  Fine-tune pipeline joins `ml/` next to `export_onnx.py`; the eval corpus is
  the deliverable, the model is a compile step.
- Wire: `content.js` (which already walks the DOM for graylist work) samples
  visible text (~2kB) on domains that are *unknown* — not allowlisted, not
  blacklisted, not graylisted — and sends `{type:"classify_text", text}` over
  the existing native bridge; the desktop scores and replies block/clean; the
  extension calls the existing `handleBlock` on positive.
- Only unknown domains, only once per (tab, host), cached verdict per host for
  the session — keeps bridge traffic and CPU negligible.
**Main risk:** FP cost is a *blocked page*, much higher than an overlay. Gate
behind the Strict preset initially, and threshold for precision over recall.

### 2.6 In-page image scoring for the extension (post-Alpha)
**Approach.**
- `content.js` on gray/unknown domains collects `<img>`/CSS-background
  candidates above a size floor (≥128px), downscales each to ≤224px on an
  `OffscreenCanvas`, JPEG-encodes, and sends batches over the bridge as
  `{type:"score_images", items:[{id, b64}]}`.
- **Protocol note:** `read_tcp_message` caps messages at 1MB (lib.rs:322) and
  Chrome native messaging also caps at 1MB extension→host — so batch ≤6 thumbs
  per message and chunk; do not raise the cap.
- Desktop runs the existing ensemble (`NsfwClassifier` + `NudeNetDetector`,
  already loaded if the monitor ever started) and replies verdicts; content.js
  applies `filter: blur(40px)` + click-to-nothing on flagged ids. Cache verdict
  by image-URL hash in `chrome.storage.session`.
- Images render before scoring returns, so on gray/unknown domains the CSS
  default is *blurred-until-cleared* for candidate images — Canopy's model —
  otherwise the feature is cosmetic.
**Main risk:** latency and jank on image-heavy pages. The size floor, session
cache, and unknown-domains-only scope are the mitigations; measure before
widening scope.

---

## Part D — Pillar 3: Coverage & freshness

### 3.1 Graylist the big five
**Approach.** Extend the existing per-platform architecture — `graylist-sites.js`
(routing/config) + `graylist-inject.js` (DOM filtering) + `bg/graylist.js` —
one platform at a time, in this order (effort ascends): **YouTube** (Shorts
shelf removal, thumbnail filtering, `ageRestricted` metadata is server-provided
ground truth in `ytInitialData`), **Twitch** (mature-flag on stream cards is in
the GraphQL payload rendered into the DOM), **Kick** (same shape), **Instagram**
(Reels/Explore tiles — no labels, so filtering is structural: hide Explore,
gate Reels behind a setting), **TikTok** (same structural treatment: For-You
page is the product; per-item filtering is not tractable, offer
feed-off/search-only mode).
- Where labels exist → per-item stripping (the ground-truth method).
- Where they don't → *surface* removal (hide the algorithmic feed, keep
  search/subscriptions/DMs), as a per-platform toggle like existing graylist
  platforms.
**Reuses:** the entire existing graylist plumbing; each platform is a config +
one inject module, testable with the Playwright visual-check discipline already
used for graylist work.
**Main risk:** DOM churn on Instagram/TikTok breaking selectors — prefer
structural removals (whole feed containers by aria/role) over deep selectors,
and lean on OTA updates (3.5) to ship selector fixes without reinstalls.

### 3.2 Messaging & web-app surfaces
Same pattern as 3.1: Telegram Web (block `t.me` invite resolution to flagged
channels; blur media in channels not in user's allow set), Discord
(`cdn.discordapp.com`/`media.discordapp.net` media requests from non-allowed
guilds blurred via 2.6's scoring once it exists — until then, keyword-filter
embed URLs), WhatsApp Web link previews (strip preview images on gray/unknown
target domains). These ride on graylist-inject + the keyword engine; the
Discord media piece is the only genuinely new mechanism and should wait for 2.6.

### 3.3 AI erotica category
**Approach.** Data + a small engine addition, no new mechanism:
1. New tagged list `extension/blocklists/domains_ai.json`
   (`{"category":"ai-erotica","domains":[…]}`), embedded in both the extension
   loader and lib.rs's `built_in_lists()` alongside `domains_part*.json`. Keep
   it a separate file so the category can be toggled and OTA-updated at its own
   (faster) cadence — this ecosystem churns weekly.
2. Keyword stems: add the ecosystem's naming patterns to
   `KEYWORD_STEMS_STRONG` / `KEYWORD_COMPOUNDS` / `KEYWORD_ROOTS_GUARDED` in
   `bg/matching.js` (`waifu` + guard words, `nsfwai`/`ai-nsfw` compounds,
   companion-bot patterns), with matching entries in
   `KEYWORD_WHITELIST_WORDS` for legit hits (e.g. research/news domains).
   Every addition lands in the golden corpus fixtures (A.2) first.
3. Graylist treatment for mainstream platforms with NSFW corners: civitai
   (NSFW toggle/tabs), character platforms — handled as normal graylist
   platform modules with path rules in `GRAYLIST_EXPLICIT_PATHS`.
**Main risk:** trap words — "AI companion" vocabulary collides with legitimate
AI tooling. The existing guarded-root + whitelist discipline handles it; the
corpus tests are the gate.

### 3.4 SafeSearch expansion
**Approach.** All in `bg/matching.js`'s existing `SEARCH_ENGINES` table +
`checkSearchEngineSafeSearch`:
- **Yandex:** `familyMode`/`fyandex` param rewrite → redirect to
  `family.yandex.<tld>` variant (the reliable mechanism).
- **Brave Search:** `safesearch=strict` param.
- **Ecosia:** `sfsg=strict`. **Startpage:** enforced via its `prfe` cookie
  preference — where a param isn't available, use MV3
  `declarativeNetRequest` header/cookie rules instead of URL rewrites (new
  static DNR ruleset file, referenced from `manifest.json`).
- **SearX(NG):** instances are already in the frontend-instance problem space
  (`FRONTEND_INSTANCE_DOMAINS`) — blacklist known instances rather than trying
  to force preferences on arbitrary self-hosted software.
- **YouTube Restricted Mode** as an opt-in strictness level: one DNR rule
  adding `YouTube-Restrict: Strict` on `*.youtube.com` requests.
- Image-CDN direct access (`*.bing.net/th?`, `yandex-images` …): add to the
  media-search surface handling (`isMediaSearchSurface`).
Each engine gets a case in `test-safesearch.cjs`.
**Main risk:** Startpage/Searx are POST/cookie-based and fragile — accept
partial coverage there; the DNR-cookie approach is best-effort by design.

### 3.5 Over-the-air blocklist updates
**Approach.** Ed25519-signed manifest, GitHub as the CDN:
1. **Publisher (CI):** a release job hashes each list file
   (`domains_part*.json`, `keywords.json`, `domains_ai.json`, graylist configs),
   writes `lists-manifest.json` `{version, created, files:{path:{sha256,size}}}`,
   signs it with **minisign** (key held only as a GitHub Actions secret +
   offline backup), publishes manifest + lists as release assets.
2. **Desktop consumer:** weekly `reqwest` fetch in the app (not watchdog —
   updates are not liveness-critical): fetch manifest, verify signature
   (`minisign-verify` crate, pubkey baked into core), compare version, download
   changed files, verify hashes, atomically swap into
   `<app_data_dir>/lists/`, reload core's `HashSet`s, and push to every
   extension over the existing bridge (`update_blocklist` messages — the
   handler already exists in native-bridge.js:193).
3. **Extension consumer (for users without the desktop app):** weekly
   `chrome.alarms` fetch of the same assets; verify Ed25519 in JS with a
   vendored single-file `@noble/ed25519` (CSP-safe, no CDN); store lists in
   `chrome.storage.local` and prefer them over the bundled copies at load in
   `bg/blocklists.js`.
4. **Safety floor:** built-in lists are never deleted (fallback if storage is
   corrupted); an update that would block any domain on `WHITELIST_DOMAINS` is
   rejected wholesale; version must be monotonically increasing (no rollback
   attacks).
**Main risk:** key management. Minisign key loss = every deployed client stops
updating (they keep working on last lists). Mitigate: bake **two** pubkeys
(active + offline spare) so one compromise/loss is rotatable.

### 3.6 Community blocklist pipeline
**Approach.** Pure CI (`.github/workflows/lists.yml`) triggered on PRs touching
`extension/blocklists/**`:
job 1 validates JSON shape + normalizes (lowercase, punycode-encode, dedupe,
sorted); job 2 fails if any added domain is on `WHITELIST_DOMAINS` or matches
`KEYWORD_WHITELIST_WORDS` roots without an explicit override file; job 3 runs
the full corpus suite (`run-all.cjs` + `cargo test`) so keyword additions prove
they don't regress trap words; job 4 posts a PR comment: N added / N removed /
which categories / any allowlist collisions. `CONTRIBUTING.md` documents the
list format and the evidence bar for adding a domain.
**Main risk:** poisoning (someone PRs a legit domain into the blacklist).
Human review stays mandatory; the allowlist collision check catches the
high-value targets automatically.

### 3.7 URL path & query keyword layer (post-Alpha, Strict-only)
Extend `shouldBlockUrl` (matching.js:1450) with a *conservative* path/query
scan: a short dedicated stem list (`/porn/`, `tag=nsfw`, explicit-only stems —
NOT the full hostname stem list, which would be FP suicide on paths), same
leet/confusable folding, gated on `settings.preset === "strict"`. New corpus
fixture file for path cases. Ship dark (flag off) first, gather FP data from
the FP feedback loop, then enable in the Strict preset.

---

## Part E — Pillar 4: Tamper resistance

### 4.1 Generalized friction: delayed weakening
**The keystone refactor.** Extract `uninstall.rs`'s store into
`oathlight-core::friction`:
```rust
pub struct FrictionStore {           // generalizes UninstallStore
    path: PathBuf,                   // <app_data_dir>/friction.json
    inner: Mutex<HashMap<ActionId, PendingChange>>,
}
pub struct PendingChange {
    requested_at: u64,
    monotonic_anchor: u64,           // 4.3
    delay_secs: u64,                 // per-action-class delay
    payload: serde_json::Value,      // the settings diff to apply when ready
}
```
- `ActionId` is a string key: `"uninstall"`, `"monitor.disable"`,
  `"custom_block.remove:<domain>"`, `"vulnerable_hours.shrink"`,
  `"dns.disable"`, `"lockdown.cancel"` …
- **Classification lives in one place:** a `fn classify(old: &SettingsV1, new:
  &SettingsV1) -> Vec<Weakening>` comparator in core. Every settings write goes
  through `apply_settings(new)`: strengthenings apply immediately; weakenings
  are split out into `PendingChange`s. There is deliberately **no** other write
  path — that's what makes the guarantee auditable.
- Tauri surface: `request_weakening`, `cancel_weakening`, `get_pending`,
  `apply_ready` commands mirroring today's
  `request_uninstall`/`cancel_uninstall`/`get_uninstall_state`
  (lib.rs:1179-1237); the uninstall flow becomes just `ActionId::"uninstall"`
  with its existing special-case teardown on apply. Keep `uninstall.json`
  reading for one release (migration), then delete.
- UI: a "Pending changes" card in `pages-settings.jsx` listing countdowns with
  Cancel buttons — visibility is part of the deterrent.
- Extension-side settings (graylist toggles, custom list removals) already
  round-trip through the desktop (`set_blocking_settings` → `set_blocking`),
  so gating the desktop side gates them too; the extension options page just
  needs "pending" UI states.
**Main risk:** classification bugs marking a weakening as instant. The
comparator gets exhaustive unit tests in core — one test per settings field,
both directions — and defaults to *weakening* for any unrecognized change.

### 4.2 Master password / second-keyholder code
**Approach.**
- `argon2` crate (Argon2id, default params), PHC-string hash stored in
  `<app_data_dir>/auth.json` with a random salt. Never the password anywhere.
- Commands: `set_master_password(current_or_none, new)`,
  `verify_master_password(pw) -> session token` (an in-memory random token
  with a 5-minute expiry, held in `AppState`), and every weakening/friction
  command (4.1) plus `set_guard_enabled` gains an optional `auth: Option<String>`
  token parameter, **enforced in Rust** — UI gating alone is decoration, the
  webview is not a trust boundary (same reasoning as the release-build
  `stop_watchdog` no-op at lib.rs:1164).
- Removing/changing the password is itself a friction-gated weakening (needs
  current password AND the delay).
- **Second-keyholder mode (optional):** identical machinery, different
  ceremony — any trusted person (parent, sibling, friend, mentor) types the
  password during setup (a "look away" screen), the app stores only the hash,
  and the UI copy changes to "ask your keyholder". Optionally store their
  label/email for 5.2 notifications on failed attempts. Never presented as
  the default path — solo self-set password is the primary flow.
- Extension options: sensitive toggles send a `verify_password` request over
  the bridge and get a token back; without the desktop app connected, the
  extension simply keeps its options locked (fail closed).
**Main risk:** lockout (forgotten password, no keyholder). Deliberate decision:
recovery = waiting out an uninstall-length friction delay to *remove* the
password — same asymmetry as everything else, documented in the UI.

### 4.3 Clock-tamper immunity
**Approach.** Fix it inside `friction.rs` (4.1) so every timer inherits it:
- On `request()`, store both `requested_at` (wall) and `monotonic_anchor` =
  `GetTickCount64()` (ms since boot; the `windows` crate exposes it — or
  `std::time::Instant` serialized as offset, but tick count survives process
  restarts within a boot session).
- On `state_from()`, compute `wall_elapsed` and `tick_elapsed`; **credited
  elapsed = min(wall_elapsed, tick_elapsed + rebooted_credit)**. If
  `wall_elapsed` exceeds `tick_elapsed` by more than a small tolerance without
  a reboot in between (boot session id from
  `WMI Win32_OperatingSystem.LastBootUpTime` or tick-count reset detection),
  the wall clock jumped: freeze at the tick-derived value and append a
  `clock_anomaly` event (4.5).
- Reboots are the honest gap (tick count resets): persist
  `last_seen = (wall, tick)` from the watchdog every minute; across a reboot,
  credit only the *persisted* span plus post-boot ticks. A user who reboots
  repeatedly gains nothing; a user who sets the clock forward gains nothing.
**Files:** `core/src/friction.rs`, `watchdog.rs` (the minute-heartbeat write).
**Main risk:** none serious — worst case a legitimate hibernate/resume credits
conservatively (timer runs slightly long), which is the correct failure
direction for a friction system.

### 4.4 Lockdown Mode (whitelist-only)
**Approach.**
1. `SettingsV1.lockdown: {active_until: Option<u64>, frozen: bool, schedule:
   Vec<Window>}` — schedulable from vulnerable hours (the reminder schedule in
   `ext_blocking` already carries the windows; lockdown is an escalation flag
   on each window) or started on demand ("Lock me down for 2 hours").
2. **Extension enforcement:** first check in `shouldBlockUrl` — if lockdown is
   active, allow only `WHITELIST_DOMAINS` + user allowlist additions; block
   everything else with a dedicated lockdown block page variant. Pushed over
   the existing `set_blocking` channel so all profiles flip within a heartbeat.
3. **DNS enforcement (once 1.1 exists):** resolver flips to the same
   allowlist-only mode — covers non-extension browsers, which is exactly when
   lockdown matters most.
4. **Asymmetry via 4.1:** starting/extending lockdown is instant; cancelling a
   normal lockdown is a friction-delayed weakening; a **Frozen** lockdown
   registers no cancel action at all — `apply_ready` refuses the ActionId
   until `active_until` (the watchdog owns the clock, with 4.3 anchoring so
   clock-rolls can't shorten it).
**Main risk:** locking users out of something critical (banking, work SSO).
Mitigation: the user allowlist is *additive during* lockdown via a
strengthening-style flow with a short (60s) delay + event-log entry —
enough friction to stop impulse, not enough to brick a workday.

### 4.5 Tamper-evident event log
**Approach.** `oathlight-core::eventlog`:
- Append-only JSONL at `<app_data_dir>/events.log`; each entry
  `{seq, ts, kind, data, prev, hash}` where
  `hash = sha256(seq ‖ ts ‖ kind ‖ canonical(data) ‖ prev)`; genesis uses a
  fixed string. `sha2` crate; writes are `O_APPEND` + fsync'd.
- Writers: friction store transitions (request/cancel/apply), watchdog
  (extension missing, process killed, DNS reverted, clock anomaly, guardian
  restarts), monitor (Acting escalations — event only, no content), auth
  (failed password attempts).
- `verify_event_log()` command walks the chain and reports the first break;
  UI page shows the log with a green "chain intact since <date>" banner —
  and an unmistakable red one on truncation/edit. Deleting the file is itself
  evidence (the chain restarts and says so).
- This is detection, not prevention — pairs with 5.2 (a trusted contact is *told*
  about gaps) rather than pretending local files can be write-protected from
  an admin user.
**Main risk:** log growth — rotate at 10MB by sealing the file with a final
entry whose `data` is the next file's genesis hash (chain spans files).

### 4.6 Uninstall hardening (near-Alpha)
When `DEFAULT_DELAY_SECS` goes to `24*60*60` (owner decision, near Alpha):
- **Typed-paragraph friction:** `request_uninstall` returns a random paragraph
  (word-list generated in Rust, stored in the friction payload);
  `apply_ready("uninstall")` requires it retyped exactly — compared in Rust,
  not JS.
- **Trusted-contact notification** (only if one is configured — 5.2 is optional)
  on request + on cancel-of-lockdown.
- **Double registration:** `watchdog::register_autostart` gains a
  `schtasks /create /sc onlogon` twin so a Safe-Mode boot or registry-autorun
  cleanup doesn't orphan protection; guardian checks both registrations each
  tick and re-adds whichever is missing (event-logged).

---

## Part F — Pillar 5: Humanity

### 5.1 Panic / SOS button
**Approach.** Assembly job, one new renderer page + three entry points:
1. `pages-panic.jsx`: full-screen sequence — box-breathing animation (CSS only)
   → the 20-minute-wave message (already in Mentor copy) → grounding exercise
   (5-4-3-2-1) → user's redirect target + habit-replacement options (5.6). Each
   step advances on its own timer; skippable but defaults to flowing through.
2. Entry points: tray menu item (`install_tray` at lib.rs:1300 — add a "I need
   help now" `MenuItem` before "Open Oath Light"); global hotkey via
   `tauri-plugin-global-shortcut` (default Ctrl+Shift+Space, configurable);
   a button on the extension's `blocked.html` that deep-links via the bridge
   (`{type:"open_panic"}` → desktop shows the window; if the desktop isn't
   connected, blocked.html runs a self-contained HTML version of the same flow
   — don't let the best moment to help depend on the companion app).
3. Every panic-flow completion appends an (event-log) entry and offers the
   one-tap urge log (5.4) at the end — that's how the analytics get fed.
**Main risk:** none technical. Copy quality is the whole feature.

### 5.2 Privacy-first accountability
**Solo-first, human-optional.** Tiers 0–1 of the Frontier Plan's accountability
ladder (friction, frozen lockdown, tamper-evident log) are implemented by 4.1,
4.4, and 4.5 — they ARE the accountability system for a user with nobody to
tell, and they ship regardless of this item. What follows implements only the
optional Tier 2: notifying a trusted contact (parent, sibling, friend, mentor —
anyone), for users who choose to name one. The feature is opt-in, never nagged,
and its absence removes nothing from Tiers 0–1.

**Approach.** Event-driven notifier in the desktop app:
1. `SettingsV1.trusted_contact: Option<{name, email, events: {uninstall_requested: bool, ext_removed: bool, lockdown_cancelled: bool, block_burst: bool}}>`.
   Wiring a contact is instant; unwiring is a friction-gated weakening (4.1)
   **with notification of the unwire request itself** — otherwise the
   weak-moment self just removes the contact first.
2. Event sources already exist after Part E: friction store transitions, the
   watchdog's `extension_missing` state (notify only if not restored within
   N minutes — reuse the `enforced` debounce set in `start_monitor`), block
   bursts from `stats_update` deltas during vulnerable hours.
3. **Delivery, v1:** SMTP via the `lettre` crate with user-supplied
   credentials (their own Gmail app-password etc.) — genuinely zero
   infrastructure, matches the self-hosted ethos; plus a `mailto:` fallback
   that at least opens a prefilled draft. **v2:** a stateless relay (single
   Cloudflare Worker, forwards and forgets, source in the repo) for users who
   won't do SMTP setup; document precisely what it sees (recipient + event
   type, never content).
4. Every notification sent/failed is event-logged (4.5) so the contact can
   verify none were suppressed.
**Main risk:** silent delivery failure = false sense of accountability. Send a
monthly "heartbeat" email so silence itself is a signal, and surface send
failures in-app persistently.

### 5.3 Real recovery program
**Approach.** Content-as-data, no chatbot pretense:
- `desktop-app/src/renderer/assets/program/` holds JSON lesson/flow files:
  `{id, title, steps:[{kind: breathing|text|input|choice, …}]}`. A single
  `FlowRunner` component in `pages-mentor.jsx` renders any flow — the panic
  flow (5.1), the urge→grounding→reflection→plan CBT sequence (v1), and the
  90-day course (v2, one JSON per day, unlocked by streak day) are all the
  same runtime.
- Journaling inputs persist locally (`store.js` → a `mentor.json` in app data
  via a small read/write command pair) — never synced anywhere.
- v3 (local LLM) explicitly out of scope until the flow content proves itself;
  the FlowRunner design keeps that door open (a flow step kind `chat` later).
**Main risk:** content quality; budget for writing/reviewing the copy like a
feature, not an afterthought. Ship v1 with 5 flows done well over 30 done thin.

### 5.4 Journaling, urge log & trigger analytics
**Approach.**
- Urge capture: tray item + panic-flow exit + a keyboard-light dialog —
  `{ts, trigger?: bored|stressed|late|lonely|other}` appended to
  `<app_data_dir>/urges.jsonl` via one command.
- Block timestamps: the extension already reports per-block events
  (`recordBlockAndRedirect` → `stats_update`); extend the message with an
  hour-of-week histogram (extension-side aggregation, so no URL ever crosses
  the bridge — privacy stance preserved) merged into app data.
- Analytics: computed in the renderer from the two local files — hour-of-week
  heatmap, urge/block correlation, streak overlays. The payoff feature:
  detect the top risk window (≥2× median activity) and render **"Set Tue/Fri
  23:00–01:00 as vulnerable hours"** as one button that writes the schedule
  through the normal `set_blocking_settings` path.
**Main risk:** none technical; keep every byte of this local and say so in the UI.

### 5.5 Compassionate streak design
Pure logic change in `store.js` + `pages-overview.jsx`: persist
`{current_streak, clean_days_this_month, best_streak}`; a relapse decrements a
"month score" instead of zeroing identity; wire the existing milestone
notification stubs; add the post-relapse flow (a `program/` JSON — the Mentor
"slip" script already written) triggered on streak reset, then a 24h
gentle-mode flag that softens reminder copy. Small, but touches the emotional
core — design review with real users before shipping.

### 5.6 Environment tools (post-Alpha)
- **Grayscale hours:** Windows color filter = `HKCU\Software\Microsoft\
  ColorFiltering` `Active=1`, `FilterType=0` (grayscale). Setting the registry
  alone doesn't repaint reliably; the working trick is enabling the hotkey
  (`HotkeyEnabled=1`) and synthesizing Win+Ctrl+C via `SendInput` — prototype
  first, it's the only genuinely uncertain mechanism in this pillar. Scheduled
  by the same vulnerable-hours windows; disabling mid-window is a weakening.
- **Habit replacement:** `SettingsV1.alternatives: Vec<{label, action}>`
  rendered as buttons on blocked.html + the 2.1 overlay + the panic flow.
- **Faith packs:** motivation packs as data (`assets/packs/<id>/copy.json` —
  reminder strings, milestone copy, optional prayer-time lockdown windows via
  a bundled calculation lib, no network). A pack selection setting, secular
  default, never a fork.

---

## Part G — Pillar 6: Trust & distribution

### 6.1 Store publication
**Order of operations matters:**
1. **Rotate the extension key.** `oathlight-extension-key.pem` is committed to
   the repo (`desktop-app/`) — for Web Store publication the CWS-assigned ID
   supersedes it, but a public private-key must not remain the basis of
   anything. Recompute `browsers.rs::EXTENSION_ID` from the final store ID
   (the sha256→a-p mapping is documented at browsers.rs:31).
2. CWS listing (one-time $5, review cycle ~days), Edge Add-ons (free), AMO
   (review + signing — the signed XPI URL is what `FIREFOX_XPI_URL` needs).
   Keep `manifest.json` MV3-clean: the graylist injections and DNR rules are
   the review-risk surface; write the reviewer notes up front.
3. Desktop: Tauri's NSIS bundler already produces the installer (the
   `installer.nsi`/Add-Remove handling in lib.rs references it); add
   `tauri-plugin-updater` with the update manifest as a GitHub release asset,
   signed with Tauri's updater keypair (secret in CI).
4. Then flip the `browsers.rs` URLs → 1.5 activates.
**Main risk:** store review objecting to force-install-adjacent behavior —
the extension itself does none of that (the *desktop app* writes policy), which
is the correct architecture for review and should be stated in the notes.

### 6.2 Reproducible builds
CI job on tag: pin exact toolchains (`rust-toolchain.toml`, `package-lock`),
set `SOURCE_DATE_EPOCH` from the tag commit, build the extension zip with
sorted/zeroed-timestamp entries (a 20-line pack script instead of `zip`), build
the installer twice on independent runners, diff hashes, publish
`SHA256SUMS + minisign signature` as release assets. Document one-command local
verification in `docs/VERIFY.md`. NSIS determinism is the hard part — if the
installer won't reproduce, publish reproducibility for the zip + exe payloads
inside it first and say so honestly.

### 6.3 "Break Oath Light" bypass bounty
`SECURITY.md` (threat model: what's in scope — bypass with standard user
privileges, no admin/registry edits — and what's acknowledged out of scope) +
`BYPASSES.md` hall of fame (reporter, date, technique, fix commit, regression
test). Rule: every confirmed bypass lands as a case in the adversarial suite
(`test-adversarial.cjs` or the Rust twin) before it's marked fixed. Costs a
day; compounds forever.

### 6.4 Docs, website, onboarding
- Website: static site in `docs/` on GitHub Pages; the content is the trust
  pitch — *how* it blocks, what leaves the device (nothing), how to verify a
  build (6.2).
- **First-run wizard:** renderer flow keyed on `SettingsV1.onboarded == false`:
  preset choice (Standard / Strict / Lockdown — a preset is just a named
  `SettingsV1` template in core), vulnerable-hours picker, optional master
  password / trusted-contact setup (4.2, 5.2 — both clearly skippable; the
  solo path is first-class), then a live test: open a test-blocked
  URL and show the block page working. Presets exist in core so the extension
  and DNS layers inherit them, not just the UI.
- **README de-drift:** as 4.2 and the wizard ship, the claims become true —
  audit README against reality in the same PRs. Never let it drift again: the
  claims audit is a checklist item in the release workflow.

### 6.5 Settings page honesty
Small PR, do immediately: in `pages-settings.jsx`, remove the dead "Edit
profile" control; keep the email field only if 5.2 is committed for Alpha
(label it "trusted-contact/notification email — not yet active" until then, or cut it);
notification toggles must map 1:1 to real reminder behavior via `ext_blocking`.
A tamper-resistance product with placebo controls is self-defeating.

**Superseded/expanded:** the settings page turned out to be one symptom of a
renderer-wide pattern (placebo blocking toggles, silently-reverted graylist
switches, a hardcoded "4.2M+" stat, localStorage-only streak). The dedicated UI
Truth plan that covered this was executed and retired on 2026-07-07: custom
sites now sync renderer → backend (`set_custom_domains`, persisted) →
extension diff-merge; live blocklist counts (`get_blocklist_counts`) and a
real domain check (`check_domain_blocked`) replaced the hardcoded stat and the
12-domain search; `uninstallGuard` drives `set_guard_enabled`; SafeSearch
shows as an honest always-on badge; unbuilt features render as disabled
"coming in Phase 4/Alpha" rows. Its structural fix remains the same
`SettingsV1` foundation as A.3 — backend owns settings, the renderer store
becomes a display cache, and a toggle can only exist for a field whose
enforcement exists (that part, plus graylist toggles and the backend-owned
streak, is still open).

### 6.6 Localization (post-Alpha)
Standard key-based i18n: `renderer/i18n/<lang>.json` + a `t()` helper (no
framework needed at this app's size); extension pages use
`chrome.i18n`/`_locales`. Extract strings *as part of* each feature PR from now
on (retrofitting is the expensive part). First targets: Arabic (RTL — the
layout audit is the real work), Spanish, Portuguese, Hindi, Indonesian.

---

## Part H — Pillar 7: Mobile groundwork

The only Phase-4/Alpha *action* for mobile is architectural discipline:
- Everything in `oathlight-core` stays `no_std`-tolerant where cheap, avoids
  Windows-only deps outside `#[cfg]` blocks, and exposes a UniFFI-friendly
  surface (plain structs, no Tauri types). The A.1 crate boundary is the mobile
  strategy.
- `oathlight-dns` keeps resolver logic separate from Windows adapter takeover —
  Android's `VpnService` DNS intercept will consume the same resolver core.
- Model quantization (2.3) is the other hard prerequisite (mobile can't ship
  343MB FP32).
- Actual Android work (Kotlin `VpnService`, accessibility capture,
  device-admin friction) is a separate plan when Phase 5 opens; nothing else
  in this document blocks on it.

---

## Part I — Dependency graph & build order

```
A.1 workspace ──► A.2 keyword port ──► 1.1 DNS resolver ──► 1.2 DoH defense
     │                                      │                    ▲
     │                                      └──► 4.4 lockdown(DNS)│
     ├──► A.3 SettingsV1 ──► 4.1 friction ──► 4.2 password        │
     │                          │    │        4.3 clock (inside 4.1)
     │                          │    └──► 4.4 lockdown(ext) ──► 1.3 VPN-block
     │                          └──► 4.5 event log ──► 5.2 accountability
     └──► A.4 CI ──► 3.5 OTA ──► 3.6 community pipeline
                      └──► 6.2 reproducible builds

2.2 multi-monitor ──► 2.1 action layer ──► 2.4 FP loop
5.1 panic (independent) · 3.3/3.4 (independent) · 6.5 (independent)
6.1 stores ──► 1.5 force-install activation
```

**Recommended Phase-4 build order** (dependencies + risk-retirement first):

| # | Item | Why this slot |
| :-- | :-- | :-- |
| 1 | A.1–A.4 foundations | Everything below lands in the right place |
| 2 | 6.5 settings honesty · 2.2 multi-monitor | Small, independent, immediate wins |
| 3 | 4.1 friction + 4.3 clock (one PR) | The keystone; every later feature hooks it |
| 4 | 2.1 AI action layer | Flagship feature; needs only 2.2 + settings |
| 5 | 5.1 panic button | High value, no dependencies, pairs with 2.1's overlay |
| 6 | 4.2 master password | Gates settle once friction exists |
| 7 | 1.1 DNS resolver | Longest lead item — start early, land mid-phase |
| 8 | 1.2 DoH defense (policy part can ship before 1.1 lands) | Closes 1.1's bypass |
| 9 | 1.3 process blocking + evasion detection | Rides the watchdog tick |
| 10 | 3.5 OTA updates | Needs A.4/CI; unblocks list-only releases |
| 11 | 3.3 AI-erotica lists · 3.4 SafeSearch expansion | Data work, parallelizable with anything |

Alpha then opens with 4.4 lockdown, 4.5 event log, 5.2 accountability, and 6.1
store publication — each of which now has every hook it needs already in place.

---

## Part J — Standing rules while executing

1. **One write path per invariant.** Settings changes go through
   `apply_settings`; friction through `FrictionStore`; protective events
   through the event log. A feature that needs a second path is designed wrong.
2. **The webview is not a trust boundary.** Anything security-relevant is
   enforced in Rust commands, never only in JSX (the release no-op
   `stop_watchdog` is the house pattern).
3. **Fail open on infrastructure, fail closed on policy.** Broken resolver →
   restore real DNS. Missing password file → settings stay locked.
4. **Every bypass fix lands with a regression test** in the shared corpus (A.2)
   or the adversarial suite. No exceptions — this is what makes 6.3 viable.
5. **Strengthening instant, weakening delayed** — when unsure which a change
   is, it's a weakening.
6. **Nothing leaves the device by default.** Any feature that transmits
   (OTA fetch, trusted-contact mail) states exactly what it sends in the UI and in
   PRIVACY.md, and is verifiable in source.