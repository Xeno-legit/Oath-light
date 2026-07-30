//! src-tauri/src/browser_lock.rs — keep a browser that cannot be force-installed
//! shut until it is actually carrying the extension.
//!
//! **Why this exists.** Every Chromium in the table is pinned by
//! `ExtensionInstallForcelist`: remove the extension and the browser puts it
//! back by itself. Edge is the exception, and not for a reason we can fix in
//! code — Microsoft only force-installs from the Edge Add-ons store on a machine
//! that isn't domain/Entra-joined, so on an ordinary consumer PC our policy is
//! accepted and silently discarded (see `browsers::EDGE_STORE_EXTENSION_ID`).
//! The external-extensions registry gets the extension *installed* there, but it
//! is explicitly not a lock: Chromium leaves an externally-registered extension
//! switched off until the user approves it once, and the user can remove it
//! afterwards. So Edge is the one browser where "protected" is entirely the
//! user's choice, on a machine where the whole point is that it shouldn't be.
//!
//! This module closes that gap the only way left: if the extension is not
//! running in Edge, Edge does not run either. The browser is killed on sight,
//! and the way back is a deliberate trip to Oath Light for a short, supervised
//! window in which to complete the install.
//!
//! **What it is NOT.** This never touches a browser we can force-install
//! (`browsers::requires_manual_install` is the gate), because those already fix
//! themselves and killing one would *prevent* the reinstall it needs to run to
//! perform. It is off by default, turning it on is instant, and turning it off
//! is a friction-gated weakening like every other protection here.
//!
//! ## The grace window
//!
//! The recovery flow has a hard constraint: **the browser must be running for
//! the extension to install.** Chromium's external-registry loader only fetches
//! on launch, and the approval prompt only exists inside the browser. A rule of
//! "kill Edge whenever the extension is missing" is therefore self-defeating on
//! its own — it kills the process during the exact seconds that would have fixed
//! it. `request_restore` is the escape: it re-asserts the registration, then
//! opens a window during which the kill is suspended.
//!
//! `GRACE_WINDOW` is 20 seconds and **does not extend for any reason**. It is
//! deliberately tight: a window long enough to be comfortable is a window long
//! enough to browse in. If 20s isn't enough to finish the install, the answer is
//! to ask for another one — which costs another deliberate trip to the app, and
//! that friction is the point. Nothing about being "nearly done" buys more time.
//!
//! ## The one exemption: a machine with no other browser
//!
//! Bricking the only browser on a computer doesn't produce a protected user, it
//! produces a user who cannot reach anything at all — including the page they
//! would need in order to install a second browser, or this app's own help. That
//! is not strictness, it is a machine with no way out.
//!
//! So the lock stands down, completely, when no *other* browser is installed
//! (`BrowserFacts::sole_browser`). This is not a softening of the rule and it
//! cannot be used as one: installing literally any second browser — every one of
//! which we CAN force-install and pin — removes the exemption and Edge is
//! bricked from that moment on. The escape hatch is "go get a real browser",
//! which is the outcome we wanted anyway.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long a restore request suspends the kill for. Hard: see the module doc
/// for why this never extends.
pub const GRACE_WINDOW: Duration = Duration::from_secs(20);

/// Monotonic milliseconds since the first call. `Instant` is the right clock
/// here (a 20s window must not be defeatable by moving the system clock, which
/// is the same reasoning `friction.rs` documents at length), but `Instant` is
/// awkward to construct in a test — so the decision logic below works in plain
/// `u64` millis off this baseline and can be exercised at any point in time
/// without sleeping.
fn monotonic_ms() -> u64 {
    static BASE: OnceLock<Instant> = OnceLock::new();
    BASE.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// What the monitor should do with this browser's processes right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockDecision {
    /// Leave it alone — either it is carrying the extension, or it is inside a
    /// grace window it was granted on purpose.
    Allow,
    /// Kill every process of this browser.
    Kill,
}

/// One outstanding restore window. Monotonic ms at which it closes — there is
/// nothing else to track, because a window never changes after it is granted.
#[derive(Debug, Clone, Copy)]
struct Grant {
    expires_ms: u64,
}

/// The live browser-lock state: which browsers currently hold a restore window.
/// Managed by Tauri; the monitor reads it every tick and the restore command
/// writes it.
#[derive(Default)]
pub struct BrowserLockState {
    grants: Mutex<HashMap<String, Grant>>,
}

/// Everything the decision needs to know about one browser this tick. Grouped
/// into a struct because three loose `bool`s at a call site is how you end up
/// passing them in the wrong order.
#[derive(Debug, Clone, Copy)]
pub struct BrowserFacts {
    /// The extension is present AND enabled in every profile we can read. Not
    /// "in at least one": a second profile without it is a fully usable
    /// unprotected browser, which is the thing this module exists to prevent.
    pub protected: bool,
    /// We could actually read this browser's profiles. False means the prefs
    /// were unreadable, which is *not* evidence of anything and must never be
    /// treated as "unprotected" — killing on a failed read would brick a browser
    /// because a file was locked.
    pub ground_truth: bool,
    /// No other browser is installed on this machine, so bricking this one
    /// leaves the user with no way to reach anything. The lock stands down
    /// entirely — see the module doc. Installing any second browser ends it.
    pub sole_browser: bool,
}

impl BrowserLockState {
    /// Open (or restart) a grace window for `key`. Returns the seconds the
    /// caller should show on the countdown.
    ///
    /// A second request simply starts a fresh 20s rather than adding to what is
    /// left — asking again is always allowed, and always costs another
    /// deliberate trip to the app. That is the only way to get more time.
    pub fn grant(&self, key: &str) -> u64 {
        let now = monotonic_ms();
        self.grants
            .lock()
            .unwrap()
            .insert(key.to_string(), Grant { expires_ms: now + GRACE_WINDOW.as_millis() as u64 });
        GRACE_WINDOW.as_secs()
    }

    /// Seconds left on `key`'s window, or 0 when there is none. For the UI's
    /// countdown only — never for the kill decision, which uses `decide` so that
    /// reading the window and consuming an extension stay one operation.
    pub fn remaining_secs(&self, key: &str) -> u64 {
        let now = monotonic_ms();
        self.grants
            .lock()
            .unwrap()
            .get(key)
            .map(|g| g.expires_ms.saturating_sub(now).div_ceil(1000))
            .unwrap_or(0)
    }

    /// Drop every window. (There is deliberately no single-browser `clear`:
    /// retiring one window is always a consequence of `decide` seeing the
    /// browser become protected or the window run out, never something a caller
    /// decides on its own.)
    pub fn clear_all(&self) {
        self.grants.lock().unwrap().clear();
    }

    /// The decision for one browser this tick.
    ///
    /// Retires a spent window as it goes, so "expired" is observed exactly once
    /// rather than by every subsequent tick.
    pub fn decide(&self, key: &str, facts: BrowserFacts) -> LockDecision {
        // Bricking the only browser on the machine leaves no way to reach
        // anything — including whatever the user would need to fix it. Stand
        // down completely; installing any second browser ends this.
        if facts.sole_browser {
            self.grants.lock().unwrap().remove(key);
            return LockDecision::Allow;
        }
        // No usable read of the profiles → no evidence → never kill. A locked
        // prefs file must not be able to brick a browser.
        if !facts.ground_truth {
            return LockDecision::Allow;
        }
        if facts.protected {
            // Nothing to supervise any more; a leftover window would otherwise
            // keep granting a free pass after the extension was removed again.
            self.grants.lock().unwrap().remove(key);
            return LockDecision::Allow;
        }

        let now = monotonic_ms();
        let mut grants = self.grants.lock().unwrap();
        let Some(grant) = grants.get(key) else {
            return LockDecision::Kill;
        };
        if now < grant.expires_ms {
            return LockDecision::Allow;
        }
        // Spent. There is no extension for any reason — ask again if you need
        // more time.
        grants.remove(key);
        LockDecision::Kill
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ordinary case: a machine with other browsers on it, prefs readable.
    fn facts(protected: bool) -> BrowserFacts {
        BrowserFacts { protected, ground_truth: true, sole_browser: false }
    }

    /// Force the window to have already closed, without sleeping.
    fn expire(st: &BrowserLockState, key: &str) {
        st.grants.lock().unwrap().get_mut(key).unwrap().expires_ms = 0;
    }

    /// The steady state, and the whole point of the module.
    #[test]
    fn an_unprotected_browser_with_no_window_is_killed() {
        let st = BrowserLockState::default();
        assert_eq!(st.decide("edge", facts(false)), LockDecision::Kill);
    }

    #[test]
    fn a_protected_browser_is_always_allowed() {
        let st = BrowserLockState::default();
        assert_eq!(st.decide("edge", facts(true)), LockDecision::Allow);
    }

    /// Unreadable prefs are not evidence. This is the difference between a
    /// blocker and a browser that randomly dies because a file was locked.
    #[test]
    fn no_ground_truth_never_kills() {
        let st = BrowserLockState::default();
        let blind =
            BrowserFacts { protected: false, ground_truth: false, sole_browser: false };
        assert_eq!(st.decide("edge", blind), LockDecision::Allow);
    }

    /// The one exemption. Bricking the only browser on the machine leaves the
    /// user unable to reach anything at all — including a second browser.
    #[test]
    fn the_only_browser_on_the_machine_is_never_bricked() {
        let st = BrowserLockState::default();
        let sole = BrowserFacts { protected: false, ground_truth: true, sole_browser: true };
        assert_eq!(st.decide("edge", sole), LockDecision::Allow);
    }

    /// …and it is an exemption, not a loophole: the moment a second browser
    /// exists, the same unprotected Edge is bricked.
    #[test]
    fn installing_a_second_browser_ends_the_exemption() {
        let st = BrowserLockState::default();
        let sole = BrowserFacts { protected: false, ground_truth: true, sole_browser: true };
        assert_eq!(st.decide("edge", sole), LockDecision::Allow);
        assert_eq!(
            st.decide("edge", facts(false)),
            LockDecision::Kill,
            "sole_browser is the only thing that was holding the lock off"
        );
    }

    #[test]
    fn a_fresh_window_allows_the_browser_to_run() {
        let st = BrowserLockState::default();
        assert_eq!(st.grant("edge"), GRACE_WINDOW.as_secs());
        assert_eq!(st.decide("edge", facts(false)), LockDecision::Allow);
        assert!(st.remaining_secs("edge") > 0);
    }

    /// 20 seconds is 20 seconds. Nothing buys more.
    #[test]
    fn an_expired_window_always_kills() {
        let st = BrowserLockState::default();
        st.grant("edge");
        expire(&st, "edge");
        assert_eq!(st.decide("edge", facts(false)), LockDecision::Kill);
        assert_eq!(st.remaining_secs("edge"), 0, "a spent window must not linger");
    }

    /// Asking again is the *only* way to get more time, and it costs another
    /// deliberate trip to the app rather than topping up what was left.
    #[test]
    fn a_second_request_starts_a_whole_new_window() {
        let st = BrowserLockState::default();
        st.grant("edge");
        expire(&st, "edge");
        assert_eq!(st.decide("edge", facts(false)), LockDecision::Kill);
        assert_eq!(st.grant("edge"), GRACE_WINDOW.as_secs());
        assert_eq!(st.decide("edge", facts(false)), LockDecision::Allow);
    }

    /// Becoming protected has to retire the window, or removing the extension
    /// again inside the original 20s would be silently forgiven.
    #[test]
    fn success_retires_the_window() {
        let st = BrowserLockState::default();
        st.grant("edge");
        assert_eq!(st.decide("edge", facts(true)), LockDecision::Allow);
        assert_eq!(st.remaining_secs("edge"), 0);
        assert_eq!(
            st.decide("edge", facts(false)),
            LockDecision::Kill,
            "the extension came back out — the old window must not still be covering it"
        );
    }

    /// Windows are per browser; granting one must not unlock anything else.
    #[test]
    fn a_window_covers_only_the_browser_it_was_granted_for() {
        let st = BrowserLockState::default();
        st.grant("edge");
        assert_eq!(st.decide("brave", facts(false)), LockDecision::Kill);
    }
}
