//! Tamper-evident event log (plan item 4.5).
//!
//! Append-only JSONL of protective events — uninstall requests, friction
//! transitions, clock anomalies, monitor escalations, process kills — each
//! entry hash-chained to the previous one so that editing, deleting, or
//! truncating history is *detectable* even though it can't be prevented (a
//! user with admin rights on their own machine can always touch a file on
//! disk; the point is that tampering leaves unmistakable evidence, not that
//! it's impossible — see [`verify`]/[`EventLog::load`]).
//!
//! Lives in `oathlight-core` (not `src-tauri`) on purpose: the shape and the
//! hashing math have nothing Tauri- or Windows-specific about them, and the
//! future DNS resolver / mobile bindings (plan Part H) may want their own
//! log using the exact same format.
//!
//! ## Format
//! One JSON object per line:
//! ```text
//! {"seq":1,"ts":1731000000,"kind":"uninstall_requested","data":{...},"prev":"<64-hex>","hash":"<64-hex>"}
//! ```
//! `hash = hex(sha256(seq ‖ SEP ‖ ts ‖ SEP ‖ kind ‖ SEP ‖ canonical(data) ‖ SEP ‖ prev))`
//! where `‖` is concatenation and `SEP` is a single ASCII SOH byte (0x01) —
//! chosen because it can never appear inside any of the human-readable
//! fields, so two different (seq, ts, kind, data, prev) tuples can never
//! collide onto the same pre-image just because a plain `+`-style
//! concatenation would blur a field boundary (e.g. `seq=1, ts=23` vs.
//! `seq=12, ts=3`). `canonical(data)` is defined by [`canonical_json`] below:
//! object keys sorted recursively (via `BTreeMap`), arrays left in original
//! order, so the exact same logical JSON value always hashes identically
//! regardless of how it happened to be constructed.
//!
//! The very first entry's `prev` is the fixed constant [`GENESIS_PREV`].
//!
//! ## Tamper evidence
//! Two independent things are checked on [`EventLog::load`]:
//!   1. **In-file integrity** — every entry's `seq`/`prev`/`hash` must chain
//!      correctly from the one before it. A hand-edited field, a deleted
//!      middle line, or a corrupted/truncated last line all break this.
//!   2. **A sidecar checkpoint** (`<file>.checkpoint.json`, just `{seq,
//!      hash}` of the last entry appended) written after every successful
//!      append. If the log file itself is deleted or rolled back to an
//!      earlier state wholesale — which by itself would otherwise look like
//!      "a shorter, but perfectly self-consistent, chain" — the checkpoint
//!      still remembers a longer chain existed, so that too is detected.
//!
//! Either kind of break causes [`EventLog::load`] to keep whatever valid
//! entries it found (never silently discards evidence) and append one
//! `chain_restarted` entry documenting what it found, before resuming normal
//! operation — see that function's doc comment.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// `prev` of the very first entry in a fresh chain (or a freshly-restarted
/// segment that has no earlier valid entry to chain off of).
pub const GENESIS_PREV: &str = "OATHLIGHT-EVENTLOG-GENESIS-V1";

/// Rotate to a new file once the current one reaches this size.
pub const ROTATE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

/// Field separator used only inside the hash pre-image (see the module doc)
/// — never written to the JSONL file itself, which uses normal JSON.
const SEP: u8 = 0x01;

fn now_wall() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

// ============================================================================
// Canonical JSON (for hashing only — the file itself stores whatever
// `serde_json::to_string` produces for the `Entry`, which is irrelevant to
// verification since the hash is recomputed from the individual fields, not
// by re-serializing the whole `Entry`).
// ============================================================================

/// Recursively sort every object's keys (via `BTreeMap`) so the exact same
/// logical JSON value always canonicalizes to the same string, regardless of
/// what order its keys happened to be constructed/inserted in. Arrays keep
/// their original element order (order is semantically meaningful there).
fn canon(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let sorted: BTreeMap<String, Value> =
                map.iter().map(|(k, v)| (k.clone(), canon(v))).collect();
            let mut out = serde_json::Map::with_capacity(sorted.len());
            for (k, v) in sorted {
                out.insert(k, v);
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canon).collect()),
        other => other.clone(),
    }
}

/// Deterministic string form of a JSON value — see the module doc's `canonical(data)`.
pub fn canonical_json(v: &Value) -> String {
    serde_json::to_string(&canon(v)).unwrap_or_default()
}

fn compute_hash(seq: u64, ts: u64, kind: &str, data: &Value, prev: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seq.to_string().as_bytes());
    hasher.update([SEP]);
    hasher.update(ts.to_string().as_bytes());
    hasher.update([SEP]);
    hasher.update(kind.as_bytes());
    hasher.update([SEP]);
    hasher.update(canonical_json(data).as_bytes());
    hasher.update([SEP]);
    hasher.update(prev.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

// ============================================================================
// Entry shape
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub seq: u64,
    pub ts: u64,
    pub kind: String,
    pub data: Value,
    pub prev: String,
    pub hash: String,
}

impl Entry {
    /// Recompute what this entry's hash *should* be from its own fields, for
    /// verification — never trust the `hash` field on disk without doing this.
    fn recomputed_hash(&self) -> String {
        compute_hash(self.seq, self.ts, &self.kind, &self.data, &self.prev)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Checkpoint {
    seq: u64,
    hash: String,
}

// ============================================================================
// Verification (pure — operates on already-read lines, so it's unit-testable
// without any file I/O)
// ============================================================================

/// Outcome of walking a sequence of raw JSONL lines from genesis.
#[derive(Debug, Clone, Default)]
struct WalkResult {
    /// Every entry that verified correctly, in order.
    valid: Vec<Entry>,
    /// True if walking stopped early because a line failed to parse, or an
    /// entry's `seq`/`prev`/`hash` didn't match what was expected.
    broke: bool,
}

/// Walk `lines` (each expected to be one JSON `Entry`) from genesis, stopping
/// at the first line that doesn't parse or doesn't chain correctly. Pure and
/// side-effect-free — the file-backed callers below layer the checkpoint
/// comparison and the `chain_restarted` repair on top of this.
fn walk_lines(lines: &[String]) -> WalkResult {
    let mut result = WalkResult::default();
    let mut expected_seq = 1u64;
    let mut expected_prev = GENESIS_PREV.to_string();

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let entry: Entry = match serde_json::from_str(trimmed) {
            Ok(e) => e,
            Err(_) => {
                result.broke = true;
                break;
            }
        };
        if entry.seq != expected_seq || entry.prev != expected_prev {
            result.broke = true;
            break;
        }
        if entry.recomputed_hash() != entry.hash {
            result.broke = true;
            break;
        }
        expected_seq += 1;
        expected_prev = entry.hash.clone();
        result.valid.push(entry);
    }
    result
}

/// Report handed back by [`verify`] / [`EventLog::verify`].
#[derive(Debug, Clone, Serialize)]
pub struct VerifyReport {
    /// True iff the WHOLE file, from true genesis, verifies with zero breaks
    /// and zero `chain_restarted` markers ever. Once false, stays false
    /// forever for this file — a past break is a permanent, honestly-reported
    /// fact, not something that "heals" once the chain resumes correctly.
    pub intact: bool,
    /// Total valid entries currently in the file.
    pub entries: usize,
    /// The `seq` of the first entry that failed verification, if any.
    pub first_break_seq: Option<u64>,
    /// Unix seconds: genesis time if `intact`, else the timestamp of the most
    /// recent `chain_restarted` marker — i.e. "intact since" for the current
    /// segment, which the UI shows in a RED banner when `intact` is false
    /// (a past break is never hidden just because things are fine again now).
    pub chain_started: Option<u64>,
    /// How many `chain_restarted` markers exist anywhere in the file.
    pub restarts: usize,
}

fn report_from(lines: &[String]) -> VerifyReport {
    let walk = walk_lines(lines);
    let mut restarts = 0usize;
    let mut last_restart_ts: Option<u64> = None;
    let mut first_entry_ts: Option<u64> = None;
    for e in &walk.valid {
        if first_entry_ts.is_none() {
            first_entry_ts = Some(e.ts);
        }
        if e.kind == "chain_restarted" {
            restarts += 1;
            last_restart_ts = Some(e.ts);
        }
    }
    let intact = !walk.broke && restarts == 0;
    let first_break_seq = if walk.broke { Some(walk.valid.len() as u64 + 1) } else { None };
    let chain_started = if intact { first_entry_ts } else { last_restart_ts.or(first_entry_ts) };
    VerifyReport {
        intact,
        entries: walk.valid.len(),
        first_break_seq,
        chain_started,
        restarts,
    }
}

/// Verify the JSONL file at `path` from genesis. Standalone function (no
/// `EventLog` needed) so a UI "Verify" button or a completely separate tool
/// can check the file without holding the live app's lock.
pub fn verify(path: &Path) -> VerifyReport {
    let lines: Vec<String> = std::fs::read_to_string(path)
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
    report_from(&lines)
}

// ============================================================================
// The live, append-only store
// ============================================================================

struct Inner {
    path: PathBuf,
    checkpoint_path: PathBuf,
    seq: u64,
    prev_hash: String,
}

pub struct EventLog {
    inner: Mutex<Inner>,
}

impl EventLog {
    /// Load (or start) the event log rooted at `<app_data_dir>/events.log`.
    ///
    /// Walks the file from genesis (see [`walk_lines`]) and compares the tip
    /// against the sidecar checkpoint (see the module doc). If everything
    /// lines up, resumes from there silently — nothing to report, this is
    /// the normal case on every ordinary restart. If the file is missing
    /// *and* there's no checkpoint either, this is a brand-new install: also
    /// silent, nothing to restart from.
    ///
    /// Otherwise — a mid-file break, or a checkpoint that remembers a longer
    /// chain than what's actually in the file — the file is NEVER truncated
    /// or rewritten to "fix" it: whatever valid entries were found are kept
    /// exactly as they are, and one `chain_restarted` entry is appended
    /// (chained off the last valid entry, or genesis if none), whose `data`
    /// records what was found so a human (or a trusted contact, see plan
    /// 5.2) can see exactly what happened: how many valid entries survived,
    /// and what the checkpoint expected instead. Deleting or editing the log
    /// is thus never silent — it becomes the next entry in the log itself.
    pub fn load(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("events.log");
        let checkpoint_path = app_data_dir.join("events.checkpoint.json");

        let lines: Vec<String> = std::fs::read_to_string(&path)
            .map(|s| s.lines().map(str::to_string).collect())
            .unwrap_or_default();
        let walk = walk_lines(&lines);

        let checkpoint: Option<Checkpoint> = std::fs::read_to_string(&checkpoint_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());

        let (last_seq, last_hash) = walk
            .valid
            .last()
            .map(|e| (e.seq, e.hash.clone()))
            .unwrap_or((0, GENESIS_PREV.to_string()));

        let checkpoint_mismatch = match &checkpoint {
            Some(cp) => cp.seq != last_seq || cp.hash != last_hash,
            None => false,
        };
        let fresh_install = lines.is_empty() && checkpoint.is_none();
        let broken = !fresh_install && (walk.broke || checkpoint_mismatch);

        let log = Self {
            inner: Mutex::new(Inner {
                path,
                checkpoint_path,
                seq: last_seq,
                prev_hash: last_hash,
            }),
        };

        if broken {
            let data = serde_json::json!({
                "valid_entries_found": walk.valid.len(),
                "file_had_unreadable_tail": walk.broke,
                "checkpoint_seq": checkpoint.as_ref().map(|c| c.seq),
                "checkpoint_hash": checkpoint.as_ref().map(|c| c.hash.clone()),
                "reason": "the event log file did not match its own internal chain and/or the last-known checkpoint on load — it may have been edited, truncated, or partially deleted",
            });
            log.append("chain_restarted", data);
        }

        log
    }

    fn write_checkpoint(&self, inner: &Inner) {
        let cp = Checkpoint { seq: inner.seq, hash: inner.prev_hash.clone() };
        if let Ok(s) = serde_json::to_string(&cp) {
            let _ = std::fs::write(&inner.checkpoint_path, s);
        }
    }

    fn current_size(inner: &Inner) -> u64 {
        std::fs::metadata(&inner.path).map(|m| m.len()).unwrap_or(0)
    }

    /// If the current file has grown past [`ROTATE_BYTES`], seal it with a
    /// final entry naming the next file + its genesis hash, then switch the
    /// live state over to that new (empty) file. `verify()`/`get_event_log`
    /// only ever look at the CURRENT file — following the chain backward
    /// across a rotation boundary is a known TODO (plan 4.5's own rotation
    /// note), not attempted here.
    fn maybe_rotate(&self, inner: &mut Inner) {
        if Self::current_size(inner) < ROTATE_BYTES {
            return;
        }
        let next_path = Self::next_rotation_path(&inner.path);
        // The next segment's genesis is derived from the sealing entry's own
        // hash (once written) — see below; compute the seal entry first.
        let seal_seq = inner.seq + 1;
        let ts = now_wall();
        let next_name = next_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        // Placeholder next-genesis derived deterministically from the seal
        // entry's own eventual hash isn't knowable before it's computed, so
        // instead the next segment's genesis is the seal entry's hash itself
        // — the new file's first entry chains its `prev` to exactly that,
        // making the seal entry the cryptographic bridge between the two files.
        let data = serde_json::json!({ "next_file": next_name });
        let hash = compute_hash(seal_seq, ts, "log_rotated", &data, &inner.prev_hash);
        let entry = Entry { seq: seal_seq, ts, kind: "log_rotated".to_string(), data, prev: inner.prev_hash.clone(), hash: hash.clone() };
        Self::write_line(&inner.path, &entry);

        inner.path = next_path;
        inner.seq = 0;
        inner.prev_hash = hash;
        self.write_checkpoint(inner);
    }

    fn next_rotation_path(current: &Path) -> PathBuf {
        let dir = current.parent().map(Path::to_path_buf).unwrap_or_default();
        let mut n = 1u64;
        loop {
            let candidate = dir.join(format!("events-{n}.log"));
            if !candidate.exists() {
                return candidate;
            }
            n += 1;
        }
    }

    fn write_line(path: &Path, entry: &Entry) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let line = match serde_json::to_string(entry) {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
            let _ = f.sync_data();
        }
    }

    /// Append one entry. `kind` is a short machine-readable tag
    /// (`"uninstall_requested"`, `"clock_anomaly"`, ...); `data` is whatever
    /// structured context matters for that kind — callers must never put
    /// screen content, classification scores, or browsing history in here
    /// (plan 4.5: "event only, never content").
    pub fn append(&self, kind: &str, data: Value) -> Entry {
        let mut inner = self.inner.lock().unwrap();
        self.maybe_rotate(&mut inner);
        let seq = inner.seq + 1;
        let ts = now_wall();
        let prev = inner.prev_hash.clone();
        let hash = compute_hash(seq, ts, kind, &data, &prev);
        let entry = Entry { seq, ts, kind: kind.to_string(), data, prev, hash: hash.clone() };
        Self::write_line(&inner.path, &entry);
        inner.seq = seq;
        inner.prev_hash = hash;
        self.write_checkpoint(&inner);
        entry
    }

    /// The most recent entries in the CURRENT file, newest first, capped at
    /// `limit` (defaults to everything when `None`).
    pub fn recent(&self, limit: Option<usize>) -> Vec<Entry> {
        let path = self.inner.lock().unwrap().path.clone();
        let lines: Vec<String> = std::fs::read_to_string(&path)
            .map(|s| s.lines().map(str::to_string).collect())
            .unwrap_or_default();
        let mut entries: Vec<Entry> = lines
            .iter()
            .filter_map(|l| serde_json::from_str(l.trim()).ok())
            .collect();
        entries.reverse();
        if let Some(n) = limit {
            entries.truncate(n);
        }
        entries
    }

    /// Verify the CURRENT file from genesis — see the standalone [`verify`]
    /// function; this just resolves the live path first.
    pub fn verify(&self) -> VerifyReport {
        let path = self.inner.lock().unwrap().path.clone();
        verify(&path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_object_keys_recursively() {
        let a = json!({"b": 1, "a": {"z": 1, "y": 2}});
        let b = json!({"a": {"y": 2, "z": 1}, "b": 1});
        assert_eq!(canonical_json(&a), canonical_json(&b));
    }

    #[test]
    fn canonical_json_preserves_array_order() {
        let a = json!({"x": [3, 1, 2]});
        let b = json!({"x": [1, 2, 3]});
        assert_ne!(canonical_json(&a), canonical_json(&b));
    }

    fn make_chain(n: usize) -> Vec<String> {
        let mut prev = GENESIS_PREV.to_string();
        let mut out = Vec::new();
        for i in 1..=n {
            let seq = i as u64;
            let ts = 1000 + seq;
            let kind = format!("event_{i}");
            let data = json!({ "i": i });
            let hash = compute_hash(seq, ts, &kind, &data, &prev);
            let entry = Entry { seq, ts, kind, data, prev: prev.clone(), hash: hash.clone() };
            out.push(serde_json::to_string(&entry).unwrap());
            prev = hash;
        }
        out
    }

    #[test]
    fn walk_intact_chain_reports_all_entries_and_no_break() {
        let lines = make_chain(5);
        let walk = walk_lines(&lines);
        assert!(!walk.broke);
        assert_eq!(walk.valid.len(), 5);
        let report = report_from(&lines);
        assert!(report.intact);
        assert_eq!(report.entries, 5);
        assert_eq!(report.first_break_seq, None);
        assert_eq!(report.restarts, 0);
    }

    #[test]
    fn tampered_middle_entry_is_detected() {
        let mut lines = make_chain(5);
        // Flip a field in entry 3's data without recomputing its hash —
        // simulates hand-editing the file.
        let mut entry: Entry = serde_json::from_str(&lines[2]).unwrap();
        entry.data = json!({ "i": 999 });
        lines[2] = serde_json::to_string(&entry).unwrap();

        let walk = walk_lines(&lines);
        assert!(walk.broke);
        // Entries 1 and 2 still verify; entry 3 (index 2) is where it breaks.
        assert_eq!(walk.valid.len(), 2);
        let report = report_from(&lines);
        assert!(!report.intact);
        assert_eq!(report.first_break_seq, Some(3));
    }

    #[test]
    fn truncated_tail_is_detected() {
        let lines = make_chain(5);
        // Drop the last line entirely (simulates a crash mid-write / a
        // deleted trailing entry) and corrupt the new last line's JSON so
        // it can't even parse (a genuinely truncated write).
        let mut truncated = lines[..4].to_vec();
        truncated.push("{\"seq\":5,\"ts\":1005,\"kind\":\"event_5\",\"da".to_string());
        let walk = walk_lines(&truncated);
        assert!(walk.broke);
        assert_eq!(walk.valid.len(), 4);
    }

    #[test]
    fn empty_file_is_not_a_break() {
        let report = report_from(&[]);
        assert!(report.intact);
        assert_eq!(report.entries, 0);
        assert_eq!(report.restarts, 0);
    }

    #[test]
    fn chain_restarted_marker_makes_intact_false_even_though_walk_succeeds() {
        // A chain that includes its own `chain_restarted` entry (i.e. a
        // *previous* load already repaired a break) must still report
        // intact=false forever — the scar is permanent, not self-healing.
        let mut prev = GENESIS_PREV.to_string();
        let mut lines = Vec::new();
        for (i, kind) in ["a", "chain_restarted", "b"].iter().enumerate() {
            let seq = (i + 1) as u64;
            let ts = 2000 + seq;
            let data = json!({});
            let hash = compute_hash(seq, ts, kind, &data, &prev);
            let entry = Entry { seq, ts, kind: kind.to_string(), data, prev: prev.clone(), hash: hash.clone() };
            lines.push(serde_json::to_string(&entry).unwrap());
            prev = hash;
        }
        let report = report_from(&lines);
        assert!(!report.intact);
        assert_eq!(report.restarts, 1);
    }

    #[test]
    fn recomputed_hash_changes_if_prev_is_wrong() {
        let data = json!({"a": 1});
        let h1 = compute_hash(1, 100, "k", &data, GENESIS_PREV);
        let h2 = compute_hash(1, 100, "k", &data, "different-prev");
        assert_ne!(h1, h2);
    }
}
