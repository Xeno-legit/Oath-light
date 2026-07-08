# Handoff — Frontier Plan partial implementation (updated 2026-07-08, session 2)

Branch: `phase4/friction` (still carries ~626 lines of pre-session friction work — do not revert).
Nothing committed yet. Scope: Frontier Plan items 2.1, 2.2, 3.3, 3.4, 5.1 + Noir theme.

## Done, reviewed & verified (all of the original scope)

**Noir theme** — complete, mirrored everywhere (desktop styles.css, popup.css, blocklist desktop.css, theme-sync.js + blocked.js STYLES allowlists, app.jsx/store.js defaults).

**Items 2.1 + 2.2 (multi-monitor + AI action layer)** — complete, lead-reviewed line-by-line.
`screen.rs::capture_all`/`monitor_geometry`, per-monitor `MonitorTrack` HashMap in `run_monitor`, Clear→Suspect→Acting (3-of-5 window, 5-consecutive-clean de-escalate), `overlay.rs` (server-side 30s dwell gate, 5-min post-dismiss cooldown, `WDA_EXCLUDEFROMCAPTURE`), `overlay.html` (self-contained; now includes the inline panic-flow entry the 2.1 spec required — done deliberately inline instead of opening the main window, so SOS can't become a dismiss/bypass vector), `dismiss_overlay` command derives monitor id from the caller's window label.

**Item 3.3 (AI-erotica category)** — complete. `domains_ai.json` (86 domains, reviewed), 4th list part in extension loader + manifest + lib.rs `built_in_lists()`, `KEYWORD_COMPOUNDS_AI_EROTICA` + guarded `aicompanion` root with whitelist traps, 23 corpus tests (positives + trap negatives incl. tavernaithaki/bonsaicompanion).

**Item 3.4 (SafeSearch expansion)** — complete. Ecosia `safesearch=2` (plan's `sfsg` was wrong, corrected with comment), `isDirectImageCdn` (bing `/th`, yandex tub farm + avatars.mds path-gated), Startpage cookie-strip static DNR ruleset, opt-in YouTube-Restrict DNR ruleset (default OFF, `enabled:false` in manifest, pinned by test) toggled via `blockingSettings.youtubeRestrict` — desktop toggle in pages-blocking.jsx → store.js default → app.jsx blockingPayload (Rust side is opaque pass-through, no change needed). 22 new safesearch tests incl. DNR shape + manifest registration.

**Item 5.1 (panic/SOS button)** — complete (Sonnet agent, lead-reviewed line-by-line).
- Rust: `tauri-plugin-global-shortcut = "2"` (desktop-target section in Cargo.toml; Cargo.lock NOT updated — needs a cargo run), capabilities entries, plugin + `ctrl+shift+space` registered in setup (failure = warn, non-fatal), tray "I need help now" above "Open Pure Path", `open_panic` arm in `handle_extension_message`, `PANIC_PENDING` latch + `take_panic_pending` command for cold-start (login/tray-only) delivery.
- Renderer: `pages-panic.jsx` (breathing → wave → 5-4-3-2-1 → exit; Mentor copy verbatim; exit never auto-advances), registered in index.html/app.jsx PAGES, `open-panic` subscription + pending-drain, sidebar SOS nav item, `.panic-*` styles (all var() tokens, reduced-motion fallback).
- Extension: blocked.html "I need help right now" button + self-contained plain-JS 4-stage flow; deep-links desktop via `{action:'openPanic'}` → background.js → `NativeMessagingBridge.sendOpenPanic()` (fire-and-forget; in-page flow runs regardless).

## Verification state

- `node extension/tests/run-all.cjs`: **559 passed / 0 failed** across 6 suites (was 515).
- `node --check` green on all touched plain JS; all touched JSX transpiles under the app's bundled Babel; overlay.html inline script syntax-checked.
- **`cargo check` has NOT been run this session** — it hangs in this dev environment (owner runs it manually). Known compile risks to eyeball on first run:
  1. `windows = "0.61"` must match the version Tauri pulls (overlay.rs `SetWindowDisplayAffinity` — also confirm it returns `Result` in that version).
  2. `tauri-plugin-global-shortcut` handler: if `event.state()` doesn't compile, use `event.state` (public field vs accessor across versions).
  3. Cargo.lock needs regeneration for the new plugin dep.

## Not started (next session candidates)

- Item 4.1 generalized friction store (the keystone), A.1 workspace restructure — see Implementation Plan build order.
- Visual pass: Noir theme + overlay + panic flow have not been rendered/eyeballed (memory rule: visually test, not just logic).
- TODO(5.4) markers sit at both panic-flow completion points (urge log doesn't exist yet).
