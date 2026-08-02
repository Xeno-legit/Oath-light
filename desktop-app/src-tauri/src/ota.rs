//! src-tauri/src/ota.rs — desktop consumer for over-the-air blocklist updates
//! (plan item 3.5). The publisher side lives in CI
//! (`.github/workflows/release-lists.yml` + `scripts/ota/sign-manifest.mjs`);
//! the shared policy (manifest schema, baked pubkeys, monotonicity, the
//! whitelist safety floor) lives in `oathlight_core::ota`; this module is the
//! I/O half: fetch, verify, atomically install, load-at-startup, and push the
//! fresh lists to every connected extension.
//!
//! Runs in the app, NOT the watchdog — list updates are not liveness-critical
//! (a client that never updates keeps blocking on its last-known lists
//! forever; the baked built-ins are `include_str!`ed and can never be
//! deleted). A background thread started from `setup()` wakes hourly and runs
//! a check when the last one is >= a week old; the `check_lists_update_now`
//! command runs the same check on demand for the Settings UI.
//!
//! What leaves the device (standing rule J.6): two-to-seven HTTPS GETs to
//! `github.com` for the release assets. No identifiers, no telemetry — the
//! same as any `git pull`.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use oathlight_core::lists;
use oathlight_core::ota as policy;
use tauri::{AppHandle, Emitter, Manager};

// ============================================================================
// Where updates come from
// ============================================================================

/// Base URL of the "latest release" assets. GitHub serves
/// `releases/latest/download/<asset>` as a redirect to the newest release's
/// asset of that name, which is exactly the "manifest + files as release
/// assets" CDN the plan describes.
///
/// Repo slug taken from this repository's `origin` remote
/// (github.com/Xeno-legit/Oath-light). TODO(owner): if the project moves to a
/// dedicated org/repo before Alpha, update this const AND the matching
/// `_config.baseUrl` in `extension/bg/ota.js` — they must always point at the
/// same release stream, or desktop and extension will drift.
pub const OTA_RELEASE_BASE: &str =
    "https://github.com/Xeno-legit/Oath-light/releases/latest/download";

pub const MANIFEST_ASSET: &str = "lists-manifest.json";
pub const MANIFEST_SIG_ASSET: &str = "lists-manifest.json.sig";

/// How often the background thread actually checks (a week), and how often it
/// wakes to see whether a check is due (hourly — cheap, and it makes the
/// "laptop was asleep past the deadline" case fire within an hour of resume).
const CHECK_INTERVAL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const WAKE_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// First wake after startup — off the boot path, but soon enough that a
/// first-run install picks up fresh lists the same session.
const FIRST_WAKE: Duration = Duration::from_secs(60);

// ============================================================================
// Persisted state (<app_data_dir>/ota.json) + the managed status object
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct OtaPersist {
    /// Highest list version ever installed on this machine. The anti-rollback
    /// floor — deliberately kept even if `lists/` is deleted on disk, so a
    /// wiped lists dir can't be used to re-install an old signed release.
    #[serde(default)]
    installed_version: u64,
    /// Unix seconds of the last completed check attempt (success or not).
    #[serde(default)]
    last_check: u64,
    /// Human-readable outcome of the last check ("updated to v3", "already up
    /// to date", or the error). Shown verbatim in Settings — honesty rule.
    #[serde(default)]
    last_result: String,
}

/// Managed by tauri; the OTA commands and the background thread share it.
pub struct OtaState {
    app_data_dir: PathBuf,
    persist: Mutex<OtaPersist>,
    checking: AtomicBool,
}

/// What the Settings UI sees.
#[derive(Debug, Clone, Serialize)]
pub struct OtaStatusView {
    /// Highest version ever installed (0 = never updated, built-ins only).
    pub installed_version: u64,
    /// Version actually loaded into the running matcher right now (None =
    /// serving baked built-ins).
    pub loaded_version: Option<u64>,
    pub last_check: u64,
    pub last_result: String,
    pub checking: bool,
}

impl OtaState {
    pub fn load(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("ota.json");
        let persist = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<OtaPersist>(&s).ok())
            .unwrap_or_default();
        Self {
            app_data_dir: app_data_dir.to_path_buf(),
            persist: Mutex::new(persist),
            checking: AtomicBool::new(false),
        }
    }

    fn save(&self, p: &OtaPersist) {
        let _ = std::fs::create_dir_all(&self.app_data_dir);
        if let Ok(json) = serde_json::to_string_pretty(p) {
            let _ = std::fs::write(self.app_data_dir.join("ota.json"), json);
        }
    }

    fn record_result(&self, result: &str) {
        let mut p = self.persist.lock().unwrap();
        p.last_check = unix_now();
        p.last_result = result.to_string();
        self.save(&p);
    }

    fn record_installed(&self, version: u64) {
        let mut p = self.persist.lock().unwrap();
        if version > p.installed_version {
            p.installed_version = version;
            self.save(&p);
        }
    }

    /// Anti-rollback floor: the max of the persisted high-water mark and
    /// whatever is loaded right now.
    fn installed_floor(&self) -> u64 {
        let persisted = self.persist.lock().unwrap().installed_version;
        persisted.max(lists::ota::installed_version().unwrap_or(0))
    }

    pub fn status(&self) -> OtaStatusView {
        let p = self.persist.lock().unwrap().clone();
        OtaStatusView {
            installed_version: p.installed_version,
            loaded_version: lists::ota::installed_version(),
            last_check: p.last_check,
            last_result: p.last_result,
            checking: self.checking.load(Ordering::SeqCst),
        }
    }

    fn lists_dir(&self) -> PathBuf {
        self.app_data_dir.join("lists")
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ============================================================================
// Signature + content verification (pure functions — unit-tested below)
// ============================================================================

/// Verify `sig_hex` (128 hex chars = 64-byte raw Ed25519 signature) over
/// `manifest_bytes` against any of `pubkeys_hex`. This is THE trust decision
/// of the whole feature: everything downstream (per-file sha256, list
/// content) chains off the manifest these bytes encode.
fn verify_sig_any(manifest_bytes: &[u8], sig_hex: &str, pubkeys_hex: &[&str]) -> Result<(), String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let sig_bytes = policy::decode_hex(sig_hex)?;
    let sig_arr: [u8; 64] =
        sig_bytes.as_slice().try_into().map_err(|_| "signature must be exactly 64 bytes".to_string())?;
    let sig = Signature::from_bytes(&sig_arr);

    for &pk_hex in pubkeys_hex {
        let pk_bytes = policy::decode_hex(pk_hex)?;
        let pk_arr: [u8; 32] = match pk_bytes.as_slice().try_into() {
            Ok(a) => a,
            Err(_) => continue, // a malformed baked key must not brick the other one
        };
        let vk = match VerifyingKey::from_bytes(&pk_arr) {
            Ok(vk) => vk,
            Err(_) => continue,
        };
        if vk.verify(manifest_bytes, &sig).is_ok() {
            return Ok(());
        }
    }
    Err("manifest signature does not verify against any update key".into())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    policy::encode_hex(&digest)
}

/// Parse the verified file set into list content. Every file's bytes have
/// already been hash-checked against the signed manifest; this validates the
/// SHAPE (the JSON the matcher actually consumes) and applies the whitelist
/// safety floor. Entries are trimmed + lowercased defensively (CI validation
/// enforces lowercase at publish time; a mismatch here is normalized, not
/// fatal — the collision check below runs on the normalized values either
/// way).
fn assemble_lists(
    version: u64,
    files: &[(String, Vec<u8>)],
) -> Result<lists::ota::OtaLists, String> {
    let mut domains_vec: Vec<String> = Vec::new();
    let mut keywords: Vec<String> = Vec::new();

    for (name, bytes) in files {
        let v: serde_json::Value = serde_json::from_slice(bytes)
            .map_err(|e| format!("{name}: invalid JSON: {e}"))?;
        if name == "keywords.json" {
            let arr = v
                .get("keywords")
                .and_then(|a| a.as_array())
                .ok_or_else(|| format!("{name}: missing \"keywords\" array"))?;
            for item in arr {
                let s = item.as_str().ok_or_else(|| format!("{name}: non-string keyword entry"))?;
                keywords.push(s.trim().to_lowercase());
            }
        } else {
            let arr = v
                .get("domains")
                .and_then(|a| a.as_array())
                .ok_or_else(|| format!("{name}: missing \"domains\" array"))?;
            for item in arr {
                let s = item.as_str().ok_or_else(|| format!("{name}: non-string domain entry"))?;
                let d = s.trim().to_lowercase();
                if d.is_empty() {
                    return Err(format!("{name}: empty domain entry"));
                }
                domains_vec.push(d);
            }
        }
    }

    if domains_vec.is_empty() {
        return Err("update contains no domains — refusing to replace the built-ins with nothing".into());
    }

    let domains: HashSet<String> = domains_vec.iter().cloned().collect();

    // The safety floor (plan 3.5.4): an update that would block any domain on
    // WHITELIST_DOMAINS — exactly or by the parent walk — is rejected
    // wholesale. A poisoned-but-correctly-signed release must not be able to
    // brick github.com.
    if let Some(w) = policy::whitelist_collision(&domains) {
        return Err(format!(
            "update rejected: it would block whitelisted domain {w:?} — refusing the whole version"
        ));
    }

    Ok(lists::ota::OtaLists { version, domains, domains_vec, keywords })
}

// ============================================================================
// HTTP
// ============================================================================

/// GET `url`, reading at most `cap` bytes; errors if the body exceeds the cap
/// (an over-cap asset is treated as hostile, not truncated).
fn fetch_bytes(url: &str, cap: u64) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .timeout(Duration::from_secs(60))
        .call()
        .map_err(|e| format!("GET {url} failed: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    resp.into_reader()
        .take(cap + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("reading {url} failed: {e}"))?;
    if buf.len() as u64 > cap {
        return Err(format!("{url} exceeds the {cap}-byte cap"));
    }
    Ok(buf)
}

// ============================================================================
// The check itself
// ============================================================================

/// Fetch → verify → install → load → push. Returns the human summary that
/// lands in `last_result`. Never touches the currently-loaded lists unless
/// every check passed and the new files are fully on disk.
fn run_check(app: &AppHandle, state: &OtaState) -> Result<String, String> {
    // 1. Manifest + signature.
    let manifest_bytes =
        fetch_bytes(&format!("{OTA_RELEASE_BASE}/{MANIFEST_ASSET}"), policy::OTA_MAX_MANIFEST_BYTES)?;
    let sig_bytes =
        fetch_bytes(&format!("{OTA_RELEASE_BASE}/{MANIFEST_SIG_ASSET}"), policy::OTA_MAX_SIG_BYTES)?;
    let sig_hex = String::from_utf8(sig_bytes).map_err(|_| "signature file is not UTF-8".to_string())?;
    verify_sig_any(&manifest_bytes, &sig_hex, &policy::OTA_PUBKEYS_HEX)?;

    // 2. Parse + structural checks (safe names, known kinds, size caps).
    let manifest = policy::parse_manifest(&manifest_bytes)?;

    // 3. Monotonic version — no rollback, no same-version re-install.
    let floor = state.installed_floor();
    if !policy::version_is_acceptable(manifest.version, floor) {
        return if manifest.version == floor {
            Ok(format!("already up to date (v{})", floor))
        } else {
            Err(format!(
                "rejected: published version v{} is older than installed v{} (rollback)",
                manifest.version, floor
            ))
        };
    }

    // 4. Gather file bytes: reuse a byte-identical file already on disk from
    //    the previous version (hash re-checked — the manifest is the truth,
    //    the disk is not), otherwise download. Total already capped by
    //    parse_manifest; each file additionally capped by its declared size.
    let lists_dir = state.lists_dir();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for (name, entry) in &manifest.files {
        let existing = std::fs::read(lists_dir.join(name)).ok();
        let bytes = match existing {
            Some(b) if b.len() as u64 == entry.size && sha256_hex(&b) == entry.sha256 => b,
            _ => fetch_bytes(&format!("{OTA_RELEASE_BASE}/{name}"), entry.size)?,
        };
        if bytes.len() as u64 != entry.size {
            return Err(format!("{name}: size {} != manifest size {}", bytes.len(), entry.size));
        }
        let got = sha256_hex(&bytes);
        if got != entry.sha256 {
            return Err(format!("{name}: sha256 mismatch (manifest {}, got {got})", entry.sha256));
        }
        files.push((name.clone(), bytes));
    }

    // 5. Shape + whitelist safety floor. Rejecting here leaves disk and the
    //    running matcher untouched.
    let new_lists = assemble_lists(manifest.version, &files)?;

    // 6. Write to a temp dir, then atomically swap into <app_data_dir>/lists/.
    let tmp = state.app_data_dir.join("lists.tmp");
    let old = state.app_data_dir.join("lists.old");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("creating temp dir failed: {e}"))?;
    for (name, bytes) in &files {
        std::fs::write(tmp.join(name), bytes).map_err(|e| format!("writing {name} failed: {e}"))?;
    }
    std::fs::write(tmp.join(MANIFEST_ASSET), &manifest_bytes)
        .map_err(|e| format!("writing manifest failed: {e}"))?;
    std::fs::write(tmp.join(MANIFEST_SIG_ASSET), sig_hex.as_bytes())
        .map_err(|e| format!("writing signature failed: {e}"))?;

    let _ = std::fs::remove_dir_all(&old);
    if lists_dir.exists() {
        std::fs::rename(&lists_dir, &old).map_err(|e| format!("staging old lists failed: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&tmp, &lists_dir) {
        // Try to roll the old dir back so the on-disk state stays coherent.
        let _ = std::fs::rename(&old, &lists_dir);
        return Err(format!("installing new lists failed: {e}"));
    }
    let _ = std::fs::remove_dir_all(&old);

    // 7. Persist the new high-water mark, load the overlay, push everywhere.
    let version = new_lists.version;
    let n_domains = new_lists.domains_vec.len();
    state.record_installed(version);
    let (domains_vec, keywords) = (new_lists.domains_vec.clone(), new_lists.keywords.clone());
    lists::ota::set(new_lists);
    push_lists_to_extensions(app, &domains_vec, &keywords);

    Ok(format!("updated to v{version} ({n_domains} domains)"))
}

/// One check, serialized (a second caller while one runs gets an honest
/// "already checking"), with the outcome recorded + emitted either way.
pub fn check_now(app: &AppHandle) -> Result<OtaStatusView, String> {
    let state = app
        .try_state::<Arc<OtaState>>()
        .ok_or_else(|| "OTA state not initialized".to_string())?
        .inner()
        .clone();

    if state.checking.swap(true, Ordering::SeqCst) {
        return Ok(state.status());
    }
    let outcome = run_check(app, &state);
    state.checking.store(false, Ordering::SeqCst);

    match &outcome {
        Ok(msg) => state.record_result(msg),
        Err(e) => state.record_result(&format!("failed: {e}")),
    }
    let view = state.status();
    let _ = app.emit("ota-status", &view);
    log::info!("OTA check: {}", view.last_result);
    Ok(view)
}

// ============================================================================
// Startup: load installed lists from disk, then run the weekly loop
// ============================================================================

/// Load `<app_data_dir>/lists/` (if present) into the overlay. Every check
/// the network path applies is re-applied here — signature, hashes, shape,
/// whitelist floor — so a tampered-on-disk file set silently falls back to
/// the baked built-ins (fail closed on policy, standing rule J.3).
fn load_installed_from_disk(state: &OtaState) -> Result<Option<u64>, String> {
    let dir = state.lists_dir();
    let manifest_bytes = match std::fs::read(dir.join(MANIFEST_ASSET)) {
        Ok(b) => b,
        Err(_) => return Ok(None), // nothing installed — not an error
    };
    let sig_hex = std::fs::read_to_string(dir.join(MANIFEST_SIG_ASSET))
        .map_err(|e| format!("installed lists have no signature file: {e}"))?;
    verify_sig_any(&manifest_bytes, &sig_hex, &policy::OTA_PUBKEYS_HEX)?;
    let manifest = policy::parse_manifest(&manifest_bytes)?;

    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for (name, entry) in &manifest.files {
        let bytes = std::fs::read(dir.join(name)).map_err(|e| format!("{name}: {e}"))?;
        if bytes.len() as u64 != entry.size || sha256_hex(&bytes) != entry.sha256 {
            return Err(format!("{name}: on-disk content does not match the signed manifest"));
        }
        files.push((name.clone(), bytes));
    }
    let new_lists = assemble_lists(manifest.version, &files)?;
    let version = new_lists.version;
    state.record_installed(version);
    lists::ota::set(new_lists);
    Ok(Some(version))
}

/// Called once from `setup()`: manages `OtaState`, loads any installed lists,
/// and starts the weekly background checker. Never fails the boot.
pub fn init(app: &AppHandle, app_data_dir: &Path) {
    let state = Arc::new(OtaState::load(app_data_dir));
    app.manage(state.clone());

    match load_installed_from_disk(&state) {
        Ok(Some(v)) => log::info!("OTA lists v{v} loaded from disk"),
        Ok(None) => log::info!("no OTA lists installed — using built-ins"),
        Err(e) => log::warn!("installed OTA lists failed verification, using built-ins: {e}"),
    }

    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_WAKE);
        loop {
            let due = {
                let last = state.persist.lock().unwrap().last_check;
                unix_now().saturating_sub(last) >= CHECK_INTERVAL.as_secs()
            };
            if due {
                // check_now records/logs/emits its own outcome.
                let _ = check_now(&app2);
            }
            std::thread::sleep(WAKE_INTERVAL);
        }
    });
}

// ============================================================================
// Pushing fresh lists to the extensions
// ============================================================================

/// After a successful install: refresh `AppState`'s blocklist mirror and push
/// the new lists to every connected extension over the existing bridge,
/// reusing `update_blocklist_domains`/`update_blocklist_keywords`' exact
/// message shape (`{type:"update_blocklist", listType, data}` — handled by
/// native-bridge.js's `handleBlocklistUpdate`). The pushed domain list is
/// built-ins ∪ cached custom domains, so a desktop-side custom block is never
/// dropped by a list refresh.
fn push_lists_to_extensions(app: &AppHandle, domains_vec: &[String], keywords: &[String]) {
    let state = match app.try_state::<Arc<Mutex<crate::AppState>>>() {
        Some(s) => s.inner().clone(),
        None => return,
    };

    let merged: Vec<String> = {
        let mut s = state.lock().unwrap();
        s.blocklists.built_in_domains = domains_vec.to_vec();
        s.blocklists.built_in_keywords = keywords.to_vec();

        let mut merged = domains_vec.to_vec();
        let have: HashSet<&str> = merged.iter().map(|d| d.as_str()).collect();
        let extra: Vec<String> =
            s.custom_domains.iter().filter(|d| !have.contains(d.as_str())).cloned().collect();
        drop(have);
        merged.extend(extra);

        s.blocklists.domains = merged.clone();
        s.blocklists.domain_count = merged.len();
        s.blocklists.keywords = keywords.to_vec();
        s.blocklists.keyword_count = keywords.len();
        merged
    };

    let msg = serde_json::json!({ "type": "update_blocklist", "listType": "domains", "data": merged });
    let n = crate::broadcast_to_extensions(&state, &msg);
    let msg = serde_json::json!({ "type": "update_blocklist", "listType": "keywords", "data": keywords });
    let _ = crate::broadcast_to_extensions(&state, &msg);
    log::info!("OTA lists pushed to {n} connected extension(s)");
}

// ============================================================================
// Tests — pure logic only (no network, no tauri): signature verification
// (including a cross-implementation vector produced by the vendored
// @noble/ed25519 the extension + CI signer use), rollback, whitelist floor.
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn hex(bytes: &[u8]) -> String {
        policy::encode_hex(bytes)
    }

    #[test]
    fn sig_verify_roundtrip_good_and_tampered() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk_hex = hex(sk.verifying_key().as_bytes());
        let msg = br#"{"version":1,"files":{}}"#;
        let sig_hex = hex(&sk.sign(msg).to_bytes());

        assert!(verify_sig_any(msg, &sig_hex, &[&vk_hex]).is_ok());
        // Tampered message → reject.
        assert!(verify_sig_any(br#"{"version":2,"files":{}}"#, &sig_hex, &[&vk_hex]).is_err());
        // Wrong key → reject.
        let other = SigningKey::from_bytes(&[8u8; 32]);
        let other_hex = hex(other.verifying_key().as_bytes());
        assert!(verify_sig_any(msg, &sig_hex, &[&other_hex]).is_err());
        // Either-of-two keys: wrong first, right second → accept.
        assert!(verify_sig_any(msg, &sig_hex, &[&other_hex, &vk_hex]).is_ok());
        // Garbage signature encodings → reject, never panic.
        assert!(verify_sig_any(msg, "zz", &[&vk_hex]).is_err());
        assert!(verify_sig_any(msg, "abcd", &[&vk_hex]).is_err());
    }

    /// Cross-implementation interop pin: this exact signature was produced by
    /// the vendored `extension/bg/noble-ed25519.js` (v1.7.5) from the
    /// all-zero 32-byte seed. If ed25519-dalek ever disagrees with noble about
    /// raw-Ed25519 over these bytes, the whole scheme is broken and this test
    /// says so before a release does.
    #[test]
    fn sig_verify_interop_with_noble_ed25519() {
        let pub_hex = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
        let msg = b"oathlight-ota-interop-fixture-v1";
        let sig_hex = "ee436c3dcfa795d53bffc8322f679298addd609103a438f33a4aed3c0d0e946a61cbf3f34e505ab3fe710b00e75edbd8b8c56359bd7c7d59fa69db9d17b79405";
        assert!(verify_sig_any(msg, sig_hex, &[pub_hex]).is_ok());
        // And the same signature over different bytes must fail.
        assert!(verify_sig_any(b"oathlight-ota-interop-fixture-v2", sig_hex, &[pub_hex]).is_err());
    }

    #[test]
    fn assemble_rejects_whitelist_collision_wholesale() {
        let files = vec![(
            "domains_part1.json".to_string(),
            br#"{"domains":["some-bad-site.example","github.com"]}"#.to_vec(),
        )];
        let err = assemble_lists(1, &files).unwrap_err();
        assert!(err.contains("github.com"), "error must name the collision: {err}");
    }

    #[test]
    fn assemble_rejects_parent_walk_collision() {
        // Blocking "google.com" would block whitelisted docs.google.com by
        // the parent walk — must be rejected even though "docs.google.com"
        // itself never appears in the update.
        let files = vec![(
            "domains_part1.json".to_string(),
            br#"{"domains":["google.com"]}"#.to_vec(),
        )];
        assert!(assemble_lists(1, &files).is_err());
    }

    #[test]
    fn assemble_accepts_clean_lists_and_normalizes() {
        let files = vec![
            (
                "domains_part1.json".to_string(),
                br#"{"domains":["Example-Adult.COM ", "other.example"]}"#.to_vec(),
            ),
            ("keywords.json".to_string(), br#"{"keywords":["BadWord"]}"#.to_vec()),
        ];
        let l = assemble_lists(4, &files).expect("clean update must assemble");
        assert_eq!(l.version, 4);
        assert!(l.domains.contains("example-adult.com"), "lowercased + trimmed");
        assert_eq!(l.keywords, vec!["badword"]);
    }

    #[test]
    fn assemble_rejects_empty_and_malformed() {
        // No domains at all — never replace built-ins with nothing.
        let files = vec![("keywords.json".to_string(), br#"{"keywords":[]}"#.to_vec())];
        assert!(assemble_lists(1, &files).is_err());
        // Bad JSON.
        let files = vec![("domains_part1.json".to_string(), b"not json".to_vec())];
        assert!(assemble_lists(1, &files).is_err());
        // Wrong shape.
        let files = vec![("domains_part1.json".to_string(), br#"{"nope":[]}"#.to_vec())];
        assert!(assemble_lists(1, &files).is_err());
    }
}
