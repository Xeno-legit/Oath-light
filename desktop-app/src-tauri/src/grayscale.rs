//! Grayscale during vulnerable hours (plan item 5.6) — the environment nudge.
//!
//! ## Why
//! Desaturation measurably reduces stimulation-seeking; it's the reason
//! greyscale-your-phone is standard advice in attention research and why the
//! trick keeps resurfacing in recovery communities. Windows has had a
//! system-wide colour filter built in since 1809, so the whole feature is a
//! registry toggle we can drive during the user's own risk window. No blocker
//! does this.
//!
//! ## What it is NOT
//! This is an *environment* setting, not a protection. It blocks nothing and
//! filters nothing — it makes the hour it's on less rewarding to spend badly.
//! That distinction decides its friction rules (see below).
//!
//! ## Friction: deliberately none on the way out
//! Every protection in this app is instant to strengthen and slow to weaken.
//! Grayscale is exempt, on purpose: turning it off unblocks nothing, and
//! someone who needs colour to do their job at 11pm — a designer, a
//! photographer, anyone reading a chart — must not be locked out of their own
//! display for 24 hours by a wellbeing nudge. Applying the friction rule here
//! would be cargo-culting it. Serious Mode still forces it on.
//!
//! ## Honest limitation
//! Windows applies `ColorFiltering` live in current builds — the Settings app
//! writes exactly these values — but on some builds/policies the change is
//! only picked up at the next sign-in or via the Ctrl+Win+C hotkey. The UI
//! copy says so rather than promising an instant flip we can't guarantee. The
//! previous filter type is captured before the first change and restored on
//! the way out, so a user who normally runs a colour-blindness filter gets
//! their own setting back rather than ours.

#[cfg(target_os = "windows")]
const REG_KEY: &str = r"HKCU\Software\Microsoft\ColorFiltering";

/// `FilterType` value for grayscale. (1..=5 are the colour-blindness filters;
/// 0 is grayscale.)
#[cfg(target_os = "windows")]
const FILTER_GRAYSCALE: u32 = 0;

#[cfg(target_os = "windows")]
mod imp {
    use super::{FILTER_GRAYSCALE, REG_KEY};
    use std::sync::Mutex;

    /// `CREATE_NO_WINDOW`, so driving `reg` never flashes a console — same
    /// pattern as browsers.rs and watchdog.rs.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn reg() -> std::process::Command {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("reg");
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    /// What the user's colour filter looked like before we first touched it,
    /// so it can be handed back exactly. `None` = we haven't changed anything
    /// yet this run.
    static SAVED: Mutex<Option<(u32, u32)>> = Mutex::new(None);

    /// Read a DWORD from the colour-filtering key, or `None` if absent.
    fn read_dword(value: &str) -> Option<u32> {
        let out = reg().args(["query", REG_KEY, "/v", value]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        // `reg query` prints "    Active    REG_DWORD    0x1"
        let hex = text
            .lines()
            .find(|l| l.contains(value))?
            .split_whitespace()
            .next_back()?
            .trim_start_matches("0x")
            .to_string();
        u32::from_str_radix(&hex, 16).ok()
    }

    fn write_dword(value: &str, data: u32) -> bool {
        reg()
            .args(["add", REG_KEY, "/v", value, "/t", "REG_DWORD", "/d", &data.to_string(), "/f"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    pub fn is_active() -> bool {
        read_dword("Active").unwrap_or(0) == 1
    }

    pub fn set(on: bool) -> Result<(), String> {
        if on {
            // Capture the user's own settings once, before the first change,
            // so restore hands back exactly what they had.
            {
                let mut saved = SAVED.lock().unwrap();
                if saved.is_none() {
                    *saved = Some((read_dword("Active").unwrap_or(0), read_dword("FilterType").unwrap_or(FILTER_GRAYSCALE)));
                }
            }
            let ok = write_dword("FilterType", FILTER_GRAYSCALE) && write_dword("Active", 1);
            if ok { Ok(()) } else { Err("Could not write the Windows colour-filter setting.".into()) }
        } else {
            let saved = SAVED.lock().unwrap().take();
            let (active, filter) = saved.unwrap_or((0, FILTER_GRAYSCALE));
            let ok = write_dword("FilterType", filter) && write_dword("Active", active);
            if ok { Ok(()) } else { Err("Could not restore the Windows colour-filter setting.".into()) }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    //! Non-Windows: there is no equivalent single system toggle, and Oath
    //! Light is Windows-first. Reports "not active" and refuses politely
    //! rather than pretending to have done something.
    pub fn is_active() -> bool {
        false
    }
    pub fn set(_on: bool) -> Result<(), String> {
        Err("Grayscale mode is only available on Windows.".to_string())
    }
}

/// Is the system colour filter currently on?
pub fn is_active() -> bool {
    imp::is_active()
}

/// Turn the system grayscale filter on or off. Turning it OFF restores
/// whatever the user had before Oath Light first turned it on.
pub fn set(on: bool) -> Result<(), String> {
    imp::set(on)
}
