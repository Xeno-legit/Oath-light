//! Update mode — a bounded, self-closing window during which the tamper
//! guards stand aside so an installer can actually replace the binaries.
//!
//! ## The problem
//! Everything that makes Oath Light hard to remove also makes it hard to
//! UPDATE. Running the new installer over a live install hits a wall built out
//! of the app's own defenses:
//!
//!   * `OathLight.exe` and `oathlightguard.exe` are both running, so Windows
//!     holds their files open and the installer cannot overwrite them;
//!   * killing them doesn't help — that is precisely what the dual-process
//!     watchdog exists to undo, and each side resurrects the other within a
//!     second (`watchdog.rs` / `guardian/src/main.rs`);
//!   * the one existing stand-down path, the shutdown sentinel, is only
//!     honored in a release build once the 24-hour *uninstall* cool-off has
//!     elapsed. That gate is correct for uninstalling and useless for
//!     updating: nobody should have to file an uninstall request and wait a
//!     day to install a patch.
//!
//! So the honest options were "ship no updates" or "tell people to fight their
//! own blocker for twenty minutes". This module is the third one.
//!
//! ## The shape of the answer
//! An update window is a small file, `<app_data_dir>/update.json`, that says
//! "between these two timestamps, standing down is authorized." Both watchdog
//! processes read it independently — the same protocol the uninstall cool-off
//! already uses — and while it is active neither resurrects the other, so both
//! can exit and both binaries unlock.
//!
//! Three properties keep that from being a hole in the product:
//!
//!   1. **It is short.** `WINDOW_SECS` is fifteen minutes. Long enough for an
//!      installer and a UAC prompt; far too short to be a way to get an
//!      afternoon off.
//!   2. **It closes itself.** The window is defined by an expiry, not by a
//!      flag someone has to remember to unset, and `window_active_at` re-checks
//!      the duration cap on every read (see below). Nothing has to succeed for
//!      protection to come back.
//!   3. **Something brings the app back.** Standing the watchdog down means
//!      both processes exit, and if the update then never happens there is
//!      nothing left running to notice. So `begin_update` also schedules a
//!      one-shot Windows task at the expiry time that relaunches the app. If
//!      the update succeeds, the new install cancels that task on first run;
//!      if it doesn't, the task fires and everything is back. The worst case
//!      is fifteen unprotected minutes, once, on purpose.
//!
//! Only the *resurrection* guards stand down. Nothing here touches the
//! blocklists, the browser policies, the extension enforcement or the uninstall
//! friction — an update window is not a "turn Oath Light off" switch, and the
//! blocking that survives the app being closed keeps surviving it.
//!
//! ## Tamper posture
//! `update.json` is plain user-writable JSON, like `uninstall.json`, and the
//! module treats it with the same honesty: this is friction, not security. The
//! duration cap is enforced when the file is READ, not just when it is written,
//! which is the part that matters. Hand-editing `expires_at` to next year does
//! nothing — a window is only honored while
//! `opened_at <= now < expires_at <= opened_at + WINDOW_SECS`, so the longest
//! forgery anyone gets from one edit is the same fifteen minutes the button
//! would have given them. Holding it open indefinitely means rewriting the file
//! every quarter hour, forever, which is a strictly worse deal than the
//! 24-hour uninstall path that already exists and is meant to be used.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How long an update window lasts. See the module doc — this is the number
/// that bounds the whole feature's blast radius, so it is deliberately one
/// constant with one meaning, checked on write AND on every read.
pub const WINDOW_SECS: u64 = 15 * 60;

/// Name of the one-shot recovery task that relaunches the app when a window
/// expires without the update having happened. Registered by `begin_update`,
/// deleted on the next successful start. Distinct from `OathLight Autostart`
/// (the login task) and `OathLightElevated` (the policy-writing task) so
/// clearing one never disturbs the others.
pub const RECOVERY_TASK_NAME: &str = "OathLight Update Recovery";

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// On-disk shape of `<app_data_dir>/update.json`.
///
/// MUST stay readable by the guardian's hand-rolled scanner
/// (`guardian/src/main.rs`), which carries no JSON dependency by design and
/// pulls `opened_at` / `expires_at` out by string scanning. Adding fields is
/// safe; renaming or nesting these two is not.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWindow {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Unix seconds the window was opened.
    #[serde(default)]
    pub opened_at: u64,
    /// Unix seconds it stops being honored.
    #[serde(default)]
    pub expires_at: u64,
    /// The app version that opened it — recorded so the log of what happened
    /// reads sensibly after the binary has been replaced.
    #[serde(default)]
    pub from_version: String,
}

fn default_version() -> u32 {
    1
}

/// `<app_data_dir>/update.json`. A sibling of `uninstall.json` and `dns.json`,
/// which is how the guardian locates it from the paths it already knows.
pub fn path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("update.json")
}

/// Read the window at `path`, if any. Absent/corrupt reads as `None` — a
/// broken file must never authorize a stand-down, and must never block a
/// startup either.
pub fn read_at(path: &Path) -> Option<UpdateWindow> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<UpdateWindow>(&s).ok())
}

/// Whether the file at `path` authorizes a stand-down *right now*.
///
/// This is the single predicate both watchdog sides call, and the counterpart
/// to `uninstall::cooloff_elapsed_at`. The duration cap is re-applied here
/// rather than trusted from write time — see the tamper note in the module
/// doc; that re-check is the reason hand-editing the expiry buys nothing.
pub fn window_active_at(path: &Path) -> bool {
    let Some(w) = read_at(path) else { return false };
    active(&w, now_secs())
}

/// The predicate itself, factored out so it can be unit-tested against a fixed
/// clock. All three clauses matter:
///   * `opened_at <= now` — a window cannot be pre-dated into the future to
///     make `expires_at` look reachable while the cap still passes;
///   * `now < expires_at` — it is live;
///   * `expires_at - opened_at <= WINDOW_SECS` — it is no longer than one
///     legitimately-issued window, however the file came to say otherwise.
fn active(w: &UpdateWindow, now: u64) -> bool {
    w.opened_at <= now
        && now < w.expires_at
        && w.expires_at.saturating_sub(w.opened_at) <= WINDOW_SECS
}

/// Seconds left on an active window; `0` when none is active.
pub fn seconds_left_at(path: &Path, now: u64) -> u64 {
    match read_at(path) {
        Some(w) if active(&w, now) => w.expires_at.saturating_sub(now),
        _ => 0,
    }
}

/// Open a window and write it to disk. Returns the window so the caller can
/// report the expiry it actually got rather than re-deriving it.
pub fn open(app_data_dir: &Path, from_version: &str) -> Result<UpdateWindow, String> {
    let now = now_secs();
    let w = UpdateWindow {
        version: 1,
        opened_at: now,
        expires_at: now + WINDOW_SECS,
        from_version: from_version.to_string(),
    };
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("could not create the app data directory: {e}"))?;
    let json = serde_json::to_string_pretty(&w)
        .map_err(|e| format!("could not encode the update window: {e}"))?;
    std::fs::write(path_in(app_data_dir), json)
        .map_err(|e| format!("could not write update.json: {e}"))?;
    Ok(w)
}

/// Close any window. Idempotent, and safe to call when none exists — which is
/// the common case, since this runs on every startup.
pub fn clear(app_data_dir: &Path) {
    let _ = std::fs::remove_file(path_in(app_data_dir));
}

// ============================================================================
// The one-shot recovery task (Windows)
// ============================================================================

/// Register a one-shot scheduled task that relaunches the app at `at_unix`.
///
/// This is what makes the stand-down safe to hand to a user: without it,
/// "prepare for update" and "quietly close the blocker until next login" would
/// be the same button. Best-effort by design — task creation can fail
/// (locked-down policy, no permission) and a failure must not block the update
/// itself; the caller reports it honestly rather than pretending the recovery
/// is armed.
///
/// Registered from a task-definition XML rather than the much shorter
/// `/SC ONCE /ST <time> /SD <date>` form, for two reasons:
///
///   * **Locale.** `/SD` is parsed in the machine's own short-date format, so a
///     hardcoded `MM/DD/YYYY` is wrong on most of the planet — and wrong in the
///     worst way, since `05/03` is a valid date in both readings and would
///     silently schedule the recovery two months out instead of failing.
///     `StartBoundary` is ISO 8601 and means one thing everywhere.
///   * **Sleep.** `StartWhenAvailable` makes the task fire on resume if the
///     machine was asleep or off at the appointed minute. Without it, closing
///     the lid during an update window is enough to leave the app down until
///     the next login — which is exactly the gap this task exists to close.
#[cfg(target_os = "windows")]
pub fn schedule_recovery(exe: &Path, at_unix: u64) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let start = local_iso8601(at_unix)?;
    let xml = task_xml(exe, &start);

    // schtasks reads the definition from a file, not stdin. UTF-16LE with a BOM
    // is the encoding its own exports use and the one it parses most reliably.
    let xml_path = std::env::temp_dir().join("oathlight-update-recovery.xml");
    let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    {
        let mut f = std::fs::File::create(&xml_path)
            .map_err(|e| format!("could not write the recovery task definition: {e}"))?;
        f.write_all(&bytes)
            .map_err(|e| format!("could not write the recovery task definition: {e}"))?;
    }

    let out = std::process::Command::new("schtasks")
        .args(["/Create", "/F", "/TN", RECOVERY_TASK_NAME, "/XML"])
        .arg(&xml_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("could not run schtasks: {e}"))?;

    // The definition carries no secrets, but there is no reason to leave it
    // lying in %TEMP% either.
    let _ = std::fs::remove_file(&xml_path);

    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        })
    }
}

/// The task definition. `--autostart` so the recovered instance comes up hidden
/// in the tray rather than throwing a window at whatever the user is doing by
/// then; `InteractiveToken` + `LeastPrivilege` so registering it needs no
/// elevation, matching the login autostart task in `watchdog.rs`.
#[cfg(target_os = "windows")]
fn task_xml(exe: &Path, start_boundary: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Restarts Oath Light if an update window expires without the update being installed.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>{start}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{cmd}</Command>
      <Arguments>--autostart</Arguments>
    </Exec>
  </Actions>
</Task>"#,
        start = start_boundary,
        cmd = xml_escape(&exe.display().to_string()),
    )
}

/// Minimal XML text escaping for the one interpolated value (a filesystem
/// path). `&` and `<` are the two that can break the document; the others are
/// escaped for good measure since a path can legally contain them.
#[cfg(target_os = "windows")]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Delete the recovery task. Called on every startup (the update either
/// happened or was abandoned, and either way a fresh instance is running now)
/// and by `cancel_update`. Silent when the task does not exist.
#[cfg(target_os = "windows")]
pub fn cancel_recovery() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("schtasks")
        .args(["/Delete", "/TN", RECOVERY_TASK_NAME, "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

/// Format `at_unix` as a local-time ISO 8601 `StartBoundary`.
///
/// Delegated to PowerShell rather than done here because the app carries no
/// date dependency by design (see `recovery.rs`, which computes day indices by
/// hand for the same reason) and local time means resolving the machine's zone
/// and its DST rules for that instant — the one part of date handling it is
/// genuinely unwise to improvise.
///
/// `InvariantCulture` is passed explicitly and is not decoration: `ToString`
/// formats through the *current culture's calendar*, so on a machine set to,
/// say, the Thai Buddhist or Hijri calendar, `yyyy` yields a year Task
/// Scheduler will reject outright. Pinning the culture makes the output mean
/// the same thing on every machine, which is the whole reason for moving off
/// `/SD` in the first place.
#[cfg(target_os = "windows")]
fn local_iso8601(at_unix: u64) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let script = format!(
        "[DateTimeOffset]::FromUnixTimeSeconds({at_unix}).LocalDateTime\
         .ToString('yyyy-MM-ddTHH:mm:ss',[System.Globalization.CultureInfo]::InvariantCulture)"
    );
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("could not format the recovery time: {e}"))?;

    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Cheap sanity check on the shape before it goes into the XML — a blank or
    // mangled boundary would otherwise surface as an opaque schtasks error.
    if text.len() == 19 && text.as_bytes()[10] == b'T' {
        Ok(text)
    } else {
        Err(format!("could not format the recovery time (got {text:?})"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn schedule_recovery(_exe: &Path, _at_unix: u64) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn cancel_recovery() {}

// ============================================================================
// Tests — the predicate, which is the whole security surface of this module.
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn w(opened_at: u64, expires_at: u64) -> UpdateWindow {
        UpdateWindow { version: 1, opened_at, expires_at, from_version: "0.1.0".into() }
    }

    #[test]
    fn a_freshly_opened_window_is_active_and_expires_on_time() {
        let now = 1_000_000;
        let win = w(now, now + WINDOW_SECS);
        assert!(active(&win, now));
        assert!(active(&win, now + WINDOW_SECS - 1));
        assert!(!active(&win, now + WINDOW_SECS), "expiry is exclusive");
        assert!(!active(&win, now + WINDOW_SECS + 1));
    }

    /// The tamper case this module exists to be honest about: the duration cap
    /// is re-applied on READ, so hand-editing the expiry buys nothing.
    #[test]
    fn an_over_long_window_is_rejected_however_it_got_written() {
        let now = 1_000_000;
        let forged = w(now, now + 365 * 24 * 60 * 60);
        assert!(!active(&forged, now), "a year-long window must not be honored");

        // One second over the cap is still over the cap — no tolerance band.
        let barely = w(now, now + WINDOW_SECS + 1);
        assert!(!active(&barely, now));
    }

    /// The other half of the forgery: pre-dating `opened_at` into the future so
    /// the duration cap passes while the window stretches past `now`.
    #[test]
    fn a_future_dated_window_is_rejected() {
        let now = 1_000_000;
        let future = w(now + 10_000, now + 10_000 + WINDOW_SECS);
        assert!(!active(&future, now));
    }

    #[test]
    fn a_zero_or_backwards_window_is_never_active() {
        let now = 1_000_000;
        assert!(!active(&w(now, now), now), "zero-length");
        assert!(!active(&w(now, now - 60), now), "expiry before it opened");
        assert!(!active(&w(0, 0), now), "an all-defaults file authorizes nothing");
    }

    #[test]
    fn round_trips_through_disk_and_clears() {
        let d = std::env::temp_dir().join(format!("ol-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();

        assert!(!window_active_at(&path_in(&d)), "no file — no window");

        let win = open(&d, "0.1.0").expect("open must write the window");
        assert_eq!(win.expires_at - win.opened_at, WINDOW_SECS);
        assert!(window_active_at(&path_in(&d)));
        assert!(seconds_left_at(&path_in(&d), now_secs()) > 0);

        clear(&d);
        assert!(!window_active_at(&path_in(&d)), "cleared — no window");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_corrupt_file_authorizes_nothing() {
        let d = std::env::temp_dir().join(format!("ol-update-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(path_in(&d), "{ not json").unwrap();
        assert!(!window_active_at(&path_in(&d)));
        let _ = std::fs::remove_dir_all(&d);
    }
}
