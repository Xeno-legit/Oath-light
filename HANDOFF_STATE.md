# Handoff — Phase 4 complete + first compile validated (updated 2026-07-18, session 5)

Branch: `pre-alpha/release` (session 4's `phase4/friction` was merged in via PR #6
before this session). Everything below is committed locally on `pre-alpha/release`;
**nothing pushed**.

## What session 5 did

**Repo slug fix.** The GitHub repo was renamed Pure-Path → **`Xeno-legit/Oath-light`**
(canonical casing confirmed via the GitHub API — lowercase "light"). Both OTA
consumers (`src-tauri/ota.rs`, `extension/bg/ota.js`), the README clone URL, the
installer EULA/POLICY, and the local git remote all now point at the canonical slug.
The session-4 TODO markers for this are resolved.

**First real cargo run — cargo works on this machine (1.96.0).** The "cargo hangs
here" note from session 4 was that environment only; do not avoid cargo anymore.
Results: `cargo check --workspace` passed with **zero errors** — none of the
session-4 "APIs from memory" risks (ed25519-dalek 2, lettre 0.11, ureq 2, sha2,
sysinfo 0.30, argon2 0.5, windows 0.61, global-shortcut) were actually wrong.
`cargo test` caught 2 real bugs, both fixed:
- `dns/packet.rs` treated any label byte ≥64 as a compression pointer; RFC 1035
  mask is `& 0xC0 == 0xC0`.
- `ota.rs` noble↔dalek interop fixture's `sig_hex` was fabricated; replaced with
  the real deterministic signature produced by the vendored noble-ed25519
  (byte-identical to dalek's output) — the interop pin is now genuine.
Plus 17 machine-applicable clippy fixes. Left un-chased: doc-comment indentation
lints in `dns/`, and a `profiles.rs:43` complex-type-alias suggestion.

**Session-4 scoped-out TODOs, all implemented:**
- **4.4 v2 — lockdown schedule-from-vulnerable-hours**: opt-in
  `SettingsV1.lockdown.escalate_vulnerable_hours` (default off). The extension owns
  the local-time window math (`reminders.js`, `pp-lockdown-escalation` alarm, 2 min,
  armed only when opted in) and sends `vulnerable_window_active {remainingMin}`;
  the desktop tops up a non-frozen lockdown (`LockdownStore::start` is monotonic, so
  duplicates are harmless). New command `set_lockdown_escalation`: ON instant, OFF
  friction-gated under `lockdown.escalation_disable` (applier arm in lib.rs).
  Command parity now **57⇔57**.
- **5.2 v2 — `ext_removed` + `block_burst` contact events**: 5-min debounce on
  `extension_missing` while the guard is on (fires once per missing streak,
  `extension_missing_confirmed` event + `notify_contact`); block-burst detector
  diffs cumulative `totalBlocks` into a rolling window (≥10 blocks / 10 min, one
  notify per window; a reconnect resync can never look like a burst).
  `NotifyEventsV1` gained both toggles (default true); copy in `notify.rs`.
- **4.5 v2 — event-log cross-file verify**: `verify()`/`EventLog::verify()` now walk
  the whole chain from genesis `events.log` across every rotated segment via each
  segment's sealing `log_rotated → next_file` entry — a deleted rotated-out segment
  is tamper evidence, and the sidecar-checkpoint comparison is part of verify itself.
  NOTE: `verify(path)` became `verify(app_data_dir)`. `recent()`/`get_event_log`
  still list only the current file (documented, deliberate).
- **6.5 leftover — profile email wired**: "Use my email" prefill in the new
  trusted-contact UI (self-notification paper-trail path, solo-first preserved).

**Corrected a false session-4 claim, then built the missing UI.** Session 4's
handoff claimed Lockdown/Protection-history/Trusted-contact/OTA cards existed in
the renderer. A browser-driven visual audit proved otherwise: only DnsFilterSection
and the extension's lockdown blocked-page variant existed; `ListsUpdateCard` was
defined but never mounted and referenced a nonexistent `IconGlobe`. Now actually
built and render-verified (stubbed `__TAURI__`, every state screenshotted, zero
console errors):
- `TrustedContactCard` (Settings) — add/remove (remove = friction + immediate
  notify), email prefill.
- `ProtectionHistoryCard` (Settings) — recent events + "Verify integrity" with an
  honest intact/tampered verdict from `verify_event_log`.
- `ListsUpdateCard` (Settings) — mounted; `IconGlobe` added to icons.jsx.
- `LockdownCard` (Blocking page, after Tamper protection) — duration picker,
  frozen variant (no cancel button, waits out), cancel via `lockdown.cancel`
  friction/pending-changes, escalation toggle.

## Verification state (session 5, all GREEN, merged tree)
- `cargo check --workspace`: clean. `cargo test --workspace`: **81/81**
  (app_lib 26, oathlight-core 37 incl. 5 new cross-file-verify tests, dns 18).
  `cargo clippy`: warnings only (listed above).
- `node extension/tests/run-all.cjs`: **603 passed / 0 failed** (8 suites).
- Renderer: all 17 `.jsx`/`.js` transpile; new cards live-rendered in every state.
- Command audit: 57 `#[tauri::command]` ⇔ 57 `generate_handler!`, exact.

## Not done / next
- **OTA production keys (owner-only)**: baked pubkeys are still DEV keys
  (`scripts/ota/dev-keys.env`, gitignored). Before first real release follow
  `docs/OTA_KEYS.md`: gen prod keypair, re-bake core+bg, set `OTA_SIGNING_KEY`
  repo secret, delete dev-keys.env.
- **Push**: session-5 commits are local only; owner should review + push.
- **4.6 uninstall hardening**: raise the 10s test timer to its real value,
  type-a-paragraph friction, scheduled-task + service double-registration.
- **6.1 store publication** (activates dormant 1.5 force-install): store assets/
  privacy docs are committed; developer accounts + submission are owner actions.
- SMTP configuration UI (`get/set_smtp_config` exist, no consumer — mailto
  fallback works with zero setup).
- Remaining plan work is Alpha-and-later: 3.1 graylist big-five, 5.3–5.5,
  6.2/6.3/6.4, 2.4, mobile.
