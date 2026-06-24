//! Dual-process watchdog (Phase 4 tamper resistance).
//!
//! Two processes guard each other:
//!   * the **main** desktop app (`app.exe`), and
//!   * a hidden, windowless **guardian** — the *same* `app.exe` relaunched with
//!     the `--watchdog` flag (so no second binary to build, sign, or co-locate).
//!
//! Each role owns a **named mutex** for its entire lifetime. The *existence* of
//! that mutex is the liveness signal: Windows destroys the named object the
//! instant the last handle closes, which happens even on a hard
//! `TerminateProcess` — i.e. a Task Manager "End task". No graceful-shutdown
//! cooperation is required, which is the whole point of a tamper-resistance
//! watchdog. When one role notices the *other* role's mutex has vanished, it
//! relaunches it:
//!
//!   * main closed     -> guardian relaunches `app.exe`
//!   * guardian closed -> main relaunches `app.exe --watchdog`
//!
//! The same mutexes double as a single-instance guard per role, so a relaunch
//! can never pile up duplicates: a redundant spawn fails to acquire the mutex
//! and exits immediately.
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
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    /// How often each role checks whether its counterpart is still alive.
    const POLL: Duration = Duration::from_millis(1000);
    /// Minimum gap between relaunch attempts, so a counterpart that keeps
    /// failing to come up can't trigger a tight spawn loop.
    const SPAWN_COOLDOWN: Duration = Duration::from_secs(3);
    /// After relaunching, wait up to this long for the new process to register
    /// its own mutex before resuming normal polling (prevents a double-spawn
    /// during the brief window before it grabs the mutex).
    const COME_UP_TIMEOUT: Duration = Duration::from_secs(5);

    /// Session-namespace named mutexes (shared across the user's interactive
    /// session; no `Global\` prefix, so no privilege requirements). The `.v1`
    /// suffix lets us rev the protocol without colliding with stale objects.
    const MAIN_MUTEX: &str = "PurePath.Watchdog.Main.v1";
    const GUARDIAN_MUTEX: &str = "PurePath.Watchdog.Guardian.v1";

    /// Argv flag selecting guardian mode (kept in sync with `main.rs`).
    const WATCHDOG_ARG: &str = "--watchdog";

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Role {
        Main,
        Guardian,
    }

    impl Role {
        /// The mutex this role holds for its own lifetime.
        fn own_mutex(self) -> &'static str {
            match self {
                Role::Main => MAIN_MUTEX,
                Role::Guardian => GUARDIAN_MUTEX,
            }
        }
        /// The role this one is responsible for resurrecting.
        fn counterpart(self) -> Role {
            match self {
                Role::Main => Role::Guardian,
                Role::Guardian => Role::Main,
            }
        }
    }

    // ---- Win32 FFI (kernel32) — just the four calls we need, no new deps. ----

    type Handle = *mut std::ffi::c_void;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    /// `CreateProcess` flag: don't create or inherit a console window, so the
    /// guardian stays hidden even from a debug (console-subsystem) build.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    extern "system" {
        fn CreateMutexW(attr: *const std::ffi::c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn OpenMutexW(desired_access: u32, inherit_handle: i32, name: *const u16) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetLastError() -> u32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Create-and-hold the named mutex for this role. Returns the handle (which
    /// MUST stay open for the process's whole life) on success, or `None` if the
    /// mutex already exists — meaning another instance of this role is running
    /// and this process should bow out.
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

    /// Relaunch the given role from our own image (`current_exe`). The guardian
    /// is the same binary with `--watchdog`; the main app is the same binary
    /// with no flag. Spawned with CREATE_NO_WINDOW so the guardian is invisible,
    /// and detached (the OS does not kill children when we exit on Windows).
    fn spawn_role(role: Role) {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(e) => {
                log::error!("watchdog: cannot resolve current_exe to relaunch: {e}");
                return;
            }
        };
        let mut cmd = Command::new(exe);
        if role == Role::Guardian {
            cmd.arg(WATCHDOG_ARG);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn() {
            Ok(child) => log::info!(
                "watchdog: relaunched {} (pid {})",
                role_name(role),
                child.id()
            ),
            Err(e) => log::error!("watchdog: failed to relaunch {}: {e}", role_name(role)),
        }
    }

    fn role_name(role: Role) -> &'static str {
        match role {
            Role::Main => "main app",
            Role::Guardian => "guardian",
        }
    }

    // ---- Cross-process shutdown sentinel (the kill switch) -------------------

    /// Path of the sentinel file that authorizes a real shutdown. Both processes
    /// compute it identically from the per-user temp dir (no Tauri dependency).
    fn shutdown_sentinel() -> PathBuf {
        std::env::temp_dir().join("purepath.watchdog.shutdown")
    }

    /// Authorize a legitimate shutdown: drop the sentinel so every guard loop
    /// stops resurrecting and lets the processes exit. (Hook for the future
    /// uninstall-friction flow, and the manual kill switch during testing.)
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

    // ---- The guard loop ------------------------------------------------------

    /// Watch the counterpart role and relaunch it whenever its mutex vanishes,
    /// until shutdown is authorized or `stop` is set. Blocks the calling thread.
    fn guard_loop(my_role: Role, stop: Arc<AtomicBool>) {
        let target = my_role.counterpart();
        let target_mutex = target.own_mutex();
        log::info!("watchdog: {} guarding {}", role_name(my_role), role_name(target));

        // Allow an immediate first spawn (no artificial startup delay).
        let mut last_spawn = Instant::now()
            .checked_sub(SPAWN_COOLDOWN)
            .unwrap_or_else(Instant::now);

        while !stop.load(Ordering::Relaxed) {
            if shutdown_requested() {
                log::info!("watchdog: shutdown requested — {} standing down", role_name(my_role));
                break;
            }

            if !role_alive(target_mutex) && last_spawn.elapsed() >= SPAWN_COOLDOWN {
                log::warn!("watchdog: {} is gone — resurrecting", role_name(target));
                spawn_role(target);
                last_spawn = Instant::now();

                // Wait for it to register its mutex before resuming, so the next
                // tick doesn't read the brief startup gap as another death.
                let deadline = Instant::now() + COME_UP_TIMEOUT;
                while Instant::now() < deadline && !role_alive(target_mutex) {
                    std::thread::sleep(Duration::from_millis(200));
                }
            }

            std::thread::sleep(POLL);
        }
    }

    // ---- Public entry points -------------------------------------------------

    /// Whether the watchdog should run at all. On in release; in debug only when
    /// `PUREPATH_WATCHDOG=1`, so ordinary `cargo run` is never trapped in a
    /// resurrection loop. The env var propagates to relaunched processes because
    /// `Command` inherits the parent environment.
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
        match try_hold(MAIN_MUTEX) {
            Some(_h) => {
                // The handle is intentionally leaked: we never CloseHandle it, so
                // the OS keeps the mutex (our liveness signal) alive until this
                // process exits — which is exactly the lifetime we want.
            }
            None => {
                log::info!("watchdog: another main instance is already running — exiting");
                std::process::exit(0);
            }
        }

        clear_stale_sentinel();

        let stop = Arc::new(AtomicBool::new(false));
        std::thread::spawn(move || guard_loop(Role::Main, stop));
    }

    /// Entry point for guardian mode (`app.exe --watchdog`). Acquires the
    /// guardian-role mutex (exiting if one already exists — this is what makes a
    /// redundant guardian spawned by a relaunched main bow out), then runs the
    /// guard loop on this thread forever. Never starts Tauri, so it stays a
    /// hidden, windowless process.
    pub fn run_guardian() {
        if !enabled() {
            return;
        }
        match try_hold(GUARDIAN_MUTEX) {
            // Handle intentionally leaked (never closed) so the mutex lives for
            // this process's whole lifetime — see init_main for the rationale.
            Some(_h) => {}
            None => {
                // A guardian is already live; nothing for this one to do.
                return;
            }
        }

        let stop = Arc::new(AtomicBool::new(false));
        guard_loop(Role::Guardian, stop);
    }
}

#[cfg(windows)]
pub use imp::{init_main, request_shutdown, run_guardian};

// ---- Non-Windows: graceful no-ops (the app is Windows-first; see master plan).

#[cfg(not(windows))]
pub fn init_main() {}
#[cfg(not(windows))]
pub fn run_guardian() {}
#[cfg(not(windows))]
pub fn request_shutdown() {}
