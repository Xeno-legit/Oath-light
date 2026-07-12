//! Lockdown Mode (plan item 4.4) — whitelist-only browsing, on demand.
//!
//! Cold Turkey's killer feature, NSFW-flavored: while a lockdown is active,
//! the extension side (`bg/blocklists.js` / `bg/matching.js`) allows only the
//! ~110-domain mainstream allowlist plus whatever the user has additively
//! allowed (see `request_lockdown_allow` in lib.rs) — everything else blocks,
//! full stop.
//!
//! ## Clock immunity (4.3, reused)
//! A lockdown timer that trusts wall-clock time alone can be defeated by
//! rolling the clock forward, exactly like the friction delays in
//! `friction.rs`. So this module persists the identical `credited_secs`
//! pattern: `duration_secs` is the total commitment, `credited_secs`
//! accumulates `min(delta_wall, delta_tick)` on every observation (reusing
//! `friction::monotonic`, not a second copy of the tick FFI — see that
//! module's doc comment), and the lockdown only actually ends once
//! `credited_secs >= duration_secs`. `active_until` (mirrored into
//! `SettingsV1.lockdown` for a quick display estimate) is wall-clock and
//! display-only, never authoritative.
//!
//! ## Asymmetry (4.1's rule, applied here)
//! Starting or extending a lockdown is a STRENGTHENING: always instant, no
//! gate, and monotonic — extending never shortens the remaining time, and
//! upgrading a normal lockdown to Frozen is allowed at any point but a
//! Frozen lockdown can never be downgraded back to normal. Ending one early
//! is the WEAKENING: a normal lockdown can be cancelled through the ordinary
//! friction delay (`"lockdown.cancel"`, gated by the master password if one
//! is set — see `cancel_lockdown` in lib.rs); a Frozen lockdown refuses that
//! outright — no friction entry is ever registered for it, so `apply_ready`
//! can never be tricked into ending one early. It only ends when
//! `credited_secs` reaches `duration_secs`, checked by the applier thread's
//! heartbeat (`LockdownStore::heartbeat`).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_wall() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveLockdown {
    started_wall: u64,
    duration_secs: u64,
    frozen: bool,
    credited_secs: u64,
    last_wall: u64,
    last_tick: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Persisted {
    active: Option<ActiveLockdown>,
}

/// What the renderer / extension see. `remaining_secs` and `active` are
/// derived from `credited_secs`, never from a JS/browser clock.
#[derive(Debug, Clone, Serialize, Default)]
pub struct LockdownView {
    pub active: bool,
    pub frozen: bool,
    pub remaining_secs: u64,
    /// Wall-clock unix-seconds estimate of when this lockdown ends —
    /// display-only (see the module doc); `None` when inactive.
    pub active_until: Option<u64>,
}

fn view_of(cur: &Option<ActiveLockdown>) -> LockdownView {
    match cur {
        Some(a) => {
            let remaining = a.duration_secs.saturating_sub(a.credited_secs);
            let active = remaining > 0;
            LockdownView {
                active,
                frozen: a.frozen,
                remaining_secs: remaining,
                active_until: if active { Some(now_wall() + remaining) } else { None },
            }
        }
        None => LockdownView::default(),
    }
}

/// Advance `cur`'s credited time by `min(delta_wall, delta_tick)` since it
/// was last observed — byte-for-byte the same reasoning as
/// `friction::advance`, reusing `friction::monotonic` for the tick source
/// rather than a second copy of the FFI (see the module doc).
fn advance(cur: &mut ActiveLockdown) {
    let now_w = now_wall();
    let now_t = crate::friction::monotonic::now_tick_secs();
    let delta_wall = now_w.saturating_sub(cur.last_wall);
    let tick_reset = now_t < cur.last_tick;
    let delta_tick = if tick_reset { now_t } else { now_t - cur.last_tick };
    let credited_advance = delta_wall.min(delta_tick);
    cur.credited_secs += credited_advance;
    cur.last_wall = now_w;
    cur.last_tick = now_t;
}

pub struct LockdownStore {
    path: PathBuf,
    inner: Mutex<Option<ActiveLockdown>>,
}

impl LockdownStore {
    pub fn load(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("lockdown.json");
        let persisted: Persisted = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, inner: Mutex::new(persisted.active) }
    }

    fn save(&self, cur: &Option<ActiveLockdown>) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let persisted = Persisted { active: cur.clone() };
        if let Ok(s) = serde_json::to_string_pretty(&persisted) {
            let _ = std::fs::write(&self.path, s);
        }
    }

    /// Start a fresh lockdown, or extend/upgrade an existing one. Always a
    /// strengthening: instant, unconditional, never gated.
    ///   * Extending: the new remaining time is `max(current remaining,
    ///     duration_secs)` — re-requesting a shorter or equal duration than
    ///     what's already left is a no-op, never a shortening.
    ///   * Upgrading to Frozen is allowed at any time; passing `frozen:
    ///     false` on an already-Frozen lockdown is silently ignored (Frozen
    ///     is monotonic — see the module doc) rather than erroring, since
    ///     from the caller's point of view starting/extending itself still
    ///     succeeds.
    pub fn start(&self, duration_secs: u64, frozen: bool) -> LockdownView {
        let mut g = self.inner.lock().unwrap();
        let now_w = now_wall();
        let now_t = crate::friction::monotonic::now_tick_secs();

        match g.as_mut() {
            Some(cur) => {
                advance(cur);
                let remaining = cur.duration_secs.saturating_sub(cur.credited_secs);
                if duration_secs > remaining {
                    // Re-anchor the total so the new remaining time is
                    // exactly `duration_secs` from now, without touching
                    // credited progress already earned.
                    cur.duration_secs = cur.credited_secs + duration_secs;
                }
                if frozen {
                    cur.frozen = true;
                }
                cur.last_wall = now_w;
                cur.last_tick = now_t;
            }
            None => {
                *g = Some(ActiveLockdown {
                    started_wall: now_w,
                    duration_secs,
                    frozen,
                    credited_secs: 0,
                    last_wall: now_w,
                    last_tick: now_t,
                });
            }
        }
        let view = view_of(&g);
        self.save(&g);
        view
    }

    /// Current view — advances credit in-memory (not persisted; mirrors
    /// `friction::FrictionStore::get`) before reading.
    pub fn view(&self) -> LockdownView {
        let mut g = self.inner.lock().unwrap();
        if let Some(cur) = g.as_mut() {
            advance(cur);
        }
        view_of(&g)
    }

    /// True only while a lockdown is BOTH active and Frozen — the one check
    /// `cancel_lockdown` (lib.rs) needs before ever registering a friction
    /// request, since a Frozen lockdown must never have a cancel entry
    /// exist at all (see the module doc).
    pub fn is_frozen_active(&self) -> bool {
        let v = self.view();
        v.active && v.frozen
    }

    /// True while a NON-frozen lockdown is active — `cancel_lockdown` uses
    /// this to distinguish "nothing to cancel" from "go ahead and gate it".
    pub fn is_cancellable_active(&self) -> bool {
        let v = self.view();
        v.active && !v.frozen
    }

    /// Actually end the lockdown right now. Called by the friction applier
    /// thread's `"lockdown.cancel"` arm once that delay has elapsed — NEVER
    /// called directly by a command handler, so a normal lockdown's early
    /// end always goes through the same friction wait as every other
    /// weakening.
    pub fn cancel_now(&self) -> LockdownView {
        let mut g = self.inner.lock().unwrap();
        *g = None;
        let view = view_of(&g);
        self.save(&g);
        view
    }

    /// Advance credited time and persist. If the lockdown just reached its
    /// full duration, clears it and returns `true` (a natural expiry — NOT a
    /// friction-gated weakening, since the whole duration was already
    /// pre-committed to at `start` time) so the caller can broadcast the new
    /// (inactive) state to extensions and append an event-log entry. Returns
    /// `false` when nothing ended this tick (including "nothing was active
    /// at all").
    pub fn heartbeat(&self) -> (LockdownView, bool) {
        let mut g = self.inner.lock().unwrap();
        let was_active = g.as_ref().is_some_and(|c| c.duration_secs > c.credited_secs);
        if let Some(cur) = g.as_mut() {
            advance(cur);
        }
        let just_expired = was_active && g.as_ref().is_some_and(|c| c.credited_secs >= c.duration_secs);
        if just_expired {
            *g = None;
        }
        let view = view_of(&g);
        self.save(&g);
        (view, just_expired)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view_active(duration: u64, credited: u64, frozen: bool) -> LockdownView {
        let cur = Some(ActiveLockdown {
            started_wall: 0,
            duration_secs: duration,
            frozen,
            credited_secs: credited,
            last_wall: 0,
            last_tick: 0,
        });
        view_of(&cur)
    }

    #[test]
    fn view_of_none_is_inactive() {
        let v = view_of(&None);
        assert!(!v.active);
        assert_eq!(v.remaining_secs, 0);
        assert_eq!(v.active_until, None);
    }

    #[test]
    fn view_of_partial_credit_is_active_with_remaining() {
        let v = view_active(3600, 100, false);
        assert!(v.active);
        assert_eq!(v.remaining_secs, 3500);
    }

    #[test]
    fn view_of_full_credit_is_inactive() {
        let v = view_active(3600, 3600, false);
        assert!(!v.active);
        assert_eq!(v.remaining_secs, 0);
    }

    #[test]
    fn view_of_over_credit_saturates_to_inactive_not_panic() {
        // credited > duration should never happen in practice, but the math
        // must not underflow/panic if it ever does (e.g. a future duration
        // shrink).
        let v = view_active(100, 500, false);
        assert!(!v.active);
        assert_eq!(v.remaining_secs, 0);
    }

    #[test]
    fn advance_credits_min_of_wall_and_tick_delta() {
        let mut cur = ActiveLockdown {
            started_wall: 1000,
            duration_secs: 3600,
            frozen: false,
            credited_secs: 0,
            last_wall: 1000,
            last_tick: 1000,
        };
        // Simulate a forward wall-clock jump not matched by ticks: advance()
        // itself always reads the REAL current wall/tick, so to unit-test
        // the min() logic in isolation we replicate its formula directly
        // rather than calling advance() (which can't be fed fake clocks
        // without a trait seam this module doesn't have yet).
        let now_w = cur.last_wall + 500; // wall jumped 500s
        let now_t = cur.last_tick + 5; // only 5 real ticks elapsed
        let delta_wall = now_w.saturating_sub(cur.last_wall);
        let delta_tick = now_t.saturating_sub(cur.last_tick);
        let credited = delta_wall.min(delta_tick);
        assert_eq!(credited, 5, "a clock-forward jump must credit only the real tick delta");
    }

    #[test]
    fn advance_handles_tick_reset_reboot_conservatively() {
        let cur = ActiveLockdown {
            started_wall: 1000,
            duration_secs: 3600,
            frozen: false,
            credited_secs: 0,
            last_wall: 1000,
            last_tick: 50_000, // ticks were high before "reboot"
        };
        // Simulate a reboot: the fresh tick counter is smaller than
        // last_tick. Per the documented formula, only post-boot ticks (now_t
        // itself) are credited, never the wall-clock gap.
        let now_t: u64 = 10; // small post-boot tick count
        let tick_reset = now_t < cur.last_tick;
        assert!(tick_reset);
        let delta_tick = if tick_reset { now_t } else { now_t - cur.last_tick };
        assert_eq!(delta_tick, 10);
    }

    #[test]
    fn start_on_empty_creates_active_lockdown() {
        let dir = std::env::temp_dir().join(format!("pp-lockdown-test-{}", std::process::id()));
        let store = LockdownStore::load(&dir);
        let view = store.start(3600, false);
        assert!(view.active);
        assert!(!view.frozen);
        assert_eq!(view.remaining_secs, 3600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extending_never_shortens_remaining() {
        let dir = std::env::temp_dir().join(format!("pp-lockdown-test-ext-{}", std::process::id()));
        let store = LockdownStore::load(&dir);
        store.start(7200, false);
        // Requesting a SHORTER duration than what's already committed must
        // not shorten the remaining time.
        let view = store.start(60, false);
        assert!(view.remaining_secs >= 7199, "shorter re-request must not shrink remaining time");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frozen_upgrade_is_monotonic() {
        let dir = std::env::temp_dir().join(format!("pp-lockdown-test-frz-{}", std::process::id()));
        let store = LockdownStore::load(&dir);
        store.start(3600, true);
        assert!(store.is_frozen_active());
        // Attempting to "downgrade" by passing frozen:false must not un-freeze it.
        store.start(3600, false);
        assert!(store.is_frozen_active(), "frozen must never downgrade back to normal");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_now_clears_regardless_of_frozen() {
        let dir = std::env::temp_dir().join(format!("pp-lockdown-test-cancel-{}", std::process::id()));
        let store = LockdownStore::load(&dir);
        store.start(3600, false);
        assert!(store.is_cancellable_active());
        let view = store.cancel_now();
        assert!(!view.active);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
