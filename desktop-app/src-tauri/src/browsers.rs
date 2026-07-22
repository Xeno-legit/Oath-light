//! Oath Light — Browser registry, detection, native-host registration & policy enforcement.
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

/// Chromium extension ID for the **unpacked / dev / self-hosted-CRX** build.
/// Derived deterministically from the public `key` pinned in
/// `extension/manifest.json`, so it is identical in an unpacked dev load and in
/// a packed CRX signed with that key. If you change that key, recompute this
/// (sha256 of the SPKI DER, first 16 bytes, each nibble mapped 0->a..f->p).
///
/// This is NOT the ID real users run as. The Chrome Web Store ignores the
/// manifest `key` on upload and assigns its own item ID (`STORE_EXTENSION_ID`
/// below) — so a store install runs under that, while developers loading the
/// unpacked folder run under this one. Detection paths (native-host
/// `allowed_origins`, profile-install lookup, forcelist matching) must accept
/// BOTH ids; the force-install we *write* targets the store id.
pub const EXTENSION_ID: &str = "lknpaoecooklfjgenmjpkdkahgoofank";

/// Chromium extension ID assigned by the **Chrome Web Store** on publication —
/// the value in the store URL (`chromewebstore.google.com/detail/<id>`), and the
/// `chrome-extension://<id>/` origin every store-installed copy actually runs
/// under. CWS derives this from its own re-signing key, overriding the manifest
/// `key`, so it differs from `EXTENSION_ID`. This is what force-install targets
/// and what the bridge must trust for the published product.
pub const STORE_EXTENSION_ID: &str = "oigdpcdgmldgjalfnlgekcbkmniplnad";

/// Firefox (Gecko) extension ID — from `browser_specific_settings.gecko.id`.
/// Author-defined and honored by AMO, so it is the same in dev and published
/// (no dev/store split like Chromium has).
pub const GECKO_EXTENSION_ID: &str = "oathlight@xeno-legit.github.io";

/// Native messaging host name (must match `connectNative()` in background.js).
pub const HOST_NAME: &str = "com.oathlight.companion";

/// Update URL used by the Chromium force-install policy. Now that the extension
/// is published, this is the **Chrome Web Store** update endpoint: a Web-Store-
/// hosted force-install (`STORE_EXTENSION_ID;<this url>`) is served by Google and
/// — unlike a self-hosted update URL — is honored on ordinary *unmanaged*
/// consumer machines, which is exactly what publishing unlocked (see the
/// enforcement flow in lib.rs). Non-empty, so Chromium enforcement is LIVE.
/// (Firefox/Gecko is intentionally still dormant — `FIREFOX_XPI_URL` below is
/// empty while that browser's force-install format is still on hold.)
pub const CHROMIUM_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

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

// ============================================================================
// Evasion-browser detection (plan item 1.3)
// ============================================================================

/// Lowercase image names of browsers whose whole point on this machine would
/// be *escaping* the extension: no enterprise-policy hive to force-install
/// into (or the browser deliberately ignores one), not in the Web/AMO store
/// pipeline we can force-install from, or — for Tor Browser specifically —
/// built to route around network-level controls entirely.
///
/// This list is deliberately conservative and MUST stay that way: a false
/// positive here doesn't just log a warning, it can outright kill (see
/// `enforce_processes` in lib.rs, gated behind `block_unknown_browsers`)
/// someone's real, legitimately-installed browser — a much worse failure
/// mode than under-detecting one genuine evasion attempt. When in doubt,
/// leave a browser off this list; `is_standard_install_path` below still
/// catches a portable copy of anything we DO recognize.
///
/// Deliberately NOT included: Zen, Arc, and other Chromium/Firefox forks that
/// can run our extension and talk to the native host like any supported
/// browser — those aren't evasion, they're just browsers we haven't added a
/// full `BrowserDef` for yet.
pub const EVASION_BROWSERS: &[&str] = &[
    "tor.exe",
    "librewolf.exe",
    "waterfox.exe",
    "palemoon.exe",
    "basilisk.exe",
    "mullvadbrowser.exe",
    "mullvad-browser.exe",
    "floorp.exe",
    "thorium.exe",
];

/// True when a (lowercased) exe path looks like a normal install location
/// rather than a portable copy run from somewhere like Downloads or a USB
/// drive. Used to flag a portable copy of a browser we otherwise recognize
/// (see `EVASION_BROWSERS`'s doc comment on why that's still worth a
/// conservative heads-up, even for a known browser).
pub fn is_standard_install_path(path_lower: &str) -> bool {
    path_lower.contains(r"\program files")
        || path_lower.contains(r"\appdata\local")
        || path_lower.contains(r"\appdata\roaming")
        || path_lower.contains(r"\windowsapps")
}

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
///
/// Called every monitor tick (every 3s, for the app's whole lifetime), so this
/// uses `refresh_processes_specifics(ProcessRefreshKind::new())` instead of
/// `refresh_processes()`: the latter also collects CPU usage, memory, disk
/// I/O counters, and the exe path for every process on the system, none of
/// which we read here — only the image name (always populated when
/// enumerating processes). That's a lot of wasted per-tick work for a
/// steady-state background poll.
pub fn running_process_names() -> Vec<String> {
    use sysinfo::{ProcessRefreshKind, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new());
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
    // The `App Paths\<exe>` key must not merely EXIST — uninstalling a browser
    // can leave the key behind empty (observed: Opera leaves an empty HKCU
    // `App Paths\opera.exe` after removal). The old "key exists → installed"
    // check then reported a ghost browser and wrote a force-install policy for
    // one that's gone. Require the key to hold a REG_SZ that actually points at
    // an executable still present on disk.
    for root in ["HKLM", "HKCU"] {
        let key = format!(
            r"{}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}",
            root, def.app_path_exe
        );
        for (_, data) in read_reg_sz_values(&key) {
            let p = data.trim().trim_matches('"');
            if !p.is_empty() && Path::new(p).exists() {
                return true;
            }
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

/// The `chrome-extension://<id>/` origins the native host accepts. Must list
/// **both** Chromium ids: the store build (what real users run) and the
/// unpacked/dev build (what developers and any self-hosted CRX run) — otherwise
/// `connectNative()` from the other one is rejected and every desktop-integrated
/// feature goes dark for that install. Store id first (the common case).
fn chromium_allowed_origins() -> Vec<String> {
    [STORE_EXTENSION_ID, EXTENSION_ID]
        .iter()
        .map(|id| format!("chrome-extension://{}/", id))
        .collect()
}

/// Write the two host manifests (Chromium `allowed_origins` and Gecko
/// `allowed_extensions`) into `dir`, pointing at `host_binary`.
/// Returns (chromium_manifest_path, gecko_manifest_path).
pub fn write_manifests(dir: &Path, host_binary: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    std::fs::create_dir_all(dir)?;

    let chromium_path = dir.join("com.oathlight.companion.json");
    let chromium = serde_json::json!({
        "name": HOST_NAME,
        "description": "Oath Light Desktop Companion — Native Messaging Host",
        "path": host_binary.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": chromium_allowed_origins()
    });
    std::fs::write(&chromium_path, serde_json::to_string_pretty(&chromium).unwrap())?;

    let gecko_path = dir.join("com.oathlight.companion.firefox.json");
    let gecko = serde_json::json!({
        "name": HOST_NAME,
        "description": "Oath Light Desktop Companion — Native Messaging Host",
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

/// Remove every native-messaging host registration we may have written, so an
/// uninstall leaves no dangling pointer to a deleted host binary. Best-effort —
/// mirrors `register_all_hosts` and includes the Chrome fallback key.
#[cfg(target_os = "windows")]
pub fn unregister_all_hosts() {
    let delete_value = |subkey: &str| {
        let full = format!(r"HKCU\{}\{}", subkey, HOST_NAME);
        let _ = reg().args(["delete", &full, "/f"]).output();
    };
    for def in BROWSERS {
        delete_value(def.nm_registry_subkey);
    }
    delete_value(r"SOFTWARE\Google\Chrome\NativeMessagingHosts");
}

#[cfg(not(target_os = "windows"))]
pub fn unregister_all_hosts() {
    let home = std::env::var("HOME").unwrap_or_default();
    for def in BROWSERS {
        let target = format!("{}/{}/{}.json", home, def.nm_unix_dir, HOST_NAME);
        let _ = std::fs::remove_file(&target);
    }
}

// ============================================================================
// Force-install enforcement (gated — dormant until update URLs are set)
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum EnforceOutcome {
    /// No update URL configured yet — nothing written. (Firefox while on hold.)
    Dormant,
    /// Policy written to `HKLM` — a machine-wide hard lock the blocked user
    /// cannot remove without elevation. Only reachable when the app itself runs
    /// elevated (Stage 2). This is the strong outcome.
    EnforcedMachine,
    /// Policy written to `HKCU` because `HKLM` was refused (no elevation — the
    /// Stage 1 default today). Real and effective — the browser greys out the
    /// Remove button and reinstalls on removal — but the policy value lives in
    /// the user's own hive, so a determined user with a shell can delete it
    /// without a prompt. Surfaced honestly in the UI as "user-level".
    EnforcedUser,
    /// Attempted but neither hive accepted the write.
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

// NOTE (removed with publication): an earlier `offstore_forceinstall_supported()`
// gated enforcement on the machine being enterprise-managed, because Chrome/Edge
// silently ignore a *self-hosted* `ExtensionInstallForcelist` on unmanaged
// consumer machines. Now that force-install targets the Chrome **Web Store**
// (`STORE_EXTENSION_ID` via `CHROMIUM_UPDATE_URL`), which IS honored unmanaged,
// that precondition no longer exists and the gate — and this helper — are gone.

/// Read the `REG_SZ` values of a registry key as `(value_name, data)` pairs via
/// `reg query`. Empty vec if the key is absent or unreadable (reading `HKLM`
/// policy keys is permitted for standard users even though *writing* is not, so
/// this works to pick a non-colliding ordinal before an elevated write).
#[cfg(target_os = "windows")]
fn read_reg_sz_values(full_key: &str) -> Vec<(String, String)> {
    let stdout = match reg().args(["query", full_key]).output() {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&stdout);
    let mut vals = Vec::new();
    for line in text.lines() {
        // Value rows are indented ("    <name>    REG_SZ    <data>"); the key
        // path header and any subkey paths sit at column 0 — skip those.
        if line.is_empty() || !line.starts_with(char::is_whitespace) {
            continue;
        }
        let trimmed = line.trim_start();
        if let Some(pos) = trimmed.find("REG_SZ") {
            let name = trimmed[..pos].trim().to_string();
            let data = trimmed[pos + "REG_SZ".len()..].trim().to_string();
            if !name.is_empty() {
                vals.push((name, data));
            }
        }
    }
    vals
}

/// True when `data` is a forcelist entry for *our* extension (its `id;url` form
/// leads with one of our ids). Matches EITHER the store id (what we now write)
/// or the legacy unpacked/dev id (what an older build may have written), so
/// detection and cleanup stay correct across the switch to the Web-Store target.
#[cfg(target_os = "windows")]
fn is_our_forcelist_entry(data: &str) -> bool {
    matches!(data.split(';').next(), Some(id) if id == STORE_EXTENSION_ID || id == EXTENSION_ID)
}

/// Choose the `ExtensionInstallForcelist` value name to write under: reuse the
/// one already holding our ID if present, otherwise the lowest positive ordinal
/// not already taken. This avoids clobbering another managed extension's entry —
/// the previous code hard-wrote value "1", which on a real enterprise machine
/// could belong to someone else's mandatory extension.
#[cfg(target_os = "windows")]
fn pick_forcelist_value(full_key: &str) -> String {
    let entries = read_reg_sz_values(full_key);
    if let Some((name, _)) = entries.iter().find(|(_, data)| is_our_forcelist_entry(data)) {
        return name.clone();
    }
    let used: std::collections::HashSet<u32> =
        entries.iter().filter_map(|(n, _)| n.parse::<u32>().ok()).collect();
    let mut n = 1u32;
    while used.contains(&n) {
        n += 1;
    }
    n.to_string()
}

/// If our force-install policy is **already** present, report which scope it's
/// in (HKLM checked first, then HKCU) without writing anything. This lets the
/// app correctly report a policy written by the elevated installer — or by a
/// previous elevated run — instead of trying (and failing, unelevated) to
/// re-write it and showing "failed".
#[cfg(target_os = "windows")]
pub fn policy_present(def: &BrowserDef) -> Option<EnforceOutcome> {
    if def.engine != Engine::Chromium {
        return None; // Gecko is on hold; nothing to detect.
    }
    for (root, strong) in [("HKLM", true), ("HKCU", false)] {
        let key = format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
        if read_reg_sz_values(&key).iter().any(|(_, d)| is_our_forcelist_entry(d)) {
            return Some(if strong {
                EnforceOutcome::EnforcedMachine
            } else {
                EnforceOutcome::EnforcedUser
            });
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn policy_present(_def: &BrowserDef) -> Option<EnforceOutcome> {
    None
}

/// Write the force-install policy for `def` so a removed/disabled extension is
/// reinstalled on the browser's next launch / policy refresh.
///
/// **Requires elevation.** The `Software\Policies` registry subtree is
/// ACL-protected against standard users in **both** `HKLM` *and* `HKCU` — a
/// non-elevated process cannot write there, so this returns `Failed` unless the
/// app is running elevated. (An earlier design assumed an unelevated HKCU write
/// would work; it does not. Getting the policy written therefore needs either an
/// elevated install-time write or the SYSTEM service — see the plan.) When the
/// policy already exists this returns early via `policy_present` and writes
/// nothing.
#[cfg(target_os = "windows")]
pub fn enforce_policy(def: &BrowserDef) -> EnforceOutcome {
    if !enforcement_configured(def.engine) {
        return EnforceOutcome::Dormant;
    }
    // Already set (e.g. by the elevated installer)? Report it, don't re-write.
    if let Some(existing) = policy_present(def) {
        return existing;
    }

    // (hive prefix, is this the strong machine-wide scope?)
    const HIVES: [(&str, bool); 2] = [("HKLM", true), ("HKCU", false)];

    match def.engine {
        Engine::Chromium => {
            let entry = format!("{};{}", STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL);
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
                let value = pick_forcelist_value(&key);
                let ok = reg()
                    .args(["add", &key, "/v", &value, "/t", "REG_SZ", "/d", &entry, "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if ok {
                    return if strong {
                        EnforceOutcome::EnforcedMachine
                    } else {
                        EnforceOutcome::EnforcedUser
                    };
                }
            }
            EnforceOutcome::Failed
        }
        Engine::Gecko => {
            // KNOWN DEFECT (Firefox on hold — see Extension_Force_Install_Plan.md
            // §7): Mozilla's `ExtensionSettings` Windows format is believed to be
            // a single REG_SZ holding the whole JSON object, not the nested
            // subkeys written here. Unreachable today (FIREFOX_XPI_URL is empty),
            // so it never runs — fix this before taking Firefox off hold.
            let base = format!(r"{}\ExtensionSettings\{}", def.policy_subkey, GECKO_EXTENSION_ID);
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}", root, base);
                let a = reg()
                    .args(["add", &key, "/v", "installation_mode", "/t", "REG_SZ", "/d", "force_installed", "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                let b = reg()
                    .args(["add", &key, "/v", "install_url", "/t", "REG_SZ", "/d", FIREFOX_XPI_URL, "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if a && b {
                    return if strong {
                        EnforceOutcome::EnforcedMachine
                    } else {
                        EnforceOutcome::EnforcedUser
                    };
                }
            }
            EnforceOutcome::Failed
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

/// Remove any force-install policy we may have written for `def`. Used when the
/// user completes an uninstall so the extension is no longer pinned and can
/// actually be removed. Best-effort and idempotent.
///
/// For Chromium it deletes **only** the forcelist value(s) whose data is our own
/// entry — never a fixed ordinal — so a co-existing managed extension on the
/// same machine is left untouched (mirrors the collision-safe write above).
#[cfg(target_os = "windows")]
pub fn remove_policy(def: &BrowserDef) {
    match def.engine {
        Engine::Chromium => {
            for root in ["HKLM", "HKCU"] {
                let key = format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
                for (name, data) in read_reg_sz_values(&key) {
                    if is_our_forcelist_entry(&data) {
                        let _ = reg().args(["delete", &key, "/v", &name, "/f"]).output();
                    }
                }
            }
        }
        Engine::Gecko => {
            for root in ["HKLM", "HKCU"] {
                let key = format!(
                    r"{}\{}\ExtensionSettings\{}",
                    root, def.policy_subkey, GECKO_EXTENSION_ID
                );
                let _ = reg().args(["delete", &key, "/f"]).output();
            }
        }
    }
    // Also drop the DoH policy (1.2), so a completed uninstall leaves no
    // "managed by your organization" DNS setting behind.
    remove_dns_policy(def);
}

#[cfg(not(target_os = "windows"))]
pub fn remove_policy(_def: &BrowserDef) {}

// ============================================================================
// DoH / DNS-over-HTTPS policy (plan item 1.2 layer 1)
// ============================================================================
//
// Disabling browser DoH is what makes the system DNS filter (1.1) actually
// contain a browser: a browser resolving names over its own DoH endpoint
// never sends a plain UDP/TCP query to 127.0.0.1:53, so the resolver never
// sees it. Turning DoH off forces the browser back onto the OS resolver —
// which we've taken over. Unlike `enforce_policy`, this is deliberately NOT
// gated on `CHROMIUM_UPDATE_URL`: it works today, pre-publication, because it
// writes an ordinary policy value rather than force-installing an extension.

/// Write the "disable DoH" policy for `def` — applied for every known browser
/// while the DNS filter is on. Chromium hives get `DnsOverHttpsMode = "off"`
/// (REG_SZ) directly under the existing `policy_subkey` (Chrome/Edge/Brave/
/// Vivaldi/Opera all read it); Firefox gets a `DNSOverHTTPS` subkey with
/// `Enabled = 0` (DWORD). Same `reg()` helper and same HKLM-then-HKCU
/// fallback as `enforce_policy`, and the same "needs admin for HKLM, HKCU as
/// a weaker fallback" reality — reported via the same `EnforceOutcome`.
#[cfg(target_os = "windows")]
pub fn enforce_dns_policy(def: &BrowserDef) -> EnforceOutcome {
    const HIVES: [(&str, bool); 2] = [("HKLM", true), ("HKCU", false)];
    match def.engine {
        Engine::Chromium => {
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}", root, def.policy_subkey);
                let ok = reg()
                    .args(["add", &key, "/v", "DnsOverHttpsMode", "/t", "REG_SZ", "/d", "off", "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if ok {
                    return if strong { EnforceOutcome::EnforcedMachine } else { EnforceOutcome::EnforcedUser };
                }
            }
            EnforceOutcome::Failed
        }
        Engine::Gecko => {
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}\DNSOverHTTPS", root, def.policy_subkey);
                let ok = reg()
                    .args(["add", &key, "/v", "Enabled", "/t", "REG_DWORD", "/d", "0", "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if ok {
                    return if strong { EnforceOutcome::EnforcedMachine } else { EnforceOutcome::EnforcedUser };
                }
            }
            EnforceOutcome::Failed
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn enforce_dns_policy(_def: &BrowserDef) -> EnforceOutcome {
    EnforceOutcome::Unsupported
}

/// Remove the "disable DoH" policy for `def`. Called when the DNS filter is
/// turned off (the `dns.disable` weakening applies) and as part of
/// `remove_policy` on sanctioned uninstall. Best-effort and idempotent.
#[cfg(target_os = "windows")]
pub fn remove_dns_policy(def: &BrowserDef) {
    match def.engine {
        Engine::Chromium => {
            for root in ["HKLM", "HKCU"] {
                let key = format!(r"{}\{}", root, def.policy_subkey);
                let _ = reg().args(["delete", &key, "/v", "DnsOverHttpsMode", "/f"]).output();
            }
        }
        Engine::Gecko => {
            for root in ["HKLM", "HKCU"] {
                let key = format!(r"{}\{}\DNSOverHTTPS", root, def.policy_subkey);
                let _ = reg().args(["delete", &key, "/v", "Enabled", "/f"]).output();
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn remove_dns_policy(_def: &BrowserDef) {}

// ============================================================================
// Tests — extension identity & force-install target
// ============================================================================
//
// These pin the exact bug that publishing exposed: the store ID (`oigdpcd…`)
// and the unpacked/dev ID (`lknpaoec…`) are different, and every detection path
// must accept both while the force-install we write must target the store ID.

#[cfg(test)]
mod tests {
    use super::*;

    /// A Chromium extension ID is 32 chars from the `a..p` alphabet.
    fn is_chromium_id(id: &str) -> bool {
        id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
    }

    #[test]
    fn store_and_dev_ids_are_valid_and_distinct() {
        assert!(is_chromium_id(EXTENSION_ID), "dev id shape");
        assert!(is_chromium_id(STORE_EXTENSION_ID), "store id shape");
        assert_ne!(
            EXTENSION_ID, STORE_EXTENSION_ID,
            "store id must differ from the dev id — the whole reason for this fix"
        );
    }

    #[test]
    fn allowed_origins_cover_store_and_dev() {
        let origins = chromium_allowed_origins();
        assert!(
            origins.contains(&format!("chrome-extension://{}/", STORE_EXTENSION_ID)),
            "published store extension must be able to reach the native host"
        );
        assert!(
            origins.contains(&format!("chrome-extension://{}/", EXTENSION_ID)),
            "unpacked/dev build must still be able to reach the native host"
        );
    }

    #[test]
    fn force_install_entry_targets_the_store_via_web_store_url() {
        // The value the Chromium force-install policy writes.
        let entry = format!("{};{}", STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL);
        let (id, url) = entry.split_once(';').unwrap();
        assert_eq!(id, STORE_EXTENSION_ID, "must force-install the store build");
        assert!(
            url.starts_with("https://clients2.google.com/"),
            "must pull from the Web Store (honored on unmanaged machines), not a self-hosted URL"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn forcelist_entry_matches_either_id_but_not_strangers() {
        let store = format!("{};{}", STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL);
        let legacy = format!("{};{}", EXTENSION_ID, "http://127.0.0.1:17244/update_manifest.xml");
        assert!(is_our_forcelist_entry(&store), "recognizes what we write now");
        assert!(is_our_forcelist_entry(&legacy), "still cleans up a legacy dev-id entry");
        assert!(
            !is_our_forcelist_entry("someotherextensionidaaaaaaaaaaaa;https://x/"),
            "must not claim another managed extension's forcelist entry"
        );
    }
}
