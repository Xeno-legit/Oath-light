//! Backend-owned persisted settings — the seed of the master plan's
//! `SettingsV1` (item A.3).
//!
//! Most of the renderer's preferences live in `localStorage` via `store.js`,
//! which stays the source of truth for anything only the extension/renderer
//! enforce. This module exists for the opposite case: fields whose actual
//! enforcement lives in Rust need a Rust-owned, disk-persisted home, because
//! the backend has to be able to read its own configuration on startup
//! without waiting on (or trusting) the webview. `friction.rs`'s applier
//! thread and `lib.rs`'s `setup()` both read/write through here instead of
//! keeping a second, divergent copy of "what's currently on".
//!
//! `blocked_processes` / `block_unknown_browsers` are defined now (so the
//! shape is stable and the renderer/backend contract exists) but are only
//! *enforced* by a follow-up task (plan item 1.3) — an empty/false value here
//! is simply "nothing configured yet", not a bug.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

fn default_version() -> u32 {
    1
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

/// Persisted shape, written to `<app_data_dir>/settings.json`. Every field
/// has a `#[serde(default = ...)]` so an old file on disk — from before a
/// field existed — still deserializes cleanly and simply gains the field's
/// default, instead of failing to parse and silently reverting the whole
/// file to defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsV1 {
    #[serde(default = "default_version")]
    pub version: u32,
    /// The "uninstall guard" / reinstall-enforcement switch. Mirrors
    /// `AppState.guard_enabled`; this is the persisted copy that survives a
    /// restart, `AppState`'s is the live one the monitor thread reads.
    #[serde(default = "default_true")]
    pub guard_enabled: bool,
    /// Whether the AI screen monitor should auto-start with the app.
    #[serde(default = "default_false")]
    pub monitor_enabled: bool,
    /// Lowercased image names (e.g. `"steam.exe"`) to treat as blocked
    /// processes. Wired up by plan item 1.3 — defined here first so the
    /// persisted shape and the renderer contract are stable ahead of that.
    #[serde(default)]
    pub blocked_processes: Vec<String>,
    /// Block any browser outside the built-in table outright, instead of
    /// leaving it unenforced. Also wired up by plan item 1.3.
    #[serde(default = "default_false")]
    pub block_unknown_browsers: bool,
    /// System-level DNS filtering (plan item 1.1). Opt-in for v1 — default
    /// **false**: it takes over every adapter's DNS + needs admin, so it is
    /// never turned on without an explicit user action. Enabling is a
    /// strengthening (instant); disabling is a friction-gated weakening
    /// (`dns.disable`), same asymmetry as every other protection here.
    #[serde(default = "default_false")]
    pub dns_filter_enabled: bool,
}

impl Default for SettingsV1 {
    fn default() -> Self {
        Self {
            version: 1,
            guard_enabled: true,
            monitor_enabled: false,
            blocked_processes: Vec::new(),
            block_unknown_browsers: false,
            dns_filter_enabled: false,
        }
    }
}

/// Persisted owner of `SettingsV1`. Cheap to clone the path; the actual value
/// is behind a mutex and mirrored to disk on every `update`.
pub struct SettingsState {
    path: PathBuf,
    inner: Mutex<SettingsV1>,
}

impl SettingsState {
    /// Load `<app_data_dir>/settings.json` (defaults on absence or a parse
    /// failure — never blocks startup on a corrupt file).
    pub fn load(app_data_dir: &std::path::Path) -> Self {
        let path = app_data_dir.join("settings.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<SettingsV1>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    fn save(&self, s: &SettingsV1) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(s) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn get(&self) -> SettingsV1 {
        self.inner.lock().unwrap().clone()
    }

    /// Mutate the settings and persist the result. `f` runs under the lock,
    /// so keep it cheap — no I/O, no blocking, inside the closure.
    pub fn update(&self, f: impl FnOnce(&mut SettingsV1)) {
        let mut s = self.inner.lock().unwrap();
        f(&mut s);
        self.save(&s);
    }
}
