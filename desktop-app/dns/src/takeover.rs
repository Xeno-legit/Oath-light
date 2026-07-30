//! dns/src/takeover.rs — Windows adapter DNS takeover/restore (plan 1.1
//! point 3, 1.2's IPv6 emphasis).
//!
//! Enumerates every "Up" network adapter via PowerShell (`Get-NetAdapter` +
//! `Get-DnsClientServerAddress` + `Get-NetIPInterface`, all read-only and
//! available to a standard user), persists what it finds to
//! `<app_data_dir>/dns.json` via `upstream::CapturedDns` **before** touching
//! anything, then points every adapter at the resolver — `127.0.0.1` for
//! IPv4 **and** `::1` for IPv6 in the same call. The plan is emphatic about
//! the IPv6 half: skip it and Windows silently prefers the untouched IPv6
//! resolver, and the whole feature quietly no-ops for any site with an AAAA
//! record for its nameserver.
//!
//! `Set-DnsClientServerAddress` (like the `ExtensionInstallForcelist` policy
//! writes in `browsers.rs`) needs admin — a non-elevated call fails per
//! adapter with "Access is denied", which is surfaced as a plain `Err`
//! string. This module does not retry, elevate, or loop on failure: the
//! plan's instruction is "report failure clearly, don't loop."

use crate::upstream::{is_loopback_addr, AdapterDns, CapturedDns};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Turn a fresh enumeration into the adapter list to persist as the restore
/// point, given whatever was captured on a previous run.
///
/// **The bug this exists to prevent.** `takeover` overwrites `dns.json` every
/// time it runs. If the resolver was already active — the app was killed
/// without a clean disable, or the user simply re-enabled the filter — then
/// what enumeration reports is *our own* `127.0.0.1` / `::1`, and writing that
/// as the restore point destroys the only record of the machine's real DNS.
/// `restore` would then dutifully set every adapter to 127.0.0.1 and leave it
/// there, including on uninstall: DNS permanently pointed at a resolver that
/// no longer exists. That is precisely the "never brick the machine" failure
/// this module promises not to cause.
///
/// So: loopback servers are stripped, and an adapter that had servers and lost
/// *all* of them to that strip is recognised as our own takeover — its earlier,
/// real capture is kept instead. The "had some, lost all" test is what keeps
/// this precise; an adapter that genuinely reports no servers is left alone
/// rather than resurrected from a stale file.
// Only the Windows `takeover` calls this; the tests below cover it everywhere.
#[cfg_attr(not(windows), allow(dead_code))]
fn capture_for(fresh: Vec<AdapterDns>, prev: Option<&CapturedDns>) -> Vec<AdapterDns> {
    fresh
        .into_iter()
        .map(|mut a| {
            let had_v4 = !a.servers_v4.is_empty();
            let had_v6 = !a.servers_v6.is_empty();
            a.servers_v4.retain(|s| !is_loopback_addr(s));
            a.servers_v6.retain(|s| !is_loopback_addr(s));
            let self_captured =
                (had_v4 && a.servers_v4.is_empty()) || (had_v6 && a.servers_v6.is_empty());
            if !self_captured {
                return a;
            }
            let earlier = prev
                .and_then(|c| c.adapters.iter().find(|p| p.alias == a.alias))
                .filter(|p| !p.servers_v4.is_empty() || !p.servers_v6.is_empty());
            match earlier {
                Some(p) => AdapterDns {
                    // Alias and GUID from the live enumeration (a GUID can be
                    // absent in an old file); DNS state from the older capture,
                    // which is the part that still describes reality.
                    alias: a.alias,
                    guid: a.guid,
                    dhcp: p.dhcp,
                    servers_v4: p.servers_v4.clone(),
                    servers_v6: p.servers_v6.clone(),
                },
                None => a,
            }
        })
        .collect()
}

/// One adapter as it looks *right now*, for the exposure check only. Never
/// persisted — `AdapterDns` is the restore-point shape, and `metric` has no
/// business in it (we never restore an interface metric).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveAdapter {
    pub alias: String,
    /// `Get-NetIPInterface -AddressFamily IPv4`'s `InterfaceMetric`. Lower wins:
    /// this is how Windows decides which interface's DNS servers to prefer, and
    /// it is the whole reason this check doesn't cry wolf (see `exposure_from`).
    pub metric: u32,
    pub servers_v4: Vec<String>,
    pub servers_v6: Vec<String>,
}

/// Ways the machine's DNS can be leaving the resolver's hands *without* any
/// adapter we took over having drifted — so `reassert` sees nothing wrong and
/// the health probe still passes, yet queries are not reaching us.
///
/// This is a detection, not an enforcement: nothing here is fought or undone.
/// The takeover deliberately only ever touches adapters recorded in `dns.json`
/// (see `reassert`), because fighting an adapter we never took over is how a
/// blocker breaks a work VPN or a captive portal. The cost of that choice is
/// that the DNS layer can be sidelined silently — and *silently* is the part
/// worth fixing. Reporting it honestly (the status card degrades, the event log
/// records it) keeps the promise that the app never claims protection it isn't
/// delivering, without starting an arms race the user always wins anyway.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Exposure {
    /// Aliases of adapters that are up, that we did NOT take over, that carry
    /// their own non-loopback DNS servers, and that Windows prefers at least as
    /// much as every adapter we did take over.
    pub adapters: Vec<String>,
    /// An NRPT rule claims the root namespace (`.`) with its own name servers.
    /// This outranks adapter DNS settings entirely — no `Set-DnsClientServer\
    /// Address` write can win against it, which is why it is detected and
    /// reported rather than corrected.
    pub nrpt_catch_all: bool,
}

impl Exposure {
    /// True when nothing is sidelining the resolver.
    pub fn is_clear(&self) -> bool {
        self.adapters.is_empty() && !self.nrpt_catch_all
    }
}

/// Decide, from a live adapter enumeration and the takeover's restore point,
/// which adapters are plausibly answering DNS instead of us.
///
/// **Why the metric comparison matters.** A typical Windows box has several up
/// adapters with real DNS servers configured that never answer anything for the
/// host — Hyper-V's Default Switch, a WSL vEthernet, VMware's VMnet1/VMnet8.
/// Flagging every foreign adapter with DNS set would fire on all of them, on
/// most developer machines, permanently. Windows prefers the interface with the
/// *lowest* metric, so "at least as preferred as the best adapter we hold" is
/// what actually distinguishes an interface that will be consulted before us
/// from one that merely exists. A false positive here is not a cosmetic bug:
/// per BYPASSES.md, an alarm the user learns to ignore protects nobody.
///
/// With no captured adapter currently up (the user moved from Ethernet to Wi-Fi
/// entirely, say), we hold nothing that can win, so any foreign adapter with
/// its own DNS counts.
pub fn exposure_from(live: &[LiveAdapter], captured: &CapturedDns, nrpt_catch_all: bool) -> Exposure {
    let is_ours = |alias: &str| captured.adapters.iter().any(|c| c.alias == alias);
    let our_best_metric = live
        .iter()
        .filter(|a| is_ours(&a.alias))
        .map(|a| a.metric)
        .min();

    let adapters = live
        .iter()
        .filter(|a| !is_ours(&a.alias))
        .filter(|a| {
            a.servers_v4
                .iter()
                .chain(a.servers_v6.iter())
                .any(|s| !s.trim().is_empty() && !is_loopback_addr(s))
        })
        // Spelled as a match rather than `is_none_or`/`map_or`: the former is
        // past this workspace's MSRV (1.77.2) and the latter trips clippy's
        // lint suggesting the former.
        .filter(|a| match our_best_metric {
            Some(ours) => a.metric <= ours,
            None => true,
        })
        .map(|a| a.alias.clone())
        .collect();

    Exposure { adapters, nrpt_catch_all }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// Never flash a console window — same house pattern as `browsers.rs`'s
    /// `reg()` and `lib.rs`'s elevated-setup PowerShell spawn.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn ps() -> Command {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden"]);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    /// PowerShell escaping for a single-quoted string literal: PowerShell
    /// doubles an embedded `'` to escape it (there is no backslash-escape
    /// inside a single-quoted string). Adapter aliases are user-visible
    /// names ("Ethernet", "Wi-Fi 2") that in practice never contain a quote,
    /// but this is cheap insurance against a construct-the-command-line bug
    /// class if one ever does.
    fn ps_quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }

    fn json_str_list(v: Option<&serde_json::Value>) -> Vec<String> {
        match v {
            Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
            Some(serde_json::Value::String(s)) => vec![s.clone()],
            _ => Vec::new(),
        }
    }

    fn parse_adapters_json(text: &str) -> Result<Vec<AdapterDns>, String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            // No "Up" adapters at all is a legitimate (if unusual) state —
            // not a parse error.
            return Ok(Vec::new());
        }
        let v: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|e| format!("unexpected PowerShell output: {e}"))?;
        // ConvertTo-Json emits a bare object (not a one-element array) when
        // exactly one result comes through the pipeline.
        let items: Vec<serde_json::Value> = match v {
            serde_json::Value::Array(a) => a,
            other => vec![other],
        };
        let mut out = Vec::new();
        for item in items {
            let alias = item.get("alias").and_then(|x| x.as_str()).unwrap_or_default().to_string();
            if alias.is_empty() {
                continue;
            }
            let dhcp = item.get("dhcp").and_then(|x| x.as_bool()).unwrap_or(false);
            let guid = item.get("guid").and_then(|x| x.as_str()).unwrap_or_default().to_string();
            out.push(AdapterDns {
                alias,
                guid,
                dhcp,
                servers_v4: json_str_list(item.get("servers_v4")),
                servers_v6: json_str_list(item.get("servers_v6")),
            });
        }
        Ok(out)
    }

    /// Enumerate every "Up" adapter's alias, DHCP-vs-static state, and
    /// current DNS servers (v4 + v6) in one PowerShell round trip.
    pub fn enumerate() -> Result<Vec<AdapterDns>, String> {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $alias = $_.Name
  $guid = $_.InterfaceGuid
  $v4 = @((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4).ServerAddresses)
  $v6 = @((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv6).ServerAddresses)
  $dhcpState = (Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4).Dhcp
  [PSCustomObject]@{ alias = $alias; guid = $guid; dhcp = ($dhcpState -eq 'Enabled'); servers_v4 = $v4; servers_v6 = $v6 }
} | ConvertTo-Json -Depth 4
"#;
        let out = ps()
            .arg("-Command")
            .arg(script)
            .output()
            .map_err(|e| format!("failed to launch PowerShell for DNS enumeration: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "adapter DNS enumeration failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        parse_adapters_json(&String::from_utf8_lossy(&out.stdout))
    }

    /// Point one adapter at the resolver: `127.0.0.1` for IPv4 and `::1` for
    /// IPv6 in a single call (Set-DnsClientServerAddress accepts a mixed-
    /// family `-ServerAddresses` list and applies each address to its own
    /// family) — see the module doc for why skipping the IPv6 half would
    /// silently defeat the whole feature.
    fn set_loopback(alias: &str) -> Result<(), String> {
        let script = format!(
            "Set-DnsClientServerAddress -InterfaceAlias {} -ServerAddresses ('127.0.0.1','::1')",
            ps_quote(alias)
        );
        let out = ps().arg("-Command").arg(&script).output();
        match out {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "adapter '{alias}': {}",
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => Err(format!("adapter '{alias}': failed to launch PowerShell: {e}")),
        }
    }

    /// Restore one adapter to its captured state: DHCP adapters (or ones
    /// that somehow captured no servers at all) get `-ResetServerAddresses`;
    /// static ones get their exact captured server list (v4 servers, then
    /// v6) replayed verbatim.
    fn restore_one(a: &AdapterDns) -> Result<(), String> {
        let script = if a.dhcp || (a.servers_v4.is_empty() && a.servers_v6.is_empty()) {
            format!("Set-DnsClientServerAddress -InterfaceAlias {} -ResetServerAddresses", ps_quote(&a.alias))
        } else {
            let mut all: Vec<String> = a.servers_v4.iter().map(|s| ps_quote(s)).collect();
            all.extend(a.servers_v6.iter().map(|s| ps_quote(s)));
            format!(
                "Set-DnsClientServerAddress -InterfaceAlias {} -ServerAddresses ({})",
                ps_quote(&a.alias),
                all.join(",")
            )
        };
        let out = ps().arg("-Command").arg(&script).output();
        match out {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "adapter '{}': {}",
                a.alias,
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => Err(format!("adapter '{}': failed to launch PowerShell: {e}", a.alias)),
        }
    }

    /// Capture every up adapter's current DNS config, persist it to
    /// `dns_json_path` FIRST, then point each one at the resolver.
    /// Best-effort per-adapter for the loopback-set step (one adapter's
    /// "Access is denied" doesn't stop the others from being taken over) —
    /// but if enumeration itself fails, nothing is touched and `Err` is
    /// returned so the caller never takes over without a saved restore
    /// point.
    pub fn takeover(dns_json_path: &Path) -> Result<CapturedDns, String> {
        // What to take over: every adapter that is up right now.
        // What to persist as the restore point: the same list, with our own
        // previous takeover filtered back out — see `capture_for`.
        let adapters = enumerate()?;
        let previous = CapturedDns::load(dns_json_path);
        let captured_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let captured = CapturedDns {
            captured_at,
            adapters: super::capture_for(adapters.clone(), previous.as_ref()),
        };
        captured
            .save(dns_json_path)
            .map_err(|e| format!("could not persist {}: {e}", dns_json_path.display()))?;

        let mut failures = Vec::new();
        let mut ok_count = 0usize;
        for a in &adapters {
            match set_loopback(&a.alias) {
                Ok(()) => ok_count += 1,
                Err(e) => failures.push(e),
            }
        }
        if !failures.is_empty() {
            log::warn!("dns takeover: {} adapter(s) failed: {}", failures.len(), failures.join("; "));
        }
        // If there were adapters but NOT ONE accepted the loopback write,
        // takeover truly failed — almost always "Access is denied" from a
        // non-elevated call. Report it clearly (the plan: "report failure
        // clearly, don't loop") so the UI can say the filter needs admin
        // rather than silently pretending it's active while no traffic is
        // actually redirected. `dns.json` is still saved (a correct no-op
        // restore point), so a later restore stays harmless.
        if ok_count == 0 && !adapters.is_empty() {
            return Err(format!(
                "could not redirect any network adapter to the local resolver (needs administrator \
                 rights): {}",
                failures.join("; ")
            ));
        }
        Ok(captured)
    }

    /// Restore every adapter recorded in `dns_json_path` to its pre-takeover
    /// state. Best-effort and idempotent — called from the disable path, the
    /// uninstall teardown, and (as a last act) the guardian's sanctioned-
    /// shutdown path.
    pub fn restore(dns_json_path: &Path) -> Result<(), String> {
        let captured = match CapturedDns::load(dns_json_path) {
            Some(c) => c,
            None => return Ok(()), // nothing was ever captured — nothing to restore.
        };
        let mut failures = Vec::new();
        for a in &captured.adapters {
            if let Err(e) = restore_one(a) {
                failures.push(e);
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }

    /// Read one adapter's live IPv4 `NameServer` value straight out of the
    /// registry — `HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\
    /// Interfaces\{guid}\NameServer` — via `reg query`. Standard users can
    /// read this (only *writing* DNS needs admin), and it avoids spawning a
    /// full PowerShell for the every-tick drift check (the plan explicitly
    /// prefers the registry here). Empty string if the value is absent
    /// (DHCP with no static override leaves `NameServer` empty/missing) or
    /// unreadable.
    fn read_nameserver(guid: &str) -> String {
        if guid.is_empty() {
            return String::new();
        }
        let key = format!(
            r"HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{guid}"
        );
        let out = match reg().args(["query", &key, "/v", "NameServer"]).output() {
            Ok(o) if o.status.success() => o.stdout,
            _ => return String::new(),
        };
        let text = String::from_utf8_lossy(&out);
        for line in text.lines() {
            let trimmed = line.trim_start();
            if let Some(pos) = trimmed.find("REG_SZ") {
                return trimmed[pos + "REG_SZ".len()..].trim().to_string();
            }
        }
        String::new()
    }

    /// `reg` command that never flashes a console window — mirrors
    /// `browsers.rs`'s `reg()`.
    fn reg() -> Command {
        let mut c = Command::new("reg");
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    /// Drift check (plan 1.2 layer 3): for each adapter recorded in
    /// `dns_json_path`, read its live IPv4 `NameServer` from the registry;
    /// if it no longer starts with `127.0.0.1`, re-point it at the resolver
    /// (`set_loopback`). Only ever touches adapters we recorded — never one
    /// the user added later (a work VPN, a new Wi-Fi with a captive portal),
    /// which is the plan's captive-portal/VPN mitigation. Returns how many
    /// adapters were reverted.
    pub fn reassert(dns_json_path: &Path) -> Result<usize, String> {
        let captured = match CapturedDns::load(dns_json_path) {
            Some(c) => c,
            None => return Ok(0),
        };
        let mut reverted = 0usize;
        let mut failures = Vec::new();
        for a in &captured.adapters {
            let current = read_nameserver(&a.guid);
            // Missing/empty NameServer means DHCP is in effect — for an
            // adapter WE took over that would itself be drift (we set a
            // static 127.0.0.1). Treat "doesn't start with 127.0.0.1" as
            // drifted, including the empty case.
            if current.starts_with("127.0.0.1") {
                continue;
            }
            match set_loopback(&a.alias) {
                Ok(()) => reverted += 1,
                Err(e) => failures.push(e),
            }
        }
        if failures.is_empty() {
            Ok(reverted)
        } else {
            Err(failures.join("; "))
        }
    }

    /// `ConvertTo-Json` collapses a one-element array to a bare object in some
    /// positions and keeps it an array in others; normalize both shapes (and a
    /// missing key) to a `Vec`.
    fn as_array(v: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
        match v {
            Some(serde_json::Value::Array(a)) => a.clone(),
            Some(serde_json::Value::Null) | None => Vec::new(),
            Some(other) => vec![other.clone()],
        }
    }

    /// A metric we treat as "least preferred" when Windows reports none. Using
    /// 0 here (what `[int]$null` would give) would be exactly backwards — it
    /// would make an adapter with unknown preference look like the most
    /// preferred one on the machine and flag it.
    const UNKNOWN_METRIC: u32 = u32::MAX;

    fn parse_exposure_json(text: &str) -> Result<(Vec<LiveAdapter>, bool), String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok((Vec::new(), false));
        }
        let v: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("unexpected PowerShell output: {e}"))?;

        let mut live = Vec::new();
        for item in as_array(v.get("adapters")) {
            let alias = item.get("alias").and_then(|x| x.as_str()).unwrap_or_default().to_string();
            if alias.is_empty() {
                continue;
            }
            let metric = item
                .get("metric")
                .and_then(|x| x.as_u64())
                .and_then(|m| u32::try_from(m).ok())
                .unwrap_or(UNKNOWN_METRIC);
            live.push(LiveAdapter {
                alias,
                metric,
                servers_v4: json_str_list(item.get("servers_v4")),
                servers_v6: json_str_list(item.get("servers_v6")),
            });
        }

        // Only an exact `.` is a catch-all. `.com` or `.example.org` is a
        // namespace rule that leaves everything else with us.
        let nrpt_catch_all = as_array(v.get("nrpt"))
            .iter()
            .filter_map(|x| x.as_str())
            .any(|ns| ns.trim() == ".");

        Ok((live, nrpt_catch_all))
    }

    /// Detect whether something other than our takeover is positioned to answer
    /// this machine's DNS — see `Exposure` for what that means and why it is
    /// only reported.
    ///
    /// One PowerShell round trip for both halves (adapters + NRPT), all
    /// read-only and available to a standard user, called on the same throttled
    /// ~30s cadence as the drift check rather than every tick.
    pub fn detect_exposure(dns_json_path: &Path) -> Result<Exposure, String> {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$ad = @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $alias = $_.Name
  $m = (Get-NetIPInterface -InterfaceAlias $alias -AddressFamily IPv4).InterfaceMetric
  if ($m -is [array]) { $m = $m[0] }
  if ($null -eq $m) { $m = 4294967295 }
  [PSCustomObject]@{
    alias = $alias
    metric = [uint32]$m
    servers_v4 = @((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv4).ServerAddresses)
    servers_v6 = @((Get-DnsClientServerAddress -InterfaceAlias $alias -AddressFamily IPv6).ServerAddresses)
  }
})
$nrpt = @(Get-DnsClientNrptRule | Where-Object { $_.NameServers } | ForEach-Object { $_.Namespace })
[PSCustomObject]@{ adapters = $ad; nrpt = @($nrpt | ForEach-Object { "$_" }) } | ConvertTo-Json -Depth 5
"#;
        let out = ps()
            .arg("-Command")
            .arg(script)
            .output()
            .map_err(|e| format!("failed to launch PowerShell for the DNS exposure check: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "DNS exposure check failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let (live, nrpt_catch_all) = parse_exposure_json(&String::from_utf8_lossy(&out.stdout))?;
        // No restore point means we hold nothing, so nothing is being sidelined
        // — `Exposure` is about protection we believe we have.
        let captured = CapturedDns::load(dns_json_path).unwrap_or_default();
        Ok(super::exposure_from(&live, &captured, nrpt_catch_all))
    }

    #[cfg(test)]
    mod imp_tests {
        use super::*;

        #[test]
        fn parses_the_combined_adapter_and_nrpt_payload() {
            let json = r#"{
              "adapters": [
                { "alias": "Wi-Fi", "metric": 35, "servers_v4": ["127.0.0.1"], "servers_v6": ["::1"] },
                { "alias": "Tunnel", "metric": 5, "servers_v4": "10.8.0.1", "servers_v6": [] }
              ],
              "nrpt": [".", ".corp.example"]
            }"#;
            let (live, nrpt) = parse_exposure_json(json).expect("must parse");
            assert_eq!(live.len(), 2);
            assert_eq!(live[1].metric, 5);
            // A bare string, not an array — PowerShell emits that for one server.
            assert_eq!(live[1].servers_v4, vec!["10.8.0.1".to_string()]);
            assert!(nrpt, "an exact `.` namespace is a catch-all");
        }

        #[test]
        fn a_namespace_rule_that_is_not_the_root_is_not_a_catch_all() {
            let json = r#"{ "adapters": [], "nrpt": [".corp.example", ".com"] }"#;
            assert!(!parse_exposure_json(json).unwrap().1);
        }

        #[test]
        fn a_missing_metric_is_least_preferred_not_most() {
            let json = r#"{ "adapters": [{ "alias": "Odd", "servers_v4": ["10.0.0.1"] }] }"#;
            let (live, _) = parse_exposure_json(json).expect("must parse");
            assert_eq!(live[0].metric, UNKNOWN_METRIC);
        }

        #[test]
        fn empty_output_is_not_an_error() {
            assert_eq!(parse_exposure_json("   ").unwrap(), (Vec::new(), false));
        }
    }
}

#[cfg(windows)]
pub use imp::{detect_exposure, enumerate, reassert, restore, takeover};

#[cfg(not(windows))]
pub fn enumerate() -> Result<Vec<AdapterDns>, String> {
    Err("DNS adapter enumeration is Windows-only".to_string())
}

/// Nothing to detect where there is no takeover to sideline — the caller treats
/// a clear `Exposure` as "no warning", which is correct off Windows.
#[cfg(not(windows))]
pub fn detect_exposure(_dns_json_path: &Path) -> Result<Exposure, String> {
    Ok(Exposure::default())
}

#[cfg(not(windows))]
pub fn takeover(_dns_json_path: &Path) -> Result<CapturedDns, String> {
    Err("DNS adapter takeover is Windows-only".to_string())
}

#[cfg(not(windows))]
pub fn restore(_dns_json_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn reassert(_dns_json_path: &Path) -> Result<usize, String> {
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(alias: &str, dhcp: bool, v4: &[&str], v6: &[&str]) -> AdapterDns {
        AdapterDns {
            alias: alias.to_string(),
            guid: format!("{{{alias}}}"),
            dhcp,
            servers_v4: v4.iter().map(|s| s.to_string()).collect(),
            servers_v6: v6.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn first_capture_passes_through_unchanged() {
        let fresh = vec![adapter("Wi-Fi", true, &["192.168.1.1"], &["fd00::1"])];
        assert_eq!(capture_for(fresh.clone(), None), fresh);
    }

    #[test]
    fn recapturing_our_own_takeover_keeps_the_real_restore_point() {
        let real = CapturedDns {
            captured_at: 100,
            adapters: vec![adapter("Wi-Fi", false, &["192.168.1.1", "8.8.8.8"], &["fd00::1"])],
        };
        // What enumeration reports once we are already active.
        let fresh = vec![adapter("Wi-Fi", false, &["127.0.0.1"], &["::1"])];

        let out = capture_for(fresh, Some(&real));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].servers_v4, vec!["192.168.1.1".to_string(), "8.8.8.8".to_string()]);
        assert_eq!(out[0].servers_v6, vec!["fd00::1".to_string()]);
    }

    #[test]
    fn loopback_is_never_persisted_even_without_an_earlier_capture() {
        // Worst case: no previous file to fall back on. Persisting nothing is
        // still right — `restore_one` resets such an adapter to DHCP rather
        // than replaying 127.0.0.1 at it forever.
        let out = capture_for(vec![adapter("Wi-Fi", true, &["127.0.0.1"], &["::1"])], None);
        assert!(out[0].servers_v4.is_empty());
        assert!(out[0].servers_v6.is_empty());
    }

    #[test]
    fn an_adapter_that_genuinely_has_no_servers_is_not_resurrected() {
        // The user cleared this adapter's DNS themselves. "Had none" is not
        // "we replaced them", so the stale capture must NOT come back.
        let stale = CapturedDns {
            captured_at: 100,
            adapters: vec![adapter("Wi-Fi", false, &["10.0.0.1"], &[])],
        };
        let out = capture_for(vec![adapter("Wi-Fi", true, &[], &[])], Some(&stale));
        assert!(out[0].servers_v4.is_empty());
        assert!(out[0].dhcp, "the live DHCP state wins for an untouched adapter");
    }

    #[test]
    fn a_new_adapter_is_captured_normally_alongside_a_restored_one() {
        let real = CapturedDns {
            captured_at: 100,
            adapters: vec![adapter("Wi-Fi", false, &["192.168.1.1"], &[])],
        };
        let fresh = vec![
            adapter("Wi-Fi", false, &["127.0.0.1"], &[]),
            adapter("Ethernet", true, &["10.1.1.1"], &[]),
        ];
        let out = capture_for(fresh, Some(&real));
        assert_eq!(out[0].servers_v4, vec!["192.168.1.1".to_string()]);
        assert_eq!(out[1].servers_v4, vec!["10.1.1.1".to_string()]);
    }

    #[test]
    fn mixed_loopback_and_real_servers_keeps_the_real_one() {
        // Only some entries were ours — the adapter still knows a real
        // upstream, so nothing needs resurrecting.
        let out = capture_for(vec![adapter("Wi-Fi", false, &["127.0.0.1", "10.0.0.1"], &[])], None);
        assert_eq!(out[0].servers_v4, vec!["10.0.0.1".to_string()]);
    }

    // ---- exposure detection ------------------------------------------------

    fn live(alias: &str, metric: u32, v4: &[&str]) -> LiveAdapter {
        LiveAdapter {
            alias: alias.to_string(),
            metric,
            servers_v4: v4.iter().map(|s| s.to_string()).collect(),
            servers_v6: Vec::new(),
        }
    }

    /// The adapter we took over, as it looks once takeover has applied.
    fn ours_taken_over(alias: &str, metric: u32) -> LiveAdapter {
        live(alias, metric, &["127.0.0.1"])
    }

    fn captured(aliases: &[&str]) -> CapturedDns {
        CapturedDns {
            captured_at: 0,
            adapters: aliases.iter().map(|a| adapter(a, true, &["192.168.1.1"], &[])).collect(),
        }
    }

    #[test]
    fn a_quiet_machine_reports_nothing() {
        let l = vec![ours_taken_over("Wi-Fi", 35)];
        assert!(exposure_from(&l, &captured(&["Wi-Fi"]), false).is_clear());
    }

    #[test]
    fn a_preferred_foreign_adapter_with_its_own_dns_is_exposure() {
        // The case this exists for: a tunnel adapter appears after takeover with
        // its own resolver and a lower metric, so Windows asks it first and the
        // resolver is never consulted — while `reassert` sees no drift at all.
        let l = vec![ours_taken_over("Wi-Fi", 35), live("Tunnel", 5, &["10.8.0.1"])];
        let e = exposure_from(&l, &captured(&["Wi-Fi"]), false);
        assert_eq!(e.adapters, vec!["Tunnel".to_string()]);
        assert!(!e.is_clear());
    }

    #[test]
    fn a_less_preferred_foreign_adapter_is_not_exposure() {
        // Hyper-V / WSL / VMware virtual switches: real DNS servers configured,
        // higher metric, never consulted before the adapter we hold. Flagging
        // these would fire permanently on most developer machines.
        let l = vec![
            ours_taken_over("Wi-Fi", 35),
            live("vEthernet (Default Switch)", 5000, &["172.30.16.1"]),
            live("VMware Network Adapter VMnet8", 4000, &["192.168.235.1"]),
        ];
        assert!(exposure_from(&l, &captured(&["Wi-Fi"]), false).is_clear());
    }

    #[test]
    fn an_equal_metric_foreign_adapter_counts() {
        // A tie means Windows may consult either one, so protection is no
        // longer something we can claim.
        let l = vec![ours_taken_over("Ethernet", 25), live("Tunnel", 25, &["10.8.0.1"])];
        assert_eq!(exposure_from(&l, &captured(&["Ethernet"]), false).adapters.len(), 1);
    }

    #[test]
    fn a_foreign_adapter_without_its_own_dns_is_not_exposure() {
        // A tunnel that routes traffic but leaves DNS alone still sends queries
        // to us. That configuration has a different problem — the upstream we
        // captured may now be unreachable — which is `forward_failures`' job,
        // not this one's.
        let l = vec![ours_taken_over("Wi-Fi", 35), live("Tunnel", 5, &[])];
        assert!(exposure_from(&l, &captured(&["Wi-Fi"]), false).is_clear());
    }

    #[test]
    fn a_foreign_adapter_pointed_at_our_resolver_is_not_exposure() {
        // Someone (or something) set an adapter we never took over to 127.0.0.1.
        // Its queries reach us, so nothing is being sidelined.
        let l = vec![ours_taken_over("Wi-Fi", 35), live("Tunnel", 5, &["127.0.0.1"])];
        assert!(exposure_from(&l, &captured(&["Wi-Fi"]), false).is_clear());
    }

    #[test]
    fn with_no_captured_adapter_up_any_foreign_dns_counts() {
        // We hold nothing that can win the metric comparison.
        let l = vec![live("Tunnel", 5000, &["10.8.0.1"])];
        assert_eq!(exposure_from(&l, &captured(&["Ethernet"]), false).adapters.len(), 1);
    }

    #[test]
    fn an_nrpt_catch_all_is_exposure_on_its_own() {
        // No foreign adapter at all, but a root-namespace NRPT rule outranks
        // every adapter DNS setting on the machine, including ours.
        let l = vec![ours_taken_over("Wi-Fi", 35)];
        let e = exposure_from(&l, &captured(&["Wi-Fi"]), true);
        assert!(e.adapters.is_empty());
        assert!(!e.is_clear(), "the NRPT half must stand alone");
    }
}
