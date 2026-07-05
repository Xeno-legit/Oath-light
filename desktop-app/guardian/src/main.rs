//! Pure Path — watchdog guardian (`purepathguard.exe`).
//!
//! A hidden, windowless companion to the main desktop app. Half of the
//! dual-process watchdog (the other half lives in
//! `desktop-app/src-tauri/src/watchdog.rs`); the two MUST agree on the mutex
//! names and the shutdown-sentinel path below.
//!
//! This process holds the GUARDIAN mutex for its whole life and watches the MAIN
//! mutex. When the main app's mutex vanishes — including a hard Task Manager
//! "End task" — it relaunches the main app. The main app does the mirror image
//! for us, so neither can be killed from Task Manager without the other bringing
//! it back. Single-instance is enforced by the GUARDIAN mutex itself: a second
//! guardian (e.g. one spawned by a freshly resurrected main) finds the mutex
//! already held and exits immediately.
//!
//! No window, no console (Windows GUI subsystem), no dependencies — just std and
//! four kernel32 calls.

// No console window, ever — this is a hidden background process in every build.
#![windows_subsystem = "windows"]

#[cfg(windows)]
fn main() {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    // ---- Shared protocol constants (keep in sync with watchdog.rs) ----------
    const MAIN_MUTEX: &str = "PurePath.Watchdog.Main.v1";
    const GUARDIAN_MUTEX: &str = "PurePath.Watchdog.Guardian.v1";
    const MAIN_ARG: &str = "--main";
    /// Production name of the main executable, used only as a fallback when the
    /// spawner did not pass `--main` (it normally does).
    const MAIN_BIN: &str = "PurePath.exe";

    const POLL: Duration = Duration::from_millis(1000);
    const SPAWN_COOLDOWN: Duration = Duration::from_secs(3);
    const COME_UP_TIMEOUT: Duration = Duration::from_secs(5);

    // ---- Win32 FFI (kernel32) -----------------------------------------------
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

    /// Hold the named mutex for this process's whole life. `None` if it already
    /// exists (another guardian is running -> we should bow out).
    fn try_hold(name: &str) -> Option<Handle> {
        let wname = wide(name);
        // SAFETY: valid NUL-terminated UTF-16 name, outlives the call.
        let h = unsafe { CreateMutexW(std::ptr::null(), 0, wname.as_ptr()) };
        if h.is_null() {
            return None;
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { CloseHandle(h) };
            None
        } else {
            Some(h)
        }
    }

    /// True if some process currently holds the named mutex (that role is alive).
    fn role_alive(name: &str) -> bool {
        let wname = wide(name);
        // SAFETY: valid NUL-terminated name; transient handle closed at once.
        let h = unsafe { OpenMutexW(SYNCHRONIZE, 0, wname.as_ptr()) };
        if h.is_null() {
            false
        } else {
            unsafe { CloseHandle(h) };
            true
        }
    }

    // ---- Diagnostics: append a line to a shared watchdog log ----------------
    fn wlog(msg: &str) {
        use std::io::Write;
        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let line = format!("{ms} guardian pid {} {msg}\n", std::process::id());
        let path = std::env::temp_dir().join("purepath-watchdog.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    // ---- Shutdown sentinel (kill switch) ------------------------------------
    fn shutdown_requested() -> bool {
        std::env::temp_dir().join("purepath.watchdog.shutdown").exists()
    }

    // ---- Resolve which executable to relaunch as "main" ---------------------
    // Normally passed by the spawner as `--main <path>`; otherwise assume the
    // main exe sits next to us.
    fn resolve_main_exe() -> PathBuf {
        let mut args = std::env::args_os().skip(1);
        while let Some(a) = args.next() {
            if a == MAIN_ARG {
                if let Some(p) = args.next() {
                    return PathBuf::from(p);
                }
            }
        }
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .map(|d| d.join(MAIN_BIN))
            .unwrap_or_else(|| PathBuf::from(MAIN_BIN))
    }

    fn relaunch_main(main_exe: &Path) {
        match std::process::Command::new(main_exe).spawn() {
            Ok(_) => {}
            Err(_) => { /* nothing we can usefully log to; retry next cooldown */ }
        }
    }

    // ---- Run ----------------------------------------------------------------

    wlog("starting");

    // If a shutdown was authorized, do nothing (let the system come down).
    if shutdown_requested() {
        wlog("shutdown sentinel present at start - exiting");
        return;
    }

    // Single-instance: bow out if another guardian already holds the mutex.
    let _held = match try_hold(GUARDIAN_MUTEX) {
        // Intentionally leaked: never CloseHandle, so the mutex (our liveness
        // signal) lives until this process exits.
        Some(h) => h,
        None => {
            wlog("another guardian already holds the mutex - exiting");
            return;
        }
    };
    wlog("acquired guardian mutex - now guarding main");

    let main_exe = resolve_main_exe();
    let mut last_spawn = Instant::now()
        .checked_sub(SPAWN_COOLDOWN)
        .unwrap_or_else(Instant::now);

    loop {
        if shutdown_requested() {
            return;
        }

        if !role_alive(MAIN_MUTEX) && last_spawn.elapsed() >= SPAWN_COOLDOWN {
            wlog(&format!("main mutex gone - relaunching {}", main_exe.display()));
            relaunch_main(&main_exe);
            last_spawn = Instant::now();

            // Wait for the new main to register its mutex before resuming, so the
            // next tick doesn't read the startup gap as another death.
            let deadline = Instant::now() + COME_UP_TIMEOUT;
            while Instant::now() < deadline && !role_alive(MAIN_MUTEX) {
                std::thread::sleep(Duration::from_millis(200));
            }
        }

        std::thread::sleep(POLL);
    }
}

#[cfg(not(windows))]
fn main() {
    // Windows-first (see master plan); the guardian is a no-op elsewhere.
}
