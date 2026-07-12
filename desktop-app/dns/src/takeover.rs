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

use crate::upstream::{AdapterDns, CapturedDns};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

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
} | ConvertTo-Json -Depth 4 -AsArray
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
        let adapters = enumerate()?;
        let captured_at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let captured = CapturedDns { captured_at, adapters: adapters.clone() };
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
}

#[cfg(windows)]
pub use imp::{enumerate, reassert, restore, takeover};

#[cfg(not(windows))]
pub fn enumerate() -> Result<Vec<AdapterDns>, String> {
    Err("DNS adapter enumeration is Windows-only".to_string())
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
