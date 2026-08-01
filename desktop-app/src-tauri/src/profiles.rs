//! Ground-truth "is the extension installed" detection, per browser profile.
//!
//! The native-messaging heartbeat only tells us the extension's MV3 service
//! worker is *currently awake* — and those sleep after ~30s idle, which would
//! make a perfectly-installed extension look "missing". So instead we read the
//! browser's own record of installed extensions from each profile's preferences
//! file. That's authoritative, survives the worker sleeping, and gives us the
//! real profile names too.
//!
//! Both engines are covered. Chromium (Chrome/Edge/Brave/Vivaldi/Chromium/Opera)
//! is read out of each profile's `Preferences`/`Secure Preferences`; Firefox out
//! of `profiles.ini` + each profile's `extensions.json`. Anything we can't
//! locate returns `None`, and the caller falls back to the heartbeat (and never
//! force-flags "missing" without ground truth).
//!
//! **Why Firefox was worth adding.** Without it, a Firefox row's version came
//! only from the live native-messaging handshake — so it showed nothing at all
//! unless the add-on happened to be connected, and once it had a value it kept
//! whatever the last connected worker reported. That is what "Firefox detection
//! lags and doesn't update" was: not a stale cache, but no ground truth at all.
//! `extensions.json` is the browser's own record, carries the real version, and
//! is correct whether Firefox is running or not.

use crate::browsers::{BrowserDef, Engine, EXTENSION_ID, GECKO_EXTENSION_ID, STORE_EXTENSION_ID};
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
    /// Present with a real payload but switched off — the browser downloaded and
    /// unpacked the extension and is holding it disabled. For an auto-installed
    /// (external-registry) extension this is Chromium's sideload protection
    /// waiting for the user to acknowledge the "new extension added" prompt once,
    /// which is the difference between "nothing is happening" and "the user is
    /// one click from being protected".
    ///
    /// Strictly narrower than `!installed`: a profile with no entry at all is not
    /// pending anything. `browser_lock` relies on that distinction to decide
    /// whether extending a grace window could plausibly accomplish anything.
    pub pending_approval: bool,
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
/// Per-browser-key cache entry: when it was computed, and what was found
/// (`None` = "we looked and there are no profiles", which is cached too — it
/// is just as expensive to re-derive as a positive result).
type ProfileCacheEntry = (Instant, Option<Vec<ProfileExt>>);

#[allow(clippy::type_complexity)]
static CACHE: OnceLock<Mutex<HashMap<String, ProfileCacheEntry>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, ProfileCacheEntry>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cached_profiles(def: &BrowserDef) -> Option<Vec<ProfileExt>> {
    if let Some((t, v)) = cache().lock().unwrap().get(def.key) {
        if t.elapsed() < CACHE_TTL {
            return v.clone();
        }
    }
    let fresh = read_profiles(def);
    cache()
        .lock()
        .unwrap()
        .insert(def.key.to_string(), (Instant::now(), fresh.clone()));
    fresh
}

/// Drop every cached profile read, so the very next status build reflects what
/// is on disk right now.
///
/// The 30s TTL is a good trade for a background poll and a bad one right after
/// the user pressed a button: without this, "Refresh" would rewrite the policy
/// and then show the same stale row for up to half a minute, which reads as the
/// button having done nothing.
pub fn invalidate_cache() {
    cache().lock().unwrap().clear();
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
    let mut found: Option<(bool, bool, String)> = None; // (installed, pending_approval, version)
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
            let enabled = !disabled_by_state && reasons_empty;
            found = Some((has_real_payload && enabled, has_real_payload && !enabled, version));
            break;
        }
    }
    if !read_any {
        return None;
    }
    let (installed, pending_approval, version) = found.unwrap_or((false, false, String::new()));
    Some(ProfileExt {
        profile_dir: profile_dir.to_string_lossy().to_string(),
        name: name.to_string(),
        installed,
        pending_approval,
        version,
    })
}

fn read_profiles(def: &BrowserDef) -> Option<Vec<ProfileExt>> {
    match def.engine {
        Engine::Chromium => read_chromium_profiles(def),
        Engine::Gecko => read_gecko_profiles(),
    }
}

/// Every Chromium profile directory for `def` — the same enumeration
/// `read_chromium_profiles` walks, exposed so the external-uninstall repair
/// below can visit exactly the same set.
fn chromium_profile_dirs(def: &BrowserDef) -> Vec<(PathBuf, String)> {
    let Some(udd) = user_data_dir(def.key) else { return Vec::new() };

    // Opera stores a single profile directly in its data dir.
    if def.key == "opera" {
        return vec![(udd, "Opera".to_string())];
    }

    let names = local_state_names(&udd);
    let dirs: Vec<String> = if names.is_empty() {
        scan_profile_dirs(&udd)
    } else {
        names.keys().cloned().collect()
    };

    dirs.into_iter()
        .filter_map(|dir| {
            let pdir = udd.join(&dir);
            if !pdir.is_dir() {
                return None;
            }
            let name = names.get(&dir).cloned().unwrap_or(dir);
            Some((pdir, name))
        })
        .collect()
}

fn read_chromium_profiles(def: &BrowserDef) -> Option<Vec<ProfileExt>> {
    let mut out = Vec::new();
    for (pdir, name) in chromium_profile_dirs(def) {
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

// ============================================================================
// Firefox (Gecko)
// ============================================================================

/// `%APPDATA%\Mozilla\Firefox` — the root holding `profiles.ini` and `Profiles\`.
#[cfg(target_os = "windows")]
fn gecko_root() -> Option<PathBuf> {
    let root = PathBuf::from(std::env::var("APPDATA").ok()?).join("Mozilla").join("Firefox");
    root.is_dir().then_some(root)
}

#[cfg(not(target_os = "windows"))]
fn gecko_root() -> Option<PathBuf> {
    None
}

/// `profiles.ini` → the real user profiles, as `(name, path, is_relative)`.
///
/// Only `[ProfileN]` sections count. The file also carries `[InstallXXXX]`
/// (which install last used which profile), `[General]`, and — critically —
/// `[BackgroundTasksProfiles]`, whose entries are throwaway profiles Firefox
/// creates for the update/default-agent background tasks. Those have no add-ons
/// and never will; counting them would permanently pin Firefox at "partially
/// protected" for profiles the user has never seen.
fn parse_profiles_ini(text: &str) -> Vec<(String, String, bool)> {
    let mut out: Vec<(String, String, bool)> = Vec::new();
    let (mut in_profile, mut name, mut path, mut relative) =
        (false, String::new(), String::new(), true);

    for line in text.lines() {
        let l = line.trim();
        if let Some(section) = l.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            if in_profile && !path.is_empty() {
                out.push((std::mem::take(&mut name), std::mem::take(&mut path), relative));
            }
            in_profile = section
                .strip_prefix("Profile")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
            (name, path, relative) = (String::new(), String::new(), true);
            continue;
        }
        if !in_profile {
            continue;
        }
        if let Some((k, v)) = l.split_once('=') {
            match k.trim() {
                "Name" => name = v.trim().to_string(),
                "Path" => path = v.trim().to_string(),
                "IsRelative" => relative = v.trim() != "0",
                _ => {}
            }
        }
    }
    if in_profile && !path.is_empty() {
        out.push((name, path, relative));
    }
    out
}

/// One Firefox profile's view of the add-on, read from its `extensions.json`.
/// `None` when that file isn't there — a profile that has never been launched
/// has no add-on record at all, which is "unknown", not "unprotected".
fn read_gecko_profile_ext(dir: &Path, name: &str) -> Option<ProfileExt> {
    let v = read_json(&dir.join("extensions.json"))?;
    let entry = v
        .get("addons")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter().find(|a| a.get("id").and_then(|i| i.as_str()) == Some(GECKO_EXTENSION_ID))
        });

    // `active` alone is Firefox's own "is this add-on running" flag, but read
    // the two disable flags as well: an add-on can be listed and inert, and for
    // a blocker a false "installed" is the worse failure.
    let flag = |a: &Value, k: &str| a.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let (installed, version) = match entry {
        Some(a) => (
            flag(a, "active") && !flag(a, "userDisabled") && !flag(a, "appDisabled"),
            a.get("version").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        ),
        None => (false, String::new()),
    };

    Some(ProfileExt {
        profile_dir: dir.to_string_lossy().to_string(),
        name: if name.is_empty() { "Firefox".to_string() } else { name.to_string() },
        installed,
        // Gecko has no sideload-approval limbo: a policy-installed add-on is
        // either running or it isn't.
        pending_approval: false,
        version,
    })
}

fn read_gecko_profiles() -> Option<Vec<ProfileExt>> {
    let root = gecko_root()?;
    let ini = std::fs::read_to_string(root.join("profiles.ini")).ok()?;

    let mut out = Vec::new();
    for (name, path, relative) in parse_profiles_ini(&ini) {
        // `Path` is `Profiles/xxxx.name` with forward slashes when relative,
        // and an absolute path when not.
        let dir = if relative { root.join(path.replace('/', "\\")) } else { PathBuf::from(&path) };
        if let Some(p) = read_gecko_profile_ext(&dir, &name) {
            out.push(p);
        }
    }
    if out.is_empty() {
        return None;
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Some(out)
}

// ============================================================================
// External-uninstall repair (the Edge "no prompt ever appears" fix)
// ============================================================================

/// Remove our extension ids from a Chromium profile's
/// `extensions.external_uninstalls`, returning how many profiles were repaired.
///
/// **What this record is.** When a user removes an extension that was installed
/// through the external-extensions registry, Chromium does not merely uninstall
/// it — it writes the id into this list and then refuses to install that id from
/// an external provider ever again. The registry entry stays, looks healthy, and
/// does nothing: no download, no install, and therefore no "a third party wants
/// to add this extension" prompt. On Edge, where the external registry is the
/// *only* install path we have, that is the whole feature silently dead, and no
/// amount of extra time in a restore window can revive it because the browser
/// never begins the work.
///
/// **Why editing prefs here is safe.** `external_uninstalls` lives in the plain
/// `Preferences` file, which carries no `protection` block — the HMACs that
/// guard tampering live in `Secure Preferences` and cover `extensions.install`,
/// `extensions.settings` and `extensions.ui`, none of which this touches. So
/// this is not forging a security decision; it is clearing a "don't offer this
/// again" note so the browser's own prompt can be shown to the user, who still
/// has to accept it.
///
/// Callers must ensure the browser is **not running**: Chromium keeps prefs in
/// memory and rewrites the file on exit, so an edit under a live browser is
/// simply discarded. The original is copied to `Preferences.oathlight-bak`
/// before the first change, and the replacement is written via a temp file and
/// renamed, so a crash mid-write cannot leave a half-written profile.
pub fn clear_external_uninstall_record(def: &BrowserDef) -> usize {
    if def.engine != Engine::Chromium {
        return 0;
    }
    let ours = [STORE_EXTENSION_ID, EXTENSION_ID];
    let mut repaired = 0;

    for (pdir, _) in chromium_profile_dirs(def) {
        let path = pdir.join("Preferences");
        let Some(mut prefs) = read_json(&path) else { continue };
        let Some(list) = prefs
            .pointer_mut("/extensions/external_uninstalls")
            .and_then(|v| v.as_array_mut())
        else {
            continue;
        };
        let before = list.len();
        list.retain(|v| !v.as_str().is_some_and(|id| ours.contains(&id)));
        if list.len() == before {
            continue; // nothing of ours in there — leave the file untouched
        }

        let _ = std::fs::copy(&path, path.with_extension("oathlight-bak"));
        let tmp = path.with_extension("oathlight-tmp");
        let wrote = serde_json::to_string(&prefs)
            .ok()
            .and_then(|s| std::fs::write(&tmp, s).ok())
            .and_then(|_| std::fs::rename(&tmp, &path).ok())
            .is_some();
        if wrote {
            repaired += 1;
            log::warn!(
                "[{}] cleared external-uninstall block for our extension in {}",
                def.key,
                pdir.display()
            );
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    if repaired > 0 {
        invalidate_cache();
    }
    repaired
}

/// Delete the `Preferences.oathlight-bak` copies the repair above leaves behind.
///
/// Called on sanctioned uninstall only. The installer notice promises a
/// completed removal takes the app's own data with it, and a 150 KB copy of the
/// user's prefs sitting in each browser profile forever is exactly the kind of
/// thing that makes that promise false — the backup earns its keep while the app
/// is installed and stops earning it the moment the app isn't.
pub fn remove_backup_files(def: &BrowserDef) {
    if def.engine != Engine::Chromium {
        return;
    }
    for (pdir, _) in chromium_profile_dirs(def) {
        let _ = std::fs::remove_file(pdir.join("Preferences").with_extension("oathlight-bak"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The background-task profiles are the trap here: they are real sections in
    /// a real `profiles.ini` and they never carry an add-on, so counting them
    /// would report Firefox as permanently "partially protected".
    #[test]
    fn profiles_ini_reads_user_profiles_and_ignores_background_tasks() {
        let ini = "\
[Install308046B0AF4A39CB]\n\
Default=Profiles/1e8xgnmp.default-release\n\
Locked=1\n\
\n\
[Profile1]\n\
Name=default\n\
IsRelative=1\n\
Path=Profiles/nu0xz2h9.default\n\
Default=1\n\
\n\
[Profile0]\n\
Name=default-release\n\
IsRelative=1\n\
Path=Profiles/1e8xgnmp.default-release\n\
\n\
[General]\n\
StartWithLastProfile=1\n\
Version=2\n\
\n\
[BackgroundTasksProfiles]\n\
MozillaBackgroundTask-308046B0AF4A39CB-defaultagent=uhzjmhpb.MozillaBackgroundTask\n";

        let got = parse_profiles_ini(ini);
        assert_eq!(got.len(), 2, "only the two [ProfileN] sections are real profiles");
        assert_eq!(got[0], ("default".into(), "Profiles/nu0xz2h9.default".into(), true));
        assert_eq!(got[1], ("default-release".into(), "Profiles/1e8xgnmp.default-release".into(), true));
    }

    #[test]
    fn profiles_ini_handles_absolute_paths_and_a_trailing_section() {
        let ini = "[Profile0]\nName=custom\nIsRelative=0\nPath=D:\\ff\\profile\n";
        let got = parse_profiles_ini(ini);
        assert_eq!(got, vec![("custom".to_string(), r"D:\ff\profile".to_string(), false)]);
    }

    /// A disabled add-on must not read as installed — for a blocker, a false
    /// "protected" is the failure that matters.
    #[test]
    fn gecko_profile_reads_version_and_respects_the_disable_flags() {
        let dir = std::env::temp_dir().join(format!("ol-gecko-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |active: bool, user_disabled: bool| {
            let json = serde_json::json!({
                "schemaVersion": 37,
                "addons": [
                    { "id": "someone@else", "version": "1.0", "active": true },
                    {
                        "id": GECKO_EXTENSION_ID, "version": "3.5.0", "type": "extension",
                        "active": active, "userDisabled": user_disabled, "appDisabled": false
                    }
                ]
            });
            std::fs::write(dir.join("extensions.json"), json.to_string()).unwrap();
        };

        write(true, false);
        let p = read_gecko_profile_ext(&dir, "default-release").expect("readable profile");
        assert!(p.installed, "an active, enabled add-on is installed");
        assert_eq!(p.version, "3.5.0", "the real installed version, not the heartbeat's");
        assert_eq!(p.name, "default-release");
        assert!(!p.pending_approval, "Gecko has no sideload-approval limbo");

        write(true, true);
        assert!(!read_gecko_profile_ext(&dir, "d").unwrap().installed, "userDisabled vetoes");

        // Add-on absent entirely: readable profile, not protected.
        std::fs::write(
            dir.join("extensions.json"),
            serde_json::json!({ "addons": [] }).to_string(),
        )
        .unwrap();
        let p = read_gecko_profile_ext(&dir, "d").expect("still a readable profile");
        assert!(!p.installed);
        assert!(p.version.is_empty());

        // Never launched: no record at all is "unknown", not "unprotected".
        std::fs::remove_file(dir.join("extensions.json")).unwrap();
        assert!(read_gecko_profile_ext(&dir, "d").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
