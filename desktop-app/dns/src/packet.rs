//! dns/src/packet.rs — minimal DNS wire-format parsing and synthesis.
//!
//! Deliberately narrow: this parses only what the resolver needs to make a
//! block/allow decision (the header's ID/RD/opcode bits + the QNAME/QTYPE/
//! QCLASS of the first question) and never touches answer/authority/
//! additional records. No compression-pointer support — RFC 1035 §4.1.4
//! compression pointers never appear in the QUESTION section of a query (only
//! in answers), so a pointer byte (top two bits set) in a query's question is
//! treated as malformed input and rejected, same as any other structural
//! error. Any parse failure means "drop the packet, answer nothing" (see
//! `server.rs`) — never panic, never guess.

/// Standard DNS header size (RFC 1035 §4.1.1).
const HEADER_LEN: usize = 12;
/// RFC 1035 §2.3.4: a label is at most 63 octets.
const MAX_LABEL_LEN: usize = 63;
/// RFC 1035 §2.3.4: an encoded name (labels + length octets + terminator) is
/// at most 255 octets. Guards against a maliciously long label chain from
/// ever running unbounded, even though `buf.len()` already bounds it in
/// practice for any transport this resolver accepts.
const MAX_NAME_LEN: usize = 255;

/// Bit 0x0100 of the second header word is RD (Recursion Desired) — set by a
/// well-behaved client and simply mirrored back in synthesized responses.
const FLAG_RD: u16 = 0x0100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    /// Fewer than 12 bytes — not even a full header.
    TruncatedHeader,
    /// The header claims zero questions, or the question section runs off
    /// the end of the buffer partway through a label, or before QTYPE/QCLASS.
    TruncatedQuestion,
    /// A label length byte's top two bits are set — that is a compression
    /// pointer, which has no business appearing in a question section.
    CompressionPointer,
    /// A label longer than 63 octets.
    LabelTooLong,
    /// The fully-decoded name exceeded 255 octets.
    NameTooLong,
}

/// The parsed question of a DNS query, plus enough of the header to answer
/// it. `qname` is already lowercased (case-insensitive comparison per RFC
/// 1035 §2.3.3) with no trailing dot, root ("." / an empty question) decoding
/// to `""`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedQuery {
    pub id: u16,
    /// RD (Recursion Desired) bit from the query, echoed in the synthesized
    /// response's own RD bit.
    pub rd: bool,
    pub qname: String,
    pub qtype: u16,
    pub qclass: u16,
    /// Byte offset in the original buffer immediately after QCLASS — i.e.
    /// the end of the question section. `synthesize_nxdomain` uses this to
    /// slice out "header + question" verbatim from the original query bytes
    /// without re-encoding the name.
    pub question_end: usize,
}

/// Parse the first question of a DNS query. Only ever reads — never
/// allocates more than the decoded name — and never panics on hostile input;
/// every bounds check is explicit rather than relying on slice indexing to
/// panic.
pub fn parse_query(buf: &[u8]) -> Result<ParsedQuery, ParseError> {
    if buf.len() < HEADER_LEN {
        return Err(ParseError::TruncatedHeader);
    }
    let id = u16::from_be_bytes([buf[0], buf[1]]);
    let flags = u16::from_be_bytes([buf[2], buf[3]]);
    let rd = flags & FLAG_RD != 0;
    let qdcount = u16::from_be_bytes([buf[4], buf[5]]);
    if qdcount == 0 {
        return Err(ParseError::TruncatedQuestion);
    }

    let mut pos = HEADER_LEN;
    let mut labels: Vec<String> = Vec::new();
    let mut name_len = 0usize;
    loop {
        if pos >= buf.len() {
            return Err(ParseError::TruncatedQuestion);
        }
        let len = buf[pos] as usize;
        if len == 0 {
            pos += 1;
            break; // root: terminates the name (possibly with zero labels).
        }
        if len & 0xC0 != 0 {
            // Top two bits set -> a compression pointer, invalid here.
            return Err(ParseError::CompressionPointer);
        }
        if len > MAX_LABEL_LEN {
            return Err(ParseError::LabelTooLong);
        }
        pos += 1;
        if pos + len > buf.len() {
            return Err(ParseError::TruncatedQuestion);
        }
        name_len += len + 1;
        if name_len > MAX_NAME_LEN {
            return Err(ParseError::NameTooLong);
        }
        let label_bytes = &buf[pos..pos + len];
        // Hostnames are the only thing this resolver ever decides on; a
        // non-UTF8 label (shouldn't occur for a real hostname query) is
        // lossily decoded rather than rejected outright — matching.js's
        // ported engine already tolerates arbitrary Unicode input.
        labels.push(String::from_utf8_lossy(label_bytes).to_string());
        pos += len;
    }

    if pos + 4 > buf.len() {
        return Err(ParseError::TruncatedQuestion);
    }
    let qtype = u16::from_be_bytes([buf[pos], buf[pos + 1]]);
    let qclass = u16::from_be_bytes([buf[pos + 2], buf[pos + 3]]);
    let question_end = pos + 4;

    let qname = labels.join(".").to_lowercase();
    Ok(ParsedQuery { id, rd, qname, qtype, qclass, question_end })
}

/// Synthesize an NXDOMAIN response from an already-parsed query and its
/// original raw bytes: same ID, QR=1, opcode copied, RD copied, RA=1,
/// RCODE=3 (NXDOMAIN), the question echoed verbatim, zero answer/authority/
/// additional records. Reuses `raw[..question_end]` — the original header +
/// question bytes — rather than re-encoding the name, so the echoed question
/// is guaranteed byte-identical to what was asked.
///
/// `raw` MUST be the same buffer `q` was parsed from (or an identical prefix
/// through `question_end`) — callers only ever have one buffer in scope per
/// query, so this isn't a runtime-checked invariant.
pub fn synthesize_nxdomain(raw: &[u8], q: &ParsedQuery) -> Vec<u8> {
    let mut resp = raw[..q.question_end].to_vec();

    // Header byte 2: QR(1) Opcode(4) AA(1) TC(1) RD(1). Preserve the query's
    // opcode + RD bit, set QR=1, clear AA/TC.
    let orig_b2 = raw[2];
    let opcode_bits = orig_b2 & 0x78; // bits 3..6
    let rd_bit = orig_b2 & 0x01;
    resp[2] = 0x80 | opcode_bits | rd_bit;

    // Header byte 3: RA(1) Z(3) RCODE(4). RA=1 (we do recurse/forward for
    // clean queries), Z=0, RCODE=3 (NXDOMAIN).
    resp[3] = 0x80 | 0x03;

    // ANCOUNT/NSCOUNT/ARCOUNT = 0. QDCOUNT (bytes 4-5) is left as-is — the
    // question is echoed, so it must still say 1.
    resp[6] = 0;
    resp[7] = 0;
    resp[8] = 0;
    resp[9] = 0;
    resp[10] = 0;
    resp[11] = 0;

    resp
}

/// Build a minimal, well-formed A-record query for `qname` with the given
/// transaction `id` and RD=1 — used only by the loopback health probe
/// (`server::health_check`) to verify the resolver is actually answering.
pub fn build_query(id: u16, qname: &str) -> Vec<u8> {
    let mut buf = Vec::with_capacity(HEADER_LEN + qname.len() + 6);
    buf.extend_from_slice(&id.to_be_bytes());
    buf.extend_from_slice(&[0x01, 0x00]); // flags: RD=1, everything else 0
    buf.extend_from_slice(&[0x00, 0x01]); // QDCOUNT=1
    buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // AN/NS/AR=0
    for label in qname.split('.') {
        if label.is_empty() {
            continue;
        }
        let bytes = label.as_bytes();
        // The health probe always asks for a fixed, short, ASCII name — this
        // never actually truncates, but guard it anyway rather than panic.
        buf.push(bytes.len().min(MAX_LABEL_LEN) as u8);
        buf.extend_from_slice(&bytes[..bytes.len().min(MAX_LABEL_LEN)]);
    }
    buf.push(0); // root terminator
    buf.extend_from_slice(&[0x00, 0x01]); // QTYPE=A
    buf.extend_from_slice(&[0x00, 0x01]); // QCLASS=IN
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_normal_query() {
        let raw = build_query(0x1234, "example.com");
        let q = parse_query(&raw).expect("well-formed query must parse");
        assert_eq!(q.id, 0x1234);
        assert!(q.rd);
        assert_eq!(q.qname, "example.com");
        assert_eq!(q.qtype, 1); // A
        assert_eq!(q.qclass, 1); // IN
        assert_eq!(q.question_end, raw.len());
    }

    #[test]
    fn parse_uppercase_qname_is_lowercased() {
        // Hand-build a query for "EXAMPLE.com" to check case folding without
        // relying on build_query (which we don't control the casing of here).
        let mut raw = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        raw.push(7);
        raw.extend_from_slice(b"EXAMPLE");
        raw.push(3);
        raw.extend_from_slice(b"com");
        raw.push(0);
        raw.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        let q = parse_query(&raw).unwrap();
        assert_eq!(q.qname, "example.com");
    }

    #[test]
    fn parse_root_label() {
        // A query for the root zone itself: QNAME is a single zero byte ->
        // qname decodes to "".
        let raw = build_query(1, "");
        let q = parse_query(&raw).expect("root-label query must parse");
        assert_eq!(q.qname, "");
    }

    #[test]
    fn parse_rejects_oversized_label() {
        let mut raw = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        raw.push(64); // one over the 63-octet limit
        raw.extend_from_slice(&[b'a'; 64]);
        raw.push(0);
        raw.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        assert_eq!(parse_query(&raw), Err(ParseError::LabelTooLong));
    }

    #[test]
    fn parse_rejects_truncated_packet() {
        // Fewer than 12 bytes: not even a full header.
        assert_eq!(parse_query(&[0u8; 5]), Err(ParseError::TruncatedHeader));

        // A full header claiming one question, but the label length byte
        // says more data follows than actually exists.
        let mut raw = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        raw.push(10); // claims a 10-byte label
        raw.extend_from_slice(b"short"); // only 5 bytes follow
        assert_eq!(parse_query(&raw), Err(ParseError::TruncatedQuestion));

        // Header says QDCOUNT=0 -> nothing to answer.
        let raw2 = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0];
        assert_eq!(parse_query(&raw2), Err(ParseError::TruncatedQuestion));

        // Question ends exactly at the root label with no room for QTYPE/QCLASS.
        let mut raw3 = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        raw3.push(0); // root, then buffer just ends
        assert_eq!(parse_query(&raw3), Err(ParseError::TruncatedQuestion));
    }

    #[test]
    fn parse_rejects_compression_pointer_in_question() {
        let mut raw = vec![0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        raw.push(0xC0); // top two bits set -> compression pointer
        raw.push(0x0C);
        raw.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        assert_eq!(parse_query(&raw), Err(ParseError::CompressionPointer));
    }

    #[test]
    fn nxdomain_round_trip() {
        let raw = build_query(0xBEEF, "blocked.example");
        let q = parse_query(&raw).unwrap();
        let resp = synthesize_nxdomain(&raw, &q);

        // Re-parse the synthesized response as if it were a query, purely to
        // check the header fields and echoed question via the same decoder
        // (parse_query doesn't care whether QR is 0 or 1).
        let reparsed = parse_query(&resp).expect("synthesized response must itself be well-formed");
        assert_eq!(reparsed.id, 0xBEEF);
        assert_eq!(reparsed.qname, "blocked.example");
        assert_eq!(reparsed.qtype, 1);
        assert_eq!(reparsed.qclass, 1);

        // QR=1, RD copied (1 here, since build_query always sets RD=1).
        assert_eq!(resp[2] & 0x80, 0x80, "QR bit must be set");
        assert_eq!(resp[2] & 0x01, 0x01, "RD bit must be copied from the query");
        // RA=1, RCODE=3 (NXDOMAIN).
        assert_eq!(resp[3] & 0x80, 0x80, "RA bit must be set");
        assert_eq!(resp[3] & 0x0F, 0x03, "RCODE must be 3 (NXDOMAIN)");
        // ANCOUNT/NSCOUNT/ARCOUNT all zero.
        assert_eq!(&resp[6..12], &[0, 0, 0, 0, 0, 0]);
        // QDCOUNT still says 1 (the question is echoed).
        assert_eq!(u16::from_be_bytes([resp[4], resp[5]]), 1);
        assert_eq!(resp.len(), q.question_end);
    }

    #[test]
    fn nxdomain_preserves_opcode_and_clears_rd_when_query_has_no_rd() {
        // Hand-build a query with RD=0 and a non-zero opcode (opcode=1,
        // "IQUERY", just to exercise the bit-preservation path — this
        // resolver doesn't care what the opcode means, only that it's
        // echoed).
        let mut raw = vec![0x00, 0x02, 0x08, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]; // byte2=0000_1000 -> opcode=1, RD=0
        raw.push(3);
        raw.extend_from_slice(b"abc");
        raw.push(0);
        raw.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        let q = parse_query(&raw).unwrap();
        assert!(!q.rd);
        let resp = synthesize_nxdomain(&raw, &q);
        assert_eq!(resp[2] & 0x01, 0, "RD must stay 0 when the query didn't set it");
        assert_eq!(resp[2] & 0x78, 0x08, "opcode bits must be preserved");
        assert_eq!(resp[2] & 0x80, 0x80, "QR must be set");
    }
}
