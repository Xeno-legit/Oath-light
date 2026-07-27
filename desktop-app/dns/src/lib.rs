//! oathlight-dns — system-level DNS filtering (plan items 1.1 and 1.2).
//!
//! A dependency-free DNS forwarding proxy, built on `std::net` only (plus
//! `oathlight-core` for the shared blocklist/keyword engine): parses just
//! enough of an incoming query to make a block/allow decision, answers
//! blocked queries with a synthesized NXDOMAIN, and relays everything else to
//! the machine's real upstream resolvers.
//!
//! **No hickory-dns / trust-dns** — a deliberate lead decision. Nothing in
//! this codebase can be compile-checked before the owner builds it by hand
//! (`cargo` hangs in the dev environment), so pulling in a large, unfamiliar
//! async DNS server crate here would be pure risk with no way to verify it
//! actually compiles. `std::net` plus a from-scratch wire-format parser is
//! the same hand-rolled-FFI-over-a-big-dependency instinct `friction.rs`
//! (`GetTickCount64`) and `watchdog.rs` (kernel32 mutex/event calls) already
//! apply elsewhere in this codebase.
//!
//! Module map:
//! - `packet` — wire-format parsing (query -> `ParsedQuery`) and
//!   NXDOMAIN/health-check query synthesis. Pure, well-tested.
//! - `decide` — the block/allow policy: whitelist floor, DoH endpoints,
//!   built-in blocklist, keyword layer, custom user domains.
//! - `server` — the UDP+TCP listener + upstream forwarding + the
//!   loopback health-check probe.
//! - `upstream` — captured pre-takeover DNS state (`dns.json`) + fallback
//!   public resolvers.
//! - `takeover` — Windows adapter enumeration/takeover/restore (admin-only).
//!
//! **Where this runs:** started and stopped directly from the Tauri app
//! (`src-tauri`'s `dns_filter` module) rather than a separate always-on
//! process — see that module's doc comment for the full reasoning (the
//! app-level health check on the existing 3s monitor tick, plus the
//! guardian's sanctioned-shutdown restore, are what keep this from ever
//! bricking a machine's DNS if the app itself is closed or crashes).

pub mod decide;
pub mod packet;
pub mod server;
pub mod takeover;
pub mod upstream;

pub use decide::{decide, init_custom_domains, Decision};
pub use packet::{build_query, parse_query, synthesize_nxdomain, ParseError, ParsedQuery};
pub use server::{health_check, start, DnsServer, Upstreams};
pub use upstream::{AdapterDns, CapturedDns, FALLBACK_PRIMARY, FALLBACK_SECONDARY};
