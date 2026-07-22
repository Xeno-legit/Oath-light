//! Ground-truth "is the extension installed" detection, per browser profile.
//!
//! The native-messaging heartbeat only tells us the extension's MV3 service
//! worker is *currently awake* — and those sleep after ~30s idle, which would
//! make a perfectly-installed extension look "missing". So instead we read the
//! browser's own record of installed extensions from each profile's preferences
//! file. That's authoritative, survives the worker sleeping, and gives us the
//! real profile names too.
//!
//! Chromium family only (Chrome/Edge/Brave/Vivaldi/Chromium/Opera). Firefox and
//! anything we can't locate return `None`, and the caller falls back to the
//! heartbeat (and never force-flags "missing" without ground truth).

use crate::browsers::{BrowserDef, EXTENSION_ID, STORE_EXTENSION_ID};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// One profile's view of the extension (only profiles that have an entry are
/// returned — a profile that never installed it is simply omitted).
#[derive(Debug, Clone)]
pub struct ProfileExt {
    pub profile_dir: String,
    pub name: String,
    pub installed: bool, // present AND enabled
    pub version: String,
}

const CACHE_TTL: Duration = Duration::from_secs(30);

/// Cached per-browser profile read (prefs files are large-ish; don't parse them
/// every monitor tick). `None` = this browser's data couldn't be located.
///
/// 30s trades off extension-removal detection latency (worst case, ≤30s
/// before we notice the extension is gone) against steady-state cost: these
/// are multi-MB Chromium "Secure Preferences"/"Preferences" JSON files, and at
/// the old 8s TTL they were re-parsed roughly 4x as often for no benefit — 30s
/// is still far below the uninstall-friction cool-off timescale (minutes to
/// hours), so it costs us nothing that actually matters for tamper resistance.
pub fn cached_profiles(def: &BrowserDef) -> Option<Vec<ProfileExt>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Option<Vec<ProfileExt>>)>>> =
        OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Some((t, v)) = cache.lock().unwrap().get(def.key) {
        if t.elapsed() < CACHE_TTL {
            return v.clone();
        }
    }
    let fresh = read_profiles(def);
    cache
        .lock()
        .unwrap()
        .insert(def.key.to_string(), (Instant::now(), fresh.clone()));
    fresh
}

#[cfg(target_os = "windows")]
fn user_data_dir(key: &str) -> Option<PathBuf> {
    let local = std::env::var("LOCALAPPDATA").ok();
    let roaming = std::env::var("APPDATA").ok();
    let path = match key {
        "chrome" => format!(r"{}\Google\Chrome\User Data", local?),
        "edge" => format!(r"{}\Microsoft\Edge\User Data", local?),
        "brave" => format!(r"{}\BraveSoftware\Brave-Browser\User Data", local?),
        "vivaldi" => format!(r"{}\Vivaldi\User Data", local?),
        "chromium" => format!(r"{}\Chromium\User Data", local?),
        // Opera keeps a single profile directly under its roaming dir.
        "opera" => format!(r"{}\Opera Software\Opera Stable", roaming?),
        _ => return None,
    };
    let pb = PathBuf::from(path);
    if pb.exists() {
        Some(pb)
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn user_data_dir(_key: &str) -> Option<PathBuf> {
    None
}

fn read_json(path: &Path) -> Option<Value> {
    let s = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&s).ok()
}

/// `profile.info_cache` maps a profile directory to its display name.
fn local_state_names(udd: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(v) = read_json(&udd.join("Local State")) {
        if let Some(cache) = v
            .get("profile")
            .and_then(|p| p.get("info_cache"))
            .and_then(|c| c.as_object())
        {
            for (dir, info) in cache {
                let name = info
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or(dir)
                    .to_string();
                out.insert(dir.clone(), name);
            }
        }
    }
    out
}

/// Fallback when Local State has no info_cache: directories named `Default` or
/// `Profile N` are Chromium profiles.
fn scan_profile_dirs(udd: &Path) -> Vec<String> {
    let mut dirs = Vec::new();
    if let Ok(rd) = std::fs::read_dir(udd) {
        for e in rd.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name == "Default" || name.starts_with("Profile ") {
                dirs.push(name);
            }
        }
    }
    dirs
}

fn find_ext_entry(prefs: &Value) -> Option<&Value> {
    // A store install lives under STORE_EXTENSION_ID; an unpacked/dev load under
    // EXTENSION_ID. Look for either so a Web-Store user isn't mis-reported as
    // "extension not installed" (which drives the unprotected-profile warning).
    let settings = prefs.get("extensions")?.get("settings")?;
    settings
        .get(STORE_EXTENSION_ID)
        .or_else(|| settings.get(EXTENSION_ID))
}

/// Read one profile dir. Returns `Some(ProfileExt)` for every profile whose
/// prefs we could read — `installed` is false when the extension isn't present
/// there (so the caller can warn about unprotected profiles). `None` means the
/// prefs were unreadable (locked/absent) → unknown, don't warn.
fn read_profile_ext(profile_dir: &Path, name: &str) -> Option<ProfileExt> {
    // Dev/external extensions live in "Secure Preferences"; store ones in
    // "Preferences". Check both; remember whether we read anything at all.
    let mut read_any = false;
    let mut found: Option<(bool, String)> = None;
    for fname in ["Secure Preferences", "Preferences"] {
        let v = match read_json(&profile_dir.join(fname)) {
            Some(v) => v,
            None => continue,
        };
        read_any = true;
        if let Some(entry) = find_ext_entry(&v) {
            // "Installed" needs evidence of a real unpacked payload, not just a
            // settings entry: once the ExtensionInstallForcelist policy is
            // written, Chromium pre-creates a bare `settings.<id>` stub (often
            // literally `{}`) before — or without ever — downloading the CRX.
            // Surveyed real profiles (Chrome ~M137, Edge) to pin the schema:
            //   * `manifest.version` exists only after a real install (store,
            //     force-install download, or dev "Load unpacked" — all carry a
            //     full manifest). The stub has no `manifest` at all, so this is
            //     the discriminator. The bare top-level `version` is kept only
            //     as a display fallback — never proof of install.
            //   * Modern Chrome no longer writes `state` (enabled/disabled is
            //     `disable_reasons` alone); Edge still writes 1/0. So absent
            //     state must count as enabled, and only an explicit 0 vetoes.
            //   * `disable_reasons` is an array in new schema but an int
            //     bitmask in old-schema Edge — handle both; unknown shapes read
            //     as disabled (for a blocker, a false "installed" is the worse
            //     failure).
            let disabled_by_state =
                entry.get("state").and_then(|s| s.as_i64()) == Some(0);
            let reasons_empty = match entry.get("disable_reasons") {
                None => true,
                Some(d) => d
                    .as_array()
                    .map(|a| a.is_empty())
                    .or_else(|| d.as_i64().map(|n| n == 0))
                    .unwrap_or(false),
            };
            let manifest_version = entry
                .get("manifest")
                .and_then(|m| m.get("version"))
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty());
            let has_real_payload = manifest_version.is_some();
            let version = manifest_version
                .or_else(|| entry.get("version").and_then(|x| x.as_str()))
                .unwrap_or("")
                .to_string();
            found = Some((has_real_payload && !disabled_by_state && reasons_empty, version));
            break;
        }
    }
    if !read_any {
        return None;
    }
    let (installed, version) = found.unwrap_or((false, String::new()));
    Some(ProfileExt {
        profile_dir: profile_dir.to_string_lossy().to_string(),
        name: name.to_string(),
        installed,
        version,
    })
}

fn read_profiles(def: &BrowserDef) -> Option<Vec<ProfileExt>> {
    let udd = user_data_dir(def.key)?;

    // Opera stores a single profile directly in its data dir.
    if def.key == "opera" {
        return read_profile_ext(&udd, "Opera").map(|p| vec![p]);
    }

    let names = local_state_names(&udd);
    let dirs: Vec<String> = if names.is_empty() {
        scan_profile_dirs(&udd)
    } else {
        names.keys().cloned().collect()
    };

    let mut out = Vec::new();
    for dir in dirs {
        let pdir = udd.join(&dir);
        if !pdir.is_dir() {
            continue;
        }
        let name = names.get(&dir).cloned().unwrap_or(dir);
        if let Some(p) = read_profile_ext(&pdir, &name) {
            out.push(p); // includes unprotected profiles (installed = false)
        }
    }
    // If we couldn't read a single profile's prefs, report unknown rather than
    // "nothing installed" (which would wrongly flag the extension as missing).
    if out.is_empty() {
        return None;
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Some(out)
}
