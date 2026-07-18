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

// ============================================================================
// Lockdown Mode (plan item 4.4)
// ============================================================================

/// Persisted display-only view of a lockdown request — `active_until` is
/// NEVER the source of truth for whether a lockdown is still running (that's
/// the clock-tamper-immune `lockdown::LockdownState` in `lockdown.json`, same
/// pattern as `friction.rs`'s `credited_secs`); this is only here so old
/// settings files round-trip and so the shape exists for anything that wants
/// a quick, honest-effort wall-clock estimate without pulling in the whole
/// lockdown module.
///
/// Schedule-from-vulnerable-hours (4.4 v2, now wired): the reminder schedule
/// already carries vulnerable-hours windows in `ext_blocking` (pushed by
/// `pages-blocking.jsx`'s `vulnerable` field) — when `escalate_vulnerable_hours`
/// is on, the friction applier thread's tick (see `lib.rs`) starts a Lockdown
/// for the remainder of that window instead of just firing a reminder popup.
/// Turning this ON is a strengthening (instant, same as any other lockdown
/// start). Turning it OFF is the weakening half of the asymmetry: it goes
/// through the ordinary friction delay under the `"lockdown.escalation_disable"`
/// action id (see `set_lockdown_escalation` in lib.rs), exactly like
/// `dns.disable`/`lockdown.cancel` — so a weak moment can't just flip this off
/// to dodge the next window. It never touches an ALREADY-active lockdown
/// (started or not by this schedule) — that still only ever ends via
/// `lockdown.cancel` or natural expiry, same as always.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LockdownV1 {
    /// Unix seconds a currently-active lockdown is expected to end at —
    /// display-only; see the module doc above.
    #[serde(default)]
    pub active_until: Option<u64>,
    /// Frozen lockdowns cannot be cancelled early, only waited out — see
    /// `lockdown.rs`.
    #[serde(default)]
    pub frozen: bool,
    /// Opt-in (default OFF): let the configured vulnerable-hours window
    /// escalate to a (non-frozen) Lockdown automatically instead of only
    /// showing reminder pop-ups. See the struct doc above for the asymmetry.
    #[serde(default = "default_false")]
    pub escalate_vulnerable_hours: bool,
}

// ============================================================================
// Trusted contact / privacy-first accountability (plan item 5.2, Tier 2)
// ============================================================================

/// Which discrete events the trusted contact is notified about. Solo-first:
/// this whole struct only exists at all when `SettingsV1.trusted_contact` is
/// `Some` — a solo user with no contact configured never sees or triggers any
/// of this. `ext_removed` (5.2 v2, now wired): fires once a browser has sat in
/// `extension_missing` for longer than `EXT_MISSING_NOTIFY_AFTER_MS` while
/// the uninstall guard is on — the existing `extension_missing` edge tracker
/// in `start_monitor` (lib.rs) is the debounce source. `block_burst` (also now
/// wired): fires once `BLOCK_BURST_THRESHOLD` blocks land within
/// `BLOCK_BURST_WINDOW_MS` — see the `stats_sync`/`stats_update` handler in
/// `handle_extension_message`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyEventsV1 {
    #[serde(default = "default_true")]
    pub uninstall_requested: bool,
    #[serde(default = "default_true")]
    pub lockdown_cancelled: bool,
    #[serde(default = "default_true")]
    pub password_removal_requested: bool,
    #[serde(default = "default_true")]
    pub ext_removed: bool,
    #[serde(default = "default_true")]
    pub block_burst: bool,
}

impl Default for NotifyEventsV1 {
    fn default() -> Self {
        Self {
            uninstall_requested: true,
            lockdown_cancelled: true,
            password_removal_requested: true,
            ext_removed: true,
            block_burst: true,
        }
    }
}

/// A single optional trusted contact (plan 5.2, Tier 2) — a parent, sibling,
/// friend, or mentor, not necessarily a partner. `None` at the `SettingsV1`
/// level (not just "notify everything off") is the actual solo-first
/// default: no contact configured means no notification code path is even
/// reachable, not just disabled.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrustedContactV1 {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub notify: NotifyEventsV1,
    /// Unix seconds of the last monthly "still protecting" heartbeat send (0 =
    /// never sent). Persisted here (not in a separate file) since it's part
    /// of the same "is this contact meaningfully wired up" picture.
    #[serde(default)]
    pub last_heartbeat: u64,
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
    /// Lockdown Mode (4.4) display-only view — see `LockdownV1`'s doc
    /// comment. The clock-tamper-immune source of truth lives in
    /// `lockdown::LockdownStore` (`lockdown.json`), not here.
    #[serde(default)]
    pub lockdown: LockdownV1,
    /// Optional trusted contact for privacy-first accountability (5.2, Tier
    /// 2) — `None` by default and never nagged; see `TrustedContactV1`.
    #[serde(default)]
    pub trusted_contact: Option<TrustedContactV1>,
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
            lockdown: LockdownV1::default(),
            trusted_contact: None,
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
