mod auth;
mod browsers;
mod friction;
pub mod nsfw;
pub mod nudenet;
mod overlay;
mod profiles;
pub mod screen;
mod settings;
mod uninstall;
mod watchdog;

use browsers::{BrowserDef, Engine, EnforceOutcome, BROWSERS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::path::BaseDirectory;
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

const BUILT_IN_DOMAINS_P1: &str = include_str!("../../../extension/blocklists/domains_part1.json");
const BUILT_IN_DOMAINS_P2: &str = include_str!("../../../extension/blocklists/domains_part2.json");
const BUILT_IN_DOMAINS_P3: &str = include_str!("../../../extension/blocklists/domains_part3.json");
// AI-erotica category (AI-girlfriend/companion sites, NSFW AI image
// generators, NSFW character-chat frontends, jailbroken chat UIs) — same
// {"domains": [...]} shape as the other parts, just its own category file.
const BUILT_IN_DOMAINS_AI: &str = include_str!("../../../extension/blocklists/domains_ai.json");
const BUILT_IN_KEYWORDS_JSON: &str = include_str!("../../../extension/blocklists/keywords.json");

/// Parses the ~10.5MB of bundled built-in domain/keyword JSON exactly once,
/// on first access, instead of at `AppState::default()` construction time —
/// which used to run before Tauri even starts, on every launch including the
/// hidden login-autostart one. Cached behind a `OnceLock` so the parse cost
/// (and the resulting heap allocation) is paid only if/when something actually
/// asks for the built-in lists (see `get_extension_blocklists`), never on the
/// startup path itself.
fn built_in_lists() -> &'static (Vec<String>, Vec<String>) {
    static LISTS: std::sync::OnceLock<(Vec<String>, Vec<String>)> = std::sync::OnceLock::new();
    LISTS.get_or_init(|| {
        let mut built_in_domains: Vec<String> = Vec::new();
        for json_str in [BUILT_IN_DOMAINS_P1, BUILT_IN_DOMAINS_P2, BUILT_IN_DOMAINS_P3, BUILT_IN_DOMAINS_AI] {
            if let Ok(v) = serde_json::from_str::<Value>(json_str) {
                if let Some(arr) = v.get("domains").and_then(|a| a.as_array()) {
                    built_in_domains.extend(arr.iter().filter_map(|x| x.as_str().map(String::from)));
                }
            }
        }

        let mut built_in_keywords: Vec<String> = Vec::new();
        if let Ok(v) = serde_json::from_str::<Value>(BUILT_IN_KEYWORDS_JSON) {
            if let Some(arr) = v.get("keywords").and_then(|a| a.as_array()) {
                built_in_keywords = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            }
        }

        (built_in_domains, built_in_keywords)
    })
}

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
/// bundled lists, but only where a field is still empty — a `blocklist_sync`
/// message from an extension can legitimately overwrite these with its own
/// (possibly newer) built-in tables, and that value must always win over the
/// bundled default.
fn fill_built_in_lists(bl: &mut ExtensionBlocklists) {
    let (domains, keywords) = built_in_lists();
    if bl.built_in_domains.is_empty() {
        bl.built_in_domains = domains.clone();
    }
    if bl.built_in_keywords.is_empty() {
        bl.built_in_keywords = keywords.clone();
    }
}

/// Normalize a user-entered domain the same way everywhere one is compared or
/// stored: trim, lowercase, strip a leading `http(s)://` and `www.`, and cut
/// at the first path separator. Mirrors the extension-side normalization in
/// `background.js`'s `addCustomDomain`/`checkDomainBlocked` handlers, so a
/// domain typed in the desktop UI and one typed into the extension's own
/// blocklist page collapse to the same string.
fn normalize_domain(raw: &str) -> String {
    let mut d = raw.trim().to_lowercase();
    if let Some(rest) = d.strip_prefix("https://") {
        d = rest.to_string();
    } else if let Some(rest) = d.strip_prefix("http://") {
        d = rest.to_string();
    }
    if let Some(rest) = d.strip_prefix("www.") {
        d = rest.to_string();
    }
    if let Some(idx) = d.find('/') {
        d.truncate(idx);
    }
    d
}

/// Normalize a whole list, dropping empties and deduping while preserving
/// first-seen order (order doesn't matter for blocking, but it keeps the
/// persisted file and re-pushed messages stable/diffable).
fn normalize_domain_list(domains: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for raw in domains {
        let d = normalize_domain(raw);
        if d.is_empty() {
            continue;
        }
        if seen.insert(d.clone()) {
            out.push(d);
        }
    }
    out
}

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
                || nudenet.as_ref().map_or(false, |r| r.explicit >= ENSEMBLE_NUDENET_EXPLICIT);

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
                    s.block_counts.insert(key, v);
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
// Update server — serves the packed CRX + update manifest over localhost so the
// Chromium force-install policy can pull the extension fully offline.
// ============================================================================

/// Port the update server binds. MUST match the port in `CHROMIUM_UPDATE_URL`
/// (browsers.rs) and the codebase URL baked into `scripts/pack-extension.mjs`.
const UPDATE_SERVER_PORT: u16 = 17244;

/// Flipped true once the update server has bound its port AND holds the packed
/// CRX + manifest. Enforcement MUST NOT write a force-install policy until this
/// is true: a policy points browsers at our update URL, and if nothing answers
/// there the browser locks itself to an extension it can never install —
/// policy-forced and un-removable. Gating on this is what stops that brick.
static UPDATE_SERVER_READY: AtomicBool = AtomicBool::new(false);

/// Set after an elevated setup pass completes, to tell the monitor to flush its
/// per-session enforcement memo and re-read the policy state (which the elevated
/// pass just wrote). Without this the monitor would keep showing the pre-
/// elevation "needs admin" result it had already memoized.
static RE_ENFORCE_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Bind the localhost update server. The Chromium `ExtensionInstallForcelist`
/// policy points browsers at `http://127.0.0.1:17244/update_manifest.xml`; this
/// serves that manifest and the signed `purepath.crx` next to it. Two static
/// files, hand-rolled HTTP/1.1, no dependency.
///
/// Reads both files once at startup (they're bundled Tauri resources produced by
/// `pack-extension.mjs`). If they can't be found — e.g. the packer didn't run —
/// it logs and does **not** bind, so browsers simply fail to resolve the update
/// rather than being served a broken response.
/// Load the packed CRX + update manifest, trying the bundled resource dir first
/// (production) and then the dev source tree (`CARGO_MANIFEST_DIR/resources`,
/// where `pack-extension.mjs` writes during `tauri dev` — the Resource base
/// dir does not point there in dev). `None` if either file is missing anywhere.
fn load_update_assets(app: &AppHandle) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve("resources", BaseDirectory::Resource) {
        roots.push(p);
    }
    roots.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));

    let read_first = |name: &str| -> Option<Vec<u8>> {
        roots.iter().find_map(|r| std::fs::read(r.join(name)).ok())
    };
    match (read_first("update_manifest.xml"), read_first("purepath.crx")) {
        (Some(x), Some(c)) => Some((x, c)),
        _ => None,
    }
}

fn start_update_server(app: AppHandle) {
    let (xml, crx) = match load_update_assets(&app) {
        Some((x, c)) => (Arc::new(x), Arc::new(c)),
        None => {
            // Do not start, and leave UPDATE_SERVER_READY false so enforcement
            // never points a browser at a URL nothing will answer.
            log::error!(
                "update server: packed extension resources not found — not starting (enforcement stays off)"
            );
            return;
        }
    };

    std::thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", UPDATE_SERVER_PORT);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => {
                log::info!("update server listening on {}", addr);
                l
            }
            Err(e) => {
                log::error!("update server: failed to bind {}: {}", addr, e);
                return;
            }
        };
        // Bound and holding the assets — only now is it safe for enforcement to
        // point browsers at us.
        UPDATE_SERVER_READY.store(true, Ordering::SeqCst);
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };
            let xml = xml.clone();
            let crx = crx.clone();
            std::thread::spawn(move || serve_update_conn(stream, &xml, &crx));
        }
    });
}

/// Handle one update-server request. We only need the request line's path; the
/// two routes serve static bytes with `Connection: close`.
fn serve_update_conn(mut stream: TcpStream, xml: &[u8], crx: &[u8]) {
    use std::io::{Read, Write};
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "?".to_string());
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut buf = [0u8; 1024];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");

    let (status, ctype, body): (&str, &str, &[u8]) = if path.starts_with("/update_manifest.xml") {
        ("200 OK", "application/xml", xml)
    } else if path.starts_with("/purepath.crx") {
        ("200 OK", "application/x-chrome-extension", crx)
    } else {
        ("404 Not Found", "text/plain", b"not found")
    };

    // These are the only signal we have that a real Chrome ever reached the
    // localhost update endpoint, vs. the policy silently not taking effect.
    if status == "200 OK" {
        log::info!("update server: {} GET {} -> 200 ({} bytes)", peer, path, body.len());
    } else {
        log::warn!("update server: {} GET {} -> 404", peer, path);
    }

    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        ctype,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

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
                    let blocking = state.lock().unwrap().ext_blocking.clone();
                    if let Some(settings) = blocking {
                        let _ = broadcast_to_extensions(
                            &state,
                            &serde_json::json!({ "type": "set_blocking", "settings": settings }),
                        );
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
            let running_now = running.iter().any(|r| *r == def.key);
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
            if !cfg.blocked_processes.iter().any(|b| *b == name) {
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

fn start_monitor(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        // Browsers we've already enforced this session, remembering the outcome
        // (which hive/scope the write landed in) so each tick can report it
        // without touching the registry again. Write-once: once the policy is
        // present, the browser reinstalls a removed extension on its own next
        // launch, so there's nothing to re-do until the guard is toggled off.
        // (Re-asserting a *deleted* policy key is Stage 2, the SYSTEM service.)
        let mut enforced: HashMap<String, EnforceOutcome> = HashMap::new();
        // Process-blocking / evasion-detection noise memo (1.3) — see
        // `enforce_processes`'s doc comment for what's throttled and why.
        let mut process_memo: HashMap<String, Instant> = HashMap::new();
        // Tick counter for the portable-browser deep scan (exe-path
        // enumeration is only worth paying every ~10th tick; named evasion
        // browsers are still checked on every tick regardless).
        let mut enforce_tick: u64 = 0;

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

            let mut statuses = build_status(&state, &running, &proc_names, now);

            // An elevated setup pass just wrote policy — drop the memo so every
            // browser re-reads its (now written) state this tick.
            if RE_ENFORCE_REQUESTED.swap(false, Ordering::SeqCst) {
                enforced.clear();
            }

            // Proactive force-install: lock every Chromium browser present on
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
                    // Gecko while Firefox is on hold.
                    st.enforcement = "dormant".to_string();
                    continue;
                }
                if !(st.installed || st.running) {
                    // Not present on this machine — nothing to pin.
                    st.enforcement = "off".to_string();
                    continue;
                }
                // Chrome/Edge silently drop an off-Web-Store force-install on an
                // unmanaged consumer machine (see `offstore_forceinstall_supported`).
                // Writing the policy there only produces a "managed by your
                // organization" browser and a dead forcelist entry that never
                // installs anything — so we don't write it, and we report the
                // truth. This is a hard platform limit, not a retryable failure.
                if !browsers::offstore_forceinstall_supported() {
                    enforced.remove(&st.key);
                    st.enforcement = "unsupported_device".to_string();
                    continue;
                }
                if !UPDATE_SERVER_READY.load(Ordering::SeqCst) {
                    // The update server isn't serving (still starting, or its
                    // assets are missing). Writing a policy now would point the
                    // browser at a dead URL and lock it there — so we don't.
                    st.enforcement = "off".to_string();
                    continue;
                }
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
                // policy with no real install is "pending" (a managed device may
                // still be fetching the CRX), never a green "locked".
                st.enforcement = match outcome {
                    EnforceOutcome::EnforcedMachine | EnforceOutcome::EnforcedUser
                        if !st.installed =>
                    {
                        "pending".to_string()
                    }
                    other => enforce_str(other).to_string(),
                };
            }

            let _ = app.emit("browsers-status", &statuses);
            std::thread::sleep(MONITOR_TICK);
        }
    });
}

// ============================================================================
// Native host registration (on every startup — idempotent)
// ============================================================================

fn register_native_host(app: &AppHandle) {
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
fn resolve_host_binary(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    let host_binary_name = if cfg!(windows) { "pure-path-host.exe" } else { "pure-path-host" };

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    let mut candidates: Vec<std::path::PathBuf> = vec![exe_dir.join(host_binary_name)];

    let mut dir = exe_dir.clone();
    for _ in 0..6 {
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
    let present = state.lock().unwrap().custom_domains.iter().any(|d| *d == norm);
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
fn cancel_weakening(friction: tauri::State<'_, Arc<friction::FrictionStore>>, action_id: String) -> Result<(), String> {
    if action_id == "uninstall" {
        return Err("Use the uninstall page's own cancel action instead.".to_string());
    }
    friction.cancel(&action_id);
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
    Ok(WeakeningOutcome { applied: false, pending: Some(view) })
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
    settings.get()
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
    if !list.iter().any(|p| *p == norm) {
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
    let present = settings.get().blocked_processes.iter().any(|p| *p == norm);
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
fn set_blocking_settings(state: tauri::State<'_, Arc<Mutex<AppState>>>, settings: Value) {
    state.lock().unwrap().ext_blocking = Some(settings.clone());
    let msg = serde_json::json!({ "type": "set_blocking", "settings": settings });
    let _ = broadcast_to_extensions(state.inner(), &msg);
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
    auth_state: tauri::State<'_, Arc<auth::AuthState>>,
    password: String,
) -> Result<String, String> {
    auth_state.verify(&password)
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
/// `browser_key` is None. No-op ("dormant") until the release update URL is set.
#[tauri::command]
fn enforce_extension(browser_key: Option<String>) -> Vec<(String, String)> {
    let targets: Vec<&BrowserDef> = match &browser_key {
        Some(k) => browsers::browser_by_key(k).into_iter().collect(),
        None => BROWSERS.iter().collect(),
    };
    targets
        .into_iter()
        .map(|def| {
            // Same honesty gate as the monitor: on an unmanaged device an
            // off-store force-install can't take, so don't write a dead policy —
            // report why instead.
            let status = if def.engine == Engine::Chromium
                && browsers::enforcement_configured(def.engine)
                && !browsers::offstore_forceinstall_supported()
            {
                "unsupported_device".to_string()
            } else {
                enforce_str(browsers::enforce_policy(def)).to_string()
            };
            (def.key.to_string(), status)
        })
        .collect()
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
/// force-install policy for every Chromium browser, and registers an elevated
/// logon task so future sessions re-assert the lock without a prompt. Then exits.
///
/// BRICK SAFETY: it writes a policy **only** if the localhost update server is
/// actually answering (the running unelevated app serves it — binding a high
/// port needs no admin). If nothing is serving, no policy is written, so a
/// browser is never locked to a dead update URL.
#[cfg(target_os = "windows")]
fn elevated_setup() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", UPDATE_SERVER_PORT).parse() {
        Ok(a) => a,
        Err(_) => return,
    };
    let serving =
        TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)).is_ok();

    if !browsers::offstore_forceinstall_supported() {
        // Admin doesn't help here: Chrome/Edge won't honor an off-store
        // force-install on an unmanaged device no matter who writes the key.
        // Writing HKLM policy would just brand the browser "managed by your
        // organization" for nothing, so skip it.
        log::error!(
            "elevated-setup: unmanaged device — Chrome/Edge won't honor an off-store force-install; skipping policy write"
        );
    } else if !serving {
        log::error!("elevated-setup: update server not reachable — skipping policy write (no brick)");
    } else {
        for def in BROWSERS {
            if def.engine == Engine::Chromium {
                let _ = browsers::enforce_policy(def); // elevated -> writes HKLM
            }
        }
    }

    // Elevated logon task: re-asserts the lock on future logins with no prompt.
    // Best-effort — the policy just written persists regardless, so the lock
    // holds even if the task never runs.
    if let Ok(exe) = std::env::current_exe() {
        let tr = format!("\"{}\" --autostart", exe.display());
        let _ = std::process::Command::new("schtasks")
            .args([
                "/Create", "/TN", "PurePathElevated", "/TR", &tr, "/SC", "ONLOGON",
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
                "NSFW model not found — set PUREPATH_MODEL or place image-guard-2.0.onnx next to the app".to_string()
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
                "NSFW model not found — set PUREPATH_MODEL or place image-guard-2.0.onnx next to the app".to_string()
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
    let view = friction.request("uninstall", "Remove Pure Path from this computer", serde_json::json!({}));
    if let Ok(dir) = app.path().app_data_dir() {
        uninstall::write_marker(&dir, Some(view.requested_at));
    }
    log::warn!(
        "uninstall requested — {}s cool-off started (protection stays active)",
        view.delay_secs
    );
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
        return Err("Removal is already in progress — Pure Path is closing.".to_string());
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
        return Err("Removal is already in progress — Pure Path is closing.".to_string());
    }
    friction.cancel("uninstall");
    if let Ok(dir) = app.path().app_data_dir() {
        uninstall::write_marker(&dir, None);
    }
    log::info!("uninstall request cancelled");
    Ok(uninstall_state_from(&friction))
}

/// Build the main window the way `tauri.conf.json`'s `app.windows[0]` used to
/// declare it (title, size, decorations, transparency), now created on demand
/// instead of unconditionally at every launch — see `run()`'s `.setup()` and
/// `show_main_window` below for the two call sites (a normal launch creates it
/// eagerly; a login-started one waits until something asks for it).
fn create_main_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("Pure Path")
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
    // PUREPATH_WATCHDOG) so ordinary `cargo run` still quits on close. Lives
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

/// Install the system-tray icon. Closing the window hides Pure Path to the tray
/// (it keeps running in the background); clicking the tray icon — or its "Open
/// Pure Path" item — brings the window back. There is intentionally no "Quit":
/// the only real exit is the uninstall flow, so the tray can't be used to stand
/// down protection.
fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    // "I need help now" sits above "Open Pure Path" on purpose — in the moment
    // that matters it should be the first thing the eye lands on (5.1).
    let panic = MenuItem::with_id(app, "panic", "I need help now", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Pure Path", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&panic, &open])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Pure Path — protection active")
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
/// `...\Uninstall\PurePath`, and written under `SHCTX` — HKCU for a per-user
/// install, HKLM (and, on a 32-bit-registry-view write, its WOW6432Node
/// mirror) for a per-machine one). After the self-delete worker removes
/// `uninstall.exe`, a leftover entry here would still show Pure Path in
/// Settings -> Apps, pointing at a now-deleted uninstaller.
#[cfg(target_os = "windows")]
const UNINSTALL_REGISTRY_KEYS: &[&str] = &[
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
    r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
    r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\PurePath",
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

/// Tear down all of Pure Path and delete it from the machine. Idempotent via
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
        if !friction.get("uninstall").map_or(false, |p| p.ready) {
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
    // Stand down the dual-process watchdog so neither process resurrects the
    // other while we delete the app, and drop the login autostart entry so it
    // cannot come back at the next boot.
    watchdog::request_shutdown();
    watchdog::unregister_autostart();
    // Clear any force-install policy and native-host registrations we wrote.
    for def in BROWSERS {
        browsers::remove_policy(def);
    }
    browsers::unregister_all_hosts();
    // Drop the elevated logon task, if we ever created one (best-effort).
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("schtasks")
            .args(["/Delete", "/TN", "PurePathElevated", "/F"])
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
) -> Result<String, String> {
    if !friction.get("uninstall").map_or(false, |p| p.ready) {
        return Err("The waiting period hasn't elapsed yet.".to_string());
    }
    perform_uninstall(&app)
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
            add_blocked_process,
            remove_blocked_process,
            set_block_unknown_browsers,
            set_extension_theme,
            set_blocking_settings,
            open_external,
            set_app_streak,
            enforce_extension,
            request_elevated_setup,
            request_sync,
            update_blocklist_domains,
            update_blocklist_keywords,
            classify_image,
            start_nsfw_monitor,
            stop_nsfw_monitor,
            nsfw_monitor_running,
            dismiss_overlay,
            stop_watchdog,
            get_uninstall_state,
            request_uninstall,
            reset_uninstall_timer,
            cancel_uninstall,
            complete_uninstall,
            take_panic_pending,
            get_auth_status,
            verify_master_password,
            set_master_password,
            request_password_removal,
            request_password_removal_forgotten,
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
            // (release / PUREPATH_WATCHDOG) so ordinary `cargo run` still quits
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

            // Tell the watchdog where uninstall.json lives now that we know the
            // app data dir (init_main() ran before this was knowable) — needed
            // so a release build can verify the cool-off before honoring the
            // shutdown sentinel, and so the guardian can be told the same path.
            watchdog::set_uninstall_json_path(udd.join("uninstall.json"));

            // Generalized friction store (4.1/4.3) + backend-owned settings
            // (A.3 seed). `friction::FrictionStore::load` migrates a legacy
            // pending uninstall request out of `uninstall.json` on its own —
            // see that function's doc comment.
            let friction_store = Arc::new(friction::FrictionStore::load(&udd));
            app.manage(friction_store.clone());
            let settings_state = Arc::new(settings::SettingsState::load(&udd));
            app.manage(settings_state.clone());
            // Master password (4.2). `AuthState::load` just remembers the app
            // data dir — the hash is re-read off disk on every check, so a
            // password set/changed/removed from a different running instance
            // (or by hand) takes effect immediately; see auth.rs's module doc.
            let auth_state = Arc::new(auth::AuthState::load(&udd));
            app.manage(auth_state.clone());
            // AppState was constructed with the hardcoded pre-setup default
            // (`guard_enabled: true`) before the persisted settings file could
            // be read — now that it's loaded, the persisted value wins.
            shared_state.lock().unwrap().guard_enabled = settings_state.get().guard_enabled;
            // No background watcher for the uninstall request specifically:
            // the cool-off elapsing only flips `UninstallState.ready`,
            // unlocking the explicit "Remove Pure Path now" action in the UI
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
                std::thread::spawn(move || {
                    let mut tick: u64 = 0;
                    loop {
                        std::thread::sleep(Duration::from_secs(1));
                        tick += 1;
                        if tick % 30 == 0 {
                            friction2.heartbeat();
                        }
                        for (action_id, payload) in friction2.take_ready() {
                            if action_id == "guard.disable" {
                                state2.lock().unwrap().guard_enabled = false;
                                settings2.update(|s| s.guard_enabled = false);
                                log::warn!("friction: uninstall guard disabled (weakening applied)");
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
                            } else {
                                // Forward-compat hook: later items add their
                                // own arms here as they gate new weakenings
                                // behind the friction store.
                                log::warn!("friction: unknown ready action id '{action_id}', dropping");
                            }
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

            start_update_server(app.handle().clone());
            start_tcp_server(app.handle().clone(), shared_state.clone());
            start_monitor(app.handle().clone(), shared_state.clone());

            log::info!("Pure Path desktop app initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
