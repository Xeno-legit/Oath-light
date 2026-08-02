//! dns/src/decide.rs — the block/allow policy decision (plan 1.1 point 5 /
//! 1.2 point 2).
//!
//! Order matters and mirrors the plan exactly:
//!   1. Whitelist floor — always Allow, beats everything else, no exceptions.
//!   2. DoH endpoint — Block (kills DoH bootstrapping, plan 1.2).
//!   3. Built-in blocklist (exact-and-parent walk) — Block.
//!   4. Hostname keyword layer — Block.
//!   5. Custom user domains (loaded from `custom_domains.json`, refreshed on
//!      a slow timer) — Block.
//!
//! Otherwise Allow.
//!
//! This is a coarse whole-domain backstop for surfaces the extension can't
//! reach (Tor, portable browsers, Electron apps) — see the plan's Part B
//! scope note. It never does per-path/query filtering, SafeSearch, or
//! graylist stripping; those stay extension-only.

use oathlight_core::{lists, matching};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Block,
}

/// The user's custom-blocked domains (Settings -> Blocklist -> "My
/// blocklist"), refreshed periodically from `<app_data_dir>/custom_domains.json`
/// — the same plain JSON array `set_custom_domains` in the Tauri app persists
/// (see lib.rs). Loaded once at resolver startup (`init_custom_domains`) and
/// re-read every `REFRESH_INTERVAL` on a background thread so a domain added
/// or removed in the running app takes effect in the resolver without a
/// restart, without hammering disk on every single query.
static CUSTOM_DOMAINS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);

fn read_custom_domains(path: &Path) -> HashSet<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(|v| v.iter().map(|d| lists::normalize_domain(d)).filter(|d| !d.is_empty()).collect())
        .unwrap_or_default()
}

/// Start (or restart) the custom-domains loader against `custom_domains_path`
/// (typically `<app_data_dir>/custom_domains.json`). Idempotent to call more
/// than once — each call replaces the shared set and (re)spawns the refresh
/// thread; `server::start` calls this once per resolver start.
pub fn init_custom_domains(custom_domains_path: PathBuf) {
    let set = read_custom_domains(&custom_domains_path);
    match CUSTOM_DOMAINS.get() {
        Some(m) => *m.lock().unwrap() = set,
        None => {
            let _ = CUSTOM_DOMAINS.set(Mutex::new(set));
        }
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(REFRESH_INTERVAL);
        let fresh = read_custom_domains(&custom_domains_path);
        if let Some(m) = CUSTOM_DOMAINS.get() {
            *m.lock().unwrap() = fresh;
        }
    });
}

fn is_custom_blocked(host: &str) -> bool {
    match CUSTOM_DOMAINS.get() {
        Some(m) => lists::is_domain_listed(host, &m.lock().unwrap()),
        None => false, // not initialized yet — nothing to block on this axis.
    }
}

fn doh_set() -> &'static HashSet<String> {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| oathlight_core::doh::DOH_ENDPOINTS.iter().map(|s| s.to_string()).collect())
}

fn is_doh_endpoint(host: &str) -> bool {
    lists::is_domain_listed(host, doh_set())
}

/// Decide whether `qname` (already lowercased by `packet::parse_query`) is
/// allowed through or should be answered NXDOMAIN. Fails open on an empty
/// hostname (malformed/root query — nothing to block).
pub fn decide(qname: &str) -> Decision {
    let host = lists::normalize_domain(qname);
    if host.is_empty() {
        return Decision::Allow;
    }
    if matching::is_whitelisted_domain(&host) {
        return Decision::Allow;
    }
    if is_doh_endpoint(&host) {
        return Decision::Block;
    }
    if lists::is_domain_listed(&host, &lists::built_in().domains) {
        return Decision::Block;
    }
    if matching::check_domain_keywords(&host).is_some() {
        return Decision::Block;
    }
    if is_custom_blocked(&host) {
        return Decision::Block;
    }
    Decision::Allow
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_beats_everything() {
        // github.com is whitelisted and contains no blocked stem anyway, but
        // this exercises the ordering: whitelist is checked before the DoH
        // list, the built-in blocklist, and keywords.
        assert_eq!(decide("github.com"), Decision::Allow);
        assert_eq!(decide("gist.github.com"), Decision::Allow);
    }

    #[test]
    fn doh_endpoints_are_blocked() {
        assert_eq!(decide("cloudflare-dns.com"), Decision::Block);
        assert_eq!(decide("family.cloudflare-dns.com"), Decision::Block); // parent walk
        assert_eq!(decide("dns.google"), Decision::Block);
    }

    #[test]
    fn keyword_layer_blocks_unlisted_porn_domains() {
        assert_eq!(decide("totallylegitpornhub-mirror.com"), Decision::Block);
    }

    #[test]
    fn clean_unlisted_domain_is_allowed() {
        assert_eq!(decide("some-random-blog-nobody-has-heard-of.example"), Decision::Allow);
    }

    #[test]
    fn empty_qname_fails_open() {
        assert_eq!(decide(""), Decision::Allow);
    }
}
