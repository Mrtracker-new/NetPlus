//! The explanation model (docs/07 §7) — what distinguishes NetPulse's dissection
//! from a plain analyzer. Every field and protocol state a dissector emits is
//! tagged with a stable **explanation key** (`tcp.flags.syn`,
//! `dns.rcode.nxdomain`, …). Detection (emitting a key) is decoupled from
//! content (stored here), so the same parse serves beginner, intermediate, and
//! expert — and one key wires the whole education system together (docs/07 §7.3).
//!
//! Keys are an API surface (docs/07 §12): renaming one breaks lessons, the
//! explorer, and AI grounding, so they are stable and versioned. A CI-style test
//! (`every_key_has_content_at_all_depths`) enforces "no dead ends" (docs/01 E1):
//! any key a dissector can emit must resolve to content at all three depths.

/// A stable identifier for a protocol field or state, e.g. `tcp.flags.syn`.
///
/// Interned as a `&'static str` so it is cheap to pass on the hot path
/// (docs/07 §10); content is fetched only when the UI actually displays it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ExplanationKey(pub &'static str);

impl ExplanationKey {
    /// The underlying dotted identifier.
    pub fn as_str(self) -> &'static str {
        self.0
    }
}

impl std::fmt::Display for ExplanationKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

/// Progressive-disclosure depth (docs/01 §7.3, docs/07 §7.2). The UI picks one
/// by mode; the same key resolves to appropriate content at each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisclosureDepth {
    /// One plain-language line for a newcomer.
    Beginner,
    /// A paragraph with the mechanism.
    Intermediate,
    /// Expert reference, typically with an RFC citation.
    Expert,
}

/// Content for one key at the three disclosure depths.
#[derive(Debug, Clone, Copy)]
pub struct Explanation {
    pub beginner: &'static str,
    pub intermediate: &'static str,
    pub expert: &'static str,
}

impl Explanation {
    /// The text for a given depth.
    pub fn at(&self, depth: DisclosureDepth) -> &'static str {
        match depth {
            DisclosureDepth::Beginner => self.beginner,
            DisclosureDepth::Intermediate => self.intermediate,
            DisclosureDepth::Expert => self.expert,
        }
    }
}

/// Every explanation key the dissectors in this crate can emit. Keeping this
/// list co-located with the content store is what lets the coverage test prove
/// "no dead ends" at build/test time.
pub const ALL_KEYS: &[ExplanationKey] = &[
    ExplanationKey("eth.addr"),
    ExplanationKey("eth.ethertype"),
    ExplanationKey("ip.addr"),
    ExplanationKey("ip.ttl"),
    ExplanationKey("ip.version"),
    ExplanationKey("tcp.port"),
    ExplanationKey("tcp.flags.syn"),
    ExplanationKey("tcp.flags.ack"),
    ExplanationKey("tcp.flags.fin"),
    ExplanationKey("tcp.flags.rst"),
    ExplanationKey("tcp.seq"),
    ExplanationKey("tcp.window"),
    ExplanationKey("udp.port"),
    ExplanationKey("dns.query"),
    ExplanationKey("dns.response"),
    ExplanationKey("dns.rcode.nxdomain"),
    ExplanationKey("tls.handshake.client_hello"),
    ExplanationKey("tls.handshake.server_hello"),
    ExplanationKey("tls.sni"),
    ExplanationKey("http.request"),
    ExplanationKey("http.response"),
];

/// Resolve a key to its content, or `None` if the key is unknown.
///
/// Content lives inline here for the vertical slice; docs/07 §7.3 has it move to
/// a reviewable, localizable data store, addressed by these same keys.
pub fn explain(key: ExplanationKey) -> Option<Explanation> {
    let e = |b, i, x| Explanation {
        beginner: b,
        intermediate: i,
        expert: x,
    };
    Some(match key.0 {
        "eth.addr" => e(
            "The hardware address of a device on your local network.",
            "A 48-bit MAC address identifying a NIC on the local link; the first 24 bits are the vendor OUI.",
            "IEEE 802 MAC-48. Locally/globally-administered and unicast/multicast bits live in the first octet.",
        ),
        "eth.ethertype" => e(
            "Says what kind of message is inside — usually 'Internet' (IP).",
            "The EtherType selects the next protocol: 0x0800 IPv4, 0x86DD IPv6, 0x0806 ARP.",
            "IEEE 802.3 EtherType/length field; values >= 0x0600 are types (RFC 7042).",
        ),
        "ip.addr" => e(
            "The Internet address of a computer — like a postal address.",
            "The source/destination IP address routing the packet across networks.",
            "IPv4 32-bit (RFC 791) or IPv6 128-bit (RFC 8200) address.",
        ),
        "ip.ttl" => e(
            "How many routers the packet may pass through before it's dropped.",
            "Time-to-live / hop-limit, decremented per hop; hitting zero yields an ICMP time-exceeded.",
            "IPv4 TTL (RFC 791) / IPv6 Hop Limit (RFC 8200); underpins traceroute.",
        ),
        "ip.version" => e(
            "Which version of the Internet Protocol this is (4 or 6).",
            "The IP version nibble; selects the header layout used to parse the rest.",
            "First 4 bits of the IP header; 4 = IPv4, 6 = IPv6.",
        ),
        "tcp.port" | "udp.port" => e(
            "A numbered door on the computer — e.g. 443 is secure web.",
            "The transport port multiplexes many conversations on one host; well-known ports hint at the app.",
            "16-bit port (RFC 793 / RFC 768); ports are hints only — identification confirms the L7 protocol.",
        ),
        "tcp.flags.syn" => e(
            "The start of a 'let's talk' handshake between two computers.",
            "SYN opens a connection and synchronizes initial sequence numbers.",
            "TCP SYN control bit (RFC 9293 §3.1); SYN then SYN-ACK then ACK is the three-way handshake.",
        ),
        "tcp.flags.ack" => e(
            "Confirms that earlier data was received.",
            "ACK marks the acknowledgment number valid; it paces reliable delivery.",
            "TCP ACK control bit (RFC 9293); cumulative acknowledgment of received bytes.",
        ),
        "tcp.flags.fin" => e(
            "One side politely says 'I'm done talking'.",
            "FIN begins an orderly half-close; each direction closes independently.",
            "TCP FIN control bit (RFC 9293 §3.5); graceful teardown, contrast with RST.",
        ),
        "tcp.flags.rst" => e(
            "An abrupt 'hang up' — the connection was refused or aborted.",
            "RST tears a connection down immediately, e.g. to a closed port or on a protocol error.",
            "TCP RST control bit (RFC 9293); abortive close, no graceful FIN exchange.",
        ),
        "tcp.seq" => e(
            "A page number so nothing gets lost or reordered.",
            "The sequence number orders bytes in a stream and drives loss/retransmit detection.",
            "32-bit TCP sequence number (RFC 9293); duplicates/gaps infer retransmission and reordering.",
        ),
        "tcp.window" => e(
            "How much the receiver can accept right now.",
            "The advertised receive window is flow control; a zero window pauses the sender.",
            "16-bit window, scaled by the window-scale option (RFC 7323); zero-window signals a stall.",
        ),
        "dns.query" => e(
            "You asked 'what's the address of this website?'",
            "A DNS query resolves a name to records (A/AAAA/CNAME/…); it usually precedes a connection.",
            "DNS query (RFC 1035); QNAME/QTYPE/QCLASS. Feeds the DNS→connection lineage (docs/06 §6.1).",
        ),
        "dns.response" => e(
            "You got back the website's address.",
            "A DNS response carries answer records and a response code; TTL bounds caching.",
            "DNS response (RFC 1035); answer/authority/additional sections, per-record TTL.",
        ),
        "dns.rcode.nxdomain" => e(
            "That website name doesn't exist.",
            "NXDOMAIN means the queried name has no records — often a typo or a dead domain.",
            "DNS RCODE 3 (RFC 1035 §4.1.1); authoritative 'name does not exist'.",
        ),
        "tls.handshake.client_hello" => e(
            "Your device proposes how to set up an encrypted connection.",
            "ClientHello offers TLS versions, cipher suites, and extensions (SNI, ALPN) in the clear.",
            "TLS ClientHello (RFC 8446 §4.1.2); pre-encryption, source of SNI/ALPN and JA3/JA4 features.",
        ),
        "tls.handshake.server_hello" => e(
            "The server picks how the encryption will work.",
            "ServerHello selects the cipher suite and version and continues the handshake.",
            "TLS ServerHello (RFC 8446 §4.1.3); chosen parameters, then encrypted handshake in TLS 1.3.",
        ),
        "tls.sni" => e(
            "The website name you're connecting to (visible even when encrypted).",
            "Server Name Indication tells the server which site you want; visible unless ECH is used.",
            "TLS SNI extension (RFC 6066 §3); cleartext in ClientHello, correlates with resolved DNS names.",
        ),
        "http.request" => e(
            "Your browser asks the server for a page or file.",
            "An HTTP request has a method, path, and headers; it maps to the website journey (docs/14).",
            "HTTP/1.1 request-line + headers (RFC 9110/9112); plaintext only, else inside TLS.",
        ),
        "http.response" => e(
            "The server sends back the page — or an error.",
            "An HTTP status code reports the outcome: 200 OK, 301 moved, 404 not found, 500 error.",
            "HTTP/1.1 status-line + headers (RFC 9110/9112).",
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_has_content_at_all_depths() {
        // Enforces "no dead ends" (docs/01 E1, docs/07 §11): any key a dissector
        // can emit must resolve to non-empty content at all three depths.
        for &key in ALL_KEYS {
            let ex = explain(key).unwrap_or_else(|| panic!("no content for key {key}"));
            for depth in [
                DisclosureDepth::Beginner,
                DisclosureDepth::Intermediate,
                DisclosureDepth::Expert,
            ] {
                assert!(
                    !ex.at(depth).trim().is_empty(),
                    "empty {depth:?} content for {key}"
                );
            }
        }
    }

    #[test]
    fn unknown_key_resolves_to_none() {
        assert!(explain(ExplanationKey("does.not.exist")).is_none());
    }
}
