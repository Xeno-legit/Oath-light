//! Uninstall CLI modes — the gate the Windows uninstaller goes through.
//!
//! # Why this module exists
//!
//! Before it, `uninstall.exe` was a **parallel removal path that never consulted
//! the friction system**. The 24-hour cool-off in `uninstall.rs` guarded exactly
//! one door — the in-app "Remove Oath Light" button — while Settings → Apps →
//! Uninstall walked straight past it. That is not a theoretical hole; it is the
//! one an ordinary person hits first, because it is the only removal path
//! Windows advertises.
//!
//! Worse than being unguarded, it *half-succeeded*. The generated `installer.nsi`
//! opens its uninstall section with
//! `CheckIfAppIsRunning "${MAINBINARYNAME}.exe"` — which knows nothing about
//! `oathlightguard.exe`. So the uninstaller killed the main app, the guardian
//! resurrected it a second later, and the resurrected app re-registered its Run
//! key and browser policies. Meanwhile NSIS's `Delete` calls against the
//! now-relocked executables failed *silently* (`Delete` sets an error flag that
//! nothing checks), while `Delete "$INSTDIR\uninstall.exe"` and
//! `DeleteRegKey ... ${UNINSTKEY}` — which nothing held open — succeeded.
//!
//! The result was the worst of the three possible outcomes:
//!
//! | Outcome | Verdict |
//! | :-- | :-- |
//! | Refuse, touch nothing | protection working as designed |
//! | Remove completely | the feature working as designed |
//! | Remove the uninstaller, keep the app | **no supported removal path left** |
//!
//! An install in that third state cannot be removed by any means the product
//! offers. That is the bug this module closes, and the principle it enforces is
//! the one the old code lacked: **the uninstaller is all-or-nothing.** It either
//! refuses and touches nothing, or it completes fully — including every piece of
//! machine state Tauri's template knows nothing about.
//!
//! # Upgrades go through the same door
//!
//! Installing a newer build over an existing one runs the *old* `uninstall.exe`
//! first (generated `installer.nsi` → `PageLeaveReinstall` → `reinst_uninstall`,
//! which is the default choice on the reinstall page). That is a removal by
//! every signal the gate can see, and gating it naively turns "update Oath
//! Light" into "you cannot update Oath Light".
//!
//! The tempting fix — honor the installer's `/UPDATE` flag — is not one. It
//! would make `uninstall.exe /UPDATE` a complete bypass of the cool-off, gated
//! on nothing but knowing the flag, and knowledge barriers are finished (see
//! `docs/HARDENING.md`). The flag is also not actually passed on the path that
//! matters: `un.onInit` only sets `$UpdateMode` when the *parent installer* was
//! itself launched with `/UPDATE`, and in that case `PageLeaveReinstall` skips
//! the old uninstaller entirely.
//!
//! What authorizes an upgrade instead is an **active update window**
//! (`update.json`) — which the user opens from inside the app, behind the master
//! password, bounded to one minute, re-validated on every read, recorded in
//! the event log, and backed by a recovery task. That is not an extra hurdle
//! invented here: an upgrade *already* requires one, because both binaries are
//! running and locked until the watchdog stands down, and the update window is
//! the only thing that stands it down. See [`Decision::Upgrade`].
//!
//! # The three modes
//!
//! * `--uninstall-check` — decide, and say so in the exit code. Changes nothing
//!   about the install, with one honest exception noted on [`decide`].
//! * `--uninstall-teardown` — reverse everything this app did to the machine.
//!   Refuses on anything but a genuine removal; an upgrade must keep the
//!   machine state it is upgrading.
//!
//! Both accept an optional `--app-data <path>`; the NSIS hook passes the
//! installing user's directory explicitly, because the uninstaller runs elevated
//! and `%APPDATA%` under an elevated token can resolve to a different profile
//! than the one that actually holds the friction state.
//!
//! Keeping the *decision* in Rust and the *enforcement* in NSIS is deliberate:
//! `friction::FrictionStore` stays the single source of truth for whether a
//! cool-off has elapsed, and the installer never re-implements that reasoning in
//! a language with no clock arithmetic. The guardian's hand-rolled JSON scanner
//! already showed what duplicating that logic costs.

use std::path::{Path, PathBuf};

/// Friction action id for the uninstall request. MUST match the id `lib.rs`
/// files the request under (`friction.get("uninstall")`).
const UNINSTALL_ACTION: &str = "uninstall";

/// The Tauri app identifier (`tauri.conf.json` → `identifier`), used to rebuild
/// the app-data path when `--app-data` was not passed. Mirrors
/// `uninstall::APP_IDENTIFIER`.
const APP_IDENTIFIER: &str = "com.oathlight.desktop";

// ---- Exit codes -------------------------------------------------------------
//
// These are a contract with `installer/hooks.nsh`. Do not renumber them without
// changing the hook in the same commit.

/// Removal is authorized — the cool-off elapsed (or the app already completed
/// its own removal flow and is driving `uninstall.exe /S` itself).
pub const EXIT_ALLOW: i32 = 0;
/// Removal is NOT authorized. The uninstaller must abort without touching
/// anything at all.
pub const EXIT_BLOCK: i32 = 1;
/// The friction state could not be consulted. See [`Decision::Unknown`] for why
/// this deliberately resolves to "allow".
pub const EXIT_UNKNOWN: i32 = 2;
/// An update window is open: delete the files, keep the machine state. See
/// [`Decision::Upgrade`].
pub const EXIT_UPGRADE: i32 = 3;

/// What the uninstaller should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Cool-off elapsed: proceed with a full removal.
    Allow,
    /// A cool-off is pending, or no removal was ever requested. Abort and send
    /// the user to the app.
    Block,
    /// No readable friction state — no app-data directory at all.
    ///
    /// This resolves to **allow**, and that is a deliberate, stated trade-off
    /// rather than an oversight. Refusing here would mean an install whose
    /// app-data directory is missing or corrupt can never be removed by any
    /// supported path — which is precisely the trap this module exists to
    /// eliminate. Choosing "block" would trade a hole a determined user can
    /// already walk through (they can hand-edit `uninstall.json`; see
    /// `uninstall::cooloff_elapsed_at`'s residual-weakness note) for a state
    /// where a *broken* install is permanently unremovable. That is a bad
    /// trade: it punishes the person whose install broke, and barely
    /// inconveniences the person deliberately routing around the timer.
    ///
    /// The friction bar is unchanged by this: deleting your app-data directory
    /// destroys your settings, streak, and hash-chained event log, which is a
    /// far louder and more deliberate act than clicking Uninstall.
    Unknown,
    /// An update window is open (`update::window_active_at`): this is a new
    /// version being installed over an old one, not a removal.
    ///
    /// The uninstaller may delete the files — it has to, or nothing can ever be
    /// upgraded — but **nothing else comes off**. No teardown, no policy sweep,
    /// no autostart removal, no friction reset, no app data. Everything the new
    /// install is about to re-adopt stays exactly where it is, and the one
    /// minute between the two halves is covered by the recovery task
    /// `begin_update` armed.
    ///
    /// ## Why an update window, and not the `/UPDATE` flag
    ///
    /// A flag is a knowledge barrier, and `uninstall.exe /UPDATE` would be a
    /// one-word bypass of the entire cool-off. An update window is a capability:
    /// only the app writes one, only behind the master password, only for
    /// one minute, and `update::active` re-checks that cap on read — so
    /// hand-editing `update.json` buys the same one minute the button would
    /// have given away anyway.
    ///
    /// It is also not an extra hurdle. An upgrade cannot physically succeed
    /// without one: `app.exe` and `oathlightguard.exe` are running and locked,
    /// and the dual-process watchdog resurrects whichever half is killed. The
    /// update window is the only thing that stands both halves down. Anyone
    /// already able to complete an upgrade already has one open.
    ///
    /// And a window cannot linger: `setup()` consumes it on every startup
    /// (`update::clear` + `cancel_recovery`), so one is only ever live while the
    /// app is *down* — which is exactly the state an upgrade runs in, and is why
    /// this decision does not need its own expiry logic on top of
    /// `update::active`.
    ///
    /// ## What this costs, stated plainly
    ///
    /// Someone with the master password can open a window and then run the
    /// uninstaller instead of an installer, which deletes the three binaries.
    /// They cannot clear browser policy, DNS state, autostart or friction state
    /// that way — those survive, and the recovery task fires at the expiry. They
    /// also already had a shorter route: the same password, plus a day.
    Upgrade,
}

impl Decision {
    /// The process exit code the NSIS hook reads.
    pub fn exit_code(self) -> i32 {
        match self {
            Decision::Allow => EXIT_ALLOW,
            Decision::Block => EXIT_BLOCK,
            Decision::Unknown => EXIT_UNKNOWN,
            Decision::Upgrade => EXIT_UPGRADE,
        }
    }

    /// True if the uninstaller may proceed to delete files.
    pub fn may_proceed(self) -> bool {
        !matches!(self, Decision::Block)
    }

    /// True if this removal should also reverse the app's machine state.
    ///
    /// Distinct from [`may_proceed`](Self::may_proceed) on exactly one variant,
    /// and that variant is the whole point: an upgrade deletes files and keeps
    /// everything else, because a new install is about to inherit it.
    pub fn tears_down(self) -> bool {
        matches!(self, Decision::Allow | Decision::Unknown)
    }
}

/// Whether an elapsed removal request is on file.
///
/// Order of authority, most to least:
///
/// 1. `friction.json` via [`friction::FrictionStore`] — the source of truth,
///    and the only reader that accounts for the uptime-counted cool-off
///    (`credited_secs`) rather than naive wall-clock subtraction. When it holds
///    a request at all, its answer is final: a request that is present and not
///    ready must not be second-guessed by the mirror file.
/// 2. `uninstall.json` via `uninstall::cooloff_elapsed_at` — the mirrored
///    marker, consulted only when the friction store holds no request at all.
///    This is what lets a request filed by an older build still be honored,
///    and it is the same file the watchdog and guardian verify against.
fn removal_authorized(app_data_dir: &Path) -> bool {
    let store = crate::friction::FrictionStore::load(app_data_dir);
    match store.get(UNINSTALL_ACTION) {
        Some(pending) => pending.ready,
        None => crate::uninstall::cooloff_elapsed_at(&app_data_dir.join("uninstall.json")),
    }
}

/// Decide what the uninstaller may do, from the state on disk.
///
/// Three questions, in this order, and the order is load-bearing:
///
/// 1. **Is there app data at all?** No → [`Decision::Unknown`]. A broken install
///    must stay removable.
/// 2. **Did the user ask to remove this, and wait?** Yes → [`Decision::Allow`],
///    a full teardown. This is checked *before* the update window, so someone
///    who filed a removal, waited out the day, and happens to also have a window
///    open gets the removal they asked for rather than a files-only upgrade.
/// 3. **Is an update window open?** Yes → [`Decision::Upgrade`]. Files come off,
///    nothing else does.
///
/// Otherwise [`Decision::Block`] — and note that a *missing* request blocks
/// rather than reading as `Unknown`. An app-data directory that exists and
/// simply holds no pending removal is the normal state of a healthy install; it
/// means the user clicked Uninstall in Settings without ever asking the app,
/// which is exactly the case the cool-off is for.
///
/// ## The one thing this writes
///
/// "Check touches nothing" is very nearly true and worth stating exactly, in a
/// change whose entire purpose is to stop claiming protections it doesn't have.
/// `FrictionStore::load` migrates a legacy `uninstall.json` request into
/// `friction.json` when it finds one, and that migration saves. So a check run
/// on an install that still carries a pre-friction-store pending request will
/// write that one file, once. It cannot change the decision (both paths read
/// the same `requested_at`), it is idempotent, and nothing about the install is
/// altered — but it is a write, and the alternative is re-implementing
/// `advance`'s uptime-credited clock arithmetic here, which is the duplication
/// this module was built to avoid.
///
/// The credit accounting itself does *not* persist: `FrictionStore::get`
/// advances in memory only.
pub fn decide(app_data_dir: &Path) -> Decision {
    if !app_data_dir.is_dir() {
        return Decision::Unknown;
    }
    if removal_authorized(app_data_dir) {
        return Decision::Allow;
    }
    if crate::update::window_active_at(&crate::update::path_in(app_data_dir)) {
        return Decision::Upgrade;
    }
    Decision::Block
}

/// Reverse everything Oath Light did to this machine, so the NSIS uninstaller
/// only has to delete files it already knows about.
///
/// Everything here is best-effort and none of it is allowed to fail the
/// removal: by the time this runs the decision to remove has already been made,
/// and a teardown step that refuses would recreate the half-state this module
/// exists to prevent. Anything that does not come off here is swept again by
/// `NSIS_HOOK_POSTUNINSTALL`.
///
/// Deliberately NOT done here: deleting `uninstall.json`. In a release build
/// both watchdog halves only honor the shutdown sentinel while that file still
/// shows an *elapsed* request (see `watchdog::shutdown_requested` and the
/// guardian's `cooloff_elapsed`). Removing it mid-teardown would make both
/// processes refuse to stand down and resurrect each other straight through the
/// uninstall — the exact trap documented in `perform_uninstall`. The hook
/// removes it at the very end instead, once the binaries are gone.
#[cfg(target_os = "windows")]
pub fn teardown(app_data_dir: &Path) {
    clog(&format!("teardown starting; app_data={}", app_data_dir.display()));

    // Seed the path the sentinel must carry BEFORE authorizing shutdown. This
    // process is a fresh invocation of the exe, so `UNINSTALL_JSON_PATH` is an
    // unset `OnceLock` — and `request_shutdown()` would otherwise write an
    // EMPTY sentinel, which every release-build reader default-denies. The
    // watchdog would then never stand down and would resurrect the app while
    // NSIS was deleting it, reproducing the original bug from the other side.
    crate::watchdog::set_uninstall_json_path(app_data_dir.join("uninstall.json"));
    crate::watchdog::request_shutdown();
    clog("shutdown sentinel written (watchdog + guardian will stand down)");

    // Login autostart: both registrations, or an uninstalled app comes back at
    // the next logon through whichever one was missed — which reads as malware,
    // not tamper-resistance.
    crate::watchdog::unregister_autostart();
    clog("autostart entries removed (Run key + logon task)");

    // System DNS: restore the captured upstreams before the resolver stops
    // existing, so removal never leaves the machine without working DNS.
    match oathlight_dns::takeover::restore(&app_data_dir.join("dns.json")) {
        Ok(()) => clog("DNS restored from dns.json"),
        Err(e) => clog(&format!("DNS restore skipped/failed (non-fatal): {e}")),
    }

    // Browser policy + native messaging hosts. Without this the browser keeps
    // force-installing the extension and incognito stays disabled after the app
    // is gone — leftover policy is the most user-visible way an uninstall can
    // "not really" uninstall.
    for def in crate::browsers::BROWSERS {
        crate::browsers::remove_policy(def);
    }
    crate::browsers::unregister_all_hosts();
    clog("browser policies + native host registrations cleared");

    // The elevated logon task, if one was ever created.
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("schtasks")
            .args(["/Delete", "/TN", "OathLightElevated", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    // Add/Remove Programs entries. NSIS removes its own; this also catches the
    // WOW6432Node mirror and a stale HKCU entry from an earlier per-user install.
    crate::remove_uninstall_registry_entries();

    clog("teardown complete");
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app_data_dir: &Path) {}

/// Append a line to `%TEMP%\oathlight-uninstall.log`.
///
/// This runs in a windowless (GUI-subsystem) process launched by an installer,
/// so there is no console to print to and `log` is not initialized this early.
/// A removal that goes wrong is exactly the situation where a user needs a
/// record of what happened, and it is the one situation where the app's own
/// data directory may already be gone — so this deliberately lives in TEMP,
/// alongside `oathlight-watchdog.log`.
fn clog(msg: &str) {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("{ms} uninstall-cli pid {} {msg}\n", std::process::id());
    let path = std::env::temp_dir().join("oathlight-uninstall.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Resolve the app-data directory: an explicit `--app-data <path>` if the
/// caller passed one, else `%APPDATA%\<identifier>` — the same layout Tauri's
/// `app_data_dir()` produces.
///
/// The hook passes it explicitly because the uninstaller runs elevated, and
/// `%APPDATA%` read from an elevated token can name a different profile than
/// the user whose friction state actually governs this decision.
fn resolve_app_data(args: &[String]) -> Option<PathBuf> {
    if let Some(i) = args.iter().position(|a| a == "--app-data") {
        if let Some(p) = args.get(i + 1) {
            if !p.trim().is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(APP_IDENTIFIER))
}

/// Handle an uninstall CLI mode if one was requested.
///
/// Returns `Some(exit_code)` when this process was a CLI invocation and the
/// caller must exit immediately with that code, or `None` for a normal app
/// launch. Called at the very top of `run()`, before the watchdog takes its
/// mutex or Tauri builds anything — this process must never register as the
/// "main" role or it would fight the very app it is tearing down.
pub fn dispatch() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();

    let is_check = args.iter().any(|a| a == "--uninstall-check");
    let is_teardown = args.iter().any(|a| a == "--uninstall-teardown");
    if !is_check && !is_teardown {
        return None;
    }

    let Some(app_data) = resolve_app_data(&args) else {
        // Cannot even name the app-data directory. Same reasoning as
        // `Decision::Unknown`: never leave an install unremovable.
        clog("could not resolve app-data dir; reporting UNKNOWN");
        return Some(EXIT_UNKNOWN);
    };

    if is_check {
        let decision = decide(&app_data);
        // Spell out the consequence, not just the verdict. This log gets read
        // after a removal has gone wrong, by someone who does not have the
        // exit-code table in front of them — "Block" alone doesn't tell them
        // whether their machine was left half-uninstalled.
        clog(&format!(
            "check: app_data={} -> {:?} (exit {}); uninstaller will {}",
            app_data.display(),
            decision,
            decision.exit_code(),
            match (decision.may_proceed(), decision.tears_down()) {
                (false, _) => "STOP, changing nothing",
                (true, true) => "remove everything",
                (true, false) => "delete files only, keeping machine state (upgrade)",
            }
        ));
        return Some(decision.exit_code());
    }

    // Teardown. Re-check rather than trusting the caller: the hook runs the
    // check first, but this mode is reachable directly and must not be a way to
    // strip the machine's protections without the cool-off.
    //
    // `tears_down`, not `may_proceed`: an upgrade is allowed to proceed and is
    // NOT allowed to tear anything down. Reporting the decision's own exit code
    // back keeps the two modes in agreement, so a hook that called teardown on
    // an upgrade by mistake learns that it did rather than being told "done".
    let decision = decide(&app_data);
    if !decision.tears_down() {
        clog(&format!("teardown REFUSED: {decision:?}"));
        return Some(decision.exit_code());
    }
    teardown(&app_data);
    Some(EXIT_ALLOW)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn now_secs() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("oathlight-cli-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// The case that broke a real machine: a healthy install, no removal ever
    /// requested, user clicks Uninstall in Settings. Must refuse.
    #[test]
    fn healthy_install_with_no_request_is_blocked() {
        let d = tmpdir("norequest");
        assert_eq!(decide(&d), Decision::Block);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A pending-but-not-elapsed request must not be completable through the
    /// Windows uninstaller — that would make the cool-off decorative.
    #[test]
    fn pending_cooloff_is_blocked() {
        let d = tmpdir("pending");
        std::fs::write(
            d.join("uninstall.json"),
            format!(r#"{{"requested_at": {}}}"#, now_secs()),
        )
        .unwrap();
        assert_eq!(decide(&d), Decision::Block);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// An elapsed request is what the whole flow is for: allow it, so the app's
    /// own `uninstall.exe /S` call in the self-delete worker still works.
    #[test]
    fn elapsed_cooloff_is_allowed() {
        let d = tmpdir("elapsed");
        let long_ago = now_secs().saturating_sub(crate::uninstall::delay_secs() + 60);
        std::fs::write(
            d.join("uninstall.json"),
            format!(r#"{{"requested_at": {long_ago}}}"#),
        )
        .unwrap();
        assert_eq!(decide(&d), Decision::Allow);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A missing app-data dir means a broken install. It must stay removable —
    /// see `Decision::Unknown`. Blocking here is what creates an install that
    /// nothing can uninstall.
    #[test]
    fn missing_app_data_is_unknown_and_may_proceed() {
        let d = std::env::temp_dir().join("oathlight-cli-test-definitely-absent");
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(decide(&d), Decision::Unknown);
        assert!(Decision::Unknown.may_proceed());
    }

    /// Only `Block` stops the uninstaller.
    #[test]
    fn only_block_stops_removal() {
        assert!(Decision::Allow.may_proceed());
        assert!(Decision::Unknown.may_proceed());
        assert!(Decision::Upgrade.may_proceed());
        assert!(!Decision::Block.may_proceed());
    }

    /// The upgrade path's entire safety rests on this: it may delete files and
    /// may not touch anything else. If `tears_down` ever returns true here, an
    /// update becomes a silent full removal of every protection.
    #[test]
    fn only_a_real_removal_tears_down() {
        assert!(Decision::Allow.tears_down());
        assert!(Decision::Unknown.tears_down());
        assert!(!Decision::Upgrade.tears_down(), "an upgrade must keep machine state");
        assert!(!Decision::Block.tears_down());
    }

    /// The exit codes are a contract with `installer/hooks.nsh`. If this test
    /// is edited, the hook must change in the same commit.
    #[test]
    fn exit_codes_match_the_nsis_contract() {
        assert_eq!(Decision::Allow.exit_code(), 0);
        assert_eq!(Decision::Block.exit_code(), 1);
        assert_eq!(Decision::Unknown.exit_code(), 2);
        assert_eq!(Decision::Upgrade.exit_code(), 3);
    }

    /// The upgrade regression this variant exists for: a healthy install with
    /// no removal request, being replaced by a newer build. Without the update
    /// window it is indistinguishable from Settings -> Uninstall and blocks,
    /// which means the app can never be updated again.
    #[test]
    fn an_open_update_window_authorizes_an_upgrade() {
        let d = tmpdir("upgrade");
        assert_eq!(decide(&d), Decision::Block, "no window yet");
        crate::update::open(&d, "0.5.0").unwrap();
        assert_eq!(decide(&d), Decision::Upgrade);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A window that is not live authorizes nothing — including a forged one,
    /// since `update::active` re-applies the duration cap on read. Without this,
    /// one hand-edit of `update.json` would be a permanent uninstall bypass.
    #[test]
    fn an_inactive_or_forged_window_does_not_authorize_an_upgrade() {
        let d = tmpdir("upgrade-stale");

        // Expired.
        let past = now_secs().saturating_sub(crate::update::WINDOW_SECS * 2);
        std::fs::write(
            d.join("update.json"),
            format!(r#"{{"opened_at":{past},"expires_at":{}}}"#, past + 60),
        )
        .unwrap();
        assert_eq!(decide(&d), Decision::Block, "an expired window is not a window");

        // Forged: a year long, so it never has to be reopened.
        let now = now_secs();
        std::fs::write(
            d.join("update.json"),
            format!(r#"{{"opened_at":{now},"expires_at":{}}}"#, now + 365 * 24 * 3600),
        )
        .unwrap();
        assert_eq!(decide(&d), Decision::Block, "the read-side cap must reject this");

        let _ = std::fs::remove_dir_all(&d);
    }

    /// Both at once: the user filed a removal, waited out the day, and also has
    /// a window open. They asked to remove, so they get a removal — a full
    /// teardown, not a files-only upgrade that would leave policy and DNS
    /// behind on a machine with no app left to manage them.
    #[test]
    fn an_elapsed_removal_outranks_an_open_update_window() {
        let d = tmpdir("upgrade-vs-removal");
        let long_ago = now_secs().saturating_sub(crate::uninstall::delay_secs() + 60);
        std::fs::write(
            d.join("uninstall.json"),
            format!(r#"{{"requested_at": {long_ago}}}"#),
        )
        .unwrap();
        crate::update::open(&d, "0.5.0").unwrap();
        assert_eq!(decide(&d), Decision::Allow);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// A pending (not yet elapsed) removal request must survive an upgrade
    /// rather than being completed by one — otherwise "file a removal, then
    /// update" is a way to skip the rest of the wait.
    #[test]
    fn a_pending_removal_plus_a_window_is_still_only_an_upgrade() {
        let d = tmpdir("upgrade-vs-pending");
        std::fs::write(
            d.join("uninstall.json"),
            format!(r#"{{"requested_at": {}}}"#, now_secs()),
        )
        .unwrap();
        crate::update::open(&d, "0.5.0").unwrap();
        let decision = decide(&d);
        assert_eq!(decision, Decision::Upgrade);
        assert!(!decision.tears_down());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// `--app-data` must win over the ambient `%APPDATA%`, because the elevated
    /// uninstaller's environment may name a different profile entirely.
    #[test]
    fn explicit_app_data_arg_wins() {
        let args: Vec<String> = vec![
            "OathLight.exe".into(),
            "--uninstall-check".into(),
            "--app-data".into(),
            r"C:\Users\someone\AppData\Roaming\com.oathlight.desktop".into(),
        ];
        assert_eq!(
            resolve_app_data(&args).unwrap(),
            PathBuf::from(r"C:\Users\someone\AppData\Roaming\com.oathlight.desktop")
        );
    }

    /// A `--app-data` with no value must not silently resolve to an empty path
    /// (which would be a directory that never exists -> Unknown -> allow).
    #[test]
    fn dangling_app_data_arg_falls_back() {
        let args: Vec<String> = vec!["OathLight.exe".into(), "--app-data".into()];
        let resolved = resolve_app_data(&args);
        assert_ne!(resolved, Some(PathBuf::new()));
    }
}
