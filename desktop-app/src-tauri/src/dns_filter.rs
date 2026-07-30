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
//!    `tick_health_check`), which restores real DNS if the resolver
//!    stops answering; and
//! 2. the guardian's sanctioned-shutdown restore (guardian/src/main.rs),
//!    the last-act restore for a legitimate uninstall.
//!
//! Fail open on infrastructure: any doubt, put the real upstreams back.
//!
//! **Two failure modes, kept strictly apart.** "The resolver is dead" and "an
//! upstream is unreachable" look the same from a distance and want opposite
//! responses. Only the first justifies tearing the filter down, because only
//! the first is fixed by restoring the real upstreams — doing that for the
//! second disables the user's protection to restore DNS that was already
//! failing. So the health probe is answered locally by the resolver and never
//! forwarded (`server::health_check`), while upstream reachability is a
//! separate, non-fatal check (`pick_upstreams` → `DnsStatus::upstream_warning`)
//! that is reported and never acted on.

use oathlight_dns::{takeover, CapturedDns, Exposure};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Health-check probe timeout for one monitor tick. The probe is answered
/// locally by the resolver (see `server::HEALTH_PROBE_QNAME`), so this is a
/// budget for "are the listener threads alive", not for the network.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
/// After this many consecutive failed health checks (each ~3s apart, i.e.
/// ~10s of continuous failure), give up trying to revive the resolver and
/// restore the real upstreams so DNS can never stay broken. Fail open.
const HEALTH_FAIL_LIMIT: u64 = 3;
/// How long to wait for a candidate upstream to answer a direct query while
/// choosing which ones to forward to. Short on purpose: a resolver that is
/// reachable at all answers in milliseconds, and this runs while the user is
/// watching the switch.
const UPSTREAM_PROBE_TIMEOUT: Duration = Duration::from_millis(900);
/// Never probe more than this many candidates. A machine with several virtual
/// adapters can report a long list, and the point is to find two that work,
/// not to survey all of them.
const MAX_UPSTREAM_PROBES: usize = 6;
/// Consecutive "neither upstream answered" forwards before the upstream pair is
/// re-picked from the adapters that exist now. Low on purpose — each failure
/// already cost the user two upstream timeouts — but not 1, so a single unlucky
/// query on a flaky link can't trigger a re-probe.
const FORWARD_FAILURE_LIMIT: u64 = 4;
/// Minimum gap between upstream re-picks. Without it, a machine with *no*
/// reachable resolver at all would re-probe every few seconds forever: the
/// re-pick would keep landing on the same unreachable candidates, the fallbacks
/// would keep failing, and the counter would keep refilling.
const UPSTREAM_REPICK_COOLDOWN: Duration = Duration::from_secs(30);
/// First gap before retrying a filter that failed to come up, and the ceiling
/// the gap doubles towards.
///
/// **Why a retry loop exists at all.** The filter used to be opt-in, so "it
/// isn't running" was assumed to be a choice and nothing ever tried again. Two
/// consequences, and between them they are most of why this feature was
/// reported as simply not working:
///
/// * the fail-open teardown below (correctly) restores real DNS when the
///   resolver stops answering — and then left it off for the rest of the
///   session, with the switch showing off and nothing saying why. A blip at
///   3pm meant no whole-machine filtering until the next restart.
/// * `enable` at startup runs while Windows is still bringing the network up.
///   A machine that is mid-DHCP, mid-VPN, or briefly holding port 53 fails that
///   one attempt and, again, stayed off.
///
/// Neither is a decision anybody made. The filter is mandatory now, so "off" is
/// always a fault, and a fault is something to keep trying — backing off so a
/// genuinely impossible case (port 53 permanently taken) costs one attempt every
/// five minutes rather than one every three seconds.
const RETRY_BACKOFF_START: u64 = 15;
const RETRY_BACKOFF_MAX: u64 = 300;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

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
    /// Set when the filter is running but no upstream would answer a test
    /// query, so clean (non-blocked) lookups are likely failing. Deliberately
    /// separate from `last_error`: this is a warning about the *network*, not
    /// a failure of the filter, and it must never be mistaken for one — the
    /// fail-open teardown does not fire on it.
    pub upstream_warning: String,
    /// Set when the resolver is running and taken over, but something else on
    /// the machine is positioned to answer DNS instead of it (see
    /// `oathlight_dns::Exposure`) — so the filter is genuinely covering less
    /// than "every app on this computer".
    ///
    /// A third distinct axis on purpose. `last_error` is "we failed",
    /// `upstream_warning` is "the network failed", and this is "we are working
    /// but no longer in the path". Only this one means the UI's headline claim
    /// is currently false, which is why it degrades the status line rather than
    /// sitting underneath it as a footnote.
    pub exposure_warning: String,
}

/// Choose the (primary, secondary) upstreams to forward clean queries to.
///
/// Probes each candidate in enumeration order and keeps the first two that
/// actually answer, then pads with the public fallbacks. This replaced "take
/// the first two captured addresses", which on any machine with Hyper-V, WSL,
/// VMware or VirtualBox installed could pick a virtual gateway that never
/// replies — every clean query then timed out while blocked ones worked fine,
/// which reads to the user as "the filter broke my internet".
///
/// Returns the pair plus a warning string, empty unless *nothing* answered.
/// The warning is reported, never acted on: with no reachable resolver the
/// fallbacks are still the best available guess, and refusing to start would
/// only mean the user gets no protection either.
fn pick_upstreams(candidates: &[String]) -> ((String, String), String) {
    let mut working: Vec<String> = Vec::new();
    for c in candidates.iter().take(MAX_UPSTREAM_PROBES) {
        if oathlight_dns::probe_upstream(c, UPSTREAM_PROBE_TIMEOUT) {
            working.push(c.clone());
            if working.len() == 2 {
                break;
            }
        } else {
            log::warn!("dns_filter: upstream {c} did not answer — skipping it");
        }
    }

    let probed_any = !candidates.is_empty();
    let warning = if probed_any && working.is_empty() {
        format!(
            "None of this computer's DNS servers ({}) answered a test query, so Oath Light is \
             forwarding to {} and {} instead. If pages fail to load, check your network.",
            candidates.iter().take(MAX_UPSTREAM_PROBES).cloned().collect::<Vec<_>>().join(", "),
            oathlight_dns::FALLBACK_PRIMARY,
            oathlight_dns::FALLBACK_SECONDARY,
        )
    } else {
        String::new()
    };

    let primary = working
        .first()
        .cloned()
        .unwrap_or_else(|| oathlight_dns::FALLBACK_PRIMARY.to_string());
    let secondary = working
        .get(1)
        .cloned()
        .unwrap_or_else(|| oathlight_dns::FALLBACK_SECONDARY.to_string());
    ((primary, secondary), warning)
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
    /// Unix seconds of the last upstream re-pick (0 = never), for
    /// `UPSTREAM_REPICK_COOLDOWN`.
    last_repick: AtomicU64,
    /// Unix seconds at which the next attempt to bring the filter up is due
    /// (0 = nothing scheduled, which means either it is running or it was torn
    /// down on purpose by uninstall/update).
    retry_at: AtomicU64,
    /// Current gap between attempts, doubling from `RETRY_BACKOFF_START` to
    /// `RETRY_BACKOFF_MAX`. Reset by any success and by an explicit user retry.
    retry_backoff: AtomicU64,
    /// Last exposure reading, so a change can be logged once instead of every
    /// deep tick for as long as the condition lasts.
    exposure: Mutex<Exposure>,
}

impl DnsFilterState {
    pub fn new(app_data_dir: &Path) -> Self {
        DnsFilterState {
            app_data_dir: app_data_dir.to_path_buf(),
            server: Mutex::new(None),
            status: Mutex::new(DnsStatus::default()),
            health_failures: AtomicU64::new(0),
            last_repick: AtomicU64::new(0),
            retry_at: AtomicU64::new(0),
            retry_backoff: AtomicU64::new(0),
            exposure: Mutex::new(Exposure::default()),
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

    /// Book the next attempt, doubling the gap each time up to the ceiling.
    fn schedule_retry(&self) {
        let next = match self.retry_backoff.load(Ordering::SeqCst) {
            0 => RETRY_BACKOFF_START,
            n => (n * 2).min(RETRY_BACKOFF_MAX),
        };
        self.retry_backoff.store(next, Ordering::SeqCst);
        self.retry_at.store(now_secs() + next, Ordering::SeqCst);
        log::info!("dns_filter: next attempt in {next}s");
    }

    /// Forget the schedule. Called on success, on a deliberate teardown, and by
    /// the command behind the UI's retry — someone who has just granted admin
    /// should not be made to sit out a delay computed from failures that
    /// happened before they fixed the cause.
    pub fn reset_retry(&self) {
        self.retry_backoff.store(0, Ordering::SeqCst);
        self.retry_at.store(0, Ordering::SeqCst);
    }

    /// One retry tick (called from `start_monitor` whenever the filter is *not*
    /// running). Does nothing until the scheduled moment arrives, then tries
    /// `enable` once and re-books on failure. Returns true if the filter came
    /// back up, so the caller can log it.
    ///
    /// Cheap enough for the 3s tick in the common case: two atomic loads and an
    /// early return. Nothing spawns a process until an attempt is actually due.
    pub fn tick_retry(&self) -> bool {
        if self.is_active() {
            return false;
        }
        let due = self.retry_at.load(Ordering::SeqCst);
        if due == 0 || now_secs() < due {
            return false;
        }
        match self.enable() {
            Ok(_) => {
                log::info!("dns_filter: back up after a retry");
                true
            }
            Err(e) => {
                log::warn!("dns_filter: retry failed: {e}");
                false
            }
        }
    }

    /// Re-attempt the adapter takeover for a filter that is running but was
    /// refused the redirect (almost always: the app was not elevated when it
    /// started). Called on the same throttled ~30s cadence as the drift check.
    ///
    /// Without this, "grant admin" fixed nothing until the next logon: the
    /// resolver was already up, so the enable path never ran again, and the
    /// elevated pass had no way to reach back into a running filter. Returns
    /// true when a previously-refused takeover has just succeeded.
    pub fn tick_retry_takeover(&self) -> bool {
        {
            let s = self.status.lock().unwrap();
            if !s.running || s.taken_over {
                return false;
            }
        }
        match takeover::takeover(&self.dns_json()) {
            Ok(_) => {
                let mut s = self.status.lock().unwrap();
                s.taken_over = true;
                s.last_error = String::new();
                log::info!("dns_filter: adapter takeover succeeded on retry");
                true
            }
            Err(e) => {
                // Expected on every tick until something changes (still not
                // elevated). Kept at debug so it can't drown the log.
                log::debug!("dns_filter: takeover retry still refused: {e}");
                self.status.lock().unwrap().last_error = e;
                false
            }
        }
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
        // before — but only after checking each candidate actually answers.
        // `enumerate` is read-only and needs no admin.
        let candidates = match takeover::enumerate() {
            Ok(adapters) => CapturedDns { captured_at: 0, adapters }.upstream_candidates(),
            Err(e) => {
                // Enumeration failing (e.g. non-Windows, or PowerShell
                // missing) means we can't safely take over — but we can still
                // fall back to the public resolvers for the resolver itself.
                // Takeover below will fail the same way and be reported.
                log::warn!("dns_filter: adapter enumeration failed ({e}); using fallback upstreams");
                Vec::new()
            }
        };
        let (upstreams_pair, upstream_warning) = pick_upstreams(&candidates);
        let upstreams_vec = vec![upstreams_pair.0.clone(), upstreams_pair.1.clone()];

        // Start listening on 127.0.0.1:53. A bind failure here is the port-53
        // conflict case — return it verbatim, take over nothing.
        let server = oathlight_dns::start(upstreams_pair).inspect_err(|e| {
            self.set_error(e.clone());
            self.schedule_retry();
        })?;

        // Load the user's custom-blocked domains into the resolver + start
        // its slow-refresh loop (idempotent across enables).
        oathlight_dns::init_custom_domains(self.custom_domains_json());

        // Verify the resolver actually answers before redirecting any
        // adapter at it — never point DNS at something that isn't working.
        // The probe is answered by the resolver itself and never forwarded, so
        // a failure here means the listener threads are genuinely not serving
        // — not that the network is slow. (It used to ask for a real name,
        // which made an unreachable upstream look identical to a dead
        // resolver; see `server::HEALTH_PROBE_QNAME`.)
        if !oathlight_dns::health_check(HEALTH_TIMEOUT) {
            server.stop();
            let msg = "The DNS resolver bound port 53 but isn't answering on it. Something on this \
                       computer — usually a firewall or security product — is blocking loopback \
                       traffic to 127.0.0.1:53. No network settings were changed."
                .to_string();
            self.set_error(msg.clone());
            self.schedule_retry();
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
        // The resolver is up, so nothing is owed a retry. Note this is reached
        // even when `taken_over` is false: the filter IS running, and the part
        // that failed (redirecting adapters) is the deep tick's
        // `tick_retry_takeover` to keep attempting, not the enable path's.
        self.reset_retry();
        // A fresh enable starts from a clean slate on both derived signals: the
        // cooldown must not carry over from a previous session, and the stored
        // exposure must not suppress the first log of a condition that is still
        // present.
        self.last_repick.store(0, Ordering::SeqCst);
        *self.exposure.lock().unwrap() = Exposure::default();
        {
            let mut s = self.status.lock().unwrap();
            s.running = true;
            s.taken_over = taken_over;
            s.last_error = err;
            s.upstreams = upstreams_vec;
            s.upstream_warning = upstream_warning;
            s.exposure_warning = String::new();
        }
        *self.server.lock().unwrap() = Some(server);
        log::info!("dns_filter: enabled (taken_over={taken_over})");
        Ok(self.status())
    }

    /// Stop the resolver and restore adapter DNS to the captured upstreams.
    /// Best-effort and idempotent — safe to call when already stopped.
    ///
    /// **The only deliberate teardown left.** The `dns.disable` weakening it
    /// used to serve is gone (the filter is mandatory), so the callers are now
    /// the uninstall teardown and the update window — both of which are about to
    /// stop or replace the process that hosts the resolver, and neither of which
    /// wants the retry loop bringing it back in the meantime. Hence the
    /// `reset_retry`: this is the one path where "not running" is intended.
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
        self.last_repick.store(0, Ordering::SeqCst);
        self.reset_retry();
        *self.exposure.lock().unwrap() = Exposure::default();
        let mut s = self.status.lock().unwrap();
        s.running = false;
        s.taken_over = false;
        s.last_error = String::new();
        s.upstreams = Vec::new();
        s.upstream_warning = String::new();
        s.exposure_warning = String::new();
        log::info!("dns_filter: disabled + adapters restored");
    }

    /// One health-check tick (called from `start_monitor` every 3s when the
    /// filter is enabled). Probes 127.0.0.1:53; on repeated failure past
    /// `HEALTH_FAIL_LIMIT` (~10s), restores the real upstreams and flips the
    /// status to a visible error — the plan's core failsafe: broken DNS must
    /// never brick the machine. Returns nothing; the UI reads `status()`.
    ///
    /// Failing open is still right, and it is now **temporary**. Standing the
    /// filter down is the correct response to a dead resolver; leaving it down
    /// until a human noticed was not, and it is most of what "the DNS filter
    /// doesn't work" meant in practice — a transient fault silently became a
    /// permanent one. The teardown books a retry on the way out (see
    /// `RETRY_BACKOFF_START`), so DNS is handed back within seconds and the
    /// filter comes back on its own once whatever broke it has passed.
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
        self.last_repick.store(0, Ordering::SeqCst);
        *self.exposure.lock().unwrap() = Exposure::default();
        self.schedule_retry();
        let mut s = self.status.lock().unwrap();
        s.running = false;
        s.taken_over = false;
        s.upstreams = Vec::new();
        s.upstream_warning = String::new();
        s.exposure_warning = String::new();
        s.last_error =
            "The local DNS resolver stopped responding, so your real DNS servers were restored \
             and Oath Light is starting it again. Your browser stayed protected throughout."
                .to_string();
    }

    /// Re-assert adapter takeover if it has drifted (plan 1.2 layer 3): read
    /// the NameServer values we set and, if an adapter we took over no longer
    /// points at 127.0.0.1, set it back. Only touches adapters recorded in
    /// `dns.json` (the captive-portal / VPN mitigation — we never fight a DNS
    /// change on an adapter we didn't take over). Called on a throttled
    /// cadence from the monitor tick.
    ///
    /// Returns how many adapters were reverted, so the caller can write the
    /// `dns_changed` event-log entry — this module stays free of `AppHandle`
    /// (and therefore unit-testable) by reporting rather than logging.
    pub fn tick_revert_drift(&self) -> usize {
        if !self.is_active() {
            return 0;
        }
        if !self.status.lock().unwrap().taken_over {
            return 0; // nothing to defend if takeover never applied.
        }
        match takeover::reassert(&self.dns_json()) {
            Ok(reverted) => {
                if reverted > 0 {
                    log::warn!("dns_filter: {reverted} adapter(s) had drifted off 127.0.0.1 — reverted");
                }
                reverted
            }
            Err(e) => {
                log::warn!("dns_filter: drift check reported: {e}");
                0
            }
        }
    }

    /// Re-pick upstreams when the pair chosen at enable time has stopped
    /// answering. Called on **every** monitor tick: the guard is one uncontended
    /// mutex acquisition plus one atomic load. The expensive part (enumerating
    /// adapters and probing them, seconds) only runs once the resolver has
    /// actually failed `FORWARD_FAILURE_LIMIT` forwards in a row, and it runs
    /// with no lock held.
    ///
    /// This is the missing half of the two-failure-modes split described in the
    /// module doc. The health probe deliberately cannot see an upstream problem,
    /// which is right — restoring real DNS would not fix it — but it left the
    /// third case with no handler at all: the upstream is *gone*, not slow, and
    /// no amount of waiting brings it back. A machine that changes routing under
    /// a live filter (a tunnel comes up, the LAN resolver is no longer reachable
    /// through it) would otherwise forward into a black hole for the rest of the
    /// session while the status card showed green, with clean lookups failing
    /// and blocked ones answering instantly.
    ///
    /// Re-enumerating is what fixes it: the adapters that exist *now* include
    /// whatever resolver the new route can actually reach, so the filter keeps
    /// working — queries still come to us, we just forward them somewhere
    /// reachable. Returns true if the pair changed.
    pub fn tick_recheck_upstreams(&self) -> bool {
        if !self.is_active() {
            return false;
        }
        // Cheap guard on the hot path. Taking the server lock here is not free,
        // but it is held for exactly one atomic load and is uncontended in the
        // steady state — queries never touch this mutex (they read the upstream
        // pair from `Shared`, inside the server), so the only other contenders
        // are enable/disable. Nothing expensive happens until the resolver has
        // really been failing.
        let failures = match self.server.lock().unwrap().as_ref() {
            Some(server) => server.forward_failures(),
            None => return false,
        };
        if failures < FORWARD_FAILURE_LIMIT {
            return false;
        }
        let now = now_secs();
        let last = self.last_repick.load(Ordering::SeqCst);
        if last != 0 && now.saturating_sub(last) < UPSTREAM_REPICK_COOLDOWN.as_secs() {
            return false;
        }
        self.last_repick.store(now, Ordering::SeqCst);

        // Enumerate and probe with NO lock held — this can take several seconds
        // and must never block a query or `disable`.
        log::warn!(
            "dns_filter: {failures} consecutive forwards failed — re-picking upstreams"
        );
        let candidates = match takeover::enumerate() {
            Ok(adapters) => CapturedDns { captured_at: 0, adapters }.upstream_candidates(),
            Err(e) => {
                log::warn!("dns_filter: re-enumeration failed ({e}); keeping current upstreams");
                return false;
            }
        };
        let (pair, warning) = pick_upstreams(&candidates);
        let next = vec![pair.0.clone(), pair.1.clone()];

        let changed = {
            let guard = self.server.lock().unwrap();
            let Some(server) = guard.as_ref() else { return false }; // disabled while we probed
            let changed = server.upstreams() != pair;
            // Always swap, even when the pair is identical: `set_upstreams`
            // clears the failure counter, which is what stops this from
            // re-running on the very next tick.
            server.set_upstreams(pair);
            changed
        };

        let mut s = self.status.lock().unwrap();
        s.upstreams = next;
        s.upstream_warning = warning;
        if changed {
            log::info!("dns_filter: upstreams now {:?}", s.upstreams);
        }
        changed
    }

    /// Detect whether something other than our takeover is positioned to answer
    /// this machine's DNS — a network interface we did not take over carrying
    /// its own resolver at an equal-or-better interface metric, or an NRPT rule
    /// claiming the root namespace. Called on the same throttled ~30s cadence as
    /// the drift check (one read-only PowerShell round trip).
    ///
    /// Nothing is fought or undone: see `oathlight_dns::Exposure` for why that
    /// stays deliberate. What this changes is honesty — `exposure_warning` makes
    /// the status card stop claiming "every app on this computer" while that is
    /// not true.
    ///
    /// Returns `Some` only on a *change*, so the caller writes one event-log
    /// entry per transition rather than one every 30s for as long as it lasts.
    pub fn tick_detect_exposure(&self) -> Option<Exposure> {
        let taken_over = self.is_active() && self.status.lock().unwrap().taken_over;
        if !taken_over {
            // Nothing is claimed, so nothing can be overclaimed. Clear silently
            // — `disable`/fail-open already reset the stored reading.
            return None;
        }
        let found = match takeover::detect_exposure(&self.dns_json()) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("dns_filter: exposure check reported: {e}");
                return None;
            }
        };
        {
            let mut stored = self.exposure.lock().unwrap();
            if *stored == found {
                return None;
            }
            *stored = found.clone();
        }
        self.status.lock().unwrap().exposure_warning = exposure_message(&found);
        if found.is_clear() {
            log::info!("dns_filter: exposure cleared — the resolver is back in the DNS path");
        } else {
            log::warn!(
                "dns_filter: DNS may be bypassing the resolver (adapters={:?}, nrpt_catch_all={})",
                found.adapters,
                found.nrpt_catch_all
            );
        }
        Some(found)
    }
}

/// The user-facing sentence for an `Exposure`, or empty when clear.
///
/// Wording rule: describe the *state of protection*, never the mechanism as a
/// route around it. "Another connection is handling DNS" tells someone their
/// cover is reduced and what to look at; naming it as a way to defeat the filter
/// would turn a status line into an instruction. Same reason the adapter is
/// named but no remedy is offered: identifying it is diagnosis, and a fix would
/// be a bypass recipe.
fn exposure_message(e: &Exposure) -> String {
    if e.is_clear() {
        return String::new();
    }
    if e.nrpt_catch_all {
        return "A DNS policy on this computer is directing lookups somewhere other than Oath \
                Light, so apps outside your browser may not be filtered right now. Your browser \
                is still protected."
            .to_string();
    }
    let names = e.adapters.join(", ");
    format!(
        "Another network connection ({names}) is providing its own DNS, so apps outside your \
         browser may not be filtered while it is active. Your browser is still protected."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> DnsFilterState {
        DnsFilterState::new(std::path::Path::new("."))
    }

    /// The backoff climbs and then stops climbing. A machine where the filter
    /// genuinely cannot run (port 53 permanently held) must settle into one
    /// cheap attempt every few minutes, not hammer every tick and not give up.
    #[test]
    fn the_retry_gap_doubles_up_to_the_ceiling_and_stays_there() {
        let st = state();
        let mut gaps = Vec::new();
        for _ in 0..8 {
            st.schedule_retry();
            gaps.push(st.retry_backoff.load(Ordering::SeqCst));
        }
        assert_eq!(gaps[0], RETRY_BACKOFF_START);
        assert_eq!(gaps[1], RETRY_BACKOFF_START * 2);
        assert!(gaps.windows(2).all(|w| w[1] >= w[0]), "the gap must never shrink: {gaps:?}");
        assert_eq!(*gaps.last().unwrap(), RETRY_BACKOFF_MAX);
    }

    /// A scheduled retry is a real appointment: something must be booked, and it
    /// must be in the future rather than "now, repeatedly".
    #[test]
    fn scheduling_books_an_attempt_in_the_future() {
        let st = state();
        assert_eq!(st.retry_at.load(Ordering::SeqCst), 0, "nothing is owed before a failure");
        st.schedule_retry();
        assert!(st.retry_at.load(Ordering::SeqCst) > now_secs());
    }

    /// The user has just granted admin (or fixed their network). Making them
    /// wait out a delay derived from failures that predate the fix would punish
    /// them for fixing it.
    #[test]
    fn an_explicit_retry_clears_the_accumulated_backoff() {
        let st = state();
        for _ in 0..5 {
            st.schedule_retry();
        }
        st.reset_retry();
        assert_eq!(st.retry_at.load(Ordering::SeqCst), 0);
        st.schedule_retry();
        assert_eq!(
            st.retry_backoff.load(Ordering::SeqCst),
            RETRY_BACKOFF_START,
            "the next failure starts the ladder again from the bottom"
        );
    }

    /// `disable` is the one intended teardown (uninstall / update window). It
    /// must not leave an appointment behind, or the retry loop would resurrect a
    /// resolver hosted by a process that is deliberately going away.
    #[test]
    fn a_deliberate_teardown_leaves_nothing_scheduled() {
        let st = state();
        st.schedule_retry();
        st.disable();
        assert_eq!(st.retry_at.load(Ordering::SeqCst), 0);
        assert!(!st.tick_retry(), "a torn-down filter must not restart itself");
    }

    /// Nothing is due until its moment arrives — the 3s monitor tick calls this
    /// constantly and must not turn a backoff into a busy loop.
    #[test]
    fn a_retry_that_is_not_due_yet_does_nothing() {
        let st = state();
        st.schedule_retry();
        assert!(!st.tick_retry(), "the gap has not elapsed");
        assert!(st.retry_at.load(Ordering::SeqCst) > now_secs(), "and the appointment stands");
    }

    #[test]
    fn no_candidates_means_fallbacks_and_no_warning() {
        // Nothing was enumerated (non-Windows, or PowerShell unavailable).
        // That is not evidence the network is broken, so it must not warn.
        let ((p, s), warn) = pick_upstreams(&[]);
        assert_eq!(p, oathlight_dns::FALLBACK_PRIMARY);
        assert_eq!(s, oathlight_dns::FALLBACK_SECONDARY);
        assert!(warn.is_empty());
    }

    #[test]
    fn a_clear_exposure_produces_no_message() {
        assert!(exposure_message(&Exposure::default()).is_empty());
    }

    #[test]
    fn an_exposure_message_names_the_connection_and_keeps_the_browser_caveat() {
        let e = Exposure { adapters: vec!["Tunnel".to_string()], nrpt_catch_all: false };
        let msg = exposure_message(&e);
        assert!(msg.contains("Tunnel"), "the user needs to know which connection: {msg}");
        assert!(
            msg.contains("browser is still protected"),
            "reduced cover is not no cover — the message must not read as total failure: {msg}"
        );
    }

    #[test]
    fn the_nrpt_case_gets_its_own_message_and_never_names_an_adapter_list() {
        // An NRPT catch-all outranks every adapter, so an adapter list would be
        // misleading here even when one happens to be present.
        let e = Exposure { adapters: vec!["Tunnel".to_string()], nrpt_catch_all: true };
        let msg = exposure_message(&e);
        assert!(msg.contains("DNS policy"), "{msg}");
        assert!(!msg.contains("Tunnel"), "{msg}");
    }

    #[test]
    fn unreachable_candidates_fall_back_and_say_so() {
        // RFC 5737 TEST-NET-1 is guaranteed non-routable, so this exercises
        // the real timeout path without depending on the test machine's
        // network having (or lacking) anything in particular.
        let ((p, s), warn) = pick_upstreams(&["192.0.2.1".to_string()]);
        assert_eq!(p, oathlight_dns::FALLBACK_PRIMARY);
        assert_eq!(s, oathlight_dns::FALLBACK_SECONDARY);
        assert!(warn.contains("192.0.2.1"), "the warning must name what was tried: {warn}");
    }
}
