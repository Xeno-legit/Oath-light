//! 24-hour uninstall request (Phase 4 friction system).
//!
//! Removing Oath Light is meant to be a *deliberate* act, not an impulsive one.
//! A removal request opens a cool-off window during which blocking stays fully
//! functional. Once the window elapses, removal is only *unlocked* — it does
//! NOT fire on its own. The user still has to take an explicit, destructive
//! action (the "Remove Oath Light now" button, which calls `complete_uninstall`)
//! to actually tear anything down. Until then they can reset the timer or cancel
//! the request outright. The pending request is persisted to disk so it survives
//! an app restart *and* a wiped renderer `localStorage` — the renderer is
//! deliberately not trusted to hold friction state.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cool-off window before an uninstall can complete.
///
/// TESTING: currently **10 seconds** — intentionally tiny so the whole flow
/// (request → cool-off → ready → remove) can be exercised in one sitting.
/// Product-owner decision: this is NOT a bug; do not "fix" it without checking
/// with them first. Safe at this size because elapsing only *unlocks* the
/// explicit "Remove completely" action — nothing fires automatically. For
/// production set this back to 24 hours (`24 * 60 * 60`).
/// Overridable at runtime with `OATHLIGHT_UNINSTALL_SECS` (seconds) — **debug
/// builds only**, see `delay_secs` below.
const DEFAULT_DELAY_SECS: u64 = 10; // ← production: 24 * 60 * 60

/// Debug builds: honor `OATHLIGHT_UNINSTALL_SECS` so the cool-off can be dialed
/// down for manual testing. Release builds ignore the env var entirely and
/// always use `DEFAULT_DELAY_SECS` — otherwise a user could zero out the whole
/// friction timer with `set OATHLIGHT_UNINSTALL_SECS=1` and an impulsive uninstall
/// would face no cool-off at all, defeating the point of this module.
#[cfg(debug_assertions)]
pub(crate) fn delay_secs() -> u64 {
    std::env::var("OATHLIGHT_UNINSTALL_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_DELAY_SECS)
}

/// Release builds: no env override — see the doc comment on the debug variant.
#[cfg(not(debug_assertions))]
pub(crate) fn delay_secs() -> u64 {
    DEFAULT_DELAY_SECS
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// On-disk shape — a tiny JSON file in the app data dir. `pub(crate)` (and its
/// field) so `friction.rs` can read/write the same shape directly — see
/// `write_marker` below for why this file still exists at all now that
/// `friction::FrictionStore` owns the actual request state.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct Persisted {
    /// Unix seconds the request was made; `None` = no pending request.
    pub(crate) requested_at: Option<u64>,
}

/// What the renderer sees. The countdown is computed on the backend (the system
/// clock is the source of truth, not the JS clock).
#[derive(Debug, Clone, Serialize)]
pub struct UninstallState {
    /// Is there a pending uninstall request.
    pub requested: bool,
    /// Unix seconds the request was made (if any).
    pub requested_at: Option<u64>,
    /// The configured cool-off length.
    pub delay_secs: u64,
    /// Seconds elapsed since the request (0 when none).
    pub elapsed_secs: u64,
    /// Seconds left before removal unlocks (0 when ready / none).
    pub remaining_secs: u64,
    /// True once the cool-off has fully elapsed for a pending request.
    pub ready: bool,
}

/// Write `<app_data_dir>/uninstall.json` in the exact `Persisted` shape.
///
/// WHY this file still exists even though `friction::FrictionStore` is now
/// the actual source of truth for the uninstall request (it replaced the old
/// `UninstallStore` that used to live in this module): the release-build
/// watchdog's `shutdown_requested` check (`watchdog.rs`) and the separate
/// `guardian` crate both independently verify the cool-off by reading
/// `uninstall.json` straight off disk — deliberately, so neither depends on
/// this crate's in-memory state (see `cooloff_elapsed_at` below and the
/// watchdog module doc for why that independence matters). That two-reader
/// protocol must not change, so every place that used to own `requested_at`
/// directly (now `friction::FrictionStore`, keyed under the `"uninstall"`
/// action id) mirrors it here on every request/reset/cancel via this
/// function. `uninstall.json` is a mirrored marker for those two readers, not
/// the source of truth anymore.
pub(crate) fn write_marker(app_data_dir: &std::path::Path, requested_at: Option<u64>) {
    let path = app_data_dir.join("uninstall.json");
    let _ = std::fs::create_dir_all(app_data_dir);
    if let Ok(s) = serde_json::to_string_pretty(&Persisted { requested_at }) {
        let _ = std::fs::write(&path, s);
    }
}

/// Standalone reader for the watchdog: true if the persisted request at `path`
/// (an `uninstall.json`) both exists and has actually elapsed the cool-off,
/// straight off disk. Deliberately independent of `friction::FrictionStore`
/// (no shared mutex, no in-memory cache) so it reflects exactly what's on
/// disk *right now* — this is what the release-build shutdown-sentinel check
/// in `watchdog.rs` calls instead of duplicating the JSON shape there. The
/// guardian process (a separate crate with no dependency on this one)
/// re-implements the same reasoning with its own tiny hand-parser; keep the
/// two in sync.
///
/// Residual, accepted weakness: `uninstall.json` lives in the app data dir and
/// is plain user-writable JSON, so a determined user can hand-edit or backdate
/// `requested_at` to fake an elapsed cool-off. This module is friction, not
/// security — the point is raising the bar from "create one empty file" to
/// "understand the internals and edit two files by hand," not making it
/// impossible.
pub fn cooloff_elapsed_at(path: &std::path::Path) -> bool {
    let Some(s) = std::fs::read_to_string(path).ok() else {
        return false;
    };
    let Some(p) = serde_json::from_str::<Persisted>(&s).ok() else {
        return false;
    };
    match p.requested_at {
        Some(at) => now_secs().saturating_sub(at) >= delay_secs(),
        None => false,
    }
}

// ============================================================================
// Self-contained removal ("delete everything with it")
// ============================================================================
//
// Removal deliberately does NOT depend on the NSIS `uninstall.exe` the installer
// drops. That file (and its registry entry) can be destroyed out of band — e.g.
// the user runs Windows' normal "Uninstall" first, which deletes `uninstall.exe`
// but can't remove the *running* app (the watchdog resurrects it). After that
// the friction flow would have nothing to launch and could never remove itself.
//
// So instead we spawn a tiny detached batch that waits for our processes to
// exit, then deletes the install directory and the app-data directory itself.
// This works even when the installer's own uninstaller is long gone, and it is
// what makes the timer-driven removal actually finish.
//
// Not depending on `uninstall.exe` doesn't mean ignoring it: when it IS still
// present, the batch runs it (silently) first, once our processes are gone —
// that's the only thing that cleans up what the raw rmdirs can't reach (Start
// Menu / desktop shortcuts, the installer's registry state). The rmdirs then
// sweep whatever the uninstaller left (or everything, if it was missing).

/// Outcome of kicking off removal.
pub enum LaunchResult {
    /// A self-delete worker was spawned; the app should now close so it can
    /// delete the (then-unlocked) executables and data.
    Launched(String),
    /// Removal could not be started (e.g. couldn't resolve paths / spawn).
    NotFound,
}

/// Fixed executable image names the self-delete worker also waits on, besides
/// the main app's own exe name (added dynamically — see `wait_for_processes`).
/// MUST match the real binary names — the guardian `[[bin]]` and the native
/// host sidecar.
#[cfg(target_os = "windows")]
const OTHER_WAIT_PROCESSES: &[&str] = &["oathlightguard.exe", "oath-light-host.exe"];

/// Build the full list of image names the self-delete worker waits on: the
/// *current* process's own exe file name, plus the guardian and native-host
/// sidecars. Deliberately NOT a hardcoded `"OathLight.exe"` constant: the
/// installed binary is `OathLight.exe` (Tauri `productName`), but the Cargo
/// package is named `app`, so a loose `target/release/app.exe` run (or any
/// future rename) has a different exe file name — hardcoding the installed
/// name would silently break waiting/killing for every other build shape.
/// Deduped case-insensitively (Windows image names are compared
/// case-insensitively by `tasklist`/`taskkill` anyway) in case the current exe
/// happens to collide with one of the fixed names.
#[cfg(target_os = "windows")]
fn wait_for_processes(current_exe_name: &str) -> Vec<String> {
    let mut names = vec![current_exe_name.to_string()];
    for other in OTHER_WAIT_PROCESSES {
        if !names.iter().any(|n| n.eq_ignore_ascii_case(other)) {
            names.push(other.to_string());
        }
    }
    names
}

/// The Tauri app identifier (`tauri.conf.json` → `identifier`). Tauri's
/// `app_data_dir()` is always `<per-user data root>/<identifier>`, so a
/// genuine app-data dir's last path component MUST be exactly this.
#[cfg(target_os = "windows")]
const APP_IDENTIFIER: &str = "com.oathlight.desktop";

/// Number of `Normal` (non-root, non-prefix) path components in `path`. Used as
/// a cheap "is this suspiciously close to a drive root" guard — e.g. `C:\`
/// (0 normal components) is rejected, while `C:\OathLight` (1) or
/// `C:\Program Files\OathLight` (2) are accepted.
#[cfg(target_os = "windows")]
fn normal_component_count(path: &std::path::Path) -> usize {
    path.components()
        .filter(|c| matches!(c, std::path::Component::Normal(_)))
        .count()
}

/// Cheap belt-and-braces check: real Windows paths can never contain a
/// double-quote character. `spawn_self_delete` passes `install`/`data` to the
/// batch via `%OATHLIGHT_RM_INSTALL%`/`%OATHLIGHT_RM_DATA%` env vars wrapped in
/// literal double quotes (`"%OATHLIGHT_RM_INSTALL%"`); a value containing `"`
/// would break out of that quoting. Impossible for a genuine path, so refusing
/// it costs nothing.
#[cfg(target_os = "windows")]
fn path_is_batch_safe(path: &std::path::Path) -> bool {
    !path.to_string_lossy().contains('"')
}

/// Validate a candidate install directory before we ever let it near an
/// `rmdir /s /q`. Must be an absolute path, at least one normal path component
/// deep (rejects a bare drive root like `C:\`, but accepts a legitimate custom
/// install such as `D:\OathLight`), free of double quotes, and must actually
/// contain the running app's own exe file — the one file we know a genuine
/// install directory has. The exe-containment check is the real guard here;
/// the depth check only exists to catch a degenerate root path.
#[cfg(target_os = "windows")]
fn validate_install_dir(dir: &std::path::Path, current_exe_name: &str) -> bool {
    dir.is_absolute()
        && normal_component_count(dir) >= 1
        && path_is_batch_safe(dir)
        && dir.join(current_exe_name).is_file()
}

/// Validate a candidate app-data directory the same way. Must be absolute, at
/// least two components deep (Tauri's `app_data_dir()` is always a per-user
/// data root plus the identifier, so this is always deep — unlike the install
/// dir above, there is no legitimate shallow case here), free of double
/// quotes, and its last component must be the Tauri app identifier — exactly
/// what `app_data_dir()` always ends in. A path that merely looks plausible
/// but fails the identifier check is refused; there is no "close enough" here,
/// only a literal match.
#[cfg(target_os = "windows")]
fn validate_app_data_dir(dir: &std::path::Path) -> bool {
    dir.is_absolute()
        && normal_component_count(dir) >= 2
        && path_is_batch_safe(dir)
        && dir.file_name().and_then(|n| n.to_str()) == Some(APP_IDENTIFIER)
}

/// Spawn a detached worker that waits for Oath Light's processes to exit, runs
/// the NSIS `uninstall.exe` silently if it's still present (shortcuts + the
/// installer's own registry state only come off natively), then deletes the
/// install directory and the app-data directory — a self-contained uninstall
/// that needs no external uninstaller but uses one when it can. Returns
/// `Launched` once the
/// worker is running (the caller should then exit the app), or `NotFound` if it
/// couldn't be started (including: either path failed validation, in which case
/// nothing is written and nothing is touched).
///
/// `app_data_dir` is the Tauri per-user data dir (`uninstall.json` etc.). The
/// install dir is inferred from `current_exe()`, and so is the current exe's
/// own file name (fed into both validation and the wait/kill list — see
/// `wait_for_processes`), since it differs across build shapes (`OathLight.exe`
/// installed vs. `app.exe` for a loose `target/release` run). In debug builds
/// this is a no-op that returns `Launched` without wiping anything — deleting
/// your `target/` tree mid-`cargo run` is never what you want; real removal is
/// a release path.
///
/// The worker itself is a self-deleting batch script with a *bounded* wait: it
/// polls `tasklist` for our processes, but after ~30 seconds gives up waiting
/// and force-kills them with `taskkill /F`. This matters specifically for
/// `oath-light-host.exe` — that process is spawned and owned by the browser
/// over native messaging, not by us, and it does not exit just because the main
/// app and guardian did; without the bound this would spin forever with an
/// open browser. The force-kill is not trusted to be instantaneous or
/// complete, so after it the script re-checks `tasklist` for up to 5 more
/// bounded iterations before proceeding regardless — `taskkill /F` returning
/// doesn't guarantee the OS has finished tearing the process down, and this
/// gives it a little more bounded slack without risking an unbounded loop.
/// After that, the rmdirs are retried a few times in case something still has
/// a brief hold on a file (AV scan, Explorer preview, etc).
///
/// The install/data paths are deliberately NOT spliced into the script's text
/// as literal strings — they're passed via the `OATHLIGHT_RM_INSTALL` /
/// `OATHLIGHT_RM_DATA` environment variables on the spawned `cmd` process, and
/// the script only ever references them as `%OATHLIGHT_RM_INSTALL%` /
/// `%OATHLIGHT_RM_DATA%`. `cmd` expands `%...%` even inside double quotes, so a
/// path containing a literal `%` spliced directly into
/// `rmdir /s /q "{install}"` would get mangled before the delete ever ran; an
/// env-var reference is expanded exactly once to its verbatim value and is not
/// rescanned for further `%...%` pairs, which sidesteps both the `%`-mangling
/// and the `cmd /C` argument-quoting minefield entirely. `validate_install_dir`
/// / `validate_app_data_dir` additionally refuse any path containing a `"`,
/// which would otherwise break out of the quoting regardless of the above.
#[cfg(target_os = "windows")]
pub fn spawn_self_delete(app_data_dir: &std::path::Path) -> LaunchResult {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    // Debug: never nuke the dev build tree. Report success so the flow proceeds.
    if cfg!(debug_assertions) {
        log::warn!("self-delete skipped (debug build) — would wipe install + app data");
        return LaunchResult::Launched("debug-noop".to_string());
    }

    let current_exe = match std::env::current_exe().ok() {
        Some(p) => p,
        None => return LaunchResult::NotFound,
    };
    let current_exe_name = match current_exe.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.to_string(),
        None => return LaunchResult::NotFound,
    };
    let install_dir = match current_exe.parent().map(|d| d.to_path_buf()) {
        Some(d) => d,
        None => return LaunchResult::NotFound,
    };

    // Refuse to proceed at all unless both targets pass validation — no batch
    // file gets written and nothing is touched if either check fails.
    if !validate_install_dir(&install_dir, &current_exe_name) {
        log::error!("self-delete refused: install dir failed validation: {}", install_dir.display());
        return LaunchResult::NotFound;
    }
    if !validate_app_data_dir(app_data_dir) {
        log::error!("self-delete refused: app data dir failed validation: {}", app_data_dir.display());
        return LaunchResult::NotFound;
    }

    // Build the wait loop: block until every one of our images is gone from
    // tasklist, tracked with a single shared counter (see the note on cmd
    // semantics below — plain `set /a` line-by-line inside a goto loop is fine;
    // it's only multi-line `( ... )` blocks where `%var%` reads stale). The
    // process list is derived at runtime (see `wait_for_processes`), not
    // hardcoded, because the current exe's own file name varies by build.
    let processes = wait_for_processes(&current_exe_name);
    let mut checks = String::new();
    for name in &processes {
        checks.push_str(&format!(
            "tasklist /FI \"IMAGENAME eq {name}\" 2>nul | find /I \"{name}\" >nul\r\n\
             if not errorlevel 1 set FOUND=1\r\n"
        ));
    }
    let mut kills = String::new();
    for name in &processes {
        kills.push_str(&format!("taskkill /F /IM {name} >nul 2>nul\r\n"));
    }

    let install = install_dir.to_string_lossy().into_owned();
    let data = app_data_dir.to_string_lossy().into_owned();
    let script = format!(
        // `cd /d "%~dp0"` first: cmd inherits the app's working directory, which
        // on a normal shortcut launch is the install dir itself — and Windows
        // refuses to rmdir any process's current directory. Hop to the batch's
        // own dir (TEMP, outside both delete targets) before touching anything.
        //
        // `{checks}` is reused verbatim for both the initial wait loop and the
        // post-force-kill re-verify loop below (`:forcecheck`) — same lines,
        // different label to jump back to.
        "@echo off\r\n\
         cd /d \"%~dp0\"\r\n\
         set /a WAITN=0\r\n\
         \r\n\
         :waitloop\r\n\
         set FOUND=\r\n\
         {checks}\
         if not defined FOUND goto afterwait\r\n\
         set /a WAITN+=1\r\n\
         if %WAITN% GEQ 30 goto forcekill\r\n\
         ping -n 2 127.0.0.1 >nul\r\n\
         goto waitloop\r\n\
         \r\n\
         :forcekill\r\n\
         {kills}\
         ping -n 3 127.0.0.1 >nul\r\n\
         set /a FORCEN=0\r\n\
         \r\n\
         :forcecheck\r\n\
         set FOUND=\r\n\
         {checks}\
         if not defined FOUND goto afterwait\r\n\
         set /a FORCEN+=1\r\n\
         if %FORCEN% GEQ 5 goto afterwait\r\n\
         ping -n 2 127.0.0.1 >nul\r\n\
         goto forcecheck\r\n\
         \r\n\
         :afterwait\r\n\
         if not exist \"%OATHLIGHT_RM_INSTALL%\\uninstall.exe\" goto sweep\r\n\
         start \"\" /wait \"%OATHLIGHT_RM_INSTALL%\\uninstall.exe\" /S\r\n\
         ping -n 3 127.0.0.1 >nul\r\n\
         \r\n\
         :sweep\r\n\
         set /a RETRY=0\r\n\
         :deleteloop\r\n\
         rmdir /s /q \"%OATHLIGHT_RM_INSTALL%\" 2>nul\r\n\
         rmdir /s /q \"%OATHLIGHT_RM_DATA%\" 2>nul\r\n\
         if exist \"%OATHLIGHT_RM_INSTALL%\" goto retrydelete\r\n\
         if exist \"%OATHLIGHT_RM_DATA%\" goto retrydelete\r\n\
         goto selfdelete\r\n\
         \r\n\
         :retrydelete\r\n\
         set /a RETRY+=1\r\n\
         if %RETRY% GEQ 5 goto selfdelete\r\n\
         ping -n 2 127.0.0.1 >nul\r\n\
         goto deleteloop\r\n\
         \r\n\
         :selfdelete\r\n\
         (goto) 2>nul & del \"%~f0\"\r\n"
    );

    // Drop the batch in TEMP (outside the dirs we're about to delete) and run it
    // detached and windowless, so it outlives us and cleans up silently. The
    // filename carries our own pid rather than being static: a re-triggered
    // removal (the app exits ~2s into `perform_uninstall` but a previous
    // worker can still be running for up to ~40s, and a relaunch during that
    // window is possible) must never overwrite the batch file a still-running
    // cmd.exe from the earlier attempt is reading incrementally line-by-line.
    let bat = std::env::temp_dir().join(format!("oathlight-uninstall-{}.bat", std::process::id()));
    if std::fs::write(&bat, script).is_err() {
        return LaunchResult::NotFound;
    }
    match std::process::Command::new("cmd")
        .args(["/C", &bat.to_string_lossy()])
        // Belt and braces with the batch's own `cd /d "%~dp0"`: never let the
        // worker inherit a CWD inside a directory it is about to delete.
        .current_dir(std::env::temp_dir())
        // Paths travel via env vars, not spliced into the script text — see the
        // doc comment on this function for why.
        .env("OATHLIGHT_RM_INSTALL", &install)
        .env("OATHLIGHT_RM_DATA", &data)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
    {
        Ok(_) => LaunchResult::Launched(install),
        Err(_) => LaunchResult::NotFound,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_self_delete(app_data_dir: &std::path::Path) -> LaunchResult {
    // macOS/Linux: best-effort delete of the app-data dir; the app bundle itself
    // is left to the user's package manager / drag-to-trash.
    let _ = std::fs::remove_dir_all(app_data_dir);
    LaunchResult::Launched(app_data_dir.to_string_lossy().into_owned())
}
