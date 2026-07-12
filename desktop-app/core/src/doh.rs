//! core/src/doh.rs — known DNS-over-HTTPS resolver endpoints (plan item 1.2).
//!
//! A browser (or any app) bootstrapping a DoH client must first resolve the
//! endpoint's hostname over plain DNS — there is no other way to find the
//! HTTPS server to talk to unless the IP is hardcoded. Killing that one plain
//! lookup (the DNS resolver in `purepath-dns` NXDOMAINs these — see
//! `dns/src/decide.rs`) kills DoH for anything that isn't hardcoding IPs,
//! without needing to parse/block HTTPS traffic at all.
//!
//! Conservative and well-known only, same bar as the rest of this crate's
//! lists: under-blocking a niche DoH provider is an accepted gap, but
//! collateral-damaging an unrelated hostname is not.

/// Well-known DoH resolver hostnames. Matched via the same exact-and-parent
/// walk as the built-in blocklist (`lists::is_domain_listed`) — so
/// `family.cloudflare-dns.com` is caught by the `cloudflare-dns.com` entry,
/// etc.
pub const DOH_ENDPOINTS: &[&str] = &[
    "cloudflare-dns.com",
    "one.one.one.one",
    "dns.google",
    "dns.quad9.net",
    "mozilla.cloudflare-dns.com",
    "doh.opendns.com",
    "dns.adguard.com",
    "doh.cleanbrowsing.org",
    "dns.nextdns.io",
    "firefox.dns.nextdns.io",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doh_endpoints_nonempty_and_lowercase() {
        assert!(!DOH_ENDPOINTS.is_empty());
        for d in DOH_ENDPOINTS {
            assert_eq!(*d, d.to_lowercase(), "DOH_ENDPOINTS entries must already be lowercase: {d}");
        }
    }
}
