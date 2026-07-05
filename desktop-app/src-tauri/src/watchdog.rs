//! Dual-process watchdog (Phase 4 tamper resistance).
//!
//! Two processes guard each other:
//!   * the **main** desktop app (`PurePath.exe`), and
//!   * a hidden, windowless **guardian** — a separate small binary,
//!     `purepathguard.exe` (the `guardian` crate), so it shows up under its own
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
//!   * guardian closed -> main relaunches `purepathguard.exe`
//!   * main closed     -> guardian relaunches `PurePath.exe`
//!
//! Those same mutexes double as a single-instance guard per role, so a relaunch
//! can never pile up duplicates: a redundant spawn fails to acquire its mutex
//! and exits immediately. The matching guardian side lives in
//! `desktop-app/guardian/src/main.rs`; the two MUST agree on the mutex names and
//! the shutdown-sentinel path below.
//!
//! Limitation: if BOTH processes are killed within one poll interval, neither
//! survives to restart the other. Run-at-login plus the uninstall-friction
//! timer are the backstops for that case; a 2-process scheme cannot close it.
//!
//! Dev safety: disabled unless this is a release build or `PUREPATH_WATCHDOG=1`
//! is set, and a sentinel file (see `request_shutdown`) provides a kill switch
//! so closing the app during testing never traps you in a resurrection loop.

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
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
    const MAIN_MUTEX: &str = "PurePath.Watchdog.Main.v1";
    const GUARDIAN_MUTEX: &str = "PurePath.Watchdog.Guardian.v1";

    /// Guardian executable name (the `guardian` crate's `[[bin]]`).
    const GUARDIAN_BIN: &str = "purepathguard.exe";
    /// Argument that tells the guardian which executable to relaunch as "main".
    const MAIN_ARG: &str = "--main";

    /// `CreateProcess` flag: don't create or inherit a console window, so the
    /// guardian stays hidden even from a debug (console-subsystem) build.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // ---- Win32 FFI (kernel32) — just the four calls we need, no new deps. ----

    type Handle = *mut std::ffi::c_void;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SYNCHRONIZE: u32 = 0x0010_0000;

    extern "system" {
        fn CreateMutexW(attr: *const std::ffi::c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn OpenMutexW(desired_access: u32, inherit_handle: i32, name: *const u16) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetLastError() -> u32;
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
        let path = std::env::temp_dir().join("purepath-watchdog.log");
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

    /// Locate `purepathguard.exe`: next to our own exe (production), then walking
    /// up the dev tree to `guardian/target/{debug,release}/`. Mirrors
    /// `resolve_host_binary` in lib.rs.
    fn resolve_guardian_binary() -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_default();

        let mut candidates: Vec<PathBuf> = vec![exe_dir.join(GUARDIAN_BIN)];
        let mut dir = exe_dir.clone();
        for _ in 0..6 {
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

        match Command::new(&guardian)
            .arg(MAIN_ARG)
            .arg(&main_exe)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(child) => log::info!("watchdog: launched guardian (pid {})", child.id()),
            Err(e) => log::error!("watchdog: failed to launch guardian {}: {e}", guardian.display()),
        }
    }

    // ---- Cross-process shutdown sentinel (the kill switch) -------------------

    /// Path of the sentinel file that authorizes a real shutdown. Both processes
    /// compute it identically from the per-user temp dir (no Tauri dependency).
    /// MUST match the guardian crate.
    fn shutdown_sentinel() -> PathBuf {
        std::env::temp_dir().join("purepath.watchdog.shutdown")
    }

    /// Authorize a legitimate shutdown: drop the sentinel so both sides stop
    /// resurrecting and let the processes exit. (Hook for the uninstall-friction
    /// flow, and the manual kill switch during testing.)
    pub fn request_shutdown() {
        let p = shutdown_sentinel();
        if let Err(e) = std::fs::write(&p, b"1") {
            log::warn!("watchdog: could not write shutdown sentinel {p:?}: {e}");
        } else {
            log::info!("watchdog: shutdown authorized via {p:?}");
        }
    }

    fn shutdown_requested() -> bool {
        shutdown_sentinel().exists()
    }

    fn clear_stale_sentinel() {
        let p = shutdown_sentinel();
        if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
    }

    // ---- Login autostart (start in the background on boot) -------------------

    /// Per-user Run key: launches Pure Path at login without admin rights.
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_VALUE: &str = "PurePath";
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

    /// Register Pure Path to start at user login. Idempotent — `/f` overwrites,
    /// so this also self-heals the entry (e.g. if the exe moved) on every launch.
    /// The launch carries `--autostart` so it comes up minimized in the
    /// background. Tamper-resistance, like the watchdog: enforced, not a toggle.
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
    }

    /// Remove the login autostart entry (called from the uninstall flow).
    pub fn unregister_autostart() {
        let _ = reg().args(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]).status();
        log::info!("autostart entry removed");
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
    /// `PUREPATH_WATCHDOG=1`, so ordinary `cargo run` is never trapped in a
    /// resurrection loop.
    pub fn enabled() -> bool {
        if !cfg!(debug_assertions) {
            return true;
        }
        std::env::var("PUREPATH_WATCHDOG").map(|v| v == "1").unwrap_or(false)
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
            }
            None => {
                log::info!("watchdog: another main instance is already running — exiting");
                wlog("another main already holds the mutex - exiting");
                std::process::exit(0);
            }
        }

        clear_stale_sentinel();

        std::thread::spawn(guard_loop);
    }
}

#[cfg(windows)]
pub use imp::{
    enabled, init_main, launched_at_login, register_autostart, request_shutdown,
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
pub fn register_autostart() {}
#[cfg(not(windows))]
pub fn unregister_autostart() {}
#[cfg(not(windows))]
pub fn launched_at_login() -> bool {
    false
}
