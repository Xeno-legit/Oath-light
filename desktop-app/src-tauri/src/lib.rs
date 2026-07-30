mod auth;
mod browser_lock;
mod browsers;
mod dns_filter;
mod evallog;
mod friction;
mod lockdown;
mod mentor;
mod notify;
pub mod nsfw;
pub mod nudenet;
mod ota;
mod overlay;
mod grayscale;
mod profiles;
mod recovery;
pub mod screen;
mod settings;
mod uninstall;
mod update;
mod watchdog;

use oathlight_core::eventlog::{self, EventLog};

use browsers::{BrowserDef, Engine, EnforceOutcome, BROWSERS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

// ============================================================================
// Tuning
// ============================================================================

/// How often the monitor reconciles running browsers against live connections.
const MONITOR_TICK: Duration = Duration::from_secs(3);
/// A heartbeat older than this marks a connection as not "live right now"
/// (used only as a fallback signal — install status comes from profiles.rs).
const HEARTBEAT_STALE_MS: u64 = 40_000;

/// Monotonic id per accepted native-host connection (one per browser profile).
static CONN_SEQ: AtomicU64 = AtomicU64::new(1);

/// Latches once removal has been kicked off, so a manual "Remove completely"
/// click can never run the teardown (or spawn a second self-delete worker)
/// twice concurrently. Reset back to `false` if the self-delete worker fails to
/// launch, so a failed attempt can be retried instead of leaving the app in a
/// half-torn-down state forever.
static UNINSTALL_FIRED: AtomicBool = AtomicBool::new(false);

/// Set when a panic/SOS entry point (tray item, global hotkey, extension
/// deep-link — plan item 5.1) fires while the main window's renderer doesn't
/// exist yet (login-started instance) and so can't have subscribed to the
/// `open-panic` event. The renderer consumes it on startup via
/// `take_panic_pending`, so a cold-start request still lands on the flow.
static PANIC_PENDING: AtomicBool = AtomicBool::new(false);

/// Unix ms at which a grayscale vulnerable-hours window (5.6) should end, or
/// 0 when grayscale isn't ours to turn off. Set from the extension's
/// `vulnerable_window_active` message (which carries the remaining minutes)
/// and cleared by `tick_grayscale` on the monitor tick.
///
/// Deliberately a deadline rather than a "the extension will tell us when it
/// ends" contract: the extension only reports while the window is ACTIVE, so
/// if it disconnects — browser closed, extension removed, machine asleep — a
/// signal-based design would leave the user's display monochrome indefinitely.
/// A deadline always expires.
static GRAYSCALE_UNTIL: AtomicU64 = AtomicU64::new(0);

// ============================================================================
// Application State
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtensionStats {
    pub total_blocks: u64,
    pub install_date: String,
    pub last_block_date: String,
    pub days_protected: u64,
}

// Built-in blocklist/keyword embedding + parsing moved to `oathlight-core`
// (plan A.1) — the DNS resolver (1.1) and any future mobile binding need the
// same parsed table this app uses, and a shared `OnceLock` (in core) means
// it's parsed once per process regardless of how many callers ask for it.
// Since OTA updates (plan 3.5, ota.rs) the app reads the *effective* view —
// `oathlight_core::lists::effective()`: the verified OTA overlay when one is
// installed, the baked built-ins otherwise. Callers that specifically want
// the immutable baked lists would call `lists::built_in()` directly; nothing
// in the app should, so counts/checks/pushes all follow updates.

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtensionBlocklists {
    pub domains: Vec<String>,
    pub keywords: Vec<String>,
    pub domain_count: usize,
    pub keyword_count: usize,
    pub built_in_domains: Vec<String>,
    pub built_in_keywords: Vec<String>,
}

/// Fill in `built_in_domains`/`built_in_keywords` from the lazily-parsed
/// effective lists (OTA overlay if installed, bundled otherwise), but only
/// where a field is still empty — a `blocklist_sync` message from an
/// extension can legitimately overwrite these with its own (possibly newer)
/// built-in tables, and that value must always win over our default. (After
/// an OTA install, `ota::push_lists_to_extensions` overwrites these fields
/// directly — the emptiness guard here never blocks an update.)
fn fill_built_in_lists(bl: &mut ExtensionBlocklists) {
    let eff = oathlight_core::lists::effective();
    if bl.built_in_domains.is_empty() {
        bl.built_in_domains = eff.domains_vec().clone();
    }
    if bl.built_in_keywords.is_empty() {
        bl.built_in_keywords = eff.keywords().clone();
    }
}

// normalize_domain / normalize_domain_list moved to oathlight-core (plan A.1)
// — brought into scope here so every existing call site keeps working
// unqualified; behavior is byte-for-byte the same function, now shared with
// the DNS resolver (1.1) and any future mobile binding.
use oathlight_core::lists::{normalize_domain, normalize_domain_list};

/// One live native-host connection = one browser profile's extension.
struct ConnState {
    browser: String,    // browser key from host_hello ("chrome", …) or "unknown"
    profile_id: String, // stable per-profile id supplied by the extension
    last_heartbeat: u64,
    extension_version: String,
    writer: Option<TcpStream>,
}

/// One connected profile within a browser (for the frontend).
#[derive(Debug, Clone, Serialize)]
pub struct ProfileStatus {
    pub id: String,
    pub label: String,
    pub connected: bool,
    pub last_heartbeat: u64,
    pub version: String,
}

/// Snapshot of one browser for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct BrowserStatus {
    pub key: String,
    pub name: String,
    pub engine: String,
    pub installed: bool,
    pub running: bool,
    pub connected: bool,
    pub extension_version: String,
    pub last_heartbeat: u64,
    /// not_installed | idle | connecting | running_connected | extension_missing
    pub state: String,
    /// off | dormant | enforced | failed | unsupported
    pub enforcement: String,
    /// Every profile of this browser currently connected.
    pub profiles: Vec<ProfileStatus>,
    /// This browser is kill-on-sight until it carries the extension
    /// (`browser_lock`) — i.e. the setting is on and it is one of the browsers
    /// that cannot be force-installed. Says nothing about whether it is being
    /// killed *right now*; that is `lock_grace_secs` and `installed`.
    #[serde(default)]
    pub locked_out: bool,
    /// Seconds left on an open restore window, 0 when there is none. Drives the
    /// countdown the UI shows while the user completes the install.
    #[serde(default)]
    pub lock_grace_secs: u64,
    /// The extension is downloaded and unpacked in some profile but switched
    /// off — the user is one click from protected. Distinct from `installed`
    /// being false for the ordinary reason (nothing there at all), and the only
    /// state that buys more time from `browser_lock`.
    #[serde(default)]
    pub pending_approval: bool,
}

/// A browser not in the built-in table, learned from a native-host connection.
#[derive(Debug, Clone)]
struct CustomBrowser {
    name: String,
    process: String, // lowercased image name, e.g. "zen.exe"
}

#[derive(Default)]
pub struct AppState {
    pub stats: ExtensionStats,
    pub blocklists: ExtensionBlocklists,
    /// keyed by per-connection id (one entry per browser profile).
    connections: HashMap<u64, ConnState>,
    /// Browsers outside the built-in table, learned when their extension connects.
    custom_browsers: HashMap<String, CustomBrowser>,
    /// Latest total_blocks per source (profile), so the displayed count is the
    /// sum across every extension/profile and survives one going idle.
    block_counts: HashMap<String, u64>,
    /// Whether the desktop app should keep the extension installed (the
    /// "uninstall guard" / monitoring remediation switch). On by default.
    guard_enabled: bool,
    /// Last theme/palette pushed from the UI, re-sent to extensions on connect.
    ext_theme: Option<Value>,
    /// Last blocking settings (redirect target + reminder schedule) pushed from
    /// the UI, re-sent to extensions on connect.
    ext_blocking: Option<Value>,
    /// Clean-streak day count from the app, mirrored down to the extensions.
    app_streak: u64,
    /// User-added "my blocklist" sites from the renderer (`blocklist.customSites`),
    /// normalized and cached so a freshly-connecting extension gets them on
    /// handshake too. Persisted to `custom_domains.json` so a restart doesn't
    /// silently drop them back to nothing (see `set_custom_domains`).
    custom_domains: Vec<String>,
    /// Domains the user additively allowed WHILE a lockdown was active (4.4's
    /// anti-brick mitigation). Pushed to extensions inside the lockdown field
    /// so `shouldBlockUrl` lets them through even in allowlist-only mode.
    /// Persisted to `lockdown_allow.json`. Additions go through a short (60s)
    /// friction delay (`lockdown.allow:` action id) — see `request_lockdown_allow`.
    lockdown_allow: Vec<String>,
    /// Recent (timestamp_ms, delta) block-count increases, for the
    /// block-burst trusted-contact detector (5.2) — see `BLOCK_BURST_THRESHOLD`.
    /// Bounded to the last `BLOCK_BURST_WINDOW_MS`; old entries are trimmed on
    /// every `stats_sync`/`stats_update`, never grows unbounded.
    block_burst_log: VecDeque<(u64, u64)>,
    /// Wall-clock ms of the last `block_burst` trusted-contact notification,
    /// so a sustained burst doesn't refire the notification every sync.
    last_block_burst_notify_ms: u64,
    /// Mirror of `SettingsV1.lockdown.escalate_vulnerable_hours` (4.4 v2), so
    /// `broadcast_blocking` can push it down to extensions without needing a
    /// `SettingsState` handle of its own — kept in sync by
    /// `set_lockdown_escalation` and the `"lockdown.escalation_disable"`
    /// applier arm, the only two places that ever change the setting.
    lockdown_escalate: bool,
    /// Mirror of `SettingsV1.serious_mode` (UX Direction §1), for the same
    /// reason as `lockdown_escalate` above: `broadcast_blocking` needs it and
    /// has no `SettingsState` handle. Kept in sync by `set_serious_mode` and
    /// the `"serious.disable"` applier arm — the only two places that ever
    /// change the setting — plus the startup seed in `setup()`.
    serious_mode: bool,
}

/// Lazily-loaded NSFW models (Phase 4 optional AI monitoring). Both are loaded
/// on first use, then shared across calls:
/// - `classifier`: SigLIP `image-guard` (~340MB) — owns drawn / hentai.
/// - `detector`: NudeNet (~12MB) — owns photographic nudity. The monitor ORs
///   the two into one ensemble verdict (see [`run_monitor`]).
#[derive(Default)]
pub struct NsfwState {
    classifier: Mutex<Option<Arc<nsfw::NsfwClassifier>>>,
    detector: Mutex<Option<Arc<nudenet::NudeNetDetector>>>,
}

/// Controls the background screen-scanning monitor thread.
#[derive(Default)]
pub struct MonitorState {
    running: Arc<AtomicBool>,
}

// Monitor tuning.
const SCAN_POLL: Duration = Duration::from_millis(500);
const SCAN_FP_SIZE: u32 = 32;
const SCAN_CHANGE_THRESH: f32 = 6.0; // mean abs luma diff (0..255)
const SCAN_MIN_GAP: Duration = Duration::from_millis(800);

// Ensemble block thresholds (see desktop-app/ml/AI_PLAN.md). BLOCK when the
// SigLIP drawn/hentai signal OR the NudeNet photographic signal fires.
const ENSEMBLE_SIGLIP_NSFW: f32 = 0.50;
const ENSEMBLE_NUDENET_EXPLICIT: f32 = 0.30;

// Action-layer persistence (Phase 4 flagship — plan item 2.1). A single
// "blocked" ensemble verdict never opens the overlay on its own — screen
// noise and one-off false positives are common at a 500ms poll rate — so
// each monitor tracks a short sliding window of its recent verdicts and only
// escalates once real persistence shows up. See `MonitorTrack::natural_escalation`.
const VERDICT_WINDOW: usize = 5;
/// `blocked` in at least this many of the last `VERDICT_WINDOW` scans -> Acting.
const ESCALATE_HITS: usize = 3;
/// This many *consecutive* clean scans (a streak, not just a low window count)
/// -> back down to Clear. Kept equal to `VERDICT_WINDOW` so the two rules
/// agree: by the time the streak requirement is met, the window is
/// guaranteed to hold zero blocked verdicts too.
const DEESCALATE_CLEAN_STREAK: usize = 5;

/// One scan result pushed to the UI (`nsfw-scan` event).
#[derive(Debug, Clone, Serialize)]
pub struct ScanEvent {
    pub ts: u64,
    /// Which monitor this scan came from (xcap's monitor id) — a machine with
    /// more than one display no longer collapses to "the" primary screen.
    pub monitor_id: u32,
    pub change: f32,
    pub capture_ms: f64,
    pub infer_ms: f64,
    pub labels: Vec<String>,
    #[serde(flatten)]
    pub classification: nsfw::Classification,
    /// NudeNet photographic-nudity scores (None if the detector isn't loaded).
    pub nudenet: Option<nudenet::NudeResult>,
    /// Ensemble verdict: SigLIP nsfw_score OR NudeNet explicit crossed threshold.
    pub blocked: bool,
    /// Downscaled JPEG of the captured frame as a data URL ("what it sees").
    pub thumb: String,
    pub width: u32,
    pub height: u32,
}

/// Downscaled JPEG data-URL of a frame (for the UI preview).
fn make_thumb(img: &image::DynamicImage, max_side: u32) -> String {
    let thumb = img.resize(max_side, max_side, image::imageops::FilterType::Triangle);
    let rgb = thumb.to_rgb8();
    let mut bytes: Vec<u8> = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 72);
    if enc.encode_image(&rgb).is_err() {
        return String::new();
    }
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Escalation state of one monitor's action-layer state machine
/// (Clear -> Suspect -> Acting). Only `Acting` has a visible effect (the
/// overlay + redirect); `Suspect` exists purely so a single blocked frame is
/// distinguishable, internally and in the UI, from "nothing's happening" —
/// see `MonitorTrack::natural_escalation` for the transition rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum Escalation {
    #[default]
    Clear,
    Suspect,
    Acting,
}

/// Per-monitor state the loop carries across ticks: the change-detection
/// fingerprint/gap (as before, now one per monitor instead of one global) plus
/// the sliding window of recent ensemble verdicts that drives escalation.
struct MonitorTrack {
    prev_fp: Vec<u8>,
    last_scan: Instant,
    /// Recent verdicts (true = blocked), oldest first, capped at
    /// `VERDICT_WINDOW` — only an actual scan pushes onto this, not every
    /// tick (most ticks don't cross `SCAN_CHANGE_THRESH` at all).
    verdicts: VecDeque<bool>,
    /// Consecutive non-blocked verdicts; reset to 0 by any blocked one.
    /// Drives de-escalation as a streak requirement, independent of how
    /// quickly the window above dilutes old blocked entries away.
    clean_streak: usize,
    /// Last *effective* escalation (after cooldown suppression — see
    /// `run_monitor`), so a fresh scan can detect the Clear<->Acting edges
    /// that actually open/close the overlay, not just re-derive the same
    /// state every tick.
    escalation: Escalation,
}

impl MonitorTrack {
    fn new() -> Self {
        Self {
            // Empty fingerprint => `screen::change_score` returns the max
            // (255.0), so a brand-new monitor (first seen, or reconnected
            // under a fresh id after a hot-plug) always scans its first frame.
            prev_fp: Vec::new(),
            last_scan: Instant::now().checked_sub(SCAN_MIN_GAP).unwrap_or_else(Instant::now),
            verdicts: VecDeque::with_capacity(VERDICT_WINDOW),
            clean_streak: 0,
            escalation: Escalation::Clear,
        }
    }

    /// Feed one real ensemble verdict and return the escalation state derived
    /// purely from persistence (before any cooldown suppression the caller
    /// may apply — see `run_monitor`). Never acts on a single frame in either
    /// direction: reaching `Acting` needs `ESCALATE_HITS` blocked verdicts
    /// within the last `VERDICT_WINDOW` scans, and stepping all the way back
    /// down to `Clear` needs `DEESCALATE_CLEAN_STREAK` *consecutive* clean
    /// ones (a streak, not just a low count in the window).
    fn natural_escalation(&mut self, blocked: bool) -> Escalation {
        if self.verdicts.len() == VERDICT_WINDOW {
            self.verdicts.pop_front();
        }
        self.verdicts.push_back(blocked);
        self.clean_streak = if blocked { 0 } else { self.clean_streak + 1 };

        let hits = self.verdicts.iter().filter(|v| **v).count();
        if hits >= ESCALATE_HITS {
            Escalation::Acting
        } else if self.clean_streak >= DEESCALATE_CLEAN_STREAK {
            self.verdicts.clear();
            Escalation::Clear
        } else if hits >= 1 {
            Escalation::Suspect
        } else {
            Escalation::Clear
        }
    }
}

/// If the user has a "redirect to a motivational page" configured (Settings ->
/// Blocking) and it's currently switched on, open it in the default browser —
/// the same nudge the extension's own block page gives, reusing `open_external`
/// rather than re-implementing scheme handling a second time. Silently does
/// nothing if no redirect is configured, it's off, or opening it fails: this
/// is a bonus nudge alongside the overlay, not the action layer's real actuator.
fn maybe_open_configured_redirect(state: &Arc<Mutex<AppState>>) {
    let raw = {
        let s = state.lock().unwrap();
        s.ext_blocking.as_ref().and_then(|v| {
            let on = v.get("redirectLinkOn").and_then(|b| b.as_bool()).unwrap_or(false);
            if !on {
                return None;
            }
            v.get("redirectUrl").and_then(|u| u.as_str()).map(str::to_string)
        })
    };
    let Some(raw) = raw else { return };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    // Same scheme-normalization rule as the renderer's `openRedirect` (pages-
    // blocking.jsx): a scheme-less entry defaults to https.
    let url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    if let Err(e) = open_external(url) {
        log::warn!("action layer: could not open configured redirect: {e}");
    }
}

/// The monitor loop: poll every connected monitor, fingerprint each one, and
/// classify only the monitor(s) whose fingerprint changed meaningfully this
/// tick — emitting a `nsfw-scan` event (with timing + a thumbnail) for each.
/// Each monitor's recent verdicts feed its own Clear -> Suspect -> Acting
/// state machine (see `MonitorTrack`); entering `Acting` opens the overlay
/// (`overlay::open`) and fires the configured redirect, and returning to
/// `Clear` closes it again.
fn run_monitor(
    app: AppHandle,
    clf: Arc<nsfw::NsfwClassifier>,
    nude: Option<Arc<nudenet::NudeNetDetector>>,
    running: Arc<AtomicBool>,
    state: Arc<Mutex<AppState>>,
    overlay_state: Arc<overlay::OverlayState>,
) {
    log::info!("nsfw screen monitor started (nudenet: {})", nude.is_some());
    let mut tracks: HashMap<u32, MonitorTrack> = HashMap::new();

    while running.load(Ordering::Relaxed) {
        let t_cap = Instant::now();
        let frames = match screen::capture_all() {
            Ok(f) => f,
            Err(e) => {
                log::warn!("screen capture failed: {e}");
                std::thread::sleep(SCAN_POLL);
                continue;
            }
        };
        let capture_ms = t_cap.elapsed().as_secs_f64() * 1000.0;

        // Hot-plug: drop state for any monitor that vanished since the last
        // tick, closing its overlay if one happened to be open (a monitor
        // that reappears later gets a brand-new `MonitorTrack`, not stale
        // state resurrected under a reused id).
        let live_ids: HashSet<u32> = frames.iter().map(|(id, _)| *id).collect();
        tracks.retain(|id, _| {
            let keep = live_ids.contains(id);
            if !keep {
                overlay::close(&app, *id);
            }
            keep
        });

        for (monitor_id, frame) in frames {
            let (width, height) = (frame.width(), frame.height());
            let track = tracks.entry(monitor_id).or_insert_with(MonitorTrack::new);

            let fp = screen::fingerprint(&frame, SCAN_FP_SIZE);
            let change = screen::change_score(&fp, &track.prev_fp);
            track.prev_fp = fp;

            if change < SCAN_CHANGE_THRESH || track.last_scan.elapsed() < SCAN_MIN_GAP {
                continue;
            }

            let dynimg = image::DynamicImage::ImageRgba8(frame);
            let t_inf = Instant::now();
            let classification = match clf.classify_image(&dynimg) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("classify failed (monitor {monitor_id}): {e}");
                    continue;
                }
            };
            // Second model: NudeNet for photographic nudity (best-effort).
            let nudenet = nude.as_ref().and_then(|d| match d.detect_image(&dynimg) {
                Ok(r) => Some(r),
                Err(e) => {
                    log::warn!("nudenet detect failed (monitor {monitor_id}): {e}");
                    None
                }
            });
            let infer_ms = t_inf.elapsed().as_secs_f64() * 1000.0;
            // Ensemble: drawn/hentai (SigLIP) OR photographic nudity (NudeNet).
            let blocked = classification.nsfw_score >= ENSEMBLE_SIGLIP_NSFW
                || nudenet.as_ref().is_some_and(|r| r.explicit >= ENSEMBLE_NUDENET_EXPLICIT);

            let payload = ScanEvent {
                ts: now_unix_ms(),
                monitor_id,
                change,
                capture_ms,
                infer_ms,
                labels: nsfw::LABELS.iter().map(|s| s.to_string()).collect(),
                classification,
                nudenet,
                blocked,
                thumb: make_thumb(&dynimg, 384),
                width,
                height,
            };
            let _ = app.emit("nsfw-scan", &payload);
            track.last_scan = Instant::now();

            // Persistence-gated action layer (feature 2.1). A cooldown after
            // a user dismiss caps a fresh Acting verdict back down to Suspect
            // instead of reopening the overlay immediately; once the cooldown
            // lapses, continued persistence re-escalates normally.
            let cooling = overlay_state.in_cooldown(monitor_id);
            let natural = track.natural_escalation(blocked);
            let effective =
                if natural == Escalation::Acting && cooling { Escalation::Suspect } else { natural };
            let prev = track.escalation;
            track.escalation = effective;

            if effective == Escalation::Acting && prev != Escalation::Acting {
                log::warn!("monitor {monitor_id}: persistent NSFW verdict — escalating to Acting");
                // Event log (4.5): record the ESCALATION only — never the
                // thumbnail, the scores, or any content (plan 4.5: "event
                // only, no content"). The monitor id is the machine's display
                // index, not anything identifying.
                log_event(&app, "monitor_escalated", serde_json::json!({ "monitor_id": monitor_id }));
                // 2.4: stash the ensemble's own numbers + a frame digest so a
                // "this was wrong" press has real evidence to record. Written
                // BEFORE `open` (which calls `mark_shown`) — `mark_shown`
                // deliberately preserves it. Never the frame itself.
                overlay_state.set_evidence(
                    monitor_id,
                    overlay::Evidence {
                        siglip_nsfw: payload.classification.nsfw_score,
                        nudenet_explicit: payload.nudenet.as_ref().map(|r| r.explicit).unwrap_or(0.0),
                        screen_hash: evallog::hash_frame(dynimg.to_rgb8().as_raw()),
                    },
                );
                if let Err(e) = overlay::open(&app, &overlay_state, monitor_id) {
                    log::warn!("could not open overlay for monitor {monitor_id}: {e}");
                }
                maybe_open_configured_redirect(&state);
            } else if effective == Escalation::Clear && prev != Escalation::Clear {
                overlay::close(&app, monitor_id);
            }
        }

        std::thread::sleep(SCAN_POLL);
    }
    log::info!("nsfw screen monitor stopped");
}

// ============================================================================
// TCP Protocol Helpers
// ============================================================================

fn read_tcp_message(reader: &mut BufReader<TcpStream>) -> std::io::Result<Value> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;

    if len > 1_048_576 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Message too large: {} bytes", len),
        ));
    }

    let mut msg_buf = vec![0u8; len];
    reader.read_exact(&mut msg_buf)?;

    serde_json::from_slice(&msg_buf).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("Invalid JSON: {}", e))
    })
}

fn write_tcp_message(writer: &mut TcpStream, msg: &Value) -> std::io::Result<()> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("JSON serialize error: {}", e))
    })?;
    let len = json_bytes.len() as u32;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&json_bytes)?;
    writer.flush()?;
    Ok(())
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Read a `profileId` field from an extension message (handshake/heartbeat).
fn msg_profile_id(msg: &Value) -> Option<String> {
    msg.get("profileId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

// Block-burst trusted-contact detector (5.2): this many blocks landing within
// `BLOCK_BURST_WINDOW_MS` of each other triggers one `block_burst` event-log
// entry + (if configured) trusted-contact notification. Chosen as "clearly a
// lot, in a short window" without being so low that ordinary heavy browsing
// (a page full of ad-network subrequests) trips it constantly.
const BLOCK_BURST_THRESHOLD: u64 = 10;
const BLOCK_BURST_WINDOW_MS: u64 = 10 * 60 * 1000; // 10 minutes

// ============================================================================
// Message handling — messages arriving from a browser's extension
// ============================================================================

fn handle_extension_message(
    app: &AppHandle,
    state: &Arc<Mutex<AppState>>,
    conn_id: u64,
    msg: &Value,
) {
    let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Every extension message refreshes this connection's liveness + identity.
    {
        let mut s = state.lock().unwrap();
        if let Some(conn) = s.connections.get_mut(&conn_id) {
            conn.last_heartbeat = now_unix_ms();
            if let Some(pid) = msg_profile_id(msg) {
                conn.profile_id = pid;
            }
            if let Some(v) = msg.get("extensionVersion").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    conn.extension_version = v.to_string();
                }
            }
        }
    }

    match msg_type {
        "handshake" | "heartbeat" => { /* liveness already refreshed above */ }

        "stats_sync" | "stats_update" => {
            // Block-burst trusted-contact detector (5.2): set outside the lock
            // below if this update pushes the rolling window's total at/over
            // `BLOCK_BURST_THRESHOLD` and the per-window cooldown has elapsed.
            let mut burst_detected = false;
            {
                let mut s = state.lock().unwrap();
                // Key this source's block count by its profile id (fall back to
                // the connection) so totals sum across profiles/browsers and a
                // reconnect updates in place rather than double-counting.
                let key = s
                    .connections
                    .get(&conn_id)
                    .map(|c| if c.profile_id.is_empty() { format!("conn-{}", conn_id) } else { c.profile_id.clone() })
                    .unwrap_or_else(|| format!("conn-{}", conn_id));
                if let Some(v) = msg.get("totalBlocks").and_then(|v| v.as_u64()) {
                    // `totalBlocks` is cumulative (lifetime), so the delta since
                    // this source's last-known value is how many NEW blocks
                    // this update represents — a fresh source (no prior value)
                    // contributes zero, never its whole lifetime total, so a
                    // reconnect/resync can never look like a burst on its own.
                    let prev = s.block_counts.get(&key).copied().unwrap_or(v);
                    let delta = v.saturating_sub(prev);
                    s.block_counts.insert(key, v);
                    if delta > 0 {
                        let now_ms = now_unix_ms();
                        s.block_burst_log.push_back((now_ms, delta));
                        while s
                            .block_burst_log
                            .front()
                            .is_some_and(|(t, _)| now_ms.saturating_sub(*t) > BLOCK_BURST_WINDOW_MS)
                        {
                            s.block_burst_log.pop_front();
                        }
                        let windowed: u64 = s.block_burst_log.iter().map(|(_, d)| d).sum();
                        if windowed >= BLOCK_BURST_THRESHOLD
                            && now_ms.saturating_sub(s.last_block_burst_notify_ms) >= BLOCK_BURST_WINDOW_MS
                        {
                            s.last_block_burst_notify_ms = now_ms;
                            burst_detected = true;
                        }
                    }
                }
                // Aggregate = sum of every source's latest total.
                s.stats.total_blocks = s.block_counts.values().sum();
                if let Some(v) = msg.get("installDate").and_then(|v| v.as_str()) {
                    if s.stats.install_date.is_empty() {
                        s.stats.install_date = v.to_string();
                    }
                }
                if let Some(v) = msg.get("lastBlockDate").and_then(|v| v.as_str()) {
                    s.stats.last_block_date = v.to_string();
                }
                if let Some(v) = msg.get("daysProtected").and_then(|v| v.as_u64()) {
                    s.stats.days_protected = v;
                }
                let stats = s.stats.clone();
                drop(s);
                let _ = app.emit("extension-stats", &stats);
            }
            // Reflect the new global total back down to the extensions' pages.
            broadcast_app_data(state);
            if burst_detected {
                // Tier 1 (solo, always): a plain protective-event entry, no
                // content — just that a burst happened. Tier 2 (optional):
                // notify_contact is itself a no-op unless a contact is
                // configured with this event enabled (solo-first).
                log_event(app, "block_burst", serde_json::json!({}));
                notify_contact(app, "block_burst");
            }
        }

        "blocklist_sync" => {
            let mut s = state.lock().unwrap();
            if let Some(domains) = msg.get("domains").and_then(|v| v.as_array()) {
                s.blocklists.domains =
                    domains.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                s.blocklists.domain_count = s.blocklists.domains.len();
            }
            if let Some(keywords) = msg.get("keywords").and_then(|v| v.as_array()) {
                s.blocklists.keywords =
                    keywords.iter().filter_map(|v| v.as_str().map(String::from)).collect();
                s.blocklists.keyword_count = s.blocklists.keywords.len();
            }
            if let Some(b) = msg.get("builtInDomains").and_then(|v| v.as_array()) {
                s.blocklists.built_in_domains =
                    b.iter().filter_map(|v| v.as_str().map(String::from)).collect();
            }
            if let Some(b) = msg.get("builtInKeywords").and_then(|v| v.as_array()) {
                s.blocklists.built_in_keywords =
                    b.iter().filter_map(|v| v.as_str().map(String::from)).collect();
            }
            fill_built_in_lists(&mut s.blocklists);
            let bl = s.blocklists.clone();
            drop(s);
            let _ = app.emit("extension-blocklist", &bl);
        }

        "open_panic" => {
            // Panic/SOS deep-link from the extension blocked page's "I need
            // help right now" button (plan item 5.1): surface the app and open
            // the urge-surfing flow. Purely helpful — there is nothing to gate
            // or verify here, and the blocked page runs its own self-contained
            // fallback flow whether or not this arrives.
            open_panic_flow(app);
        }

        "vulnerable_window_active" => {
            // Lockdown schedule-from-vulnerable-hours (4.4 v2, opt-in, off by
            // default — `SettingsV1.lockdown.escalate_vulnerable_hours`). This
            // crate has no timezone database, so the extension (which already
            // evaluates the vulnerable-hours window in local time for the
            // reminder pop-ups — see `reminders.js`) is the one telling us
            // "the window is active, here's how many minutes remain" on a
            // short cadence; this just tops up a lockdown to match. Starting/
            // extending a lockdown is always a strengthening (instant, no
            // gate — see lockdown.rs), and `LockdownStore::start` is
            // monotonic (never shortens the remaining time), so acting on a
            // stale or duplicate message here is always safe, never a bug.
            // Turning the ESCALATION SETTING itself off is the weakening half
            // of the asymmetry and goes through `set_lockdown_escalation`'s
            // friction gate instead — this arm only ever reads that setting.
            let escalate = app
                .try_state::<Arc<settings::SettingsState>>()
                .map(|s| s.get().lockdown.escalate_vulnerable_hours)
                .unwrap_or(false);
            let mins = msg.get("remainingMin").and_then(|v| v.as_u64()).unwrap_or(0);
            if escalate && mins > 0 {
                if let Some(lockdown) = app.try_state::<Arc<lockdown::LockdownStore>>() {
                    let was_active = lockdown.view().active;
                    let view = lockdown.start(mins.saturating_mul(60), false);
                    if let Some(settings) = app.try_state::<Arc<settings::SettingsState>>() {
                        settings.update(|s| {
                            s.lockdown.active_until = view.active_until;
                            s.lockdown.frozen = view.frozen;
                        });
                    }
                    let _ = broadcast_blocking(state, lockdown.inner());
                    if !was_active {
                        log_event(
                            app,
                            "lockdown_started",
                            serde_json::json!({
                                "duration_secs": mins * 60,
                                "frozen": false,
                                "reason": "vulnerable_hours_schedule",
                            }),
                        );
                    }
                }
            }

            // Grayscale vulnerable hours (5.6). Rides the SAME signal as the
            // lockdown escalation above, for the same reason: this crate has
            // no timezone database, so the extension owns the local-time
            // window math and tells us "active, N minutes left". Independent
            // of the escalation setting — a user can want a desaturated
            // screen at 1am without wanting allowlist-only browsing.
            //
            // `GRAYSCALE_UNTIL` is when to hand the display back; the monitor
            // tick does the actual restore (see `tick_grayscale`), so the
            // filter still lifts if the extension disconnects mid-window
            // rather than leaving someone stuck in monochrome.
            let want_gray = app
                .try_state::<Arc<settings::SettingsState>>()
                .map(|s| s.get().grayscale_vulnerable_hours)
                .unwrap_or(false);
            if want_gray && mins > 0 {
                let until = now_unix_ms() + mins.saturating_mul(60_000);
                GRAYSCALE_UNTIL.store(until, Ordering::SeqCst);
                if !grayscale::is_active() {
                    match grayscale::set(true) {
                        Ok(()) => log::info!("grayscale on for the vulnerable-hours window ({mins}m)"),
                        Err(e) => log::warn!("could not enable grayscale: {e}"),
                    }
                }
            }
        }

        _ => log::warn!("[conn {}] unknown message type: {}", conn_id, msg_type),
    }
}

// ============================================================================
// Sending to the extension(s)
// ============================================================================

/// Broadcast a message to every connected browser/profile's extension.
fn broadcast_to_extensions(state: &Arc<Mutex<AppState>>, msg: &Value) -> usize {
    let mut s = state.lock().unwrap();
    let mut sent = 0;
    for conn in s.connections.values_mut() {
        if let Some(writer) = conn.writer.as_mut() {
            if write_tcp_message(writer, msg).is_ok() {
                sent += 1;
            }
        }
    }
    sent
}

/// Push the app-sourced day streak + global block total to every extension, so
/// their pages show the same numbers the app does.
fn broadcast_app_data(state: &Arc<Mutex<AppState>>) {
    let (streak, blocks) = {
        let s = state.lock().unwrap();
        (s.app_streak, s.stats.total_blocks)
    };
    let msg = serde_json::json!({ "type": "set_app_data", "streak": streak, "globalBlocks": blocks });
    let _ = broadcast_to_extensions(state, &msg);
}

// ============================================================================
// Tamper-evident event log (plan item 4.5) — thin app-side helpers around the
// `oathlight-core::eventlog::EventLog` managed in `setup()`. Every writer in
// this file goes through `log_event`; the core module owns the hash-chaining
// and tamper-evidence, this is just the wiring.
// ============================================================================

/// Append one protective event, if the log is managed (it always is after
/// `setup()`; `try_state` so a pre-setup caller degrades to a no-op instead
/// of panicking). NEVER pass content/scores/URLs in `data` — event only.
fn log_event(app: &AppHandle, kind: &str, data: Value) {
    if let Some(el) = app.try_state::<Arc<EventLog>>() {
        el.append(kind, data);
    }
}

// ============================================================================
// Lockdown Mode (plan item 4.4) — pushing state to extensions. The desktop is
// the authority for whether a lockdown is active; extensions enforce it and
// self-expire off `ends_at_hint` only as a fallback if the connection dies.
// ============================================================================

/// The `lockdown` sub-object the extension stores inside `ppBlocking`
/// (`{active, frozen, ends_at_hint}`) — `ends_at_hint` is a wall-clock unix
/// seconds ESTIMATE the extension uses only to self-expire if the desktop
/// connection drops; while connected, the desktop's explicit pushes are
/// authoritative (a clock roll can't shorten a lockdown, only the desktop
/// ending it can).
fn lockdown_field(view: &lockdown::LockdownView, allow: &[String], escalate_vulnerable_hours: bool) -> Value {
    serde_json::json!({
        "active": view.active,
        "frozen": view.frozen,
        "ends_at_hint": view.active_until,
        "allow": allow,
        // 4.4 v2: tells the extension whether to arm its own vulnerable-hours
        // watcher (see reminders.js's `maybeEscalateLockdown`) — the desktop
        // has no timezone database, so the extension is the one that decides
        // WHEN the window is active; this flag only decides WHETHER it should
        // bother checking at all.
        "escalate_vulnerable_hours": escalate_vulnerable_hours,
    })
}

/// Broadcast the current blocking settings to every extension WITH the live
/// lockdown state merged in. The renderer's own blocking settings
/// (`ext_blocking`: redirect target + reminder schedule) stay the base; the
/// lockdown field is injected fresh on every push so the extension's stored
/// `ppBlocking.lockdown` always reflects the desktop's authoritative view.
/// Called from `set_blocking_settings`, the lockdown commands, the applier
/// heartbeat (on expiry), and the handshake — every path that could change
/// either the base settings or the lockdown state.
fn broadcast_blocking(state: &Arc<Mutex<AppState>>, lockdown: &lockdown::LockdownStore) -> usize {
    let view = lockdown.view();
    let (mut settings, allow, escalate, serious) = {
        let s = state.lock().unwrap();
        (
            s.ext_blocking.clone().unwrap_or_else(|| serde_json::json!({})),
            s.lockdown_allow.clone(),
            s.lockdown_escalate,
            s.serious_mode,
        )
    };
    if let Some(obj) = settings.as_object_mut() {
        obj.insert("lockdown".to_string(), lockdown_field(&view, &allow, escalate));
        // Serious Mode (UX Direction §1) is injected from the BACKEND's
        // persisted settings, never from whatever the renderer last pushed —
        // the renderer's copy is a mirror, and a mirror must not be able to
        // tell the extension that Serious Mode is off. The extension reads
        // this for both halves of the flip: its strict enforcement presets,
        // and the voice its pages speak in (voice-sync.js).
        obj.insert("serious".to_string(), serde_json::Value::Bool(serious));
    }
    let msg = serde_json::json!({ "type": "set_blocking", "settings": settings });
    broadcast_to_extensions(state, &msg)
}

/// Persist the lockdown additive-allow list to `<app_data_dir>/lockdown_allow.json`.
fn save_lockdown_allow(app: &AppHandle, allow: &[String]) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(allow) {
            let _ = std::fs::write(dir.join("lockdown_allow.json"), json);
        }
    }
}

// ============================================================================
// Trusted-contact notifier (plan item 5.2, Tier 2) — the OPTIONAL amplifier.
// Solo-first: this whole path is unreachable unless the user has named a
// contact. See notify.rs for the delivery mechanics; this is the app-side
// glue (gate on the notify flag, send off-thread, event-log the outcome).
// ============================================================================

/// Notify the trusted contact of `event_kind` IF one is configured and has
/// that event enabled. Never blocks: resolves the recipient synchronously,
/// then does the actual SMTP/mailto delivery on a background thread. Every
/// send or failure is event-logged (`notify_sent` / `notify_failed`) with
/// only the recipient + kind — never content. A no-op (returns immediately)
/// when no contact is set or the specific event is switched off, so a solo
/// user never triggers any of this.
fn notify_contact(app: &AppHandle, event_kind: &str) {
    let Some(settings) = app.try_state::<Arc<settings::SettingsState>>() else { return };
    let Some(contact) = settings.get().trusted_contact else { return };
    let enabled = match event_kind {
        "uninstall_requested" => contact.notify.uninstall_requested,
        "lockdown_cancelled" => contact.notify.lockdown_cancelled,
        "password_removal_requested" => contact.notify.password_removal_requested,
        "ext_removed" => contact.notify.ext_removed,
        "block_burst" => contact.notify.block_burst,
        "serious_disable_requested" => contact.notify.serious_disable_requested,
        // The unwire notification (5.2's anti-weak-moment rule) and the
        // monthly heartbeat always send when a contact exists — they're not
        // per-event opt-outs.
        "trusted_contact_removed" | "heartbeat" => true,
        _ => false,
    };
    if !enabled || contact.email.trim().is_empty() {
        return;
    }
    let Ok(app_data_dir) = app.path().app_data_dir() else { return };
    let app2 = app.clone();
    let kind = event_kind.to_string();
    std::thread::spawn(move || {
        let (subject, body) = notify::message_for(&kind, &contact.name);
        let recipient = contact.email.trim().to_string();
        match notify::deliver(&app_data_dir, &recipient, &subject, &body) {
            notify::SendOutcome::Sent => {
                log_event(&app2, "notify_sent", serde_json::json!({ "to": recipient, "event": kind, "via": "smtp" }));
            }
            notify::SendOutcome::MailtoDraft(url) => {
                // SMTP unconfigured or failed — open the user's own mail
                // client with a prefilled draft as the fallback. The draft
                // still counts as a send *attempt*; log it as sent-via-mailto
                // so a suppressed notification is still visible in the log.
                let opened = open_external(url).is_ok();
                log_event(
                    &app2,
                    if opened { "notify_sent" } else { "notify_failed" },
                    serde_json::json!({ "to": recipient, "event": kind, "via": "mailto", "opened": opened }),
                );
            }
            notify::SendOutcome::Failed(reason) => {
                log_event(&app2, "notify_failed", serde_json::json!({ "to": recipient, "event": kind, "reason": reason }));
            }
        }
    });
}

/// Restore the display when a grayscale vulnerable-hours window ends (5.6).
///
/// Only ever turns grayscale OFF, and only when Oath Light is the one that
/// turned it on (`GRAYSCALE_UNTIL != 0`). A user who runs the Windows colour
/// filter themselves, all day, every day, is never touched by this.
fn tick_grayscale() {
    let until = GRAYSCALE_UNTIL.load(Ordering::SeqCst);
    if until == 0 || now_unix_ms() < until {
        return;
    }
    GRAYSCALE_UNTIL.store(0, Ordering::SeqCst);
    match grayscale::set(false) {
        Ok(()) => log::info!("grayscale window ended — display restored"),
        Err(e) => log::warn!("could not restore colour after the grayscale window: {e}"),
    }
}

/// Toggle grayscale-during-vulnerable-hours (5.6).
///
/// Instant in BOTH directions, unlike every protection toggle in this file —
/// see `SettingsV1::grayscale_vulnerable_hours` and grayscale.rs for why the
/// friction rule deliberately doesn't apply to an environment nudge. Turning
/// it off also lifts the filter immediately if a window is currently running,
/// rather than leaving the user monochrome until the window would have ended.
#[tauri::command]
fn set_grayscale_vulnerable_hours(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    enabled: bool,
) -> Result<bool, String> {
    settings.update(|s| s.grayscale_vulnerable_hours = enabled);
    if !enabled && GRAYSCALE_UNTIL.load(Ordering::SeqCst) != 0 {
        GRAYSCALE_UNTIL.store(0, Ordering::SeqCst);
        let _ = grayscale::set(false);
    }
    log_event(&app, "grayscale_setting_changed", serde_json::json!({ "enabled": enabled }));
    Ok(enabled)
}

/// Monthly "still protecting" heartbeat (5.2's silent-failure mitigation): if
/// a contact is configured and it's been more than 30 days since the last
/// heartbeat, send one and stamp `last_heartbeat`. So even if every real
/// event notification silently failed to deliver, thirty days of silence from
/// Oath Light is itself a signal the contact would notice. Called from the
/// applier thread's ~minute cadence; the 30-day gate makes the send rare.
fn maybe_send_contact_heartbeat(app: &AppHandle, settings: &Arc<settings::SettingsState>) {
    let Some(contact) = settings.get().trusted_contact else { return };
    if contact.email.trim().is_empty() {
        return;
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;
    // A never-sent (`last_heartbeat == 0`) contact is stamped WITHOUT sending
    // on first sight — a freshly-wired contact shouldn't get a "still
    // protecting" note the same minute they were added; the clock starts now.
    if contact.last_heartbeat == 0 {
        settings.update(|s| {
            if let Some(c) = s.trusted_contact.as_mut() {
                c.last_heartbeat = now;
            }
        });
        return;
    }
    if now.saturating_sub(contact.last_heartbeat) < THIRTY_DAYS {
        return;
    }
    settings.update(|s| {
        if let Some(c) = s.trusted_contact.as_mut() {
            c.last_heartbeat = now;
        }
    });
    notify_contact(app, "heartbeat");
}

// ============================================================================
// TCP Server — accepts connections from native host instances
// ============================================================================

fn start_tcp_server(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:17243") {
            Ok(l) => {
                log::info!("TCP server listening on 127.0.0.1:17243");
                l
            }
            Err(e) => {
                log::error!("Failed to bind TCP listener: {}", e);
                return;
            }
        };

        for stream in listener.incoming() {
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    log::error!("TCP accept error: {}", e);
                    continue;
                }
            };

            let app_clone = app.clone();
            let state_clone = state.clone();
            std::thread::spawn(move || {
                handle_connection(app_clone, state_clone, stream);
            });
        }
    });
}

// ============================================================================
// Elevated-setup coordination
// ============================================================================

/// Set after an elevated setup pass completes, to tell the monitor to flush its
/// per-session enforcement memo and re-read the policy state (which the elevated
/// pass just wrote). Without this the monitor would keep showing the pre-
/// elevation "needs admin" result it had already memoized.
static RE_ENFORCE_REQUESTED: AtomicBool = AtomicBool::new(false);

/// One native-host connection. The host sends `host_hello` first (identifying
/// the browser that spawned it), then relays the extension's messages (which
/// carry the per-profile id).
fn handle_connection(app: AppHandle, state: Arc<Mutex<AppState>>, stream: TcpStream) {
    let conn_id = CONN_SEQ.fetch_add(1, Ordering::Relaxed);
    let writer_clone = stream.try_clone().ok();
    let mut reader = BufReader::new(stream);

    // Register the connection immediately so heartbeats land somewhere.
    {
        let mut s = state.lock().unwrap();
        s.connections.insert(
            conn_id,
            ConnState {
                browser: "unknown".to_string(),
                profile_id: String::new(),
                last_heartbeat: now_unix_ms(),
                extension_version: String::new(),
                writer: writer_clone.as_ref().and_then(|w| w.try_clone().ok()),
            },
        );
    }

    loop {
        match read_tcp_message(&mut reader) {
            Ok(msg) => {
                let mtype = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");

                if mtype == "host_hello" {
                    let key = msg
                        .get("browser")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let bname = msg.get("browserName").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let bproc = msg.get("browserProcess").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    log::info!("[conn {}] native host for browser: {} ({})", conn_id, key, bproc);
                    {
                        let mut s = state.lock().unwrap();
                        if let Some(conn) = s.connections.get_mut(&conn_id) {
                            conn.browser = key.clone();
                            conn.last_heartbeat = now_unix_ms();
                        }
                        // Learn a browser the built-in table doesn't know about.
                        if key != "unknown" && browsers::browser_by_key(&key).is_none() {
                            let name = if bname.is_empty() { key.clone() } else { bname };
                            s.custom_browsers
                                .entry(key.clone())
                                .or_insert(CustomBrowser { name, process: bproc });
                        }
                    }
                    // Ask this profile's extension for fresh data, and push the
                    // current theme + app data so its pages match immediately.
                    let _ = broadcast_to_extensions(&state, &serde_json::json!({ "type": "request_sync" }));
                    let theme = state.lock().unwrap().ext_theme.clone();
                    if let Some(display) = theme {
                        let _ = broadcast_to_extensions(
                            &state,
                            &serde_json::json!({ "type": "set_theme", "display": display }),
                        );
                    }
                    // Push blocking settings WITH lockdown state merged in (4.4)
                    // so a freshly-connecting profile enforces an active
                    // lockdown from its very first navigation. Always pushed
                    // (even with no base settings yet) when a lockdown store is
                    // managed, so the lockdown field is never missing on connect.
                    if let Some(ld) = app.try_state::<Arc<lockdown::LockdownStore>>() {
                        let _ = broadcast_blocking(&state, ld.inner());
                    } else {
                        let blocking = state.lock().unwrap().ext_blocking.clone();
                        if let Some(settings) = blocking {
                            let _ = broadcast_to_extensions(
                                &state,
                                &serde_json::json!({ "type": "set_blocking", "settings": settings }),
                            );
                        }
                    }
                    // Always push the cached custom-site list, even when empty —
                    // an extension may have stale desktop-pushed entries that need
                    // clearing (see `handleSetCustomDomains` in native-bridge.js).
                    let custom_domains = state.lock().unwrap().custom_domains.clone();
                    let _ = broadcast_to_extensions(
                        &state,
                        &serde_json::json!({ "type": "set_custom_domains", "domains": custom_domains }),
                    );
                    broadcast_app_data(&state);
                    continue;
                }

                handle_extension_message(&app, &state, conn_id, &msg);
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => {
                log::warn!("[conn {}] native host disconnected: {}", conn_id, e);
                state.lock().unwrap().connections.remove(&conn_id);
                break;
            }
        }
    }
}

// ============================================================================
// Status aggregation
// ============================================================================

fn engine_str(engine: Engine) -> &'static str {
    match engine {
        Engine::Chromium => "chromium",
        Engine::Gecko => "gecko",
    }
}

fn enforce_str(outcome: EnforceOutcome) -> &'static str {
    match outcome {
        EnforceOutcome::Dormant => "dormant",
        // "enforced" = machine-wide HKLM hard lock (Stage 2, elevated).
        EnforceOutcome::EnforcedMachine => "enforced",
        // "enforced_user" = HKCU user-scope lock (Stage 1 default). Real, but
        // the UI must not claim it's un-removable — the user can delete it.
        EnforceOutcome::EnforcedUser => "enforced_user",
        EnforceOutcome::Failed => "failed",
        // Registered for auto-install via the external-extensions registry (the
        // Edge path). The browser fetches it on its own, then waits for the user
        // to approve it once — so the UI asks for that click, not for admin.
        EnforceOutcome::AutoInstallPendingApproval => "needs_approval",
        // No store will force-install us in this browser on this machine (Edge,
        // unmanaged, no Edge Add-ons listing) and auto-install couldn't be
        // registered either. Admin does not fix it, so the UI must offer a
        // manual install rather than a UAC prompt.
        EnforceOutcome::StoreUnavailable => "store_unavailable",
        EnforceOutcome::Unsupported => "unsupported",
    }
}

/// Build the connected-profile list for one browser, deduped by profile id
/// (latest heartbeat wins) and labelled "Profile 1..N" by stable id order.
fn profiles_for(conns: &HashMap<u64, ConnState>, browser: &str, now: u64) -> Vec<ProfileStatus> {
    let mut by_id: HashMap<String, ProfileStatus> = HashMap::new();
    for c in conns.values() {
        if c.browser != browser {
            continue;
        }
        // Use the profile id once known; before the handshake, fall back to a
        // per-connection placeholder so a connecting profile still shows.
        let id = if c.profile_id.is_empty() {
            format!("pending-{:p}", c as *const _)
        } else {
            c.profile_id.clone()
        };
        let entry = by_id.entry(id.clone()).or_insert(ProfileStatus {
            id: id.clone(),
            label: String::new(),
            connected: false,
            last_heartbeat: 0,
            version: String::new(),
        });
        if c.last_heartbeat >= entry.last_heartbeat {
            entry.last_heartbeat = c.last_heartbeat;
            entry.connected = now.saturating_sub(c.last_heartbeat) < HEARTBEAT_STALE_MS;
            entry.version = c.extension_version.clone();
        }
    }
    let mut v: Vec<ProfileStatus> = by_id.into_values().collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    for (i, p) in v.iter_mut().enumerate() {
        p.label = format!("Profile {}", i + 1);
    }
    v
}

/// Compose a full per-browser status snapshot for the given running set.
///
/// "Installed / missing" comes from the browser's own per-profile record
/// (profiles.rs) — ground truth that survives the MV3 service worker sleeping.
/// The native-messaging heartbeat is only a fallback for browsers whose profile
/// data we can't read (Firefox etc.), where we never force-flag "missing".
fn build_status(
    state: &Arc<Mutex<AppState>>,
    running: &[&'static str],
    proc_names: &[String],
    now: u64,
) -> Vec<BrowserStatus> {
    let s = state.lock().unwrap();
    let mut out: Vec<BrowserStatus> = BROWSERS
        .iter()
        .map(|def| {
            let running_now = running.contains(&def.key);
            let dormant_enf =
                if browsers::enforcement_configured(def.engine) { "off" } else { "dormant" }.to_string();

            // Heartbeat view (used as a "live now" hint and as a fallback).
            let hb = profiles_for(&s.connections, def.key, now);
            let live = hb.iter().any(|p| p.connected);

            match profiles::cached_profiles(def) {
                // Ground truth available.
                Some(list) => {
                    let installed_n = list.iter().filter(|p| p.installed).count();
                    let installed_any = installed_n > 0;
                    let all_installed = installed_any && installed_n == list.len();
                    let version = list
                        .iter()
                        .find(|p| p.installed)
                        .map(|p| p.version.clone())
                        .filter(|v| !v.is_empty())
                        .or_else(|| hb.iter().find(|p| p.connected).map(|p| p.version.clone()))
                        .unwrap_or_default();

                    let profiles: Vec<ProfileStatus> = list
                        .iter()
                        .map(|p| ProfileStatus {
                            id: p.profile_dir.clone(),
                            label: p.name.clone(),
                            connected: p.installed,
                            last_heartbeat: 0,
                            version: p.version.clone(),
                        })
                        .collect();

                    // running + all profiles covered → protected; some but not
                    // all → partial (a profile is missing the extension); none → missing.
                    let state_str = if running_now && all_installed {
                        "running_connected"
                    } else if running_now && installed_any {
                        "running_partial"
                    } else if running_now {
                        "extension_missing"
                    } else if installed_any {
                        "idle"
                    } else {
                        "not_installed"
                    };

                    BrowserStatus {
                        pending_approval: list.iter().any(|p| p.pending_approval),
                        locked_out: false,   // filled in by the monitor (needs settings)
                        lock_grace_secs: 0,  // …and the live BrowserLockState
                        key: def.key.to_string(),
                        name: def.name.to_string(),
                        engine: engine_str(def.engine).to_string(),
                        installed: installed_any,
                        running: running_now,
                        connected: installed_any,
                        extension_version: version,
                        last_heartbeat: hb.iter().map(|p| p.last_heartbeat).max().unwrap_or(0),
                        state: state_str.to_string(),
                        enforcement: dormant_enf,
                        profiles,
                    }
                }
                // No ground truth (e.g. Firefox) — lean on the heartbeat, and
                // never claim "missing" without proof.
                None => {
                    let version = hb
                        .iter()
                        .find(|p| p.connected)
                        .map(|p| p.version.clone())
                        .unwrap_or_default();
                    let installed = live || browsers::is_installed(def);
                    // Running is running — never label a live browser "not running".
                    // Without prefs we can't prove the extension is present, so a
                    // running-but-unconnected browser is "unknown", not "missing".
                    let state_str = if running_now && live {
                        "running_connected"
                    } else if running_now {
                        "running_unknown"
                    } else if installed {
                        "idle"
                    } else {
                        "not_installed"
                    };
                    BrowserStatus {
                        // No prefs to read, so no evidence either way — and this
                        // branch is Firefox/unknown, which `browser_lock` never
                        // touches anyway.
                        pending_approval: false,
                        locked_out: false,
                        lock_grace_secs: 0,
                        key: def.key.to_string(),
                        name: def.name.to_string(),
                        engine: engine_str(def.engine).to_string(),
                        installed,
                        running: running_now,
                        connected: live,
                        extension_version: version,
                        last_heartbeat: hb.iter().map(|p| p.last_heartbeat).max().unwrap_or(0),
                        state: state_str.to_string(),
                        enforcement: dormant_enf,
                        profiles: hb,
                    }
                }
            }
        })
        .collect();

    // Custom browsers (learned from connections). Heartbeat-only: connected ⇒
    // running; their process tells us "running" even while the worker sleeps.
    let customs: Vec<(String, CustomBrowser)> =
        s.custom_browsers.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (key, cb) in customs {
        let hb = profiles_for(&s.connections, &key, now);
        let live = hb.iter().any(|p| p.connected);
        let running_now = !cb.process.is_empty()
            && proc_names.iter().any(|n| n == &cb.process);
        let version = hb.iter().find(|p| p.connected).map(|p| p.version.clone()).unwrap_or_default();
        let state_str = if live {
            "running_connected"
        } else if running_now {
            "running_unknown"
        } else {
            "idle"
        };
        out.push(BrowserStatus {
            // A custom browser is only known to us *because* its extension
            // connected over the native host, so it is protected by definition
            // and never a browser-lock candidate.
            pending_approval: false,
            locked_out: false,
            lock_grace_secs: 0,
            key,
            name: cb.name,
            engine: "custom".to_string(),
            installed: true,
            running: running_now || live,
            connected: live,
            extension_version: version,
            last_heartbeat: hb.iter().map(|p| p.last_heartbeat).max().unwrap_or(0),
            state: state_str.to_string(),
            enforcement: "unsupported".to_string(),
            profiles: hb,
        });
    }

    out
}

// ============================================================================
// Process-level app blocking + evasion-browser detection (plan item 1.3)
// ============================================================================

/// How long a "killed <name>" / "evasion-detected" event stays suppressed
/// after it fires once, so a process that respawns every tick (or a browser
/// left running) doesn't spam the UI/log every 3 seconds. The underlying
/// enforcement (the actual `kill()`) is never throttled by this — only the
/// noise is; see the two call sites below.
const PROCESS_KILL_LOG_THROTTLE: Duration = Duration::from_secs(60);
const EVASION_EMIT_THROTTLE: Duration = Duration::from_secs(5 * 60);

/// Called once per `start_monitor` tick with the process names that tick
/// already scanned (`browsers::running_process_names()` — no extra syscall
/// just to feed this). Two independent, deliberately asymmetric responses:
///
///   a) BLOCKED-LIST KILL — anything the user explicitly named in
///      `cfg.blocked_processes` (Settings -> Blocking -> App blocking) is
///      force-killed on sight, every tick it's seen. This is friction, not a
///      sandbox: a renamed exe slips straight past a name-based check, which
///      the plan accepts as a known limitation rather than a bug to fix here.
///
///   b) EVASION-BROWSER DETECTION — a browser whose whole point on this
///      machine would be dodging the extension: something in
///      `browsers::EVASION_BROWSERS` (Tor, LibreWolf, ...), a running
///      process whose exe path contains "tor browser", or a *portable* copy
///      of a browser we otherwise support (installed outside Program
///      Files/AppData/WindowsApps — see `browsers::is_standard_install_path`).
///      A browser we've *learned* over the native host (`AppState.custom_browsers`
///      — it's running our extension right now) is never flagged, no matter
///      which of the above lists its process name also happens to match.
///      Response is TIERED (plan §1.3): always logged + emitted as an
///      `evasion-detected` event; only actually killed when
///      `cfg.block_unknown_browsers` is on. A merely-portable copy of a KNOWN
///      browser is never killed unless that toggle is set — log-and-warn is
///      the default, because false positives here cost someone their real
///      browser. VPN detection is explicitly out of scope until Lockdown
///      Mode (plan item 4.4) exists.
///
/// Hot-path rule: when nothing is configured (`blocked_processes` empty) and
/// nothing running even looks like it could be an evasion browser, this
/// function costs nothing beyond the two `Vec` scans already needed to check
/// that — no fresh `sysinfo::System`, no extra syscalls, ever. And because a
/// KNOWN browser being open is the normal state of any session, the
/// portable-path check for known browsers only runs on `deep_scan` ticks
/// (every ~30s) — otherwise it alone would force a full exe-path process
/// enumeration every 3 seconds for the life of the app.
fn enforce_processes(
    app: &AppHandle,
    state: &Arc<Mutex<AppState>>,
    cfg: &settings::SettingsV1,
    proc_names: &[String],
    memo: &mut HashMap<String, Instant>,
    deep_scan: bool,
) {
    // Split the candidate classes by cost/urgency: a name on
    // `EVASION_BROWSERS` is rare and always worth an immediate exe-path
    // look, but "some known browser is running" is true on basically every
    // tick of every session — checking those for portable install paths
    // needs a full process enumeration *with exe paths*, so it only runs on
    // the caller's `deep_scan` ticks (every 10th tick ≈ 30s; a portable
    // browser doesn't appear and vanish inside that window).
    let any_evasion_named = proc_names.iter().any(|n| browsers::EVASION_BROWSERS.contains(&n.as_str()));
    let any_known_browser = deep_scan && proc_names.iter().any(|n| browsers::match_browser_process(n).is_some());
    if cfg.blocked_processes.is_empty() && !any_evasion_named && !any_known_browser {
        return;
    }

    // --- a) blocked-list kill ------------------------------------------------
    if !cfg.blocked_processes.is_empty()
        && cfg.blocked_processes.iter().any(|b| proc_names.iter().any(|n| n == b))
    {
        use sysinfo::{ProcessRefreshKind, System};
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessRefreshKind::new());
        for proc in sys.processes().values() {
            let name = proc.name().to_lowercase();
            if !cfg.blocked_processes.contains(&name) {
                continue;
            }
            // The kill itself is never throttled — only the log/event noise.
            proc.kill();
            let now = Instant::now();
            let should_log =
                memo.get(&name).map_or(true, |t| now.duration_since(*t) >= PROCESS_KILL_LOG_THROTTLE);
            if should_log {
                memo.insert(name.clone(), now);
                log::warn!("process enforcement: killed blocked process '{name}'");
                let _ = app.emit(
                    "process-enforcement",
                    serde_json::json!({ "action": "killed", "name": name, "reason": "blocked_list" }),
                );
                // Event log (4.5): the process image name is a policy artifact
                // the user configured themselves, not browsing content —
                // safe (and useful) to record. Throttled by the same `memo`
                // as the emit above so a respawning process doesn't flood it.
                log_event(app, "process_killed", serde_json::json!({ "name": name, "reason": "blocked_list" }));
            }
        }
    }

    // --- b) evasion-browser detection ----------------------------------------
    // Never flag a browser we've learned is actually running our extension
    // over the native host (see `AppState.custom_browsers`).
    if !any_evasion_named && !any_known_browser {
        return;
    }
    let learned_procs: HashSet<String> = {
        let s = state.lock().unwrap();
        s.custom_browsers.values().map(|c| c.process.clone()).collect()
    };
    // Named evasion browsers are always candidates; known browsers (portable-
    // path check) only on deep-scan ticks — see the cost note at the top.
    let candidates: HashSet<String> = proc_names
        .iter()
        .filter(|n| {
            !learned_procs.contains(n.as_str())
                && (browsers::EVASION_BROWSERS.contains(&n.as_str())
                    || (deep_scan && browsers::match_browser_process(n.as_str()).is_some()))
        })
        .cloned()
        .collect();
    if candidates.is_empty() {
        return;
    }

    use sysinfo::{ProcessRefreshKind, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));

    for proc in sys.processes().values() {
        let name = proc.name().to_lowercase();
        if !candidates.contains(&name) {
            continue;
        }
        let exe_path = proc.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let exe_lower = exe_path.to_lowercase();

        let reason = if browsers::EVASION_BROWSERS.contains(&name.as_str()) {
            "evasion_browser"
        } else if exe_lower.contains("tor browser") {
            "tor_browser"
        } else if !exe_path.is_empty() && !browsers::is_standard_install_path(&exe_lower) {
            "portable_browser"
        } else {
            // A known browser running from a standard install path — not evasion.
            continue;
        };

        // Killing follows the toggle every tick it's seen; only the
        // log/event emission below is throttled.
        let killed = cfg.block_unknown_browsers;
        if killed {
            proc.kill();
        }

        let memo_key = format!("{name}|{exe_path}");
        let now = Instant::now();
        let should_emit =
            memo.get(&memo_key).map_or(true, |t| now.duration_since(*t) >= EVASION_EMIT_THROTTLE);
        if should_emit {
            memo.insert(memo_key, now);
            log::warn!(
                "evasion detection: '{name}' ({reason}) at '{exe_path}' — {}",
                if killed { "killed" } else { "logged only (block_unknown_browsers is off)" }
            );
            let _ = app.emit(
                "evasion-detected",
                serde_json::json!({ "name": name, "path": exe_path, "reason": reason, "killed": killed }),
            );
        }
    }
}

// ============================================================================
// Monitor — reconcile running browsers against live connections, emit status,
// and (when configured + guard on) enforce reinstallation of a missing ext.
// ============================================================================

/// Extension-missing trusted-contact debounce (5.2): a browser must sit
/// continuously in `extension_missing` for at least this long (while the
/// uninstall guard is on) before `ext_removed` fires — a brief reconnect blip
/// (browser restart, profile reload) never triggers it, only a removal that
/// genuinely doesn't come back.
const EXT_MISSING_NOTIFY_AFTER_MS: u64 = 5 * 60 * 1000; // 5 minutes

fn start_monitor(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        // Browsers we've already enforced this session, remembering the outcome
        // (which hive/scope the write landed in) so each tick can report it
        // without touching the registry again. Not write-once: it is re-checked
        // against the registry on the ~30s deep cadence below and dropped for
        // any browser whose policy has gone or weakened, which is what makes it
        // an optimisation rather than an assumption that the policy is still
        // there. See `browsers::enforcement_still_present`.
        let mut enforced: HashMap<String, EnforceOutcome> = HashMap::new();
        // Browsers currently seen in the `extension_missing` state, so the
        // event log (4.5) records the EDGE (entering/leaving) rather than one
        // entry every 3s tick for as long as a browser sits missing. Distinct
        // from `enforced` (which tracks policy writes) — this is purely the
        // missing/restored transition memo.
        let mut missing_seen: HashSet<String> = HashSet::new();
        // When each currently-missing browser FIRST went missing (unix ms) —
        // the debounce source for the `ext_removed` trusted-contact
        // notification (5.2): a browser must sit continuously missing for at
        // least `EXT_MISSING_NOTIFY_AFTER_MS` before it fires, so a brief
        // reconnect blip (browser restart, profile reload) never triggers it.
        let mut missing_since: HashMap<String, u64> = HashMap::new();
        // Browsers already notified for the CURRENT missing streak, so the
        // notification fires once per streak, not on every tick past the
        // threshold. Cleared when the browser is restored.
        let mut missing_notified: HashSet<String> = HashSet::new();
        // Process-blocking / evasion-detection noise memo (1.3) — see
        // `enforce_processes`'s doc comment for what's throttled and why.
        let mut process_memo: HashMap<String, Instant> = HashMap::new();
        // Tick counter for the portable-browser deep scan (exe-path
        // enumeration is only worth paying every ~10th tick; named evasion
        // browsers are still checked on every tick regardless).
        let mut enforce_tick: u64 = 0;
        // DoH-policy write memo (1.2): browsers whose "disable DoH" policy is
        // already written this DNS-filter-on session, so `reg` isn't re-run
        // every tick. Cleared when the DNS filter is off (so a re-enable
        // rewrites it) and by `RE_ENFORCE_REQUESTED` (set on enable).
        let mut dns_doh_enforced: HashSet<String> = HashSet::new();
        // Incognito/guest/private lockdown memo (1.5): same idea as the DoH memo,
        // but gated on the guard rather than the DNS filter. Cleared when the
        // guard is off and by `RE_ENFORCE_REQUESTED`.
        let mut lockdown_enforced: HashSet<String> = HashSet::new();

        loop {
            let now = now_unix_ms();
            let proc_names = browsers::running_process_names();
            let running = browsers::detect_running_from(&proc_names);
            let guard_enabled = state.lock().unwrap().guard_enabled;

            // Process-level app blocking + evasion-browser detection (1.3),
            // reusing this tick's process-name scan — see `enforce_processes`.
            // `SettingsState` is managed in `setup()` well before this thread
            // is spawned, so this is never actually unmanaged in practice.
            // `% 10 == 1` (not 0) so the very first tick after launch already
            // runs a deep scan instead of waiting 30s.
            enforce_tick += 1;
            let cfg = app.state::<Arc<settings::SettingsState>>().get();
            enforce_processes(&app, &state, &cfg, &proc_names, &mut process_memo, enforce_tick % 10 == 1);

            // System DNS filter (1.1/1.2): while it's active, (a) health-check
            // the resolver every tick and fail open if it dies (the failsafe),
            // (b) re-pick upstreams if the pair chosen at enable time has gone
            // unreachable (cheap atomic guard, so every tick), (c) revert
            // adapter-DNS drift and check whether anything is answering DNS
            // instead of us, both on a throttled cadence (~30s), and (d) keep
            // the DoH-disable policy written for every browser. When it's off,
            // drop the DoH memo so a later enable re-writes it.
            if let Some(dns) = app.try_state::<Arc<dns_filter::DnsFilterState>>() {
                if dns.is_active() {
                    dns.tick_health_check();
                    if dns.tick_recheck_upstreams() {
                        log_event(&app, "dns_upstreams_repicked", serde_json::json!({}));
                    }
                    if enforce_tick % 10 == 1 {
                        let reverted = dns.tick_revert_drift();
                        if reverted > 0 {
                            log_event(&app, "dns_changed", serde_json::json!({ "adapters_reverted": reverted }));
                        }
                        // Event only, never content (4.5): counts and flags, not
                        // adapter names — the status card carries those for the
                        // user, the log only needs the transition.
                        if let Some(ex) = dns.tick_detect_exposure() {
                            log_event(&app, "dns_exposure", serde_json::json!({
                                "clear": ex.is_clear(),
                                "adapters": ex.adapters.len(),
                                "nrpt_catch_all": ex.nrpt_catch_all,
                            }));
                        }
                    }
                    if RE_ENFORCE_REQUESTED.load(Ordering::SeqCst) {
                        dns_doh_enforced.clear();
                    }
                    for def in BROWSERS {
                        if !dns_doh_enforced.contains(def.key) {
                            let o = browsers::enforce_dns_policy(def);
                            dns_doh_enforced.insert(def.key.to_string());
                            log::info!("[{}] DoH-disable policy write: {}", def.key, enforce_str(o));
                        }
                    }
                } else if !dns_doh_enforced.is_empty() {
                    dns_doh_enforced.clear();
                }
            }

            // Browser lockdown policy (1.5): while the guard is on, close the
            // surfaces force-install can't reach — Incognito/Private windows
            // (the extension doesn't run there) and Guest profiles (no extensions
            // at all). Written once per session per browser (like the DoH memo);
            // the policy itself is removed only on sanctioned uninstall, so — as
            // with force-install — turning the guard off stops re-asserting but
            // does not instantly reopen the bypass.
            if guard_enabled {
                if RE_ENFORCE_REQUESTED.load(Ordering::SeqCst) {
                    lockdown_enforced.clear();
                }
                for def in BROWSERS {
                    if !lockdown_enforced.contains(def.key) {
                        let o = browsers::enforce_incognito_guest_policy(def);
                        lockdown_enforced.insert(def.key.to_string());
                        log::info!("[{}] incognito/guest lockdown policy write: {}", def.key, enforce_str(o));
                    }
                }
            } else if !lockdown_enforced.is_empty() {
                lockdown_enforced.clear();
            }

            let mut statuses = build_status(&state, &running, &proc_names, now);

            // extension_missing edge tracking (4.5): log only on the
            // transition into/out of "extension_missing" (a browser is
            // running but its extension isn't present), never every tick.
            // Also the debounce source for the 5.2 "ext removed and not
            // restored within N minutes" trusted-contact notification below.
            for st in statuses.iter() {
                let missing = st.state == "extension_missing";
                if missing && !missing_seen.contains(&st.key) {
                    missing_seen.insert(st.key.clone());
                    missing_since.insert(st.key.clone(), now);
                    log_event(&app, "extension_missing", serde_json::json!({ "browser": st.key }));
                } else if !missing && missing_seen.remove(&st.key) {
                    missing_since.remove(&st.key);
                    missing_notified.remove(&st.key);
                    log_event(&app, "extension_restored", serde_json::json!({ "browser": st.key }));
                } else if missing
                    && guard_enabled
                    && !missing_notified.contains(&st.key)
                    && missing_since
                        .get(&st.key)
                        .is_some_and(|since| now.saturating_sub(*since) >= EXT_MISSING_NOTIFY_AFTER_MS)
                {
                    // 5.2, Tier 2: still missing after the debounce window AND
                    // protection is actually supposed to be on (`guard_enabled`)
                    // — this is exactly "extension removed and not restored
                    // within N minutes" from the plan. Tier 1 (solo, always)
                    // gets its own log entry regardless of whether a trusted
                    // contact is configured; `notify_contact` itself is a
                    // no-op unless one is (solo-first).
                    missing_notified.insert(st.key.clone());
                    log_event(&app, "extension_missing_confirmed", serde_json::json!({ "browser": st.key }));
                    notify_contact(&app, "ext_removed");
                }
            }

            // An elevated setup pass just wrote policy — drop the memo so every
            // browser re-reads its (now written) state this tick.
            if RE_ENFORCE_REQUESTED.swap(false, Ordering::SeqCst) {
                enforced.clear();
            }

            // …and on the same ~30s deep cadence the DNS drift check uses, verify
            // that what we think we enforced is still really there, dropping the
            // memo for anything that has gone or weakened so the write below
            // re-runs. Polishing.md asks the app to "constantly make sure the
            // extension is installed regardless if it was before"; the browser's
            // own policy-driven reinstall covers the extension being removed, but
            // nothing covered the POLICY being removed — and the HKCU fallback
            // that most unelevated installs land on can be deleted without so
            // much as a prompt. Until this ran, that left the row reporting a
            // lock it no longer held for the rest of the session.
            //
            // Costs at most two `reg query` spawns per already-enforced browser
            // every ~30s (outcomes that wrote nothing are free), which is the
            // same order as the `is_installed_cached` probe on the tick above.
            if guard_enabled && enforce_tick % 10 == 1 {
                enforced.retain(|key, outcome| {
                    browsers::browser_by_key(key)
                        .is_some_and(|def| browsers::enforcement_still_present(def, *outcome))
                });
            }

            // Proactive force-install: lock every supported browser present on
            // this machine while the guard is on — not only ones whose extension
            // already went missing — so a fresh, healthy install is pinned
            // before any removal attempt.
            for st in statuses.iter_mut() {
                let def = match browsers::browser_by_key(&st.key) {
                    Some(d) => d,
                    None => continue,
                };
                if !guard_enabled {
                    enforced.remove(&st.key);
                    st.enforcement = "off".to_string();
                    continue;
                }
                if !browsers::enforcement_configured(def.engine) {
                    // No store URL configured for this engine (defensive — both
                    // Chromium and Gecko are configured now).
                    st.enforcement = "dormant".to_string();
                    continue;
                }
                // "Is this browser on the machine", which is NOT `st.installed`.
                // For a Chromium browser whose profiles we can read, `installed`
                // means *the extension* is present in some profile — so gating
                // enforcement on it made the policy conditional on the extension
                // already being there, and a browser that never had it (the only
                // case that needs pinning) was skipped unless it happened to be
                // running at that moment. That is why a fresh install left Chrome
                // unpinned until the user opened it with the app already up.
                if !(st.running || st.installed || browsers::is_installed_cached(def)) {
                    // Not present on this machine — nothing to pin.
                    st.enforcement = "off".to_string();
                    continue;
                }
                // Web-Store force-install (STORE_EXTENSION_ID via the CWS update
                // URL) needs neither of the guards the old self-hosted path did:
                // it is honored on ordinary *unmanaged* consumer machines, and
                // Google serves the CRX — so there is no enterprise-only gate and
                // no localhost update server that has to be "ready" first. With a
                // real published extension behind the canonical CWS URL there is
                // no dead-URL brick to guard against either.
                let outcome = if let Some(&cached) = enforced.get(&st.key) {
                    cached
                } else {
                    let o = browsers::enforce_policy(def);
                    // Memoize EVERY decisive outcome, including Failed, so we
                    // don't re-run `reg` every tick. Toggling the guard clears
                    // this memo; the Restore button calls enforce_policy directly.
                    enforced.insert(st.key.clone(), o);
                    log::warn!("[{}] force-install policy write: {}", st.key, enforce_str(o));
                    o
                };
                // "enforced"/"locked" must mean the extension is actually present,
                // not merely that the policy was written — that conflation is what
                // made the UI claim "locked" while nothing was installed. Re-derive
                // the reported status from profile ground truth each tick: a written
                // policy with no real install is "pending" (the browser may still
                // be fetching the extension from the Web Store), never a green
                // "locked".
                //
                // Machine and user scope stay distinguishable while pending,
                // because the useful next action differs: a user-scope policy can
                // still be upgraded to the machine-wide lock with one UAC prompt,
                // and offering that upgrade is the whole point of the button.
                // Collapsing both into a single "pending" is what left the UI with
                // nothing to offer but a re-apply that changed nothing.
                st.enforcement = match outcome {
                    EnforceOutcome::EnforcedMachine if !st.installed => "pending".to_string(),
                    EnforceOutcome::EnforcedUser if !st.installed => "pending_user".to_string(),
                    // Auto-install landed and the user has approved it — the
                    // extension is genuinely running. Report that plainly and
                    // stop nagging, but never as "locked": nothing pins it.
                    EnforceOutcome::AutoInstallPendingApproval if st.installed => {
                        "auto_installed".to_string()
                    }
                    other => enforce_str(other).to_string(),
                };
            }

            // Browser lock: a browser that can't be force-installed doesn't get
            // to run without the extension. Runs after the loop above so it sees
            // this tick's freshly-written policy rather than last tick's.
            enforce_browser_lock(&app, &cfg, guard_enabled, &mut statuses);

            let _ = app.emit("browsers-status", &statuses);
            std::thread::sleep(MONITOR_TICK);
        }
    });
}

/// How long a "killed <browser>" browser-lock event stays suppressed after the
/// last one. The kill itself is never throttled — only the log/event noise.
///
/// This needs to be generous because Edge does not stay dead politely: startup
/// boost and background mode respawn `msedge.exe` on their own, so a locked-out
/// Edge produces a kill every few seconds indefinitely. That is the feature
/// working, but it must not also mean an event-log entry every few seconds
/// forever.
const BROWSER_LOCK_EMIT_THROTTLE: Duration = Duration::from_secs(60);

/// Kill any browser that cannot be force-installed and is running without the
/// extension, unless it holds a restore window (see `browser_lock`).
///
/// **Why killing is the only lever here.** For every other browser the app pins
/// the extension with a policy and the browser itself puts it back. Edge on a
/// consumer machine refuses that policy outright, so "protected" there is
/// whatever the user last chose — which on a machine running this app is exactly
/// the thing that shouldn't be up to the user at 2am. Making the browser
/// unusable until the extension is on is the remaining lever.
///
/// Three guards keep this from being a browser that randomly dies:
///   * it does nothing unless the user turned it on AND the guard is on;
///   * it only ever touches `browsers::requires_manual_install` browsers, so a
///     force-installable one is never killed (killing one would *prevent* the
///     launch during which its policy reinstalls the extension); and
///   * it needs real ground truth from the profile scan. Unreadable prefs are
///     not evidence, and must never be able to brick a browser.
fn enforce_browser_lock(
    app: &AppHandle,
    cfg: &settings::SettingsV1,
    guard_enabled: bool,
    statuses: &mut [BrowserStatus],
) {
    let Some(locks) = app.try_state::<Arc<browser_lock::BrowserLockState>>() else { return };
    if !cfg.lock_unverified_browsers || !guard_enabled {
        // Turning it off (or the guard off) must not leave a stale window that
        // would grant a free pass the moment it comes back on.
        locks.clear_all();
        return;
    }

    // Which browsers need killing this tick, decided before any process work —
    // the enumeration below is only worth paying for if something is actually
    // going to be killed, and in the steady state nothing is.
    let mut condemned: Vec<&'static browsers::BrowserDef> = Vec::new();
    for st in statuses.iter_mut() {
        let Some(def) = browsers::browser_by_key(&st.key) else { continue };
        if !browsers::requires_manual_install(def) {
            continue;
        }
        // The only exemption: this is the machine's one browser, so bricking it
        // would leave no way to reach anything — including a second browser.
        let sole_browser = !browsers::has_alternative_browser(def);
        st.locked_out = !sole_browser;

        // …and record it when it engages. The exemption is a real hole — a user
        // who uninstalls every other browser gets an unenforced one back — and
        // the standing rule here is that the app never silently stops delivering
        // protection it is configured for. Deliberately an event-log entry and
        // NOT UI copy: writing "your only browser is exempt" on screen would be
        // publishing the recipe (VOICE.md, "status yes, map no"). One entry per
        // transition, not one per tick.
        {
            let mut seen = browser_lock_exempt_memo().lock().unwrap();
            if seen.insert(def.key, sole_browser) != Some(sole_browser) {
                if sole_browser {
                    log::warn!(
                        "browser_lock: [{}] exempt — it is the only browser on this machine, so \
                         locking it would leave no way to browse at all",
                        def.key
                    );
                }
                log_event(
                    app,
                    "browser_lock_exempt",
                    serde_json::json!({ "browser": def.key, "exempt": sole_browser }),
                );
            }
        }

        // Read the profiles directly rather than leaning on `st.installed`: the
        // decision needs "every profile has it" (a second profile without the
        // extension is a fully usable unprotected browser), plus whether we
        // could read them at all — neither of which `installed` distinguishes.
        let facts = match profiles::cached_profiles(def) {
            Some(list) => browser_lock::BrowserFacts {
                protected: !list.is_empty() && list.iter().all(|p| p.installed),
                ground_truth: true,
                sole_browser,
            },
            None => browser_lock::BrowserFacts {
                protected: false,
                ground_truth: false,
                sole_browser,
            },
        };
        if locks.decide(&st.key, facts) == browser_lock::LockDecision::Kill && st.running {
            condemned.push(def);
        }
        st.lock_grace_secs = locks.remaining_secs(&st.key);
    }
    if condemned.is_empty() {
        return;
    }

    let names: HashSet<String> =
        condemned.iter().flat_map(|d| d.process_names.iter().map(|n| n.to_string())).collect();
    use sysinfo::{ProcessRefreshKind, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new());
    let mut killed: HashMap<&'static str, usize> = HashMap::new();
    for proc in sys.processes().values() {
        let name = proc.name().to_lowercase();
        if !names.contains(&name) {
            continue;
        }
        let Some(def) = browsers::match_browser_process(&name) else { continue };
        if !condemned.iter().any(|d| d.key == def.key) {
            continue;
        }
        proc.kill();
        *killed.entry(def.key).or_default() += 1;
    }

    let now = Instant::now();
    let mut memo = browser_lock_emit_memo().lock().unwrap();
    for (key, count) in killed {
        if count == 0 {
            continue;
        }
        let stale = memo
            .get(key)
            .map(|t| now.duration_since(*t) >= BROWSER_LOCK_EMIT_THROTTLE)
            .unwrap_or(true);
        if !stale {
            continue;
        }
        memo.insert(key, now);
        log::warn!(
            "browser_lock: killed {count} '{key}' process(es) — the extension is not installed \
             and no restore window is open"
        );
        let _ = app.emit(
            "browser-locked-out",
            serde_json::json!({ "browser": key, "processes": count }),
        );
        log_event(app, "browser_locked_out", serde_json::json!({ "browser": key }));
    }
}

/// Last browser-lock emit per browser, for `BROWSER_LOCK_EMIT_THROTTLE`.
///
/// A process-wide `static` rather than a monitor-loop local because
/// `request_browser_restore` clears it: someone who has just deliberately asked
/// for a window deserves to see the outcome of *that* attempt, not silence
/// because an identical kill happened to be logged 40s ago. Same `OnceLock<
/// Mutex<HashMap<…>>>` shape as `browsers::is_installed_cached`.
fn browser_lock_emit_memo() -> &'static Mutex<HashMap<&'static str, Instant>> {
    static MEMO: OnceLock<Mutex<HashMap<&'static str, Instant>>> = OnceLock::new();
    MEMO.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Last known "is this browser exempt from the lock" per browser, so the
/// transition is logged once rather than every 3s tick for as long as it holds.
fn browser_lock_exempt_memo() -> &'static Mutex<HashMap<&'static str, bool>> {
    static MEMO: OnceLock<Mutex<HashMap<&'static str, bool>>> = OnceLock::new();
    MEMO.get_or_init(|| Mutex::new(HashMap::new()))
}

// ============================================================================
// Native host registration (on every startup — idempotent)
// ============================================================================

fn register_native_host(app: &AppHandle) {
    // Create every browser's policy key tree first, before the user is likely
    // to have opened a browser this session. An empty policy key changes no
    // behaviour, but it is what lets a RUNNING Chromium notice the
    // force-install policy we write later WITHOUT being restarted: the browser
    // registers a registry change-notification on its policy key at launch, and
    // a key that does not exist yet cannot be watched. This is the fix for "the
    // extension only appeared after I restarted the browser". Idempotent and
    // unelevated-safe — an HKLM failure just leaves the HKCU key, which is the
    // hive the fallback write targets anyway.
    for def in BROWSERS {
        browsers::ensure_policy_key(def);
    }

    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to get app data dir: {}", e);
            return;
        }
    };
    let _ = std::fs::create_dir_all(&app_data_dir);

    let host_binary = resolve_host_binary(&app_data_dir);
    log::info!("Native host binary resolved to: {:?}", host_binary);

    let (chromium_manifest, gecko_manifest) =
        match browsers::write_manifests(&app_data_dir, &host_binary) {
            Ok(p) => p,
            Err(e) => {
                log::error!("Failed to write native host manifests: {}", e);
                return;
            }
        };

    browsers::register_all_hosts(&chromium_manifest, &gecko_manifest);
    log::info!("Native host registered for all known browsers");
}

/// Find the native host binary: next to the Tauri exe (production), then the
/// dev build dirs, then the app data dir.
///
/// A.1 workspace note: `native-host` is now a workspace member, so `cargo
/// build` deposits its binary in the shared `desktop-app/target/...`, not
/// `desktop-app/native-host/target/...` — and since the main app is *also*
/// built into that same shared dir, the first candidate below (next to our
/// own exe) now matches in a workspace dev build too. The old per-crate
/// `native-host/target/...` candidates are kept (harmless) for a pre-
/// workspace build tree; the new `target/...` (workspace-root-relative)
/// candidates cover the shared-target case if this exe ever runs from
/// somewhere other than that shared dir.
fn resolve_host_binary(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    let host_binary_name = if cfg!(windows) { "oath-light-host.exe" } else { "oath-light-host" };

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    let mut candidates: Vec<std::path::PathBuf> = vec![exe_dir.join(host_binary_name)];

    let mut dir = exe_dir.clone();
    for _ in 0..6 {
        candidates.push(dir.join("target").join("debug").join(host_binary_name));
        candidates.push(dir.join("target").join("release").join(host_binary_name));
        candidates.push(dir.join("native-host").join("target").join("debug").join(host_binary_name));
        candidates.push(dir.join("native-host").join("target").join("release").join(host_binary_name));
        if !dir.pop() {
            break;
        }
    }
    candidates.push(app_data_dir.join(host_binary_name));

    candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| exe_dir.join(host_binary_name))
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
fn get_extension_stats(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> ExtensionStats {
    state.lock().unwrap().stats.clone()
}

#[tauri::command]
fn get_extension_blocklists(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> ExtensionBlocklists {
    let mut s = state.lock().unwrap();
    fill_built_in_lists(&mut s.blocklists);
    s.blocklists.clone()
}

/// Domain/keyword counts for honest "X domains blocked" UI copy — falls back
/// to the built-in bundled counts until an extension has actually synced its
/// (larger, possibly customized) merged lists.
#[derive(Debug, Clone, Serialize)]
pub struct BlocklistCounts {
    pub domain_count: usize,
    pub keyword_count: usize,
}

#[tauri::command]
fn get_blocklist_counts(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> BlocklistCounts {
    let mut s = state.lock().unwrap();
    fill_built_in_lists(&mut s.blocklists);
    let domain_count = if !s.blocklists.domains.is_empty() {
        s.blocklists.domains.len()
    } else {
        s.blocklists.built_in_domains.len()
    };
    let keyword_count = if !s.blocklists.keywords.is_empty() {
        s.blocklists.keywords.len()
    } else {
        s.blocklists.built_in_keywords.len()
    };
    BlocklistCounts { domain_count, keyword_count }
}

/// Result of a "is this domain blocked" lookup (the desktop-side equivalent of
/// the extension's own `checkDomainBlocked` message handler).
#[derive(Debug, Clone, Serialize)]
pub struct CheckedDomain {
    pub domain: String,
    pub blocked: bool,
}

/// Check a domain against the effective domain list (synced list if an
/// extension has ever pushed one, else the bundled built-ins), matching an
/// exact entry OR a parent registrable domain (`sub.x.com` matches `x.com`).
/// Builds a tiny candidate-suffix list from the query itself and does one
/// linear pass over the (possibly huge) list, rather than building a HashSet
/// on every call.
#[tauri::command]
fn check_domain_blocked(state: tauri::State<'_, Arc<Mutex<AppState>>>, domain: String) -> CheckedDomain {
    let d = normalize_domain(&domain);
    let mut s = state.lock().unwrap();
    fill_built_in_lists(&mut s.blocklists);
    let list: &Vec<String> =
        if !s.blocklists.domains.is_empty() { &s.blocklists.domains } else { &s.blocklists.built_in_domains };

    let parts: Vec<&str> = d.split('.').collect();
    let mut candidates: Vec<String> = vec![d.clone()];
    if parts.len() > 2 {
        for i in 1..parts.len() - 1 {
            candidates.push(parts[i..].join("."));
        }
    }

    let blocked = list.iter().any(|entry| candidates.iter().any(|c| c == entry));
    CheckedDomain { domain: d, blocked }
}

/// Push the renderer's "my blocklist" custom sites (`blocklist.customSites`)
/// down to every connected extension, and cache + persist them so a freshly-
/// connecting profile (or a restart) still has them — the renderer's
/// localStorage stays the source of truth; this is just the sync mechanism.
///
/// ADDITIONS-ONLY (4.1): the incoming list is unioned into the existing one —
/// any domain currently blocked but missing from `domains` is deliberately
/// left blocked rather than dropped. Dropping a block is a weakening, and
/// weakenings only happen through the friction-gated `remove_custom_domain`.
/// This matters because the renderer sends its FULL `customSites` list on
/// every change: if this command removed anything absent from that list, a
/// stale/wiped renderer `localStorage` (or just a race on startup) would
/// silently unblock every custom site with no delay at all.
#[tauri::command]
fn set_custom_domains(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    domains: Vec<String>,
) {
    let incoming = normalize_domain_list(&domains);
    let merged = {
        let mut s = state.lock().unwrap();
        let dropped = s.custom_domains.iter().filter(|d| !incoming.contains(d)).count();
        if dropped > 0 {
            log::info!(
                "set_custom_domains: ignoring {dropped} removal(s) implied by the incoming list — \
                 use remove_custom_domain to actually unblock a site"
            );
        }
        let mut merged = s.custom_domains.clone();
        for d in &incoming {
            if !merged.contains(d) {
                merged.push(d.clone());
            }
        }
        s.custom_domains = merged.clone();
        merged
    };
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(&merged) {
            let _ = std::fs::write(dir.join("custom_domains.json"), json);
        }
    }
    let msg = serde_json::json!({ "type": "set_custom_domains", "domains": merged });
    let _ = broadcast_to_extensions(state.inner(), &msg);

    // Re-adding a domain withdraws any pending removal of it — a
    // strengthening, so it is never gated.
    for d in &incoming {
        friction.cancel(&format!("custom_block.remove:{d}"));
    }
}

/// Request removal of a custom-blocked domain (a weakening, gated behind the
/// friction store — see `friction.rs`). The domain stays blocked until the
/// delay elapses and the applier thread (in `setup`) actually removes it and
/// re-broadcasts the updated list; this only registers the request.
///
/// Also gated behind the master password (4.2), if one is set — checked
/// AFTER the "does this domain even exist" validation below (no point
/// prompting for a password over a no-op) but BEFORE the friction request
/// itself is ever registered, so a wrong/missing password leaves no trace of
/// the attempt in the pending-changes list.
#[tauri::command]
fn remove_custom_domain(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    domain: String,
    auth: Option<String>,
) -> Result<friction::PendingView, String> {
    let norm = normalize_domain(&domain);
    if norm.is_empty() {
        return Err("Not a valid domain.".to_string());
    }
    let present = state.lock().unwrap().custom_domains.contains(&norm);
    if !present {
        return Err(format!("{norm} is not in the custom blocklist."));
    }
    auth::require_auth(&app, &auth)?;
    let action_id = format!("custom_block.remove:{norm}");
    let view = friction.request(&action_id, &format!("Unblock {norm}"), serde_json::json!({ "domain": norm }));
    log::warn!(
        "custom-block removal requested for {norm} — {}s cool-off started (still blocked)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "custom_block.remove" }));
    Ok(view)
}

/// Every currently pending weakening (across the uninstall guard, the AI
/// monitor, and any custom-block removals) — the settings page's "Pending
/// changes" card and the blocking/blocklist pages' inline notes all read from
/// this same list.
#[tauri::command]
fn get_pending_weakenings(friction: tauri::State<'_, Arc<friction::FrictionStore>>) -> Vec<friction::PendingView> {
    friction.list()
}

/// Cancel a pending weakening outright — always a strengthening, so it is
/// never gated by its own delay. Refuses `"uninstall"`: that flow has its own
/// dedicated commands (`cancel_uninstall`) which additionally keep
/// `uninstall.json` in sync for the watchdog/guardian — routing it through
/// here instead would skip that mirror write.
#[tauri::command]
fn cancel_weakening(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    action_id: String,
) -> Result<(), String> {
    if action_id == "uninstall" {
        return Err("Use the uninstall page's own cancel action instead.".to_string());
    }
    if friction.cancel(&action_id) {
        log_event(&app, "friction_cancelled", serde_json::json!({ "action": action_id }));
    }
    Ok(())
}

/// Current per-browser status (same shape as the `browsers-status` event).
#[tauri::command]
fn get_browsers_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Vec<BrowserStatus> {
    let now = now_unix_ms();
    let proc_names = browsers::running_process_names();
    let running = browsers::detect_running_from(&proc_names);
    build_status(state.inner(), &running, &proc_names, now)
}

/// Mirror the app's clean-streak day count down to the extensions so their
/// pages show the same number the app does.
#[tauri::command]
fn set_app_streak(state: tauri::State<'_, Arc<Mutex<AppState>>>, streak: u64) {
    state.lock().unwrap().app_streak = streak;
    broadcast_app_data(state.inner());
}

/// Outcome of a request to weaken protection (turn something off). `applied`
/// is true when the change took effect immediately (either it was a
/// strengthening, or nothing needed to change); when false, `pending` carries
/// the friction-gated request that must elapse before it actually applies —
/// the caller (Rust or JS) must treat the protection as still ON in that case.
#[derive(Debug, Clone, Serialize)]
pub struct WeakeningOutcome {
    pub applied: bool,
    pub pending: Option<friction::PendingView>,
}

/// Toggle the "keep the extension installed" guard (the uninstall-guard
/// switch). Turning it ON is always instant (a strengthening) and withdraws
/// any pending disable. Turning it OFF is a weakening (4.1): the guard stays
/// ON until the friction delay elapses and the applier thread (in `setup`)
/// actually flips it — this only registers the request and returns it.
///
/// Master-password gate (4.2) applies ONLY to the actual off-and-currently-on
/// path below: enabling and the already-off no-op are both intentionally
/// ungated (see `auth.rs`'s module doc — strengthenings and no-ops never
/// require the password, only the one branch that actually starts a
/// weakening's cool-off).
#[tauri::command]
fn set_guard_enabled(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        state.lock().unwrap().guard_enabled = true;
        settings.update(|s| s.guard_enabled = true);
        friction.cancel("guard.disable");
        log::info!("Guard enabled set to true");
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    let already_off = !state.lock().unwrap().guard_enabled;
    if already_off {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    auth::require_auth(&app, &auth)?;

    let view = friction.request("guard.disable", "Turn off the uninstall guard", serde_json::json!({}));
    log::warn!(
        "guard disable requested — {}s cool-off started (guard stays on until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "guard.disable" }));
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

// ============================================================================
// System-level DNS filtering (plan items 1.1 + 1.2) — commands.
// Lifecycle/health/takeover live in `dns_filter.rs`; these mirror the
// `set_guard_enabled` pattern exactly: enabling is a strengthening (instant),
// disabling is a friction-gated weakening (`dns.disable`).
// ============================================================================

/// Live status the renderer's "System DNS filter" card reads:
/// `{ running, taken_over, last_error, upstreams, upstream_warning,
/// exposure_warning }` — see `DnsStatus` for why the three failure strings are
/// separate fields rather than one message.
#[tauri::command]
fn get_dns_status(dns: tauri::State<'_, Arc<dns_filter::DnsFilterState>>) -> dns_filter::DnsStatus {
    dns.status()
}

/// Turn the system DNS filter on or off.
///
/// ON is a strengthening — applied instantly: start the resolver, verify it's
/// healthy, then capture + take over adapter DNS. Also cancels any pending
/// `dns.disable` weakening. A bind conflict (port 53 already in use) or a
/// failed takeover surfaces as an `Err` string the UI shows verbatim, and no
/// adapter is touched in the bind-conflict case.
///
/// OFF is a weakening — `require_auth` (master password, 4.2) then a
/// `dns.disable` friction entry; the filter stays fully ON until the delay
/// elapses and the applier thread actually stops the resolver + restores DNS.
#[tauri::command]
fn set_dns_filter_enabled(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    dns: tauri::State<'_, Arc<dns_filter::DnsFilterState>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        // Strengthening: bring the resolver up + take over now. If this
        // fails (port conflict / no admin), report it and DON'T flip the
        // persisted flag — the filter genuinely isn't on.
        dns.enable()?;
        settings.update(|s| s.dns_filter_enabled = true);
        friction.cancel("dns.disable");
        RE_ENFORCE_REQUESTED.store(true, Ordering::SeqCst); // reapply DoH policy this tick
        log::info!("DNS filter enabled");
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    let already_off = !settings.get().dns_filter_enabled;
    if already_off {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    auth::require_auth(&app, &auth)?;

    let view = friction.request("dns.disable", "Turn off the system DNS filter", serde_json::json!({}));
    log::warn!(
        "DNS filter disable requested — {}s cool-off started (filter stays on until it elapses)",
        view.delay_secs
    );
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

// ============================================================================
// Browser lock (Edge) — commands. The state machine is `browser_lock`, the
// killing is `enforce_browser_lock` on the monitor tick; these are the two
// things the user can do about it.
// ============================================================================

/// Turn the browser lock on or off.
///
/// ON is a strengthening — instant, and it takes effect on the next monitor
/// tick. It also cancels any pending `browser_lock.disable`.
///
/// OFF is a weakening: `require_auth` then a friction entry, exactly like the
/// DNS filter and the uninstall guard. The lock stays fully on until the delay
/// elapses. That asymmetry is the point — this is the protection most likely to
/// be resented in the moment it is working.
#[tauri::command]
fn set_browser_lock_enabled(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    locks: tauri::State<'_, Arc<browser_lock::BrowserLockState>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        settings.update(|s| s.lock_unverified_browsers = true);
        friction.cancel("browser_lock.disable");
        // A window opened before the lock was last turned off must not survive
        // into the new session as a free pass.
        locks.clear_all();
        log::info!("browser lock enabled");
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    if !settings.get().lock_unverified_browsers {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }
    auth::require_auth(&app, &auth)?;
    let view =
        friction.request("browser_lock.disable", "Turn off the browser lock", serde_json::json!({}));
    log::warn!(
        "browser lock disable requested — {}s cool-off started (lock stays on until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "browser_lock.disable" }));
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

/// Open a restore window for one locked-out browser: re-assert the auto-install
/// registration, launch the browser at its own extensions page, and stop killing
/// it for `browser_lock::GRACE_WINDOW`.
///
/// **Not a weakening, and deliberately not friction-gated.** It grants seconds,
/// not access: the only thing a user can do with the window is *install the
/// extension*, which is the outcome the lock exists to produce. Putting a
/// 24-hour cool-off in front of the one action that ends the lockout would make
/// the lockout unrecoverable rather than strict.
///
/// Launching the browser ourselves is load-bearing, not a convenience. The
/// extension can only download while the browser runs, and the approval toggle
/// only exists inside it — so a window with no browser in it is 20 seconds of
/// nothing. Starting it at `edge://extensions` also puts the user on the exact
/// page holding the switch they need.
#[tauri::command]
fn request_browser_restore(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    locks: tauri::State<'_, Arc<browser_lock::BrowserLockState>>,
    browser_key: String,
) -> Result<u64, String> {
    let def = browsers::browser_by_key(&browser_key).ok_or("Unknown browser")?;
    if !browsers::requires_manual_install(def) {
        return Err(format!("{} isn't locked — it force-installs the extension", def.name));
    }
    if !settings.get().lock_unverified_browsers {
        return Err("The browser lock is off — nothing is being blocked".to_string());
    }

    // Make sure the thing the window exists to complete is actually registered.
    // If an earlier write failed (or the user deleted the key), the browser
    // would launch, find nothing to install, and burn the window for nothing.
    let outcome = browsers::enforce_policy(def);
    log::info!("browser_lock: [{browser_key}] restore requested — registration: {}", enforce_str(outcome));

    let secs = locks.grant(&browser_key);
    // Let the next failure speak even if one was just logged.
    browser_lock_emit_memo().lock().unwrap().remove(def.key);
    log_event(&app, "browser_restore_granted", serde_json::json!({ "browser": def.key, "seconds": secs }));

    // Best-effort: a launch failure is not fatal — the window is open either
    // way and the user can start the browser themselves.
    if let Some(exe) = browsers::installed_exe_path(def) {
        if let Err(e) = std::process::Command::new(exe).arg(def.extensions_page).spawn() {
            log::warn!("browser_lock: could not launch {} for its restore window: {e}", def.name);
        }
    }
    Ok(secs)
}

// ============================================================================
// Process-level app blocking + evasion-browser detection (plan item 1.3) —
// commands. Enforcement itself lives in `enforce_processes`, run every
// `start_monitor` tick; these just read/mutate the persisted config it reads.
// ============================================================================

/// Backend-owned settings, for the renderer's "App blocking" section (and
/// anywhere else that wants an honest read of what's actually persisted,
/// rather than the renderer's own possibly-stale localStorage copy).
#[tauri::command]
fn get_app_settings(settings: tauri::State<'_, Arc<settings::SettingsState>>) -> settings::SettingsV1 {
    let mut s = settings.get();
    // The mentor's API key is the one field on this struct that must never
    // cross into the webview. Everything else here is already visible in the
    // UI; a credential is not, and a renderer that never receives it cannot
    // leak it through devtools, a crash report, or a future bug. `get_mentor_config`
    // reports whether a key exists without ever handing over its value.
    s.mentor.api_key = String::new();
    s
}

// ============================================================================
// AI mentor (optional, opt-in) — see mentor.rs for the four safety layers.
// ============================================================================

/// What the renderer is allowed to know about the mentor's configuration.
/// Note `has_key` rather than the key itself — see `get_app_settings`.
#[derive(serde::Serialize)]
struct MentorConfigView {
    enabled: bool,
    has_key: bool,
    model: String,
    /// Selected provider id (always resolved — never the empty string, so the
    /// renderer's picker has something concrete to select).
    provider: String,
    base_url: String,
    /// The full provider catalog, so Settings builds its picker from the same
    /// source of truth the request path uses rather than a duplicated list.
    providers: Vec<MentorProviderView>,
}

/// One selectable provider, as the renderer needs it.
#[derive(serde::Serialize)]
struct MentorProviderView {
    id: String,
    name: String,
    default_model: String,
    keys_url: String,
    /// True for the custom/local option, which needs a URL instead of a key.
    needs_url: bool,
}

fn mentor_view(m: &settings::MentorV1) -> MentorConfigView {
    let p = mentor::provider_by_id(&m.provider);
    MentorConfigView {
        enabled: m.enabled,
        has_key: !m.api_key.trim().is_empty(),
        model: if m.model.trim().is_empty() {
            p.default_model.to_string()
        } else {
            m.model.clone()
        },
        provider: p.id.to_string(),
        base_url: m.base_url.clone(),
        providers: mentor::PROVIDERS
            .iter()
            .map(|p| MentorProviderView {
                id: p.id.to_string(),
                name: p.name.to_string(),
                default_model: p.default_model.to_string(),
                keys_url: p.keys_url.to_string(),
                needs_url: p.base_url.is_empty(),
            })
            .collect(),
    }
}

#[tauri::command]
fn get_mentor_config(settings: tauri::State<'_, Arc<settings::SettingsState>>) -> MentorConfigView {
    mentor_view(&settings.get().mentor)
}

/// Update the mentor's configuration. Not friction-gated in either direction:
/// the mentor is not a protection, and making someone wait 24 hours to STOP
/// sending their words to a third party would be the asymmetry pointed
/// backwards (see `settings::MentorV1`).
///
/// `api_key` is tri-state on purpose: `None` leaves the stored key untouched
/// (so toggling `enabled` from the UI doesn't require the renderer to hold
/// the key), `Some("")` clears it, `Some(k)` replaces it.
#[tauri::command]
fn set_mentor_config(
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    enabled: bool,
    api_key: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    base_url: Option<String>,
) -> MentorConfigView {
    settings.update(|s| {
        s.mentor.enabled = enabled;
        if let Some(k) = api_key {
            s.mentor.api_key = k.trim().to_string();
        }
        if let Some(m) = model {
            s.mentor.model = m.trim().to_string();
        }
        if let Some(b) = base_url {
            s.mentor.base_url = b.trim().to_string();
        }
        if let Some(p) = provider {
            // Resolve through the catalog so an unknown id can never be
            // persisted — it would leave the mentor pointing at nothing.
            let resolved = mentor::provider_by_id(&p);
            if resolved.id != s.mentor.provider {
                // Switching provider invalidates the stored model: a model name
                // is provider-specific, and carrying e.g. a Claude id over to
                // OpenAI produces a confusing 404 on first use. Empty means
                // "use the new provider's default".
                s.mentor.model = String::new();
            }
            s.mentor.provider = resolved.id.to_string();
        }
        // Enabling without the credential that provider actually needs would
        // leave a surface that looks armed and fails on first use. The custom /
        // local option needs a URL rather than a key.
        let p = mentor::provider_by_id(&s.mentor.provider);
        let unusable = if p.base_url.is_empty() {
            s.mentor.base_url.trim().is_empty()
        } else {
            s.mentor.api_key.trim().is_empty()
        };
        if unusable {
            s.mentor.enabled = false;
        }
    });
    mentor_view(&settings.get().mentor)
}

/// Send the conversation and return the reply.
///
/// `async` + `spawn_blocking` because `mentor::send` is a blocking HTTPS call
/// that can legitimately take a minute: running it on a sync command would
/// freeze the window for the duration. Note the mentor gets no `AppHandle`
/// and no other state — it has no route to any protection command, which is
/// layer 1 of the four in mentor.rs and the only one that holds structurally.
#[tauri::command]
async fn mentor_send(
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    history: Vec<mentor::Turn>,
) -> Result<mentor::MentorReply, String> {
    let cfg = settings.get().mentor;
    if !cfg.enabled {
        return Err("The AI mentor is turned off.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        mentor::send(&cfg.provider, &cfg.base_url, &cfg.api_key, &cfg.model, &history)
    })
    .await
    .map_err(|e| format!("mentor request failed to run: {e}"))?
}

/// Add a process image name to the blocked-process list. A strengthening —
/// instant, never gated. Normalizes (trim + lowercase) and rejects anything
/// that isn't a bare image name (containing a path separator would mean this
/// is silently comparing against the wrong thing everywhere `proc_names` is a
/// flat list of image names, not paths — see `browsers::running_process_names`).
/// No-op if already present. Re-adding a name withdraws any pending removal of
/// that same name (a strengthening always cancels the matching weakening).
#[tauri::command]
fn add_blocked_process(
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    name: String,
) -> Result<Vec<String>, String> {
    let norm = name.trim().to_lowercase();
    if norm.is_empty() {
        return Err("Enter a process name, e.g. discord.exe".to_string());
    }
    if norm.contains('\\') || norm.contains('/') {
        return Err("Enter a bare process image name (e.g. discord.exe), not a path.".to_string());
    }
    let mut list = settings.get().blocked_processes;
    if !list.contains(&norm) {
        list.push(norm.clone());
        settings.update(|s| s.blocked_processes = list.clone());
        log::info!("process blocking: added '{norm}' to the blocked-process list");
    }
    friction.cancel(&format!("process_block.remove:{norm}"));
    Ok(list)
}

/// Request removal of a blocked process (a weakening, gated behind the
/// friction store like every other weakening — see `friction.rs`). The
/// process stays enforced until the delay elapses and the applier thread (in
/// `setup`) actually removes it from the list. Requires the master password
/// if one is set (`crate::auth::require_auth` — see 4.2).
#[tauri::command]
fn remove_blocked_process(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    name: String,
    auth: Option<String>,
) -> Result<friction::PendingView, String> {
    crate::auth::require_auth(&app, &auth)?;
    let norm = name.trim().to_lowercase();
    let present = settings.get().blocked_processes.contains(&norm);
    if !present {
        return Err(format!("{norm} is not in the blocked-process list."));
    }
    let action_id = format!("process_block.remove:{norm}");
    let view = friction.request(&action_id, &format!("Stop blocking {norm}"), serde_json::json!({ "process": norm }));
    log::warn!(
        "process-block removal requested for {norm} — {}s cool-off started (still blocked)",
        view.delay_secs
    );
    Ok(view)
}

/// Toggle blocking of unknown/evasion browsers outright (kill on sight,
/// rather than the default log-only tier — see `enforce_processes`). Turning
/// it ON is always instant (a strengthening) and withdraws any pending
/// disable. Turning it OFF is a weakening: the setting stays ON until the
/// friction delay elapses and the applier thread actually flips it. Requires
/// the master password to turn off, if one is set.
#[tauri::command]
fn set_block_unknown_browsers(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        settings.update(|s| s.block_unknown_browsers = true);
        friction.cancel("evasion_kill.disable");
        log::info!("block_unknown_browsers set to true");
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    let already_off = !settings.get().block_unknown_browsers;
    if already_off {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    crate::auth::require_auth(&app, &auth)?;
    let view = friction.request(
        "evasion_kill.disable",
        "Stop blocking unknown browsers",
        serde_json::json!({}),
    );
    log::warn!(
        "evasion-kill disable requested — {}s cool-off started (unknown browsers stay blocked until it elapses)",
        view.delay_secs
    );
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

/// Push the desktop app's selected theme/palette to every connected extension,
/// and cache it so freshly-connecting profiles get it too.
#[tauri::command]
fn set_extension_theme(state: tauri::State<'_, Arc<Mutex<AppState>>>, display: Value) {
    state.lock().unwrap().ext_theme = Some(display.clone());
    let msg = serde_json::json!({ "type": "set_theme", "display": display });
    let _ = broadcast_to_extensions(state.inner(), &msg);
}

/// Push the desktop app's blocking settings (the "Redirect link" target and the
/// focus-schedule reminder config) to every connected extension, and cache them
/// so freshly-connecting profiles get them on handshake too.
#[tauri::command]
fn set_blocking_settings(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>,
    settings: Value,
) {
    state.lock().unwrap().ext_blocking = Some(settings);
    // Re-broadcast WITH the live lockdown state merged in — the renderer's
    // settings object never carries lockdown (that's desktop-authoritative),
    // so `broadcast_blocking` injects it fresh on every push (4.4).
    let _ = broadcast_blocking(state.inner(), lockdown.inner());
}

// ============================================================================
// Lockdown Mode (plan item 4.4) — commands. See lockdown.rs for the clock-
// immune credited-time engine; these drive it and push the result to the
// extensions via `broadcast_blocking`.
// ============================================================================

/// Current lockdown state (credited-based remaining time, frozen flag, active
/// flag) — the renderer's Lockdown card polls this for its live countdown.
#[tauri::command]
fn get_lockdown_state(lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>) -> lockdown::LockdownView {
    lockdown.view()
}

/// Start (or extend/upgrade) a lockdown. STRENGTHENING — instant, never gated
/// (the `auth` param is accepted for signature symmetry with the weakening
/// commands and future-proofing, but a strengthening never actually requires
/// it; see `lockdown.rs`). Extending never shortens; upgrading normal→frozen
/// is allowed, frozen→normal is not. Pushed to extensions immediately so the
/// wall goes up within a heartbeat. Event-logged.
#[tauri::command]
fn start_lockdown(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    duration_secs: u64,
    frozen: bool,
    #[allow(unused_variables)] auth: Option<String>,
) -> Result<lockdown::LockdownView, String> {
    if duration_secs == 0 {
        return Err("Choose how long to lock down for.".to_string());
    }
    let view = lockdown.start(duration_secs, frozen);
    // Mirror the display-only view into SettingsV1 so a restart's UI paints
    // roughly right before the credited-time engine re-derives the exact
    // remaining. `active_until` here is wall-clock display only (see 4.4).
    settings.update(|s| {
        s.lockdown.active_until = view.active_until;
        s.lockdown.frozen = view.frozen;
    });
    let _ = broadcast_blocking(state.inner(), lockdown.inner());
    log_event(&app, "lockdown_started", serde_json::json!({ "duration_secs": duration_secs, "frozen": frozen }));
    Ok(view)
}

/// Cancel a lockdown early. WEAKENING:
///   * NORMAL lockdown — requires the master password (if set) AND goes
///     through the ordinary friction delay under the `"lockdown.cancel"`
///     action id; the applier arm (in `setup`) actually ends it. This only
///     registers the request. The unwire notification to a trusted contact
///     (5.2) fires here, immediately, on the REQUEST — not on the eventual
///     apply — so the weak-moment self can't cancel and then race to remove
///     the contact before the apply.
///   * FROZEN lockdown — refused outright. No friction entry is EVER
///     registered for it, so `apply_ready` can't be tricked into ending one
///     early. Returns a plain error string the UI shows as-is.
/// Both outcomes are event-logged (the frozen refusal too — an attempt is
/// itself worth recording).
#[tauri::command]
fn cancel_lockdown(
    app: AppHandle,
    lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    auth: Option<String>,
) -> Result<friction::PendingView, String> {
    if lockdown.is_frozen_active() {
        log_event(&app, "lockdown_cancel_refused", serde_json::json!({ "reason": "frozen" }));
        return Err(
            "This is a frozen lockdown — it cannot be cancelled, only waited out. That was the point when you started it."
                .to_string(),
        );
    }
    if !lockdown.is_cancellable_active() {
        return Err("No lockdown is currently active.".to_string());
    }
    auth::require_auth(&app, &auth)?;
    let view = friction.request("lockdown.cancel", "End lockdown early", serde_json::json!({}));
    log::warn!("lockdown cancel requested — {}s cool-off (lockdown stays active until it elapses)", view.delay_secs);
    log_event(&app, "friction_requested", serde_json::json!({ "action": "lockdown.cancel" }));
    // 5.2: notify the contact of the REQUEST immediately (anti-weak-moment).
    notify_contact(&app, "lockdown_cancelled");
    Ok(view)
}

/// Additively allow a domain WHILE a lockdown is active (4.4's anti-brick
/// mitigation). Goes through a short (60s) friction delay under the
/// `"lockdown.allow:<domain>"` action id — enough to stop an impulsive "just
/// let me through", not enough to brick a real workday (banking, work SSO).
/// The applier arm adds it to the pushed allowlist. Requires the master
/// password if one is set (opening any hole during a lockdown is sensitive).
#[tauri::command]
fn request_lockdown_allow(
    app: AppHandle,
    lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    domain: String,
    auth: Option<String>,
) -> Result<friction::PendingView, String> {
    if !lockdown.view().active {
        return Err("No lockdown is active — add allowed sites from your normal blocklist instead.".to_string());
    }
    let norm = normalize_domain(&domain);
    if norm.is_empty() {
        return Err("Not a valid domain.".to_string());
    }
    auth::require_auth(&app, &auth)?;
    let action_id = format!("lockdown.allow:{norm}");
    let view = friction.request(&action_id, &format!("Allow {norm} during lockdown"), serde_json::json!({ "domain": norm }));
    log_event(&app, "friction_requested", serde_json::json!({ "action": "lockdown.allow" }));
    Ok(view)
}

/// Toggle schedule-from-vulnerable-hours (4.4 v2): let the configured
/// vulnerable-hours window automatically escalate into a (non-frozen)
/// Lockdown instead of only showing reminder pop-ups — see the
/// `"vulnerable_window_active"` arm in `handle_extension_message` for the
/// actual escalation. Same asymmetry as `set_dns_filter_enabled`/`dns.disable`:
/// turning it ON is instant (a strengthening — opting IN to more automatic
/// protection); turning it OFF is a weakening and goes through the ordinary
/// friction delay under the `"lockdown.escalation_disable"` action id, gated
/// by the master password if one is set. Never touches an already-active
/// lockdown either way — that still only ever ends via `lockdown.cancel` or
/// natural expiry.
#[tauri::command]
fn set_lockdown_escalation(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        settings.update(|s| s.lockdown.escalate_vulnerable_hours = true);
        state.lock().unwrap().lockdown_escalate = true;
        friction.cancel("lockdown.escalation_disable");
        log_event(&app, "lockdown_escalation_enabled", serde_json::json!({}));
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    let already_off = !settings.get().lockdown.escalate_vulnerable_hours;
    if already_off {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    auth::require_auth(&app, &auth)?;
    let view = friction.request(
        "lockdown.escalation_disable",
        "Turn off automatic lockdown during vulnerable hours",
        serde_json::json!({}),
    );
    log::warn!(
        "lockdown escalation disable requested — {}s cool-off started (escalation stays on until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "lockdown.escalation_disable" }));
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

// ============================================================================
// Serious Mode (UX Direction §1) — the one toggle that flips the whole app to
// its strictest configuration AND its hard voice, with no per-feature
// exceptions. The asymmetry is the entire product: ON is one click, OFF is the
// longest cool-off in the app.
// ============================================================================

/// Turn Serious Mode on or off.
///
/// **ON is instant and unconditional** — it's a strengthening, and the whole
/// design depends on a person in a strong moment being able to commit without
/// friction. Turning it on also switches ON the protections it implies
/// (lockdown escalation today) and withdraws any pending disable request: a
/// strengthening always cancels the matching weakening, same rule as
/// everywhere else in this file.
///
/// **OFF is a weakening** and goes through `friction.rs` under the
/// `"serious.disable"` action id — which carries double the ordinary
/// weakening delay (`friction::delay_for`), because this is the strongest
/// commitment the app offers. Serious Mode stays *fully* active for the whole
/// wait; nothing about the app softens until the applier arm actually fires.
/// The master password gates the request if one is set, and the trusted
/// contact (if any) is told at REQUEST time rather than at apply time — the
/// same anti-weak-moment rule as `request_remove_trusted_contact`.
///
/// The strictness this mode implies is enforced where each layer lives: the
/// extension reads `serious` off the pushed blocking settings (see
/// `broadcast_blocking`) and forces its strict presets from there; the
/// renderer reads it back through `get_app_settings` and flips voice + visuals.
#[tauri::command]
fn set_serious_mode(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    lockdown: tauri::State<'_, Arc<lockdown::LockdownStore>>,
    enabled: bool,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if enabled {
        state.lock().unwrap().serious_mode = true;
        settings.update(|s| {
            s.serious_mode = true;
            // "It covers everything — no per-feature exceptions." Lockdown
            // escalation is the one protection Serious Mode subsumes that has
            // its own persisted flag, so turn it on here rather than leaving
            // the user to find it. It is NOT turned back off on disable —
            // un-strengthening something the user may have wanted anyway would
            // be a weakening we never asked about.
            s.lockdown.escalate_vulnerable_hours = true;
        });
        state.lock().unwrap().lockdown_escalate = true;
        friction.cancel("serious.disable");
        let _ = broadcast_blocking(&state, &lockdown);
        log_event(&app, "serious_mode_enabled", serde_json::json!({}));
        log::warn!("serious mode ENABLED (instant — strengthening)");
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    if !settings.get().serious_mode {
        // Already off — nothing to weaken, so don't open a pointless pending
        // change the user would then have to cancel.
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }

    auth::require_auth(&app, &auth)?;
    let view = friction.request(
        "serious.disable",
        "Turn off Serious Mode",
        serde_json::json!({}),
    );
    // Told now, not when it applies: the point of the notification is that the
    // weak moment isn't private, and by apply time the moment has passed.
    notify_contact(&app, "serious_disable_requested");
    log::warn!(
        "serious mode disable requested — {}s cool-off started (mode stays FULLY on until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "serious.disable" }));
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

// ============================================================================
// Trusted contact / privacy-first accountability (plan item 5.2, Tier 2) —
// commands. Solo-first: OFF by default, never nagged. See notify.rs.
// ============================================================================

/// The configured trusted contact, or `None`. The renderer's card reads this
/// on load; `None` keeps the solo path first-class (nothing to show but the
/// invitation).
#[tauri::command]
fn get_trusted_contact(
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
) -> Option<settings::TrustedContactV1> {
    settings.get().trusted_contact
}

/// Wire (or re-wire / edit) a trusted contact. Wiring/editing TO a contact is
/// instant (a strengthening — more accountability, not less). But editing
/// AWAY from an existing contact (changing the email, or clearing it) is the
/// weak-moment escape hatch 5.2 explicitly closes: it goes through
/// `request_remove_trusted_contact` instead. So this command refuses to
/// change the email of an already-configured contact to a *different*
/// address or blank — that path must use the friction-gated removal. Name and
/// notify-toggle edits (keeping the same email) are fine and instant.
#[tauri::command]
fn set_trusted_contact(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    name: String,
    email: String,
    notify: settings::NotifyEventsV1,
) -> Result<(), String> {
    let new_email = email.trim().to_string();
    if new_email.is_empty() {
        return Err("Enter the contact's email, or use Remove to unwire the current one.".to_string());
    }
    if !new_email.contains('@') {
        return Err("That doesn't look like an email address.".to_string());
    }
    let existing = settings.get().trusted_contact;
    if let Some(cur) = &existing {
        if cur.email.trim().eq_ignore_ascii_case(&new_email) {
            // Same contact — a name/notify edit, instant.
        } else {
            // Changing to a DIFFERENT email is unwiring the old one — must go
            // through the friction-gated removal first.
            return Err(
                "To point Oath Light at a different contact, remove the current one first (Settings → Trusted contact → Remove) — that's a waiting-period change, on purpose."
                    .to_string(),
            );
        }
    }
    let last_heartbeat = existing.as_ref().map(|c| c.last_heartbeat).unwrap_or(0);
    settings.update(|s| {
        s.trusted_contact = Some(settings::TrustedContactV1 {
            name: name.trim().to_string(),
            email: new_email.clone(),
            notify: notify.clone(),
            last_heartbeat,
        });
    });
    log_event(&app, "trusted_contact_set", serde_json::json!({ "to": new_email }));
    Ok(())
}

/// Request removal of the trusted contact — a WEAKENING (5.2): friction-gated
/// under `"trusted_contact.remove"` AND, per the plan's anti-weak-moment
/// rule, the unwire REQUEST itself immediately notifies the contact (so the
/// weak-moment self can't silently drop them first). Requires the master
/// password if one is set. The applier arm actually clears the contact once
/// the delay elapses.
#[tauri::command]
fn request_remove_trusted_contact(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    auth: Option<String>,
) -> Result<friction::PendingView, String> {
    if settings.get().trusted_contact.is_none() {
        return Err("No trusted contact is configured.".to_string());
    }
    auth::require_auth(&app, &auth)?;
    // Notify BEFORE registering the delay — the message goes out the moment
    // the request is made, not when it applies.
    notify_contact(&app, "trusted_contact_removed");
    let view = friction.request("trusted_contact.remove", "Remove the trusted contact", serde_json::json!({}));
    log_event(&app, "friction_requested", serde_json::json!({ "action": "trusted_contact.remove" }));
    Ok(view)
}

/// Read the saved SMTP config (password blanked for display — never round-trip
/// the plaintext password back into the webview once saved). `None` when
/// unconfigured.
#[tauri::command]
fn get_smtp_config(app: AppHandle) -> Option<notify::SmtpConfig> {
    let dir = app.path().app_data_dir().ok()?;
    let mut cfg = notify::load_smtp(&dir)?;
    let had_password = !cfg.password.is_empty();
    cfg.password = if had_password { "********".to_string() } else { String::new() };
    Some(cfg)
}

/// Save SMTP credentials to `<app_data_dir>/smtp.json` (plaintext — the UI
/// says so). A password of `"********"` (the sentinel `get_smtp_config`
/// returns) means "keep the existing password", so re-saving other fields
/// doesn't wipe it.
#[tauri::command]
fn set_smtp_config(app: AppHandle, config: notify::SmtpConfig) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut cfg = config;
    if cfg.password == "********" {
        let existing = notify::load_smtp(&dir);
        cfg.password = existing.map(|c| c.password).unwrap_or_default();
    }
    notify::save_smtp(&dir, &cfg)
}

/// Send a test notification to the configured contact right now (bypasses the
/// per-event toggles — it's an explicit user action). Uses the same delivery
/// path as every real notification, so a working test means real ones will
/// work too. Runs the send off-thread like all sends; resolves as soon as the
/// send is dispatched.
#[tauri::command]
fn test_trusted_contact_send(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
) -> Result<(), String> {
    let contact = settings.get().trusted_contact.ok_or_else(|| "No trusted contact is configured.".to_string())?;
    if contact.email.trim().is_empty() {
        return Err("The trusted contact has no email address.".to_string());
    }
    let app2 = app.clone();
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let recipient = contact.email.trim().to_string();
        let subject = "Oath Light: test message".to_string();
        let body = format!(
            "Hi {},\n\nThis is a test from Oath Light confirming your trusted-contact setup works. \
             You'll only ever be told THAT a discrete event happened — never anything about what was browsed.\n\n— Oath Light",
            if contact.name.trim().is_empty() { "there" } else { contact.name.trim() }
        );
        match notify::deliver(&dir, &recipient, &subject, &body) {
            notify::SendOutcome::Sent =>
                log_event(&app2, "notify_sent", serde_json::json!({ "to": recipient, "event": "test", "via": "smtp" })),
            notify::SendOutcome::MailtoDraft(url) => {
                let opened = open_external(url).is_ok();
                log_event(&app2, if opened { "notify_sent" } else { "notify_failed" },
                    serde_json::json!({ "to": recipient, "event": "test", "via": "mailto", "opened": opened }));
            }
            notify::SendOutcome::Failed(reason) =>
                log_event(&app2, "notify_failed", serde_json::json!({ "to": recipient, "event": "test", "reason": reason })),
        }
    });
    Ok(())
}

// ============================================================================
// Tamper-evident event log (plan item 4.5) — read commands. Writes happen at
// each protective event's own site via `log_event` (see above).
// ============================================================================

/// The most recent event-log entries (current file), newest first, capped at
/// `limit`. The renderer's "Protection history" card renders these in plain
/// language.
#[tauri::command]
fn get_event_log(app: AppHandle, limit: Option<usize>) -> Vec<eventlog::Entry> {
    match app.try_state::<Arc<EventLog>>() {
        Some(el) => el.recent(limit),
        None => Vec::new(),
    }
}

/// Verify the event log's hash chain from genesis — the "Verify" button.
/// Returns `intact`, entry count, the first broken seq (if any), and when the
/// current chain segment started (so the UI shows "intact since <date>", red
/// on a break/restart).
#[tauri::command]
fn verify_event_log(app: AppHandle) -> eventlog::VerifyReport {
    match app.try_state::<Arc<EventLog>>() {
        Some(el) => el.verify(),
        None => eventlog::VerifyReport { intact: true, entries: 0, first_break_seq: None, chain_started: None, restarts: 0 },
    }
}

// ============================================================================
// Master password (Phase 4 item 4.2) — see auth.rs for the module doc. The
// commands here are the only way the renderer ever touches `AuthState`; every
// actual gate (`auth::require_auth`) lives on the weakening commands above,
// not here.
// ============================================================================

/// Whether a master password is currently configured. The renderer's
/// `PasswordGate`/`SecurityCard` read this on load to decide whether to ever
/// prompt at all — no password set means every weakening stays ungated.
#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub set: bool,
}

#[tauri::command]
fn get_auth_status(auth_state: tauri::State<'_, Arc<auth::AuthState>>) -> AuthStatus {
    AuthStatus { set: auth_state.password_set() }
}

/// Verify the master password and, on success, mint a short-lived session
/// token (`auth::AuthState::verify`) that the renderer then presents back as
/// `auth` on a gated command. Rate-limited (see `MIN_ATTEMPT_GAP` in
/// auth.rs); its error is surfaced to the caller as-is.
#[tauri::command]
fn verify_master_password(
    app: AppHandle,
    auth_state: tauri::State<'_, Arc<auth::AuthState>>,
    password: String,
) -> Result<String, String> {
    // auth.rs stays core-agnostic (no eventlog dependency, per Part J); the
    // event-log wiring for a failed attempt lives here at the command layer.
    // Rate-limit rejections ("Try again in a moment.") are NOT logged — only
    // a genuine wrong-password attempt, so a scripted retry loop can't also
    // flood the log.
    match auth_state.verify(&password) {
        Ok(token) => Ok(token),
        Err(e) => {
            if e == "Wrong password." {
                log_event(&app, "auth_failed", serde_json::json!({}));
            }
            Err(e)
        }
    }
}

/// Set or change the master password. First-time set needs no `current`
/// (setting a password from nothing is a strengthening, never gated);
/// changing an existing one requires `current` to verify — see
/// `auth::AuthState::set_password`. Also withdraws any pending
/// `"password.remove"` weakening: re-setting the password is itself a
/// strengthening, the same "turning it back on cancels the pending turn-off"
/// rule every other weakening in this codebase follows.
#[tauri::command]
fn set_master_password(
    auth_state: tauri::State<'_, Arc<auth::AuthState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    current: Option<String>,
    new: String,
) -> Result<(), String> {
    auth_state.set_password(current.as_deref(), &new)?;
    friction.cancel("password.remove");
    Ok(())
}

/// Request removal of the master password — a weakening gated behind BOTH
/// the current password AND the friction delay (see the module doc in
/// auth.rs for why that's deliberate, not redundant: the password proves
/// it's really you asking; the delay is the same second-thought window every
/// other weakening gets). `current` must verify before the request is even
/// registered, so a wrong password leaves no trace in the pending list.
#[tauri::command]
fn request_password_removal(
    app: AppHandle,
    auth_state: tauri::State<'_, Arc<auth::AuthState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    current: String,
) -> Result<friction::PendingView, String> {
    auth_state.verify_only(&current)?;
    let view = friction.request("password.remove", "Remove the master password", serde_json::json!({}));
    log::warn!(
        "master-password removal requested — {}s cool-off started (password still required until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "password.remove" }));
    notify_contact(&app, "password_removal_requested");
    Ok(view)
}

/// The "forgot it" recovery path: no current password needed, but the
/// request goes through the exact same `"password.remove"` friction delay as
/// `request_password_removal` above — forgetting the password can't shortcut
/// the wait, it only skips proving you know a password you've said you don't
/// remember. This is the documented recovery story for a lockout: wait out
/// the delay, don't reach for a backdoor. The pending removal shows up in
/// Settings -> Pending changes the entire time, so a stronger-willed future
/// self (or a partner who remembers the password) can still cancel it.
///
/// TODO(near-Alpha): this reuses the standard weakening delay via the shared
/// `"password.remove"` action id — `friction::delay_for` doesn't yet have a
/// distinct "uninstall-length" delay class for a password-less path like this
/// one. Before Alpha, give this its own longer (24h-class) delay so a brief
/// unattended moment can't be used to start this clock and walk away.
#[tauri::command]
fn request_password_removal_forgotten(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
) -> friction::PendingView {
    let view = friction.request(
        "password.remove",
        "Remove the master password (forgotten)",
        serde_json::json!({}),
    );
    log::warn!(
        "master-password removal requested via the forgotten-password path — {}s cool-off started",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "password.remove", "forgotten": true }));
    notify_contact(&app, "password_removal_requested");
    view
}

/// Open an http(s) URL in the user's default browser. The in-app webview can't
/// follow `target="_blank"` links itself, so the blocking-settings "Test" button
/// routes through here. Validates the scheme and never goes through a shell, so
/// query strings with `&` are passed intact.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("Only http(s) URLs are allowed".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        // rundll32 (not `cmd /C start`) so `&` in the query isn't shell-parsed.
        std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(u)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(u).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(u).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Manually (re)apply the force-install policy for one browser, or all if
/// `browser_key` is None. Chromium force-installs from the Web Store, Firefox
/// from AMO; an engine with no store URL configured is a no-op ("dormant").
#[tauri::command]
fn enforce_extension(browser_key: Option<String>) -> Vec<(String, String)> {
    let targets: Vec<&BrowserDef> = match &browser_key {
        Some(k) => browsers::browser_by_key(k).into_iter().collect(),
        None => BROWSERS.iter().collect(),
    };
    targets
        .into_iter()
        .map(|def| {
            // Web-Store force-install works on unmanaged machines, so there is no
            // "unsupported device" case to report anymore — just apply the policy
            // (elevation still required; an unelevated write reports "failed").
            let status = enforce_str(browsers::enforce_policy(def)).to_string();
            // Close the incognito/guest/private bypass in the same pass (1.5);
            // reported status stays the force-install one the UI reads.
            let _ = browsers::enforce_incognito_guest_policy(def);
            (def.key.to_string(), status)
        })
        .collect()
}

/// Open a browser at its own extensions page.
///
/// Only reachable from the "turn it on" action, which exists because Chromium
/// leaves an auto-installed extension switched off until the user approves it
/// once — and a user who dismissed that prompt has no obvious way back to the
/// toggle. `edge://extensions` and friends are private schemes only that
/// browser understands, so this launches the browser itself rather than going
/// through the shell. The URL is taken from our own table, never from the
/// caller; the frontend only picks which browser.
#[tauri::command]
fn open_extensions_page(browser_key: String) -> Result<(), String> {
    let def = browsers::browser_by_key(&browser_key).ok_or("Unknown browser")?;
    if def.extensions_page.is_empty() {
        return Err("No extensions page known for this browser".to_string());
    }
    let exe = browsers::installed_exe_path(def).ok_or("Browser is not installed")?;
    std::process::Command::new(exe)
        .arg(def.extensions_page)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Ask for admin once and lock the extension. Writing a browser force-install
/// policy requires elevation (the `Software\Policies` registry key is admin-only
/// in *both* hives), so an unelevated app can't do it. This relaunches ourselves
/// elevated (a single UAC prompt) with `--elevated-setup`; that short-lived
/// instance writes the policy and registers an elevated login task, then exits.
/// When it finishes we flush the monitor's memo so the UI flips to "locked".
///
/// Fire-and-forget from the UI's side: it returns immediately and a background
/// thread waits on the elevated pass. Windows-only; a no-op error elsewhere.
#[tauri::command]
fn request_elevated_setup() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // Single-quote for PowerShell, escaping embedded quotes by doubling.
        let exe_ps = exe.to_string_lossy().replace('\'', "''");
        std::thread::spawn(move || {
            let ps = format!(
                "Start-Process -FilePath '{}' -ArgumentList '--elevated-setup' -Verb RunAs -Wait",
                exe_ps
            );
            let status = std::process::Command::new("powershell")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            match status {
                Ok(s) if s.success() => {
                    RE_ENFORCE_REQUESTED.store(true, Ordering::SeqCst);
                    log::warn!("elevated setup completed — flushing enforcement memo");
                }
                _ => log::warn!("elevated setup declined or failed"),
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Elevation is only supported on Windows".to_string())
    }
}

/// The elevated one-shot (`--elevated-setup`). Runs with admin rights, writes the
/// force-install policy for every configured browser (Chromium via the Web Store,
/// Firefox via AMO), and registers an elevated logon task so future sessions
/// re-assert the lock without a prompt. Then exits.
///
/// BRICK SAFETY: each force-install points at the published extension via its
/// store's canonical URL (Chrome Web Store / AMO) — the store always answers and
/// the extension is really published — so there is no dead-URL to lock a browser
/// against (the old self-hosted path guarded this by checking a localhost server
/// was serving first; the store path needs no such check).
#[cfg(target_os = "windows")]
fn elevated_setup() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // enforce_policy is a no-op (Dormant) for any engine not yet configured, so
    // this safely covers both Chromium and Firefox. Also write the incognito/
    // guest/private lockdown (1.5) in the same elevated pass — it too needs HKLM.
    for def in BROWSERS {
        let _ = browsers::enforce_policy(def); // elevated -> writes HKLM
        let _ = browsers::enforce_incognito_guest_policy(def);
    }

    // Elevated logon task: re-asserts the lock on future logins with no prompt.
    // Best-effort — the policy just written persists regardless, so the lock
    // holds even if the task never runs.
    if let Ok(exe) = std::env::current_exe() {
        let tr = format!("\"{}\" --autostart", exe.display());
        let _ = std::process::Command::new("schtasks")
            .args([
                "/Create", "/TN", "OathLightElevated", "/TR", &tr, "/SC", "ONLOGON",
                "/RL", "HIGHEST", "/F",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

#[tauri::command]
fn request_sync(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let msg = serde_json::json!({ "type": "request_sync" });
    let n = broadcast_to_extensions(state.inner(), &msg);
    if n > 0 { Ok(()) } else { Err("No connected extensions".to_string()) }
}

#[tauri::command]
fn update_blocklist_domains(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    domains: Vec<String>,
) -> Result<(), String> {
    {
        let mut s = state.lock().unwrap();
        s.blocklists.domains = domains.clone();
        s.blocklists.domain_count = domains.len();
    }
    let msg = serde_json::json!({ "type": "update_blocklist", "listType": "domains", "data": domains });
    let n = broadcast_to_extensions(state.inner(), &msg);
    if n > 0 { Ok(()) } else { Err("No connected extensions".to_string()) }
}

#[tauri::command]
fn update_blocklist_keywords(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    keywords: Vec<String>,
) -> Result<(), String> {
    {
        let mut s = state.lock().unwrap();
        s.blocklists.keywords = keywords.clone();
        s.blocklists.keyword_count = keywords.len();
    }
    let msg = serde_json::json!({ "type": "update_blocklist", "listType": "keywords", "data": keywords });
    let n = broadcast_to_extensions(state.inner(), &msg);
    if n > 0 { Ok(()) } else { Err("No connected extensions".to_string()) }
}

/// OTA blocklist updates (plan 3.5): current status for the Settings card —
/// installed/loaded list version, last check time + outcome, whether a check
/// is running right now.
#[tauri::command]
fn get_ota_status(state: tauri::State<'_, Arc<ota::OtaState>>) -> ota::OtaStatusView {
    state.status()
}

/// OTA blocklist updates (plan 3.5): run a check right now (the Settings
/// "Check now" button). The check itself — network fetch + hashing a ~10MB
/// download — runs on its own thread so this command returns immediately;
/// the UI follows progress via the `ota-status` event `ota::check_now` emits
/// on completion (and can poll `get_ota_status`). Checking for (or applying)
/// an update only ever *strengthens* the lists — monotonic versions, verified
/// content — so this is deliberately ungated (no auth/friction).
#[tauri::command]
fn check_lists_update_now(
    app: AppHandle,
    state: tauri::State<'_, Arc<ota::OtaState>>,
) -> ota::OtaStatusView {
    let app2 = app.clone();
    std::thread::spawn(move || {
        let _ = ota::check_now(&app2);
    });
    let mut view = state.status();
    // The spawned thread may not have flipped the flag yet — report the
    // truth of what this command just started.
    view.checking = true;
    view
}

/// Classify an image file with the NSFW model. Loads the model on first call.
/// Returns per-label probabilities plus `nsfw_score` / `sensitive_score`
/// aggregates the blocking policy can threshold on.
#[tauri::command]
fn classify_image(
    nsfw_state: tauri::State<'_, NsfwState>,
    path: String,
) -> Result<nsfw::Classification, String> {
    // Lazy-load the model once, then drop the outer lock so inference (guarded
    // by the session's own mutex) isn't serialized on the state lock.
    let classifier = {
        let mut guard = nsfw_state.classifier.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let model = nsfw::resolve_model_path().ok_or_else(|| {
                "NSFW model not found — set OATHLIGHT_MODEL or place image-guard-2.0.onnx next to the app".to_string()
            })?;
            log::info!("Loading NSFW model from {}", model.display());
            *guard = Some(Arc::new(nsfw::NsfwClassifier::load(&model)?));
        }
        guard.as_ref().unwrap().clone()
    };
    classifier.classify_path(std::path::Path::new(&path))
}

/// Shared implementation behind the `start_nsfw_monitor` command AND the
/// setup-time auto-start (when `settings.monitor_enabled` was true on the
/// previous run — see `run()`'s `.setup()`). Fetches every managed state it
/// needs straight off the `AppHandle` so both call sites share one code path.
fn start_nsfw_monitor_impl(app: &AppHandle) -> Result<(), String> {
    let nsfw_state = app.state::<NsfwState>();
    let monitor = app.state::<MonitorState>();
    let state = app.state::<Arc<Mutex<AppState>>>();
    let overlay_state = app.state::<Arc<overlay::OverlayState>>();

    if monitor.running.load(Ordering::SeqCst) {
        return Ok(());
    }
    let classifier = {
        let mut guard = nsfw_state.classifier.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let model = nsfw::resolve_model_path().ok_or_else(|| {
                "NSFW model not found — set OATHLIGHT_MODEL or place image-guard-2.0.onnx next to the app".to_string()
            })?;
            log::info!("Loading NSFW model from {}", model.display());
            *guard = Some(Arc::new(nsfw::NsfwClassifier::load(&model)?));
        }
        guard.as_ref().unwrap().clone()
    };
    // Second ensemble model: NudeNet (photographic nudity). Best-effort — if its
    // model is missing or fails to load, the monitor still runs SigLIP-only.
    let detector = {
        let mut guard = nsfw_state.detector.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            match nudenet::resolve_model_path() {
                Some(model) => {
                    log::info!("Loading NudeNet model from {}", model.display());
                    match nudenet::NudeNetDetector::load(&model) {
                        Ok(d) => *guard = Some(Arc::new(d)),
                        Err(e) => log::warn!("NudeNet load failed (SigLIP-only): {e}"),
                    }
                }
                None => log::warn!("NudeNet model not found (SigLIP-only) — place nudenet-320n.onnx next to the app"),
            }
        }
        guard.as_ref().cloned()
    };
    monitor.running.store(true, Ordering::SeqCst);
    let running = monitor.running.clone();
    let app_handle = app.clone();
    let state_arc = state.inner().clone();
    let overlay_arc = overlay_state.inner().clone();
    std::thread::spawn(move || run_monitor(app_handle, classifier, detector, running, state_arc, overlay_arc));
    Ok(())
}

/// Start the background screen monitor (loads the model on first start). Emits a
/// `nsfw-scan` event whenever the screen changes meaningfully. Idempotent.
///
/// Starting is always a strengthening — instant, never gated. It also persists
/// the "auto-start on launch" preference and withdraws any pending
/// `monitor.disable` weakening, the same rule `set_guard_enabled` follows for
/// the uninstall guard: re-enabling something withdraws a pending disable of
/// that same thing.
#[tauri::command]
fn start_nsfw_monitor(
    app: AppHandle,
    settings: tauri::State<'_, Arc<settings::SettingsState>>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
) -> Result<(), String> {
    start_nsfw_monitor_impl(&app)?;
    settings.update(|s| s.monitor_enabled = true);
    friction.cancel("monitor.disable");
    Ok(())
}

/// Stop the background screen monitor. A weakening (4.1): if it isn't running
/// there's nothing to weaken, so this no-ops instant; otherwise it registers a
/// `monitor.disable` request and returns it — the monitor keeps running until
/// the delay elapses and the applier thread (in `setup`) actually flips it
/// off.
///
/// Master-password gate (4.2) applies only when the monitor is actually
/// running — the not-running no-op above stays ungated, same rule as
/// `set_guard_enabled`.
#[tauri::command]
fn stop_nsfw_monitor(
    app: AppHandle,
    monitor: tauri::State<'_, MonitorState>,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    auth: Option<String>,
) -> Result<WeakeningOutcome, String> {
    if !monitor.running.load(Ordering::SeqCst) {
        return Ok(WeakeningOutcome { applied: true, pending: None });
    }
    auth::require_auth(&app, &auth)?;
    let view = friction.request("monitor.disable", "Turn off the AI screen monitor", serde_json::json!({}));
    log::warn!(
        "monitor disable requested — {}s cool-off started (monitor keeps running until it elapses)",
        view.delay_secs
    );
    log_event(&app, "friction_requested", serde_json::json!({ "action": "monitor.disable" }));
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
}

/// Whether the monitor is currently running.
#[tauri::command]
fn nsfw_monitor_running(monitor: tauri::State<'_, MonitorState>) -> bool {
    monitor.running.load(Ordering::SeqCst)
}

/// Dismiss the action-layer overlay currently open on the calling window's
/// monitor. `window` is bound by Tauri to whichever window actually issued
/// this IPC call — the overlay page itself, identified purely by its own
/// window label (`pp-overlay-<monitor id>`, see `overlay.rs`) — so a caller
/// can never claim to dismiss a different monitor's overlay than the one it's
/// displayed on. The real dwell-timer check happens inside `overlay::dismiss`,
/// not here and not in the overlay's own JS.
#[tauri::command]
fn dismiss_overlay(
    window: tauri::WebviewWindow,
    app: AppHandle,
    overlay_state: tauri::State<'_, Arc<overlay::OverlayState>>,
) -> Result<(), String> {
    let monitor_id: u32 = window
        .label()
        .strip_prefix("pp-overlay-")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "not an overlay window".to_string())?;
    overlay::dismiss(&app, overlay_state.inner(), monitor_id)
}

// ============================================================================
// Recovery data (plan items 5.4 + 5.5) — commands. See recovery.rs for why
// this lives in Rust rather than the renderer's localStorage.
// ============================================================================

/// The whole recovery view: streak, best streak, urge log, slip log, and every
/// derived value (gentle mode, clean days, the canonical milestone list). One
/// call, everything derived server-side, so no two surfaces can disagree.
#[tauri::command]
fn get_recovery_log(state: tauri::State<'_, Arc<recovery::RecoveryState>>) -> recovery::RecoveryView {
    state.view()
}

/// Log one urge (5.4). `trigger` is a fixed-vocabulary id or null; `source` is
/// `panic` | `manual`. Never free text — see recovery.rs.
#[tauri::command]
fn log_urge(
    state: tauri::State<'_, Arc<recovery::RecoveryState>>,
    trigger: Option<String>,
    source: Option<String>,
) -> recovery::RecoveryView {
    state.log_urge(trigger, source.as_deref().unwrap_or("manual"))
}

/// Log a slip (5.5). Not a reset: the best streak is kept, the slip is
/// recorded as data, and it mirrors into the urge log for trigger analytics.
///
/// Deliberately NOT friction-gated. Logging a slip honestly is an act of
/// recovery, not a weakening of protection — putting a cool-off in front of it
/// would teach people to lie to their own log, which is the one outcome that
/// would make the whole feature worthless.
#[tauri::command]
fn log_slip(
    app: AppHandle,
    state: tauri::State<'_, Arc<recovery::RecoveryState>>,
    trigger: Option<String>,
) -> recovery::RecoveryView {
    let view = state.log_slip(trigger);
    // Event log (4.5): the FACT only — no trigger, no time-of-day pattern, no
    // content. A slip is the user's own data; the event log just shows their
    // future self that the app was running and honest about it.
    log_event(&app, "slip_logged", serde_json::json!({}));
    view
}

/// Record that a streak milestone has been celebrated, so it fires exactly
/// once. Monotonic and idempotent — safe to call from a render effect.
#[tauri::command]
fn mark_milestone(
    state: tauri::State<'_, Arc<recovery::RecoveryState>>,
    days: u64,
) -> recovery::RecoveryView {
    state.mark_milestone(days)
}

/// One-time migration of a streak that predates this store (5.4/5.5). The
/// renderer offers whatever `streakStart`/`bestStreak` it still has in
/// localStorage; the backend adopts the anchor only if it is EARLIER than its
/// own and only while it has no history of its own, so this can carry a real
/// streak across the move but can never be used to fabricate one afterwards.
#[tauri::command]
fn migrate_recovery_streak(
    state: tauri::State<'_, Arc<recovery::RecoveryState>>,
    streak_start: u64,
    best_streak: u64,
) -> recovery::RecoveryView {
    state.migrate_streak_start(streak_start, best_streak)
}

/// Report the current overlay as a FALSE POSITIVE (plan item 2.4).
///
/// Callable only from an overlay window — like `dismiss_overlay`, the monitor
/// id comes from the calling window's own label, so no caller can report on
/// another monitor's behalf. The scores recorded are the ones the monitor
/// thread stashed at escalation time, never anything the webview supplies:
/// a self-reported score would make the eval log worthless as a record of what
/// the model actually did.
///
/// Recording a report immediately re-derives the dwell, so the pause on THIS
/// overlay shortens straight away rather than only affecting future ones.
/// Returns the new dwell in seconds so the overlay can update its countdown.
#[tauri::command]
fn report_false_positive(
    window: tauri::WebviewWindow,
    app: AppHandle,
    overlay_state: tauri::State<'_, Arc<overlay::OverlayState>>,
) -> Result<u64, String> {
    let monitor_id: u32 = window
        .label()
        .strip_prefix("pp-overlay-")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "not an overlay window".to_string())?;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let ev = overlay_state.evidence(monitor_id);
    let entry = evallog::EvalEntry {
        ts: now,
        monitor_id,
        siglip_nsfw: ev.as_ref().map(|e| e.siglip_nsfw).unwrap_or(0.0),
        nudenet_explicit: ev.as_ref().map(|e| e.nudenet_explicit).unwrap_or(0.0),
        // No evidence recorded (an overlay left open across an app restart) —
        // log the report anyway with an explicit marker rather than silently
        // dropping the user's feedback. It just can't be deduplicated.
        screen_hash: ev.map(|e| e.screen_hash).unwrap_or_else(|| "unknown".to_string()),
        dwell_secs: evallog::tuned_dwell_secs(&dir, now),
    };
    evallog::append(&dir, &entry)?;

    // Event log (4.5): the FACT of the report, never the scores or the hash —
    // same "event only, no content" rule the escalation entry follows.
    log_event(&app, "false_positive_reported", serde_json::json!({ "monitor_id": monitor_id }));
    Ok(evallog::tuned_dwell_secs(&dir, now))
}

/// The local false-positive eval log (2.4), newest first, capped at `limit`.
/// Purely for the user to read their own history — there is no upload path in
/// this app, by design.
#[tauri::command]
fn get_eval_log(app: AppHandle, limit: Option<usize>) -> Vec<evallog::EvalEntry> {
    let Ok(dir) = app.path().app_data_dir() else { return Vec::new() };
    let mut all = evallog::read_all(&dir);
    all.reverse();
    all.truncate(limit.unwrap_or(50));
    all
}

/// Authorize a real shutdown of the dual-process watchdog so closing the app no
/// longer triggers resurrection. The legitimate quit path (the uninstall flow,
/// `perform_uninstall`) calls `watchdog::request_shutdown()` directly — it does
/// NOT go through this command. This command is reachable from any JS running
/// in the webview (it's in `generate_handler!`), so in a **release** build its
/// body is a no-op: it just logs a warning and returns, without writing the
/// shutdown sentinel. Left in `generate_handler!` (rather than removed) so the
/// frontend doesn't need a release-vs-debug branch of its own. In a **debug**
/// build it keeps its old behavior — the dev kill switch that lets closing the
/// app during testing skip the resurrection loop.
#[tauri::command]
fn stop_watchdog() {
    if cfg!(debug_assertions) {
        watchdog::request_shutdown();
    } else {
        log::warn!("stop_watchdog: ignored in release build (not a valid shutdown path)");
    }
}

// ============================================================================
// 24-hour uninstall request (Phase 4 friction) — now backed by the
// generalized `friction::FrictionStore` under the `"uninstall"` action id,
// rather than its own store. `uninstall.json` still gets written on every
// request/reset/cancel (see `uninstall::write_marker`) purely as a mirror for
// the release-build watchdog/guardian, which read it independently — see that
// function's doc comment for why that protocol must not change.
// ============================================================================

/// Map the friction store's view of `"uninstall"` onto the exact
/// `UninstallState` shape the renderer already consumes. `None` (no pending
/// request) maps to the same "idle" shape the old dedicated store used to
/// report: not requested, full delay remaining, not ready.
fn uninstall_state_from(store: &friction::FrictionStore) -> uninstall::UninstallState {
    match store.get("uninstall") {
        Some(p) => uninstall::UninstallState {
            requested: true,
            requested_at: Some(p.requested_at),
            delay_secs: p.delay_secs,
            elapsed_secs: p.elapsed_secs,
            remaining_secs: p.remaining_secs,
            ready: p.ready,
            // 4.6: the phrase generated when the request was filed. Empty for
            // a request made by a build that predates this, which
            // `phrase_matches` treats as "nothing to type".
            confirm_phrase: store
                .payload_of("uninstall")
                .and_then(|v| v.get("phrase").and_then(|p| p.as_str()).map(String::from))
                .unwrap_or_default(),
        },
        None => {
            let delay = friction::delay_for("uninstall");
            uninstall::UninstallState {
                requested: false,
                requested_at: None,
                delay_secs: delay,
                elapsed_secs: 0,
                remaining_secs: delay,
                ready: false,
                confirm_phrase: String::new(),
            }
        }
    }
}

/// Current uninstall-request state (pending? ready? seconds remaining?).
#[tauri::command]
fn get_uninstall_state(friction: tauri::State<'_, Arc<friction::FrictionStore>>) -> uninstall::UninstallState {
    uninstall_state_from(&friction)
}

/// Open an uninstall request, starting the cool-off countdown. Idempotent — an
/// existing pending request keeps its original clock. Protection stays fully on.
///
/// Master-password gate (4.2): opening the request is itself the first step
/// of a weakening (it starts the cool-off, even though nothing actually
/// changes yet), so it's gated the same as `set_guard_enabled`'s off path —
/// gated BEFORE the request is registered, so a wrong/missing password never
/// even starts the clock.
#[tauri::command]
fn request_uninstall(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    auth: Option<String>,
) -> Result<uninstall::UninstallState, String> {
    auth::require_auth(&app, &auth)?;
    let existing = friction.get("uninstall").is_some();
    // 4.6: mint the confirmation phrase once, at request time, and persist it
    // with the request. Re-requesting an already-pending uninstall must NOT
    // roll a new phrase — `friction.request` is idempotent for an existing
    // action id, so the original payload (and phrase) stands, which is what
    // keeps the phrase stable for the whole 24 hours and across restarts.
    let phrase = uninstall::generate_phrase();
    let view = friction.request(
        "uninstall",
        "Remove Oath Light from this computer",
        serde_json::json!({ "phrase": phrase }),
    );
    if let Ok(dir) = app.path().app_data_dir() {
        uninstall::write_marker(&dir, Some(view.requested_at));
    }
    log::warn!(
        "uninstall requested — {}s cool-off started (protection stays active)",
        view.delay_secs
    );
    // Event log (4.5) + trusted-contact notification (5.2) — only on a FRESH
    // request, not an idempotent re-request of an already-pending one.
    if !existing {
        log_event(&app, "uninstall_requested", serde_json::json!({ "delay_secs": view.delay_secs }));
        notify_contact(&app, "uninstall_requested");
    }
    Ok(uninstall_state_from(&friction))
}

/// Restart the cool-off clock (available once the window has elapsed).
///
/// Gated on `UNINSTALL_FIRED`: once `perform_uninstall` has actually launched
/// the self-delete worker, `uninstall.json` must keep showing an *elapsed*
/// request — the release-build watchdog/guardian only honor the shutdown
/// sentinel while that's true (see `watchdog::shutdown_requested` and
/// `uninstall::cooloff_elapsed_at`). Resetting the clock this late would flip
/// `cooloff_elapsed_at` back to false and make both processes refuse to stand
/// down mid-removal, fighting the worker that's about to force-kill them
/// anyway. So once removal is in flight this returns an error instead of
/// touching the persisted state.
#[tauri::command]
fn reset_uninstall_timer(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
) -> Result<uninstall::UninstallState, String> {
    if UNINSTALL_FIRED.load(Ordering::SeqCst) {
        return Err("Removal is already in progress — Oath Light is closing.".to_string());
    }
    if let Some(view) = friction.reset("uninstall") {
        if let Ok(dir) = app.path().app_data_dir() {
            uninstall::write_marker(&dir, Some(view.requested_at));
        }
    }
    log::info!("uninstall timer reset");
    Ok(uninstall_state_from(&friction))
}

/// Cancel the uninstall request and continue normally.
///
/// Gated on `UNINSTALL_FIRED` for the same reason as `reset_uninstall_timer`
/// above: cancelling clears `requested_at` entirely, which is just as fatal to
/// an in-flight removal as resetting it — both make `cooloff_elapsed_at` read
/// false and stop the watchdog/guardian from standing down while the
/// self-delete worker is mid-teardown.
#[tauri::command]
fn cancel_uninstall(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
) -> Result<uninstall::UninstallState, String> {
    if UNINSTALL_FIRED.load(Ordering::SeqCst) {
        return Err("Removal is already in progress — Oath Light is closing.".to_string());
    }
    let had = friction.cancel("uninstall");
    if let Ok(dir) = app.path().app_data_dir() {
        uninstall::write_marker(&dir, None);
    }
    log::info!("uninstall request cancelled");
    if had {
        log_event(&app, "uninstall_cancelled", serde_json::json!({}));
    }
    Ok(uninstall_state_from(&friction))
}

/// Build the main window the way `tauri.conf.json`'s `app.windows[0]` used to
/// declare it (title, size, decorations, transparency), now created on demand
/// instead of unconditionally at every launch — see `run()`'s `.setup()` and
/// `show_main_window` below for the two call sites (a normal launch creates it
/// eagerly; a login-started one waits until something asks for it).
fn create_main_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("Oath Light")
        .inner_size(1024.0, 720.0)
        .min_inner_size(820.0, 560.0)
        .resizable(true)
        .fullscreen(false)
        .decorations(false)
        .transparent(true)
        .build()?;

    // Background app: closing the window hides it to the tray and keeps
    // protection running, instead of quitting (which would drop the watchdog
    // mutex and make the guardian resurrect a fresh, focused window in the
    // user's face). Only wired when the watchdog is active (release /
    // OATHLIGHT_WATCHDOG) so ordinary `cargo run` still quits on close. Lives
    // here (rather than in `setup`) so a window created lazily, after login
    // startup, still gets the same tray-hide behavior as one created eagerly.
    if watchdog::enabled() {
        let w = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = w.hide();
                api.prevent_close();
            }
        });
    }

    Ok(window)
}

/// Bring the main window back from the tray (show + unminimize + focus). If
/// this is a login-started instance that never created a window (see
/// `run()`'s `.setup()`), build it now — this is the on-demand path for the
/// tray click and the duplicate-launch show-listener.
fn show_main_window(app: &AppHandle) {
    let win = match app.get_webview_window("main") {
        Some(win) => win,
        None => match create_main_window(app) {
            Ok(win) => win,
            Err(e) => {
                log::error!("failed to create main window: {e}");
                return;
            }
        },
    };
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// Surface the app and open the panic/SOS urge-surfing flow (plan item 5.1).
/// Shared by every entry point: the tray's "I need help now" item, the global
/// Ctrl+Shift+Space hotkey, and the extension blocked page's `open_panic`
/// deep-link. If the window didn't exist yet (login-started instance hidden in
/// the tray), the freshly created renderer can't have subscribed to
/// `open-panic` in time — latch `PANIC_PENDING` so it picks the request up on
/// load instead (`take_panic_pending`).
fn open_panic_flow(app: &AppHandle) {
    let existed = app.get_webview_window("main").is_some();
    show_main_window(app);
    if !existed {
        PANIC_PENDING.store(true, Ordering::SeqCst);
    }
    let _ = app.emit("open-panic", ());
}

/// Renderer-startup consume of a panic request that fired before the webview
/// was listening (see `open_panic_flow`). Returns true at most once per latch.
#[tauri::command]
fn take_panic_pending() -> bool {
    PANIC_PENDING.swap(false, Ordering::SeqCst)
}

/// Install the system-tray icon. Closing the window hides Oath Light to the tray
/// (it keeps running in the background); clicking the tray icon — or its "Open
/// Oath Light" item — brings the window back. There is intentionally no "Quit":
/// the only real exit is the uninstall flow, so the tray can't be used to stand
/// down protection.
fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    // "I need help now" sits above "Open Oath Light" on purpose — in the moment
    // that matters it should be the first thing the eye lands on (5.1).
    let panic = MenuItem::with_id(app, "panic", "I need help now", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Oath Light", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&panic, &open])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Oath Light — protection active")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "panic" => open_panic_flow(app),
            "open" => show_main_window(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Registry paths the NSIS installer's Add/Remove Programs entry may live
/// under (see the generated `installer.nsi`'s `UNINSTKEY`, defined as
/// `Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}` i.e.
/// `...\Uninstall\OathLight`, and written under `SHCTX` — HKCU for a per-user
/// install, HKLM (and, on a 32-bit-registry-view write, its WOW6432Node
/// mirror) for a per-machine one). After the self-delete worker removes
/// `uninstall.exe`, a leftover entry here would still show Oath Light in
/// Settings -> Apps, pointing at a now-deleted uninstaller.
#[cfg(target_os = "windows")]
const UNINSTALL_REGISTRY_KEYS: &[&str] = &[
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OathLight",
    r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\OathLight",
    r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\OathLight",
];

/// Best-effort delete of the Add/Remove Programs registry entries above, quiet
/// (no console window, mirroring the `CREATE_NO_WINDOW` pattern `watchdog.rs`
/// uses for its own `reg` calls). Failures are swallowed on purpose: deleting
/// an HKLM key requires admin, which an unprivileged per-user install won't
/// have, and a per-machine install never wrote the HKCU key — either way
/// there's nothing actionable to do about a failure here, and this cleanup is
/// cosmetic, not load-bearing for removal itself (the self-delete worker has
/// already been launched by the time this runs).
#[cfg(target_os = "windows")]
fn remove_uninstall_registry_entries() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for key in UNINSTALL_REGISTRY_KEYS {
        let result = std::process::Command::new("reg")
            .args(["delete", key, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        match result {
            Ok(s) if s.success() => log::info!("removed uninstall registry entry: {key}"),
            _ => log::info!("uninstall registry entry not removed (absent or no permission): {key}"),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_uninstall_registry_entries() {}

/// Tear down all of Oath Light and delete it from the machine. Idempotent via
/// `UNINSTALL_FIRED`: only ever called from the explicit "Remove completely"
/// command (once the cool-off has *unlocked* removal — it never fires on its
/// own), and only the first caller runs anything.
///
/// Ordering is deliberate and safety-critical: nothing is torn down until
/// removal is guaranteed to actually proceed.
///   1. Win the `UNINSTALL_FIRED` latch, then immediately re-check
///      `friction.get("uninstall").ready`. This closes a TOCTOU: the caller
///      (`complete_uninstall`) checked readiness before calling in, but
///      `cancel_uninstall` / `reset_uninstall_timer` could in principle have
///      raced it in the gap between that check and winning the latch here (in
///      the current call graph they're also gated on `UNINSTALL_FIRED` now, so
///      this is belt-and-braces, not the only guard). If no longer ready,
///      unlatch and return an error — nothing has been touched.
///   2. Resolve `app_data_dir()` — bail out with an error if that fails; never
///      guess a fallback path (see `uninstall.rs` for why a bad path here used
///      to be catastrophic).
///   3. Spawn the self-delete worker *first*, while everything is still fully
///      intact. If it can't be started (bad paths, couldn't write/spawn the
///      batch), unlatch `UNINSTALL_FIRED` and return an error — nothing has
///      been touched, so the user can simply try again. This is safe to do
///      before the teardown below: the worker waits for our processes to exit
///      before it deletes anything, and the teardown always completes (and the
///      app exits) well before that wait is satisfied.
///   4. Only once the worker is confirmed running: stand down the reinstall
///      guard and the dual-process watchdog, remove the login autostart entry,
///      clear any force-install policy and native-messaging host
///      registrations, best-effort clear the NSIS Add/Remove Programs registry
///      entry, then close the app shortly after so the worker can delete the
///      (now unlocked) executables and data.
///
/// Deliberately does NOT *rely* on the NSIS `uninstall.exe`, which may already
/// be gone (see `uninstall.rs`) — but the self-delete worker launches it
/// silently first when it is present, so removal goes through the real
/// uninstaller (shortcuts, installer registry state) with the batch's rmdir
/// sweep as the guaranteed fallback.
fn perform_uninstall(app: &AppHandle) -> Result<String, String> {
    // Latch: only the first caller runs the teardown.
    if UNINSTALL_FIRED.swap(true, Ordering::SeqCst) {
        return Ok("launched".to_string());
    }

    // TOCTOU close: `complete_uninstall` checked `friction.get("uninstall").ready` before
    // calling here, but that check and this latch-win aren't atomic with each
    // other — a `cancel_uninstall`/`reset_uninstall_timer` call could in
    // principle land in the gap between them. Both of those commands are now
    // themselves gated on `UNINSTALL_FIRED` (see their doc comments), which
    // closes the *reverse* race (cancel-after-launch); this re-check closes
    // the remaining direction by re-verifying readiness ourselves now that
    // we're the confirmed sole winner of the latch, before anything is
    // touched. If it's no longer ready, unlatch so a future genuine attempt
    // isn't permanently blocked.
    if let Some(friction) = app.try_state::<Arc<friction::FrictionStore>>() {
        if !friction.get("uninstall").is_some_and(|p| p.ready) {
            UNINSTALL_FIRED.store(false, Ordering::SeqCst);
            return Err("The waiting period hasn't elapsed yet.".to_string());
        }
    }

    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            UNINSTALL_FIRED.store(false, Ordering::SeqCst);
            return Err(format!("Could not resolve the app data directory ({e}); nothing was changed."));
        }
    };

    // Spawn the self-delete worker BEFORE touching anything else. If it fails,
    // unlatch and report — the app is exactly as it was, so this can be retried.
    let install_dir = match uninstall::spawn_self_delete(&app_data_dir) {
        uninstall::LaunchResult::Launched(what) => what,
        uninstall::LaunchResult::NotFound => {
            UNINSTALL_FIRED.store(false, Ordering::SeqCst);
            log::warn!("self-delete could not be started — nothing was changed, removal can be retried");
            return Err(
                "Could not start removal (couldn't verify the install/data paths or launch the \
                 cleanup worker). Nothing was changed — you can try again.".to_string(),
            );
        }
    };
    log::warn!("self-delete worker started; wiping {install_dir}");

    // Now that removal is guaranteed to proceed, stand down the reinstall guard
    // so enforcement stops fighting it.
    if let Some(state) = app.try_state::<Arc<Mutex<AppState>>>() {
        state.lock().unwrap().guard_enabled = false;
    }
    // System DNS filter (1.1): stop the resolver and restore adapter DNS to
    // the captured upstreams, so uninstalling never leaves the machine
    // pointing at a resolver that's about to be deleted. The guardian does
    // the same as its last act (guardian/src/main.rs) — belt and suspenders,
    // since this runs before the app exits and that runs after.
    if let Some(dns) = app.try_state::<Arc<dns_filter::DnsFilterState>>() {
        dns.disable();
    }
    // Stand down the dual-process watchdog so neither process resurrects the
    // other while we delete the app, and drop the login autostart entry so it
    // cannot come back at the next boot.
    watchdog::request_shutdown();
    watchdog::unregister_autostart();
    // Clear any force-install policy (+ the DoH-disable policy, via
    // remove_policy) and native-host registrations we wrote.
    for def in BROWSERS {
        browsers::remove_policy(def);
    }
    browsers::unregister_all_hosts();
    // Drop the elevated logon task, if we ever created one (best-effort).
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("schtasks")
            .args(["/Delete", "/TN", "OathLightElevated", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    // Best-effort: clear the NSIS Add/Remove Programs entry so it doesn't
    // linger in Settings -> Apps pointing at a deleted uninstaller. Purely
    // cosmetic — never blocks or fails the removal itself.
    remove_uninstall_registry_entries();
    // NB: deliberately do NOT cancel the persisted request here. In a release
    // build the watchdog only honors the shutdown sentinel while
    // `uninstall.json` still shows an *elapsed* request (see
    // `watchdog::shutdown_requested` / `uninstall::cooloff_elapsed_at`); zeroing
    // it would make both processes refuse to stand down and keep resurrecting
    // mid-removal. It is now safe to leave the file as-is: nothing auto-fires
    // on the next launch (the watcher that used to do that is gone), so an
    // interrupted removal just leaves the request in its "ready" state, which
    // the user can simply re-trigger from the settings page.
    log::warn!("uninstall confirmed — guard disabled, policy + host registrations cleared");

    // Close the app shortly after so the worker can delete the (now unlocked)
    // executables and data.
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(2000));
        app2.exit(0);
    });
    Ok("launched".to_string())
}

/// Complete the uninstall once the cool-off has elapsed (unlocked). Returns
/// `Ok("launched")` (removal started; the app will close and delete itself) or
/// `Err(message)` if removal could not be started — in which case nothing was
/// changed and the user can retry.
#[tauri::command]
fn complete_uninstall(
    app: AppHandle,
    friction: tauri::State<'_, Arc<friction::FrictionStore>>,
    confirm: Option<String>,
) -> Result<String, String> {
    if !friction.get("uninstall").is_some_and(|p| p.ready) {
        return Err("The waiting period hasn't elapsed yet.".to_string());
    }
    // 4.6 — type-the-phrase friction. The 24h wait guards the impulsive
    // moment; this guards the moment it ends, when the button is finally live
    // and a whole day of anticipation is behind it. Checked in Rust, not the
    // renderer, so it holds for any caller of this command.
    let expected = friction
        .payload_of("uninstall")
        .and_then(|v| v.get("phrase").and_then(|p| p.as_str()).map(String::from))
        .unwrap_or_default();
    if !uninstall::phrase_matches(&expected, confirm.as_deref().unwrap_or("")) {
        return Err("The confirmation phrase doesn't match. Type it out exactly as shown.".to_string());
    }
    // Event log (4.5): record that removal was actually executed, before the
    // app tears itself down — the app-data dir (and this log with it) is
    // about to be deleted, but the entry is fsync'd immediately, and a
    // trusted contact / future self can still see it in any backup.
    log_event(&app, "uninstall_completed", serde_json::json!({}));
    perform_uninstall(&app)
}

// ============================================================================
// Update mode (see `update.rs`) — commands.
//
// The problem these solve is stated in full in that module's doc: every guard
// that makes Oath Light hard to remove also makes it impossible to install a
// new build over, because both executables are running and each resurrects the
// other. `begin_update` opens a bounded window in which the resurrection guards
// alone stand aside, closes the app so its files unlock, and arms a one-shot
// task that brings everything back if the update never happens.
//
// Note what is NOT in here. No blocklist is unloaded, no browser policy is
// removed, no extension enforcement is relaxed, the uninstall friction is
// untouched, and autostart stays registered. An update window is not a way to
// turn Oath Light off for a quarter of an hour; it is a way to let a file be
// replaced.
// ============================================================================

/// What the Settings card renders.
#[derive(Debug, Clone, serde::Serialize)]
struct UpdateStateView {
    /// Whether a window is open right now (re-validated on read — a stale or
    /// hand-edited `update.json` reports `false`, see `update::window_active_at`).
    active: bool,
    /// Seconds left on it; `0` when none is open.
    seconds_left: u64,
    /// The full window length, so the UI can state the bound without hardcoding
    /// its own copy of the constant.
    window_secs: u64,
    /// The running build, shown so the user can tell what they are updating
    /// from before they close it.
    app_version: String,
    /// Whether the expiry-recovery task is armed. Reported honestly rather than
    /// assumed: if `schtasks` failed, the user is owed the fact that nothing
    /// will bring the app back on its own.
    recovery_armed: bool,
}

fn update_state_view(app: &AppHandle, recovery_armed: bool) -> UpdateStateView {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (active, seconds_left) = match app.path().app_data_dir() {
        Ok(d) => {
            let p = update::path_in(&d);
            (update::window_active_at(&p), update::seconds_left_at(&p, now))
        }
        Err(_) => (false, 0),
    };
    UpdateStateView {
        active,
        seconds_left,
        window_secs: update::WINDOW_SECS,
        app_version: app.package_info().version.to_string(),
        recovery_armed,
    }
}

#[tauri::command]
fn get_update_state(app: AppHandle) -> UpdateStateView {
    // `recovery_armed` is only meaningful in the reply to `begin_update`, which
    // is the one call that knows whether `schtasks` succeeded. A plain status
    // poll reports it as armed exactly when a window is open, which is the
    // state `begin_update` leaves behind on the happy path.
    let active = app
        .path()
        .app_data_dir()
        .map(|d| update::window_active_at(&update::path_in(&d)))
        .unwrap_or(false);
    update_state_view(&app, active)
}

/// Best-effort: end the native-messaging host processes.
///
/// `oath-light-host.exe` is spawned by the browsers, not by us, so it can be
/// running (and therefore locked) with no Oath Light window open at all. The
/// installer cannot replace a locked file, which makes this the most likely
/// remaining way for an update to half-succeed. Killing it costs nothing — the
/// browser respawns one on its next connection, against whichever binary is
/// there by then.
#[cfg(target_os = "windows")]
fn kill_native_hosts() {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "oath-light-host.exe", "/T"])
        .creation_flags(0x0800_0000)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn kill_native_hosts() {}

/// Open an update window and close the app so an installer can replace it.
///
/// Gated on the master password (4.2), same as every other command that makes
/// the app easier to get around, and recorded in the tamper-evident event log
/// (4.5) — the point is not that this is dangerous, it is that a window where
/// the watchdog stands down should never be something the user's future self
/// can't see happened.
///
/// Deliberately NOT friction-gated. A cool-off on updating would mean shipping
/// a security fix that users have to wait a day to apply, and the bound that
/// makes this safe is the window's own fifteen-minute expiry, not a delay in
/// front of it.
///
/// Order matters, and mirrors `perform_uninstall`: arm the recovery FIRST,
/// while everything is still intact, so the failure mode of a broken
/// `schtasks` is "the update didn't start" rather than "the guards are down and
/// nothing is coming back."
#[tauri::command]
fn begin_update(app: AppHandle, auth: Option<String>) -> Result<UpdateStateView, String> {
    auth::require_auth(&app, &auth)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data directory ({e}); nothing was changed."))?;

    let version = app.package_info().version.to_string();
    let window = update::open(&app_data_dir, &version)?;

    // Arm the recovery before standing anything down. If this fails the window
    // is still openable — an update that can't be undone by a timer is a
    // choice the user is allowed to make — but they are told, and the UI says
    // so rather than quietly implying a safety net that isn't there.
    let recovery_armed = match std::env::current_exe() {
        Ok(exe) => match update::schedule_recovery(&exe, window.expires_at) {
            Ok(()) => true,
            Err(e) => {
                log::warn!("update: could not arm the expiry recovery task: {e}");
                false
            }
        },
        Err(e) => {
            log::warn!("update: could not resolve our own exe path for recovery: {e}");
            false
        }
    };

    // Now stand the resurrection guards down on both sides.
    watchdog::request_update_standdown(&update::path_in(&app_data_dir));

    // Stop the in-process DNS resolver and hand the adapters back their real
    // upstreams. Without this the machine would be pointed at a resolver that
    // is about to exit — the same reasoning as `perform_uninstall`, and the
    // guardian repeats it as its own last act.
    if let Some(dns) = app.try_state::<Arc<dns_filter::DnsFilterState>>() {
        dns.disable();
    }

    kill_native_hosts();

    log::warn!(
        "update window opened (expires in {}s, recovery {}) — watchdog standing down, app closing",
        update::WINDOW_SECS,
        if recovery_armed { "armed" } else { "NOT armed" }
    );
    log_event(
        &app,
        "update_started",
        serde_json::json!({
            "from_version": version,
            "window_secs": update::WINDOW_SECS,
            "recovery_armed": recovery_armed,
        }),
    );

    let view = update_state_view(&app, recovery_armed);

    // Same 2-second grace as the uninstall path: long enough for this reply to
    // reach the webview and for the UI to say what is about to happen.
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(2000));
        app2.exit(0);
    });

    Ok(view)
}

/// Close an open update window without updating: clear the file, drop the
/// sentinel, disarm the recovery task. Ungated — re-arming the guards early is
/// a strengthening, and nothing that makes protection stronger has ever needed
/// the password (see auth.rs's module doc).
///
/// Mostly reachable in one narrow case, since `begin_update` closes the app:
/// the user changed their mind in the two seconds before it did. It also runs
/// on startup, which is the path that actually matters.
#[tauri::command]
fn cancel_update(app: AppHandle) -> Result<UpdateStateView, String> {
    if let Ok(d) = app.path().app_data_dir() {
        update::clear(&d);
    }
    watchdog::clear_update_standdown();
    update::cancel_recovery();
    log::info!("update window cancelled — guards re-armed");
    Ok(update_state_view(&app, false))
}

// ============================================================================
// Entry point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Elevated one-shot: this instance was relaunched with admin rights for the
    // sole purpose of writing the force-install policy (which *requires*
    // elevation — the `Software\Policies` key is admin-only) and registering the
    // elevated login task. It must not launch the UI or take the watchdog mutex.
    #[cfg(target_os = "windows")]
    if std::env::args().any(|a| a == "--elevated-setup") {
        elevated_setup();
        return;
    }

    // Dual-process watchdog (Phase 4 tamper resistance). Acquire the main-role
    // mutex and start guarding the guardian *before* the window comes up; this
    // also exits early if another main instance is already running.
    watchdog::init_main();

    let shared_state = Arc::new(Mutex::new(AppState {
        guard_enabled: true,
        ..Default::default()
    }));

    tauri::Builder::default()
        .manage(shared_state.clone())
        .manage(NsfwState::default())
        .manage(MonitorState::default())
        .manage(Arc::new(overlay::OverlayState::default()))
        // Restore windows are deliberately in-memory only: a grace window is a
        // supervised 20 seconds, and one that survived a restart would be a
        // pass the user could bank by closing the app.
        .manage(Arc::new(browser_lock::BrowserLockState::default()))
        .invoke_handler(tauri::generate_handler![
            get_extension_stats,
            get_extension_blocklists,
            get_blocklist_counts,
            check_domain_blocked,
            set_custom_domains,
            remove_custom_domain,
            get_pending_weakenings,
            cancel_weakening,
            get_browsers_status,
            set_guard_enabled,
            get_app_settings,
            get_mentor_config,
            set_mentor_config,
            mentor_send,
            add_blocked_process,
            remove_blocked_process,
            set_block_unknown_browsers,
            get_dns_status,
            set_dns_filter_enabled,
            set_extension_theme,
            set_blocking_settings,
            open_external,
            set_app_streak,
            enforce_extension,
            open_extensions_page,
            set_browser_lock_enabled,
            request_browser_restore,
            request_elevated_setup,
            request_sync,
            update_blocklist_domains,
            update_blocklist_keywords,
            get_ota_status,
            check_lists_update_now,
            classify_image,
            start_nsfw_monitor,
            stop_nsfw_monitor,
            nsfw_monitor_running,
            dismiss_overlay,
            report_false_positive,
            get_eval_log,
            get_recovery_log,
            log_urge,
            log_slip,
            mark_milestone,
            migrate_recovery_streak,
            set_grayscale_vulnerable_hours,
            stop_watchdog,
            get_uninstall_state,
            request_uninstall,
            reset_uninstall_timer,
            cancel_uninstall,
            complete_uninstall,
            get_update_state,
            begin_update,
            cancel_update,
            take_panic_pending,
            get_auth_status,
            verify_master_password,
            set_master_password,
            request_password_removal,
            request_password_removal_forgotten,
            get_lockdown_state,
            start_lockdown,
            cancel_lockdown,
            request_lockdown_allow,
            set_lockdown_escalation,
            set_serious_mode,
            get_trusted_contact,
            set_trusted_contact,
            request_remove_trusted_contact,
            get_smtp_config,
            set_smtp_config,
            test_trusted_contact_send,
            get_event_log,
            verify_event_log,
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Panic/SOS global hotkey (5.1): Ctrl+Shift+Space surfaces the app
            // and opens the urge-surfing flow from anywhere. A registration
            // failure (some other app already owns the combination) is logged
            // and never fatal — the tray item and the blocked-page button
            // still reach the same flow.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            // Only one shortcut is ever registered, so any
                            // event that arrives here is ours.
                            if event.state() == ShortcutState::Pressed {
                                open_panic_flow(app);
                            }
                        })
                        .build(),
                )?;
                if let Err(e) = app.global_shortcut().register("ctrl+shift+space") {
                    log::warn!("panic hotkey (Ctrl+Shift+Space) not registered: {e}");
                }
            }

            // Native-host registration (manifest writes + several `reg.exe`
            // spawns in browsers.rs) and login-autostart registration (another
            // `reg.exe` spawn) are both idempotent and nothing else in setup
            // depends on them having completed yet, so they run on a
            // background thread instead of blocking the window/tray coming up
            // on a handful of child-process spawns. Relative order preserved:
            // native-host registration first, then — gated the same as
            // before on the watchdog being active — autostart registration.
            let bg_handle = app.handle().clone();
            std::thread::spawn(move || {
                register_native_host(&bg_handle);
                if watchdog::enabled() {
                    watchdog::register_autostart();
                }
            });

            // Background app: closing the window hides it to the tray and keeps
            // protection running, instead of quitting (which would drop the
            // watchdog mutex and make the guardian resurrect a fresh, focused
            // window in the user's face). Only wired when the watchdog is active
            // (release / OATHLIGHT_WATCHDOG) so ordinary `cargo run` still quits
            // on close. A tray icon brings the window back; the only real exit is
            // the uninstall flow.
            if watchdog::enabled() {
                install_tray(app.handle())?;

                // Single-instance activation: a duplicate launch (desktop
                // shortcut while this instance is already running hidden in the
                // tray) finds the watchdog's main mutex held and exits, but not
                // before signaling a named event. Listen for that here and
                // surface our window instead of the duplicate launch silently
                // doing nothing.
                let handle = app.handle().clone();
                watchdog::start_show_listener(move || show_main_window(&handle));
            }

            // The window used to be declared in tauri.conf.json and created
            // (then immediately hidden) on every launch, including the hidden
            // login-autostart one — WebView2 process spawn + renderer load is
            // the single biggest startup cost, wasted work when a login-started
            // instance has nobody to show it to. It's now created eagerly only
            // for a normal, user-initiated launch; a login-started instance
            // stays windowless until something asks for it (tray click /
            // duplicate-launch signal — see `show_main_window`).
            if !watchdog::launched_at_login() {
                create_main_window(app.handle())?;
            }

            // Persisted 24-hour uninstall request (survives restarts + a wiped
            // renderer localStorage).
            let udd = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&udd);

            // Load previously-pushed custom-site blocks before the TCP server
            // starts serving handshakes, so the very first `host_hello` from an
            // extension already broadcasts the correct cached list.
            if let Ok(json) = std::fs::read_to_string(udd.join("custom_domains.json")) {
                if let Ok(domains) = serde_json::from_str::<Vec<String>>(&json) {
                    shared_state.lock().unwrap().custom_domains = domains;
                }
            }

            // Load the lockdown additive-allow list (4.4) the same way, so an
            // active lockdown's user-allowed sites survive a restart and are in
            // the very first `set_blocking` push on reconnect.
            if let Ok(json) = std::fs::read_to_string(udd.join("lockdown_allow.json")) {
                if let Ok(allow) = serde_json::from_str::<Vec<String>>(&json) {
                    shared_state.lock().unwrap().lockdown_allow = allow;
                }
            }

            // Tell the watchdog where uninstall.json lives now that we know the
            // app data dir (init_main() ran before this was knowable) — needed
            // so a release build can verify the cool-off before honoring the
            // shutdown sentinel, and so the guardian can be told the same path.
            watchdog::set_uninstall_json_path(udd.join("uninstall.json"));

            // Consume any update window (see `update.rs`). This instance is up
            // and holding the main mutex, so whatever the window was for is
            // over: either the installer finished and launched this build, or
            // it never ran and the recovery task brought the old one back.
            // Either way the guards belong back on, and the one-shot recovery
            // task has done its job or is no longer needed.
            //
            // `init_main()` already dropped the sentinel — it had to, since the
            // guard loop starts there — so this is the other half: the window
            // file itself, and the scheduled task.
            update::clear(&udd);
            update::cancel_recovery();

            // Generalized friction store (4.1/4.3) + backend-owned settings
            // (A.3 seed). `friction::FrictionStore::load` migrates a legacy
            // pending uninstall request out of `uninstall.json` on its own —
            // see that function's doc comment.
            let friction_store = Arc::new(friction::FrictionStore::load(&udd));
            app.manage(friction_store.clone());
            let settings_state = Arc::new(settings::SettingsState::load(&udd));
            app.manage(settings_state.clone());
            // Recovery data — urge log, slip log, streak (5.4/5.5). Moved out
            // of the renderer's localStorage so a browser-data reset or a
            // devtools edit can't erase or rewrite a ninety-day streak; see
            // recovery.rs for the full reasoning.
            app.manage(Arc::new(recovery::RecoveryState::load(&udd)));
            // System DNS filter (1.1/1.2). Managed here so commands + the
            // monitor tick share one instance. If it was on at last shutdown,
            // start + re-takeover now (idempotent) — off the startup path so
            // a couple of PowerShell spawns don't block the window coming up.
            let dns_state = Arc::new(dns_filter::DnsFilterState::new(&udd));
            app.manage(dns_state.clone());
            if settings_state.get().dns_filter_enabled {
                let dns2 = dns_state.clone();
                std::thread::spawn(move || {
                    if let Err(e) = dns2.enable() {
                        log::warn!("DNS filter auto-start failed: {e}");
                    }
                });
            }
            // Tamper-evident event log (4.5) — managed before anything that
            // might append (the TCP server / monitor threads below), so the
            // first protective event on this run always lands. Its own
            // `load` appends a `chain_restarted` entry if it detects the file
            // was edited/truncated/deleted since last run — see eventlog.rs.
            let event_log = Arc::new(EventLog::load(&udd));
            app.manage(event_log.clone());
            // Lockdown Mode (4.4) — clock-immune credited-time engine, same
            // pattern as the friction store.
            let lockdown_store = Arc::new(lockdown::LockdownStore::load(&udd));
            app.manage(lockdown_store.clone());
            // Master password (4.2). `AuthState::load` just remembers the app
            // data dir — the hash is re-read off disk on every check, so a
            // password set/changed/removed from a different running instance
            // (or by hand) takes effect immediately; see auth.rs's module doc.
            let auth_state = Arc::new(auth::AuthState::load(&udd));
            app.manage(auth_state.clone());
            // OTA blocklist updates (3.5): load any installed, signed list
            // set from <app_data_dir>/lists/ into the effective view (before
            // the TCP server starts serving handshakes, so the very first
            // extension sync already sees updated lists), then start the
            // weekly background checker. Runs in the app, not the watchdog —
            // updates are not liveness-critical.
            ota::init(app.handle(), &udd);
            // AppState was constructed with the hardcoded pre-setup default
            // (`guard_enabled: true`) before the persisted settings file could
            // be read — now that it's loaded, the persisted value wins. Same
            // for the lockdown-escalation mirror (4.4 v2) and the Serious Mode
            // mirror (UX Direction §1), which `broadcast_blocking` reads
            // instead of holding a `SettingsState` handle of its own.
            {
                let mut s0 = shared_state.lock().unwrap();
                let persisted = settings_state.get();
                s0.guard_enabled = persisted.guard_enabled;
                s0.lockdown_escalate = persisted.lockdown.escalate_vulnerable_hours;
                s0.serious_mode = persisted.serious_mode;
            }
            // No background watcher for the uninstall request specifically:
            // the cool-off elapsing only flips `UninstallState.ready`,
            // unlocking the explicit "Remove Oath Light now" action in the UI
            // (`complete_uninstall`). Nothing removes itself automatically —
            // see `perform_uninstall`. Every OTHER weakening (guard/monitor
            // disables, custom-block removals) DOES apply itself once ready —
            // that's the applier thread below.

            // Friction applier thread (4.1): once a weakening's delay has
            // elapsed, actually apply it. Polls once a second — the friction
            // store's own credited-time math (4.3) is what makes the delay
            // itself clock-tamper immune, not this loop's cadence. Heartbeats
            // (advance + persist) are throttled to every 30th tick; plain
            // reads elsewhere already advance the in-memory copy, so this is
            // just periodic flushing for stretches where nothing else happens
            // to touch the store.
            {
                let app2 = app.handle().clone();
                let friction2 = friction_store.clone();
                let state2 = shared_state.clone();
                let settings2 = settings_state.clone();
                let auth2 = auth_state.clone();
                let dns2 = dns_state.clone();
                let lockdown2 = lockdown_store.clone();
                let event_log2 = event_log.clone();
                std::thread::spawn(move || {
                    let mut tick: u64 = 0;
                    loop {
                        std::thread::sleep(Duration::from_secs(1));
                        tick += 1;
                        if tick % 30 == 0 {
                            friction2.heartbeat();
                            // Drain any clock anomalies the friction store
                            // detected (4.3) into the event log (4.5) — one
                            // `clock_anomaly` entry each, exactly once.
                            for a in friction2.drain_anomalies() {
                                event_log2.append(
                                    "clock_anomaly",
                                    serde_json::json!({ "action": a.action_id, "delta_wall": a.delta_wall, "delta_tick": a.delta_tick }),
                                );
                            }
                        }

                        // Lockdown heartbeat (4.4): advance its credited time
                        // and, if it just reached full duration, end it and
                        // push the (now inactive) state to extensions. A
                        // natural expiry is NOT a friction weakening — the
                        // whole duration was pre-committed at start time.
                        let (ld_view, expired) = lockdown2.heartbeat();
                        if expired {
                            settings2.update(|s| { s.lockdown.active_until = None; s.lockdown.frozen = false; });
                            let _ = broadcast_blocking(&state2, &lockdown2);
                            event_log2.append("lockdown_ended", serde_json::json!({ "reason": "expired" }));
                            log::info!("lockdown expired naturally (credited duration reached)");
                        } else if ld_view.active && tick % 30 == 0 {
                            // Re-push periodically so a reconnected extension
                            // (or one that missed a push) re-syncs the live
                            // remaining hint without waiting on a state change.
                            let _ = broadcast_blocking(&state2, &lockdown2);
                        }

                        // Monthly trusted-contact heartbeat (5.2): if a contact
                        // is configured and it's been >30 days since the last
                        // one, send "still protecting <name>'s computer" so that
                        // silence itself becomes a signal. Checked cheaply once a
                        // minute; the 30-day gate makes the actual send rare.
                        // Grayscale window expiry (5.6) — hand the display
                        // back the moment the window ends, and also if the
                        // extension went away mid-window (the deadline is
                        // absolute; see GRAYSCALE_UNTIL).
                        tick_grayscale();

                        if tick % 60 == 0 {
                            maybe_send_contact_heartbeat(&app2, &settings2);
                        }

                        for (action_id, payload) in friction2.take_ready() {
                            if action_id == "guard.disable" {
                                state2.lock().unwrap().guard_enabled = false;
                                settings2.update(|s| s.guard_enabled = false);
                                log::warn!("friction: uninstall guard disabled (weakening applied)");
                            } else if action_id == "browser_lock.disable" {
                                settings2.update(|s| s.lock_unverified_browsers = false);
                                if let Some(locks) =
                                    app2.try_state::<Arc<browser_lock::BrowserLockState>>()
                                {
                                    locks.clear_all();
                                }
                                log::warn!("friction: browser lock disabled (weakening applied)");
                            } else if action_id == "monitor.disable" {
                                if let Some(monitor) = app2.try_state::<MonitorState>() {
                                    monitor.running.store(false, Ordering::SeqCst);
                                }
                                settings2.update(|s| s.monitor_enabled = false);
                                log::warn!("friction: AI monitor stopped (weakening applied)");
                            } else if action_id.starts_with("custom_block.remove:") {
                                let domain = payload
                                    .get("domain")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default()
                                    .to_string();
                                if domain.is_empty() {
                                    log::warn!(
                                        "friction: '{action_id}' fired with no domain in its payload — dropping"
                                    );
                                    continue;
                                }
                                let merged = {
                                    let mut s = state2.lock().unwrap();
                                    s.custom_domains.retain(|d| *d != domain);
                                    s.custom_domains.clone()
                                };
                                if let Ok(dir) = app2.path().app_data_dir() {
                                    let _ = std::fs::create_dir_all(&dir);
                                    if let Ok(json) = serde_json::to_string_pretty(&merged) {
                                        let _ = std::fs::write(dir.join("custom_domains.json"), json);
                                    }
                                }
                                let msg = serde_json::json!({ "type": "set_custom_domains", "domains": merged });
                                let _ = broadcast_to_extensions(&state2, &msg);
                                log::warn!("friction: custom block on {domain} removed (weakening applied)");
                            } else if action_id == "password.remove" {
                                // Applies both `request_password_removal` (current
                                // password verified up front) and the "forgot it"
                                // path (`request_password_removal_forgotten`) —
                                // both register under the same action id, see
                                // that command's doc comment for why. Deletes
                                // auth.json and drops every live session token;
                                // idempotent if the file is already gone.
                                auth2.remove_password_file();
                                log::warn!("friction: master password removed (weakening applied)");
                            } else if action_id.starts_with("process_block.remove:") {
                                // 1.3: actually drop the process from the
                                // blocked list now that the delay elapsed.
                                let name = payload
                                    .get("process")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default()
                                    .to_string();
                                if name.is_empty() {
                                    log::warn!(
                                        "friction: '{action_id}' fired with no process in its payload — dropping"
                                    );
                                    continue;
                                }
                                settings2.update(|s| s.blocked_processes.retain(|p| *p != name));
                                log::warn!("friction: process block on {name} removed (weakening applied)");
                            } else if action_id == "evasion_kill.disable" {
                                // 1.3: unknown/evasion browsers drop back to
                                // the default log-only tier.
                                settings2.update(|s| s.block_unknown_browsers = false);
                                log::warn!("friction: evasion-browser kill switch disabled (weakening applied)");
                            } else if action_id == "dns.disable" {
                                // 1.1/1.2: stop the resolver + restore adapter
                                // DNS, persist the flag off, and drop the DoH
                                // policy from every browser (the reason it was
                                // written is gone).
                                dns2.disable();
                                settings2.update(|s| s.dns_filter_enabled = false);
                                for def in BROWSERS {
                                    browsers::remove_dns_policy(def);
                                }
                                log::warn!("friction: system DNS filter disabled (weakening applied)");
                            } else if action_id == "lockdown.cancel" {
                                // 4.4: a NORMAL lockdown's early-end delay
                                // elapsed — actually end it now and push the
                                // (inactive) state to extensions. (A frozen
                                // lockdown never registers this action id at
                                // all, so this can only ever end a normal one.)
                                lockdown2.cancel_now();
                                settings2.update(|s| { s.lockdown.active_until = None; s.lockdown.frozen = false; });
                                let _ = broadcast_blocking(&state2, &lockdown2);
                                log::warn!("friction: lockdown cancelled (weakening applied)");
                            } else if action_id.starts_with("lockdown.allow:") {
                                // 4.4 anti-brick: the 60s delay elapsed — add
                                // the domain to the pushed allowlist so it's
                                // reachable even in allowlist-only mode.
                                let domain = payload.get("domain").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                                if domain.is_empty() {
                                    log::warn!("friction: '{action_id}' fired with no domain — dropping");
                                    continue;
                                }
                                let allow = {
                                    let mut s = state2.lock().unwrap();
                                    if !s.lockdown_allow.contains(&domain) {
                                        s.lockdown_allow.push(domain.clone());
                                    }
                                    s.lockdown_allow.clone()
                                };
                                save_lockdown_allow(&app2, &allow);
                                let _ = broadcast_blocking(&state2, &lockdown2);
                                log::warn!("friction: lockdown-allowed {domain} (applied)");
                            } else if action_id == "lockdown.escalation_disable" {
                                // 4.4 v2: the disable delay elapsed — actually
                                // turn schedule-from-vulnerable-hours off. Does
                                // NOT touch any lockdown already in progress
                                // (started by this schedule or manually) — that
                                // still only ends via `lockdown.cancel` or
                                // natural expiry, same as always.
                                settings2.update(|s| s.lockdown.escalate_vulnerable_hours = false);
                                state2.lock().unwrap().lockdown_escalate = false;
                                let _ = broadcast_blocking(&state2, &lockdown2);
                                log::warn!("friction: lockdown schedule-from-vulnerable-hours disabled (weakening applied)");
                            } else if action_id == "serious.disable" {
                                // UX Direction §1: the doubled Serious Mode
                                // cool-off elapsed — only NOW does the mode
                                // actually come off. It stayed fully active
                                // for the whole wait, which is the entire
                                // point of the asymmetry. Everything Serious
                                // Mode turned ON stays on: this un-forces the
                                // strictness, it doesn't undo protections the
                                // user may independently want (see
                                // `set_serious_mode`).
                                settings2.update(|s| s.serious_mode = false);
                                state2.lock().unwrap().serious_mode = false;
                                let _ = broadcast_blocking(&state2, &lockdown2);
                                log::warn!("friction: serious mode disabled (weakening applied)");
                            } else if action_id == "trusted_contact.remove" {
                                // 5.2: the unwire delay elapsed — actually
                                // clear the contact. The contact was already
                                // notified at request time (anti-weak-moment).
                                settings2.update(|s| s.trusted_contact = None);
                                log::warn!("friction: trusted contact removed (weakening applied)");
                            } else {
                                // Forward-compat hook: later items add their
                                // own arms here as they gate new weakenings
                                // behind the friction store.
                                log::warn!("friction: unknown ready action id '{action_id}', dropping");
                            }
                            // Event log (4.5): every applied weakening, one
                            // `friction_applied` entry — the counterpart to the
                            // `friction_requested` entries at each command site.
                            event_log2.append("friction_applied", serde_json::json!({ "action": action_id }));
                        }
                    }
                });
            }

            // Optional AI monitor auto-start: if it was running when the app
            // last closed, bring it back — off the startup path (a short
            // sleep keeps model loading from competing with window/tray/
            // TCP-server startup) and never fatal (a missing model must not
            // crash boot).
            if settings_state.get().monitor_enabled {
                let app3 = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if let Err(e) = start_nsfw_monitor_impl(&app3) {
                        log::warn!("AI monitor auto-start failed: {e}");
                    }
                });
            }

            start_tcp_server(app.handle().clone(), shared_state.clone());
            start_monitor(app.handle().clone(), shared_state.clone());

            log::info!("Oath Light desktop app initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
