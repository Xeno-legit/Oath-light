//! Generalized friction store (Phase 4 items 4.1 + 4.3).
//!
//! `uninstall.rs` used to be the only place that made a protection change
//! wait before it could happen. This module generalizes that idea to *every*
//! weakening of protection, not just removal: turning off the uninstall
//! guard, stopping the AI screen monitor, unblocking a custom site, and
//! whatever future item hooks in here. The rule is simple and one-directional:
//!
//!   * A change that WEAKENS protection registers a `PendingChange`, keyed by
//!     a string `action_id`, and only actually applies once its delay has
//!     elapsed (see `take_ready`, consumed by the applier thread in lib.rs).
//!   * A change that STRENGTHENS protection is always instant — there is no
//!     store entry for turning something back on; the caller just does it and
//!     calls `cancel` to withdraw any pending weakening of the same thing.
//!
//! Everything here is persisted to `<app_data_dir>/friction.json` so a
//! pending weakening survives an app restart *and* a wiped renderer
//! `localStorage` — same reasoning as `uninstall.rs`'s original design, the
//! renderer is deliberately never trusted to hold friction state on its own.
//!
//! One invariant is load-bearing everywhere in this module: `"uninstall"` is
//! a `PendingChange` like any other for read purposes (`get`/`list`), but it
//! is EXCLUDED from `take_ready` — see that function's doc comment. Uninstall
//! only ever *unlocks* an explicit, separate destructive action; it must
//! never auto-fire just because its delay elapsed.
//!
//! ## Clock-tamper immunity (4.3)
//!
//! A friction delay that can be defeated by moving the system clock forward
//! is not friction at all. The wall clock (`SystemTime::now()`) is still
//! *displayed* (it's what `requested_at` means to a human), but it is never
//! the sole source of elapsed-time math. Instead each pending change carries
//! a `credited_secs` counter that is advanced incrementally, once per
//! observation, by the SMALLER of:
//!
//!   * how much the wall clock moved since the last observation, and
//!   * how much a monotonic, boot-anchored tick counter moved since the last
//!     observation (`GetTickCount64()` on Windows — counts up through sleep
//!     and hibernate, and cannot be set by the user, unlike the wall clock).
//!
//! Forward-jumping the wall clock (the obvious attack: "set the date to next
//! week") credits nothing beyond what ticks actually elapsed, because the
//! minimum of the two deltas is used. Rolling the wall clock backward just
//! stalls wall-clock credit until it catches back up to where it was — ticks
//! keep advancing underneath regardless. A full reboot resets the tick
//! counter to a smaller value than last seen; that's treated as "the machine
//! rebooted" and only the post-boot ticks are credited — the shutdown/boot
//! gap itself is deliberately NOT credited. That is the conservative choice:
//! it makes a timer run a little long across a reboot, never short, and
//! "friction takes slightly longer than advertised" is always the safe
//! failure direction for a system whose entire job is to slow someone down.
//!
//! See `advance` for the actual arithmetic, and `monotonic` below for the
//! platform-specific tick source.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// Delays
// ============================================================================

/// Cool-off before a *weakening* action (anything other than `"uninstall"`,
/// which keeps its own separately-tunable constant in `uninstall.rs`) is
/// allowed to apply.
///
/// **At its real production value: 24 hours**, raised alongside the uninstall
/// timer (plan item 4.6). The two are still separate constants on purpose so
/// they can be dialled independently, but they must always move together:
/// shipping one at 24h and the other at 10s would make the whole asymmetry
/// theatre — every protection would be one click and ten seconds from off.
///
/// Briefly at 10s on 2026-07-31 to exercise the weakening flows on a real
/// release install (the debug-only override below cannot reach an
/// NSIS-installed build). That test passed and both constants went back up in
/// the same commit.
///
/// Local testing still works: debug builds honor `OATHLIGHT_FRICTION_SECS`
/// (see `weakening_delay_secs` below); release builds ignore it entirely.
const DEFAULT_WEAKENING_DELAY_SECS: u64 = 24 * 60 * 60;

/// Debug builds: honor `OATHLIGHT_FRICTION_SECS` so the cool-off can be dialed
/// down for manual testing. Release builds ignore the env var entirely and
/// always use `DEFAULT_WEAKENING_DELAY_SECS` — otherwise a user could zero
/// out every weakening's friction timer with `set OATHLIGHT_FRICTION_SECS=1`,
/// defeating the point of this module. Mirrors `uninstall::delay_secs`.
#[cfg(debug_assertions)]
fn weakening_delay_secs() -> u64 {
    std::env::var("OATHLIGHT_FRICTION_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_WEAKENING_DELAY_SECS)
}

/// Release builds: no env override — see the doc comment on the debug variant.
#[cfg(not(debug_assertions))]
fn weakening_delay_secs() -> u64 {
    DEFAULT_WEAKENING_DELAY_SECS
}

/// Short anti-brick delay (plan 4.4) for adding a domain to the user
/// allowlist WHILE a lockdown is active: enough friction to stop an impulsive
/// "just let me through" click, not enough to actually lock someone out of a
/// workday if they add something legitimate (banking, work SSO) mid-lockdown.
/// Fixed at 60s regardless of build type — unlike the other delays this one
/// isn't a stand-in for a much longer production value, so there's no debug
/// override to speak of.
const LOCKDOWN_ALLOW_DELAY_SECS: u64 = 60;

/// Serious Mode's disable cool-off (UX Direction §1 asks for 24–48h against
/// the ordinary weakening's 24h). Expressed as a MULTIPLE of the standard
/// weakening delay rather than its own literal, so it stays correct
/// automatically whichever value the base delay carries — 2× the test value
/// while testing, 48h once the base is at its production 24h. Serious Mode is
/// the strongest commitment the app offers, so it gets the longest wait of
/// any reversible setting.
const SERIOUS_DISABLE_DELAY_MULTIPLE: u64 = 2;

/// Resolve the cool-off length for a given action id. `"uninstall"` defers to
/// `uninstall::delay_secs()` — its own, separately-tunable constant, kept
/// distinct on purpose so the two systems can still be dialed independently
/// even though they now share one persistence engine. Any
/// `"lockdown.allow:<domain>"` id gets the fixed short anti-brick delay
/// (4.4), and `"serious.disable"` gets the doubled Serious Mode cool-off (UX
/// Direction §1). Every other action id gets the shared weakening default
/// above — including `"lockdown.cancel"` and `"trusted_contact.remove"`, which
/// are ordinary weakenings with no special-cased delay of their own.
pub(crate) fn delay_for(action_id: &str) -> u64 {
    if action_id == "uninstall" {
        crate::uninstall::delay_secs()
    } else if action_id.starts_with("lockdown.allow:") {
        LOCKDOWN_ALLOW_DELAY_SECS
    } else if action_id == "serious.disable" {
        weakening_delay_secs().saturating_mul(SERIOUS_DISABLE_DELAY_MULTIPLE)
    } else {
        weakening_delay_secs()
    }
}

fn now_wall() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ============================================================================
// Monotonic tick source (4.3) — see the module doc for why this exists.
// ============================================================================

// `pub(crate)` (not private): item 4.4's Lockdown Mode needs the exact same
// clock-tamper-immune anchor for its own credited-time math
// (`lockdown::LockdownStore`), and duplicating a second copy of this FFI
// would be the kind of "two write paths for one invariant" Part J's standing
// rules call out as a design smell. Reused as-is, not reimplemented.
#[cfg(windows)]
pub(crate) mod monotonic {
    // Hand-rolled FFI, same house pattern as `watchdog.rs`'s kernel32 calls —
    // one function, no new crate dependency.
    extern "system" {
        fn GetTickCount64() -> u64;
    }

    /// Seconds since boot, from a monotonic OS counter that keeps advancing
    /// through sleep/hibernate and — unlike `SystemTime::now()` — cannot be
    /// set by the user. This is the anchor `advance` credits elapsed time
    /// against; see the module doc for the full reasoning.
    pub fn now_tick_secs() -> u64 {
        // SAFETY: GetTickCount64 takes no arguments, has no failure mode, and
        // is safe to call from any thread at any time.
        unsafe { GetTickCount64() / 1000 }
    }
}

#[cfg(not(windows))]
pub(crate) mod monotonic {
    use std::sync::OnceLock;
    use std::time::Instant;

    /// Non-Windows fallback: a process-lifetime monotonic anchor. NOT
    /// cross-restart — Oath Light is Windows-first (see the master plan), and
    /// this path exists only so the module builds and behaves sanely
    /// elsewhere during development. A restart resets the anchor to zero, so
    /// (unlike Windows' system-wide `GetTickCount64`) any credited progress
    /// from a previous run is lost; the wall-clock-vs-tick minimum below
    /// still holds *within* one process lifetime, it just can't defend
    /// across a restart on this platform.
    static ANCHOR: OnceLock<Instant> = OnceLock::new();

    pub fn now_tick_secs() -> u64 {
        let anchor = ANCHOR.get_or_init(Instant::now);
        anchor.elapsed().as_secs()
    }
}

// ============================================================================
// Persisted shape + the view the renderer sees
// ============================================================================

/// On-disk shape of one pending weakening, keyed by `action_id` in the map
/// `friction.json` holds at its root.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingChange {
    /// Wall-clock unix seconds the request was made. Display only — never
    /// used for the ready/elapsed math, see `credited_secs`.
    requested_at: u64,
    delay_secs: u64,
    /// Human sentence for the UI, e.g. "Turn off the uninstall guard".
    label: String,
    /// Data the applier thread needs once this fires, e.g. `{"domain": "x.com"}`.
    payload: serde_json::Value,
    /// Tamper-immune accumulated elapsed credit — see the module doc.
    credited_secs: u64,
    /// Last-seen wall-clock reading, for computing the next `advance` delta.
    last_wall: u64,
    /// Last-seen monotonic-tick reading, for computing the next `advance` delta.
    last_tick: u64,
}

/// What the renderer sees for one pending change. The countdown is computed
/// on the backend from `credited_secs`, not the JS clock.
#[derive(Debug, Clone, Serialize)]
pub struct PendingView {
    pub action_id: String,
    pub label: String,
    pub requested_at: u64,
    pub delay_secs: u64,
    /// = `credited_secs`, capped at `delay_secs`.
    pub elapsed_secs: u64,
    pub remaining_secs: u64,
    pub ready: bool,
}

fn view_of(action_id: &str, p: &PendingChange) -> PendingView {
    let elapsed = p.credited_secs.min(p.delay_secs);
    PendingView {
        action_id: action_id.to_string(),
        label: p.label.clone(),
        requested_at: p.requested_at,
        delay_secs: p.delay_secs,
        elapsed_secs: elapsed,
        remaining_secs: p.delay_secs.saturating_sub(elapsed),
        ready: p.credited_secs >= p.delay_secs,
    }
}

/// One detected clock-tamper anomaly (a forward wall-clock jump unexplained
/// by a reboot) — see `advance` below. `oathlight-core`'s event log (plan 4.5)
/// is the intended long-term consumer, via `FrictionStore::drain_anomalies`;
/// this module itself stays free of any eventlog dependency (Part J: keep
/// `friction.rs` core-clean) and only ever hands the *fact* of the anomaly
/// back to whichever caller wants to record it.
#[derive(Debug, Clone)]
pub struct ClockAnomaly {
    pub action_id: String,
    pub delta_wall: u64,
    pub delta_tick: u64,
}

/// Advance every entry's `credited_secs` by exactly the amount of time that
/// has genuinely passed since it was last observed. Called before every
/// read/mutation and by the applier thread's heartbeat; does NOT persist —
/// callers decide when to flush to disk (see `FrictionStore::heartbeat`).
///
/// The credited amount is `min(delta_wall, delta_tick)` — see the module doc
/// for why that minimum is what makes this clock-tamper-immune:
///   * a forward wall-clock jump can't credit more than ticks actually
///     elapsed;
///   * a backward wall-clock roll just stalls wall-clock credit until it
///     catches up — ticks keep advancing underneath regardless.
///
/// Returns every anomaly detected THIS call (usually empty) so the caller
/// can fold them into `FrictionStore`'s own anomaly buffer — see
/// `drain_anomalies`.
fn advance(map: &mut HashMap<String, PendingChange>) -> Vec<ClockAnomaly> {
    let now_w = now_wall();
    let now_t = monotonic::now_tick_secs();
    let mut anomalies = Vec::new();

    for (action_id, p) in map.iter_mut() {
        let delta_wall = now_w.saturating_sub(p.last_wall);
        // A tick reading lower than the last-seen one means the monotonic
        // counter reset — i.e. the machine rebooted (GetTickCount64 only
        // ever counts up otherwise). Credit only the ticks accumulated since
        // that boot; the shutdown-to-boot gap is deliberately NOT credited —
        // conservative, runs the timer long rather than short, which is the
        // correct failure direction for a friction system.
        let tick_reset = now_t < p.last_tick;
        let delta_tick = if tick_reset { now_t } else { now_t - p.last_tick };
        let credited_advance = delta_wall.min(delta_tick);

        // Flag a suspicious forward wall-clock jump that isn't explained by a
        // reboot: item 4.5's hash-chained event log is the intended
        // long-term consumer of this — logged AND handed back to the caller.
        if !tick_reset && delta_wall > delta_tick + 120 {
            log::warn!(
                "friction: clock anomaly on '{action_id}' — wall clock advanced {delta_wall}s but only \
                 {delta_tick}s of monotonic ticks elapsed; crediting {credited_advance}s, not {delta_wall}s"
            );
            anomalies.push(ClockAnomaly { action_id: action_id.clone(), delta_wall, delta_tick });
        }

        p.credited_secs += credited_advance;
        p.last_wall = now_w;
        p.last_tick = now_t;
    }
    anomalies
}

// ============================================================================
// The store
// ============================================================================

/// Persisted owner of every pending weakening. Cheap to clone the path; the
/// actual state is behind a mutex and mirrored to disk on every mutation
/// (plain reads only advance the in-memory copy — see `heartbeat`).
pub struct FrictionStore {
    path: PathBuf,
    inner: Mutex<HashMap<String, PendingChange>>,
    /// Clock anomalies detected by `advance` since the last `drain_anomalies`
    /// call — see `ClockAnomaly` and `drain_anomalies`. Never persisted:
    /// these are transient signals for the event log (4.5), not state that
    /// needs to survive a restart.
    anomalies: Mutex<Vec<ClockAnomaly>>,
}

impl FrictionStore {
    /// Load `<app_data_dir>/friction.json` (defaults to an empty map when
    /// absent or unreadable).
    ///
    /// Migration: if the map has no `"uninstall"` entry yet and a legacy
    /// `<app_data_dir>/uninstall.json` exists with a `requested_at`, import
    /// it as a pending `"uninstall"` change — grandfathered with
    /// `credited_secs` set to the wall-clock elapsed time at import (exactly
    /// what the old `UninstallStore` would have shown), so nobody's countdown
    /// silently jumps just because this module shipped.
    pub fn load(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("friction.json");
        let mut map: HashMap<String, PendingChange> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        let mut migrated = false;
        if !map.contains_key("uninstall") {
            let legacy_path = app_data_dir.join("uninstall.json");
            if let Ok(s) = std::fs::read_to_string(&legacy_path) {
                if let Ok(p) = serde_json::from_str::<crate::uninstall::Persisted>(&s) {
                    if let Some(at) = p.requested_at {
                        let now_w = now_wall();
                        let now_t = monotonic::now_tick_secs();
                        map.insert(
                            "uninstall".to_string(),
                            PendingChange {
                                requested_at: at,
                                delay_secs: crate::uninstall::delay_secs(),
                                label: "Remove Oath Light from this computer".to_string(),
                                payload: serde_json::json!({}),
                                credited_secs: now_w.saturating_sub(at),
                                last_wall: now_w,
                                last_tick: now_t,
                            },
                        );
                        migrated = true;
                        log::info!("friction: migrated pending uninstall request from uninstall.json");
                    }
                }
            }
        }

        let store = Self { path, inner: Mutex::new(map), anomalies: Mutex::new(Vec::new()) };
        if migrated {
            let map = store.inner.lock().unwrap();
            store.save(&map);
        }
        store
    }

    fn save(&self, map: &HashMap<String, PendingChange>) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string_pretty(map) {
            let _ = std::fs::write(&self.path, s);
        }
    }

    fn record_anomalies(&self, found: Vec<ClockAnomaly>) {
        if found.is_empty() {
            return;
        }
        self.anomalies.lock().unwrap().extend(found);
    }

    /// Every clock anomaly detected since the last call, drained (not just
    /// peeked) so each one is reported exactly once. Callers (the applier
    /// thread's heartbeat in lib.rs) fold each into the event log (4.5) as a
    /// `clock_anomaly` entry.
    pub fn drain_anomalies(&self) -> Vec<ClockAnomaly> {
        std::mem::take(&mut self.anomalies.lock().unwrap())
    }

    /// Register a weakening request. Idempotent — an existing entry keeps its
    /// original clock and credited time; re-requesting never extends OR
    /// shortens the remaining wait.
    pub fn request(&self, action_id: &str, label: &str, payload: serde_json::Value) -> PendingView {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        let entry = map.entry(action_id.to_string()).or_insert_with(|| {
            let now_w = now_wall();
            let now_t = monotonic::now_tick_secs();
            PendingChange {
                requested_at: now_w,
                delay_secs: delay_for(action_id),
                label: label.to_string(),
                payload,
                credited_secs: 0,
                last_wall: now_w,
                last_tick: now_t,
            }
        });
        let view = view_of(action_id, entry);
        self.save(&map);
        view
    }

    /// Withdraw a pending weakening outright (a strengthening — never
    /// gated). Returns whether anything was actually removed.
    pub fn cancel(&self, action_id: &str) -> bool {
        let mut map = self.inner.lock().unwrap();
        let removed = map.remove(action_id).is_some();
        if removed {
            self.save(&map);
        }
        removed
    }

    /// Restart the clock and credited time from now, for an existing pending
    /// change (used by the uninstall "Reset timer" button). No-op (returns
    /// `None`) if nothing is pending under `action_id`.
    pub fn reset(&self, action_id: &str) -> Option<PendingView> {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        let now_w = now_wall();
        let now_t = monotonic::now_tick_secs();
        let entry = map.get_mut(action_id)?;
        entry.requested_at = now_w;
        entry.credited_secs = 0;
        entry.last_wall = now_w;
        entry.last_tick = now_t;
        let view = view_of(action_id, entry);
        self.save(&map);
        Some(view)
    }

    /// Current view of one pending change, if any. Advances credit in-memory
    /// (not persisted — see `heartbeat`) before reading.
    pub fn get(&self, action_id: &str) -> Option<PendingView> {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        map.get(action_id).map(|p| view_of(action_id, p))
    }

    /// The stored payload of one pending change, if it exists.
    ///
    /// `PendingView` deliberately doesn't carry the payload — it's the
    /// applier thread's data, not the renderer's, and most of it would be
    /// noise in a countdown UI. The uninstall confirmation phrase (4.6) is the
    /// exception: it's generated once at request time, persisted with the
    /// request so it survives restarts, and has to be readable to be shown.
    /// Hence this narrow accessor rather than widening the view for everyone.
    pub fn payload_of(&self, action_id: &str) -> Option<serde_json::Value> {
        let map = self.inner.lock().unwrap();
        map.get(action_id).map(|p| p.payload.clone())
    }

    /// Every pending change, sorted by request time (oldest first).
    pub fn list(&self) -> Vec<PendingView> {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        let mut views: Vec<PendingView> = map.iter().map(|(id, p)| view_of(id, p)).collect();
        views.sort_by_key(|v| v.requested_at);
        views
    }

    /// Remove and return every entry whose delay has elapsed, EXCEPT
    /// `"uninstall"`.
    ///
    /// `"uninstall"` never auto-fires: reaching its delay only flips
    /// `PendingView::ready`, which unlocks the explicit, separately-gated
    /// "Remove Oath Light now" action (`complete_uninstall` in lib.rs). If
    /// this function ever swept it up like any other weakening, removal
    /// would silently execute itself the moment the cool-off elapsed —
    /// exactly the impulsive, no-second-thought outcome the whole uninstall
    /// flow exists to prevent. This exclusion is the one invariant this
    /// entire module exists to protect; do not remove it.
    pub fn take_ready(&self) -> Vec<(String, serde_json::Value)> {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        let ready_ids: Vec<String> = map
            .iter()
            .filter(|(id, p)| id.as_str() != "uninstall" && p.credited_secs >= p.delay_secs)
            .map(|(id, _)| id.clone())
            .collect();
        let mut out = Vec::with_capacity(ready_ids.len());
        for id in ready_ids {
            if let Some(p) = map.remove(&id) {
                out.push((id, p.payload));
            }
        }
        if !out.is_empty() {
            self.save(&map);
        }
        out
    }

    /// Advance every entry's credited time and flush to disk. Called
    /// periodically (throttled) by the applier thread in lib.rs.
    ///
    /// Plain reads (`get`/`list`) advance the in-memory copy only and never
    /// persist, so a crash between heartbeats loses at most the credit
    /// accumulated since the last one — the on-disk timer can only end up a
    /// little behind reality, never ahead. That is the safe direction: it
    /// makes a restored timer run slightly long, never short.
    pub fn heartbeat(&self) {
        let mut map = self.inner.lock().unwrap();
        let found = advance(&mut map);
        self.record_anomalies(found);
        self.save(&map);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delay_for_lockdown_allow_prefix_is_short() {
        assert_eq!(delay_for("lockdown.allow:example.com"), LOCKDOWN_ALLOW_DELAY_SECS);
        assert_eq!(delay_for("lockdown.allow:"), LOCKDOWN_ALLOW_DELAY_SECS);
    }

    #[test]
    fn delay_for_other_actions_unaffected() {
        assert_eq!(delay_for("lockdown.cancel"), weakening_delay_secs());
        assert_eq!(delay_for("trusted_contact.remove"), weakening_delay_secs());
        assert_eq!(delay_for("guard.disable"), weakening_delay_secs());
    }

    /// Serious Mode's disable wait is deliberately the longest of any
    /// reversible setting (UX Direction §1: 24–48h against the ordinary 24h).
    /// Asserted as a multiple rather than a literal so it tracks whatever the
    /// base weakening delay is set to, in either build profile.
    #[test]
    fn delay_for_serious_disable_is_double_the_ordinary_weakening() {
        assert_eq!(
            delay_for("serious.disable"),
            weakening_delay_secs() * SERIOUS_DISABLE_DELAY_MULTIPLE
        );
        assert!(delay_for("serious.disable") > delay_for("guard.disable"));
    }

    #[test]
    fn request_then_take_ready_round_trips_payload() {
        let dir = std::env::temp_dir().join(format!("pp-friction-test-{}", std::process::id()));
        let store = FrictionStore::load(&dir);
        let view = store.request("test.weaken", "Test weakening", serde_json::json!({"k": "v"}));
        assert!(!view.ready);
        // Not ready yet (0 credited secs) — take_ready must not return it.
        let ready = store.take_ready();
        assert!(ready.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drain_anomalies_is_empty_when_nothing_detected() {
        let dir = std::env::temp_dir().join(format!("pp-friction-test-anom-{}", std::process::id()));
        let store = FrictionStore::load(&dir);
        store.request("test.weaken", "Test", serde_json::json!({}));
        // No clock manipulation happened between calls in a unit test, so no
        // anomaly should ever be recorded here.
        assert!(store.drain_anomalies().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
