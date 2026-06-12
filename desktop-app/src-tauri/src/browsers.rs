//! Pure Path — Browser registry, detection, native-host registration & policy enforcement.
//!
//! This module is the single source of truth for everything browser-specific:
//!   * the stable extension IDs,
//!   * the per-browser table (process names, native-messaging-host registry keys,
//!     enterprise-policy keys, native-host config dirs),
//!   * detection of *installed* and *running* browsers,
//!   * writing/registering the native messaging host manifests, and
//!   * the (gated, pre-release-dormant) force-install enforcement.
//!
//! Windows is the primary, fully-implemented platform; macOS/Linux get
//! native-host registration and graceful no-ops for the Windows-only bits.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// `reg` command that never flashes a console window (monitor calls it often).
#[cfg(target_os = "windows")]
fn reg() -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = std::process::Command::new("reg");
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

// ============================================================================
// Central configuration — the one place IDs / update URLs live
// ============================================================================

/// Chromium extension ID. Derived deterministically from the public `key`
/// pinned in `extension/manifest.json`, so it is identical in unpacked dev
/// loads and in a packed/self-hosted build. If you change that key, recompute
/// this (sha256 of the SPKI DER, first 16 bytes, each nibble mapped 0->a..f->p).
pub const EXTENSION_ID: &str = "lknpaoecooklfjgenmjpkdkahgoofank";

/// Firefox (Gecko) extension ID — from `browser_specific_settings.gecko.id`.
pub const GECKO_EXTENSION_ID: &str = "purepath@xeno-legit.github.io";

/// Native messaging host name (must match `connectNative()` in background.js).
pub const HOST_NAME: &str = "com.purepath.companion";

/// Update URL used by the Chromium force-install policy. EMPTY until the
/// extension is published / self-hosted. While empty, enforcement is DORMANT:
/// detection & monitoring run, but no policy is written. Set this to
/// `https://clients2.google.com/service/update2/crx` (Web Store) or a
/// self-hosted update manifest URL at release time.
pub const CHROMIUM_UPDATE_URL: &str = "";

/// Signed-XPI URL for the Firefox force-install policy. EMPTY until published
/// on AMO / self-hosted. Same dormant-until-set behaviour.
pub const FIREFOX_XPI_URL: &str = "";

// ============================================================================
// Browser table
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Engine {
    Chromium,
    Gecko,
}

#[derive(Debug, Clone, Copy)]
pub struct BrowserDef {
    /// Stable key used in the connection map and frontend (e.g. "chrome").
    pub key: &'static str,
    /// Human-friendly name.
    pub name: &'static str,
    pub engine: Engine,
    /// Process image names (lowercase) that identify this browser when running.
    pub process_names: &'static [&'static str],
    /// Windows: registry subkey (under HKCU/HKLM `SOFTWARE`) whose
    /// `NativeMessagingHosts\<HOST_NAME>` default value points at the manifest.
    pub nm_registry_subkey: &'static str,
    /// Windows: enterprise-policy subkey (under `SOFTWARE`) that holds
    /// `ExtensionInstallForcelist` (Chromium) or `ExtensionSettings` (Gecko).
    pub policy_subkey: &'static str,
    /// Windows: `App Paths` exe name used to detect an install when not running.
    pub app_path_exe: &'static str,
    /// Unix: native-messaging-host dir relative to $HOME. (Used on macOS/Linux.)
    #[allow(dead_code)]
    pub nm_unix_dir: &'static str,
}

/// The full supported set. Native-host registration is written for ALL of these
/// (a stray registry value for an absent browser is harmless), while
/// monitoring/enforcement targets the ones actually running.
pub const BROWSERS: &[BrowserDef] = &[
    BrowserDef {
        key: "chrome",
        name: "Google Chrome",
        engine: Engine::Chromium,
        process_names: &["chrome.exe", "chrome", "google chrome"],
        nm_registry_subkey: r"SOFTWARE\Google\Chrome\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Google\Chrome",
        app_path_exe: "chrome.exe",
        nm_unix_dir: ".config/google-chrome/NativeMessagingHosts",
    },
    BrowserDef {
        key: "edge",
        name: "Microsoft Edge",
        engine: Engine::Chromium,
        process_names: &["msedge.exe", "msedge", "microsoft edge"],
        nm_registry_subkey: r"SOFTWARE\Microsoft\Edge\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Microsoft\Edge",
        app_path_exe: "msedge.exe",
        nm_unix_dir: ".config/microsoft-edge/NativeMessagingHosts",
    },
    BrowserDef {
        key: "brave",
        name: "Brave",
        engine: Engine::Chromium,
        process_names: &["brave.exe", "brave"],
        nm_registry_subkey: r"SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\BraveSoftware\Brave",
        app_path_exe: "brave.exe",
        nm_unix_dir: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    },
    BrowserDef {
        key: "opera",
        name: "Opera",
        engine: Engine::Chromium,
        // Opera GX also reports as opera.exe.
        process_names: &["opera.exe", "opera"],
        // Opera reads native-messaging hosts from Chrome's key on Windows; we
        // also write its own below. Policy under Opera Software.
        nm_registry_subkey: r"SOFTWARE\Opera Software\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Opera Software\Opera",
        app_path_exe: "opera.exe",
        nm_unix_dir: ".config/opera/NativeMessagingHosts",
    },
    BrowserDef {
        key: "vivaldi",
        name: "Vivaldi",
        engine: Engine::Chromium,
        process_names: &["vivaldi.exe", "vivaldi"],
        nm_registry_subkey: r"SOFTWARE\Vivaldi\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Vivaldi",
        app_path_exe: "vivaldi.exe",
        nm_unix_dir: ".config/vivaldi/NativeMessagingHosts",
    },
    BrowserDef {
        key: "chromium",
        name: "Chromium",
        engine: Engine::Chromium,
        process_names: &["chromium.exe", "chromium", "chromium-browser"],
        nm_registry_subkey: r"SOFTWARE\Chromium\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Chromium",
        app_path_exe: "chromium.exe",
        nm_unix_dir: ".config/chromium/NativeMessagingHosts",
    },
    BrowserDef {
        key: "firefox",
        name: "Mozilla Firefox",
        engine: Engine::Gecko,
        process_names: &["firefox.exe", "firefox"],
        nm_registry_subkey: r"SOFTWARE\Mozilla\NativeMessagingHosts",
        policy_subkey: r"SOFTWARE\Policies\Mozilla\Firefox",
        app_path_exe: "firefox.exe",
        nm_unix_dir: ".mozilla/native-messaging-hosts",
    },
];

/// Map a (lowercased) process image name to its browser definition.
pub fn match_browser_process(proc_name_lower: &str) -> Option<&'static BrowserDef> {
    BROWSERS.iter().find(|b| {
        b.process_names
            .iter()
            .any(|p| proc_name_lower == *p || proc_name_lower.starts_with(p))
    })
}

pub fn browser_by_key(key: &str) -> Option<&'static BrowserDef> {
    BROWSERS.iter().find(|b| b.key == key)
}

// ============================================================================
// Detection — running & installed
// ============================================================================

/// All running process image names (lowercased), scanned once. Callers reuse
/// this for both known-browser and custom-browser detection.
pub fn running_process_names() -> Vec<String> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes();
    sys.processes()
        .values()
        .map(|p| p.name().to_lowercase())
        .collect()
}

/// Keys of every browser from BROWSERS present in the given process-name set.
pub fn detect_running_from(names: &[String]) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    for name in names {
        if let Some(def) = match_browser_process(name) {
            if !found.contains(&def.key) {
                found.push(def.key);
            }
        }
    }
    found
}


/// Best-effort "is this browser installed" check (Windows `App Paths`).
/// Returns true if running is already known; otherwise probes the registry.
#[cfg(target_os = "windows")]
pub fn is_installed(def: &BrowserDef) -> bool {
    for root in ["HKLM", "HKCU"] {
        let key = format!(
            r"{}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}",
            root, def.app_path_exe
        );
        let ok = reg()
            .args(["query", &key])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_installed(_def: &BrowserDef) -> bool {
    // Non-Windows install detection is left to "running implies installed".
    false
}

// ============================================================================
// Native messaging host manifests
// ============================================================================

/// Write the two host manifests (Chromium `allowed_origins` and Gecko
/// `allowed_extensions`) into `dir`, pointing at `host_binary`.
/// Returns (chromium_manifest_path, gecko_manifest_path).
pub fn write_manifests(dir: &Path, host_binary: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    std::fs::create_dir_all(dir)?;

    let chromium_path = dir.join("com.purepath.companion.json");
    let chromium = serde_json::json!({
        "name": HOST_NAME,
        "description": "Pure Path Desktop Companion — Native Messaging Host",
        "path": host_binary.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [ format!("chrome-extension://{}/", EXTENSION_ID) ]
    });
    std::fs::write(&chromium_path, serde_json::to_string_pretty(&chromium).unwrap())?;

    let gecko_path = dir.join("com.purepath.companion.firefox.json");
    let gecko = serde_json::json!({
        "name": HOST_NAME,
        "description": "Pure Path Desktop Companion — Native Messaging Host",
        "path": host_binary.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [ GECKO_EXTENSION_ID ]
    });
    std::fs::write(&gecko_path, serde_json::to_string_pretty(&gecko).unwrap())?;

    Ok((chromium_path, gecko_path))
}

// ============================================================================
// Registration — point every browser at the right manifest
// ============================================================================

#[cfg(target_os = "windows")]
pub fn register_all_hosts(chromium_manifest: &Path, gecko_manifest: &Path) {
    let write_value = |subkey: &str, manifest: &Path| {
        let full = format!(r"HKCU\{}\{}", subkey, HOST_NAME);
        let _ = reg()
            .args([
                "add",
                &full,
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
                &manifest.to_string_lossy(),
                "/f",
            ])
            .output();
    };

    for def in BROWSERS {
        let manifest = match def.engine {
            Engine::Chromium => chromium_manifest,
            Engine::Gecko => gecko_manifest,
        };
        write_value(def.nm_registry_subkey, manifest);
    }

    // Opera/Vivaldi historically fall back to Chrome's host key — make sure the
    // Chromium manifest is reachable there too.
    write_value(r"SOFTWARE\Google\Chrome\NativeMessagingHosts", chromium_manifest);
}

#[cfg(not(target_os = "windows"))]
pub fn register_all_hosts(chromium_manifest: &Path, gecko_manifest: &Path) {
    let home = std::env::var("HOME").unwrap_or_default();
    for def in BROWSERS {
        let manifest = match def.engine {
            Engine::Chromium => chromium_manifest,
            Engine::Gecko => gecko_manifest,
        };
        let dir = format!("{}/{}", home, def.nm_unix_dir);
        let _ = std::fs::create_dir_all(&dir);
        let target = format!("{}/{}.json", dir, HOST_NAME);
        let _ = std::fs::copy(manifest, &target);
    }
}

// ============================================================================
// Force-install enforcement (gated — dormant until update URLs are set)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum EnforceOutcome {
    /// No update URL configured yet (pre-release) — nothing written.
    Dormant,
    /// Policy successfully written.
    Enforced,
    /// Attempted but failed (e.g. needs elevation).
    Failed,
    /// Platform/engine not supported for enforcement. (macOS/Linux.)
    #[allow(dead_code)]
    Unsupported,
}

/// True once the relevant update URL has been configured for this engine.
pub fn enforcement_configured(engine: Engine) -> bool {
    match engine {
        Engine::Chromium => !CHROMIUM_UPDATE_URL.is_empty(),
        Engine::Gecko => !FIREFOX_XPI_URL.is_empty(),
    }
}

/// Write the force-install policy for `def` so a removed/disabled extension is
/// reinstalled on the browser's next launch / policy refresh. Prefers HKLM
/// (machine-wide, hard lock — the desktop app already runs elevated); falls
/// back to HKCU. Dormant while the update URL is empty.
#[cfg(target_os = "windows")]
pub fn enforce_policy(def: &BrowserDef) -> EnforceOutcome {
    if !enforcement_configured(def.engine) {
        return EnforceOutcome::Dormant;
    }

    match def.engine {
        Engine::Chromium => {
            let entry = format!("{};{}", EXTENSION_ID, CHROMIUM_UPDATE_URL);
            // ExtensionInstallForcelist is a list keyed by ordinal value names.
            let mut ok = false;
            for root in ["HKLM", "HKCU"] {
                let key =
                    format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
                let res = reg()
                    .args([
                        "add", &key, "/v", "1", "/t", "REG_SZ", "/d", &entry, "/f",
                    ])
                    .output();
                if res.map(|o| o.status.success()).unwrap_or(false) {
                    ok = true;
                    break;
                }
            }
            if ok {
                EnforceOutcome::Enforced
            } else {
                EnforceOutcome::Failed
            }
        }
        Engine::Gecko => {
            // Firefox uses ExtensionSettings with installation_mode=force_installed.
            let base = format!(
                r"{}\ExtensionSettings\{}",
                def.policy_subkey, GECKO_EXTENSION_ID
            );
            let mut ok = false;
            for root in ["HKLM", "HKCU"] {
                let key = format!(r"{}\{}", root, base);
                let a = reg()
                    .args([
                        "add",
                        &key,
                        "/v",
                        "installation_mode",
                        "/t",
                        "REG_SZ",
                        "/d",
                        "force_installed",
                        "/f",
                    ])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                let b = reg()
                    .args([
                        "add",
                        &key,
                        "/v",
                        "install_url",
                        "/t",
                        "REG_SZ",
                        "/d",
                        FIREFOX_XPI_URL,
                        "/f",
                    ])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if a && b {
                    ok = true;
                    break;
                }
            }
            if ok {
                EnforceOutcome::Enforced
            } else {
                EnforceOutcome::Failed
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn enforce_policy(def: &BrowserDef) -> EnforceOutcome {
    if !enforcement_configured(def.engine) {
        return EnforceOutcome::Dormant;
    }
    // macOS/Linux managed-policy enforcement is out of scope for this pass.
    EnforceOutcome::Unsupported
}
