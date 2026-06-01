use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

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

const BUILT_IN_DOMAINS_JSON: &str = include_str!("../../../extension/blocklists/domains.json");
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
        if let Ok(v) = serde_json::from_str::<Value>(BUILT_IN_DOMAINS_JSON) {
            if let Some(arr) = v.get("domains").and_then(|a| a.as_array()) {
                built_in_domains = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub last_heartbeat: u64, // Unix timestamp ms
    pub extension_version: String,
}

impl Default for ConnectionStatus {
    fn default() -> Self {
        Self {
            connected: false,
            last_heartbeat: 0,
            extension_version: String::new(),
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub stats: ExtensionStats,
    pub blocklists: ExtensionBlocklists,
    pub connection: ConnectionStatus,
    /// Active TCP stream to the native host (for sending messages back)
    tcp_writer: Option<TcpStream>,
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
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid JSON: {}", e),
        )
    })
}

fn write_tcp_message(writer: &mut TcpStream, msg: &Value) -> std::io::Result<()> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("JSON serialize error: {}", e),
        )
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

// ============================================================================
// Message Handler — processes messages from the extension via native host
// ============================================================================

fn handle_extension_message(
    app: &AppHandle,
    state: &Arc<Mutex<AppState>>,
    msg: &Value,
) {
    let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");

    log::info!("Received message type: {}", msg_type);

    match msg_type {
        "handshake" => {
            let mut s = state.lock().unwrap();
            s.connection.connected = true;
            s.connection.last_heartbeat = now_unix_ms();
            if let Some(v) = msg.get("extensionVersion").and_then(|v| v.as_str()) {
                s.connection.extension_version = v.to_string();
            }
            let status = s.connection.clone();
            drop(s);

            let _ = app.emit("extension-status", &status);
            log::info!("Extension connected: v{}", status.extension_version);
        }

        "stats_sync" | "stats_update" => {
            let mut s = state.lock().unwrap();
            if let Some(v) = msg.get("totalBlocks").and_then(|v| v.as_u64()) {
                s.stats.total_blocks = v;
            }
            if let Some(v) = msg.get("installDate").and_then(|v| v.as_str()) {
                s.stats.install_date = v.to_string();
            }
            if let Some(v) = msg.get("lastBlockDate").and_then(|v| v.as_str()) {
                s.stats.last_block_date = v.to_string();
            }
            if let Some(v) = msg.get("daysProtected").and_then(|v| v.as_u64()) {
                s.stats.days_protected = v;
            }
            s.connection.last_heartbeat = now_unix_ms();
            let stats = s.stats.clone();
            drop(s);

            let _ = app.emit("extension-stats", &stats);
        }

        "blocklist_sync" => {
            let mut s = state.lock().unwrap();
            if let Some(domains) = msg.get("domains").and_then(|v| v.as_array()) {
                s.blocklists.domains = domains
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                s.blocklists.domain_count = s.blocklists.domains.len();
            }
            if let Some(keywords) = msg.get("keywords").and_then(|v| v.as_array()) {
                s.blocklists.keywords = keywords
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                s.blocklists.keyword_count = s.blocklists.keywords.len();
            }
            if let Some(built_in_domains) = msg.get("builtInDomains").and_then(|v| v.as_array()) {
                s.blocklists.built_in_domains = built_in_domains
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }
            if let Some(built_in_keywords) = msg.get("builtInKeywords").and_then(|v| v.as_array()) {
                s.blocklists.built_in_keywords = built_in_keywords
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }
            s.connection.last_heartbeat = now_unix_ms();
            let bl = s.blocklists.clone();
            drop(s);

            let _ = app.emit("extension-blocklist", &bl);
        }

        "heartbeat" => {
            let mut s = state.lock().unwrap();
            s.connection.connected = true;
            s.connection.last_heartbeat = now_unix_ms();
            let status = s.connection.clone();
            drop(s);

            let _ = app.emit("extension-status", &status);
        }

        _ => {
            log::warn!("Unknown message type: {}", msg_type);
        }
    }
}

// ============================================================================
// Send message back TO the extension (via native host TCP)
// ============================================================================

fn send_to_extension(state: &Arc<Mutex<AppState>>, msg: &Value) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    if let Some(ref mut writer) = s.tcp_writer {
        write_tcp_message(writer, msg).map_err(|e| format!("TCP write error: {}", e))
    } else {
        Err("No active connection to extension".to_string())
    }
}

// ============================================================================
// TCP Server — Listens for connections from the native host
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
            match stream {
                Ok(stream) => {
                    log::info!("Native host connected");

                    // Store the writer clone for sending messages back
                    let writer_clone = stream.try_clone().ok();
                    {
                        let mut s = state.lock().unwrap();
                        s.tcp_writer = writer_clone;
                        s.connection.connected = true;
                        s.connection.last_heartbeat = now_unix_ms();
                    }

                    let _ = app.emit("extension-status", &ConnectionStatus {
                        connected: true,
                        last_heartbeat: now_unix_ms(),
                        extension_version: String::new(),
                    });

                    // Immediately ask the extension for fresh data
                    {
                        let sync_msg = serde_json::json!({ "type": "request_sync" });
                        let _ = send_to_extension(&state, &sync_msg);
                    }

                    // Spawn a thread for this connection so the listener
                    // can accept new connections (e.g. after extension reconnect)
                    let app_clone = app.clone();
                    let state_clone = state.clone();
                    std::thread::spawn(move || {
                        let mut reader = BufReader::new(stream);
                        loop {
                            match read_tcp_message(&mut reader) {
                                Ok(msg) => {
                                    handle_extension_message(&app_clone, &state_clone, &msg);
                                }
                                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                                    || e.kind() == std::io::ErrorKind::TimedOut =>
                                {
                                    continue;
                                }
                                Err(e) => {
                                    log::warn!("Native host disconnected: {}", e);
                                    let mut s = state_clone.lock().unwrap();
                                    s.connection.connected = false;
                                    s.tcp_writer = None;
                                    let status = s.connection.clone();
                                    drop(s);
                                    let _ = app_clone.emit("extension-status", &status);
                                    break;
                                }
                            }
                        }
                    });
                }
                Err(e) => {
                    log::error!("TCP accept error: {}", e);
                }
            }
        }
    });
}

// ============================================================================
// Native Host Registration (Windows Registry, macOS plist, Linux config)
// ============================================================================

fn register_native_host(app: &AppHandle) {
    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to get app data dir: {}", e);
            return;
        }
    };

    // Create directory if needed
    let _ = std::fs::create_dir_all(&app_data_dir);

    // Determine the native host binary path
    // Search strategy:
    //   1. Next to the Tauri binary (production — bundled together)
    //   2. In the workspace's native-host build dir (development)
    //   3. In the app data directory (manual install)
    let host_binary_name = if cfg!(windows) {
        "pure-path-host.exe"
    } else {
        "pure-path-host"
    };

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    // Candidate locations to search
    let mut candidates: Vec<std::path::PathBuf> = vec![
        // 1. Production: next to the Tauri exe
        exe_dir.join(host_binary_name),
    ];

    // 2. Development: walk up from the Tauri exe dir to find native-host/target/
    //    Tauri exe is at: desktop-app/src-tauri/target/debug/app.exe
    //    Native host is at: desktop-app/native-host/target/debug/pure-path-host.exe
    {
        let mut dir = exe_dir.clone();
        for _ in 0..5 {
            let dev_debug = dir.join("native-host").join("target").join("debug").join(host_binary_name);
            let dev_release = dir.join("native-host").join("target").join("release").join(host_binary_name);
            candidates.push(dev_debug);
            candidates.push(dev_release);
            if !dir.pop() { break; }
        }
    }

    // 3. App data dir
    candidates.push(app_data_dir.join(host_binary_name));

    let host_binary = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| {
            // Default to the production location even if it doesn't exist yet
            let default = exe_dir.join(host_binary_name);
            log::warn!("Native host binary not found in any search path, defaulting to {:?}", default);
            default
        });

    log::info!("Native host binary resolved to: {:?}", host_binary);

    // Write the native messaging host manifest
    let manifest_path = app_data_dir.join("com.purepath.companion.json");
    let manifest = serde_json::json!({
        "name": "com.purepath.companion",
        "description": "Pure Path Desktop Companion — Native Messaging Host",
        "path": host_binary.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            "chrome-extension://aigfmlblmlgnimgddbphakfdmegnjiim/"
        ]
    });

    match std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap()) {
        Ok(_) => log::info!("Native host manifest written to {:?}", manifest_path),
        Err(e) => {
            log::error!("Failed to write native host manifest: {}", e);
            return;
        }
    }

    // Platform-specific registration
    #[cfg(target_os = "windows")]
    {
        register_windows_registry(&manifest_path);
    }

    #[cfg(target_os = "macos")]
    {
        register_macos(&manifest_path);
    }

    #[cfg(target_os = "linux")]
    {
        register_linux(&manifest_path);
    }
}

#[cfg(target_os = "windows")]
fn register_windows_registry(manifest_path: &std::path::Path) {
    use std::process::Command;

    let manifest_str = manifest_path.to_string_lossy();

    // Write to HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.purepath.companion
    let result = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.purepath.companion",
            "/ve",
            "/t", "REG_SZ",
            "/d", &manifest_str,
            "/f",
        ])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                log::info!("Registered Chrome native messaging host in registry");
            } else {
                log::error!(
                    "Failed to register in Chrome registry: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
        Err(e) => log::error!("Failed to run reg command: {}", e),
    }

    // Also register for Edge (Chromium-based)
    let _ = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\com.purepath.companion",
            "/ve",
            "/t", "REG_SZ",
            "/d", &manifest_str,
            "/f",
        ])
        .output();

    // Also register for Brave
    let _ = Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.purepath.companion",
            "/ve",
            "/t", "REG_SZ",
            "/d", &manifest_str,
            "/f",
        ])
        .output();
}

#[cfg(target_os = "macos")]
fn register_macos(manifest_path: &std::path::Path) {
    // On macOS, the manifest must be at:
    // ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.purepath.companion.json
    // or ~/Library/Application Support/Chromium/NativeMessagingHosts/com.purepath.companion.json
    let home = std::env::var("HOME").unwrap_or_default();
    let chrome_dir = format!(
        "{}/Library/Application Support/Google/Chrome/NativeMessagingHosts",
        home
    );
    let _ = std::fs::create_dir_all(&chrome_dir);
    let target = format!("{}/com.purepath.companion.json", chrome_dir);
    match std::fs::copy(manifest_path, &target) {
        Ok(_) => log::info!("Registered Chrome native messaging host on macOS at {}", target),
        Err(e) => log::error!("Failed to copy manifest on macOS: {}", e),
    }

    // Also for Edge
    let edge_dir = format!(
        "{}/Library/Application Support/Microsoft Edge/NativeMessagingHosts",
        home
    );
    let _ = std::fs::create_dir_all(&edge_dir);
    let _ = std::fs::copy(manifest_path, format!("{}/com.purepath.companion.json", edge_dir));

    // Also for Brave
    let brave_dir = format!(
        "{}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        home
    );
    let _ = std::fs::create_dir_all(&brave_dir);
    let _ = std::fs::copy(manifest_path, format!("{}/com.purepath.companion.json", brave_dir));
}

#[cfg(target_os = "linux")]
fn register_linux(manifest_path: &std::path::Path) {
    // On Linux, the manifest goes to:
    // ~/.config/google-chrome/NativeMessagingHosts/com.purepath.companion.json
    // or ~/.config/chromium/NativeMessagingHosts/com.purepath.companion.json
    let home = std::env::var("HOME").unwrap_or_default();
    let chrome_dir = format!("{}/.config/google-chrome/NativeMessagingHosts", home);
    let _ = std::fs::create_dir_all(&chrome_dir);
    let target = format!("{}/com.purepath.companion.json", chrome_dir);
    match std::fs::copy(manifest_path, &target) {
        Ok(_) => log::info!("Registered Chrome native messaging host on Linux at {}", target),
        Err(e) => log::error!("Failed to copy manifest on Linux: {}", e),
    }

    // Also for Chromium
    let chromium_dir = format!("{}/.config/chromium/NativeMessagingHosts", home);
    let _ = std::fs::create_dir_all(&chromium_dir);
    let _ = std::fs::copy(manifest_path, format!("{}/com.purepath.companion.json", chromium_dir));

    // Also for Brave
    let brave_dir = format!("{}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts", home);
    let _ = std::fs::create_dir_all(&brave_dir);
    let _ = std::fs::copy(manifest_path, format!("{}/com.purepath.companion.json", brave_dir));

    // Also for Edge
    let edge_dir = format!("{}/.config/microsoft-edge/NativeMessagingHosts", home);
    let _ = std::fs::create_dir_all(&edge_dir);
    let _ = std::fs::copy(manifest_path, format!("{}/com.purepath.companion.json", edge_dir));
}

// ============================================================================
// Tauri Commands — called from the frontend JS
// ============================================================================

#[tauri::command]
fn get_extension_stats(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> ExtensionStats {
    state.lock().unwrap().stats.clone()
}

#[tauri::command]
fn get_extension_blocklists(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> ExtensionBlocklists {
    state.lock().unwrap().blocklists.clone()
}

#[tauri::command]
fn get_extension_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> ConnectionStatus {
    state.lock().unwrap().connection.clone()
}

#[tauri::command]
fn request_sync(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "request_sync"
    });
    send_to_extension(&state, &msg)
}

#[tauri::command]
fn update_blocklist_domains(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    domains: Vec<String>,
) -> Result<(), String> {
    // Update local state
    {
        let mut s = state.lock().unwrap();
        s.blocklists.domains = domains.clone();
        s.blocklists.domain_count = domains.len();
    }

    // Push to extension via native host
    let msg = serde_json::json!({
        "type": "update_blocklist",
        "listType": "domains",
        "data": domains
    });
    send_to_extension(&state, &msg)
}

#[tauri::command]
fn update_blocklist_keywords(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    keywords: Vec<String>,
) -> Result<(), String> {
    // Update local state
    {
        let mut s = state.lock().unwrap();
        s.blocklists.keywords = keywords.clone();
        s.blocklists.keyword_count = keywords.len();
    }

    // Push to extension via native host
    let msg = serde_json::json!({
        "type": "update_blocklist",
        "listType": "keywords",
        "data": keywords
    });
    send_to_extension(&state, &msg)
}

// ============================================================================
// Tauri App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(Mutex::new(AppState::default()));

    tauri::Builder::default()
        .manage(shared_state.clone())
        .invoke_handler(tauri::generate_handler![
            get_extension_stats,
            get_extension_blocklists,
            get_extension_status,
            request_sync,
            update_blocklist_domains,
            update_blocklist_keywords,
        ])
        .setup(move |app| {
            // Setup logging in debug mode
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Register the native messaging host on every startup (idempotent)
            register_native_host(app.handle());

            // Start the TCP server to listen for native host connections
            let app_handle = app.handle().clone();
            let state_clone = shared_state.clone();
            start_tcp_server(app_handle, state_clone);

            log::info!("Pure Path desktop app initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
