//! The AI action layer's only actuator (Phase 4 flagship — plan item 2.1):
//! a fullscreen, always-on-top "take a breath" overlay opened on the monitor
//! that triggered a persistent (not single-frame) NSFW verdict. See
//! `lib.rs::run_monitor` for the Clear -> Suspect -> Acting state machine that
//! decides *when* to call `open`/`close` here — this module only owns the
//! window itself: building it, keeping it off the very screen-capture that
//! triggered it, and gating its Dismiss button server-side.
//!
//! Deliberately the AI's *only* actuator besides the existing redirect-open —
//! no killing processes, no shutdown, nothing irreversible. The webview is
//! not a trust boundary, so the one thing that must never be decided by the
//! overlay's own JS is *when it's allowed to close*: `dismiss` re-checks the
//! dwell timer against a server-side clock before honoring it.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// How long the overlay's Dismiss button stays disabled after it appears —
/// the DEFAULT value, before the false-positive auto-tune (2.4) is applied.
/// Enforced server-side, not just in the overlay's own countdown UI — see
/// `dismiss`.
///
/// This is no longer a fixed constant in practice: `evallog::tuned_dwell_secs`
/// shortens it (never below `evallog::MIN_DWELL_SECS`) as the user reports
/// false positives, so a model that keeps interrupting them wrongly costs less
/// of their time each time. It never shortens to zero and it never affects
/// *detection* — see evallog.rs for why that boundary is where it is.
pub const DWELL: Duration = Duration::from_secs(crate::evallog::DEFAULT_DWELL_SECS);

/// After a legitimate dismiss, how long re-escalation is suppressed for that
/// monitor. Long enough that a single paused-video/false-positive moment
/// doesn't immediately retrigger while the user is still looking at the same
/// content; short enough that it's not a way to silence protection for a
/// whole session.
pub const COOLDOWN: Duration = Duration::from_secs(5 * 60);

fn label_for(monitor_id: u32) -> String {
    format!("pp-overlay-{monitor_id}")
}

/// The dwell actually required right now: the default, reduced by the
/// false-positive auto-tune (2.4) and floored at `evallog::MIN_DWELL_SECS`.
/// Falls back to the untuned default if the app data dir can't be resolved —
/// an unreadable log must never *shorten* the pause.
pub fn required_dwell(app: &AppHandle) -> Duration {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return DWELL };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Duration::from_secs(crate::evallog::tuned_dwell_secs(&dir, now))
}

/// Per-monitor bookkeeping the tauri command handler (`dismiss_overlay`)
/// needs but the monitor thread's own local track (in `lib.rs`) can't give
/// it — the thread's `HashMap<u32, MonitorTrack>` is a plain local variable,
/// not shared state, so this is the one piece of overlay state that has to
/// live behind `AppHandle::manage` instead.
#[derive(Default)]
pub struct OverlayState {
    tracks: Mutex<HashMap<u32, Track>>,
}

struct Track {
    shown_at: Instant,
    cooldown_until: Option<Instant>,
    /// What the ensemble actually saw when this overlay was opened (2.4).
    /// Recorded here, at escalation time, so a false-positive report carries
    /// the model's real numbers — the overlay's own JS never supplies them,
    /// because the webview is not a trust boundary and a self-reported score
    /// would make the eval log worthless as a record.
    evidence: Option<Evidence>,
}

/// The scores + frame digest behind one escalation. Never contains the frame,
/// a thumbnail, or anything reconstructible — see evallog.rs.
#[derive(Debug, Clone)]
pub struct Evidence {
    pub siglip_nsfw: f32,
    pub nudenet_explicit: f32,
    pub screen_hash: String,
}

impl OverlayState {
    /// Record what triggered this monitor's escalation, for a possible
    /// false-positive report. Called by the monitor thread immediately before
    /// `open`.
    pub fn set_evidence(&self, monitor_id: u32, evidence: Evidence) {
        let mut g = self.tracks.lock().unwrap();
        g.entry(monitor_id)
            .and_modify(|t| t.evidence = Some(evidence.clone()))
            .or_insert(Track {
                shown_at: Instant::now(),
                cooldown_until: None,
                evidence: Some(evidence),
            });
    }

    /// The evidence behind this monitor's current overlay, if any.
    pub fn evidence(&self, monitor_id: u32) -> Option<Evidence> {
        self.tracks.lock().unwrap().get(&monitor_id).and_then(|t| t.evidence.clone())
    }

    /// True while `monitor_id` is within its post-dismiss cooldown window —
    /// `run_monitor` checks this before letting a fresh escalation open a new
    /// overlay, capping it at `Suspect` instead.
    pub fn in_cooldown(&self, monitor_id: u32) -> bool {
        self.tracks
            .lock()
            .unwrap()
            .get(&monitor_id)
            .and_then(|t| t.cooldown_until)
            .map(|until| Instant::now() < until)
            .unwrap_or(false)
    }

    fn mark_shown(&self, monitor_id: u32) {
        // Preserve any evidence `set_evidence` just recorded for this
        // escalation — it is written immediately BEFORE the window opens, so a
        // blind insert here would throw it away every time.
        let mut g = self.tracks.lock().unwrap();
        let evidence = g.get(&monitor_id).and_then(|t| t.evidence.clone());
        g.insert(
            monitor_id,
            Track { shown_at: Instant::now(), cooldown_until: None, evidence },
        );
    }

    fn mark_dismissed(&self, monitor_id: u32) {
        let until = Instant::now() + COOLDOWN;
        let mut g = self.tracks.lock().unwrap();
        g.entry(monitor_id)
            .and_modify(|t| t.cooldown_until = Some(until))
            .or_insert(Track { shown_at: Instant::now(), cooldown_until: Some(until), evidence: None });
    }
}

/// Build the fullscreen overlay on the monitor that triggered escalation.
/// Idempotent: a monitor that already has an open overlay window (same
/// label) is left alone rather than rebuilt.
///
/// Positioned via `screen::monitor_geometry` (converted from xcap's physical
/// pixels to the logical pixels Tauri's builder expects) *before* requesting
/// fullscreen, so fullscreen expands on the correct display rather than
/// wherever the OS would otherwise place a new window.
pub fn open(app: &AppHandle, state: &OverlayState, monitor_id: u32) -> Result<(), String> {
    let label = label_for(monitor_id);
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let (x, y, w, h, scale) = crate::screen::monitor_geometry(monitor_id)
        .ok_or_else(|| format!("monitor {monitor_id} is no longer connected"))?;
    let scale = if scale > 0.0 { scale as f64 } else { 1.0 };

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()))
        .title("Oath Light")
        .position(x as f64 / scale, y as f64 / scale)
        .inner_size(w as f64 / scale, h as f64 / scale)
        .fullscreen(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .decorations(false)
        .closable(false)
        .build()
        .map_err(|e| format!("build overlay window: {e}"))?;

    exclude_from_capture(&window);

    state.mark_shown(monitor_id);
    let _ = app.emit(
        "nsfw-overlay",
        &serde_json::json!({ "event": "escalated", "monitor_id": monitor_id }),
    );
    Ok(())
}

/// Close the overlay for `monitor_id` if one is open. This is the "natural
/// de-escalation" path (5 consecutive clean scans back to Clear) — it does
/// NOT start a cooldown; only a user-initiated `dismiss` does that.
pub fn close(app: &AppHandle, monitor_id: u32) {
    if let Some(w) = app.get_webview_window(&label_for(monitor_id)) {
        let _ = w.close();
    }
}

/// Handle a user-initiated Dismiss. Refuses unless the server-tracked dwell
/// timer for this monitor's overlay has actually elapsed — the overlay's own
/// on-screen countdown is UI only; this is what actually enforces it, per the
/// house rule that the webview is not a trust boundary. On success, closes
/// the window, starts the re-escalation cooldown, and emits `dismissed`.
pub fn dismiss(app: &AppHandle, state: &OverlayState, monitor_id: u32) -> Result<(), String> {
    // The dwell in force is the auto-tuned one (2.4), floored — see evallog.rs.
    // Derived per call rather than cached so a report made from THIS overlay
    // shortens THIS overlay's remaining wait, which is the behaviour that
    // makes the feature feel honest rather than theoretical.
    let dwell = required_dwell(app);
    let dwell_elapsed = {
        let g = state.tracks.lock().unwrap();
        match g.get(&monitor_id) {
            Some(t) => t.shown_at.elapsed() >= dwell,
            None => false, // nothing tracked — no legitimately-open overlay to dismiss
        }
    };
    if !dwell_elapsed {
        return Err("Not yet — take a moment before dismissing.".to_string());
    }

    close(app, monitor_id);
    state.mark_dismissed(monitor_id);
    let _ = app.emit(
        "nsfw-overlay",
        &serde_json::json!({ "event": "dismissed", "monitor_id": monitor_id }),
    );
    Ok(())
}

/// Exclude the overlay window from the very screen-capture pipeline that
/// triggered it (Windows' `WDA_EXCLUDEFROMCAPTURE`) — without this, the
/// monitor loop would see its own overlay full of ensemble-classified content
/// (whatever's still `Acting`), forever re-triggering escalation with the
/// overlay itself as the "evidence" and deadlocking at `Acting`. Best-effort:
/// if the HWND can't be resolved or the API call fails, the overlay still
/// opens (favoring "the user got interrupted" over "nothing happened at
/// all") but a warning is logged since the deadlock risk is real.
#[cfg(target_os = "windows")]
fn exclude_from_capture(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};

    match window.hwnd() {
        Ok(hwnd) => {
            // Safety: `hwnd` was just returned by Tauri for a window we own and
            // that is still alive on this thread; `SetWindowDisplayAffinity` is
            // a plain user32 call taking a valid HWND + enum value, no aliasing
            // or lifetime hazards.
            let res = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
            if let Err(e) = res {
                log::warn!(
                    "SetWindowDisplayAffinity failed — overlay may be visible to its own \
                     triggering capture, risking an escalation deadlock: {e}"
                );
            }
        }
        Err(e) => log::warn!("could not resolve overlay HWND for capture-exclusion: {e}"),
    }
}

#[cfg(not(target_os = "windows"))]
fn exclude_from_capture(_window: &tauri::WebviewWindow) {}
