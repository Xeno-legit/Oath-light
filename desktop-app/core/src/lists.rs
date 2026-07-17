//! core/src/lists.rs — built-in blocklist embedding + domain-list matching.
//! Ported from `src-tauri/src/lib.rs` (pre-A.1) so the app, the DNS resolver
//! (plan 1.1), and any future mobile binding share one parsed table instead of
//! each embedding + re-parsing the same ~10.5MB JSON payload.

use serde_json::Value;
use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

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

// ============================================================================
// OTA overlay (plan 3.5) — runtime-replaceable lists layered OVER the baked
// built-ins. `built_in()` is a OnceLock and deliberately stays immutable (the
// embedded lists are the forever-fallback safety floor); an installed OTA
// update lives here instead, and `effective()` is the one accessor consumers
// use to see "OTA if loaded, else built-in".
// ============================================================================

pub mod ota {
    use super::*;
    use std::sync::RwLock;

    /// A verified, installed OTA list set (parsed from
    /// `<app_data_dir>/lists/` by the app's `ota.rs` after signature + hash +
    /// whitelist-collision checks — nothing constructs one of these from
    /// unverified bytes).
    #[derive(Debug)]
    pub struct OtaLists {
        /// The manifest version these lists came from (monotonic, >= 1).
        pub version: u64,
        pub domains: HashSet<String>,
        pub domains_vec: Vec<String>,
        pub keywords: Vec<String>,
    }

    /// `RwLock` (not another OnceLock) because an update can arrive while the
    /// app runs, and readers (`effective()`) vastly outnumber the writer (the
    /// weekly check). `Arc` so a reader's view stays alive/consistent even if
    /// a swap happens mid-use.
    static CURRENT: RwLock<Option<Arc<OtaLists>>> = RwLock::new(None);

    /// Install a verified list set as the effective overlay.
    pub fn set(lists: OtaLists) {
        *CURRENT.write().unwrap() = Some(Arc::new(lists));
    }

    /// Drop the overlay (back to baked built-ins). Test/repair hook — normal
    /// operation never clears, only replaces with a newer version.
    pub fn clear() {
        *CURRENT.write().unwrap() = None;
    }

    /// The current overlay, if one is loaded.
    pub fn get() -> Option<Arc<OtaLists>> {
        CURRENT.read().unwrap().clone()
    }

    /// Version of the loaded overlay (`None` when running on built-ins).
    pub fn installed_version() -> Option<u64> {
        CURRENT.read().unwrap().as_ref().map(|l| l.version)
    }
}

/// The effective list view: the OTA overlay when one is installed, the baked
/// built-ins otherwise. Owning enum (Arc/static — cheap to construct) so the
/// accessors below can hand out references without lifetime gymnastics.
pub enum EffectiveLists {
    Ota(Arc<ota::OtaLists>),
    BuiltIn(&'static BuiltInLists),
}

impl EffectiveLists {
    pub fn domains(&self) -> &HashSet<String> {
        match self {
            EffectiveLists::Ota(l) => &l.domains,
            EffectiveLists::BuiltIn(l) => &l.domains,
        }
    }
    pub fn domains_vec(&self) -> &Vec<String> {
        match self {
            EffectiveLists::Ota(l) => &l.domains_vec,
            EffectiveLists::BuiltIn(l) => &l.domains_vec,
        }
    }
    pub fn keywords(&self) -> &Vec<String> {
        match self {
            EffectiveLists::Ota(l) => &l.keywords,
            EffectiveLists::BuiltIn(l) => &l.keywords,
        }
    }
    /// OTA manifest version backing this view (`None` = baked built-ins).
    pub fn ota_version(&self) -> Option<u64> {
        match self {
            EffectiveLists::Ota(l) => Some(l.version),
            EffectiveLists::BuiltIn(_) => None,
        }
    }
}

/// Snapshot of the currently-effective lists. Callers that explicitly want
/// the immutable baked lists keep calling [`built_in()`]; everything that
/// should see OTA data (counts, domain checks, full-list pushes to
/// extensions) goes through this instead.
pub fn effective() -> EffectiveLists {
    match ota::get() {
        Some(l) => EffectiveLists::Ota(l),
        None => EffectiveLists::BuiltIn(built_in()),
    }
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
    fn effective_prefers_ota_overlay_and_falls_back() {
        // NB: the overlay is process-global state; this is the only test that
        // touches it, and it restores the built-in view before returning.
        assert!(ota::get().is_none(), "no overlay at start");
        assert!(effective().ota_version().is_none(), "effective == built-ins at start");

        let dv = vec!["ota-example.com".to_string()];
        ota::set(ota::OtaLists {
            version: 7,
            domains: dv.iter().cloned().collect(),
            domains_vec: dv.clone(),
            keywords: vec!["otakeyword".to_string()],
        });
        let eff = effective();
        assert_eq!(eff.ota_version(), Some(7));
        assert_eq!(eff.domains_vec(), &dv);
        assert!(eff.domains().contains("ota-example.com"));
        assert_eq!(ota::installed_version(), Some(7));

        ota::clear();
        assert!(effective().ota_version().is_none(), "cleared back to built-ins");
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
