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
/// is on, the extension reports the active window over native messaging (the
/// `"vulnerable_window_active"` arm in `lib.rs` — the desktop has no timezone
/// database, so the extension owns the local-time window math) and the desktop
/// starts a Lockdown for the remainder of that window instead of just firing
/// a reminder popup.
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
    /// Serious Mode disable requested (UX Direction §1). Same shape as every
    /// other event here: the contact learns only that the request happened,
    /// and it fires at REQUEST time — before the waiting period starts, so a
    /// weak-moment request can't be quietly filed and forgotten.
    #[serde(default = "default_true")]
    pub serious_disable_requested: bool,
}

impl Default for NotifyEventsV1 {
    fn default() -> Self {
        Self {
            uninstall_requested: true,
            lockdown_cancelled: true,
            password_removal_requested: true,
            ext_removed: true,
            block_burst: true,
            serious_disable_requested: true,
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

// ============================================================================
// AI mentor (optional, opt-in) — see mentor.rs
// ============================================================================

/// Config for the optional AI mentor. Every default here is the "off,
/// nothing configured" state, and that is the whole point: this is the only
/// feature in the app that sends anything the user types off the device, so
/// it must be inert until they explicitly turn it on.
///
/// Note this is NOT a protection, and so it is deliberately **outside** the
/// friction rule: turning it off is instant. The asymmetry exists to stop
/// someone weakening their own filter in a bad moment — applying it to a
/// chat feature would mean a 24-hour wait to stop sending your words to a
/// third party, which is the rule pointed exactly backwards.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MentorV1 {
    /// Off until explicitly enabled. Nothing is sent anywhere while false.
    #[serde(default = "default_false")]
    pub enabled: bool,
    /// Which provider the key belongs to — a `mentor::PROVIDERS` id such as
    /// `"anthropic"`, `"openai"`, `"openrouter"` or `"custom"`. Empty means the
    /// default (Anthropic), which is what every profile written before the
    /// mentor became multi-provider will deserialize to.
    ///
    /// This exists because the mentor was hardwired to one vendor: the settings
    /// field was literally named for Anthropic and the request builder could
    /// only speak that wire format. "Bring your own key" is a much weaker
    /// promise if it means "bring your own key, from this one company".
    #[serde(default)]
    pub provider: String,
    /// Endpoint override. Required for `provider = "custom"` (a local Ollama /
    /// LM Studio / vLLM server, or any OpenAI-compatible gateway); ignored for
    /// the built-in providers, which carry their own base URL.
    #[serde(default)]
    pub base_url: String,
    /// The user's own API key, plaintext, same as the SMTP app-password in
    /// `notify.rs`. Plaintext because the alternative on a machine where the
    /// app must read it unattended is obfuscation dressed up as encryption —
    /// the UI states this outright rather than implying a vault that does not
    /// exist. Never sent to the renderer: `mentor_config` reports only whether
    /// a key is present.
    #[serde(default)]
    pub api_key: String,
    /// Empty = the selected provider's own default model. Overridable so
    /// someone on a tighter budget can point it at a cheaper model without a
    /// rebuild.
    #[serde(default)]
    pub model: String,
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
    /// Serious Mode (UX Direction §1) — the single toggle that flips the whole
    /// app to its strictest configuration and its hard voice, with **no
    /// per-feature exceptions** (that's the point: an all-or-nothing switch
    /// can't be negotiated with piecemeal at 2am).
    ///
    /// Backend-owned rather than a renderer preference for exactly one reason:
    /// turning it OFF is a weakening, and weakenings live in Rust behind
    /// `friction.rs` (action id `"serious.disable"`, double the ordinary
    /// cool-off — see `friction::delay_for`). ON is instant. The renderer
    /// only ever *mirrors* this value; it can never set it false directly.
    #[serde(default = "default_false")]
    pub serious_mode: bool,
    /// Grayscale the whole display during the configured vulnerable-hours
    /// window (plan item 5.6). Opt-in, default off.
    ///
    /// Unlike every protection flag above, this one is instant in BOTH
    /// directions — it is an environment nudge, not a protection, and locking
    /// someone out of their own display colour for 24 hours would be applying
    /// the friction rule where it does no good. See grayscale.rs.
    #[serde(default = "default_false")]
    pub grayscale_vulnerable_hours: bool,
    /// Optional AI mentor (mentor.rs) — off, and with no key, by default.
    #[serde(default)]
    pub mentor: MentorV1,
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
            serious_mode: false,
            grayscale_vulnerable_hours: false,
            mentor: MentorV1::default(),
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
