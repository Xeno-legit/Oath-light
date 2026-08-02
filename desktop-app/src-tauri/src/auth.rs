//! Master password (Phase 4 item 4.2) — an optional Argon2id-hashed password
//! that, once set, must be presented before any *weakening* request is even
//! registered by the backend. This is enforced here in Rust, not in the
//! webview: [`require_auth`] is the one gate every weakening command calls
//! (`request_uninstall`, `set_guard_enabled`'s off path, `stop_nsfw_monitor`,
//! `remove_custom_domain` — see lib.rs), and a renderer that skipped its own
//! prompt (or was tampered with) still can't get past it. Same house rule as
//! the release no-op `stop_watchdog` in lib.rs: the webview is never a trust
//! boundary.
//!
//! Setting/changing the password is instant (a strengthening or neutral
//! change — same asymmetry as every other friction rule in this codebase).
//! REMOVING it is the one weakening this module has any part in gating, and it
//! has two routes with two different prices — see [`PASSWORD_REMOVE`] and
//! [`PASSWORD_REMOVE_FORGOTTEN`]. Either way a lockout is recovered by *waiting
//! out the delay*, not by some backdoor, and the pending removal sits in
//! Settings -> Pending changes the entire time so a stronger-willed future self
//! can still cancel it.
//!
//! Sessions are short-lived (5 minutes) and held only in memory — a token is
//! never persisted to disk and never logged, and neither is the password
//! itself, anywhere.
//!
//! Fail-closed rule for the on-disk file: a MISSING or CORRUPT `auth.json`
//! is treated as "no password set", never as "every weakening is refused
//! forever". `auth.json` is plain user-writable JSON living in the app data
//! dir — same "residual, accepted weakness" reasoning as `uninstall.rs`'s
//! `cooloff_elapsed_at`: this module is friction, not security. A user who
//! can already edit their own app-data files can already delete the file to
//! clear the password outright; refusing to boot back up from a corrupt one
//! would just brick every other weakening forever for no real security gain.

/// Friction action id for removing the password **with the current password
/// proved** (`request_password_removal`). Ordinary weakening cool-off.
pub const PASSWORD_REMOVE: &str = "password.remove";

/// Friction action id for the "I forgot it" route
/// (`request_password_removal_forgotten`), which asks for nothing at all.
///
/// It is a **separate id purely so it can cost more time** — every other
/// weakening in the app is gated by either the password or by already having
/// proved something, and this is the single path that is reachable by anyone
/// who can click a button on an unlocked machine. At the shared id it inherited
/// the ordinary 24h cool-off, which meant a moment of someone else's access (or
/// your own, at 2am, having decided not to remember) started the same clock as a
/// deliberate, authenticated removal. `friction::delay_for` now charges this one
/// the longest wait the app has.
///
/// The two ids are otherwise interchangeable: the applier in lib.rs treats
/// either as "remove the password file", and `set_master_password` cancels both,
/// so re-setting a password still withdraws a pending removal of either kind.
pub const PASSWORD_REMOVE_FORGOTTEN: &str = "password.remove.forgotten";

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// How long a minted session token stays valid after a successful
/// `verify()`. Kept short (5 minutes) because a token is the only thing
/// standing between "the webview says a weakening was authorized" and it
/// actually being applied — see `require_auth`. The renderer's own cache
/// (`PPAuth` in tauri-bridge.jsx) uses a slightly shorter TTL (4 minutes) so
/// it always re-prompts before the backend would reject it anyway.
const SESSION_TTL: Duration = Duration::from_secs(5 * 60);

/// Minimum spacing between password-verification attempts. Small on
/// purpose — this is a deterrent against a tight scripted brute-force loop,
/// not real rate limiting; a human re-typing a password every second isn't
/// meaningfully slowed down by it.
const MIN_ATTEMPT_GAP: Duration = Duration::from_secs(1);

const MIN_PASSWORD_LEN: usize = 6;

/// On-disk shape of `<app_data_dir>/auth.json`. Never holds the password
/// itself — `hash` is an Argon2id PHC string (algorithm + params + salt +
/// hash, all self-describing, nothing else needed to verify against it).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthFile {
    hash: String,
}

/// Shared implementation behind both `AuthState::read_hash` and the
/// standalone `password_is_set` below — one place that defines "missing",
/// "corrupt JSON", and "empty hash" as the same "no password" outcome (see
/// the fail-closed rule in the module doc).
fn read_hash_at(path: &Path) -> Option<String> {
    let s = std::fs::read_to_string(path).ok()?;
    let f: AuthFile = serde_json::from_str(&s).ok()?;
    if f.hash.is_empty() {
        None
    } else {
        Some(f.hash)
    }
}

/// Owner of the master-password hash file and every live session token.
/// Cheap to construct (`load` just remembers the app data dir — the hash
/// itself is read off disk fresh on every check, so a password
/// set/changed/removed from a *different* running instance, or by hand,
/// takes effect immediately without needing to be told).
pub struct AuthState {
    app_data_dir: PathBuf,
    /// token (hex-encoded random bytes) -> expiry. Never written to disk.
    sessions: Mutex<HashMap<String, Instant>>,
    /// Timestamp of the last verification attempt (success or failure) —
    /// see `MIN_ATTEMPT_GAP`.
    last_attempt: Mutex<Option<Instant>>,
    /// Running count of failed verification attempts this process lifetime.
    /// Never persisted, never used to lock anything out — purely a counter
    /// for the log line in `verify_only` so item 4.5's (not yet built)
    /// hash-chained event log has a number to key off once it exists.
    failed_attempts: Mutex<u64>,
}

impl AuthState {
    pub fn load(app_data_dir: &Path) -> Self {
        Self {
            app_data_dir: app_data_dir.to_path_buf(),
            sessions: Mutex::new(HashMap::new()),
            last_attempt: Mutex::new(None),
            failed_attempts: Mutex::new(0),
        }
    }

    fn auth_path(&self) -> PathBuf {
        self.app_data_dir.join("auth.json")
    }

    /// Read the stored PHC hash off disk. `None` for "file missing", "file
    /// isn't valid JSON", or "hash field is empty" — all three collapse to
    /// the same "no password set" outcome everywhere this is called, per
    /// the fail-closed rule in the module doc above.
    fn read_hash(&self) -> Option<String> {
        read_hash_at(&self.auth_path())
    }

    fn write_hash(&self, hash: &str) -> Result<(), String> {
        let _ = std::fs::create_dir_all(&self.app_data_dir);
        let json = serde_json::to_string_pretty(&AuthFile { hash: hash.to_string() })
            .map_err(|e| e.to_string())?;
        std::fs::write(self.auth_path(), json).map_err(|e| e.to_string())
    }

    /// Whether a master password is currently configured.
    pub fn password_set(&self) -> bool {
        self.read_hash().is_some()
    }

    /// Minimum spacing between attempts (see `MIN_ATTEMPT_GAP`). Records the
    /// attempt timestamp on every call that gets past the check — including
    /// ones that go on to fail the actual password comparison — so a tight
    /// retry loop can't get more than one comparison per second regardless
    /// of outcome.
    fn check_rate_limit(&self) -> Result<(), String> {
        let mut last = self.last_attempt.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < MIN_ATTEMPT_GAP {
                return Err("Try again in a moment.".to_string());
            }
        }
        *last = Some(Instant::now());
        Ok(())
    }

    /// Verify a password against the stored hash, rate-limited, WITHOUT
    /// minting a session token. This is the primitive both `verify` (which
    /// additionally mints a token) and `set_password`'s "current password"
    /// check (which deliberately does not — changing a password shouldn't
    /// also hand out a weakening-authorization token as a side effect) build
    /// on.
    pub fn verify_only(&self, password: &str) -> Result<(), String> {
        self.check_rate_limit()?;
        let stored = self.read_hash().ok_or_else(|| "No master password is set.".to_string())?;
        let parsed = PasswordHash::new(&stored).map_err(|e| {
            log::warn!("auth: stored hash is corrupt/unparseable: {e}");
            "Wrong password.".to_string()
        })?;
        match Argon2::default().verify_password(password.as_bytes(), &parsed) {
            Ok(()) => Ok(()),
            Err(_) => {
                // Never log the password itself — only that an attempt was
                // made and failed, plus a running count. Item 4.5's event
                // log is the intended long-term consumer of this line.
                let count = {
                    let mut n = self.failed_attempts.lock().unwrap();
                    *n += 1;
                    *n
                };
                log::warn!("auth: failed master-password attempt (#{count} this session)");
                Err("Wrong password.".to_string())
            }
        }
    }

    /// Verify a password and, on success, mint a short-lived session token
    /// (32 random bytes, hex-encoded) that `require_auth` will accept for
    /// `SESSION_TTL`. This is what a weakening command's caller presents
    /// back as `auth` — see `require_auth`.
    pub fn verify(&self, password: &str) -> Result<String, String> {
        self.verify_only(password)?;
        let mut buf = [0u8; 32];
        OsRng.fill_bytes(&mut buf);
        let token: String = buf.iter().map(|b| format!("{b:02x}")).collect();
        self.sessions.lock().unwrap().insert(token.clone(), Instant::now() + SESSION_TTL);
        Ok(token)
    }

    /// Whether `token` is a live (unexpired) session. Sweeps expired
    /// sessions out of the map opportunistically on every call — cheap
    /// (this map only ever holds as many entries as there are recent
    /// prompts) and means the map never grows unbounded over a long-running
    /// session just because a token was minted and never re-checked.
    pub fn check_token(&self, token: &str) -> bool {
        let mut sessions = self.sessions.lock().unwrap();
        let now = Instant::now();
        sessions.retain(|_, exp| *exp > now);
        sessions.contains_key(token)
    }

    /// Set or change the master password. If one is already set, `current`
    /// must verify (a direct hash check via `verify_only` — NOT a token; see
    /// that method's doc comment for why this deliberately doesn't mint
    /// one). Setting/changing takes effect immediately: it's a strengthening
    /// (first time) or a neutral change (changing an existing one), neither
    /// of which this codebase ever gates behind a delay.
    pub fn set_password(&self, current: Option<&str>, new: &str) -> Result<(), String> {
        if self.password_set() {
            match current {
                Some(pw) => self.verify_only(pw)?,
                None => return Err("Current password required.".to_string()),
            }
        }
        if new.len() < MIN_PASSWORD_LEN {
            return Err(format!("Password must be at least {MIN_PASSWORD_LEN} characters."));
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(new.as_bytes(), &salt)
            .map_err(|e| {
                log::warn!("auth: hash_password failed: {e}");
                "Could not set the password.".to_string()
            })?
            .to_string();
        self.write_hash(&hash)
    }

    /// Delete `auth.json` and drop every live session. Called by the
    /// friction applier thread (lib.rs) once a `"password.remove"` weakening
    /// request's delay has elapsed — this is the actual "apply" step; the
    /// request itself (`request_password_removal` in lib.rs) only starts the
    /// countdown. A missing file is not an error here — removal is
    /// idempotent, same as every other friction applier arm.
    pub fn remove_password_file(&self) {
        let _ = std::fs::remove_file(self.auth_path());
        self.sessions.lock().unwrap().clear();
    }
}

/// The one gate every weakening command calls: `Ok(())` if no master
/// password is set, or if `token` is a live session token. `Err` otherwise,
/// with a message the renderer can show as-is.
///
/// Enforced here in Rust — UI gating alone is decoration (the webview is not
/// a trust boundary, see the module doc). `app.try_state` (not `state`,
/// which would panic) so this degrades to "no password configured" rather
/// than crashing in the unlikely case `AuthState` isn't managed yet when a
/// command runs.
pub fn require_auth(app: &tauri::AppHandle, token: &Option<String>) -> Result<(), String> {
    let Some(state) = app.try_state::<std::sync::Arc<AuthState>>() else {
        return Ok(());
    };
    if !state.password_set() {
        return Ok(());
    }
    match token {
        Some(t) if state.check_token(t) => Ok(()),
        _ => Err("This change requires your master password.".to_string()),
    }
}
