//! src-tauri/src/sidecars.rs — keep `oathlightguard.exe` and
//! `oath-light-host.exe` in step with the app that drives them.
//!
//! ## The bug this exists to close
//!
//! Oath Light is three binaries that speak one protocol: the app, the watchdog
//! guardian, and the browsers' native-messaging host. Nothing versions that
//! protocol, and nothing needs to while the three are always installed
//! together — which the installer is supposed to guarantee and, on an upgrade,
//! does not.
//!
//! Both companions are normally *running* when a new installer arrives. That is
//! not bad luck, it is the design: the guardian resurrects itself and the app
//! (`watchdog.rs`), and the host is respawned by any browser holding the
//! extension. Windows will not overwrite a locked executable, so the file
//! writes for those two can fail while the install as a whole reports success.
//! What is left is a new app driving companions from an older build, silently,
//! with the version on the About screen saying otherwise. `update.rs`'s
//! stand-down window and `kill_native_hosts` make that *less* likely; neither
//! makes it impossible, and an installer's file-copy failing quietly is not a
//! thing to leave a protection resting on.
//!
//! ## The fix: carry them, don't fetch them
//!
//! The app embeds both binaries (`build.rs`) and repairs them on its own at
//! every startup: compare what is on disk against what this build shipped with,
//! and rewrite anything that differs. The main executable is the one file an
//! installer can always replace — it is what gets closed first — so whatever is
//! inside it is by construction exactly as current as the app is.
//!
//! This deliberately does **not** download anything. A companion binary fetched
//! over the network would need a signature scheme, a key rotation story, an
//! anti-rollback floor and an offline fallback, all to solve a problem that has
//! no network in it: the correct bytes were already on this machine, inside a
//! file the installer had no trouble writing. (`ota.rs` does carry all of that
//! machinery — for blocklists, where the whole point is that they change
//! between releases. Executables do not; they change *with* the release.)
//!
//! ## Replacing a file that is in use
//!
//! Windows refuses to delete or overwrite a running image, but it will happily
//! **rename** one — the same trick `scripts/bundle-sidecars.mjs` uses to keep
//! builds from failing. So the replace path is: try the plain write, and on
//! failure move the running file aside to `<name>.old-<n>` and write the new
//! one into the freed path. The displaced process keeps running off its renamed
//! image and is then retired: the host is killed (browsers respawn it against
//! whatever is at the path now) and the guardian is left to the caller, which
//! runs this *before* `watchdog::init_main` so the freshly written one is the
//! one that ever gets spawned.
//!
//! Leftover `.old-*` files are swept on later runs, once their process has
//! exited and the file is deletable.
//!
//! ## When it can't
//!
//! A per-machine install lives in `Program Files`, so an unelevated app cannot
//! write there. That is reported, not worked around — the same posture as the
//! force-install policy and the DNS takeover, and it resolves the same way: the
//! `OathLightElevated` logon task runs the app elevated from then on, and
//! `--elevated-setup` performs a repair pass itself so "grant admin" fixes this
//! in the same UAC prompt as everything else.
//!
//! Writing the companions somewhere user-writable instead (the app data dir,
//! which `resolve_host_binary` already accepts as a last resort) was considered
//! and rejected: it would trade "occasionally needs admin" for "the guardian
//! lives in a directory the user can edit", which is a worse deal for a binary
//! whose entire job is being hard to switch off.

use std::path::{Path, PathBuf};

/// This build's copy of each companion. Empty when the sidecars weren't staged
/// at compile time (`cargo check`, `cargo test`, a dev build that skipped
/// `bundle-sidecars.mjs`) — see `build.rs`.
static GUARDIAN: &[u8] = include_bytes!(env!("OL_GUARDIAN_BIN"));
static HOST: &[u8] = include_bytes!(env!("OL_HOST_BIN"));

const GUARDIAN_NAME: &str = if cfg!(windows) { "oathlightguard.exe" } else { "oathlightguard" };
const HOST_NAME: &str = if cfg!(windows) { "oath-light-host.exe" } else { "oath-light-host" };

/// What one companion needed, decided before anything is touched.
///
/// Split out from the doing so the rule is testable without a filesystem: the
/// interesting part here is *when* a rewrite is warranted, and getting that
/// wrong in either direction is costly — too eager rewrites a healthy install's
/// binaries on every launch, too shy is the bug this module exists for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// Nothing embedded in this build. Never touch what is on disk — a dev
    /// build must not be able to blank out a real install's companions.
    NothingEmbedded,
    /// On-disk bytes already match this build.
    UpToDate,
    /// Missing, truncated, or from another build. Write ours.
    Replace,
}

/// The decision, given what we carry and what (if anything) is on disk.
fn decide(embedded: &[u8], on_disk: Option<&[u8]>) -> Need {
    if embedded.is_empty() {
        return Need::NothingEmbedded;
    }
    match on_disk {
        Some(bytes) if bytes == embedded => Need::UpToDate,
        _ => Need::Replace,
    }
}

/// Outcome of one repair pass, for the log and the event entry.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Report {
    /// Companions rewritten because they were missing or from another build.
    pub replaced: usize,
    /// Companions that could not be written — almost always a per-machine
    /// install plus an unelevated app.
    pub failed: usize,
}

impl Report {
    pub fn changed(&self) -> bool {
        self.replaced > 0
    }
}

/// Bring both companions in line with this build. Safe to call repeatedly;
/// in the steady state it is two file reads and two `memcmp`s.
///
/// **Call this before `watchdog::init_main`.** That is what spawns the
/// guardian, and repairing after it starts would mean the stale one runs for
/// the rest of the session anyway.
pub fn repair() -> Report {
    let Some(dir) = exe_dir() else {
        log::warn!("sidecars: could not resolve our own directory; skipping the repair pass");
        return Report::default();
    };
    let mut report = Report::default();
    // The host first: it is the one that can be freed outright (killing it is
    // free — browsers respawn one on the next connection), so doing it before
    // the guardian keeps the noisier path off the front of the log.
    repair_one(&dir, HOST_NAME, HOST, true, &mut report);
    repair_one(&dir, GUARDIAN_NAME, GUARDIAN, false, &mut report);
    report
}

fn repair_one(dir: &Path, name: &str, embedded: &[u8], kill_first: bool, report: &mut Report) {
    let path = dir.join(name);
    sweep_displaced(dir, name);

    let on_disk = std::fs::read(&path).ok();
    match decide(embedded, on_disk.as_deref()) {
        Need::NothingEmbedded => {
            log::debug!("sidecars: {name} is not embedded in this build; leaving it alone");
        }
        Need::UpToDate => {}
        Need::Replace => {
            let existed = on_disk.is_some();
            match write_replacing(&path, embedded, kill_first) {
                Ok(()) => {
                    report.replaced += 1;
                    if existed {
                        log::warn!(
                            "sidecars: {name} did not match this build and was replaced \
                             (an installer could not overwrite it)"
                        );
                    } else {
                        log::warn!("sidecars: {name} was missing and has been restored");
                    }
                }
                Err(e) => {
                    report.failed += 1;
                    log::warn!("sidecars: could not update {name}: {e}");
                }
            }
        }
    }
}

/// Write `bytes` to `path`, getting a locked file out of the way if needed.
fn write_replacing(path: &Path, bytes: &[u8], kill_first: bool) -> Result<(), String> {
    if kill_first {
        kill_by_name(path);
    }
    let first = match std::fs::write(path, bytes) {
        Ok(()) => return Ok(()),
        Err(e) => e,
    };
    // Locked (or gone read-only). Move the running image aside — Windows allows
    // renaming an executable that is in use — and write into the freed path.
    let Some(aside) = displace(path) else {
        // The rename was refused too, so this is not a lock: a write we are not
        // allowed to make, which on a per-machine install means no elevation.
        return Err(format!("{first} (a per-machine install needs administrator rights)"));
    };
    log::info!("sidecars: {} was in use; moved aside to {}", path.display(), aside.display());
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Rename a file out of the way. Returns where it went, or `None` if even the
/// rename was refused.
fn displace(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let dir = path.parent()?;
    // A counter rather than a timestamp: two repairs inside the same second
    // must not collide, and the sweep matches on the prefix either way.
    for n in 0..64u32 {
        let aside = dir.join(format!("{name}.old-{n}"));
        if aside.exists() {
            continue;
        }
        if std::fs::rename(path, &aside).is_ok() {
            return Some(aside);
        }
    }
    None
}

/// Delete `<name>.old-*` leftovers whose process has since exited. One that is
/// still running simply fails to delete and is left for a later pass.
fn sweep_displaced(dir: &Path, name: &str) {
    let prefix = format!("{name}.old-");
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let file = entry.file_name();
        let file = file.to_string_lossy();
        if file.starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// End any process running the binary at `path`, so the file unlocks.
///
/// Only ever used for the native host: it is owned by the browsers rather than
/// by us, costs nothing to kill (the next connection respawns one against
/// whatever binary is at the path by then), and is the single most likely thing
/// to be holding a lock during an upgrade. The guardian is deliberately NOT
/// killed here — `repair` runs before the watchdog starts, so there is nothing
/// of ours to kill, and killing a guardian that belongs to a *different*
/// running instance is not this function's call to make.
#[cfg(target_os = "windows")]
fn kill_by_name(path: &Path) {
    use std::os::windows::process::CommandExt;
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else { return };
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", &name, "/T"])
        .creation_flags(0x0800_0000)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn kill_by_name(_path: &Path) {}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The dev-build case, and the one with the worst failure mode: a build
    /// with no staged sidecars must never conclude that a real install's
    /// companions are wrong and overwrite them with nothing.
    #[test]
    fn a_build_carrying_nothing_never_touches_the_disk() {
        assert_eq!(decide(&[], None), Need::NothingEmbedded);
        assert_eq!(decide(&[], Some(&[1, 2, 3])), Need::NothingEmbedded);
    }

    #[test]
    fn identical_bytes_are_left_alone() {
        assert_eq!(decide(&[1, 2, 3], Some(&[1, 2, 3])), Need::UpToDate);
    }

    /// The bug: an installer that could not overwrite a locked companion leaves
    /// an older build's bytes sitting there.
    #[test]
    fn a_companion_from_another_build_is_replaced() {
        assert_eq!(decide(&[1, 2, 3], Some(&[1, 2, 4])), Need::Replace);
        assert_eq!(decide(&[1, 2, 3], Some(&[1, 2])), Need::Replace, "truncated counts too");
    }

    #[test]
    fn a_missing_companion_is_restored() {
        assert_eq!(decide(&[1, 2, 3], None), Need::Replace);
    }

    /// `changed()` drives whether the caller logs an event, so an all-quiet
    /// pass has to read as quiet.
    #[test]
    fn a_clean_pass_reports_no_change() {
        assert!(!Report::default().changed());
        assert!(Report { replaced: 1, failed: 0 }.changed());
        assert!(
            !Report { replaced: 0, failed: 1 }.changed(),
            "a failed write changed nothing — it must not read as an update"
        );
    }

    /// End to end against a real directory: a stale file is rewritten, a
    /// matching one is left untouched, and a displaced leftover is swept.
    #[test]
    fn repair_one_rewrites_only_what_differs() {
        let dir = std::env::temp_dir().join(format!("ol-sidecars-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let name = "companion.bin";
        let path = dir.join(name);

        // Missing -> restored.
        let mut r = Report::default();
        repair_one(&dir, name, &[9, 9, 9], false, &mut r);
        assert_eq!(r.replaced, 1);
        assert_eq!(std::fs::read(&path).unwrap(), vec![9, 9, 9]);

        // Matching -> untouched.
        let mut r = Report::default();
        repair_one(&dir, name, &[9, 9, 9], false, &mut r);
        assert_eq!(r, Report::default());

        // Stale -> rewritten.
        let mut r = Report::default();
        repair_one(&dir, name, &[7], false, &mut r);
        assert_eq!(r.replaced, 1);
        assert_eq!(std::fs::read(&path).unwrap(), vec![7]);

        // A leftover from an earlier displaced copy is swept on the next pass.
        std::fs::write(dir.join(format!("{name}.old-0")), b"stale").unwrap();
        let mut r = Report::default();
        repair_one(&dir, name, &[7], false, &mut r);
        assert!(!dir.join(format!("{name}.old-0")).exists(), "leftovers must not accumulate");
        assert_eq!(r, Report::default());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
