//! dns/src/server.rs — the UDP+TCP DNS forwarding proxy itself.
//!
//! Binds `127.0.0.1:53` (UDP + TCP), decides each query via `decide::decide`,
//! and either synthesizes an NXDOMAIN (blocked) or forwards the raw query to
//! an upstream resolver and relays the raw response back (clean). No
//! third-party DNS crate — see the module doc on `lib.rs` for why.
//!
//! Concurrency: a small fixed pool of threads share one bound UDP socket
//! (`UdpSocket::try_clone` — the kernel fans datagrams out to whichever
//! thread calls `recv_from` next) and handle each query synchronously; TCP is
//! thread-per-connection off one accept loop. Both the UDP workers and the
//! TCP accept loop poll a shared `running` flag on a short timeout/nonblocking
//! basis so `DnsServer::stop` can bring every thread down without needing a
//! self-connect trick.

use crate::decide::{self, Decision};
use crate::packet::{self, ParsedQuery};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const UDP_WORKERS: usize = 4;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(3);
/// How often a blocked-on-I/O loop wakes up to re-check `running` — bounds
/// how long `stop()` takes to actually quiesce every thread.
const POLL_INTERVAL: Duration = Duration::from_millis(300);
/// Generous upper bound for a DNS message over UDP with EDNS0 (plain DNS
/// without EDNS tops out at 512, but resolvers routinely advertise larger
/// UDP payloads) — oversized reads are simply truncated by `recv_from`,
/// which is fine: `packet::parse_query` will reject a truncated result.
const UDP_BUF_LEN: usize = 4096;

/// The name `health_check` asks for, answered locally and never forwarded.
///
/// **Why a reserved name and not `example.com`.** The probe used to ask for a
/// real name, which meant a "healthy" answer required a working upstream. That
/// made the probe report the wrong thing in both directions:
///
/// * At enable time, an unreachable upstream (a Hyper-V/WSL virtual gateway
///   picked as primary, a corporate network that blocks port 53 to public
///   resolvers, a slow link) made the probe time out — and the caller
///   announced *"the resolver started but isn't answering on 127.0.0.1:53"*,
///   which was simply false. The resolver was answering; the upstream wasn't.
/// * On the monitor tick, ~10s of upstream trouble tripped the fail-open
///   teardown — turning the user's protection off to "fix" DNS by pointing it
///   back at the exact same upstream that was already failing.
///
/// The probe's one job is *"are the listener threads alive and serving on
/// 127.0.0.1:53"*, so it now asks something only this resolver can answer.
/// `.invalid` is reserved by RFC 6761 §6.4 and is guaranteed never to resolve,
/// so special-casing it takes nothing away from anyone.
const HEALTH_PROBE_QNAME: &str = "health-probe.oathlight.invalid";

pub type Upstreams = (String, String);

/// Forwarding state every worker shares: which upstreams to forward to, and
/// how many *consecutive* clean queries got no answer from either of them.
///
/// The counter exists because the upstream pair is chosen once, at enable
/// time, from the adapters that were up then — and the machine's routing can
/// change underneath it. The case that motivated this: enable on a LAN
/// (upstream `192.168.1.1`), then bring up a full-tunnel VPN. The LAN resolver
/// is no longer reachable, so every clean query burns `UPSTREAM_TIMEOUT` twice
/// and is then dropped, while blocked names still answer NXDOMAIN instantly —
/// which reads to the user as "the filter broke my internet", forever, because
/// the health probe is answered locally by design and so never notices.
///
/// A count of consecutive total failures is the one signal that distinguishes
/// "this upstream is gone" from "one query got unlucky", and it is what lets
/// `dns_filter` re-pick upstreams from the adapters that exist *now* instead of
/// forwarding into a black hole for the rest of the session.
struct Shared {
    upstreams: Mutex<Upstreams>,
    forward_failures: AtomicU64,
}

/// A running resolver instance. Dropping this does NOT stop it — call
/// `stop()` explicitly (mirrors every other "is this thing on" state in this
/// codebase, e.g. `MonitorState`, which the caller owns and stops the same
/// explicit way).
pub struct DnsServer {
    running: Arc<AtomicBool>,
    shared: Arc<Shared>,
}

impl DnsServer {
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Consecutive clean queries that got no answer from *either* upstream.
    /// Reset to 0 by the next successful forward, and by `set_upstreams`.
    pub fn forward_failures(&self) -> u64 {
        self.shared.forward_failures.load(Ordering::SeqCst)
    }

    /// The pair clean queries are currently forwarded to.
    pub fn upstreams(&self) -> Upstreams {
        self.shared.upstreams.lock().unwrap().clone()
    }

    /// Swap in a new upstream pair, live, without restarting the listeners —
    /// in-flight queries keep using the pair they already read. Resets the
    /// failure counter so the new pair gets a full budget of its own before it
    /// can trip another re-pick.
    pub fn set_upstreams(&self, next: Upstreams) {
        *self.shared.upstreams.lock().unwrap() = next;
        self.shared.forward_failures.store(0, Ordering::SeqCst);
    }
}

/// Bind `127.0.0.1:53` (UDP + TCP) and start serving. `upstreams` is the
/// (primary, secondary) pair clean queries are forwarded to — see
/// `upstream::CapturedDns::resolve_upstreams`.
///
/// Binding failure (most commonly: something else already owns port 53 —
/// ICS, another local resolver, a VPN client, Docker) is reported as a plain
/// string the caller can show verbatim in the UI; **no adapter takeover
/// happens if this returns `Err`** — that's the caller's responsibility (see
/// the app-side `dns_filter` module), but is called out here because it's
/// the one invariant this function's contract depends on staying true.
pub fn start(upstreams: Upstreams) -> Result<DnsServer, String> {
    let udp = UdpSocket::bind("127.0.0.1:53").map_err(|e| {
        format!(
            "Could not bind 127.0.0.1:53 (UDP) — {e}. Something else on this machine is already \
             using port 53 (a VPN client, Internet Connection Sharing, Docker, or another local \
             DNS filter). Free the port or disable the conflicting service, then try again."
        )
    })?;
    let tcp = TcpListener::bind("127.0.0.1:53").map_err(|e| {
        format!("Could not bind 127.0.0.1:53 (TCP) — {e}. See the UDP bind error for likely causes.")
    })?;
    udp.set_read_timeout(Some(POLL_INTERVAL)).ok();
    tcp.set_nonblocking(true).ok();

    let running = Arc::new(AtomicBool::new(true));
    let shared = Arc::new(Shared {
        upstreams: Mutex::new(upstreams),
        forward_failures: AtomicU64::new(0),
    });

    for _ in 0..UDP_WORKERS {
        let sock = udp.try_clone().map_err(|e| format!("could not clone the UDP socket: {e}"))?;
        let running = running.clone();
        let shared = shared.clone();
        std::thread::spawn(move || udp_worker(sock, running, shared));
    }

    {
        let running = running.clone();
        let shared = shared.clone();
        std::thread::spawn(move || tcp_accept_loop(tcp, running, shared));
    }

    log::info!("oathlight-dns: listening on 127.0.0.1:53 (UDP+TCP)");
    Ok(DnsServer { running, shared })
}

fn udp_worker(sock: UdpSocket, running: Arc<AtomicBool>, shared: Arc<Shared>) {
    let mut buf = [0u8; UDP_BUF_LEN];
    while running.load(Ordering::SeqCst) {
        match sock.recv_from(&mut buf) {
            Ok((n, src)) => {
                let data = &buf[..n];
                if let Some(resp) = process_query(data, &shared, false) {
                    let _ = sock.send_to(&resp, src);
                }
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(_) => continue, // transient recv error — never crash the worker.
        }
    }
}

fn tcp_accept_loop(listener: TcpListener, running: Arc<AtomicBool>, shared: Arc<Shared>) {
    while running.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _addr)) => {
                let shared = shared.clone();
                std::thread::spawn(move || handle_tcp_conn(stream, &shared));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(_) => std::thread::sleep(POLL_INTERVAL),
        }
    }
}

fn handle_tcp_conn(mut stream: TcpStream, shared: &Shared) {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut len_buf = [0u8; 2];
    if stream.read_exact(&mut len_buf).is_err() {
        return;
    }
    let len = u16::from_be_bytes(len_buf) as usize;
    let mut msg = vec![0u8; len];
    if stream.read_exact(&mut msg).is_err() {
        return;
    }
    let Some(resp) = process_query(&msg, shared, true) else { return };
    let resp_len = (resp.len() as u16).to_be_bytes();
    let _ = stream.write_all(&resp_len);
    let _ = stream.write_all(&resp);
}

/// Parse, decide, and either synthesize NXDOMAIN or forward. `None` means
/// "drop the packet, answer nothing" — a malformed query, or a forward that
/// got no reply from either upstream.
///
/// Only a *forwarded* query touches `forward_failures`: a blocked name and the
/// health probe are both answered from here without an upstream, so neither can
/// mask a dead upstream by resetting the counter, nor trip a re-pick by failing.
fn process_query(raw: &[u8], shared: &Shared, is_tcp: bool) -> Option<Vec<u8>> {
    let q: ParsedQuery = match packet::parse_query(raw) {
        Ok(q) => q,
        Err(_) => return None,
    };
    // The loopback health probe — answered here, before `decide` and before
    // any chance of forwarding, so what it measures is this resolver and
    // nothing else. See HEALTH_PROBE_QNAME.
    if q.qname == HEALTH_PROBE_QNAME {
        return Some(packet::synthesize_nxdomain(raw, &q));
    }
    if let Decision::Block = decide::decide(&q.qname) {
        return Some(packet::synthesize_nxdomain(raw, &q));
    }
    // Clone the pair rather than holding the lock across the forward — a swap
    // from `set_upstreams` must never wait on a 3s upstream timeout.
    let upstreams = shared.upstreams.lock().unwrap().clone();
    let forwarded = if is_tcp {
        forward_tcp(raw, &upstreams)
    } else {
        forward_udp(raw, &upstreams)
    };
    match forwarded {
        Some(resp) => {
            // Cheap on the hot path: only pay the write when it changes something.
            if shared.forward_failures.load(Ordering::Relaxed) != 0 {
                shared.forward_failures.store(0, Ordering::SeqCst);
            }
            Some(resp)
        }
        None => {
            shared.forward_failures.fetch_add(1, Ordering::SeqCst);
            None
        }
    }
}

fn forward_udp(raw: &[u8], upstreams: &Upstreams) -> Option<Vec<u8>> {
    try_forward_udp_one(raw, &upstreams.0).or_else(|| try_forward_udp_one(raw, &upstreams.1))
}

fn try_forward_udp_one(raw: &[u8], server: &str) -> Option<Vec<u8>> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(UPSTREAM_TIMEOUT)).ok();
    let addr = format!("{server}:53");
    sock.send_to(raw, addr).ok()?;
    let mut buf = [0u8; UDP_BUF_LEN];
    let (n, _) = sock.recv_from(&mut buf).ok()?;
    Some(buf[..n].to_vec())
}

fn forward_tcp(raw: &[u8], upstreams: &Upstreams) -> Option<Vec<u8>> {
    try_forward_tcp_one(raw, &upstreams.0).or_else(|| try_forward_tcp_one(raw, &upstreams.1))
}

fn try_forward_tcp_one(raw: &[u8], server: &str) -> Option<Vec<u8>> {
    let addr: SocketAddr = format!("{server}:53").parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, UPSTREAM_TIMEOUT).ok()?;
    stream.set_read_timeout(Some(UPSTREAM_TIMEOUT)).ok();
    let len = (raw.len() as u16).to_be_bytes();
    stream.write_all(&len).ok()?;
    stream.write_all(raw).ok()?;
    let mut len_buf = [0u8; 2];
    stream.read_exact(&mut len_buf).ok()?;
    let rlen = u16::from_be_bytes(len_buf) as usize;
    let mut resp = vec![0u8; rlen];
    stream.read_exact(&mut resp).ok()?;
    Some(resp)
}

/// A transaction ID that differs between consecutive probes, so a stale
/// datagram left over from a previous probe can't be mistaken for this one's
/// answer. Not security-relevant — both endpoints are on loopback.
fn probe_id() -> u16 {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
        & 0xFFFF) as u16
}

/// Send `query` to `addr` and return true if a well-formed response with a
/// matching transaction ID comes back within `timeout`.
fn ask(bind: &str, addr: &str, query: &[u8], id: u16, timeout: Duration) -> bool {
    let Ok(sock) = UdpSocket::bind(bind) else { return false };
    sock.set_read_timeout(Some(timeout)).ok();
    if sock.send_to(query, addr).is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    match sock.recv_from(&mut buf) {
        Ok((n, _)) if n >= 12 => u16::from_be_bytes([buf[0], buf[1]]) == id,
        _ => false,
    }
}

/// Loopback health probe: ask `127.0.0.1:53` for the reserved
/// `HEALTH_PROBE_QNAME` and check that a matching response comes back within
/// `timeout`. Answers to that name are synthesized locally, so this measures
/// exactly one thing — **is the resolver serving on 127.0.0.1:53** — and never
/// fails because the network is having a bad day.
///
/// That separation is the whole point. This drives the plan's failsafe (broken
/// DNS must never brick the machine), and the failsafe's remedy is to put the
/// real upstreams back. Firing it because an *upstream* is unreachable would
/// disable the user's protection to restore DNS that was already broken.
/// Upstream reachability is checked separately, by `probe_upstream`, and is
/// reported rather than acted on.
pub fn health_check(timeout: Duration) -> bool {
    let id = probe_id();
    let query = packet::build_query(id, HEALTH_PROBE_QNAME);
    ask("127.0.0.1:0", "127.0.0.1:53", &query, id, timeout)
}

/// Does `server` (a bare IPv4 literal) actually answer DNS queries from this
/// machine? Asks it for `example.com` directly — not through the resolver —
/// and waits `timeout` for a reply with a matching transaction ID.
///
/// Used at enable time to choose upstreams that work instead of whichever
/// adapter Windows happened to enumerate first. A machine with Hyper-V, WSL,
/// VMware or VirtualBox installed has several "Up" adapters whose DNS server
/// is a virtual gateway that never replies to the host; before this existed,
/// one of those becoming the primary upstream broke every clean query.
pub fn probe_upstream(server: &str, timeout: Duration) -> bool {
    let id = probe_id();
    let query = packet::build_query(id, "example.com");
    ask("0.0.0.0:0", &format!("{server}:53"), &query, id, timeout)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Upstreams that can never answer — RFC 5737 TEST-NET-1 is guaranteed
    /// non-routable, so a forward through this always fails without depending
    /// on the test machine's network.
    fn unreachable_shared() -> Shared {
        Shared {
            upstreams: Mutex::new(("192.0.2.1".to_string(), "192.0.2.2".to_string())),
            forward_failures: AtomicU64::new(0),
        }
    }

    // Binding 127.0.0.1:53 needs admin, so the probe is exercised through
    // `process_query` — the one function whose behaviour actually has to hold:
    // the health-probe name must be answered from here, never forwarded.
    #[test]
    fn health_probe_is_answered_locally() {
        let shared = unreachable_shared();
        let id = 0x4242;
        let raw = packet::build_query(id, HEALTH_PROBE_QNAME);

        let resp = process_query(&raw, &shared, false)
            .expect("the probe must be answered without touching an upstream");
        assert_eq!(u16::from_be_bytes([resp[0], resp[1]]), id);
        assert_eq!(resp[2] & 0x80, 0x80, "QR must be set");
    }

    #[test]
    fn locally_answered_queries_leave_the_failure_counter_alone() {
        // Both classes that never reach an upstream: the health probe, and a
        // blocked name (`cloudflare-dns.com` is on the DoH list, which `decide`
        // resolves from a static set — no blocklist state to arrange).
        //
        // Neither direction is allowed to move: bumping the counter would make
        // an idle machine re-pick upstreams with no query having failed, and
        // clearing it would let steady blocked traffic mask an upstream that is
        // genuinely dead.
        let shared = unreachable_shared();
        shared.forward_failures.store(2, Ordering::SeqCst);
        for qname in [HEALTH_PROBE_QNAME, "cloudflare-dns.com"] {
            process_query(&packet::build_query(probe_id(), qname), &shared, false)
                .unwrap_or_else(|| panic!("{qname} must be answered locally"));
            assert_eq!(
                shared.forward_failures.load(Ordering::SeqCst),
                2,
                "{qname} reached the counter"
            );
        }
    }

    #[test]
    fn a_dead_upstream_accumulates_forward_failures() {
        // The signal `dns_filter::tick_recheck_upstreams` reads. `github.com` is
        // whitelisted, so `decide` returns Allow off a static set and this
        // really does attempt a forward — which TEST-NET-1 guarantees fails.
        // Costs ~2x UPSTREAM_TIMEOUT (both upstreams are tried), hence one query.
        let shared = unreachable_shared();
        assert!(process_query(&packet::build_query(1, "github.com"), &shared, true).is_none());
        assert_eq!(shared.forward_failures.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn health_probe_name_stays_in_sync_with_the_probe_itself() {
        // If HEALTH_PROBE_QNAME ever changes shape (uppercase, trailing dot),
        // parse_query's lowercasing must still land on the same string the
        // local short-circuit compares against.
        let raw = packet::build_query(probe_id(), HEALTH_PROBE_QNAME);
        assert_eq!(packet::parse_query(&raw).unwrap().qname, HEALTH_PROBE_QNAME);
    }
}
