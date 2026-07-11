//! core/src/lists.rs — built-in blocklist embedding + domain-list matching.
//! Ported from `src-tauri/src/lib.rs` (pre-A.1) so the app, the DNS resolver
//! (plan 1.1), and any future mobile binding share one parsed table instead of
//! each embedding + re-parsing the same ~10.5MB JSON payload.

use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

const BUILT_IN_DOMAINS_P1: &str = include_str!("../../../extension/blocklists/domains_part1.json");
const BUILT_IN_DOMAINS_P2: &str = include_str!("../../../extension/blocklists/domains_part2.json");
const BUILT_IN_DOMAINS_P3: &str = include_str!("../../../extension/blocklists/domains_part3.json");
// AI-erotica category (plan 3.3) — same {"domains": [...]} shape as the other
// parts, just its own category file so it can be toggled/OTA-updated at its
// own (faster) cadence.
const BUILT_IN_DOMAINS_AI: &str = include_str!("../../../extension/blocklists/domains_ai.json");
const BUILT_IN_KEYWORDS_JSON: &str = include_str!("../../../extension/blocklists/keywords.json");

/// Parsed built-in lists. `domains` is a `HashSet` for O(1) exact lookups
/// (paired with `is_domain_listed` for the exact-and-parent walk); `domains_vec`
/// preserves the original flat list shape for callers that need it verbatim
/// (counts, full-list sync to extensions) — mirrors the app's pre-A.1
/// `ExtensionBlocklists.built_in_domains: Vec<String>` field exactly.
///
/// Entries are used as-is from the source JSON (already lowercase there — see
/// the blocklist generation pipeline); this does NOT re-lowercase them, to
/// match the original `built_in_lists()` behavior byte-for-byte. Callers that
/// build their own `HashSet`/query strings must normalize via
/// `normalize_domain` first, same as before.
pub struct BuiltInLists {
    pub domains: HashSet<String>,
    pub domains_vec: Vec<String>,
    pub keywords: Vec<String>,
}

/// Parses the ~10.5MB of bundled built-in domain/keyword JSON exactly once, on
/// first access — not at module-load time — so the parse cost (and resulting
/// heap allocation) is paid only if/when something actually asks for the
/// built-in lists.
pub fn built_in() -> &'static BuiltInLists {
    static LISTS: OnceLock<BuiltInLists> = OnceLock::new();
    LISTS.get_or_init(|| {
        let mut domains_vec: Vec<String> = Vec::new();
        for json_str in [BUILT_IN_DOMAINS_P1, BUILT_IN_DOMAINS_P2, BUILT_IN_DOMAINS_P3, BUILT_IN_DOMAINS_AI] {
            if let Ok(v) = serde_json::from_str::<Value>(json_str) {
                if let Some(arr) = v.get("domains").and_then(|a| a.as_array()) {
                    domains_vec.extend(arr.iter().filter_map(|x| x.as_str().map(String::from)));
                }
            }
        }

        let mut keywords: Vec<String> = Vec::new();
        if let Ok(v) = serde_json::from_str::<Value>(BUILT_IN_KEYWORDS_JSON) {
            if let Some(arr) = v.get("keywords").and_then(|a| a.as_array()) {
                keywords = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            }
        }

        let domains: HashSet<String> = domains_vec.iter().cloned().collect();
        BuiltInLists { domains, domains_vec, keywords }
    })
}

/// Normalize a user-entered domain the same way everywhere one is compared or
/// stored: trim, lowercase, strip a leading `http(s)://` and `www.`, and cut
/// at the first path separator. Mirrors the extension-side normalization in
/// `background.js`'s `addCustomDomain`/`checkDomainBlocked` handlers, so a
/// domain typed in the desktop UI and one typed into the extension's own
/// blocklist page collapse to the same string.
pub fn normalize_domain(raw: &str) -> String {
    let mut d = raw.trim().to_lowercase();
    if let Some(rest) = d.strip_prefix("https://") {
        d = rest.to_string();
    } else if let Some(rest) = d.strip_prefix("http://") {
        d = rest.to_string();
    }
    if let Some(rest) = d.strip_prefix("www.") {
        d = rest.to_string();
    }
    if let Some(idx) = d.find('/') {
        d.truncate(idx);
    }
    d
}

/// Normalize a whole list, dropping empties and deduping while preserving
/// first-seen order (order doesn't matter for blocking, but it keeps the
/// persisted file and re-pushed messages stable/diffable).
pub fn normalize_domain_list(domains: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for raw in domains {
        let d = normalize_domain(raw);
        if d.is_empty() {
            continue;
        }
        if seen.insert(d.clone()) {
            out.push(d);
        }
    }
    out
}

/// Exact-and-parent domain walk, mirroring `bg/blocklists.js`/`shouldBlockUrl`
/// STEP 3 (and `lib.rs::check_domain_blocked`'s candidate-suffix loop): checks
/// `host` itself, then each parent formed by stripping leading labels one at a
/// time, down to (but never including) the bare TLD — so `a.b.example.com`
/// matches a listed `example.com`, but a listed `com` alone can never match
/// anything (a single- or two-label host only ever gets the exact check).
///
/// Both `host` and every entry in `set` must already be lowercase/normalized
/// (via `normalize_domain`) — this does no normalization of its own, so
/// repeated lookups against the same set don't pay that cost per call.
pub fn is_domain_listed(host: &str, set: &HashSet<String>) -> bool {
    if set.is_empty() {
        return false;
    }
    if set.contains(host) {
        return true;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() > 2 {
        for i in 1..parts.len() - 1 {
            let candidate = parts[i..].join(".");
            if set.contains(&candidate) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(domains: &[&str]) -> HashSet<String> {
        domains.iter().map(|d| d.to_string()).collect()
    }

    #[test]
    fn normalize_domain_strips_scheme_www_and_path() {
        assert_eq!(normalize_domain("HTTPS://WWW.Example.com/foo/bar"), "example.com");
        assert_eq!(normalize_domain("http://example.com"), "example.com");
        assert_eq!(normalize_domain("  example.com  "), "example.com");
        assert_eq!(normalize_domain("www.example.com"), "example.com");
        assert_eq!(normalize_domain("example.com/path?q=1"), "example.com");
    }

    #[test]
    fn normalize_domain_list_dedupes_and_drops_empties() {
        let input = vec![
            "Example.com".to_string(),
            "example.com".to_string(),
            "".to_string(),
            "http://other.org".to_string(),
        ];
        assert_eq!(normalize_domain_list(&input), vec!["example.com", "other.org"]);
    }

    #[test]
    fn is_domain_listed_exact_and_parent_walk() {
        let s = set(&["example.com"]);
        assert!(is_domain_listed("example.com", &s));
        assert!(is_domain_listed("sub.example.com", &s));
        assert!(is_domain_listed("a.b.sub.example.com", &s));
        assert!(!is_domain_listed("notexample.com", &s));
        assert!(!is_domain_listed("example.org", &s));
    }

    #[test]
    fn is_domain_listed_never_matches_bare_tld() {
        // A listed "com" (hypothetically) must never make every .com domain
        // match — the walk stops before the bare TLD.
        let s = set(&["com"]);
        assert!(!is_domain_listed("example.com", &s));
        assert!(is_domain_listed("com", &s)); // exact match to the entry itself still works
    }

    #[test]
    fn is_domain_listed_empty_set_never_matches() {
        let s: HashSet<String> = HashSet::new();
        assert!(!is_domain_listed("example.com", &s));
    }

    #[test]
    fn built_in_lists_parse_and_are_nonempty() {
        let lists = built_in();
        assert!(!lists.domains_vec.is_empty(), "built-in domain list must not be empty");
        assert!(!lists.domains.is_empty());
        assert!(!lists.keywords.is_empty(), "built-in keyword list must not be empty");
        // domains_ai.json (the AI-erotica category, plan 3.3) must have been
        // merged into the same flat set as the other three part files.
        assert!(lists.domains.contains("agnai.chat"));
    }
}
