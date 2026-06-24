//! 48-hour uninstall request (Phase 4 friction system).
//!
//! Removing Pure Path is meant to be a *deliberate* act, not an impulsive one.
//! A removal request opens a cool-off window during which blocking stays fully
//! functional. Only once the window elapses can the user actually remove the app
//! (or reset the timer / cancel the request). The pending request is persisted to
//! disk so it survives an app restart *and* a wiped renderer `localStorage` — the
//! renderer is deliberately not trusted to hold friction state.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Cool-off window before an uninstall can complete.
///
/// TESTING: currently **10 minutes** so the flow can be exercised without waiting
/// two days. For production set this back to 48 hours (`48 * 60 * 60`).
/// Overridable at runtime with `PUREPATH_UNINSTALL_SECS` (seconds).
const DEFAULT_DELAY_SECS: u64 = 10 * 60; // ← production: 48 * 60 * 60

fn delay_secs() -> u64 {
    std::env::var("PUREPATH_UNINSTALL_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_DELAY_SECS)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// On-disk shape — a tiny JSON file in the app data dir.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Persisted {
    /// Unix seconds the request was made; `None` = no pending request.
    requested_at: Option<u64>,
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

/// Persisted owner of the uninstall request. Cheap to clone the path; the actual
/// state is behind a mutex and mirrored to disk on every change.
pub struct UninstallStore {
    path: PathBuf,
    inner: Mutex<Persisted>,
}

impl UninstallStore {
    /// Load the persisted request from `<app_data_dir>/uninstall.json` (defaults
    /// to "no request" when the file is absent or unreadable).
    pub fn load(app_data_dir: &std::path::Path) -> Self {
        let path = app_data_dir.join("uninstall.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Persisted>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    fn save(&self, p: &Persisted) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(p) {
            let _ = std::fs::write(&self.path, s);
        }
    }

    fn state_from(p: &Persisted) -> UninstallState {
        let delay = delay_secs();
        match p.requested_at {
            Some(at) => {
                let elapsed = now_secs().saturating_sub(at);
                let remaining = delay.saturating_sub(elapsed);
                UninstallState {
                    requested: true,
                    requested_at: Some(at),
                    delay_secs: delay,
                    elapsed_secs: elapsed,
                    remaining_secs: remaining,
                    ready: remaining == 0,
                }
            }
            None => UninstallState {
                requested: false,
                requested_at: None,
                delay_secs: delay,
                elapsed_secs: 0,
                remaining_secs: delay,
                ready: false,
            },
        }
    }

    pub fn get(&self) -> UninstallState {
        Self::state_from(&self.inner.lock().unwrap())
    }

    /// Start a request. Idempotent — if one is already pending the original clock
    /// is kept (re-requesting never extends the wait).
    pub fn request(&self) -> UninstallState {
        let mut p = self.inner.lock().unwrap();
        if p.requested_at.is_none() {
            p.requested_at = Some(now_secs());
            self.save(&p);
        }
        Self::state_from(&p)
    }

    /// Restart the cool-off clock from now.
    pub fn reset(&self) -> UninstallState {
        let mut p = self.inner.lock().unwrap();
        p.requested_at = Some(now_secs());
        self.save(&p);
        Self::state_from(&p)
    }

    /// Drop the request entirely (continue normally).
    pub fn cancel(&self) -> UninstallState {
        let mut p = self.inner.lock().unwrap();
        p.requested_at = None;
        self.save(&p);
        Self::state_from(&p)
    }
}

// ============================================================================
// OS uninstaller launch
// ============================================================================

/// Outcome of attempting to launch the OS uninstaller.
pub enum LaunchResult {
    /// The uninstaller (or its command) was launched.
    Launched(String),
    /// No installer found — e.g. a dev/unpackaged build. The caller should fall
    /// back to manual-removal instructions.
    NotFound,
}

/// `reg` command that never flashes a console window.
#[cfg(target_os = "windows")]
fn reg_quiet() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = std::process::Command::new("reg");
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Read a single `REG_SZ`/`REG_EXPAND_SZ` value, returning its data.
#[cfg(target_os = "windows")]
fn read_reg_value(key: &str, value: &str) -> Option<String> {
    let out = reg_quiet().args(["query", key, "/v", value]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let t = line.trim_start();
        // `reg /v` does a substring match on the value name, so guard against a
        // longer value (UninstallString vs QuietUninstallString) by anchoring.
        if t.starts_with(value) {
            // After the value name: "REG_SZ    <data>" — drop the type token.
            let rest = t[value.len()..].trim_start();
            if let Some(pos) = rest.find(char::is_whitespace) {
                let data = rest[pos..].trim();
                if !data.is_empty() {
                    return Some(data.to_string());
                }
            }
        }
    }
    None
}

/// Registry uninstall keys to probe (product-name and identifier variants, per
/// user and per machine, incl. 32-bit view). Best-effort — covers NSIS/MSI.
#[cfg(target_os = "windows")]
const UNINSTALL_KEYS: &[&str] = &[
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
    r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
    r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.tauri.dev",
    r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.tauri.dev",
];

/// Launch the OS uninstaller. Prefers the `uninstall.exe` Tauri's NSIS installer
/// drops next to the app, then any registered uninstall string. Returns
/// `NotFound` for dev/unpackaged builds (no installer exists).
#[cfg(target_os = "windows")]
pub fn launch_uninstaller() -> LaunchResult {
    // 1. Tauri's NSIS installer drops `uninstall.exe` beside the app exe.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join("uninstall.exe");
            if cand.exists() && std::process::Command::new(&cand).spawn().is_ok() {
                return LaunchResult::Launched(cand.to_string_lossy().into_owned());
            }
        }
    }
    // 2. Fall back to a registered uninstall string (MSI/WiX or per-machine NSIS).
    for key in UNINSTALL_KEYS {
        for value in ["QuietUninstallString", "UninstallString"] {
            if let Some(cmd) = read_reg_value(key, value) {
                // The string can embed arguments (e.g. `msiexec /x {GUID}`); run it
                // through `cmd` so quoting/args are handled by the shell.
                if std::process::Command::new("cmd")
                    .args(["/C", &cmd])
                    .spawn()
                    .is_ok()
                {
                    return LaunchResult::Launched(cmd);
                }
            }
        }
    }
    LaunchResult::NotFound
}

#[cfg(not(target_os = "windows"))]
pub fn launch_uninstaller() -> LaunchResult {
    // macOS/Linux removal is left to the user's package manager / drag-to-trash.
    LaunchResult::NotFound
}
