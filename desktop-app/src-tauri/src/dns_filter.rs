//! src-tauri/src/dns_filter.rs — app-side lifecycle for the system DNS
//! filter (plan items 1.1 + 1.2).
//!
//! Wraps the dependency-free `oathlight-dns` resolver crate: owns the running
//! `DnsServer`, the taken-over/error status the UI reads, and the
//! enable/disable/health-check/revert operations the commands and the
//! monitor tick call into.
//!
//! **Where it runs:** in-process in the Tauri app rather than a separate
//! always-on daemon. The plan floats a watchdog/guardian-hosted resolver, but
//! the app already outlives its own window (it hides to the tray and the
//! dual-process watchdog resurrects it), and running the resolver here keeps
//! all the shared state (blocklists, custom domains, settings) in one place.
//! The two safety nets that make that safe against "the app died and left DNS
//! pointing at a dead resolver" are:
//!
//! 1. the health check on the existing 3s `start_monitor` tick (see
//!    `tick_health_and_revert`), which restores real DNS if the resolver
//!    stops answering; and
//! 2. the guardian's sanctioned-shutdown restore (guardian/src/main.rs),
//!    the last-act restore for a legitimate uninstall.
//!
//! Fail open on infrastructure: any doubt, put the real upstreams back.

use oathlight_dns::{takeover, CapturedDns};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

/// Health-check probe timeout for one monitor tick.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
/// After this many consecutive failed health checks (each ~3s apart, i.e.
/// ~10s of continuous failure), give up trying to revive the resolver and
/// restore the real upstreams so DNS can never stay broken. Fail open.
const HEALTH_FAIL_LIMIT: u64 = 3;

/// What the UI's DNS filter card reads.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DnsStatus {
    /// The resolver process/threads are bound and serving on 127.0.0.1:53.
    pub running: bool,
    /// Adapters have been pointed at the resolver (127.0.0.1 / ::1).
    pub taken_over: bool,
    /// Most recent error to surface verbatim in the UI, or empty.
    pub last_error: String,
    /// The upstream resolvers clean queries are being forwarded to.
    pub upstreams: Vec<String>,
}

/// Managed state for the DNS filter. `server` is `None` when stopped.
pub struct DnsFilterState {
    app_data_dir: PathBuf,
    server: Mutex<Option<oathlight_dns::DnsServer>>,
    status: Mutex<DnsStatus>,
    /// Consecutive failed health checks (reset to 0 on any success). Only
    /// touched from the single monitor thread + enable/disable under the
    /// status lock's ordering, but kept atomic so a read never blocks.
    health_failures: AtomicU64,
}

impl DnsFilterState {
    pub fn new(app_data_dir: &Path) -> Self {
        DnsFilterState {
            app_data_dir: app_data_dir.to_path_buf(),
            server: Mutex::new(None),
            status: Mutex::new(DnsStatus::default()),
            health_failures: AtomicU64::new(0),
        }
    }

    fn dns_json(&self) -> PathBuf {
        self.app_data_dir.join("dns.json")
    }

    fn custom_domains_json(&self) -> PathBuf {
        self.app_data_dir.join("custom_domains.json")
    }

    pub fn status(&self) -> DnsStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_error(&self, msg: String) {
        let mut s = self.status.lock().unwrap();
        s.last_error = msg;
    }

    /// True if the resolver is currently believed to be running (and thus the
    /// health check / revert on the monitor tick should be active).
    pub fn is_active(&self) -> bool {
        self.status.lock().unwrap().running
    }

    /// Start the resolver and take over adapter DNS. Strengthening — meant to
    /// be instant and idempotent: a no-op (returns the current status) if
    /// already running. On a port-53 bind conflict, returns a clear `Err`
    /// and does NOT take over any adapter (the whole point of surfacing the
    /// conflict rather than half-applying).
    pub fn enable(&self) -> Result<DnsStatus, String> {
        {
            let s = self.status.lock().unwrap();
            if s.running {
                return Ok(s.clone());
            }
        }

        // Compute upstreams from the adapters' CURRENT (pre-takeover) DNS
        // servers, so clean queries keep resolving exactly where they did
        // before — falling back to the public resolvers if nothing static is
        // configured. `enumerate` is read-only and needs no admin.
        let upstreams_pair = match takeover::enumerate() {
            Ok(adapters) => {
                let preview = CapturedDns { captured_at: 0, adapters };
                preview.resolve_upstreams()
            }
            Err(e) => {
                // Enumeration failing (e.g. non-Windows, or PowerShell
                // missing) means we can't safely take over — but we can still
                // fall back to the public resolvers for the resolver itself.
                // Takeover below will fail the same way and be reported.
                log::warn!("dns_filter: adapter enumeration failed ({e}); using fallback upstreams");
                (oathlight_dns::FALLBACK_PRIMARY.to_string(), oathlight_dns::FALLBACK_SECONDARY.to_string())
            }
        };
        let upstreams_vec = vec![upstreams_pair.0.clone(), upstreams_pair.1.clone()];

        // Start listening on 127.0.0.1:53. A bind failure here is the port-53
        // conflict case — return it verbatim, take over nothing.
        let server = oathlight_dns::start(upstreams_pair).inspect_err(|e| {
            self.set_error(e.clone());
        })?;

        // Load the user's custom-blocked domains into the resolver + start
        // its slow-refresh loop (idempotent across enables).
        oathlight_dns::init_custom_domains(self.custom_domains_json());

        // Verify the resolver actually answers before redirecting any
        // adapter at it — never point DNS at something that isn't working.
        if !oathlight_dns::health_check(HEALTH_TIMEOUT) {
            server.stop();
            let msg = "The DNS resolver started but isn't answering on 127.0.0.1:53. \
                       No network settings were changed."
                .to_string();
            self.set_error(msg.clone());
            return Err(msg);
        }

        // Capture current adapter DNS to dns.json and point every adapter at
        // the resolver (127.0.0.1 + ::1). A takeover failure (needs admin) is
        // reported but does NOT stop the resolver — status simply shows
        // running-but-not-taken-over with the error, which is honest.
        let (taken_over, err) = match takeover::takeover(&self.dns_json()) {
            Ok(_captured) => (true, String::new()),
            Err(e) => {
                log::warn!("dns_filter: takeover failed: {e}");
                (false, e)
            }
        };

        self.health_failures.store(0, Ordering::SeqCst);
        {
            let mut s = self.status.lock().unwrap();
            s.running = true;
            s.taken_over = taken_over;
            s.last_error = err;
            s.upstreams = upstreams_vec;
        }
        *self.server.lock().unwrap() = Some(server);
        log::info!("dns_filter: enabled (taken_over={taken_over})");
        Ok(self.status())
    }

    /// Stop the resolver and restore adapter DNS to the captured upstreams.
    /// Best-effort and idempotent — safe to call when already stopped. This
    /// is the "apply" step invoked by the friction applier once a
    /// `dns.disable` weakening's delay elapses, and by the uninstall
    /// teardown; the command layer only registers the weakening.
    pub fn disable(&self) {
        if let Some(server) = self.server.lock().unwrap().take() {
            server.stop();
        }
        // Restore even if we thought we weren't taken over — cheap, and it
        // covers the case where a takeover partially applied.
        if let Err(e) = takeover::restore(&self.dns_json()) {
            log::warn!("dns_filter: restore during disable reported: {e}");
        }
        self.health_failures.store(0, Ordering::SeqCst);
        let mut s = self.status.lock().unwrap();
        s.running = false;
        s.taken_over = false;
        s.last_error = String::new();
        s.upstreams = Vec::new();
        log::info!("dns_filter: disabled + adapters restored");
    }

    /// One health-check tick (called from `start_monitor` every 3s when the
    /// filter is enabled). Probes 127.0.0.1:53; on repeated failure past
    /// `HEALTH_FAIL_LIMIT` (~10s), restores the real upstreams and flips the
    /// status to a visible error — the plan's core failsafe: broken DNS must
    /// never brick the machine. Returns nothing; the UI reads `status()`.
    pub fn tick_health_check(&self) {
        if !self.is_active() {
            return;
        }
        if oathlight_dns::health_check(HEALTH_TIMEOUT) {
            self.health_failures.store(0, Ordering::SeqCst);
            return;
        }
        let n = self.health_failures.fetch_add(1, Ordering::SeqCst) + 1;
        log::warn!("dns_filter: health check failed ({n}/{HEALTH_FAIL_LIMIT})");
        if n < HEALTH_FAIL_LIMIT {
            return;
        }
        // The resolver has been unresponsive for ~10s — fail open. Restore
        // the real upstreams so DNS works again, and surface the error.
        log::error!("dns_filter: resolver unresponsive — restoring real DNS (fail-open)");
        if let Some(server) = self.server.lock().unwrap().take() {
            server.stop();
        }
        if let Err(e) = takeover::restore(&self.dns_json()) {
            log::warn!("dns_filter: emergency restore reported: {e}");
        }
        self.health_failures.store(0, Ordering::SeqCst);
        let mut s = self.status.lock().unwrap();
        s.running = false;
        s.taken_over = false;
        s.upstreams = Vec::new();
        s.last_error =
            "The local DNS resolver stopped responding, so your real DNS servers were restored \
             automatically. The system DNS filter is now off — you can turn it back on."
                .to_string();
    }

    /// Re-assert adapter takeover if it has drifted (plan 1.2 layer 3): read
    /// the NameServer values we set and, if an adapter we took over no longer
    /// points at 127.0.0.1, set it back. Only touches adapters recorded in
    /// `dns.json` (the captive-portal / VPN mitigation — we never fight a DNS
    /// change on an adapter we didn't take over). Called on a throttled
    /// cadence from the monitor tick.
    pub fn tick_revert_drift(&self) {
        if !self.is_active() {
            return;
        }
        if !self.status.lock().unwrap().taken_over {
            return; // nothing to defend if takeover never applied.
        }
        match takeover::reassert(&self.dns_json()) {
            Ok(reverted) if reverted > 0 => {
                // TODO(4.5): event log — append a hash-chained `dns_changed`
                // entry here once the tamper-evident log (another agent's
                // task) exists. For now the warning below is the only record.
                log::warn!("dns_filter: {reverted} adapter(s) had drifted off 127.0.0.1 — reverted");
            }
            Ok(_) => {}
            Err(e) => log::warn!("dns_filter: drift check reported: {e}"),
        }
    }
}
