//! Screen capture + cheap change detection for the NSFW monitor.
//!
//! The classifier (~92.9M params) is too expensive to run on every frame, so we
//! poll the screen, keep a tiny grayscale "fingerprint" of each frame, and only
//! invoke the model when the fingerprint changes meaningfully (a new page, a new
//! image, an app switch) — not for cursor blinks or clock ticks.

use image::imageops::FilterType;
use image::RgbaImage;
use xcap::Monitor;

/// Capture the primary monitor (falls back to the first available monitor).
pub fn capture_primary() -> Result<RgbaImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitors found".to_string())?;
    monitor.capture_image().map_err(|e| format!("capture: {e}"))
}

/// Capture every connected monitor (multi-monitor blind-spot fix — a second
/// display used to never be scanned at all). Returns `(monitor id, frame)`
/// pairs; `Monitor::id()` is fallible on some platforms so a monitor whose id
/// can't be read is skipped rather than aborting the whole poll, and likewise
/// a monitor that fails to capture (mid-hot-plug, permissions, a screen that
/// just went to sleep) is skipped rather than dropping every other display's
/// frame for the tick. The caller (`run_monitor`) keys its per-monitor
/// fingerprint/state off this id, so a monitor that vanishes between polls
/// simply stops appearing here and its state is dropped there.
pub fn capture_all() -> Result<Vec<(u32, RgbaImage)>, String> {
    let monitors = Monitor::all().map_err(|e| format!("enumerate monitors: {e}"))?;
    let mut out = Vec::with_capacity(monitors.len());
    for m in &monitors {
        let id = match m.id() {
            Ok(id) => id,
            Err(e) => {
                log::warn!("monitor id unavailable, skipping: {e}");
                continue;
            }
        };
        match m.capture_image() {
            Ok(img) => out.push((id, img)),
            Err(e) => log::warn!("capture failed for monitor {id}: {e}"),
        }
    }
    Ok(out)
}

/// Physical `(x, y, width, height, scale_factor)` of the still-connected
/// monitor with this xcap id, or `None` if it's gone (unplugged) or its id
/// lookup fails. Used to place the action-layer overlay (see `overlay.rs`) on
/// the exact monitor that triggered it, converting xcap's physical-pixel
/// geometry to the logical pixels Tauri's window builder expects.
pub fn monitor_geometry(id: u32) -> Option<(i32, i32, u32, u32, f32)> {
    let monitors = Monitor::all().ok()?;
    let m = monitors.iter().find(|m| m.id().ok() == Some(id))?;
    Some((
        m.x().ok()?,
        m.y().ok()?,
        m.width().ok()?,
        m.height().ok()?,
        m.scale_factor().unwrap_or(1.0),
    ))
}

/// Downscale to a `size`x`size` grayscale fingerprint for cheap diffing.
pub fn fingerprint(img: &RgbaImage, size: u32) -> Vec<u8> {
    let small = image::imageops::resize(img, size, size, FilterType::Triangle);
    small
        .pixels()
        .map(|p| {
            let [r, g, b, _] = p.0;
            // Rec.601 luma.
            ((r as u32 * 299 + g as u32 * 587 + b as u32 * 114) / 1000) as u8
        })
        .collect()
}

/// Mean absolute difference between two equal-length fingerprints (0..=255).
/// Returns 255 (max change) if they are mismatched/empty so the first frame and
/// any size change always trigger a scan.
pub fn change_score(a: &[u8], b: &[u8]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return 255.0;
    }
    let sum: u64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64)
        .sum();
    sum as f32 / a.len() as f32
}
