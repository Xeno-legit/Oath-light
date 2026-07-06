//! Pure Path — watchdog guardian (`purepathguard.exe`).
//!
//! A hidden, windowless companion to the main desktop app. Half of the
//! dual-process watchdog (the other half lives in
//! `desktop-app/src-tauri/src/watchdog.rs`); the two MUST agree on the mutex
//! names, the shutdown-sentinel path, AND the sentinel's *content* format (the
//! `uninstall.json` path — see the sentinel protocol note below).
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
    /// Passed to a resurrected main app so it comes up hidden in the background
    /// (tray only) instead of popping a focused window in the user's face. MUST
    /// match `AUTOSTART_ARG` in `watchdog.rs` / the app's login-launch flag.
    const AUTOSTART_ARG: &str = "--autostart";
    /// Production name of the main executable, used only as a fallback when the
    /// spawner did not pass `--main` (it normally does).
    const MAIN_BIN: &str = "PurePath.exe";
    /// Argument carrying the full path to the main app's `uninstall.json`, so we
    /// can independently verify the uninstall cool-off before honoring the
    /// shutdown sentinel in a release build. MUST match `watchdog.rs`.
    const UNINSTALL_JSON_ARG: &str = "--uninstall-json";
    /// MUST match `DEFAULT_DELAY_SECS` in `uninstall.rs`. Duplicated as a literal
    /// (rather than shared code) because this crate is intentionally
    /// dependency-free and does not link against the main app crate.
    ///
    /// This MUST NOT exceed the app's value: the app only self-deletes once the
    /// user explicitly completes a removal that the *app's* cool-off has
    /// already unlocked (it never fires on its own). If the guardian's copy of
    /// the delay were larger than the app's, the guardian could still think the
    /// cool-off is unmet for a legitimately-completed uninstall and keep
    /// resurrecting the app, fighting the self-delete worker forever. Keeping
    /// this value less-than-or-equal to the app's guarantees a real, completed
    /// uninstall is always honored. Kept equal, at the intentional 10-second
    /// testing value the product owner chose in `uninstall.rs` — for production
    /// set BOTH back to `24 * 60 * 60`.
    const COOLOFF_DELAY_SECS: u64 = 10; // ← keep in sync w/ uninstall.rs

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

    // ---- Resolve args: which exe to relaunch as "main", and where
    // uninstall.json lives (both passed by the spawner) ------------------------
    // Normally passed as `--main <path>` / `--uninstall-json <path>`; `--main`
    // falls back to "the main exe sits next to us" if absent. When
    // `--uninstall-json` is absent (the first guardian, spawned before the app
    // learned the path — see `shutdown_requested`), the path is instead
    // recovered from the sentinel's content at shutdown-check time.
    fn resolve_args() -> (PathBuf, Option<PathBuf>) {
        let mut main_exe = None;
        let mut uninstall_json = None;
        let mut args = std::env::args_os().skip(1);
        while let Some(a) = args.next() {
            if a == MAIN_ARG {
                main_exe = args.next().map(PathBuf::from);
            } else if a == UNINSTALL_JSON_ARG {
                uninstall_json = args.next().map(PathBuf::from);
            }
        }
        let main_exe = main_exe.unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
                .map(|d| d.join(MAIN_BIN))
                .unwrap_or_else(|| PathBuf::from(MAIN_BIN))
        });
        (main_exe, uninstall_json)
    }

    /// Hand-parsed reader for `uninstall.json`'s `requested_at` field. This
    /// crate carries no JSON dependency by design (see Cargo.toml — pure std +
    /// a handful of kernel32 calls, kept tiny on purpose), and the on-disk
    /// shape (`{"requested_at": <unix-secs|null>}`, from `serde_json` in
    /// uninstall.rs) is trivial and stable enough that a small scanner beats
    /// pulling in serde just for this one read. MUST track the `Persisted`
    /// struct in uninstall.rs.
    fn read_requested_at(path: &Path) -> Option<u64> {
        let s = std::fs::read_to_string(path).ok()?;
        let idx = s.find("requested_at")?;
        let after = &s[idx + "requested_at".len()..];
        let colon = after.find(':')?;
        let rest = after[colon + 1..].trim_start();
        let end = rest
            .find(|c: char| c == ',' || c == '}' || c.is_whitespace())
            .unwrap_or(rest.len());
        let tok = rest[..end].trim();
        if tok.is_empty() || tok == "null" {
            None
        } else {
            tok.parse::<u64>().ok()
        }
    }

    /// True if the uninstall cool-off has actually elapsed, per the
    /// `uninstall.json` path the spawner gave us. A missing arg, or an
    /// unreadable/unparsable/still-pending file, all read as "not elapsed" —
    /// default-deny. See `shutdown_requested` for why that's the safe default.
    fn cooloff_elapsed(uninstall_json: Option<&Path>) -> bool {
        let Some(path) = uninstall_json else { return false };
        let Some(requested_at) = read_requested_at(path) else { return false };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now.saturating_sub(requested_at) >= COOLOFF_DELAY_SECS
    }

    // ---- Shutdown sentinel (kill switch) ------------------------------------
    //
    // Sentinel protocol (MUST match watchdog.rs):
    //   * path    — `%TEMP%\purepath.watchdog.shutdown`;
    //   * content — the full UTF-8 path to `uninstall.json`, so the cool-off can
    //               be verified in a release build even by a guardian that was
    //               spawned before the main app knew that path (i.e. the very
    //               first guardian, launched by `init_main()` before `setup()`
    //               populated it, which therefore never got `--uninstall-json`).
    //               Empty content = "path unknown" -> release readers default-deny.
    const SENTINEL_NAME: &str = "purepath.watchdog.shutdown";

    /// Read the `uninstall.json` path the sentinel carries (its trimmed UTF-8
    /// content), if any. Empty/unreadable = `None`.
    fn sentinel_verify_path() -> Option<PathBuf> {
        let s = std::fs::read_to_string(std::env::temp_dir().join(SENTINEL_NAME)).ok()?;
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(PathBuf::from(t))
        }
    }

    /// Whether a shutdown is currently authorized.
    ///
    /// In a **debug** build this is unconditional (sentinel file exists =>
    /// stand down) — the dev kill switch that keeps testing from trapping you
    /// in a resurrection loop; preserved exactly as before.
    ///
    /// In a **release** build the sentinel alone is not honored: creating an
    /// empty file by hand would otherwise stand down the entire watchdog, so we
    /// additionally require the uninstall cool-off to have actually elapsed
    /// (verified independently here, not just trusted from the main app). The
    /// only legitimate caller of the main app's `request_shutdown()` is its own
    /// uninstall flow, which is itself gated on the cool-off having elapsed —
    /// so a legitimate shutdown always finds `uninstall.json` already elapsed
    /// by the time this runs.
    ///
    /// The verification path comes from the `--uninstall-json` spawn arg when we
    /// have it (guardians respawned after `setup()` do), otherwise from the
    /// sentinel's own content. That fallback is what covers the first-spawn
    /// race: the single long-lived guardian launched by `init_main()` starts
    /// before `setup()` learns the path, so it never receives the arg — but the
    /// sentinel written by `request_shutdown()` carries the path, so this
    /// guardian can still verify the cool-off and stand down for a real uninstall.
    ///
    /// Residual, accepted weakness: `uninstall.json` is plain user-writable
    /// JSON, so a determined user can hand-edit/backdate `requested_at` to fake
    /// an elapsed cool-off. And because the sentinel content now carries the
    /// path, they could equally hand-craft their own fake `uninstall.json`
    /// anywhere, point the sentinel at it, and backdate `requested_at`. Either
    /// way it's still "understand the internals and hand-craft two files in the
    /// right formats" — the same accepted friction bar, not "create one empty
    /// file." This is friction, not security.
    fn shutdown_requested(uninstall_json: Option<&Path>) -> bool {
        if !std::env::temp_dir().join(SENTINEL_NAME).exists() {
            return false;
        }
        if cfg!(debug_assertions) {
            return true;
        }
        // Prefer the spawn arg; fall back to the path carried in the sentinel.
        match uninstall_json {
            Some(p) => cooloff_elapsed(Some(p)),
            None => cooloff_elapsed(sentinel_verify_path().as_deref()),
        }
    }

    fn relaunch_main(main_exe: &Path) {
        // Resurrect hidden (`--autostart`) so a killed app comes back running in
        // the background rather than as a focused window the user didn't open.
        match std::process::Command::new(main_exe).arg(AUTOSTART_ARG).spawn() {
            Ok(_) => {}
            Err(_) => { /* nothing we can usefully log to; retry next cooldown */ }
        }
    }

    // ---- Run ----------------------------------------------------------------

    wlog("starting");

    let (main_exe, uninstall_json) = resolve_args();

    // If a shutdown was authorized, do nothing (let the system come down).
    if shutdown_requested(uninstall_json.as_deref()) {
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

    let mut last_spawn = Instant::now()
        .checked_sub(SPAWN_COOLDOWN)
        .unwrap_or_else(Instant::now);

    loop {
        if shutdown_requested(uninstall_json.as_deref()) {
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
