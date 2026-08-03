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

/// Chrome Web Store direct extension URL for Oath Light.
pub const CWS_EXTENSION_URL: &str =
    "https://chromewebstore.google.com/detail/oath-light-content-filter/oigdpcdgmldgjalfnlgekcbkmniplnad?hl=en-GB&utm_source=ext_sidebar";


/// Update URL used by the Chromium force-install policy. Now that the extension
/// is published, this is the **Chrome Web Store** update endpoint: a Web-Store-
/// hosted force-install (`STORE_EXTENSION_ID;<this url>`) is served by Google and
/// — unlike a self-hosted update URL — is honored on ordinary *unmanaged*
/// consumer machines, which is exactly what publishing unlocked (see the
/// enforcement flow in lib.rs). Non-empty, so Chromium enforcement is LIVE.
///
/// **This URL works for Chrome/Brave/Vivaldi/Opera/Chromium but NOT for Edge on
/// a consumer machine** — see `EDGE_STORE_EXTENSION_ID` for why, and
/// `forcelist_target` for the per-browser choice that follows from it.
pub const CHROMIUM_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

/// Microsoft Edge Add-ons item ID — **empty until the extension is published
/// there**, which is what currently blocks force-install on Edge entirely.
///
/// Edge is not "just another Chromium" for this one policy. Microsoft's
/// `ExtensionInstallForcelist` documentation states it plainly:
///
/// > For Windows instances not joined to a Microsoft Active Directory domain,
/// > forced installation is limited to apps and extensions listed in the
/// > Microsoft Edge Add-ons website.
///
/// So on an ordinary consumer PC — exactly who this app is for — a forcelist
/// entry pointing at the Chrome Web Store is **silently discarded**: Edge writes
/// no error, logs nothing the user can see, and never even issues an update
/// request for the ID (verified against Edge 150 with `--enable-logging --v=1`:
/// our ID appears nowhere in the log, while other force-installs in the same
/// session fetch normally). It just looks like the extension never installs.
///
/// **The owner's decision (2026-07-31): Oath Light is not being published to
/// Edge Add-ons.** The listing's verification requirements are not worth it for
/// a store that will not meaningfully distribute the extension anyway. So this
/// stays empty, Edge stays `StoreUnavailable`, and the browser lock
/// (`browser_lock.rs`) is not a stopgap for Edge — it is *the* mechanism there,
/// permanently. Read `requires_manual_install` with that in mind: it is not
/// waiting for anything.
///
/// The machinery for the other outcome is left intact and costs nothing — if
/// that decision is ever revisited, putting an item ID here is the only change
/// needed and `forcelist_target` already prefers it, pairs it with
/// `EDGE_UPDATE_URL`, and drops Edge out of the lock automatically.
pub const EDGE_STORE_EXTENSION_ID: &str = "";

/// Update endpoint for the Microsoft Edge Add-ons store — the only source Edge
/// will force-install from on a machine that isn't domain/Entra-joined.
/// Documented value, and Edge's own default when a forcelist entry omits a URL.
pub const EDGE_UPDATE_URL: &str = "https://edge.microsoft.com/extensionwebstorebase/v1/crx";

/// XPI URL used by the Firefox force-install policy (`ExtensionSettings` →
/// `install_url`). Now that the add-on is published on AMO, this is AMO's
/// "latest signed XPI" endpoint for our listing slug — Firefox resolves it to
/// the current signed build for the user's platform. Non-empty, so Gecko
/// enforcement is LIVE. A failed fetch here is non-fatal in Firefox (it just
/// doesn't install), so there is no dead-URL brick to guard against.
///
/// **Never written to the policy bare** — see `gecko_install_url`, which tags it
/// with the expected extension version. That tag is what makes Firefox actually
/// upgrade rather than sit on whatever build it first installed.
pub const FIREFOX_XPI_URL: &str =
    "https://addons.mozilla.org/firefox/downloads/latest/oath-light-content-filter/latest.xpi";

/// The extension version this desktop build ships alongside — i.e. the newest
/// build we know has been published to the stores.
///
/// Two jobs. It is the tag in the Firefox `install_url` (below), and it is what
/// a detected install is compared against to decide whether a browser is
/// carrying a stale copy (`version_is_older`). Kept as a plain literal rather
/// than parsed from the manifest at build time so a missing/relocated extension
/// folder can never fail a release build; `expected_version_matches_manifest`
/// (in the test module) is what keeps it honest.
pub const EXPECTED_EXTENSION_VERSION: &str = "4.3.0";

/// The `install_url` to write into the Firefox force-install policy.
///
/// **This is the fix for "Firefox never updates the add-on".** Firefox's policy
/// engine does not re-install a `force_installed` add-on that is already there:
/// it compares the installed add-on's `sourceURI` against the policy's
/// `install_url` and returns early when they are equal. With a bare
/// `…/latest.xpi` in the policy, that comparison matches on every single
/// startup forever — so the add-on Firefox happened to install on day one is
/// the add-on it keeps, and the only thing that could ever move it is AMO's
/// background update ping (24h timer, silently skippable, and observed in the
/// field to leave an install pinned at 3.5.0 for weeks while AMO was serving
/// 4.2.0).
///
/// Tagging the URL with the version we expect breaks that tie exactly once per
/// release: the tag differs from the installed copy's `sourceURI`, Firefox
/// re-runs the install, AMO's `latest.xpi` redirect serves the current signed
/// build, and the add-on is upgraded (an upgrade, not a reinstall — extension
/// storage survives). After that the new `sourceURI` equals this URL again and
/// the early return resumes, so there is no download-every-launch loop. AMO
/// ignores unknown query parameters on this endpoint, so the tag costs nothing.
///
/// `nonce` is for the user-triggered refresh: passing one makes this URL differ
/// from whatever is installed *even at the same version*, which is what lets
/// "Refresh" mean "fetch it again" rather than "no-op".
pub fn gecko_install_url(nonce: Option<u64>) -> String {
    match nonce {
        Some(n) => format!("{}?v={}&r={}", FIREFOX_XPI_URL, EXPECTED_EXTENSION_VERSION, n),
        None => format!("{}?v={}", FIREFOX_XPI_URL, EXPECTED_EXTENSION_VERSION),
    }
}

/// True when `url` is one of ours AND already tagged with the version this build
/// expects — so re-asserting the policy can leave it alone instead of writing a
/// different URL and triggering a pointless re-download.
///
/// Deliberately tolerant of a trailing `&r=…` refresh nonce: a URL a manual
/// refresh wrote is still current for this version, and rewriting it back to the
/// nonce-free form would make every refresh cost a *second* reinstall on the
/// next monitor tick.
fn gecko_install_url_is_current(url: &str) -> bool {
    let Some(query) = url.strip_prefix(FIREFOX_XPI_URL).and_then(|q| q.strip_prefix('?')) else {
        return false;
    };
    let want = format!("v={}", EXPECTED_EXTENSION_VERSION);
    query.split('&').any(|p| p == want)
}

/// Compare two dotted numeric version strings; true when `installed` is strictly
/// behind `expected`.
///
/// A version string that does not fully parse as dotted numbers — empty, a
/// pre-release suffix, anything unexpected — reads as **not older**. That
/// asymmetry is deliberate: this drives an "older version" note on the status
/// row, and a component we merely failed to read must never be presented to the
/// user as a stale install. Missing trailing components count as zero, so "4.2"
/// and "4.2.0" compare equal.
pub fn version_is_older(installed: &str, expected: &str) -> bool {
    fn parse(s: &str) -> Option<Vec<u64>> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        s.split('.').map(|p| p.trim().parse::<u64>().ok()).collect()
    }
    let (Some(a), Some(b)) = (parse(installed), parse(expected)) else { return false };
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x < y;
        }
    }
    false
}

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
    /// Windows: **external-extensions** subkey (under `SOFTWARE`). A subkey
    /// named after an extension ID here, holding an `update_url`, makes the
    /// browser download and install that extension on its own — Chromium's
    /// `ExternalRegistryLoader`. Unlike the policy path this is not a lock (the
    /// user can turn it off), and unlike the policy path **Edge honours it for
    /// Chrome-Web-Store extensions on an unmanaged machine**, which makes it the
    /// only way to get the extension into Edge today. Empty for Gecko, which has
    /// no equivalent. See `enforce_external_install`.
    pub ext_registry_subkey: &'static str,
    /// The browser's own extensions page. Chromium forks each use their own
    /// scheme, and a user who dismissed the "new extension added" prompt has no
    /// other way to find the toggle. Empty when we have nothing to point at.
    pub extensions_page: &'static str,
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
        ext_registry_subkey: r"SOFTWARE\Google\Chrome\Extensions",
        extensions_page: "chrome://extensions",
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
        ext_registry_subkey: r"SOFTWARE\Microsoft\Edge\Extensions",
        extensions_page: "edge://extensions",
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
        ext_registry_subkey: r"SOFTWARE\BraveSoftware\Brave-Browser\Extensions",
        extensions_page: "brave://extensions",
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
        ext_registry_subkey: r"SOFTWARE\Opera Software\Extensions",
        extensions_page: "opera://extensions",
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
        ext_registry_subkey: r"SOFTWARE\Vivaldi\Extensions",
        extensions_page: "vivaldi://extensions",
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
        ext_registry_subkey: r"SOFTWARE\Chromium\Extensions",
        extensions_page: "chrome://extensions",
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
        ext_registry_subkey: "",
        extensions_page: "about:addons",
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

/// The browser's executable path from `App Paths`, when it points at a file that
/// is really there. Same lookup `is_installed` does, but keeping the path — used
/// to launch the browser straight at its own extensions page (a `chrome://` /
/// `edge://` URL only that browser can open, so the shell can't do it for us).
#[cfg(target_os = "windows")]
pub fn installed_exe_path(def: &BrowserDef) -> Option<PathBuf> {
    for root in ["HKLM", "HKCU"] {
        let key = format!(
            r"{}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}",
            root, def.app_path_exe
        );
        for (_, data) in read_reg_sz_values(&key) {
            let p = data.trim().trim_matches('"');
            if !p.is_empty() && Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn installed_exe_path(_def: &BrowserDef) -> Option<PathBuf> {
    None
}

/// `is_installed` with a 60-second cache, for callers on the 3s monitor tick.
///
/// The uncached probe spawns up to two `reg query` processes per browser; the
/// monitor asks about all seven every tick, which is 14 subprocesses every three
/// seconds for an answer that changes only when someone installs or uninstalls a
/// browser. A minute of staleness costs nothing here — the force-install policy
/// this gates is written once and stays written.
pub fn is_installed_cached(def: &BrowserDef) -> bool {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    const TTL: Duration = Duration::from_secs(60);
    static CACHE: OnceLock<Mutex<HashMap<&'static str, (Instant, bool)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((t, v)) = cache.lock().unwrap().get(def.key) {
        if t.elapsed() < TTL {
            return *v;
        }
    }
    let fresh = is_installed(def);
    cache.lock().unwrap().insert(def.key, (Instant::now(), fresh));
    fresh
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
    /// No store URL configured for this engine — nothing written. (Both Chromium
    /// and Gecko are configured now; kept for any future engine added dormant.)
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
    /// No policy can force-install here, so the extension was registered for
    /// **automatic install** through the external-extensions registry instead
    /// (`enforce_external_install`). The browser downloads and installs it by
    /// itself, then leaves it switched off until the user approves it once —
    /// that approval is a browser security control we do not try to forge. Real
    /// protection once approved, but never a lock: the user can remove it.
    AutoInstallPendingApproval,
    /// There is **no store this browser will force-install us from on this
    /// machine**, and the auto-install fallback could not be registered either.
    /// Today this means exactly one thing: Edge on a machine that isn't
    /// domain/Entra-joined, with no Microsoft Edge Add-ons listing published
    /// (see `EDGE_STORE_EXTENSION_ID`). Distinct from `Failed` (we could not
    /// write) and from `Dormant` (no URL configured for the engine at all),
    /// because the remedy is completely different: publish to Edge Add-ons, or
    /// have the user install it by hand. Elevation does not help.
    StoreUnavailable,
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

/// True when this machine is joined to an Active Directory domain, to Microsoft
/// Entra ID, or registered with an MDM — the condition under which Edge lifts
/// its "Edge Add-ons only" restriction and will force-install from the Chrome
/// Web Store like every other Chromium.
///
/// Read once and cached: this cannot change while the process runs, and the
/// probe spawns a subprocess (the monitor would otherwise run it every tick).
/// `dsregcmd /status` ships with Windows 10+ and reports AD join, Entra join and
/// hybrid/workplace join in one place; `USERDNSDOMAIN` is the fallback for the
/// classic domain-user case if `dsregcmd` is missing or refuses to run.
#[cfg(target_os = "windows")]
fn is_domain_managed() -> bool {
    use std::sync::OnceLock;
    static CACHED: OnceLock<bool> = OnceLock::new();
    *CACHED.get_or_init(|| {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if let Ok(out) = std::process::Command::new("dsregcmd")
            .arg("/status")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for line in text.lines() {
                let l = line.trim();
                // "AzureAdJoined : YES" / "DomainJoined : YES" / …
                let joined_field = l.starts_with("azureadjoined")
                    || l.starts_with("enterprisejoined")
                    || l.starts_with("domainjoined")
                    || l.starts_with("isdevicejoined");
                if joined_field && l.ends_with("yes") {
                    return true;
                }
            }
        }
        std::env::var("USERDNSDOMAIN").map(|v| !v.trim().is_empty()).unwrap_or(false)
    })
}

/// The `(extension_id, update_url)` pair this browser can actually force-install
/// us from **on this machine**, or `None` when no store will serve it.
///
/// Every Chromium except Edge installs from the Chrome Web Store. Edge prefers
/// the Edge Add-ons listing (the only source it accepts unmanaged), falls back
/// to the Web Store when the machine is domain/Entra-joined — where Microsoft's
/// restriction doesn't apply — and otherwise has no usable source at all, which
/// is reported rather than papered over. Gecko has a single source (AMO) and is
/// handled directly in `enforce_policy`.
pub fn forcelist_target(def: &BrowserDef) -> Option<(&'static str, &'static str)> {
    if def.engine != Engine::Chromium {
        return None;
    }
    if def.key != "edge" {
        return Some((STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL));
    }
    if !EDGE_STORE_EXTENSION_ID.is_empty() {
        return Some((EDGE_STORE_EXTENSION_ID, EDGE_UPDATE_URL));
    }
    #[cfg(target_os = "windows")]
    if is_domain_managed() {
        return Some((STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL));
    }
    None
}

/// True when this browser **cannot be force-installed on this machine** and so
/// depends on the user leaving the auto-installed extension switched on — the
/// class `browser_lock` exists for.
///
/// Today this is exactly Edge on a consumer PC, and it is derived rather than
/// hard-coded on purpose: the day an Edge Add-ons id is published,
/// `forcelist_target` starts returning a real pair, this returns false, and Edge
/// stops being kill-on-sight without anyone remembering to go and change it. A
/// browser we can pin has no business being locked out — its policy reinstalls
/// the extension by itself, and killing it would *prevent* the launch during
/// which that happens.
///
/// Gecko is excluded: Firefox force-installs from AMO through `ExtensionSettings`
/// and has no external-registry path, so a `None` from `forcelist_target` means
/// "wrong mechanism", not "no mechanism".
pub fn requires_manual_install(def: &BrowserDef) -> bool {
    def.engine == Engine::Chromium
        && !def.ext_registry_subkey.is_empty()
        && forcelist_target(def).is_none()
}

/// Returns the target URL to open when launching a browser for extension setup or restore.
/// For browsers requiring manual installation (like Edge on consumer Windows), force-install
/// policies from CWS are ignored by the browser, so launching the browser directly at the
/// Chrome Web Store extension listing is required so the user can click 'Add to Edge'.
/// For browsers with working force-install (like Chrome), launching at the browser's internal
/// extensions page is used so the user can approve the pending extension.
pub fn restore_target_url(def: &BrowserDef) -> &'static str {
    if requires_manual_install(def) || def.key == "edge" {
        CWS_EXTENSION_URL
    } else {
        def.extensions_page
    }
}


// REMOVED: `has_alternative_browser`. It existed for one caller — the browser
// lock's "this is the machine's only browser, stand down" exemption — and that
// exemption is gone (see `browser_lock`'s module doc). Keeping the helper would
// have left a ready-made switch for putting the hole back; the lock now has no
// input describing what else is installed, which is the point.

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
/// leads with one of our ids). Matches the Web-Store id (what we write for every
/// Chromium but Edge), the Edge Add-ons id (once published), or the legacy
/// unpacked/dev id an older build may have written — so detection and cleanup
/// stay correct across every id we have ever targeted.
#[cfg(target_os = "windows")]
fn is_our_forcelist_entry(data: &str) -> bool {
    match data.split(';').next() {
        Some(id) => {
            id == STORE_EXTENSION_ID
                || id == EXTENSION_ID
                || (!EDGE_STORE_EXTENSION_ID.is_empty() && id == EDGE_STORE_EXTENSION_ID)
        }
        None => false,
    }
}

/// Chromium list-policies that must accompany the forcelist entry, as
/// `(subkey_under_policy_root, value_data)`, for the store `id` is being
/// installed from.
///
/// `ExtensionInstallSources` permits that store as an install origin and
/// `ExtensionInstallAllowlist` names our ID explicitly, which keeps us
/// installable on a machine carrying a blocklist-everything (`*`) policy. Both
/// are additive allow-rules — they can only ever permit our own extension, never
/// restrict anything else — and both are no-ops on a browser that already trusts
/// the store in question.
///
/// **These do not make Edge accept a Chrome-Web-Store force-install.** An
/// earlier build shipped them believing they did; they don't, and can't. Edge's
/// restriction is on the *store*, not on the install source permission — see
/// `EDGE_STORE_EXTENSION_ID`. They are kept because they are genuinely load-
/// bearing under a restrictive blocklist policy, not as an Edge workaround.
#[cfg(target_os = "windows")]
fn chromium_allow_list_policies(id: &str, update_url: &str) -> [(&'static str, String); 2] {
    // Permit the origin the CRX is actually served from. Edge Add-ons and the
    // Chrome Web Store serve the payload from a different host than the update
    // manifest, so allow the whole scheme+host the update URL names.
    let source = if update_url == EDGE_UPDATE_URL {
        "https://edge.microsoft.com/*".to_string()
    } else {
        "https://clients2.google.com/*".to_string()
    };
    [("ExtensionInstallSources", source), ("ExtensionInstallAllowlist", id.to_string())]
}

/// Write the accompanying allow-policies into `root` (a hive prefix). Each is a
/// numbered-value list key exactly like the forcelist, so the same
/// don't-clobber-someone-else's-entry rule applies. Best-effort: these support
/// the forcelist, and a failure is reported by the forcelist write itself.
#[cfg(target_os = "windows")]
fn write_chromium_allow_lists(root: &str, def: &BrowserDef, id: &str, update_url: &str) {
    for (subkey, data) in chromium_allow_list_policies(id, update_url) {
        let key = format!(r"{}\{}\{}", root, def.policy_subkey, subkey);
        let existing = read_reg_sz_values(&key);
        let value = existing
            .iter()
            .find(|(_, d)| *d == data)
            .map(|(n, _)| n.clone())
            .unwrap_or_else(|| {
                let used: std::collections::HashSet<u32> =
                    existing.iter().filter_map(|(n, _)| n.parse::<u32>().ok()).collect();
                let mut n = 1u32;
                while used.contains(&n) {
                    n += 1;
                }
                n.to_string()
            });
        let _ = reg()
            .args(["add", &key, "/v", &value, "/t", "REG_SZ", "/d", &data, "/f"])
            .output();
    }
}

/// The three Chromium list-policy subkeys we ever write under `policy_subkey`.
#[cfg(target_os = "windows")]
const CHROMIUM_LIST_POLICY_SUBKEYS: [&str; 3] =
    ["ExtensionInstallForcelist", "ExtensionInstallSources", "ExtensionInstallAllowlist"];

/// True when these `reg query` values contain at least one real list entry.
///
/// Chromium encodes a list policy as values named `1`, `2`, … under the policy
/// subkey, and ignores everything else — including the empty `(Default)` REG_SZ
/// that `reg add <key> /f` leaves behind. So the default value must not count as
/// content: treating it as content is what would make an empty, extension-
/// uninstalling forcelist key look occupied and survive pruning.
#[cfg(target_os = "windows")]
fn list_policy_has_entries(values: &[(String, String)]) -> bool {
    values.iter().any(|(name, data)| name.parse::<u32>().is_ok() && !data.is_empty())
}

/// True when a list-policy key holds no list entry at all.
#[cfg(target_os = "windows")]
fn list_policy_key_is_empty(full_key: &str) -> bool {
    !list_policy_has_entries(&read_reg_sz_values(full_key))
}

/// Delete any of our list-policy subkeys that exist but hold no entries.
///
/// **This repairs a policy that actively uninstalls the extension.** A list
/// policy in Chromium is encoded as a subkey whose values are named `1`, `2`, …
/// — so a subkey that exists with *no* numbered values is not "no policy", it is
/// **the policy set to an empty list**. Machine scope (`HKLM`) outranks user
/// scope (`HKCU`) in Chromium's policy merge, and Chrome's own documentation
/// says that removing an extension from `ExtensionInstallForcelist` uninstalls
/// it. So an empty `HKLM` forcelist key silently overrides a perfectly good
/// `HKCU` entry with "force-install nothing" **and tears the extension back out
/// of every profile**.
///
/// The previous `ensure_policy_key` created exactly those keys, in both hives,
/// for all seven browsers, on every startup — so any machine where this app ever
/// ran elevated (the `OathLightElevated` logon task runs it with `/RL HIGHEST`)
/// got empty machine-scope keys, and its Chrome quietly stopped keeping the
/// extension. Pruning is therefore not tidy-up; it is the fix, and it has to run
/// on machines already in that state, not just prevent new ones.
///
/// Only ever removes a key we would have created and that carries nothing: a
/// real managed forcelist with another extension in it has numbered values and
/// is left strictly alone.
#[cfg(target_os = "windows")]
fn prune_empty_list_policy_keys(def: &BrowserDef) {
    if def.engine != Engine::Chromium {
        return;
    }
    for root in ["HKLM", "HKCU"] {
        prune_empty_list_policy_keys_under(root, def.policy_subkey);
    }
}

/// The hive-and-subkey half of `prune_empty_list_policy_keys`, split out so the
/// repair can be exercised against a real (scratch) registry key in a test —
/// this deletes policy keys, so "it compiles" is not enough assurance.
#[cfg(target_os = "windows")]
fn prune_empty_list_policy_keys_under(root: &str, policy_subkey: &str) {
    for sub in CHROMIUM_LIST_POLICY_SUBKEYS {
        let key = format!(r"{}\{}\{}", root, policy_subkey, sub);
        // `reg query` failing means the key isn't there — nothing to prune.
        if reg().args(["query", &key]).output().map(|o| o.status.success()).unwrap_or(false)
            && list_policy_key_is_empty(&key)
        {
            let _ = reg().args(["delete", &key, "/f"]).output();
        }
    }
}

/// Register the extension for **automatic install** through Chromium's
/// external-extensions registry, and report whether the registration is there.
///
/// This is the Edge answer, and it is not a policy. A subkey named after the
/// extension ID under `Software\<vendor>\<product>\Extensions`, holding an
/// `update_url`, makes the browser fetch and install that extension by itself on
/// its next launch. **Edge honours this for Chrome-Web-Store extensions on an
/// ordinary unmanaged machine** — verified end to end against Edge 150: it
/// queries CWS with `installedby=external`, downloads
/// `OIGDPCDGMLDGJALFNLGEKCBKMNIPLNAD_3_5_0_0.crx`, unpacks it and registers it
/// at the right version. That is the same store the *policy* path is refused
/// from, so the restriction really is on forced installation alone.
///
/// **It is auto-install, not a lock, and it stops one step short of running.**
/// Chromium disables an externally-registered extension until the user
/// acknowledges the "new extension added" prompt once — measured as
/// `disable_reasons: 8192, location: 6`, identical for an unrelated control
/// extension with no policy of ours anywhere near it, so it is the generic
/// sideload protection and nothing to do with our configuration. That
/// acknowledgement lives in HMAC-signed Secure Preferences and is deliberately
/// not writable from outside the browser; it is the protection working, and the
/// UI asks the user for the click rather than pretending it isn't needed. The
/// user can also remove the extension afterwards, and Chromium remembers that
/// in `external_uninstalls` — so this genuinely cannot be a lock. Publishing to
/// Edge Add-ons is still the only way to *force* it.
///
/// HKCU only: it needs no elevation, applies to the user we are protecting, and
/// the HKLM twin buys nothing (same prompt, same removability).
#[cfg(target_os = "windows")]
fn enforce_external_install(def: &BrowserDef, id: &str, update_url: &str) -> bool {
    if def.ext_registry_subkey.is_empty() || id.is_empty() {
        return false;
    }
    let key = format!(r"HKCU\{}\{}", def.ext_registry_subkey, id);
    reg()
        .args(["add", &key, "/v", "update_url", "/t", "REG_SZ", "/d", update_url, "/f"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True when the external-install registration `enforce_external_install` writes
/// is still in the registry — the `AutoInstallPendingApproval` counterpart to
/// `policy_present`.
///
/// Needed because that path is the *only* thing standing behind Edge today, and
/// it lives in an ordinary HKCU key with no ACL protecting it: deleting it is a
/// right-click away, and unlike a forcelist entry there is no second hive to
/// fall back on. Without a way to notice it is gone, "we registered it once" and
/// "it is registered" are indistinguishable for the rest of the session.
#[cfg(target_os = "windows")]
fn external_install_present(def: &BrowserDef) -> bool {
    if def.ext_registry_subkey.is_empty() {
        return false;
    }
    [STORE_EXTENSION_ID, EXTENSION_ID, EDGE_STORE_EXTENSION_ID].iter().any(|id| {
        !id.is_empty()
            && read_reg_sz_values(&format!(r"HKCU\{}\{}", def.ext_registry_subkey, id))
                .iter()
                .any(|(name, data)| name == "update_url" && !data.is_empty())
    })
}

/// Drop the external-install registration (sanctioned uninstall only), so the
/// browser stops re-adding the extension after the user removes it.
#[cfg(target_os = "windows")]
fn remove_external_install(def: &BrowserDef) {
    if def.ext_registry_subkey.is_empty() {
        return;
    }
    for id in [STORE_EXTENSION_ID, EXTENSION_ID, EDGE_STORE_EXTENSION_ID] {
        if id.is_empty() {
            continue;
        }
        let _ = reg()
            .args(["delete", &format!(r"HKCU\{}\{}", def.ext_registry_subkey, id), "/f"])
            .output();
    }
}

/// Create the vendor policy key for `def` without writing any value into it, and
/// prune any empty list-policy subkey left by an older build.
///
/// Why the vendor key exists — the "needs a restart" bug: Chromium watches its
/// policy key for changes and reloads policy live, so a forcelist written while
/// the browser is running should take effect within seconds. That only holds if
/// the key **already existed** when the browser started. On a machine that has
/// never had a managed browser, `Software\Policies\<vendor>` does not exist at
/// all, so there is nothing for the browser to watch and the first value we
/// write goes unnoticed until the next launch — precisely the "installed
/// properly only after I restarted the browser" behaviour.
///
/// Creating the empty *vendor* key fixes that and is genuinely inert: it holds
/// no policy value, and Chromium's watch is registered with `bWatchSubtree`, so
/// watching the vendor key already covers every subkey created under it later.
///
/// What it must **not** do is pre-create the list-policy subkeys — see
/// `prune_empty_list_policy_keys` for why that was destructive rather than
/// merely untidy. Called on startup for every known browser, installed or not.
#[cfg(target_os = "windows")]
pub fn ensure_policy_key(def: &BrowserDef) {
    for root in ["HKLM", "HKCU"] {
        let base = format!(r"{}\{}", root, def.policy_subkey);
        let _ = reg().args(["add", &base, "/f"]).output();
    }
    prune_empty_list_policy_keys(def);
}

#[cfg(not(target_os = "windows"))]
pub fn ensure_policy_key(_def: &BrowserDef) {}

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

/// Build the Firefox `ExtensionSettings` policy JSON with our force-install
/// entry merged into any pre-existing object (`existing` = the current value's
/// JSON, if one is already set). Merging rather than overwriting means we never
/// clobber another managed extension's settings — the same collision safety the
/// Chromium forcelist writer has. Returns a compact one-line object suitable for
/// a single `REG_MULTI_SZ` value.
#[cfg(target_os = "windows")]
fn extension_settings_json(existing: Option<&str>, install_url: &str) -> String {
    let mut obj: serde_json::Map<String, serde_json::Value> = existing
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    obj.insert(
        GECKO_EXTENSION_ID.to_string(),
        serde_json::json!({
            "installation_mode": "force_installed",
            "install_url": install_url,
        }),
    );
    serde_json::Value::Object(obj).to_string()
}

/// Our entry's `install_url` inside an `ExtensionSettings` JSON string, if it
/// has one. Used to decide whether an already-written policy is current.
#[cfg(target_os = "windows")]
fn gecko_installed_url(settings_json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(settings_json)
        .ok()?
        .get(GECKO_EXTENSION_ID)?
        .get("install_url")?
        .as_str()
        .map(|s| s.to_string())
}

/// The `install_url` this write should put in the Gecko policy.
///
/// `Assert` keeps a URL that is already tagged for the expected version — the
/// steady state, and the thing that stops the monitor re-triggering a download
/// every time it re-asserts. Anything else (a bare legacy URL, a URL tagged for
/// an older version, no policy at all) gets a freshly tagged one, which is what
/// makes the *next* Firefox start pull the current build from AMO.
///
/// `Refresh` always writes a nonce, so "fetch it again" works even when the
/// installed copy is already at the expected version.
#[cfg(target_os = "windows")]
fn gecko_url_for_write(def: &BrowserDef, mode: WriteMode) -> String {
    if mode == WriteMode::Refresh {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return gecko_install_url(Some(nonce));
    }
    for root in ["HKLM", "HKCU"] {
        let key = format!(r"{}\{}", root, def.policy_subkey);
        if let Some(url) = read_extension_settings(&key).as_deref().and_then(gecko_installed_url) {
            if gecko_install_url_is_current(&url) {
                return url;
            }
        }
    }
    gecko_install_url(None)
}

/// Read the Firefox `ExtensionSettings` policy value (the whole JSON string) at
/// `full_key`. Firefox stores it as one `REG_MULTI_SZ` (older setups: `REG_SZ`)
/// holding the entire object; a single JSON object is one string element, so
/// there is no `\0` list to split. `None` if absent/unreadable.
#[cfg(target_os = "windows")]
fn read_extension_settings(full_key: &str) -> Option<String> {
    let out = reg().args(["query", full_key, "/v", "ExtensionSettings"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let t = line.trim_start();
        for ty in ["REG_MULTI_SZ", "REG_SZ"] {
            if let Some(pos) = t.find(ty) {
                let data = t[pos + ty.len()..].trim();
                if !data.is_empty() {
                    return Some(data.to_string());
                }
            }
        }
    }
    None
}

/// True when a Firefox `ExtensionSettings` JSON string force-installs *our*
/// add-on (its id maps to `installation_mode: force_installed`).
#[cfg(target_os = "windows")]
fn gecko_force_installs_us(settings_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(settings_json)
        .ok()
        .and_then(|v| {
            v.get(GECKO_EXTENSION_ID)?
                .get("installation_mode")?
                .as_str()
                .map(|m| m == "force_installed")
        })
        .unwrap_or(false)
}

/// If our force-install policy is **already** present, report which scope it's
/// in (HKLM checked first, then HKCU) without writing anything. This lets the
/// app correctly report a policy written by the elevated installer — or by a
/// previous elevated run — instead of trying (and failing, unelevated) to
/// re-write it and showing "failed".
#[cfg(target_os = "windows")]
pub fn policy_present(def: &BrowserDef) -> Option<EnforceOutcome> {
    for (root, strong) in [("HKLM", true), ("HKCU", false)] {
        let present = match def.engine {
            Engine::Chromium => {
                let key = format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
                read_reg_sz_values(&key).iter().any(|(_, d)| is_our_forcelist_entry(d))
            }
            Engine::Gecko => {
                let key = format!(r"{}\{}", root, def.policy_subkey);
                read_extension_settings(&key)
                    .map(|s| gecko_force_installs_us(&s))
                    .unwrap_or(false)
            }
        };
        if present {
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

/// True when what `enforce_policy` last achieved for `def` is **still true right
/// now** — i.e. the caller's memo of that outcome can be trusted for another
/// round instead of re-running the write.
///
/// The monitor remembers each browser's outcome so a healthy machine doesn't
/// spawn `reg` every 3s. That memo was write-once, which quietly turned "we
/// wrote the policy" into "the policy is there" for the rest of the session —
/// and those come apart the moment someone deletes the value. The HKCU fallback
/// is the common case on an unelevated install and sits in the user's own hive,
/// where removing it needs no prompt at all. Nothing else would ever notice:
/// the browsers' own self-heal reinstalls an extension removed *while the policy
/// stands*, and cannot do anything about the policy itself being removed. So the
/// row went on reporting a lock that no longer existed, and never re-asserted
/// it. Re-reading is what makes the memo an optimisation again rather than an
/// assumption.
///
/// Scope-exact on purpose: an `EnforcedMachine` memo that now only finds `HKCU`
/// (an elevated write that was later stripped from `HKLM`) is *not* still true,
/// and re-running the write is how it gets either restored or honestly
/// downgraded to `enforced_user` in the UI.
///
/// Outcomes that wrote nothing — `Failed`, `StoreUnavailable`, `Dormant`,
/// `Unsupported` — have nothing that could have been deleted, so they report
/// true and cost no registry reads. Re-trying those is the elevation path's job
/// (`RE_ENFORCE_REQUESTED` clears the whole memo), not this poll's.
#[cfg(target_os = "windows")]
pub fn enforcement_still_present(def: &BrowserDef, last: EnforceOutcome) -> bool {
    match last {
        EnforceOutcome::EnforcedMachine | EnforceOutcome::EnforcedUser => {
            policy_present(def) == Some(last)
        }
        EnforceOutcome::AutoInstallPendingApproval => external_install_present(def),
        _ => true,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn enforcement_still_present(_def: &BrowserDef, _last: EnforceOutcome) -> bool {
    true
}

/// Write the force-install policy for `def` so a removed/disabled extension is
/// reinstalled on the browser's next launch / policy refresh.
///
/// Tries `HKLM` (machine-wide, needs elevation) and falls back to `HKCU`. Both
/// hives live under `Software\Policies`, whose ACL denies standard users on many
/// machines but not all — so the HKCU fallback is a real outcome on some
/// installs and `Failed` on others, and the caller must handle either.
///
/// **This always writes; it never short-circuits on an existing policy.** The
/// old early return is what made the UI's re-apply button inert: once any policy
/// existed the function did nothing, so "Restore" could not restore, and a
/// profile that had taken the HKCU fallback could never be upgraded to the
/// machine-wide lock however many times admin was granted. Re-writing the same
/// value is also the *mechanism* by which restore works — the write bumps the
/// key's last-write time, which fires the registry change notification Chromium
/// and Firefox watch, which reloads policy and reinstalls a missing extension
/// without needing a browser restart.
///
/// The reported outcome is the strongest scope that is true afterwards, not
/// merely the one this call wrote: an unelevated re-apply on a machine that
/// already has the HKLM lock still reports `EnforcedMachine`.
#[cfg(target_os = "windows")]
pub fn enforce_policy(def: &BrowserDef) -> EnforceOutcome {
    enforce_policy_mode(def, WriteMode::Assert)
}

/// How hard a policy write should push the browser to fetch the extension again.
///
/// The distinction only bites on Firefox, where the policy carries the URL the
/// add-on is installed from and Firefox skips the install when that URL matches
/// what it already has (see `gecko_install_url`). Everywhere else both modes
/// write the same thing — a Chromium forcelist entry names a store item, and the
/// browser's own updater decides which build that resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Steady state (the monitor): assert the policy without disturbing an
    /// install that is already current.
    Assert,
    /// The user pressed Refresh: make the browser go and fetch the extension
    /// again, even if it believes it already has it.
    Refresh,
}

/// `enforce_policy`, but re-fetching rather than merely asserting — the write
/// behind the Refresh button. Also clears anything the browser is holding that
/// would make it *refuse* to install (Chromium's external-uninstall record); see
/// `clear_refusals`.
#[cfg(target_os = "windows")]
pub fn refresh_policy(def: &BrowserDef) -> EnforceOutcome {
    clear_refusals(def);
    enforce_policy_mode(def, WriteMode::Refresh)
}

#[cfg(not(target_os = "windows"))]
pub fn refresh_policy(def: &BrowserDef) -> EnforceOutcome {
    enforce_policy(def)
}

/// Drop every record the browser keeps that would make it decline to install the
/// extension on its own.
///
/// Today that is exactly one thing, and it is the reason Edge stopped showing
/// the "a third party wants to add this extension" prompt: when a user removes
/// an externally-registered extension, Chromium writes its id into
/// `extensions.external_uninstalls` in the profile's `Preferences`, and from
/// then on the external-registry provider **skips that id entirely**. No
/// download, no install, no prompt — permanently, and with the registry entry
/// still sitting there looking perfectly healthy. No amount of extra time in a
/// restore window can help, because the browser never starts the work.
///
/// Returns the number of profiles whose record was cleared. Safe to call for any
/// browser; a no-op unless something was actually blocking us.
#[cfg(target_os = "windows")]
pub fn clear_refusals(def: &BrowserDef) -> usize {
    crate::profiles::clear_external_uninstall_record(def)
}

#[cfg(target_os = "windows")]
fn enforce_policy_mode(def: &BrowserDef, mode: WriteMode) -> EnforceOutcome {
    if !enforcement_configured(def.engine) {
        return EnforceOutcome::Dormant;
    }

    // (hive prefix, is this the strong machine-wide scope?)
    const HIVES: [(&str, bool); 2] = [("HKLM", true), ("HKCU", false)];
    let mut wrote_machine = false;
    let mut wrote_user = false;

    match def.engine {
        Engine::Chromium => {
            // No store will *force*-install here, so a forcelist entry would be
            // a policy the browser discards in silence. Fall back to the
            // external-extensions registry, which Edge does honour for the Web
            // Store: the extension installs on its own and then waits for the
            // user to approve it once. Weaker than a lock, and reported as such,
            // but it is the difference between Edge being protected and Edge
            // being untouched.
            let Some((id, update_url)) = forcelist_target(def) else {
                return if enforce_external_install(def, STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL) {
                    EnforceOutcome::AutoInstallPendingApproval
                } else {
                    EnforceOutcome::StoreUnavailable
                };
            };
            let entry = format!("{};{}", id, update_url);
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}\ExtensionInstallForcelist", root, def.policy_subkey);
                let value = pick_forcelist_value(&key);
                let ok = reg()
                    .args(["add", &key, "/v", &value, "/t", "REG_SZ", "/d", &entry, "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if ok {
                    // Keep us installable under a blocklist-everything policy, in
                    // the SAME hive the forcelist landed in.
                    write_chromium_allow_lists(root, def, id, update_url);
                    if strong {
                        wrote_machine = true;
                        break; // machine-wide is the strongest lock — done
                    }
                    wrote_user = true;
                }
            }
        }
        Engine::Gecko => {
            // Firefox's `ExtensionSettings` policy is ONE value holding the whole
            // JSON object (REG_MULTI_SZ), not per-key subkeys. Merge our
            // force-install entry into whatever object is already there so we
            // don't clobber another managed extension, and write it back.
            //
            // The URL is decided once, before the hive loop, so both hives agree
            // — a nonce that differed between HKLM and HKCU would be two
            // competing "reinstall now" instructions depending on which hive
            // Firefox read last.
            let install_url = gecko_url_for_write(def, mode);
            for (root, strong) in HIVES {
                let key = format!(r"{}\{}", root, def.policy_subkey);
                let json =
                    extension_settings_json(read_extension_settings(&key).as_deref(), &install_url);
                let ok = reg()
                    .args(["add", &key, "/v", "ExtensionSettings", "/t", "REG_MULTI_SZ", "/d", &json, "/f"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if ok {
                    if strong {
                        wrote_machine = true;
                        break;
                    }
                    wrote_user = true;
                }
            }
        }
    }

    // Report the strongest scope that is actually in force now — including one
    // an earlier elevated run left behind that this unelevated call couldn't
    // touch.
    if wrote_machine {
        return EnforceOutcome::EnforcedMachine;
    }
    match policy_present(def) {
        Some(EnforceOutcome::EnforcedMachine) => EnforceOutcome::EnforcedMachine,
        Some(other) => other,
        None if wrote_user => EnforceOutcome::EnforcedUser,
        None => EnforceOutcome::Failed,
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

#[cfg(not(target_os = "windows"))]
pub fn clear_refusals(_def: &BrowserDef) -> usize {
    0
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
            // Remove only OUR key from the single `ExtensionSettings` object,
            // leaving any other managed extension's entry intact; delete the
            // whole value only when nothing else remains.
            for root in ["HKLM", "HKCU"] {
                let key = format!(r"{}\{}", root, def.policy_subkey);
                let Some(existing) = read_extension_settings(&key) else { continue };
                let Ok(mut obj) =
                    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&existing)
                else {
                    continue;
                };
                if obj.remove(GECKO_EXTENSION_ID).is_none() {
                    continue; // not ours — leave it alone
                }
                if obj.is_empty() {
                    let _ = reg().args(["delete", &key, "/v", "ExtensionSettings", "/f"]).output();
                } else {
                    let json = serde_json::Value::Object(obj).to_string();
                    let _ = reg()
                        .args(["add", &key, "/v", "ExtensionSettings", "/t", "REG_MULTI_SZ", "/d", &json, "/f"])
                        .output();
                }
            }
        }
    }
    // Never leave a list-policy key behind with our entry gone but the key still
    // there: an empty key is "the policy set to an empty list", not "no policy",
    // and at machine scope it outranks anything the user's own hive says. See
    // `prune_empty_list_policy_keys`.
    prune_empty_list_policy_keys(def);
    // …and drop the auto-install registration, or the browser puts the extension
    // straight back after a sanctioned uninstall.
    remove_external_install(def);
    // Take our prefs backups with us — a completed removal is supposed to leave
    // nothing of ours behind, and that includes the safety copies the
    // external-uninstall repair writes into each browser profile.
    crate::profiles::remove_backup_files(def);
    // Also drop the DoH policy (1.2) and the incognito/guest/private lockdown
    // (1.5), so a completed uninstall leaves no "managed by your organization"
    // settings behind and restores those browser modes.
    remove_dns_policy(def);
    remove_incognito_guest_policy(def);
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
// Browser lockdown policy (plan item 1.5) — close what force-install can't cover
// ============================================================================
//
// A force-installed extension still does NOT run in Incognito/Private windows,
// and a Guest profile has no extensions at all — both are wide-open bypass
// surfaces on an otherwise-locked browser. While the guard is on we shut them:
// block Incognito + Guest (Chromium) / Private Browsing (Firefox). These are
// ordinary restriction policies — they only ever DISABLE a mode — so, unlike
// force-install, there is nothing here that could brick a browser.

/// The `(value_name, dword)` restriction policies for `engine`, written directly
/// under `policy_subkey`. Chromium: disable Incognito (`IncognitoModeAvailability
/// = 1`) and Guest mode (`BrowserGuestModeEnabled = 0`). Firefox: disable Private
/// Browsing (`DisablePrivateBrowsing = 1`). One list so enforce/remove stay in
/// lock-step.
#[cfg(target_os = "windows")]
fn lockdown_policy_values(engine: Engine) -> &'static [(&'static str, &'static str)] {
    match engine {
        Engine::Chromium => {
            &[("IncognitoModeAvailability", "1"), ("BrowserGuestModeEnabled", "0")]
        }
        Engine::Gecko => &[("DisablePrivateBrowsing", "1")],
    }
}

/// Write the incognito/guest/private lockdown policy for `def` — applied for
/// every browser while the guard is on, alongside force-install. Same
/// HKLM-then-HKCU fallback and `EnforceOutcome` reporting as the other policy
/// writers; every value is a DWORD.
#[cfg(target_os = "windows")]
pub fn enforce_incognito_guest_policy(def: &BrowserDef) -> EnforceOutcome {
    const HIVES: [(&str, bool); 2] = [("HKLM", true), ("HKCU", false)];
    for (root, strong) in HIVES {
        let key = format!(r"{}\{}", root, def.policy_subkey);
        let all_ok = lockdown_policy_values(def.engine).iter().all(|(name, val)| {
            reg()
                .args(["add", &key, "/v", name, "/t", "REG_DWORD", "/d", val, "/f"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        });
        if all_ok {
            return if strong { EnforceOutcome::EnforcedMachine } else { EnforceOutcome::EnforcedUser };
        }
    }
    EnforceOutcome::Failed
}

#[cfg(not(target_os = "windows"))]
pub fn enforce_incognito_guest_policy(_def: &BrowserDef) -> EnforceOutcome {
    EnforceOutcome::Unsupported
}

/// Remove the incognito/guest/private lockdown policy for `def`. Called as part
/// of `remove_policy` on sanctioned uninstall (so a completed uninstall restores
/// Incognito/Guest/Private). Best-effort and idempotent.
#[cfg(target_os = "windows")]
pub fn remove_incognito_guest_policy(def: &BrowserDef) {
    for root in ["HKLM", "HKCU"] {
        let key = format!(r"{}\{}", root, def.policy_subkey);
        for (name, _) in lockdown_policy_values(def.engine) {
            let _ = reg().args(["delete", &key, "/v", name, "/f"]).output();
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn remove_incognito_guest_policy(_def: &BrowserDef) {}

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

    #[test]
    fn firefox_xpi_url_is_a_live_amo_endpoint() {
        assert!(!FIREFOX_XPI_URL.is_empty(), "empty would keep Gecko dormant");
        assert!(
            FIREFOX_XPI_URL.starts_with("https://addons.mozilla.org/")
                && FIREFOX_XPI_URL.ends_with(".xpi"),
            "must be AMO's signed-XPI endpoint"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn firefox_extension_settings_force_installs_us_from_amo() {
        let json = extension_settings_json(None, &gecko_install_url(None));
        // The exact object Firefox reads from the ExtensionSettings policy value.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let entry = v.get(GECKO_EXTENSION_ID).expect("our add-on id must be a key");
        assert_eq!(entry["installation_mode"], "force_installed");
        assert_eq!(entry["install_url"], gecko_install_url(None));
        assert!(gecko_force_installs_us(&json), "detector must recognize our own write");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn firefox_settings_merge_preserves_other_extensions() {
        // A pre-existing policy from some other manager must survive our write.
        let existing = r#"{"other@example.com":{"installation_mode":"blocked"}}"#;
        let merged = extension_settings_json(Some(existing), &gecko_install_url(None));
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(
            v["other@example.com"]["installation_mode"], "blocked",
            "must not clobber another managed extension"
        );
        assert!(gecko_force_installs_us(&merged), "and must still add ours");
    }

    /// `EXPECTED_EXTENSION_VERSION` is what the Firefox policy URL is tagged
    /// with and what a stale install is measured against, so it drifting behind
    /// the extension we actually ship would silently switch Gecko auto-update
    /// off. The manifest is the source of truth; this is the tripwire.
    #[test]
    fn expected_version_matches_manifest() {
        let manifest = include_str!("../../../extension/manifest.json");
        let v: serde_json::Value = serde_json::from_str(manifest).expect("manifest must parse");
        assert_eq!(
            v["version"].as_str(),
            Some(EXPECTED_EXTENSION_VERSION),
            "bump EXPECTED_EXTENSION_VERSION in lock-step with extension/manifest.json"
        );
    }

    /// The Firefox auto-update mechanism, pinned end to end: the URL we write
    /// carries the expected version, a bare/legacy/older-tagged URL is NOT
    /// current (so it gets rewritten and Firefox upgrades), and the URL we just
    /// wrote IS current (so the monitor doesn't re-trigger a download forever).
    #[test]
    fn gecko_install_url_tagging_drives_exactly_one_upgrade() {
        let tagged = gecko_install_url(None);
        assert!(tagged.starts_with(FIREFOX_XPI_URL), "must stay AMO's latest-XPI endpoint");
        assert!(tagged.contains(EXPECTED_EXTENSION_VERSION), "must carry the version tag");

        // What is on a machine today, and what an older build wrote.
        assert!(!gecko_install_url_is_current(FIREFOX_XPI_URL), "bare URL must be refreshed");
        assert!(
            !gecko_install_url_is_current(&format!("{}?v=0.0.1", FIREFOX_XPI_URL)),
            "a URL tagged for an older extension must be refreshed"
        );
        // …and what we write, which must then be left alone.
        assert!(gecko_install_url_is_current(&tagged), "our own write must read as current");
        assert!(
            gecko_install_url_is_current(&gecko_install_url(Some(1234))),
            "a refresh nonce must not make the URL look stale on the next tick"
        );
        assert!(
            !gecko_install_url_is_current("https://evil.example/latest.xpi?v=4.2.0"),
            "a foreign host must never read as our current URL"
        );
    }

    #[test]
    fn version_comparison_only_flags_genuinely_older_builds() {
        assert!(version_is_older("3.5.0", "4.2.0"));
        assert!(version_is_older("4.1.9", "4.2.0"));
        assert!(version_is_older("4.2", "4.2.1"));
        assert!(!version_is_older("4.2.0", "4.2.0"));
        assert!(!version_is_older("4.3.0", "4.2.0"), "ahead is not behind");
        assert!(!version_is_older("4.2.0.1", "4.2.0"), "a fourth component is still ahead");
        // Anything we cannot fully read must fail towards "not stale" — this
        // note goes in front of the user, and a parse we got wrong must not.
        assert!(!version_is_older("", "4.2.0"), "unknown version must never read as stale");
        assert!(!version_is_older("nonsense", "4.2.0"), "unparseable must never read as stale");
        assert!(!version_is_older("4.2.0b1", "4.2.0"), "a pre-release suffix is not a number");
        assert!(!version_is_older("3.5.x", "4.2.0"), "one bad component poisons the whole read");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn gecko_detector_ignores_foreign_or_unforced_entries() {
        assert!(
            !gecko_force_installs_us(r#"{"other@example.com":{"installation_mode":"force_installed"}}"#),
            "another add-on being force-installed is not us"
        );
        assert!(
            !gecko_force_installs_us(
                &format!(r#"{{"{}":{{"installation_mode":"allowed"}}}}"#, GECKO_EXTENSION_ID)
            ),
            "our id present but not force_installed is not an active lock"
        );
        assert!(!gecko_force_installs_us("not json"), "garbage is not a lock");
    }

    #[test]
    fn every_chromium_but_edge_force_installs_from_the_web_store() {
        for def in BROWSERS.iter().filter(|d| d.engine == Engine::Chromium && d.key != "edge") {
            assert_eq!(
                forcelist_target(def),
                Some((STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL)),
                "{} should force-install from the Chrome Web Store",
                def.key
            );
        }
        assert_eq!(
            forcelist_target(browser_by_key("firefox").unwrap()),
            None,
            "Gecko has no Chromium forcelist target — it goes through ExtensionSettings"
        );
    }

    /// The Edge bug, pinned. Microsoft only force-installs from the Edge Add-ons
    /// store on a machine that isn't domain/Entra-joined, so pointing Edge at the
    /// Chrome Web Store there produces a policy Edge silently discards. Whatever
    /// this machine's join state, the one thing that must never happen is Edge
    /// being handed the Web-Store pair while unmanaged and unpublished.
    #[test]
    fn edge_never_targets_the_web_store_unless_that_can_actually_work() {
        let edge = browser_by_key("edge").unwrap();
        let target = forcelist_target(edge);
        match target {
            None => {
                assert!(
                    EDGE_STORE_EXTENSION_ID.is_empty(),
                    "with an Edge Add-ons id published there is always a usable target"
                );
            }
            Some((id, url)) if url == CHROMIUM_UPDATE_URL => {
                #[cfg(target_os = "windows")]
                assert!(
                    is_domain_managed(),
                    "the Web Store is only a legal Edge force-install source on a managed machine"
                );
                assert_eq!(id, STORE_EXTENSION_ID);
            }
            Some((id, url)) => {
                assert_eq!(url, EDGE_UPDATE_URL, "the only other legal source is Edge Add-ons");
                assert_eq!(id, EDGE_STORE_EXTENSION_ID);
                assert!(!id.is_empty());
            }
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn allow_lists_permit_the_store_the_extension_is_actually_served_from() {
        let cws = chromium_allow_list_policies(STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL);
        assert_eq!(cws[0].1, "https://clients2.google.com/*");
        assert_eq!(cws[1].1, STORE_EXTENSION_ID);

        let edge = chromium_allow_list_policies("someedgeidaaaaaaaaaaaaaaaaaaaaaa", EDGE_UPDATE_URL);
        assert_eq!(
            edge[0].1, "https://edge.microsoft.com/*",
            "allow-listing Google's host does nothing for an Edge-Add-ons install"
        );
        assert_eq!(edge[1].1, "someedgeidaaaaaaaaaaaaaaaaaaaaaa");
    }

    /// The regression that made Chrome *lose* the extension. A list-policy subkey
    /// that exists with no numbered values is not "no policy" — it is the policy
    /// set to an empty list, and at machine scope that overrides the user hive and
    /// uninstalls a force-installed extension. `reg add <key> /f` leaves an empty
    /// `(Default)` behind, so that must not be mistaken for content.
    #[cfg(target_os = "windows")]
    #[test]
    fn an_empty_default_value_does_not_make_a_list_policy_key_occupied() {
        let bare_created_key = vec![("(Default)".to_string(), String::new())];
        assert!(
            !list_policy_has_entries(&bare_created_key),
            "a key holding only the empty default is an EMPTY forcelist and must be pruned"
        );
        assert!(!list_policy_has_entries(&[]), "no values at all is empty");

        let real = vec![
            ("(Default)".to_string(), String::new()),
            ("1".to_string(), format!("{};{}", STORE_EXTENSION_ID, CHROMIUM_UPDATE_URL)),
        ];
        assert!(list_policy_has_entries(&real), "a real entry must survive pruning");

        let someone_elses = vec![("1".to_string(), "otherextensionidaaaaaaaaaaaaaaaa;https://x/".to_string())];
        assert!(
            list_policy_has_entries(&someone_elses),
            "another manager's forcelist must never be deleted as 'empty'"
        );

        // A numbered value with no data is a malformed leftover, not an entry.
        assert!(!list_policy_has_entries(&[("1".to_string(), String::new())]));
    }

    /// Every Chromium browser must have somewhere to fall back to when no store
    /// will force-install it, and somewhere to send the user for the approval
    /// click. A browser missing either is one that silently degrades to nothing.
    #[test]
    fn every_chromium_has_an_auto_install_path_and_an_extensions_page() {
        for def in BROWSERS.iter().filter(|d| d.engine == Engine::Chromium) {
            assert!(
                !def.ext_registry_subkey.is_empty(),
                "{} has no external-extensions key — auto-install can't be offered",
                def.key
            );
            assert!(
                def.ext_registry_subkey.ends_with(r"\Extensions"),
                "{}: Chromium reads external installs from <product>\\Extensions",
                def.key
            );
            assert!(!def.extensions_page.is_empty(), "{} has nowhere to send the user", def.key);
            assert!(
                def.extensions_page.ends_with("://extensions"),
                "{}: expected the browser's own extensions page",
                def.key
            );
        }
        // Edge is the browser this whole fallback exists for.
        let edge = browser_by_key("edge").unwrap();
        assert_eq!(edge.ext_registry_subkey, r"SOFTWARE\Microsoft\Edge\Extensions");
        assert_eq!(edge.extensions_page, "edge://extensions");
    }

    #[test]
    fn edge_restore_target_url_points_to_chrome_web_store() {
        let edge = browser_by_key("edge").unwrap();
        assert_eq!(restore_target_url(edge), CWS_EXTENSION_URL);

        let chrome = browser_by_key("chrome").unwrap();
        assert_eq!(restore_target_url(chrome), "chrome://extensions");
    }

    /// The repair itself, against the real registry — because this code *deletes
    /// policy keys*, and the thing that must never happen is it eating an entry
    /// that belongs to somebody else's managed extension.
    ///
    /// Uses a scratch subkey under `HKCU\SOFTWARE` (never a real vendor policy
    /// path) and cleans up after itself.
    #[cfg(target_os = "windows")]
    #[test]
    fn pruning_removes_only_the_empty_list_keys() {
        const SCRATCH: &str = r"SOFTWARE\OathLightPruneTest";
        let full = |sub: &str| format!(r"HKCU\{}\{}", SCRATCH, sub);
        let exists = |sub: &str| {
            reg().args(["query", &full(sub)]).output().map(|o| o.status.success()).unwrap_or(false)
        };
        // Start clean in case an earlier run died mid-test.
        let _ = reg().args(["delete", &format!(r"HKCU\{}", SCRATCH), "/f"]).output();

        // Exactly the state the old ensure_policy_key left behind: the key
        // created, holding nothing but the empty (Default) reg add writes.
        for sub in CHROMIUM_LIST_POLICY_SUBKEYS {
            assert!(reg()
                .args(["add", &full(sub), "/f"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false));
        }
        // …and one key that genuinely belongs to another managed extension.
        let _ = reg()
            .args([
                "add",
                &full("ExtensionInstallAllowlist"),
                "/v",
                "1",
                "/t",
                "REG_SZ",
                "/d",
                "otherextensionidaaaaaaaaaaaaaaaa",
                "/f",
            ])
            .output();

        prune_empty_list_policy_keys_under("HKCU", SCRATCH);

        assert!(
            !exists("ExtensionInstallForcelist"),
            "an empty forcelist key is the policy 'force-install nothing' and must be removed — \
             leaving it at machine scope uninstalls the extension"
        );
        assert!(!exists("ExtensionInstallSources"), "an empty sources key is equally inert-looking");
        assert!(
            exists("ExtensionInstallAllowlist"),
            "a key with a real entry must survive — pruning must never eat another manager's policy"
        );

        let _ = reg().args(["delete", &format!(r"HKCU\{}", SCRATCH), "/f"]).output();
    }

    /// The re-verification poll must cost nothing for outcomes that never wrote
    /// anything. If `Failed` or `StoreUnavailable` were re-read from the registry
    /// every 30s, a machine where enforcement genuinely cannot work — the exact
    /// machine least able to spare it — would pay `reg` spawns forever to keep
    /// learning the same answer. Retrying those is the elevation path's job.
    #[cfg(target_os = "windows")]
    #[test]
    fn re_verification_short_circuits_for_outcomes_that_wrote_nothing() {
        let chrome = browser_by_key("chrome").unwrap();
        for outcome in [
            EnforceOutcome::Failed,
            EnforceOutcome::StoreUnavailable,
            EnforceOutcome::Dormant,
            EnforceOutcome::Unsupported,
        ] {
            assert!(
                enforcement_still_present(chrome, outcome),
                "{outcome:?} wrote nothing, so nothing can have been deleted — it must not \
                 trigger a re-write or a registry read"
            );
        }
    }

    /// Gecko has no external-extensions registry, so the auto-install path can
    /// never be "present" for Firefox. Without the empty-subkey guard this would
    /// build the nonsense key `HKCU\\<id>` and read whatever happens to be there.
    #[cfg(target_os = "windows")]
    #[test]
    fn the_auto_install_check_is_chromium_only() {
        let firefox = browser_by_key("firefox").unwrap();
        assert!(firefox.ext_registry_subkey.is_empty(), "precondition");
        assert!(!external_install_present(firefox));
        assert!(
            !enforcement_still_present(firefox, EnforceOutcome::AutoInstallPendingApproval),
            "an auto-install memo for a browser with no auto-install path must never verify"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn lockdown_policy_disables_incognito_guest_and_private() {
        let chromium: std::collections::HashMap<_, _> =
            lockdown_policy_values(Engine::Chromium).iter().copied().collect();
        // 1 = Incognito DISABLED. Must never be "2" — that FORCES incognito
        // (every window private, the exact opposite of what we want).
        assert_eq!(chromium.get("IncognitoModeAvailability"), Some(&"1"));
        assert_eq!(chromium.get("BrowserGuestModeEnabled"), Some(&"0"), "0 = guest off");

        let gecko: std::collections::HashMap<_, _> =
            lockdown_policy_values(Engine::Gecko).iter().copied().collect();
        assert_eq!(gecko.get("DisablePrivateBrowsing"), Some(&"1"));
        assert!(
            !gecko.contains_key("IncognitoModeAvailability"),
            "guest/incognito are Chromium-only concepts"
        );
    }
}
