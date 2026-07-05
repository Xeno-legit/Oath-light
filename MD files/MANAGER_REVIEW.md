# Manager Review — Pure Path (Phase 4 checkpoint)

**Date:** 2026-07-05 · **Branch:** `phase4/friction` · **Scope:** master plan, desktop app, extension, themes, AI layer.

---

## Verdict in one paragraph

The project is in genuinely good shape: the architecture (deterministic blocklist first, AI only on the residual) is the right one and is backed by real measurements, the Rust code is small and well-commented, and the friction systems are thoughtfully designed. The gaps are not in design — they are in **hardening the friction systems against the user themself** (two easy bypasses exist today), **stale/missing automated testing**, and **finishing the AI actuator**, which is currently a sensor with no hands. Nothing reviewed is dangerously over-complicated; the one real monolith is `extension/background.js`.

---

## 1. What's working well (keep doing this)

- **AI_PLAN.md is the best document in the repo.** Eval-driven decisions, honest accuracy tables, an explicit "the AI never gets an irreversible actuator" rule, and a persistence-not-confidence escalation ladder. This is professional-grade reasoning; the mobile phase inherits it for free.
- **Watchdog design is clean** ([watchdog.rs](../desktop-app/src-tauri/src/watchdog.rs)): named-mutex liveness (survives hard kills, no cooperation needed), spawn cooldown, single-instance guard, dev kill switch. Small Win32 FFI surface, no extra deps.
- **Uninstall friction is simple and correct** ([uninstall.rs](../desktop-app/src-tauri/src/uninstall.rs)): backend clock is the source of truth, state persisted outside the renderer, idempotent request.
- **The renderer is well-factored**: ~16 small files, one store, pages under ~400 lines each. No framework bloat.
- **Blocklist data is compiled into the binary** (`include_str!` in lib.rs) — extension and app can't drift apart on the core lists.

---

## 2. Critical gaps (fix before Alpha)

### 2.1 The friction systems can be bypassed by their own target user

Phase 4's whole premise is that the adversary is *the user at a weak moment*. Two doors are open:

1. **Watchdog kill switch is a plain temp file.** Writing `%TEMP%\purepath.watchdog.shutdown` (one PowerShell line, or any "how to remove Pure Path" forum post) stands the entire tamper-resistance down. Fine as a dev escape hatch; in release builds it should only be honored when the uninstall cool-off has actually elapsed (the `UninstallStore` already knows), or be removed entirely.
2. **`PUREPATH_UNINSTALL_SECS` env override** (uninstall.rs:22) lets anyone set the 24-hour timer to 1 second. Same story: keep it in debug builds, compile it out of release.
3. **The timer is still on the 10-minute testing value** (`DEFAULT_DELAY_SECS = 10 * 60`, uninstall.rs:20). The comment says so, but this is exactly the kind of value that ships by accident. Suggest: make release builds fail to compile or loudly warn unless it's 24h (e.g. a `#[cfg(debug_assertions)]` pair of constants instead of a comment).

Also worth noting honestly in docs: `uninstall.json` and the registry Run key are user-writable, and the watchdog pair dies if both processes are killed within one poll tick (the code already documents this). Friction ≠ security — that's fine, but the *cheap* bypasses above should cost more than one shell command.

### 2.2 CI is stale and almost certainly failing (or validating nothing)

[.github/workflows/test.yml](../.github/workflows/test.yml) checks `manifest.json`, `blocklists/domains.json`, `setup.html` **at the repo root** — everything moved to `extension/` long ago, `domains.json` became `domains_part1-3.json`, and `setup.html` doesn't exist. So the one automated check the project has is testing a repo layout from Phase 1. Fix the paths, and while there:
- add `cargo check` (or `cargo clippy`) for `src-tauri`, `guardian`, and `native-host`;
- run the existing `MD files/cjs files/test-*.cjs` adversarial tests in CI instead of leaving them as one-off scripts.

### 2.3 The highest-risk code has no unit tests

`shouldBlockUrl` + the keyword/confusable/punycode pipeline in `background.js` (~1,900 lines of matching logic) is where every false positive/negative regression will come from — the project already lived through a Phase 1 false-positive crisis. The adversarial `.cjs` scripts exist; promote them into a real test suite that runs on every push. Same for `UninstallStore` state transitions (pure functions, trivial to test).

---

## 3. What's missing (plan-level)

1. **The AI action layer** — by AI_PLAN's own words the model is "a sensor with no actuator." Roadmap items 8–11 (blur actuator, foreground-window attribution, context gate, multi-monitor capture) *are* the remaining Phase 4 engineering. Suggest ordering: **attribution (9) → actuator (8) → context gate (11) → multi-monitor (10)** — attribution is the shared primitive the other three consume.
2. **Extension monitoring** is listed "in progress" in the master plan but the enforcement story for "user disables the extension" isn't written down anywhere reviewed. The native-messaging heartbeat exists; what happens on prolonged silence (nag? reinstall prompt? count as tamper?) needs a decision, like §8 did for the AI.
3. **"Blocking desktop apps (Discord, etc.)"** has no design note at all. It's a Phase 4 bullet but is a different mechanism from everything built so far (process watching / firewall, not web). Either write its mini-plan or explicitly punt it to Phase 5 — right now it's a silent scope risk.
4. **Master plan has no acceptance criteria.** Phases are checklists of features, not definitions of done. Phase 4 especially: "Pre-Alpha launch test — pushing the app to its absolute limits" — what limits, measured how? One paragraph per phase ("done when…") would keep scope honest. Also "Open Beta (soon)" has been dangling under the *completed* Phase 3 — either date it or move it.
5. **A crash/error reporting decision.** For an app whose job is to *stay running*, you currently have no way to learn it's crashing on someone's machine. Even opt-in local log collection ("copy diagnostics" button) beats nothing — full telemetry conflicts with the privacy stance, a local bundle doesn't.
6. **Uninstall completion path:** `launch_uninstaller` runs registry uninstall strings via `cmd /C` — fine, but the flow should call `watchdog::request_shutdown()` + `unregister_autostart()` first (verify this wiring in lib.rs), or the guardian will fight the uninstaller.

---

## 4. Over-complication check (asked directly, answered directly)

**Mostly no — the codebase is leaner than average.** Specific calls:

| Area | Verdict |
|---|---|
| `watchdog.rs` raw Win32 FFI | **Keep.** 4 FFI functions vs. pulling the whole `windows` crate — right trade. |
| Hand-rolled punycode decoder in background.js (~80 lines) | **Justified** — browsers expose no decode API and it feeds the confusable check. Deserves its own file + tests, not removal. |
| `extension/background.js` (2,657 lines, one file) | **The one real monolith.** MV3 supports `"type": "module"` service workers — split into `matching.js`, `graylist.js`, `native-bridge.js`, `reminders.js`. Mechanical, low-risk, makes the code testable (see §2.3). |
| `tweaks-panel.jsx` (541 lines) vs `pages-themes.jsx` | **Duplication by design** ("mirrors the Tweaks panel") — two UIs writing the same display state. Acceptable now; if they drift once more, delete one. The `window.__setDisplayTweak` global works but is the fragile point. |
| No-bundler React via `window.*` globals | Fine at 16 files. If the renderer keeps growing, adopt Vite *before* it hurts, not after. |
| Themes: 6 palettes × 7 atmospheres × intensity slider | **Not over-built** — it's cheap CSS/canvas state, and "vibe" is a stated Phase 3 product goal for an anti-addiction app. No action. |
| 3-part `domains_partN.json` split | Slightly awkward but presumably a file-size constraint; harmless. |

---

## 5. Recommended order of work

1. **Close the two friction bypasses** (release-gate the sentinel + env override, restore the 24h constant behind `cfg(debug_assertions)`). — *hours*
2. **Fix CI paths; add cargo check + adversarial .cjs tests to CI.** — *hours*
3. **Split background.js into modules and put unit tests around `shouldBlockUrl`/keyword matching.** — *1–2 days, de-risks everything after*
4. **Build the AI actuator chain** (attribution → blur ladder → context gate → multi-monitor), per AI_PLAN roadmap. — *the real Phase 4 milestone*
5. **Write the missing mini-designs**: extension-disable enforcement, desktop-app blocking (or punt it), phase acceptance criteria.
6. Then the Pre-Alpha full-scale test has something worth testing.
