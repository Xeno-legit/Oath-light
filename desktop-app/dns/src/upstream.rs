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
use std::path::Path;

/// Cloudflare — used when no captured upstream is available (first run
/// before takeover, or every captured adapter was itself DHCP with no visible
/// static servers).
pub const FALLBACK_PRIMARY: &str = "1.1.1.1";
/// Quad9 — secondary fallback / retry target.
pub const FALLBACK_SECONDARY: &str = "9.9.9.9";

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
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, json)
    }

    /// Pick the (primary, secondary) upstream pair the resolver forwards
    /// clean queries to: the first non-empty captured static IPv4 server
    /// found across adapters, then the second one found (from any adapter),
    /// falling back to the well-known public resolvers for whichever slot(s)
    /// nothing was captured for. Never returns loopback/`127.0.0.1` or `::1`
    /// as an upstream even if somehow captured (that would just be the
    /// resolver forwarding to itself) — such an entry is skipped as if it
    /// weren't there.
    pub fn resolve_upstreams(&self) -> (String, String) {
        let mut found: Vec<String> = Vec::new();
        for a in &self.adapters {
            for s in &a.servers_v4 {
                let s = s.trim();
                if s.is_empty() || s == "127.0.0.1" || found.contains(&s.to_string()) {
                    continue;
                }
                found.push(s.to_string());
            }
        }
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
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("purepath-dns-test-{}", std::process::id()));
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
        let path = std::env::temp_dir().join("purepath-dns-test-definitely-missing.json");
        assert!(CapturedDns::load(&path).is_none());
    }
}
