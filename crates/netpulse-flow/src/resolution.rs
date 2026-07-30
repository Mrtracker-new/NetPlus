//! Passive name resolution (docs/06 §6.1, docs/08 §5): building the `IP → names`
//! map from traffic we already dissect. Two signals feed it, both observed on the
//! wire — never an active lookup:
//!
//! - **DNS answers** — an A/AAAA response resolving `name → addr` is the
//!   authoritative mapping (the same signal session lineage rides).
//! - **TLS SNI** — the hostname the client put in a ClientHello to that IP is the
//!   site its software *asked for*, often more meaningful than the DNS name behind
//!   a shared CDN address.
//!
//! It is deliberately a *separate* accumulator from [`crate::session`]: session
//! reconstruction cares about the most-recent resolution within a causal window
//! (lineage), whereas naming wants the full set of names ever seen for an IP so
//! the UI can show every one honestly (docs/02 §10.3 — passive enrichment, no
//! egress). Both observe the same [`PacketView`] stream, so the table is built
//! deterministically alongside flow reconstruction and rides the same replay
//! parity guarantee (docs/21 §10).

use std::collections::BTreeMap;
use std::net::IpAddr;

use netpulse_core::{HostName, NameSource};

use crate::decode_view::PacketView;

/// Maximum IP entries stored in ResolutionTable before pruning old entries.
pub const MAX_RESOLUTIONS: usize = 10_000;

/// Accumulates the set of passively-observed hostnames per IP. Deterministic:
/// output order does not depend on `HashMap` iteration — IPs come out sorted and
/// names within an IP are ordered by `(source, name)`, so the same packet stream
/// always yields the same table (replay parity, docs/21 §10).
#[derive(Debug, Default)]
pub struct ResolutionTable {
    by_ip: BTreeMap<IpAddr, Vec<HostName>>,
}

impl ResolutionTable {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one packet's naming signals into the table: every DNS answer's
    /// `name → addr`, and any TLS SNI attached to the connection's destination IP.
    pub fn observe(&mut self, pv: &PacketView) {
        // DNS A/AAAA answers: authoritative name→IP seen in a response.
        for res in &pv.dns_resolutions {
            self.record(res.addr, &res.name, NameSource::Dns);
        }
        // TLS SNI: the client sent this name to the destination it is connecting
        // to, so it names `pv.tuple.dst_ip`.
        if let Some(sni) = &pv.sni {
            self.record(pv.tuple.dst_ip, sni, NameSource::Sni);
        }
    }

    /// Record one `(ip, name, source)` observation, de-duplicating on the exact
    /// pair so a name repeated across packets is stored once.
    fn record(&mut self, ip: IpAddr, name: &str, source: NameSource) {
        if name.is_empty() {
            return;
        }
        if !self.by_ip.contains_key(&ip) && self.by_ip.len() >= MAX_RESOLUTIONS {
            self.prune();
        }
        let names = self.by_ip.entry(ip).or_default();
        if names.iter().any(|h| h.name == name && h.source == source) {
            return;
        }
        names.push(HostName {
            name: name.to_string(),
            source,
        });
    }

    /// Prune oldest entries to maintain MAX_RESOLUTIONS bound.
    pub fn prune(&mut self) {
        while self.by_ip.len() >= MAX_RESOLUTIONS {
            if let Some(key) = self.by_ip.keys().next().copied() {
                self.by_ip.remove(&key);
            } else {
                break;
            }
        }
    }

    /// The full table as `(ip, names)` pairs, IPs ascending and names within each
    /// IP in a stable `(source, name)` order — ready to persist deterministically.
    pub fn entries(&self) -> Vec<(IpAddr, Vec<HostName>)> {
        self.by_ip
            .iter()
            .map(|(ip, names)| {
                let mut sorted = names.clone();
                sorted.sort_by(|a, b| {
                    source_rank(a.source)
                        .cmp(&source_rank(b.source))
                        .then_with(|| a.name.cmp(&b.name))
                });
                (*ip, sorted)
            })
            .collect()
    }

    /// Names observed for a single IP (unsorted; `entries` is the ordered view).
    pub fn names_for(&self, ip: &IpAddr) -> &[HostName] {
        self.by_ip.get(ip).map_or(&[], |v| v.as_slice())
    }

    /// Whether any name has been observed at all.
    pub fn is_empty(&self) -> bool {
        self.by_ip.is_empty()
    }
}

/// A total order over sources so name lists are deterministic. SNI first — the
/// name the user's software asked for reads first in the UI — then DNS. This is a
/// *display* order only; it never elevates one name to an authoritative "primary"
/// (both travel, tagged with their source).
fn source_rank(s: NameSource) -> u8 {
    match s {
        NameSource::Sni => 0,
        NameSource::Dns => 1,
        // A future passive source sorts last rather than aliasing an existing one.
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode_view::DnsResolution;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::Timestamp;
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn dns_response(name: &str, addr: IpAddr) -> PacketView {
        PacketView {
            ts: Timestamp::new(0, 0),
            tuple: FiveTuple::new(ip(8, 8, 8, 8), 53, ip(192, 168, 0, 1), 50000, L4Proto::Udp),
            l7: L7Proto::Dns,
            payload_len: 0,
            tcp: None,
            events: Vec::new(),
            dns_resolutions: vec![DnsResolution {
                name: name.to_string(),
                addr,
            }],
            sni: None,
        }
    }

    fn tls_hello(dst: IpAddr, sni: &str) -> PacketView {
        PacketView {
            ts: Timestamp::new(0, 0),
            tuple: FiveTuple::new(ip(192, 168, 0, 1), 50001, dst, 443, L4Proto::Tcp),
            l7: L7Proto::Tls,
            payload_len: 0,
            tcp: None,
            events: Vec::new(),
            dns_resolutions: Vec::new(),
            sni: Some(sni.to_string()),
        }
    }

    #[test]
    fn records_dns_answer_name() {
        let mut t = ResolutionTable::new();
        let server = ip(93, 184, 216, 34);
        t.observe(&dns_response("example.com", server));
        let names = t.names_for(&server);
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].name, "example.com");
        assert_eq!(names[0].source, NameSource::Dns);
    }

    #[test]
    fn records_tls_sni_against_destination() {
        let mut t = ResolutionTable::new();
        let cdn = ip(23, 45, 67, 89);
        t.observe(&tls_hello(cdn, "netflix.com"));
        let names = t.names_for(&cdn);
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].name, "netflix.com");
        assert_eq!(names[0].source, NameSource::Sni);
    }

    #[test]
    fn one_ip_keeps_both_dns_and_sni_names() {
        // A shared CDN IP: DNS resolved one CNAME endpoint, the client asked for
        // the real site via SNI. Both are kept, neither is dropped.
        let mut t = ResolutionTable::new();
        let cdn = ip(23, 45, 67, 89);
        t.observe(&dns_response("e1.akamai.net", cdn));
        t.observe(&tls_hello(cdn, "netflix.com"));
        let entries = t.entries();
        assert_eq!(entries.len(), 1);
        let (got_ip, names) = &entries[0];
        assert_eq!(*got_ip, cdn);
        assert_eq!(names.len(), 2);
        // SNI ranks first in display order.
        assert_eq!(names[0].name, "netflix.com");
        assert_eq!(names[0].source, NameSource::Sni);
        assert_eq!(names[1].name, "e1.akamai.net");
        assert_eq!(names[1].source, NameSource::Dns);
    }

    #[test]
    fn duplicate_observations_are_deduped() {
        let mut t = ResolutionTable::new();
        let server = ip(1, 1, 1, 1);
        t.observe(&dns_response("one.example", server));
        t.observe(&dns_response("one.example", server));
        assert_eq!(t.names_for(&server).len(), 1);
    }

    #[test]
    fn entries_are_deterministic_regardless_of_observe_order() {
        let a = ip(1, 1, 1, 1);
        let b = ip(2, 2, 2, 2);
        let mut t1 = ResolutionTable::new();
        t1.observe(&dns_response("b.example", b));
        t1.observe(&dns_response("a.example", a));
        let mut t2 = ResolutionTable::new();
        t2.observe(&dns_response("a.example", a));
        t2.observe(&dns_response("b.example", b));
        assert_eq!(t1.entries(), t2.entries());
        // IPs ascending.
        assert_eq!(t1.entries()[0].0, a);
        assert_eq!(t1.entries()[1].0, b);
    }
}
