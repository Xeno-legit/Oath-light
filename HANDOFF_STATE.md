# Handoff — Frontier Plan FINAL third implemented (updated 2026-07-12, session 4)

Branch: `phase4/friction`.
This session implemented the **remaining third** of the plan on top of sessions 2–3:
**A.1/A.2** (cargo workspace + `oathlight-core` keyword port + golden corpus),
**1.1/1.2** (system DNS resolver + DoH defense), **3.5/A.4** (OTA blocklist
updates + CI), and **4.4/4.5/5.2** (Lockdown Mode + tamper-evident event log +
trusted-contact accountability). With sessions 2–3 (2.1, 2.2, 3.3, 3.4, 4.1,
4.2, 4.3, 1.3, 5.1, Noir theme) that takes Phase 4 to effectively **complete**.

Built by four Sonnet sub-agents (one synchronous for the workspace foundation,
three in parallel git worktrees) then merged + lead-reviewed line-by-line. The
three parallel agents each hit session/quota limits at ~90% and were resumed;
their worktrees were committed, merged, reviewed, and the OTA agent's unfinished
extension-consumer + CI were completed by the lead. All agent worktrees/branches
have been removed.

## Git state (READ THIS)
Committed, local only (nothing pushed). Commits on `phase4/friction`, newest first:
- `c8529cd` feat(3.5): finish OTA extension consumer + signer + CI (lead)
- `46dfcc2` merge: DNS agent final fix · `4586b3e` merge: eventlog+lockdown+contact
- `08f6c37` merge: OTA · `1a4a884` merge: DNS resolver + DoH
- `704664b`/`d6ce3f9`/`d322b6c`/`d3c875a` the agent feature commits
- `b5c934b` chore: Cargo.lock workspace entries · `927de91` feat(A.1+A.2) workspace+core
Pre-session-4 tip was `780aef6`. `git reset --soft 780aef6` collapses the whole
session back to a dirty tree if you prefer the repo's uncommitted-norm.

## What landed, by item

**A.1/A.2 — workspace + core** (`927de91`)
- `desktop-app/Cargo.toml` virtual workspace (core, src-tauri, guardian,
  native-host, **dns**); profiles hoisted to root; Cargo.lock moved to root.
- `oathlight-core`: `lists.rs` (blocklist embed/parse, normalize, exact-and-parent
  walk), `matching.rs` (function-for-function port of `checkDomainKeywords` +
  leet/confusable/punycode), `eventlog.rs`, `doh.rs`, `ota.rs`.
- Golden corpus `extension/tests/fixtures/keyword-hostnames.json` (90 cases)
  consumed by BOTH `test-domain-keywords.cjs` and core `#[test]`s.

**1.1/1.2 — DNS resolver + DoH defense**
- New crate `desktop-app/dns` (`oathlight-dns`): dependency-free `std::net`
  forwarding proxy — `packet.rs` (parse/synthesize NXDOMAIN, well unit-tested),
  `decide.rs` (whitelist floor → DoH block → domain-list → keyword), `server.rs`
  (UDP+TCP :53 + health probe), `upstream.rs`, `takeover.rs` (Windows adapter
  DNS capture/restore incl. **IPv6 ::1**, non-Windows stubs so it builds cross-
  platform). NOT hickory — lead decision, since nothing compiles here.
- `src-tauri/dns_filter.rs` lifecycle; `SettingsV1.dns_filter_enabled` (default
  false); commands `set_dns_filter_enabled`/`get_dns_status`; friction
  `dns.disable` arm; monitor-tick health/drift/DoH-policy reassert; guardian +
  uninstall restore adapter DNS. `browsers.rs::enforce_dns_policy`/`remove_dns_policy`
  (Chromium `DnsOverHttpsMode=off`, Firefox `DNSOverHTTPS.Enabled=0`).
  `core::doh::DOH_ENDPOINTS`. UI: `DnsFilterSection` in pages-blocking.jsx.

**4.5 — tamper-evident event log**
- `core/eventlog.rs`: append-only JSONL, `hash=sha256(seq‖ts‖kind‖canonical(data)‖prev)`
  with SOH separators + deterministic canonical-JSON (BTreeMap-sorted insert, so
  it's `preserve_order`-independent); sidecar checkpoint catches wholesale
  rollback; `chain_restarted` on break; 10MB rotation. `sha2` added to core.
- Wired at the lib.rs command/applier layer (36 `log_event`/`notify_contact`
  call sites): friction transitions, uninstall, auth failures, monitor Acting,
  extension_missing, process kills, clock anomalies. Commands `get_event_log`,
  `verify_event_log`; "Protection history" card in Settings.

**4.4 — Lockdown Mode**
- `src-tauri/lockdown.rs`: `LockdownStore` with the SAME clock-immune credited-
  time engine as friction (reuses `friction::monotonic`, now `pub(crate)` — one
  write path). `SettingsV1.lockdown`. Commands `start_lockdown` (strengthening,
  instant), `cancel_lockdown` (normal → `require_auth` + `lockdown.cancel`
  friction; **frozen → refused outright**, never registers a cancel), plus a 60s
  `lockdown.allow:<domain>` anti-brick class. Extension: `shouldBlockUrl` STEP -1
  gate (whitelist + user-allow only when active), `blocked.js` lockdown copy,
  desktop `broadcast_blocking` injects lockdown into EVERY blocking push (no
  two-path drop). `test-lockdown.cjs` (12 cases).

**5.2 — trusted contact (Tier 2, opt-in, off by default)**
- `src-tauri/notify.rs`: SMTP via `lettre` 0.11 (rustls) with mailto fallback;
  `SettingsV1.trusted_contact`. Wiring a contact instant; unwiring is friction
  `trusted_contact.remove` AND notifies immediately (anti-weak-moment). Monthly
  heartbeat. Every send/failure event-logged (recipient+kind only). Solo-first:
  the whole path is unreachable unless a contact is named.

**3.5/A.4 — OTA updates + CI** (desktop by agent; ext-consumer/signer/CI by lead)
- Scheme: raw Ed25519 (not minisign) over `lists-manifest.json` bytes, one sig,
  three verifiers. `core/ota.rs` (manifest parse/validate, version-monotonic,
  whitelist floor, two baked pubkeys). Desktop `src-tauri/ota.rs` (ureq +
  ed25519-dalek 2, weekly, atomic swap into `<app_data>/lists/`, push to exts).
  `lists.rs` OTA overlay so app sees updated lists.
- **Lead-completed:** `extension/bg/ota.js` (standalone consumer, self-registers
  weekly alarm, prefers verified lists over bundled — safety floor), vendored
  noble **relocated `lib/`→`bg/`** so it loads in the SW/Firefox background and
  stays in the strict load-order test; `scripts/ota/sign-manifest.mjs`
  (Ed25519 signer, proven build→sign→verify); **re-baked real dev pubkeys** into
  core+bg (agent's had a lost private half); seeds gitignored in
  `scripts/ota/dev-keys.env`. CI `.github/workflows/ci.yml` +
  `release-lists.yml`; `scripts/ci/validate-blocklists.mjs`; `docs/OTA_KEYS.md`.
  `test-ota.cjs` (30 cases: sig/rollback/whitelist/hash/corrupt-fallback).
- Fixed 4 pre-existing malformed blocklist entries the validator caught (2
  un-punycoded IDN domains → `xn--`, 1 query-string domain, 1 uppercase keyword).

## Verification state (this session, all GREEN)
- `node extension/tests/run-all.cjs`: **603 passed / 0 failed** across 8 suites
  (was 559 pre-session; +90-case fixture refactor, +test-lockdown 12,
  +test-ota 30). run-all now `await`s `run()` (backward-compatible; async suites).
- Renderer transpile (bundled Babel): **OK** on all 17 `.jsx`/`.js`.
- Command audit: **56 `#[tauri::command]` ⇔ 56 `generate_handler!`**, exact both
  directions (16 commands added this session).
- Cross-module symbol audit (grep, since no cargo): every symbol the merge wired
  resolves — `broadcast_blocking`, `save_lockdown_allow`, `maybe_send_contact_
  heartbeat`, `EventLog`, `LockdownStore`, `drain_anomalies`, `dns_filter::*`,
  `oathlight_dns::{start,health_check,init_custom_domains}`, `takeover::*`. Core
  declares all 5 modules; src-tauri declares all 17.
- OTA end-to-end proven live: build→sign(dev seed)→verify = true; wrong key /
  tampered = false. Blocklist validator passes (385,683 domains, 1,244 keywords).
- **`cargo check`/`clippy`/`test` NOT run** (cargo hangs here; owner compiles).

## Compile risks for the owner's first `cargo` run (APIs used from memory)
1. **New deps (Cargo.lock regen needed):** `oathlight-dns` (std-only, low risk);
   core `sha2 = "0.10"`; src-tauri `ed25519-dalek = "2"`, `ureq = "2"`,
   `sha2`, `lettre = "0.11"` (default-features=false, `smtp-transport`,
   `rustls-tls`, `builder`). Cargo.lock was hand-merged — regen expected.
2. **ed25519-dalek 2:** `Signature::from_bytes(&[u8;64])` (infallible in 2.x),
   `VerifyingKey::from_bytes(&[u8;32])->Result`, `Verifier::verify`,
   `SigningKey::from_bytes`/`sign` — all match 2.x; pinned against noble by a
   core interop `#[test]`.
3. **lettre 0.11:** `Message::builder().from(mbox).to(mbox).subject().body()`,
   `SmtpTransport::relay(host)?.port().credentials().build()`, `Transport::send`
   — correct for 0.11; confirm the `rustls-tls` feature name on your lettre point rev.
4. **ureq 2:** blocking get + read into a size cap.
5. Session-2/3 risks still open: `windows 0.61` overlay `SetWindowDisplayAffinity`,
   `tauri-plugin-global-shortcut` `event.state()`, `sysinfo 0.30`, `argon2 0.5`
   getrandom (Cargo.toml already patches rand_core).
6. DNS/lockdown/eventlog PowerShell + FFI are RUNTIME risks, not compile.

## Not done / next session
- **Visual pass NOT done** (no browser drive this session). Memory rule stands:
  render the new UI before trusting it — DnsFilterSection (Blocking), Lockdown
  card, Protection-history + Trusted-contact + OTA cards (Settings), the
  lockdown block-page variant. Serve `desktop-app/src/renderer` over http.
- **OTA production keys:** the baked pubkeys are DEV keys (private seeds in the
  gitignored `dev-keys.env`). Before first real release, follow `docs/OTA_KEYS.md`
  (gen prod keypair, re-bake, set `OTA_SIGNING_KEY` secret, delete dev-keys.env).
- **Repo slug** `Xeno-legit/Oath-Light` is hardcoded in both OTA consumers
  (TODO markers) — update together if the repo moves.
- **Firefox OTA:** noble loads via the manifest scripts array (works), but the
  extension-only Firefox path is otherwise on hold (per project memory).
- Scoped-out with TODOs: lockdown schedule-from-vulnerable-hours, 5.2
  ext_removed/block_burst events, event-log cross-file verify.
- Remaining plan work is all Alpha-and-later: 4.6, 6.1 store publication (+1.5
  activation), 3.1 graylist big-five, 5.3–5.5, 6.2/6.3, mobile.
