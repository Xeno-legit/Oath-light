//! dns/src/upstream.rs — captured pre-takeover DNS config + fallback servers.
//!
//! `CapturedDns` is the on-disk shape of `<app_data_dir>/dns.json`: every
//! adapter's DNS state as it was *before* takeover, so it can be restored on
//! disable/uninstall/guardian-shutdown. It is written by `takeover::takeover`
//! before a single adapter is touched (never take over without a saved
//! restore point — see that function), and read by `takeover::restore` and by
//! the resolver at startup to pick which upstream servers to forward clean
//! queries to.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::Path;

/// Cloudflare — used when no captured upstream is available (first run
/// before takeover, or every captured adapter was itself DHCP with no visible
/// static servers).
pub const FALLBACK_PRIMARY: &str = "1.1.1.1";
/// Quad9 — secondary fallback / retry target.
pub const FALLBACK_SECONDARY: &str = "9.9.9.9";

/// True for any address that is *this machine* — `127.0.0.0/8` or `::1`.
///
/// Used in two places that both matter: filtering upstream candidates (an
/// upstream of 127.0.0.1 is the resolver forwarding to itself), and — more
/// importantly — recognising our OWN takeover when re-enumerating adapters, so
/// a second enable can't overwrite the restore point in `dns.json` with the
/// loopback addresses we ourselves wrote. See `takeover::capture_for`.
///
/// Deliberately parses rather than string-matching `"127.0.0.1"`: the takeover
/// writes `127.0.0.1` and `::1`, but Windows will happily report a
/// hand-configured `127.0.0.53`, and treating that as a real upstream would
/// mean forwarding into a black hole.
pub fn is_loopback_addr(s: &str) -> bool {
    match s.trim().parse::<IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

/// True if `s` is an address worth *forwarding queries to*. Rejects anything
/// that can't answer: unparseable text, loopback (ourselves), `0.0.0.0`,
/// link-local `169.254.x` (an adapter that never got a DHCP lease), multicast
/// and broadcast.
///
/// IPv6 upstreams are rejected too, but for a different reason: the forwarding
/// path in `server.rs` builds `format!("{server}:53")`, which is not valid for
/// a bare IPv6 literal. Rather than silently producing an unusable address,
/// this refuses it and lets the fallback take over.
fn is_usable_upstream(s: &str) -> bool {
    match s.trim().parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            !(v4.is_loopback()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_link_local())
        }
        _ => false,
    }
}

/// One network adapter's DNS configuration as it was found at takeover time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterDns {
    /// `InterfaceAlias` (e.g. "Ethernet", "Wi-Fi") — the key PowerShell's DNS
    /// cmdlets take directly, used for the takeover/restore writes.
    pub alias: String,
    /// `InterfaceGuid` (e.g. "{4B1326...}") — used only for the cheap,
    /// PowerShell-free drift check (`takeover::reassert`), which reads the
    /// live `NameServer` value straight out of
    /// `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\
    /// {guid}` via `reg query`. `#[serde(default)]` so an old `dns.json`
    /// written before this field existed still loads (drift check just skips
    /// an adapter with no recorded GUID).
    #[serde(default)]
    pub guid: String,
    /// True if this adapter was getting its DNS servers from DHCP (no static
    /// servers configured) at capture time — restored via
    /// `-ResetServerAddresses` rather than replaying a captured list.
    pub dhcp: bool,
    #[serde(default)]
    pub servers_v4: Vec<String>,
    #[serde(default)]
    pub servers_v6: Vec<String>,
}

/// `<app_data_dir>/dns.json` — every adapter's pre-takeover DNS state, plus
/// when it was captured. `#[serde(default)]` on every field: an old or
/// hand-edited file should degrade to "nothing captured" rather than refusing
/// to load (fail open on infrastructure — restoring nothing is safer than
/// panicking mid-restore).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CapturedDns {
    #[serde(default)]
    pub captured_at: u64,
    #[serde(default)]
    pub adapters: Vec<AdapterDns>,
}

impl CapturedDns {
    /// Load `dns.json`. `None` if absent, unreadable, or not valid JSON —
    /// every caller treats that the same as "nothing was ever captured".
    pub fn load(path: &Path) -> Option<Self> {
        let s = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&s).ok()
    }

    /// Persist to `dns.json`, creating the parent directory if needed.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(std::io::Error::other)?;
        std::fs::write(path, json)
    }

    /// Every captured IPv4 server that could plausibly answer a query, in
    /// enumeration order and de-duplicated. This is a list of *candidates*,
    /// not a decision: a typical Windows machine has several "Up" adapters
    /// (Hyper-V's Default Switch, a WSL vEthernet, VMware's VMnet1/VMnet8,
    /// VirtualBox host-only) whose DNS server is a virtual gateway that never
    /// answers a query from the host. Picking the first one blindly is how the
    /// resolver ends up forwarding into a black hole, so the caller probes
    /// these and keeps the ones that actually reply — see
    /// `dns_filter::pick_upstreams`.
    pub fn upstream_candidates(&self) -> Vec<String> {
        let mut found: Vec<String> = Vec::new();
        for a in &self.adapters {
            for s in &a.servers_v4 {
                let s = s.trim().to_string();
                if !is_usable_upstream(&s) || found.contains(&s) {
                    continue;
                }
                found.push(s);
            }
        }
        found
    }

    /// The (primary, secondary) upstream pair, chosen without probing: the
    /// first two usable captured servers, padded with the well-known public
    /// resolvers for whichever slot nothing was captured for.
    ///
    /// Kept for callers that cannot afford to probe (and for the tests that
    /// pin the padding behaviour). The enable path deliberately does NOT use
    /// this — it probes `upstream_candidates()` instead, because "captured
    /// first" and "actually answers" are not the same thing.
    pub fn resolve_upstreams(&self) -> (String, String) {
        let found = self.upstream_candidates();
        let primary = found.first().cloned().unwrap_or_else(|| FALLBACK_PRIMARY.to_string());
        let secondary = found.get(1).cloned().unwrap_or_else(|| FALLBACK_SECONDARY.to_string());
        (primary, secondary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_upstreams_falls_back_when_nothing_captured() {
        let c = CapturedDns::default();
        assert_eq!(c.resolve_upstreams(), (FALLBACK_PRIMARY.to_string(), FALLBACK_SECONDARY.to_string()));
    }

    #[test]
    fn resolve_upstreams_prefers_captured_servers() {
        let c = CapturedDns {
            captured_at: 0,
            adapters: vec![AdapterDns {
                alias: "Ethernet".to_string(),
                guid: String::new(),
                dhcp: false,
                servers_v4: vec!["8.8.8.8".to_string(), "8.8.4.4".to_string()],
                servers_v6: vec![],
            }],
        };
        assert_eq!(c.resolve_upstreams(), ("8.8.8.8".to_string(), "8.8.4.4".to_string()));
    }

    #[test]
    fn resolve_upstreams_skips_loopback_and_empty() {
        let c = CapturedDns {
            captured_at: 0,
            adapters: vec![AdapterDns {
                alias: "Ethernet".to_string(),
                guid: String::new(),
                dhcp: false,
                servers_v4: vec!["127.0.0.1".to_string(), "".to_string(), "9.9.9.10".to_string()],
                servers_v6: vec![],
            }],
        };
        assert_eq!(c.resolve_upstreams(), ("9.9.9.10".to_string(), FALLBACK_SECONDARY.to_string()));
    }

    #[test]
    fn candidates_reject_everything_that_cannot_answer() {
        let c = CapturedDns {
            captured_at: 0,
            adapters: vec![AdapterDns {
                alias: "Ethernet".to_string(),
                guid: String::new(),
                dhcp: false,
                servers_v4: vec![
                    "127.0.0.53".to_string(),  // loopback, not just 127.0.0.1
                    "0.0.0.0".to_string(),     // unspecified
                    "169.254.7.7".to_string(), // link-local: no DHCP lease
                    "255.255.255.255".to_string(),
                    "224.0.0.251".to_string(), // multicast
                    "not-an-ip".to_string(),
                    "192.168.1.1".to_string(),
                    "192.168.1.1".to_string(), // duplicate
                ],
                servers_v6: vec![],
            }],
        };
        assert_eq!(c.upstream_candidates(), vec!["192.168.1.1".to_string()]);
    }

    #[test]
    fn candidates_keep_enumeration_order_across_adapters() {
        let adapter = |alias: &str, servers: &[&str]| AdapterDns {
            alias: alias.to_string(),
            guid: String::new(),
            dhcp: true,
            servers_v4: servers.iter().map(|s| s.to_string()).collect(),
            servers_v6: vec![],
        };
        let c = CapturedDns {
            captured_at: 0,
            adapters: vec![
                adapter("vEthernet (Default Switch)", &["172.30.16.1"]),
                adapter("Wi-Fi", &["192.168.1.1", "8.8.8.8"]),
            ],
        };
        assert_eq!(
            c.upstream_candidates(),
            vec!["172.30.16.1".to_string(), "192.168.1.1".to_string(), "8.8.8.8".to_string()]
        );
    }

    #[test]
    fn loopback_detection_covers_the_whole_range() {
        assert!(is_loopback_addr("127.0.0.1"));
        assert!(is_loopback_addr("127.0.0.53"));
        assert!(is_loopback_addr(" ::1 "));
        assert!(!is_loopback_addr("192.168.1.1"));
        assert!(!is_loopback_addr(""));
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("oathlight-dns-test-{}", std::process::id()));
        let path = dir.join("dns.json");
        let c = CapturedDns {
            captured_at: 12345,
            adapters: vec![AdapterDns {
                alias: "Wi-Fi".to_string(),
                guid: "{TEST-GUID}".to_string(),
                dhcp: true,
                servers_v4: vec![],
                servers_v6: vec![],
            }],
        };
        c.save(&path).expect("save must succeed");
        let loaded = CapturedDns::load(&path).expect("load must succeed");
        assert_eq!(loaded.captured_at, 12345);
        assert_eq!(loaded.adapters.len(), 1);
        assert!(loaded.adapters[0].dhcp);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_none() {
        let path = std::env::temp_dir().join("oathlight-dns-test-definitely-missing.json");
        assert!(CapturedDns::load(&path).is_none());
    }
}
