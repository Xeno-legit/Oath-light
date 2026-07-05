mod browsers;
pub mod nsfw;
pub mod nudenet;
mod profiles;
pub mod screen;
mod uninstall;
mod watchdog;

use browsers::{BrowserDef, Engine, EnforceOutcome, BROWSERS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager};

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
const BUILT_IN_KEYWORDS_JSON: &str = include_str!("../../../extension/blocklists/keywords.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionBlocklists {
    pub domains: Vec<String>,
    pub keywords: Vec<String>,
    pub domain_count: usize,
    pub keyword_count: usize,
    pub built_in_domains: Vec<String>,
    pub built_in_keywords: Vec<String>,
}

impl Default for ExtensionBlocklists {
    fn default() -> Self {
        let mut built_in_domains: Vec<String> = Vec::new();
        for json_str in [BUILT_IN_DOMAINS_P1, BUILT_IN_DOMAINS_P2, BUILT_IN_DOMAINS_P3] {
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

        Self {
            domains: Vec::new(),
            keywords: Vec::new(),
            domain_count: 0,
            keyword_count: 0,
            built_in_domains,
            built_in_keywords,
        }
    }
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

/// One scan result pushed to the UI (`nsfw-scan` event).
#[derive(Debug, Clone, Serialize)]
pub struct ScanEvent {
    pub ts: u64,
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

/// The monitor loop: poll the screen, classify only on a major change, and emit
/// a `nsfw-scan` event (with timing + a thumbnail) each time it does.
fn run_monitor(
    app: AppHandle,
    clf: Arc<nsfw::NsfwClassifier>,
    nude: Option<Arc<nudenet::NudeNetDetector>>,
    running: Arc<AtomicBool>,
) {
    log::info!("nsfw screen monitor started (nudenet: {})", nude.is_some());
    let mut prev_fp: Vec<u8> = Vec::new();
    let mut last_scan = Instant::now().checked_sub(SCAN_MIN_GAP).unwrap_or_else(Instant::now);

    while running.load(Ordering::Relaxed) {
        let t_cap = Instant::now();
        let frame = match screen::capture_primary() {
            Ok(f) => f,
            Err(e) => {
                log::warn!("screen capture failed: {e}");
                std::thread::sleep(SCAN_POLL);
                continue;
            }
        };
        let capture_ms = t_cap.elapsed().as_secs_f64() * 1000.0;
        let (width, height) = (frame.width(), frame.height());

        let fp = screen::fingerprint(&frame, SCAN_FP_SIZE);
        let change = screen::change_score(&fp, &prev_fp);
        prev_fp = fp;

        if change >= SCAN_CHANGE_THRESH && last_scan.elapsed() >= SCAN_MIN_GAP {
            let dynimg = image::DynamicImage::ImageRgba8(frame);
            let t_inf = Instant::now();
            match clf.classify_image(&dynimg) {
                Ok(classification) => {
                    // Second model: NudeNet for photographic nudity (best-effort).
                    let nudenet = nude.as_ref().and_then(|d| match d.detect_image(&dynimg) {
                        Ok(r) => Some(r),
                        Err(e) => {
                            log::warn!("nudenet detect failed: {e}");
                            None
                        }
                    });
                    let infer_ms = t_inf.elapsed().as_secs_f64() * 1000.0;
                    // Ensemble: drawn/hentai (SigLIP) OR photographic nudity (NudeNet).
                    let blocked = classification.nsfw_score >= ENSEMBLE_SIGLIP_NSFW
                        || nudenet.map_or(false, |r| r.explicit >= ENSEMBLE_NUDENET_EXPLICIT);
                    let payload = ScanEvent {
                        ts: now_unix_ms(),
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
                    last_scan = Instant::now();
                }
                Err(e) => log::warn!("classify failed: {e}"),
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
            let bl = s.blocklists.clone();
            drop(s);
            let _ = app.emit("extension-blocklist", &bl);
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
        EnforceOutcome::Enforced => "enforced",
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
// Monitor — reconcile running browsers against live connections, emit status,
// and (when configured + guard on) enforce reinstallation of a missing ext.
// ============================================================================

fn start_monitor(app: AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        // Browsers we've already enforced this session (don't re-write policy
        // every tick); cleared when the browser becomes healthy again.
        let mut enforced: HashSet<String> = HashSet::new();

        loop {
            let now = now_unix_ms();
            let proc_names = browsers::running_process_names();
            let running = browsers::detect_running_from(&proc_names);
            let guard_enabled = state.lock().unwrap().guard_enabled;

            let mut statuses = build_status(&state, &running, &proc_names, now);

            // Run enforcement when a browser's extension is gone entirely, or
            // missing from some profile (force-install covers every profile).
            for st in statuses.iter_mut() {
                if st.state != "extension_missing" && st.state != "running_partial" {
                    enforced.remove(&st.key);
                    continue;
                }
                let def = match browsers::browser_by_key(&st.key) {
                    Some(d) => d,
                    None => continue,
                };
                st.enforcement = if guard_enabled {
                    if enforced.contains(&st.key) {
                        if browsers::enforcement_configured(def.engine) { "enforced" } else { "dormant" }
                            .to_string()
                    } else {
                        let outcome = browsers::enforce_policy(def);
                        if outcome == EnforceOutcome::Enforced {
                            enforced.insert(st.key.clone());
                            log::warn!("[{}] extension missing — force-install policy applied", st.key);
                        }
                        enforce_str(outcome).to_string()
                    }
                } else {
                    "off".to_string()
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
    state.lock().unwrap().blocklists.clone()
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

/// Toggle the "keep the extension installed" guard (the uninstall-guard switch).
#[tauri::command]
fn set_guard_enabled(state: tauri::State<'_, Arc<Mutex<AppState>>>, enabled: bool) {
    state.lock().unwrap().guard_enabled = enabled;
    log::info!("Guard enabled set to {}", enabled);
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
        .map(|def| (def.key.to_string(), enforce_str(browsers::enforce_policy(def)).to_string()))
        .collect()
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

/// Start the background screen monitor (loads the model on first start). Emits a
/// `nsfw-scan` event whenever the screen changes meaningfully. Idempotent.
#[tauri::command]
fn start_nsfw_monitor(
    app: AppHandle,
    nsfw_state: tauri::State<'_, NsfwState>,
    monitor: tauri::State<'_, MonitorState>,
) -> Result<(), String> {
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
    std::thread::spawn(move || run_monitor(app_handle, classifier, detector, running));
    Ok(())
}

/// Stop the background screen monitor.
#[tauri::command]
fn stop_nsfw_monitor(monitor: tauri::State<'_, MonitorState>) {
    monitor.running.store(false, Ordering::SeqCst);
}

/// Whether the monitor is currently running.
#[tauri::command]
fn nsfw_monitor_running(monitor: tauri::State<'_, MonitorState>) -> bool {
    monitor.running.load(Ordering::SeqCst)
}

/// Authorize a real shutdown of the dual-process watchdog so closing the app no
/// longer triggers resurrection. The legitimate quit path (the uninstall flow)
/// calls this; it is also the kill switch during development.
#[tauri::command]
fn stop_watchdog() {
    watchdog::request_shutdown();
}

// ============================================================================
// 24-hour uninstall request (Phase 4 friction)
// ============================================================================

/// Current uninstall-request state (pending? ready? seconds remaining?).
#[tauri::command]
fn get_uninstall_state(
    store: tauri::State<'_, Arc<uninstall::UninstallStore>>,
) -> uninstall::UninstallState {
    store.get()
}

/// Open an uninstall request, starting the cool-off countdown. Idempotent — an
/// existing pending request keeps its original clock. Protection stays fully on.
#[tauri::command]
fn request_uninstall(
    store: tauri::State<'_, Arc<uninstall::UninstallStore>>,
) -> uninstall::UninstallState {
    let st = store.request();
    log::warn!(
        "uninstall requested — {}s cool-off started (protection stays active)",
        st.delay_secs
    );
    st
}

/// Restart the cool-off clock (available once the window has elapsed).
#[tauri::command]
fn reset_uninstall_timer(
    store: tauri::State<'_, Arc<uninstall::UninstallStore>>,
) -> uninstall::UninstallState {
    log::info!("uninstall timer reset");
    store.reset()
}

/// Cancel the uninstall request and continue normally.
#[tauri::command]
fn cancel_uninstall(
    store: tauri::State<'_, Arc<uninstall::UninstallStore>>,
) -> uninstall::UninstallState {
    log::info!("uninstall request cancelled");
    store.cancel()
}

/// Complete the uninstall once the cool-off has elapsed: stand down the guard,
/// clear any force-install policy, drop the request, and launch the OS
/// uninstaller. Returns `"launched"` (uninstaller started; the app will close)
/// or `"manual"` (no installer found — caller shows manual-removal steps).
#[tauri::command]
fn complete_uninstall(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    store: tauri::State<'_, Arc<uninstall::UninstallStore>>,
) -> Result<String, String> {
    if !store.get().ready {
        return Err("The waiting period hasn't elapsed yet.".to_string());
    }

    // Stand down the reinstall guard so enforcement stops fighting the removal.
    state.lock().unwrap().guard_enabled = false;
    // Stand down the dual-process watchdog so neither process resurrects the
    // other while the OS uninstaller removes the app, and drop the login
    // autostart entry so it does not come back at the next boot.
    watchdog::request_shutdown();
    watchdog::unregister_autostart();
    // Clear any force-install policy we may have written (best-effort).
    for def in BROWSERS {
        browsers::remove_policy(def);
    }
    // Drop the persisted request — the cool-off is spent.
    store.cancel();
    log::warn!("uninstall confirmed — guard disabled, policy cleared");

    match uninstall::launch_uninstaller() {
        uninstall::LaunchResult::Launched(what) => {
            log::warn!("uninstaller launched: {what}");
            // Close the app shortly after so the uninstaller can remove the
            // running executable cleanly.
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2000));
                app2.exit(0);
            });
            Ok("launched".to_string())
        }
        uninstall::LaunchResult::NotFound => {
            log::warn!("no installer found — protection disabled, manual removal needed");
            Ok("manual".to_string())
        }
    }
}

// ============================================================================
// Entry point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![
            get_extension_stats,
            get_extension_blocklists,
            get_browsers_status,
            set_guard_enabled,
            set_extension_theme,
            set_blocking_settings,
            open_external,
            set_app_streak,
            enforce_extension,
            request_sync,
            update_blocklist_domains,
            update_blocklist_keywords,
            classify_image,
            start_nsfw_monitor,
            stop_nsfw_monitor,
            nsfw_monitor_running,
            stop_watchdog,
            get_uninstall_state,
            request_uninstall,
            reset_uninstall_timer,
            cancel_uninstall,
            complete_uninstall,
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            register_native_host(app.handle());

            // Persistence: keep Pure Path starting at login so protection
            // survives reboots (enforced like the watchdog, gated to release /
            // PUREPATH_WATCHDOG so dev logins aren't hijacked). A login-triggered
            // launch comes up minimized, out of the way.
            if watchdog::enabled() {
                watchdog::register_autostart();
            }
            if watchdog::launched_at_login() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.minimize();
                }
            }

            // Persisted 24-hour uninstall request (survives restarts + a wiped
            // renderer localStorage).
            let udd = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&udd);
            // Tell the watchdog where uninstall.json lives now that we know the
            // app data dir (init_main() ran before this was knowable) — needed
            // so a release build can verify the cool-off before honoring the
            // shutdown sentinel, and so the guardian can be told the same path.
            watchdog::set_uninstall_json_path(udd.join("uninstall.json"));
            app.manage(Arc::new(uninstall::UninstallStore::load(&udd)));

            start_tcp_server(app.handle().clone(), shared_state.clone());
            start_monitor(app.handle().clone(), shared_state.clone());

            log::info!("Pure Path desktop app initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
