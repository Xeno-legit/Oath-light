//! Trusted-contact notifier (plan item 5.2, Tier 2) — the OPTIONAL amplifier.
//!
//! Solo-first is binding (see the Frontier Plan): Tiers 0–1 (friction, frozen
//! lockdown, the tamper-evident log) ARE the accountability system for a user
//! with nobody to tell, and they ship regardless. This module implements
//! only the opt-in Tier 2: when the user has named a trusted contact (parent,
//! sibling, friend, mentor — anyone), notify them of a few DISCRETE events —
//! *that* something happened, never *what* was browsed. No browsing history,
//! no screenshots, no scores, ever.
//!
//! ## What is sent
//! A short subject + body naming the event kind and the person's own name.
//! The recipient learns, for example, "Oath Light: an uninstall was requested
//! on <name>'s computer" — and nothing more. Every send (or failure) is
//! recorded in the event log (4.5) as a `notify_sent` / `notify_failed`
//! entry carrying only the recipient address and the event kind, so a
//! suppressed notification is itself detectable.
//!
//! ## Delivery, in this order of preference
//!   1. **SMTP** via `lettre`, with the user's own host/port/username/app-
//!      password read from `<app_data_dir>/smtp.json`. Plaintext on disk —
//!      the UI copy says so honestly and tells the user to use a dedicated
//!      app-password, never their main account password.
//!   2. **`mailto:` fallback** via the existing `open_external` path when
//!      SMTP is unconfigured or fails: opens the user's own mail client with
//!      a prefilled draft. Genuinely zero-infrastructure, matches the
//!      self-hosted ethos.
//!
//! Sends ALWAYS happen on a background thread (`notify_async`) so a slow or
//! unreachable SMTP server can never block a Tauri command.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// User-supplied SMTP credentials, `<app_data_dir>/smtp.json`. Plaintext on
/// disk on purpose (documented in the UI) — this module is convenience, not
/// a secret store; a user who can read this file can already read everything
/// else in the app data dir.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SmtpConfig {
    pub host: String,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    pub username: String,
    /// A dedicated app-password, per the UI copy — NOT the account's main
    /// password.
    pub password: String,
    /// The From address; defaults to `username` when blank (most providers
    /// require From == the authenticated user anyway).
    #[serde(default)]
    pub from: String,
}

fn default_smtp_port() -> u16 {
    587
}

pub fn smtp_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("smtp.json")
}

pub fn load_smtp(app_data_dir: &Path) -> Option<SmtpConfig> {
    let s = std::fs::read_to_string(smtp_path(app_data_dir)).ok()?;
    let cfg: SmtpConfig = serde_json::from_str(&s).ok()?;
    if cfg.host.trim().is_empty() || cfg.username.trim().is_empty() {
        return None;
    }
    Some(cfg)
}

pub fn save_smtp(app_data_dir: &Path, cfg: &SmtpConfig) -> Result<(), String> {
    let _ = std::fs::create_dir_all(app_data_dir);
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(smtp_path(app_data_dir), json).map_err(|e| e.to_string())
}

/// Outcome of a single delivery attempt — the caller turns this into the
/// event-log entry (`notify_sent` / `notify_failed`) and, for `MailtoDraft`,
/// actually opens the draft via `open_external`.
pub enum SendOutcome {
    /// SMTP send succeeded.
    Sent,
    /// SMTP failed (or wasn't configured) — here's a `mailto:` URL to open as
    /// the fallback draft.
    MailtoDraft(String),
    /// Nothing could be done at all (e.g. a totally empty recipient).
    Failed(String),
}

/// Build a `mailto:` URL with a prefilled subject and body. Percent-encodes
/// the pieces so `&`, spaces, and newlines survive — `open_external` on
/// Windows routes through `url.dll,FileProtocolHandler` (not a shell), so no
/// further shell-escaping is needed, but the URL itself must still be valid.
pub fn mailto_url(to: &str, subject: &str, body: &str) -> String {
    format!(
        "mailto:{}?subject={}&body={}",
        percent_encode(to),
        percent_encode(subject),
        percent_encode(body)
    )
}

/// Minimal RFC-3986 percent-encoding (unreserved chars pass through). Small
/// hand-rolled encoder rather than pulling a whole crate for one call site.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Try to send `subject`/`body` to `to` over SMTP using `cfg`. Returns
/// `Ok(())` on success, `Err(reason)` on any failure (bad address, connect
/// failure, auth failure, ...). Blocking — callers MUST run this off the
/// command thread (see `notify_async`).
#[cfg(not(test))]
fn smtp_send(cfg: &SmtpConfig, to: &str, subject: &str, body: &str) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let from = if cfg.from.trim().is_empty() { cfg.username.clone() } else { cfg.from.clone() };
    let email = Message::builder()
        .from(from.parse().map_err(|e| format!("bad From address: {e}"))?)
        .to(to.parse().map_err(|e| format!("bad recipient address: {e}"))?)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| format!("could not build message: {e}"))?;

    let creds = Credentials::new(cfg.username.clone(), cfg.password.clone());
    // `relay` builds a submission transport that negotiates STARTTLS on the
    // standard submission port; `.port()` overrides it with the user's value.
    let mailer = SmtpTransport::relay(&cfg.host)
        .map_err(|e| format!("SMTP relay setup failed: {e}"))?
        .port(cfg.port)
        .credentials(creds)
        .build();

    mailer.send(&email).map(|_| ()).map_err(|e| format!("SMTP send failed: {e}"))
}

// In unit tests there's no real SMTP server; the delivery decision logic
// (`decide` below) is what's tested, not the network call.
#[cfg(test)]
fn smtp_send(_cfg: &SmtpConfig, _to: &str, _subject: &str, _body: &str) -> Result<(), String> {
    Err("smtp disabled in tests".to_string())
}

/// Pure delivery decision: given an optional SMTP config and a recipient,
/// decide what happens (SMTP attempt → success/mailto fallback, or straight
/// to mailto when unconfigured). Separated from the actual network call so
/// the branch logic is unit-testable without a live server.
pub fn deliver(
    app_data_dir: &Path,
    to: &str,
    subject: &str,
    body: &str,
) -> SendOutcome {
    if to.trim().is_empty() {
        return SendOutcome::Failed("no recipient address configured".to_string());
    }
    match load_smtp(app_data_dir) {
        Some(cfg) => match smtp_send(&cfg, to, subject, body) {
            Ok(()) => SendOutcome::Sent,
            Err(e) => {
                log::warn!("notify: SMTP send failed ({e}) — falling back to mailto draft");
                SendOutcome::MailtoDraft(mailto_url(to, subject, body))
            }
        },
        None => SendOutcome::MailtoDraft(mailto_url(to, subject, body)),
    }
}

/// Human copy for one notifiable event kind. Deliberately vague about the
/// "what" — only the fact and the person's name. `name` is the protected
/// person (the contact already knows whose computer this is).
pub fn message_for(kind: &str, name: &str) -> (String, String) {
    let who = if name.trim().is_empty() { "your friend".to_string() } else { name.trim().to_string() };
    let (headline, detail) = match kind {
        "uninstall_requested" => (
            "an uninstall of Oath Light was requested",
            "There's a waiting period before it can complete, and it can still be cancelled. This is just a heads-up so you can check in.",
        ),
        "lockdown_cancelled" => (
            "a lockdown was cancelled early",
            "Oath Light's lockdown mode was ended before its timer ran out. Nothing about what was browsed is shared — only that it happened.",
        ),
        "password_removal_requested" => (
            "removal of the master password was requested",
            "This starts a waiting period before the password comes off. It can still be cancelled. Just a heads-up.",
        ),
        "trusted_contact_removed" => (
            "Oath Light's trusted-contact setting is being removed",
            "You're being told BECAUSE the setting is being removed — this is the last message you'll get. If that's a surprise, it might be worth a gentle check-in.",
        ),
        "ext_removed" => (
            "a browser extension went missing and wasn't restored",
            "A browser's Oath Light extension was removed and hasn't come back after several minutes. It might be nothing — a browser update, a profile reset — but it's also how someone would try to turn off protection. Worth a check-in.",
        ),
        "block_burst" => (
            "saw an unusually high number of blocked sites in a short time",
            "This isn't about what was blocked — only that a lot of blocks happened close together. Could be nothing (a bad link, a burst of ads), but it's the kind of moment this notification exists for.",
        ),
        "serious_disable_requested" => (
            "asked to turn Serious Mode off",
            "Serious Mode is Oath Light's strictest configuration. Turning it off starts a waiting period, and it stays fully active the whole time — nothing has weakened yet, and the request can still be cancelled. This note fires at request time on purpose, so the moment isn't a private one.",
        ),
        "heartbeat" => (
            "is still protecting this computer",
            "This is a routine monthly note so that silence itself would be a signal. Nothing happened — Oath Light is simply still installed and running.",
        ),
        _ => (
            "a protective change happened",
            "A heads-up from Oath Light. No details about browsing are ever shared.",
        ),
    };
    let subject = format!("Oath Light: {headline} on {who}'s computer");
    let body = format!(
        "Hi,\n\nYou're listed as {who}'s trusted contact in Oath Light.\n\n\
         {who} {headline}.\n\n{detail}\n\n\
         Oath Light never shares browsing history, screenshots, or any details of what was viewed — only that a discrete event occurred.\n\n\
         — Oath Light"
    );
    (subject, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mailto_url_encodes_subject_and_body() {
        let url = mailto_url("a@b.com", "hi there & you", "line1\nline2");
        assert!(url.starts_with("mailto:a%40b.com?subject="));
        assert!(url.contains("%26")); // & encoded
        assert!(url.contains("%0A")); // newline encoded
        assert!(!url.contains(' '));
    }

    #[test]
    fn deliver_with_no_smtp_config_returns_mailto_draft() {
        let dir = std::env::temp_dir().join(format!("pp-notify-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir); // ensure no smtp.json
        let out = deliver(&dir, "friend@example.com", "s", "b");
        match out {
            SendOutcome::MailtoDraft(url) => assert!(url.starts_with("mailto:friend%40example.com")),
            _ => panic!("expected a mailto draft when SMTP is unconfigured"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deliver_with_empty_recipient_fails() {
        let dir = std::env::temp_dir().join(format!("pp-notify-test-empty-{}", std::process::id()));
        match deliver(&dir, "  ", "s", "b") {
            SendOutcome::Failed(_) => {}
            _ => panic!("empty recipient must fail, not draft"),
        }
    }

    #[test]
    fn message_for_never_leaks_content_and_names_the_person() {
        let (subject, body) = message_for("uninstall_requested", "Sam");
        assert!(subject.contains("Sam"));
        assert!(subject.contains("uninstall"));
        assert!(body.contains("never shares browsing history"));
    }

    #[test]
    fn load_smtp_rejects_incomplete_config() {
        let dir = std::env::temp_dir().join(format!("pp-notify-test-cfg-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        // host present but username blank → treated as unconfigured.
        let cfg = SmtpConfig { host: "smtp.example.com".into(), port: 587, username: "".into(), password: "x".into(), from: "".into() };
        save_smtp(&dir, &cfg).unwrap();
        assert!(load_smtp(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
