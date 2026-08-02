//! Recovery data — the urge log, slip log and streak (plan items 5.4 + 5.5),
//! moved out of the renderer's `localStorage` and into a Rust-owned store.
//!
//! ## Why this moved
//! The renderer built 5.4/5.5 against `localStorage`, which was the right call
//! to get the UX designed — but it makes the *data* the weakest part of the
//! feature. `localStorage` is cleared by a browser-data reset, by a webview
//! cache wipe, and by the app being reinstalled; and it is trivially editable
//! from devtools. That is survivable for a theme preference. It is not
//! survivable for a streak someone has spent ninety days building, or for a
//! slip log whose entire purpose is to be an honest record that tomorrow's
//! self can't quietly rewrite tonight.
//!
//! So the backend owns it now, on the same principle as `friction.rs`: state
//! that matters to a person's commitment does not live where the weak-moment
//! self can casually reach it. `localStorage` stays as an offline mirror so the
//! standalone renderer preview still works, but the backend wins on every
//! startup where it's reachable.
//!
//! ## What is stored
//! Timestamps and a trigger tag from a fixed four-word vocabulary. That's all.
//! No URLs, no site names, no content, no free text — a log of *when* and
//! *what kind*, never *what*. This is deliberately the same discipline the
//! event log (4.5) and the trusted-contact notifier (5.2) follow, and it means
//! the file is safe to hand to anyone.
//!
//! ## Relationship to the tamper-evident event log (4.5)
//! Separate on purpose. The event log records protective events (uninstall
//! requests, monitor stops) and is hash-chained so deletions are detectable.
//! This is ordinary user data the user is expected to own and may legitimately
//! want to delete. Conflating them would either make the streak un-resettable
//! or make the tamper log editable; both are worse.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Cap on each log. Old entries drop off the front, so a long-running profile
/// never grows these without bound. Matches the renderer's own `LOG_CAP`.
const LOG_CAP: usize = 500;

/// Streak milestones, in days. The ONE canonical list — the renderer reads it
/// from `get_recovery_log`'s response rather than declaring its own, so the
/// two can never drift.
pub const MILESTONES: &[u64] = &[7, 14, 30, 60, 90, 180, 365];

/// The 24h "gentle mode" window after a slip (5.5). Derived from the last slip
/// timestamp rather than stored, so it can never disagree with the slip log.
const GENTLE_SECS: u64 = 24 * 60 * 60;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// One logged urge (5.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrgeEntry {
    /// Unix seconds.
    pub ts: u64,
    /// A trigger id from the fixed vocabulary (`bored` | `stressed` | `late` |
    /// `lonely`), or `None` when the user skipped the question. Never free
    /// text — a fixed vocabulary is what makes the analytics meaningful AND
    /// keeps the log free of anything identifying.
    pub trigger: Option<String>,
    /// Where the tap came from: `panic` | `manual` | `slip`.
    pub source: String,
}

/// Persisted shape, `<app_data_dir>/recovery.json`. Every field defaults, so a
/// file written by an older build still loads and simply gains the new field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryV1 {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Unix seconds the current clean streak started. The live day count is
    /// DERIVED from this (see `streak_days`), never stored — a stored counter
    /// and a start date are two sources of truth for one fact, and they drift.
    #[serde(default)]
    pub streak_start: u64,
    /// Highest streak ever reached, in days. Never regresses — 5.5's central
    /// rule: a slip dents the current streak, it does not erase what was
    /// already earned.
    #[serde(default)]
    pub best_streak: u64,
    /// Highest milestone already celebrated for the CURRENT streak, so a
    /// milestone fires exactly once even across restarts. Reset by a slip.
    #[serde(default)]
    pub last_milestone: u64,
    #[serde(default)]
    pub urges: Vec<UrgeEntry>,
    /// Unix seconds of each logged slip.
    #[serde(default)]
    pub slips: Vec<u64>,
}

fn default_version() -> u32 {
    1
}

impl Default for RecoveryV1 {
    fn default() -> Self {
        Self {
            version: 1,
            // A fresh profile starts its streak now, not at the epoch — which
            // would otherwise read as a ~56-year streak on first launch.
            streak_start: now_secs(),
            best_streak: 0,
            last_milestone: 0,
            urges: Vec::new(),
            slips: Vec::new(),
        }
    }
}

/// What the renderer renders from. Everything derived is computed here, once,
/// rather than in the UI — so the Overview, the Mentor page and any future
/// surface can never disagree about whether gentle mode is on.
#[derive(Debug, Clone, Serialize)]
pub struct RecoveryView {
    pub streak: u64,
    pub best_streak: u64,
    pub last_milestone: u64,
    pub urges: Vec<UrgeEntry>,
    pub slips: Vec<u64>,
    /// True while the most recent slip is under 24h old (5.5's gentle mode).
    pub gentle: bool,
    /// Calendar days elapsed this month minus the distinct days containing a
    /// slip — 5.5's "a slip dents the month, it doesn't erase it".
    pub clean_days_this_month: u64,
    /// The canonical milestone list, so the renderer never declares its own.
    pub milestones: Vec<u64>,
}

/// Whole days elapsed since `start`.
fn days_since(start: u64, now: u64) -> u64 {
    now.saturating_sub(start) / 86_400
}

/// Calendar-day index (days since the epoch) — enough to answer "were these
/// two timestamps on the same day" and "which month is this" without pulling
/// in a date library for two questions.
fn day_index(ts: u64) -> u64 {
    ts / 86_400
}

impl RecoveryV1 {
    pub fn streak_days(&self, now: u64) -> u64 {
        days_since(self.streak_start, now)
    }

    fn gentle(&self, now: u64) -> bool {
        self.slips
            .last()
            .is_some_and(|last| now.saturating_sub(*last) < GENTLE_SECS)
    }

    /// Distinct slip-days within the last 30 days, subtracted from 30. An
    /// approximation of "this month" that needs no calendar arithmetic and
    /// behaves identically for the thing the number is actually for: showing
    /// that a slip dented a period rather than erasing it.
    fn clean_days_this_month(&self, now: u64) -> u64 {
        const WINDOW_DAYS: u64 = 30;
        let today = day_index(now);
        let cutoff = today.saturating_sub(WINDOW_DAYS - 1);
        let mut slip_days: Vec<u64> = self
            .slips
            .iter()
            .map(|ts| day_index(*ts))
            .filter(|d| *d >= cutoff)
            .collect();
        slip_days.sort_unstable();
        slip_days.dedup();
        WINDOW_DAYS.saturating_sub(slip_days.len() as u64)
    }

    pub fn view(&self, now: u64) -> RecoveryView {
        RecoveryView {
            streak: self.streak_days(now),
            best_streak: self.best_streak.max(self.streak_days(now)),
            last_milestone: self.last_milestone,
            urges: self.urges.clone(),
            slips: self.slips.clone(),
            gentle: self.gentle(now),
            clean_days_this_month: self.clean_days_this_month(now),
            milestones: MILESTONES.to_vec(),
        }
    }
}

/// Append with the cap enforced — the single code path every log write goes
/// through, so no future write site can forget it.
fn cap_push<T>(list: &mut Vec<T>, entry: T) {
    list.push(entry);
    while list.len() > LOG_CAP {
        list.remove(0);
    }
}

/// Persisted owner of `RecoveryV1`. Same shape as `SettingsState`: value behind
/// a mutex, mirrored to disk on every mutation.
pub struct RecoveryState {
    path: PathBuf,
    inner: Mutex<RecoveryV1>,
}

impl RecoveryState {
    /// Load `<app_data_dir>/recovery.json`, defaulting on absence or a parse
    /// failure — a corrupt file must never block startup.
    pub fn load(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("recovery.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<RecoveryV1>(&s).ok())
            .unwrap_or_default();
        Self { path, inner: Mutex::new(inner) }
    }

    fn save(&self, v: &RecoveryV1) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(v) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn view(&self) -> RecoveryView {
        self.inner.lock().unwrap().view(now_secs())
    }

    fn update(&self, f: impl FnOnce(&mut RecoveryV1)) -> RecoveryView {
        let mut v = self.inner.lock().unwrap();
        f(&mut v);
        self.save(&v);
        v.view(now_secs())
    }

    /// Log one urge (5.4). `source` is `panic` | `manual`; slips write their
    /// own mirrored entry through `log_slip` instead.
    pub fn log_urge(&self, trigger: Option<String>, source: &str) -> RecoveryView {
        let now = now_secs();
        let source = source.to_string();
        self.update(|v| {
            cap_push(&mut v.urges, UrgeEntry { ts: now, trigger, source });
        })
    }

    /// Log a slip (5.5). Deliberately NOT a "reset" — it keeps `best_streak`,
    /// records the timestamp (which is what starts the derived gentle window),
    /// and mirrors an entry into the urge log so trigger analytics sees it too.
    /// `last_milestone` goes back to 0 because a new streak earns milestones
    /// from the beginning again.
    pub fn log_slip(&self, trigger: Option<String>) -> RecoveryView {
        let now = now_secs();
        self.update(|v| {
            let reached = v.streak_days(now);
            v.best_streak = v.best_streak.max(reached);
            v.streak_start = now;
            v.last_milestone = 0;
            cap_push(&mut v.slips, now);
            cap_push(
                &mut v.urges,
                UrgeEntry { ts: now, trigger, source: "slip".to_string() },
            );
        })
    }

    /// Record that a milestone has been celebrated, so it fires once. Monotonic
    /// — a lower value never overwrites a higher one, which makes the call
    /// idempotent and safe to make from a render effect.
    pub fn mark_milestone(&self, days: u64) -> RecoveryView {
        self.update(|v| {
            if days > v.last_milestone {
                v.last_milestone = days;
            }
        })
    }

    /// Adopt a renderer-held streak start (the one-time migration off
    /// `localStorage`). Only ever moves the anchor EARLIER, and only when the
    /// backend has no history of its own — so it can lengthen a streak that
    /// predates this store, and can never be used to fabricate one later.
    pub fn migrate_streak_start(&self, start: u64, best: u64) -> RecoveryView {
        self.update(|v| {
            let has_history = !v.slips.is_empty() || !v.urges.is_empty();
            if !has_history && start > 0 && start < v.streak_start {
                v.streak_start = start;
            }
            v.best_streak = v.best_streak.max(best);
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(tag: &str) -> (RecoveryState, PathBuf) {
        let d = std::env::temp_dir().join(format!("ol-recovery-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        (RecoveryState::load(&d), d)
    }

    #[test]
    fn fresh_profile_starts_at_day_zero_not_the_epoch() {
        let (s, d) = state("fresh");
        let v = s.view();
        assert_eq!(v.streak, 0);
        assert_eq!(v.best_streak, 0);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn urges_round_trip_through_disk() {
        let (s, d) = state("urges");
        s.log_urge(Some("bored".into()), "manual");
        s.log_urge(None, "panic");
        // Re-load from disk: persistence is the entire point of this move.
        let reloaded = RecoveryState::load(&d);
        let v = reloaded.view();
        assert_eq!(v.urges.len(), 2);
        assert_eq!(v.urges[0].trigger.as_deref(), Some("bored"));
        assert_eq!(v.urges[0].source, "manual");
        assert_eq!(v.urges[1].trigger, None);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 5.5's central rule, and the one most likely to be broken by a later
    /// refactor: a slip must never take away what was already earned.
    #[test]
    fn a_slip_keeps_the_best_streak_and_mirrors_into_the_urge_log() {
        let (s, d) = state("slip");
        // Backdate the anchor 40 days so there's a real streak to lose.
        s.update(|v| v.streak_start = now_secs() - 40 * 86_400);
        assert_eq!(s.view().streak, 40);

        let v = s.log_slip(Some("late".into()));
        assert_eq!(v.streak, 0, "the current streak resets");
        assert_eq!(v.best_streak, 40, "the best streak does NOT regress");
        assert_eq!(v.slips.len(), 1);
        assert_eq!(v.last_milestone, 0, "milestones start over for a new streak");
        assert_eq!(
            v.urges.last().map(|u| u.source.as_str()),
            Some("slip"),
            "the slip is mirrored into the urge log so analytics sees it"
        );
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn gentle_mode_is_on_right_after_a_slip_and_off_without_one() {
        let (s, d) = state("gentle");
        assert!(!s.view().gentle, "no slips — no gentle window");
        s.log_slip(None);
        assert!(s.view().gentle, "a slip just now opens the 24h window");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn clean_days_drop_by_one_per_distinct_slip_day() {
        let (s, d) = state("cleandays");
        assert_eq!(s.view().clean_days_this_month, 30);
        s.log_slip(None);
        assert_eq!(s.view().clean_days_this_month, 29);
        // A second slip the SAME day must not double-count.
        s.log_slip(None);
        assert_eq!(s.view().clean_days_this_month, 29);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn milestone_marking_is_monotonic() {
        let (s, d) = state("milestone");
        s.mark_milestone(30);
        assert_eq!(s.view().last_milestone, 30);
        s.mark_milestone(7);
        assert_eq!(s.view().last_milestone, 30, "a lower value never overwrites");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// The migration can lengthen a streak carried over from localStorage, but
    /// must never be usable to invent one once the backend has real history.
    #[test]
    fn migration_only_adopts_an_earlier_anchor_and_only_before_any_history() {
        let (s, d) = state("migrate");
        let sixty_days_ago = now_secs() - 60 * 86_400;
        s.migrate_streak_start(sixty_days_ago, 12);
        assert_eq!(s.view().streak, 60);
        assert_eq!(s.view().best_streak, 60);

        // Later anchor: ignored (it would SHORTEN the streak).
        s.migrate_streak_start(now_secs(), 0);
        assert_eq!(s.view().streak, 60);

        // Once there's history, migration can't move the anchor at all.
        s.log_urge(None, "manual");
        s.migrate_streak_start(now_secs() - 900 * 86_400, 0);
        assert_eq!(s.view().streak, 60, "history present — anchor is frozen");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn logs_are_capped() {
        let (s, d) = state("cap");
        for _ in 0..(LOG_CAP + 25) {
            s.log_urge(None, "manual");
        }
        assert_eq!(s.view().urges.len(), LOG_CAP);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_corrupt_file_falls_back_to_defaults_instead_of_failing() {
        let (_, d) = state("corrupt");
        std::fs::write(d.join("recovery.json"), "{ not json").unwrap();
        let s = RecoveryState::load(&d);
        assert_eq!(s.view().streak, 0);
        let _ = std::fs::remove_dir_all(&d);
    }
}
