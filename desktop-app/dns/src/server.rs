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
use std::sync::atomic::{AtomicBool, Ordering};
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

pub type Upstreams = (String, String);

/// A running resolver instance. Dropping this does NOT stop it — call
/// `stop()` explicitly (mirrors every other "is this thing on" state in this
/// codebase, e.g. `MonitorState`, which the caller owns and stops the same
/// explicit way).
pub struct DnsServer {
    running: Arc<AtomicBool>,
}

impl DnsServer {
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
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
    let upstreams = Arc::new(Mutex::new(upstreams));

    for _ in 0..UDP_WORKERS {
        let sock = udp.try_clone().map_err(|e| format!("could not clone the UDP socket: {e}"))?;
        let running = running.clone();
        let upstreams = upstreams.clone();
        std::thread::spawn(move || udp_worker(sock, running, upstreams));
    }

    {
        let running = running.clone();
        std::thread::spawn(move || tcp_accept_loop(tcp, running, upstreams));
    }

    log::info!("oathlight-dns: listening on 127.0.0.1:53 (UDP+TCP)");
    Ok(DnsServer { running })
}

fn udp_worker(sock: UdpSocket, running: Arc<AtomicBool>, upstreams: Arc<Mutex<Upstreams>>) {
    let mut buf = [0u8; UDP_BUF_LEN];
    while running.load(Ordering::SeqCst) {
        match sock.recv_from(&mut buf) {
            Ok((n, src)) => {
                let data = &buf[..n];
                let ups = upstreams.lock().unwrap().clone();
                if let Some(resp) = process_query(data, &ups, false) {
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

fn tcp_accept_loop(listener: TcpListener, running: Arc<AtomicBool>, upstreams: Arc<Mutex<Upstreams>>) {
    while running.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _addr)) => {
                let ups = upstreams.lock().unwrap().clone();
                std::thread::spawn(move || handle_tcp_conn(stream, ups));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(_) => std::thread::sleep(POLL_INTERVAL),
        }
    }
}

fn handle_tcp_conn(mut stream: TcpStream, upstreams: Upstreams) {
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
    let Some(resp) = process_query(&msg, &upstreams, true) else { return };
    let resp_len = (resp.len() as u16).to_be_bytes();
    let _ = stream.write_all(&resp_len);
    let _ = stream.write_all(&resp);
}

/// Parse, decide, and either synthesize NXDOMAIN or forward. `None` means
/// "drop the packet, answer nothing" — a malformed query, or a forward that
/// got no reply from either upstream.
fn process_query(raw: &[u8], upstreams: &Upstreams, is_tcp: bool) -> Option<Vec<u8>> {
    let q: ParsedQuery = match packet::parse_query(raw) {
        Ok(q) => q,
        Err(_) => return None,
    };
    match decide::decide(&q.qname) {
        Decision::Block => Some(packet::synthesize_nxdomain(raw, &q)),
        Decision::Allow if is_tcp => forward_tcp(raw, upstreams),
        Decision::Allow => forward_udp(raw, upstreams),
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

/// Loopback health probe: send a real A-record query for a known-good name
/// to `127.0.0.1:53` and check that *some* well-formed response with a
/// matching transaction ID comes back within `timeout`. Used by the app's
/// monitor tick to verify the resolver is actually answering — see the
/// plan's "failsafe" note: broken DNS must never brick the machine, so this
/// is deliberately cheap and self-contained (no dependency on the server
/// instance itself, since the whole point is checking it from outside as a
/// real client would see it).
pub fn health_check(timeout: Duration) -> bool {
    let Ok(sock) = UdpSocket::bind("127.0.0.1:0") else { return false };
    sock.set_read_timeout(Some(timeout)).ok();
    let id = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_micros())
        .unwrap_or(0)
        & 0xFFFF) as u16;
    let query = packet::build_query(id, "example.com");
    if sock.send_to(&query, "127.0.0.1:53").is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    match sock.recv_from(&mut buf) {
        Ok((n, _)) if n >= 12 => u16::from_be_bytes([buf[0], buf[1]]) == id,
        _ => false,
    }
}
