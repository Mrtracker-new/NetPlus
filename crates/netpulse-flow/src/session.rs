//! Session reconstruction: grouping related flows into sessions and
//! establishing causal order. A single page load spawns dozens of flows — one
//! DNS lookup, then connections to the origin and CDNs. Grouping them answers
//! "what happened when I visited X?".
//!
//! The strongest causal signal is **DNS lineage**: a response
//! resolving `cdn.example.com` → an IP, followed shortly by a connection to that
//! IP, is strong evidence the connection was *caused by* that lookup. Session
//! building runs as a separate stage over the committed flow-event stream
//! because it needs cross-shard visibility.
//!
//! Causality is often probabilistic; every inferred link carries a
//! [`netpulse_core::Confidence`] and is never upgraded to certainty.

use std::collections::HashMap;
use std::net::IpAddr;

use netpulse_core::{Confidence, Session, Timestamp};

use crate::decode_view::PacketView;

/// How long after a DNS resolution a connection to the resolved IP is still
/// considered caused by it. Nanoseconds.
pub const LINEAGE_WINDOW_NANOS: u64 = 5_000_000_000; // 5s

/// A recorded name→IP resolution with the time it was observed, used to attribute
/// later connections to the lookup that caused them.
#[derive(Debug, Clone)]
struct Resolution {
    name: String,
    at_mono: u64,
}

/// One causal link in a session's graph: a DNS lookup led to a
/// connection to the resolved address.
#[derive(Debug, Clone, PartialEq)]
pub struct CausalLink {
    pub name: String,
    pub dst_ip: IpAddr,
    pub flow_id: u64,
    /// Calibrated confidence in the inference.
    pub confidence: Confidence,
}

/// Reconstructs sessions from the packet/flow stream by DNS lineage
///A minimal-but-honest realization of the causal graph for the
/// Phase 1 slice: it links connections to the DNS lookups that resolved their
/// destination, with confidence, and groups linked flows into one session.
#[derive(Debug, Default)]
pub struct SessionReconstructor {
    /// Most recent resolution per resolved IP.
    resolutions: HashMap<IpAddr, Resolution>,
    /// Accumulated causal links.
    links: Vec<CausalLink>,
    /// Flow ids grouped under each session, keyed by resolved name.
    groups: HashMap<String, Vec<u64>>,
    /// Session start time per name.
    starts: HashMap<String, Timestamp>,
    /// Track groups modified since last dirty snapshot.
    dirty_groups: std::collections::HashSet<String>,
    /// Stable assigned session IDs by group name.
    assigned_ids: HashMap<String, u64>,
}

impl SessionReconstructor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one packet (already attributed to `flow_id`). Records DNS
    /// resolutions and, when a flow's destination matches a recent resolution,
    /// forms a causal link.
    pub fn observe(&mut self, pv: &PacketView, flow_id: u64) {
        // Record name→IP resolutions from DNS responses.
        for res in &pv.dns_resolutions {
            self.resolutions.insert(
                res.addr,
                Resolution {
                    name: res.name.clone(),
                    at_mono: pv.ts.mono_nanos,
                },
            );
        }

        // Attribute a connection to a prior resolution of its destination IP.
        let dst = pv.tuple.dst_ip;
        if let Some(r) = self.resolutions.get(&dst) {
            let dt = pv.ts.mono_nanos.saturating_sub(r.at_mono);
            if dt <= LINEAGE_WINDOW_NANOS && !self.already_linked(flow_id) {
                // Confidence decays with the delay: an immediate connection is
                // near-certain lineage; one near the window edge is weaker.
                let frac = 1.0 - (dt as f32 / LINEAGE_WINDOW_NANOS as f32);
                let confidence = Confidence::new(0.5 + 0.5 * frac);
                self.links.push(CausalLink {
                    name: r.name.clone(),
                    dst_ip: dst,
                    flow_id,
                    confidence,
                });
                self.groups.entry(r.name.clone()).or_default().push(flow_id);
                self.starts.entry(r.name.clone()).or_insert(pv.ts);
                self.dirty_groups.insert(r.name.clone());
            }
        }
    }

    fn already_linked(&self, flow_id: u64) -> bool {
        self.links.iter().any(|l| l.flow_id == flow_id)
    }

    /// The causal links discovered so far.
    pub fn links(&self) -> &[CausalLink] {
        &self.links
    }

    /// Snapshot only dirty sessions modified since last call.
    pub fn snapshot_dirty_sessions(&mut self, next_session_id: &mut u64) -> Vec<Session> {
        let dirty_names: Vec<String> = self.dirty_groups.drain().collect();
        let mut sessions = Vec::new();
        for name in dirty_names {
            let Some(flow_ids) = self.groups.get(&name) else {
                continue;
            };
            if flow_ids.is_empty() {
                continue;
            }
            let sid = *self.assigned_ids.entry(name.clone()).or_insert_with(|| {
                *next_session_id += 1;
                *next_session_id
            });
            sessions.push(Session {
                id: sid,
                process_id: 0,
                start_ts: self
                    .starts
                    .get(&name)
                    .copied()
                    .unwrap_or(Timestamp::new(0, 0)),
                trigger: format!("resolved and connected to {name}"),
                flow_ids: flow_ids.clone(),
            });
        }
        sessions.sort_by_key(|s| s.id);
        sessions
    }

    /// Finalize the discovered groups into [`Session`]s. Each
    /// session's trigger names the DNS lookup that seeded it, keeping the
    /// human-readable causal story attached.
    pub fn finalize(&self, next_session_id: &mut u64) -> Vec<Session> {
        let mut sessions = Vec::new();
        for (name, flow_ids) in &self.groups {
            if flow_ids.is_empty() {
                continue;
            }
            let sid = self.assigned_ids.get(name).copied().unwrap_or_else(|| {
                *next_session_id += 1;
                *next_session_id
            });
            sessions.push(Session {
                id: sid,
                process_id: 0, // attribution is a Phase 2 signal
                start_ts: self
                    .starts
                    .get(name)
                    .copied()
                    .unwrap_or(Timestamp::new(0, 0)),
                trigger: format!("resolved and connected to {name}"),
                flow_ids: flow_ids.clone(),
            });
        }
        // Deterministic order for reproducible reconstruction.
        sessions.sort_by_key(|s| s.id);
        sessions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode_view::DnsResolution;
    use netpulse_core::net::{L4Proto, L7Proto};
    use std::net::Ipv4Addr;

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn dns_response(mono: u64, name: &str, addr: IpAddr) -> PacketView {
        PacketView {
            ts: Timestamp::new(mono, mono),
            tuple: netpulse_core::net::FiveTuple::new(
                ip(8, 8, 8, 8),
                53,
                ip(192, 168, 0, 1),
                50000,
                L4Proto::Udp,
            ),
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

    fn connection(mono: u64, dst: IpAddr) -> PacketView {
        PacketView {
            ts: Timestamp::new(mono, mono),
            tuple: netpulse_core::net::FiveTuple::new(
                ip(192, 168, 0, 1),
                50001,
                dst,
                443,
                L4Proto::Tcp,
            ),
            l7: L7Proto::Tls,
            payload_len: 0,
            tcp: None,
            events: Vec::new(),
            dns_resolutions: Vec::new(),
            sni: None,
        }
    }

    #[test]
    fn links_connection_to_prior_dns_lookup() {
        let mut sr = SessionReconstructor::new();
        let server = ip(93, 184, 216, 34);
        sr.observe(&dns_response(1000, "example.com", server), 1);
        sr.observe(&connection(1500, server), 2);
        assert_eq!(sr.links().len(), 1);
        let link = &sr.links()[0];
        assert_eq!(link.name, "example.com");
        assert_eq!(link.flow_id, 2);
        assert!(link.confidence.value() > 0.9);

        let mut sid = 0;
        let sessions = sr.finalize(&mut sid);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].flow_ids, vec![2]);
        assert!(sessions[0].trigger.contains("example.com"));
    }

    #[test]
    fn connection_outside_window_is_not_linked() {
        let mut sr = SessionReconstructor::new();
        let server = ip(93, 184, 216, 34);
        sr.observe(&dns_response(1000, "example.com", server), 1);
        // 6s later — beyond the 5s lineage window.
        sr.observe(&connection(1000 + 6_000_000_000, server), 2);
        assert!(sr.links().is_empty());
    }

    #[test]
    fn unrelated_connection_has_no_link() {
        let mut sr = SessionReconstructor::new();
        sr.observe(&dns_response(1000, "example.com", ip(93, 184, 216, 34)), 1);
        sr.observe(&connection(1500, ip(1, 2, 3, 4)), 2); // different IP
        assert!(sr.links().is_empty());
    }
}
