//! Dual-process watchdog (Phase 4 tamper resistance).
//!
//! Two processes guard each other:
//!   * the **main** desktop app (`OathLight.exe`), and
//!   * a hidden, windowless **guardian** — a separate small binary,
//!     `oathlightguard.exe` (the `guardian` crate), so it shows up under its own
//!     name in Task Manager and never carries the heavy app with it.
//!
//! Each side owns a **named mutex** for its entire lifetime. The *existence* of
//! that mutex is the liveness signal: Windows destroys the named object the
//! instant the last handle closes, which happens even on a hard
//! `TerminateProcess` — i.e. a Task Manager "End task". No graceful-shutdown
//! cooperation is required, which is the whole point of a tamper-resistance
//! watchdog. When one side notices the other's mutex has vanished, it relaunches
//! it:
//!
//!   * guardian closed -> main relaunches `oathlightguard.exe`
//!   * main closed     -> guardian relaunches `OathLight.exe`
//!
//! Those same mutexes double as a single-instance guard per role, so a relaunch
//! can never pile up duplicates: a redundant spawn fails to acquire its mutex
//! and exits immediately. The matching guardian side lives in
//! `desktop-app/guardian/src/main.rs`; the two MUST agree on the mutex names,
//! the shutdown-sentinel path, AND the sentinel's *content* format (the
//! `uninstall.json` path — see the sentinel protocol note below).
//!
//! Limitation: if BOTH processes are killed within one poll interval, neither
//! survives to restart the other. Run-at-login plus the uninstall-friction
//! timer are the backstops for that case; a 2-process scheme cannot close it.
//!
//! Dev safety: disabled unless this is a release build or `OATHLIGHT_WATCHDOG=1`
//! is set, and a sentinel file (see `request_shutdown`) provides a kill switch
//! so closing the app during testing never traps you in a resurrection loop. In
//! a **release** build the sentinel alone is not trusted — a user could stand
//! down the whole watchdog just by hand-creating that file — so it is only
//! honored once the uninstall cool-off (`uninstall.rs`) has actually elapsed;
//! see `shutdown_requested` for the full reasoning.
//!
//! A duplicate launch of the **main** role (e.g. the desktop shortcut, while a
//! login-autostart or guardian-resurrected instance is already running hidden
//! in the tray) finds the main mutex held and exits — but before it does, it
//! signals a named auto-reset event so the already-running instance can surface
//! its window instead of the launch silently doing nothing. See `SHOW_EVENT`
//! and `start_show_listener`.

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    /// How often the main app checks that the guardian is still alive.
    const POLL: Duration = Duration::from_millis(1000);
    /// Minimum gap between relaunch attempts, so a guardian that keeps failing to
    /// come up can't trigger a tight spawn loop.
    const SPAWN_COOLDOWN: Duration = Duration::from_secs(3);
    /// After relaunching, wait up to this long for the new process to register
    /// its mutex before resuming normal polling (prevents a double-spawn during
    /// the brief window before it grabs the mutex).
    const COME_UP_TIMEOUT: Duration = Duration::from_secs(5);

    /// Session-namespace named mutexes (shared across the user's interactive
    /// session; no `Global\` prefix, so no privilege requirements). The `.v1`
    /// suffix lets us rev the protocol without colliding with stale objects.
    /// MUST match the guardian crate.
    const MAIN_MUTEX: &str = "OathLight.Watchdog.Main.v1";
    const GUARDIAN_MUTEX: &str = "OathLight.Watchdog.Guardian.v1";

    /// Session-namespace named auto-reset event: signaling it asks the
    /// currently-running **main** instance to surface its window. Written by a
    /// duplicate main launch that's about to bow out (mutex already held),
    /// consumed by `start_show_listener`'s background thread in the surviving
    /// instance. The guardian crate does not use this event at all — it is a
    /// main-to-main signal only, so there's nothing to keep in sync there.
    const SHOW_EVENT: &str = "OathLight.ShowWindow.v1";

    /// Guardian executable name (the `guardian` crate's `[[bin]]`).
    const GUARDIAN_BIN: &str = "oathlightguard.exe";
    /// Argument that tells the guardian which executable to relaunch as "main".
    const MAIN_ARG: &str = "--main";
    /// Argument carrying the full path to `uninstall.json`, so the guardian can
    /// independently verify the cool-off has elapsed before honoring the
    /// shutdown sentinel in a release build. MUST match the guardian crate.
    const UNINSTALL_JSON_ARG: &str = "--uninstall-json";

    /// Full path to `uninstall.json`, learned once the Tauri app data dir is
    /// known (see `set_uninstall_json_path`, called from `lib.rs`'s `setup()`).
    /// `init_main()` runs before that point, so this starts empty; both the
    /// release-build sentinel check and `spawn_guardian` treat "not yet known"
    /// the same as "unreadable" — see `shutdown_requested`.
    static UNINSTALL_JSON_PATH: OnceLock<PathBuf> = OnceLock::new();

    /// Record where `uninstall.json` lives, so the release-build sentinel check
    /// and guardian spawning can find it. Call once, from `lib.rs`'s `setup()`.
    pub fn set_uninstall_json_path(path: PathBuf) {
        let _ = UNINSTALL_JSON_PATH.set(path);
    }

    /// `CreateProcess` flag: don't create or inherit a console window, so the
    /// guardian stays hidden even from a debug (console-subsystem) build.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // ---- Win32 FFI (kernel32) — just the four calls we need, no new deps. ----

    type Handle = *mut std::ffi::c_void;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SYNCHRONIZE: u32 = 0x0010_0000;

    // Event-object access/wait constants for the show-window signal below.
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    const WAIT_OBJECT_0: u32 = 0;
    const INFINITE: u32 = 0xFFFF_FFFF;

    extern "system" {
        fn CreateMutexW(attr: *const std::ffi::c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn OpenMutexW(desired_access: u32, inherit_handle: i32, name: *const u16) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetLastError() -> u32;
        fn CreateEventW(attr: *const std::ffi::c_void, manual_reset: i32, initial_state: i32, name: *const u16) -> Handle;
        fn OpenEventW(desired_access: u32, inherit_handle: i32, name: *const u16) -> Handle;
        fn SetEvent(h: Handle) -> i32;
        fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Append a line to the shared watchdog log (kept alongside the guardian's,
    /// so both sides' events interleave in one timeline). Independent of the
    /// `log` crate, which isn't initialized this early in startup.
    fn wlog(msg: &str) {
        use std::io::Write;
        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let line = format!("{ms} main pid {} {msg}\n", std::process::id());
        let path = std::env::temp_dir().join("oathlight-watchdog.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// Create-and-hold the named mutex. Returns the handle (which MUST stay open
    /// for the process's whole life) on success, or `None` if the mutex already
    /// exists — meaning another instance of this role is running and this process
    /// should bow out.
    fn try_hold(name: &str) -> Option<Handle> {
        let wname = wide(name);
        // SAFETY: standard CreateMutexW call; wname is a valid NUL-terminated
        // UTF-16 buffer that outlives the call.
        let h = unsafe { CreateMutexW(std::ptr::null(), 0, wname.as_ptr()) };
        if h.is_null() {
            return None;
        }
        let already = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if already {
            unsafe { CloseHandle(h) };
            None
        } else {
            Some(h)
        }
    }

    /// True if *some* process currently holds (created) the named mutex — i.e.
    /// that role is alive. We open a transient handle purely to probe existence
    /// and close it immediately so we never keep the object alive ourselves.
    fn role_alive(name: &str) -> bool {
        let wname = wide(name);
        // SAFETY: OpenMutexW with a valid NUL-terminated name; handle closed at once.
        let h = unsafe { OpenMutexW(SYNCHRONIZE, 0, wname.as_ptr()) };
        if h.is_null() {
            false
        } else {
            unsafe { CloseHandle(h) };
            true
        }
    }

    /// Locate `oathlightguard.exe`: next to our own exe (production), then walking
    /// up the dev tree to `guardian/target/{debug,release}/`. Mirrors
    /// `resolve_host_binary` in lib.rs.
    ///
    /// A.1 workspace note: since `guardian` became a workspace member, `cargo
    /// build` deposits its binary in the shared `desktop-app/target/...`, not
    /// `desktop-app/guardian/target/...` — and because the main app is *also*
    /// built into that same shared dir, the very first candidate below
    /// (`exe_dir.join(GUARDIAN_BIN)`, i.e. "next to our own exe") now matches
    /// in a workspace dev build too, same as production. The old per-crate
    /// `guardian/target/...` candidates are kept (harmless — `.exists()` just
    /// fails) for anyone still holding a pre-workspace build tree, and the new
    /// `target/...` (workspace-root-relative) candidates are added so the
    /// search also succeeds if this exe is ever run from somewhere other than
    /// the shared target dir.
    fn resolve_guardian_binary() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_default();

        let mut candidates: Vec<PathBuf> = vec![exe_dir.join(GUARDIAN_BIN)];
        let mut dir = exe_dir.clone();
        for _ in 0..6 {
            candidates.push(dir.join("target").join("debug").join(GUARDIAN_BIN));
            candidates.push(dir.join("target").join("release").join(GUARDIAN_BIN));
            candidates.push(dir.join("guardian").join("target").join("debug").join(GUARDIAN_BIN));
            candidates.push(dir.join("guardian").join("target").join("release").join(GUARDIAN_BIN));
            if !dir.pop() {
                break;
            }
        }

        candidates
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| exe_dir.join(GUARDIAN_BIN))
    }

    /// Spawn the guardian, telling it our own path so it knows what to relaunch
    /// if we die. Hidden (CREATE_NO_WINDOW) and detached (Windows does not kill
    /// children when the parent exits).
    fn spawn_guardian() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let guardian = resolve_guardian_binary();
        if !guardian.exists() {
            log::error!("watchdog: guardian binary not found at {}", guardian.display());
            return;
        }
        let main_exe = std::env::current_exe().unwrap_or_default();

        let mut cmd = Command::new(&guardian);
        cmd.arg(MAIN_ARG).arg(&main_exe);
        // Pass the uninstall.json path along if we've learned it yet, so the
        // guardian can verify the cool-off itself (release builds only — see
        // `shutdown_requested`). Absent is a valid, safely-defaulting state.
        if let Some(p) = UNINSTALL_JSON_PATH.get() {
            cmd.arg(UNINSTALL_JSON_ARG).arg(p);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.spawn() {
            Ok(child) => log::info!("watchdog: launched guardian (pid {})", child.id()),
            Err(e) => log::error!("watchdog: failed to launch guardian {}: {e}", guardian.display()),
        }
    }

    // ---- Cross-process shutdown sentinel (the kill switch) -------------------
    //
    // Sentinel protocol (MUST match the guardian crate):
    //   * path    — `%TEMP%\oathlight.watchdog.shutdown`, computed identically on
    //               both sides from the per-user temp dir (no Tauri dependency);
    //   * content — the full UTF-8 path to `uninstall.json`, so the release-build
    //               cool-off verification can travel *with* the authorization and
    //               does not depend on a guardian having been spawned late enough
    //               to receive `--uninstall-json`. Empty content = "path unknown"
    //               and release readers default-deny (see `shutdown_requested`).

    /// Path of the sentinel file that authorizes a real shutdown. Both processes
    /// compute it identically from the per-user temp dir (no Tauri dependency).
    /// MUST match the guardian crate.
    fn shutdown_sentinel() -> PathBuf {
        std::env::temp_dir().join("oathlight.watchdog.shutdown")
    }

    /// Path of the sentinel that authorizes a stand-down for an *update*
    /// (`update.rs`). Deliberately a second file rather than a second meaning
    /// for the shutdown sentinel: the two carry different payloads, expire on
    /// different rules, and are cleared by different code paths, and folding
    /// them together would make every reader guess which kind it was looking
    /// at. Content is the full UTF-8 path to `update.json`, mirroring the
    /// shutdown sentinel's protocol exactly so the guardian — which may have
    /// been spawned before the app knew any paths — can locate and verify the
    /// window itself. MUST match the guardian crate.
    fn update_sentinel() -> PathBuf {
        std::env::temp_dir().join("oathlight.watchdog.update")
    }

    /// Open an update stand-down: point the sentinel at `update_json` so both
    /// processes stop resurrecting each other and both binaries unlock. The
    /// window in that file is what actually authorizes it — this file only says
    /// where to look, so a hand-created empty sentinel authorizes nothing.
    pub fn request_update_standdown(update_json: &Path) {
        let p = update_sentinel();
        let content = update_json.to_string_lossy().into_owned();
        if let Err(e) = std::fs::write(&p, content.as_bytes()) {
            log::warn!("watchdog: could not write update sentinel {p:?}: {e}");
        } else {
            log::info!("watchdog: update stand-down authorized via {p:?}");
        }
    }

    /// Drop the update sentinel. Called when an update is cancelled, and
    /// unconditionally from `init_main` — see the call site for why a fresh
    /// main starting is proof the window is over.
    pub fn clear_update_standdown() {
        let _ = std::fs::remove_file(update_sentinel());
    }

    /// Whether an update stand-down is currently authorized.
    ///
    /// Unlike the shutdown sentinel, this behaves identically in debug and
    /// release: the file is never trusted on its own in either build, because
    /// the thing that bounds this — the one-minute window in `update.json`,
    /// re-validated on every read by `update::window_active_at` — is the whole
    /// safety argument. A stale sentinel left behind by an interrupted update
    /// therefore stops authorizing anything the moment its window expires, with
    /// no cleanup required from anyone.
    fn update_standdown_active() -> bool {
        match std::fs::read_to_string(update_sentinel()) {
            Ok(content) if !content.trim().is_empty() => {
                crate::update::window_active_at(Path::new(content.trim()))
            }
            _ => false,
        }
    }

    /// Authorize a legitimate shutdown: drop the sentinel so both sides stop
    /// resurrecting and let the processes exit. (Hook for the uninstall-friction
    /// flow, and the manual kill switch during testing.)
    ///
    /// The sentinel's *content* is the `uninstall.json` path (from
    /// `UNINSTALL_JSON_PATH`), so a guardian that was spawned before `setup()`
    /// learned that path — i.e. the single long-lived guardian from the very
    /// first `init_main()` spawn, which never received `--uninstall-json` — can
    /// still recover the path from the sentinel and verify the cool-off in a
    /// release build. If the OnceLock is somehow unset (no legit path reaches
    /// here before `setup()` has run, but be defensive) we write an empty
    /// sentinel; release readers then default-deny, which is the safe outcome.
    pub fn request_shutdown() {
        let p = shutdown_sentinel();
        let content = UNINSTALL_JSON_PATH
            .get()
            .map(|u| u.to_string_lossy().into_owned())
            .unwrap_or_default();
        if let Err(e) = std::fs::write(&p, content.as_bytes()) {
            log::warn!("watchdog: could not write shutdown sentinel {p:?}: {e}");
        } else {
            log::info!("watchdog: shutdown authorized via {p:?}");
        }
    }

    /// Whether a shutdown is currently authorized.
    ///
    /// In a **debug** build this is just "does the sentinel file exist" — the
    /// unconditional dev kill switch, preserved on purpose so testing never
    /// traps you in a resurrection loop (see the module doc).
    ///
    /// In a **release** build the sentinel alone is not trusted: creating an
    /// empty file by hand is a one-click bypass of the entire watchdog, so the
    /// sentinel is only *honored* if the uninstall cool-off has actually
    /// elapsed, verified independently from `uninstall.json`
    /// (`uninstall::cooloff_elapsed_at`). If we don't know the path yet, or it's
    /// missing/unreadable/unparsable, that's treated as "not elapsed" —
    /// default-deny. This is deliberately safe rather than merely convenient:
    /// the only legitimate caller of `request_shutdown()` is the app's own
    /// uninstall flow (`complete_uninstall` in lib.rs), which is gated on
    /// `friction::FrictionStore::get("uninstall").ready` and therefore never
    /// fires before the cool-off has elapsed — so at the moment a legitimate
    /// shutdown happens, `uninstall.json` will show an elapsed request and
    /// this check passes.
    /// (This side reads the path from `UNINSTALL_JSON_PATH`, not from the
    /// sentinel content: any sentinel this process sees was written after
    /// `setup()` ran, so the OnceLock is always populated by then and the
    /// pre-`setup()` default-deny window is safe. The guardian, which can be
    /// spawned before `setup()`, is the side that also falls back to the
    /// sentinel content — see the guardian crate.)
    ///
    /// Residual, accepted weakness: `uninstall.json` is user-writable, so a
    /// determined user can hand-edit/backdate `requested_at` to fake an elapsed
    /// cool-off. Now that the sentinel *content* carries the path, they could
    /// also hand-craft their own fake `uninstall.json` anywhere, point the
    /// sentinel at it, and backdate `requested_at`. Either way that's still
    /// "understand the internals and hand-craft two files in the right formats"
    /// — the same accepted friction bar, not "create one empty file." This is
    /// friction, not security — see the doc on `uninstall::cooloff_elapsed_at`.
    fn shutdown_requested() -> bool {
        if !shutdown_sentinel().exists() {
            return false;
        }
        if cfg!(debug_assertions) {
            return true;
        }
        match UNINSTALL_JSON_PATH.get() {
            Some(path) => crate::uninstall::cooloff_elapsed_at(path),
            None => false,
        }
    }

    /// Called from `init_main`, before the guard loop starts. In a release
    /// build, decides whether a shutdown sentinel found on disk is a
    /// genuinely stale leftover from an interrupted/failed removal (safe to
    /// clear, so the app boots normally) or an ACTIVE authorization for a
    /// removal that's still in flight from a *different*, still-running
    /// instance (must NOT be cleared).
    ///
    /// The race this guards against: `perform_uninstall` (lib.rs) writes the
    /// sentinel, spawns a self-delete worker bounded to ~30-40s (see
    /// `uninstall.rs`'s `spawn_self_delete`), then exits the app ~2s later.
    /// If the user relaunches Oath Light during that window — the worker
    /// hasn't finished tearing things down yet, so a double-click on the
    /// desktop shortcut, or a stray autostart race, can start a fresh
    /// `init_main()` before the worker force-kills whatever's still running —
    /// the new instance's *unconditional* sentinel clear used to erase the
    /// very authorization the in-flight removal depends on:
    /// `shutdown_requested()` would then read "not authorized", the new
    /// instance would re-arm autostart / force-install policy (see `run()` in
    /// lib.rs), and the worker would force-kill it a few seconds later
    /// anyway — a pointless resurrection that briefly fights the teardown the
    /// user just asked for.
    ///
    /// Fix: before deleting, check whether the sentinel currently VERIFIES —
    /// same reasoning as `shutdown_requested`: in a release build that means
    /// reading the `uninstall.json` path the sentinel names and confirming
    /// `cooloff_elapsed_at` — AND the sentinel file's mtime is recent (within
    /// the last 5 minutes). `UNINSTALL_JSON_PATH` is NOT yet set this early in
    /// `init_main` (it's only learned once `lib.rs`'s `setup()` runs — see
    /// `set_uninstall_json_path`), so unlike `shutdown_requested` this can't
    /// read the path from that `OnceLock`; instead it reads the path straight
    /// from the sentinel file's own CONTENT, which is exactly the case
    /// `request_shutdown` writes that content for.
    ///
    /// If both hold, a removal is genuinely in flight: log a warning and exit
    /// immediately (`std::process::exit(0)`) rather than clearing the
    /// sentinel. Exiting — not clearing — is the correct move: clearing would
    /// de-authorize the original worker's kill (re-arming everything it's
    /// about to tear down anyway); exiting just quietly gets out of the
    /// worker's way without touching the sentinel, the worker, or anything
    /// else.
    ///
    /// If the sentinel doesn't verify, or its mtime is older than 5 minutes,
    /// it's genuinely stale (an interrupted/failed removal, a hand-crafted
    /// file, or clock skew we can't trust) and is cleared as before, letting
    /// the app boot normally. The 5-minute bound is what prevents this from
    /// ever bricking the app: the worker is bounded to ~40s, so 5 minutes
    /// safely covers every legitimate in-flight case, while a sentinel from a
    /// removal that never completed (interrupted, crashed, worker killed
    /// outright) still gets cleared on the very next launch instead of wedging
    /// the app in a permanent "can't start" state.
    ///
    /// Debug builds keep the old unconditional-clear behavior untouched, so
    /// developers are never trapped in a resurrection loop by this check.
    fn clear_stale_sentinel() {
        let p = shutdown_sentinel();
        if !p.exists() {
            return;
        }

        if !cfg!(debug_assertions) && sentinel_looks_active(&p) {
            wlog("shutdown sentinel looks ACTIVE (recent + verifying) - exiting instead of clearing");
            log::warn!(
                "watchdog: shutdown sentinel is recent and verifies an elapsed cool-off — a removal \
                 appears to be in flight from a relaunch; exiting quietly instead of clearing it"
            );
            std::process::exit(0);
        }

        let _ = std::fs::remove_file(&p);
    }

    /// Release-path helper for `clear_stale_sentinel`: true if the sentinel at
    /// `p` looks like an ACTIVE, in-flight removal rather than a stale
    /// leftover — its content names an `uninstall.json` whose cool-off has
    /// actually elapsed (the same check `shutdown_requested` performs, just
    /// reading the path from the sentinel's own content instead of
    /// `UNINSTALL_JSON_PATH`), AND the file's mtime is within the last 5
    /// minutes. See `clear_stale_sentinel`'s doc comment for the full
    /// reasoning; not used in debug builds (callers gate on
    /// `cfg!(debug_assertions)` first).
    fn sentinel_looks_active(p: &Path) -> bool {
        let recent = std::fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|mtime| mtime.elapsed().ok())
            .map(|age| age <= Duration::from_secs(5 * 60))
            .unwrap_or(false);
        if !recent {
            return false;
        }
        match std::fs::read_to_string(p) {
            Ok(content) if !content.trim().is_empty() => {
                crate::uninstall::cooloff_elapsed_at(Path::new(content.trim()))
            }
            _ => false,
        }
    }

    // ---- Login autostart (start in the background on boot) -------------------

    /// Per-user Run key: launches Oath Light at login without admin rights.
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_VALUE: &str = "OathLight";
    /// Argv flag marking a login-triggered launch (so we start minimized/out of
    /// the way rather than popping a window in the user's face on boot).
    const AUTOSTART_ARG: &str = "--autostart";

    /// `reg` command that never flashes a console window (mirrors browsers.rs).
    fn reg() -> std::process::Command {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("reg");
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    /// Scheduled-task name for the second, independent autostart registration
    /// (plan item 4.6). Named plainly on purpose — this is tamper *resistance*,
    /// not concealment, and a user auditing their own machine should be able to
    /// see exactly what Oath Light installed.
    const LOGON_TASK_NAME: &str = "OathLight Autostart";

    /// PowerShell single-quote escaping (double an embedded `'`) — mirrors the
    /// guardian crate's `ps_quote`.
    fn ps_quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }

    /// Run a PowerShell one-liner, windowless, and report whether it succeeded.
    ///
    /// Used for the logon task because `schtasks.exe` cannot register one from
    /// an unelevated process — see `register_logon_task`.
    fn run_powershell(script: &str) -> bool {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Second autostart registration, as a per-user logon Scheduled Task
    /// (plan item 4.6's "double-registration").
    ///
    /// Why two: the HKCU Run value is a single registry string that any user —
    /// or any "startup manager" utility, or Task Manager's own Startup tab —
    /// can delete in about four seconds, with no elevation and no friction.
    /// After that, the app simply never comes back on the next boot and the
    /// watchdog it would have started never runs. A logon task is a second,
    /// independent path with a completely different UI to find and remove, so
    /// deleting one leaves the other standing and the next launch re-asserts
    /// the missing one (both registrations are idempotent and run on every
    /// startup, so this self-heals).
    ///
    /// Honest scope note, so nobody reads more into this than it does: this
    /// registers a normal ONLOGON task at the default run level, which needs
    /// no admin rights. It does NOT survive Windows **Safe Mode** — Safe Mode
    /// starts neither Run-key entries nor ordinary scheduled tasks, and
    /// covering it would need a service registered under the `SafeBoot` keys,
    /// which requires elevation. That gap is documented in SECURITY.md rather
    /// than papered over here.
    /// Registered through the Task Scheduler COM API (via PowerShell's
    /// `Register-ScheduledTask`), **not** `schtasks.exe`.
    ///
    /// This is the fix for a bug that silently disabled half of 4.6's
    /// double-registration for the entire life of the feature.
    /// `schtasks.exe /create` refuses to create ANY task from an unelevated
    /// process — it fails with `ERROR: Access is denied.` regardless of the
    /// flags, including with an explicit `/ru <current user> /it`. The app runs
    /// unelevated in normal operation, so this function's old implementation
    /// could only ever take its failure branch: the log line said "logon task
    /// registration failed (Run key still active)" on every single launch, and
    /// the second registration this feature exists to provide never existed on
    /// any user's machine. Verified empirically, not inferred: on a stock
    /// Windows 11 install, `schtasks /create /sc onlogon` is denied unelevated
    /// while `Register-ScheduledTask` with the same trigger succeeds.
    ///
    /// The COM API has no such restriction for a task scoped to the *current*
    /// user, which is exactly the task we want. `-Force` overwrites, so this
    /// stays idempotent and self-healing across an app move or upgrade, just as
    /// the old `/f` intended.
    ///
    /// The battery settings are deliberate: Task Scheduler's defaults refuse to
    /// start a task on battery power and stop one when a laptop unplugs, which
    /// on exactly the machines that matter most would have made this autostart
    /// path quietly conditional on the charger being in.
    fn register_logon_task(exe: &std::path::Path) {
        let script = format!(
            "$a = New-ScheduledTaskAction -Execute {exe} -Argument {arg}; \
             $t = New-ScheduledTaskTrigger -AtLogOn -User \"$env:USERDOMAIN\\$env:USERNAME\"; \
             $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries \
                  -DontStopIfGoingOnBatteries -StartWhenAvailable \
                  -ExecutionTimeLimit ([TimeSpan]::Zero); \
             Register-ScheduledTask -TaskName {task} -Action $a -Trigger $t \
                  -Settings $s -Force | Out-Null",
            exe = ps_quote(&exe.display().to_string()),
            arg = ps_quote(AUTOSTART_ARG),
            task = ps_quote(LOGON_TASK_NAME),
        );
        if run_powershell(&script) {
            log::info!("autostart logon task registered: {LOGON_TASK_NAME}");
        } else {
            // Not fatal: the Run key is still registered, and a machine with
            // the Task Scheduler service disabled is a legitimate (if odd)
            // configuration. One path is the baseline, two is the goal.
            log::warn!("autostart logon task registration failed (Run key still active)");
        }
    }

    /// Remove the logon Scheduled Task. Silent about failure — being absent is
    /// the desired end state, and "it wasn't there" is not an error.
    ///
    /// Uses the COM API for the same reason `register_logon_task` does: a task
    /// registered by an unelevated process is removable by one, but
    /// `schtasks.exe /delete` inherits the same access denial as `/create`.
    fn unregister_logon_task() {
        let script = format!(
            "Unregister-ScheduledTask -TaskName {task} -Confirm:$false \
             -ErrorAction SilentlyContinue",
            task = ps_quote(LOGON_TASK_NAME),
        );
        let _ = run_powershell(&script);
    }

    /// Register Oath Light to start at user login, through BOTH the HKCU Run
    /// key and a logon Scheduled Task (4.6). Idempotent — `/f` overwrites in
    /// both cases, so this also self-heals either entry (a moved exe, or one
    /// of the two deleted by hand) on every launch. The launch carries
    /// `--autostart` so it comes up minimized in the background.
    /// Tamper-resistance, like the watchdog: enforced, not a toggle.
    pub fn register_autostart() {
        let exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(e) => {
                log::warn!("autostart: cannot resolve current_exe: {e}");
                return;
            }
        };
        let data = format!("\"{}\" {}", exe.display(), AUTOSTART_ARG);
        let ok = reg()
            .args(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &data, "/f"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            log::info!("autostart registered: {data}");
        } else {
            log::warn!("autostart registration failed");
        }
        register_logon_task(&exe);
    }

    /// Remove BOTH login autostart registrations (called from the uninstall
    /// flow). Removal has to clear both, or an uninstalled app would come back
    /// at the next logon through whichever one was missed — which would read
    /// as malware, not tamper-resistance.
    pub fn unregister_autostart() {
        let _ = reg().args(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]).status();
        unregister_logon_task();
        log::info!("autostart entries removed (Run key + logon task)");
    }

    /// True if this process was started by the login autostart entry, so the
    /// caller should bring the window up minimized.
    pub fn launched_at_login() -> bool {
        std::env::args().skip(1).any(|a| a == AUTOSTART_ARG)
    }

    // ---- The guard loop (main side) ------------------------------------------

    /// Watch the guardian and relaunch it whenever its mutex vanishes, until
    /// shutdown is authorized (the sentinel kill switch). Runs on a background
    /// thread for the rest of the process's life.
    fn guard_loop() {
        log::info!("watchdog: main app guarding the guardian");

        // Allow an immediate first spawn (no artificial startup delay).
        let mut last_spawn = Instant::now()
            .checked_sub(SPAWN_COOLDOWN)
            .unwrap_or_else(Instant::now);

        loop {
            if shutdown_requested() {
                log::info!("watchdog: shutdown requested — main standing down");
                break;
            }
            // An update window stands the guard down too, but temporarily: keep
            // polling rather than breaking, so if the window expires with this
            // process somehow still alive (the user cancelled, or the installer
            // was never run) guarding simply resumes on the next tick instead of
            // being off for the rest of the session.
            if update_standdown_active() {
                std::thread::sleep(POLL);
                continue;
            }

            if !role_alive(GUARDIAN_MUTEX) && last_spawn.elapsed() >= SPAWN_COOLDOWN {
                log::warn!("watchdog: guardian is gone — resurrecting");
                wlog("guardian mutex gone - spawning guardian");
                spawn_guardian();
                last_spawn = Instant::now();

                // Wait for it to register its mutex before resuming, so the next
                // tick doesn't read the brief startup gap as another death.
                let deadline = Instant::now() + COME_UP_TIMEOUT;
                while Instant::now() < deadline && !role_alive(GUARDIAN_MUTEX) {
                    std::thread::sleep(Duration::from_millis(200));
                }
            }

            std::thread::sleep(POLL);
        }
    }

    // ---- Public entry points -------------------------------------------------

    /// Whether the watchdog should run at all. On in release; in debug only when
    /// `OATHLIGHT_WATCHDOG=1`, so ordinary `cargo run` is never trapped in a
    /// resurrection loop.
    pub fn enabled() -> bool {
        if !cfg!(debug_assertions) {
            return true;
        }
        std::env::var("OATHLIGHT_WATCHDOG").map(|v| v == "1").unwrap_or(false)
    }

    /// Called once at the very start of the main app, before the Tauri window is
    /// created. Acquires the main-role mutex (exiting if another main is already
    /// running), clears any stale shutdown sentinel, and spawns the background
    /// guard thread that keeps the guardian alive.
    pub fn init_main() {
        if !enabled() {
            return;
        }
        wlog("main starting");
        match try_hold(MAIN_MUTEX) {
            Some(_h) => {
                // The handle is intentionally leaked: we never CloseHandle it, so
                // the OS keeps the mutex (our liveness signal) alive until this
                // process exits — which is exactly the lifetime we want.
                wlog("acquired main mutex");

                // Create the show-window event now, before Tauri's setup() has
                // even run. This shrinks the race where a duplicate launch shows
                // up before `start_show_listener` is listening: the named event
                // object already exists at this point, so a duplicate's SetEvent
                // latches against the auto-reset event (initial_state = 0,
                // manual_reset = 0) and the listener thread will consume that
                // signal the moment it starts waiting, rather than the signal
                // being sent to nobody. The handle is intentionally leaked, same
                // idiom as the mutex above: it must stay open for the process's
                // whole life so the named object doesn't get destroyed under us.
                let wname = wide(SHOW_EVENT);
                // SAFETY: standard CreateEventW call; wname is a valid
                // NUL-terminated UTF-16 buffer that outlives the call.
                let h = unsafe { CreateEventW(std::ptr::null(), 0, 0, wname.as_ptr()) };
                if h.is_null() {
                    wlog("failed to create show-window event");
                }
            }
            None => {
                log::info!("watchdog: another main instance is already running — exiting");
                if launched_at_login() {
                    // An `--autostart` duplicate (login autostart, or a guardian
                    // resurrection that lost the mutex race) exists to run
                    // *hidden* — it must never pop the surviving instance's
                    // window in the user's face. Only a user-initiated launch
                    // (no flag, e.g. the desktop shortcut) signals for show.
                    wlog("another main already holds the mutex - autostart duplicate, exiting quietly");
                } else {
                    // Best-effort: tell the instance that's already running to
                    // surface its window, since this duplicate launch is about to
                    // silently vanish otherwise. Must never block the exit below.
                    let wname = wide(SHOW_EVENT);
                    // SAFETY: standard OpenEventW call; wname is a valid
                    // NUL-terminated UTF-16 buffer that outlives the call.
                    let h = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, wname.as_ptr()) };
                    if h.is_null() {
                        wlog("another main already holds the mutex - could not open show event - exiting");
                    } else {
                        unsafe {
                            SetEvent(h);
                            CloseHandle(h);
                        }
                        wlog("another main already holds the mutex - signaled show + exiting");
                    }
                }
                std::process::exit(0);
            }
        }

        clear_stale_sentinel();

        // An update stand-down is over the moment a main instance is up and
        // holding the mutex — either the installer finished and launched the
        // new build, or the recovery task brought the old one back. Clearing it
        // HERE rather than in `setup()` is load-bearing: `guard_loop` starts on
        // the next line and would otherwise spend the rest of the window
        // declining to guard, and `setup()` runs too late to prevent that.
        clear_update_standdown();

        std::thread::spawn(guard_loop);
    }

    /// Start a background thread that surfaces the main window whenever a
    /// duplicate main launch signals the show-window event (see `SHOW_EVENT` and
    /// `init_main`'s duplicate branch). No-op if the watchdog isn't enabled: the
    /// silent duplicate-exit this works around only happens when `init_main` is
    /// actually enforcing the single-instance mutex.
    ///
    /// `on_show` runs on this background thread, not the main/UI thread — that's
    /// fine here because Tauri v2's window methods (`show`/`unminimize`/
    /// `set_focus`) are thread-safe and don't require dispatching back onto a
    /// particular thread.
    pub fn start_show_listener<F: Fn() + Send + 'static>(on_show: F) {
        if !enabled() {
            return;
        }

        let wname = wide(SHOW_EVENT);
        // SAFETY: standard CreateEventW call; wname is a valid NUL-terminated
        // UTF-16 buffer that outlives the call. This normally just opens the
        // object `init_main` already created; passing CreateEventW (rather than
        // OpenEventW) here too means the listener still works even if it were
        // somehow started before `init_main` created the object.
        let h = unsafe { CreateEventW(std::ptr::null(), 0, 0, wname.as_ptr()) };
        if h.is_null() {
            wlog("start_show_listener: failed to create/open show-window event");
            return;
        }

        // The handle is intentionally leaked into the spawned thread: it must
        // stay open for as long as the thread is waiting on it, which is the
        // rest of the process's life, so there is no good point to close it.
        // Raw pointers aren't `Send`, so ferry it across as a `usize` (its bit
        // pattern is just an opaque HANDLE value, not something we dereference
        // on this side) and cast back once we're on the new thread.
        let h_bits = h as usize;
        std::thread::spawn(move || loop {
            let h = h_bits as Handle;
            // SAFETY: h is a valid event handle for the lifetime of this loop
            // (leaked above, never closed).
            let res = unsafe { WaitForSingleObject(h, INFINITE) };
            if res == WAIT_OBJECT_0 {
                on_show();
                // Auto-reset event: the wait above already consumed the signal,
                // so just loop back around to wait for the next one.
            } else {
                // Anything else (WAIT_FAILED, WAIT_ABANDONED, ...) means the
                // handle is broken; log once and stop instead of spinning.
                wlog("show-window listener: unexpected wait result, stopping");
                break;
            }
        });
    }
}

#[cfg(windows)]
pub use imp::{
    clear_update_standdown, enabled, init_main, launched_at_login, register_autostart,
    request_shutdown, request_update_standdown, set_uninstall_json_path, start_show_listener,
    unregister_autostart,
};

// ---- Non-Windows: graceful no-ops (the app is Windows-first; see master plan).

#[cfg(not(windows))]
pub fn enabled() -> bool {
    false
}
#[cfg(not(windows))]
pub fn init_main() {}
#[cfg(not(windows))]
pub fn request_shutdown() {}
#[cfg(not(windows))]
pub fn request_update_standdown(_update_json: &std::path::Path) {}
#[cfg(not(windows))]
pub fn clear_update_standdown() {}
#[cfg(not(windows))]
pub fn set_uninstall_json_path(_path: std::path::PathBuf) {}
#[cfg(not(windows))]
pub fn register_autostart() {}
#[cfg(not(windows))]
pub fn unregister_autostart() {}
#[cfg(not(windows))]
pub fn launched_at_login() -> bool {
    false
}
#[cfg(not(windows))]
pub fn start_show_listener<F: Fn() + Send + 'static>(_on_show: F) {}
