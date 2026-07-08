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

/// How long the overlay's Dismiss button stays disabled after it appears.
/// Enforced here, not just in the overlay's own countdown UI — see `dismiss`.
///
/// TODO(friction 4.1): `uninstall.rs` has a dedicated cool-off store for the
/// uninstall flow, but there's no *generalized* friction store yet that other
/// features (like this dwell timer) could hook into to make it user-
/// configurable-but-gated (e.g. "shortening the dwell requires the same kind
/// of deliberate, delayed confirmation as uninstalling does"). Once one
/// exists, this constant is the obvious place to read from it instead of
/// being fixed. Not inventing that store here — this stays a plain constant
/// and the existing Settings path (none, currently) is unchanged.
pub const DWELL: Duration = Duration::from_secs(30);

/// After a legitimate dismiss, how long re-escalation is suppressed for that
/// monitor. Long enough that a single paused-video/false-positive moment
/// doesn't immediately retrigger while the user is still looking at the same
/// content; short enough that it's not a way to silence protection for a
/// whole session.
pub const COOLDOWN: Duration = Duration::from_secs(5 * 60);

fn label_for(monitor_id: u32) -> String {
    format!("pp-overlay-{monitor_id}")
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
}

impl OverlayState {
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
        self.tracks.lock().unwrap().insert(
            monitor_id,
            Track { shown_at: Instant::now(), cooldown_until: None },
        );
    }

    fn mark_dismissed(&self, monitor_id: u32) {
        let until = Instant::now() + COOLDOWN;
        let mut g = self.tracks.lock().unwrap();
        g.entry(monitor_id)
            .and_modify(|t| t.cooldown_until = Some(until))
            .or_insert(Track { shown_at: Instant::now(), cooldown_until: Some(until) });
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
        .title("Pure Path")
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
    let dwell_elapsed = {
        let g = state.tracks.lock().unwrap();
        match g.get(&monitor_id) {
            Some(t) => t.shown_at.elapsed() >= DWELL,
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
