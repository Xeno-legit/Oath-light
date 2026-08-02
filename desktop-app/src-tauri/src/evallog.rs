//! False-positive feedback loop (plan item 2.4) — the local eval log and the
//! dwell auto-tune it drives.
//!
//! ## Why this exists
//! The ensemble is measured at 95.8% residual accuracy, which means it is
//! wrong sometimes, and when it is wrong it interrupts someone who was doing
//! nothing. A commercial blocker cannot expose its model's mistakes without
//! undermining its own sales copy. Oath Light can do the opposite and make
//! that transparency a feature: every "this was wrong" press is recorded
//! locally, the user can read the whole log, and the app visibly adapts.
//!
//! ## What is recorded — and what is NOT
//! One JSON line per report: a timestamp, the monitor index, the ensemble's
//! own scores, and a **hash** of the frame. Never the frame itself, never a
//! thumbnail, never a URL, never anything about what was on screen. The hash
//! exists only so repeated reports of the *same* screen can be recognised as
//! one recurring false positive rather than counted several times; it is a
//! one-way digest of pixel data and nothing can be reconstructed from it.
//!
//! Nothing here leaves the machine. There is no upload path in this module,
//! deliberately — the plan's "users could contribute anonymized score
//! distributions voluntarily" idea stays a manual, opt-in export of a file the
//! user can read first, not a wire this code could ever quietly light up.
//!
//! ## The auto-tune, and its floor
//! Confirmed false positives shorten the overlay's dwell (the forced pause
//! before Dismiss unlocks) toward `MIN_DWELL_SECS`, so a model that keeps
//! being wrong costs the user less of their time each occurrence. It can never
//! reach zero and it never touches *detection* — the escalation thresholds are
//! untouched, so the overlay still appears exactly as often. Only the cost of
//! clearing a wrong one comes down. That boundary is deliberate: this is the
//! one place in the app where a user's own input relaxes something, so it is
//! bounded, reversible, and confined to a timer that is friction rather than
//! enforcement.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Default dwell, mirroring `overlay::DWELL`. Kept as a plain number here (not
/// a `Duration`) because it is what gets arithmetic done to it.
pub const DEFAULT_DWELL_SECS: u64 = 30;

/// The floor the auto-tune can never go below. A dwell of zero would turn the
/// overlay into a notification the user swats away without reading, which is
/// exactly the failure mode the dwell exists to prevent.
pub const MIN_DWELL_SECS: u64 = 10;

/// Seconds removed from the dwell per distinct confirmed false positive.
const TUNE_STEP_SECS: u64 = 4;

/// Only the most recent reports steer the tuning — a false positive from six
/// months and three model updates ago should not still be shortening today's
/// dwell.
const TUNE_WINDOW_SECS: u64 = 30 * 24 * 60 * 60;

/// Hard cap on the log file. Small: this is one line per user press, so a
/// person would have to report thousands of false positives to approach it.
const MAX_ENTRIES: usize = 2_000;

/// One reported false positive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalEntry {
    /// Unix seconds.
    pub ts: u64,
    /// Display index the overlay was shown on.
    pub monitor_id: u32,
    /// SigLIP Image-Guard's NSFW score for the frame that triggered this.
    pub siglip_nsfw: f32,
    /// NudeNet's explicit score, when the detector was loaded (else 0.0).
    pub nudenet_explicit: f32,
    /// One-way digest of the triggering frame. Recognises a repeat of the same
    /// screen; reveals nothing about it.
    pub screen_hash: String,
    /// The dwell in force when this was reported — so the log shows the tuning
    /// actually happening over time, rather than just its end state.
    pub dwell_secs: u64,
}

fn path_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("eval_log.jsonl")
}

/// FNV-1a over the frame bytes. Not cryptographic and doesn't need to be — its
/// only job is "is this the same screen as last time", and a collision costs
/// nothing worse than two distinct false positives counting as one.
pub fn hash_frame(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01B3);
    }
    format!("{h:016x}")
}

/// Read the whole log, newest last. A malformed line is skipped rather than
/// failing the read — a truncated final line (power loss mid-append) must not
/// cost the user their whole history.
pub fn read_all(app_data_dir: &Path) -> Vec<EvalEntry> {
    let Ok(text) = std::fs::read_to_string(path_for(app_data_dir)) else {
        return Vec::new();
    };
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<EvalEntry>(l).ok())
        .collect()
}

/// Append one report. Rewrites the file trimmed to `MAX_ENTRIES` when it grows
/// past the cap.
pub fn append(app_data_dir: &Path, entry: &EvalEntry) -> Result<(), String> {
    let _ = std::fs::create_dir_all(app_data_dir);
    let path = path_for(app_data_dir);
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;

    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open eval log: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write eval log: {e}"))?;
    drop(f);

    let all = read_all(app_data_dir);
    if all.len() > MAX_ENTRIES {
        let keep = &all[all.len() - MAX_ENTRIES..];
        let mut out = String::new();
        for e in keep {
            if let Ok(s) = serde_json::to_string(e) {
                out.push_str(&s);
                out.push('\n');
            }
        }
        let _ = std::fs::write(&path, out);
    }
    Ok(())
}

/// The tuned dwell, derived fresh from the log every time rather than stored.
///
/// Deriving beats storing here for the same reason `PP.isGentle()` derives the
/// gentle window from the slip log in the renderer: a stored value can drift
/// out of agreement with the data that justifies it, and then the app is
/// behaving on the basis of something no one can see. This way the log IS the
/// explanation, and deleting the log honestly restores the default.
///
/// Distinct `screen_hash` values inside the window are what count, so holding
/// the button down on one stubborn false positive can't ratchet the dwell to
/// the floor by itself.
pub fn tuned_dwell_secs(app_data_dir: &Path, now: u64) -> u64 {
    let cutoff = now.saturating_sub(TUNE_WINDOW_SECS);
    let mut seen = std::collections::HashSet::new();
    for e in read_all(app_data_dir) {
        if e.ts >= cutoff {
            seen.insert(e.screen_hash);
        }
    }
    let reduction = (seen.len() as u64).saturating_mul(TUNE_STEP_SECS);
    DEFAULT_DWELL_SECS
        .saturating_sub(reduction)
        .max(MIN_DWELL_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ol-evallog-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn entry(ts: u64, hash: &str) -> EvalEntry {
        EvalEntry {
            ts,
            monitor_id: 0,
            siglip_nsfw: 0.9,
            nudenet_explicit: 0.1,
            screen_hash: hash.to_string(),
            dwell_secs: DEFAULT_DWELL_SECS,
        }
    }

    #[test]
    fn append_then_read_round_trips() {
        let d = tmp_dir("round");
        append(&d, &entry(1000, "aaaa")).unwrap();
        append(&d, &entry(1001, "bbbb")).unwrap();
        let all = read_all(&d);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].screen_hash, "aaaa");
        assert_eq!(all[1].screen_hash, "bbbb");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn empty_log_yields_the_default_dwell() {
        let d = tmp_dir("empty");
        assert_eq!(tuned_dwell_secs(&d, 10_000), DEFAULT_DWELL_SECS);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn distinct_reports_shorten_the_dwell_by_one_step_each() {
        let d = tmp_dir("step");
        append(&d, &entry(10_000, "aaaa")).unwrap();
        assert_eq!(tuned_dwell_secs(&d, 10_000), DEFAULT_DWELL_SECS - TUNE_STEP_SECS);
        append(&d, &entry(10_001, "bbbb")).unwrap();
        assert_eq!(tuned_dwell_secs(&d, 10_001), DEFAULT_DWELL_SECS - 2 * TUNE_STEP_SECS);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn repeat_reports_of_the_same_screen_count_once() {
        let d = tmp_dir("dupe");
        for ts in 0..10 {
            append(&d, &entry(10_000 + ts, "aaaa")).unwrap();
        }
        assert_eq!(tuned_dwell_secs(&d, 10_010), DEFAULT_DWELL_SECS - TUNE_STEP_SECS);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// The floor is the whole safety story for this feature — no amount of
    /// reporting may turn the overlay into a swat-away notification.
    #[test]
    fn the_dwell_never_falls_below_the_floor() {
        let d = tmp_dir("floor");
        for i in 0..50u64 {
            append(&d, &entry(10_000 + i, &format!("hash{i}"))).unwrap();
        }
        assert_eq!(tuned_dwell_secs(&d, 10_050), MIN_DWELL_SECS);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Old reports stop counting, so the dwell recovers on its own once the
    /// model (or the user's screen habits) stop producing false positives.
    #[test]
    fn reports_outside_the_window_stop_counting() {
        let d = tmp_dir("window");
        append(&d, &entry(1_000, "aaaa")).unwrap();
        let long_after = 1_000 + TUNE_WINDOW_SECS + 1;
        assert_eq!(tuned_dwell_secs(&d, long_after), DEFAULT_DWELL_SECS);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let d = tmp_dir("malformed");
        append(&d, &entry(1_000, "aaaa")).unwrap();
        let path = path_for(&d);
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{{not json").unwrap();
        drop(f);
        assert_eq!(read_all(&d).len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hash_is_stable_and_distinguishes_frames() {
        assert_eq!(hash_frame(b"abc"), hash_frame(b"abc"));
        assert_ne!(hash_frame(b"abc"), hash_frame(b"abd"));
    }
}
