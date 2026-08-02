//! reminder.rs — the vulnerable-hours nudge, fired by the desktop app.
//!
//! This used to live in the browser extension (`bg/reminders.js`), which drew
//! an in-page card on whatever tab happened to be in front. That had two
//! problems worth moving for: it only ever reached someone who had a browser
//! open on a page the content script runs on, and it made a *reminder* — pure
//! encouragement, no enforcement — depend on the extension being alive.
//!
//! So it moved here. The desktop app is always running (that is the one thing
//! the watchdog guarantees), so a nudge from this side actually arrives.
//!
//! What did NOT move is deciding *when* the vulnerable-hours window is open.
//! That is still the extension's job (`bg/vulnerable-window.js`) for the
//! lockdown escalation, because that path needs the browser's own local-time
//! context. This module needs the same answer for itself, and gets it without
//! a timezone database or a new dependency: `GetLocalTime()` hands back local
//! wall-clock hours and minutes directly, already adjusted for the machine's
//! zone and DST. Same hand-rolled-FFI house style as `watchdog.rs` and
//! `friction.rs`.
//!
//! ## Deliberately weak
//!
//! Everything else in this app is a protection, and protections here do not
//! have off switches. This is the exception, and it should be: it is a kind
//! word on a schedule the user chose. It is opt-in per type, it can be turned
//! off instantly with no cool-off (turning off a nudge weakens nothing), and
//! the window auto-dismisses on its own. It must never be mistaken for, or
//! grow into, an enforcement surface — nothing in here blocks, locks, covers
//! the screen, or reports anything anywhere.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// How often a reminder can fire, at most — matches the cadence the extension
/// used ("roughly twice an hour", which is what the Settings copy promises).
const PERIOD: Duration = Duration::from_secs(30 * 60);

/// How long the card stays up before closing itself. Long enough to read
/// twice, short enough that it never needs dismissing.
const VISIBLE_SECS: u64 = 12;

const WINDOW_LABEL: &str = "oathlight-reminder";
const CARD_W: f64 = 380.0;
const CARD_H: f64 = 150.0;
/// Gap from the bottom-right corner of the work area, in logical pixels.
const MARGIN: f64 = 24.0;

// ============================================================================
// Local wall-clock time (no timezone database, no new crate)
// ============================================================================

#[cfg(windows)]
mod localtime {
    #[repr(C)]
    #[derive(Default)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    extern "system" {
        fn GetLocalTime(out: *mut SystemTime);
    }

    /// Minutes since local midnight. Already zone- and DST-adjusted by
    /// Windows, which is the whole reason this is an FFI call rather than
    /// arithmetic on `SystemTime::now()` (that yields UTC, and correcting it
    /// would need exactly the timezone database this crate doesn't carry).
    pub fn minutes_since_midnight() -> u32 {
        let mut st = SystemTime::default();
        // SAFETY: GetLocalTime writes a SYSTEMTIME into the pointer we own and
        // has no failure mode.
        unsafe { GetLocalTime(&mut st) };
        u32::from(st.hour) * 60 + u32::from(st.minute)
    }
}

#[cfg(not(windows))]
mod localtime {
    /// Non-Windows development fallback. Oath Light is Windows-first; this
    /// exists so the crate builds elsewhere. It reports UTC, so a
    /// vulnerable-hours window will be evaluated against the wrong clock on a
    /// machine that isn't on UTC — acceptable for a nudge on a platform we do
    /// not ship, and never used for any enforcement decision.
    pub fn minutes_since_midnight() -> u32 {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        ((secs % 86_400) / 60) as u32
    }
}

/// Parse `"HH:MM"` into minutes since midnight. Mirrors the extension's own
/// lenient parse (clamping rather than rejecting an out-of-range hour) so the
/// two sides never disagree about what a stored window means.
fn parse_hhmm(s: &str) -> Option<u32> {
    let t = s.trim();
    let (h, m) = t.split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    Some(h.min(23) * 60 + m.min(59))
}

/// Is `now_min` inside `[start, end)`? Handles overnight windows (22:00 →
/// 06:00) and treats `start == end` as "the whole day", exactly as
/// `isWithinWindow` does in `bg/vulnerable-window.js`. Pure and total so it
/// can be unit-tested without a clock.
fn within(start: &str, end: &str, now_min: u32) -> bool {
    let (Some(a), Some(z)) = (parse_hhmm(start), parse_hhmm(end)) else {
        return false;
    };
    if a == z {
        return true;
    }
    if a < z {
        now_min >= a && now_min < z
    } else {
        now_min >= a || now_min < z
    }
}

// ============================================================================
// Copy
// ============================================================================

/// The rotating pool for the "Motivational reminder" type, carried over from
/// the extension verbatim so nobody loses a line they'd grown used to.
const QUOTES: &[&str] = &[
    "The man who moves a mountain begins by carrying away small stones.",
    "You are not your urges. You are the one who notices them — and chooses.",
    "Discipline is choosing between what you want now and what you want most.",
    "Every time you say no, the next no gets easier. You are rewiring yourself.",
    "The urge always passes. Outlast it — ride the wave, don't feed it.",
    "Who you become is built from the moments you refuse to give in.",
    "Fall seven times, stand up eight. The streak is the man, not the number.",
    "Close the tab. Take a walk. Future-you is already grateful.",
];

const QUOTES_SERIOUS: &[&str] = &[
    "Move the mountain one stone at a time. Start.",
    "The urge is not you. Notice it. Choose.",
    "What you want now, or what you want most. Pick.",
    "Every no makes the next no easier.",
    "It passes. Outlast it.",
    "You are built from the moments you refused.",
    "Stand up. The streak is the man, not the number.",
    "Close the tab. Walk.",
];

/// Pick a rotating line without pulling in `rand` — the process-lifetime
/// nanosecond counter is more than enough entropy for choosing a quote, and
/// this module has no business seeding a real RNG.
fn rotate<T: Copy>(pool: &[T]) -> T {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as usize)
        .unwrap_or(0);
    pool[n % pool.len()]
}

/// The card's title and body for one alert id, in the app's current voice.
/// Unknown ids fall through to the quote pool, so an alert type added to the
/// renderer's `blocking.alerts` before it is handled here degrades to a
/// reasonable nudge instead of firing nothing.
fn build(kind: &str, serious: bool) -> (String, String) {
    match (kind, serious) {
        ("checkin", false) => (
            "Still with you".into(),
            "Take a slow breath. You're stronger than this moment — it will pass.".into(),
        ),
        ("checkin", true) => ("Check in".into(), "Breathe. It passes. Hold the line.".into()),
        (_, true) => ("Remember".into(), rotate(QUOTES_SERIOUS).into()),
        (_, false) => ("Remember your why".into(), rotate(QUOTES).into()),
    }
}

// ============================================================================
// Firing
// ============================================================================

/// Last-fired anchor. `Instant` (monotonic) rather than wall clock: this is a
/// rate limit, and a rate limit that can be reset by moving the system clock
/// would let the same nudge fire in a loop.
pub struct ReminderState {
    last: Mutex<Option<Instant>>,
}

impl ReminderState {
    pub fn new() -> Self {
        Self { last: Mutex::new(None) }
    }
}

impl Default for ReminderState {
    fn default() -> Self {
        Self::new()
    }
}

/// Show the card. Replaces any existing one (reminders never stack), positions
/// it bottom-right of the primary monitor, and closes itself after
/// `VISIBLE_SECS`.
///
/// `focused(false)` matters more than it looks: a reminder that steals focus
/// mid-sentence is an interruption, not a nudge, and would train the user to
/// resent it.
fn show(app: &AppHandle, title: &str, body: &str) {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        let _ = existing.close();
    }

    // Bottom-right of the primary monitor's work area, in logical pixels.
    let (x, y) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let size = m.size().to_logical::<f64>(scale);
            let pos = m.position().to_logical::<f64>(scale);
            (
                pos.x + size.width - CARD_W - MARGIN,
                pos.y + size.height - CARD_H - MARGIN * 3.0,
            )
        }
        _ => (MARGIN, MARGIN),
    };

    let url = format!(
        "reminder.html?title={}&body={}",
        urlencode(title),
        urlencode(body)
    );

    let built = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title("Oath Light")
        .inner_size(CARD_W, CARD_H)
        .position(x, y)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .shadow(true)
        .build();

    match built {
        Ok(w) => {
            let handle = w.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(VISIBLE_SECS));
                let _ = handle.close();
            });
        }
        Err(e) => log::warn!("reminder: could not build window: {e}"),
    }
}

/// Percent-encode for a query string. Deliberately conservative — everything
/// that isn't unreserved gets escaped — because the values are display copy
/// that may contain apostrophes, em dashes and spaces.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// One check. Called once a minute from the applier heartbeat in `lib.rs`;
/// cheap and almost always a no-op — it returns before touching any UI unless
/// the window is genuinely open, a type is genuinely enabled, and `PERIOD` has
/// genuinely elapsed.
///
/// `blocking` is the renderer-pushed blocking settings (`AppState.ext_blocking`),
/// which is where `vulnerable` and `alerts` already live — no new persistence
/// and no new command surface for this feature.
pub fn tick(
    app: &AppHandle,
    state: &ReminderState,
    blocking: Option<&serde_json::Value>,
    serious: bool,
) {
    let Some(b) = blocking else { return };

    let v = &b["vulnerable"];
    if !v["on"].as_bool().unwrap_or(false) {
        return;
    }
    let (Some(start), Some(end)) = (v["start"].as_str(), v["end"].as_str()) else {
        return;
    };
    if !within(start, end, localtime::minutes_since_midnight()) {
        return;
    }

    // Which nudge types the user actually left switched on.
    let enabled: Vec<&str> = b["alerts"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|x| x["on"].as_bool().unwrap_or(false))
                .filter_map(|x| x["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    if enabled.is_empty() {
        return;
    }

    {
        let mut last = state.last.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < PERIOD {
                return;
            }
        }
        *last = Some(Instant::now());
    }

    let kind = rotate(&enabled);
    let (title, body) = build(kind, serious);
    show(app, &title, &body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daytime_window_is_inclusive_of_start_exclusive_of_end() {
        assert!(!within("09:00", "17:00", 8 * 60 + 59));
        assert!(within("09:00", "17:00", 9 * 60));
        assert!(within("09:00", "17:00", 16 * 60 + 59));
        assert!(!within("09:00", "17:00", 17 * 60));
    }

    /// The case the extension's own helper was written for, and the one a
    /// naive `start <= now < end` gets wrong.
    #[test]
    fn overnight_window_wraps_past_midnight() {
        assert!(within("22:00", "06:00", 23 * 60));
        assert!(within("22:00", "06:00", 0));
        assert!(within("22:00", "06:00", 5 * 60 + 59));
        assert!(!within("22:00", "06:00", 6 * 60));
        assert!(!within("22:00", "06:00", 12 * 60));
    }

    /// `start == end` means the whole day — matching `isWithinWindow`. If this
    /// ever flipped to "never", a user with an all-day window would silently
    /// stop being nudged.
    #[test]
    fn equal_bounds_cover_the_whole_day() {
        assert!(within("00:00", "00:00", 0));
        assert!(within("13:37", "13:37", 12 * 60));
    }

    #[test]
    fn unparseable_window_never_fires() {
        assert!(!within("", "06:00", 60));
        assert!(!within("22:00", "not-a-time", 60));
        assert!(!within("2200", "0600", 60));
    }

    #[test]
    fn hhmm_clamps_rather_than_rejecting() {
        assert_eq!(parse_hhmm("09:05"), Some(545));
        assert_eq!(parse_hhmm("99:99"), Some(23 * 60 + 59));
        assert_eq!(parse_hhmm("7:5"), Some(7 * 60 + 5));
    }

    #[test]
    fn checkin_has_its_own_copy_in_both_voices() {
        let (t1, _) = build("checkin", false);
        let (t2, _) = build("checkin", true);
        assert_ne!(t1, t2);
        // An unknown id must still produce something, not an empty card.
        let (t3, b3) = build("something-new", false);
        assert!(!t3.is_empty() && !b3.is_empty());
    }

    #[test]
    fn urlencode_escapes_copy_safely() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("don't"), "don%27t");
        assert_eq!(urlencode("Ok-1_2.3~"), "Ok-1_2.3~");
    }
}
