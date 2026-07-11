# Handoff — Frontier Plan partial implementation (updated 2026-07-11, session 3)

Branch: `phase4/friction`.
This session added Frontier Plan items **4.1 + 4.3** (generalized friction + clock-tamper
immunity), **4.2** (master password), and **1.3** (process blocking + evasion-browser
detection), on top of the session-2 work (2.1, 2.2, 3.3, 3.4, 5.1 + Noir theme — all still present).

That takes the Phase-4 build to roughly **2/3** of the plan. Remaining third is the
cargo-workspace-heavy block: A.1/A.2 (workspace + Rust keyword port), 1.1/1.2 (DNS
resolver + DoH defense), 3.5 (OTA), plus 4.4/4.5/5.2 (lockdown, event log, accountability).

## Git state (READ THIS)

Unlike prior sessions, this work **is committed** (local only, nothing pushed) — it was
committed so three sub-agents could run in parallel git worktrees. Commits on
`phase4/friction`, oldest-first:
- `1658130` WIP: friction store 4.1+4.3 (base) · `0e88b21` WIP: partial 4.2 auth
- `6ca5666` feat(1.3) · `a0d4e20` feat(4.2) — the two agent-worktree branches
- `8489448` / `9975246` merge commits · `<review>` throttle fix
If you prefer the repo's usual uncommitted-working-tree norm, `git reset --soft de0e206`
collapses all of it back to a dirty tree (de0e206 is the last pre-session-3 commit).

## Done this session (lead-reviewed line-by-line; NOT yet compiled — see risks)

**4.1 generalized friction + 4.3 clock immunity** — `core` of the tamper layer.
- New `friction.rs`: `FrictionStore` (persisted `friction.json`), keyed by string `action_id`.
  Every *weakening* registers a `PendingChange`; strengthenings are instant. Clock immunity
  is real: `credited_secs` accumulates the **min(Δwall, Δtick)** each observation, tick =
  `GetTickCount64()` (hand-rolled FFI, no dep). Forward clock-jump credits nothing; reboot
  credits only post-boot ticks (conservative — timer runs long, never short). `take_ready`
  excludes `"uninstall"` (uninstall only *unlocks*, never auto-fires — the module's one
  load-bearing invariant).
- New `settings.rs`: `SettingsV1` (guard_enabled, monitor_enabled, blocked_processes,
  block_unknown_browsers) persisted to `settings.json`, per-field serde defaults. Seed of A.3.
- `uninstall.rs`: `UninstallStore` deleted; `delay_secs()`/`Persisted` now `pub(crate)`;
  new `write_marker()` mirrors `uninstall.json` for the watchdog/guardian (which still read
  it off disk independently — protocol unchanged).
- `lib.rs`: uninstall commands migrated onto the friction store; `set_guard_enabled` /
  `stop_nsfw_monitor` return `WeakeningOutcome {applied, pending}`; `remove_custom_domain`
  + `set_custom_domains` now additions-only (removals are weakenings). Applier thread in
  `setup()` polls 1s, applies ready weakenings (guard/monitor/custom-block/password/process).
- Renderer: `usePendingWeakenings` hook, `PendingChangesCard` (Settings), inline pending
  notes on Blocking/Blocklist/Monitor. `window.fmtDur` exported for cross-file use.

**4.2 master password** — `auth.rs`: Argon2id PHC hash in `auth.json`, in-memory 5-min
session tokens, 1s attempt throttle. `require_auth(app, &token)` is the one Rust gate on the
weakening commands (`request_uninstall`, `set_guard_enabled` off-path, `stop_nsfw_monitor`
running-path, `remove_custom_domain`, `remove_blocked_process`, `set_block_unknown_browsers`
off-path). Removal is double-gated (current password AND friction delay); `request_password_
removal_forgotten` is the no-password recovery path (same delay — **TODO(near-Alpha):** give
it a real 24h delay class, currently the standard weakening delay). Renderer: `window.PPAuth`
(`.acquire()` token cache + prompt), `PasswordGate` modal in ui.jsx (mounted in app.jsx),
`SecurityCard` in Settings.

**1.3 process blocking + evasion detection** — `browsers.rs`: `EVASION_BROWSERS` (9
conservative entries) + `is_standard_install_path`. `lib.rs::enforce_processes` rides the
existing 3s `start_monitor` tick: (a) kills `blocked_processes` on sight, (b) tiered evasion
detection (log always, kill only when `block_unknown_browsers` on). Never flags a browser
learned over the native host. Commands: `add/remove_blocked_process`, `set_block_unknown_
browsers`, `get_app_settings`. Renderer: `AppBlockingSection` replaces the coming-soon row.

## Lead review fixes applied on top of agent output
- `fmtDur` exported via `window.fmtDur` (each renderer file is its own Babel scope — bare
  cross-file refs would've been fragile); pages-monitor stop-countdown re-sourced from the
  shared `usePendingWeakenings` poll (survives navigation) instead of a local snapshot.
- **1.3 perf:** the portable-browser exe-path check forced a full `sysinfo` enumeration
  *every 3s* (a known browser is always open). Now gated to a `deep_scan` every ~10th tick
  (~30s); named evasion browsers (Tor etc.) still checked every tick. See `enforce_processes`.
- Merge conflict in the friction applier chain (4.2 + 1.3 both added arms) resolved as a union.

## Verification state
- `node extension/tests/run-all.cjs`: **559 passed / 0 failed** (extension untouched).
- Renderer transpile check (bundled Babel): **OK** on all `.jsx`/`.js`.
- Command audit: **40 `#[tauri::command]` fns ⇔ 40 `generate_handler!` entries**, exact match
  both directions. `enforce_processes` signature/call-site arity confirmed (6/6).
- **`cargo check` NOT run** (hangs here; owner compiles manually). Compile risks, first run:
  1. **`argon2 = "0.5"`** (new dep, Cargo.lock needs regen): confirm default features pull
     `password-hash` + `rand` so `password_hash::rand_core::OsRng` / `SaltString::generate`
     resolve. Also the prior `tauri-plugin-global-shortcut` Cargo.lock regen still pending.
  2. **`sysinfo 0.30`** APIs used in `enforce_processes`: `ProcessRefreshKind::new()`,
     `.with_exe(UpdateKind::OnlyIfNotSet)`, `Process::kill()->bool`, `Process::exe()->Option<&Path>`,
     `Process::name()->&str` (agent verified against vendored 0.30.13).
  3. Session-2 risks still open: `windows = "0.61"` (overlay.rs `SetWindowDisplayAffinity`),
     `tauri-plugin-global-shortcut` `event.state()` accessor-vs-field.

## Not done / next session
- **Visual pass NOT done** (owner declined the browser drive this session). Memory rule stands:
  render Settings (SecurityCard, PendingChangesCard, PasswordGate modal), Blocking
  (AppBlockingSection), Blocklist/Monitor pending notes — before trusting them. Serve the
  `desktop-app/src/renderer` folder over http (Babel-standalone can't load JSX over file://).
- One agent worktree dir under `.claude/worktrees/` was lock-held at cleanup and may need a
  manual `git worktree remove --force` / rmdir.
- TODO(5.4) urge-log markers still sit in the panic flow. Remaining third: A.1/A.2, 1.1/1.2,
  3.5, then Alpha opens 4.4/4.5/5.2.
