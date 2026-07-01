//! The flow engine facade (docs/06 §7): a fixed set of shards plus the session
//! reconstructor, driven by decoded packets. A packet's canonical key selects
//! its shard via [`crate::shard_for`], so all packets of a flow land on the same
//! shard and per-flow state needs no locks (docs/06 §7).
//!
//! In this single-threaded Phase 1 slice the shards live in one engine, but the
//! ownership discipline (a flow belongs to exactly one shard) is exactly what a
//! future thread-per-shard build needs — the design is preserved, only the
//! executor differs.

use netpulse_core::{Flow, ProtoEvent, Session, Timestamp};

use crate::decode_view::PacketView;
use crate::identity::CanonicalKey;
use crate::session::{CausalLink, SessionReconstructor};
use crate::shard_for;
use crate::table::Shard;

/// The reconstruction engine: shards of flow state plus the session builder.
#[derive(Debug)]
pub struct FlowEngine {
    shards: Vec<Shard>,
    shard_count: u16,
    sessions: SessionReconstructor,
    next_flow_id: u64,
    next_session_id: u64,
}

/// A finalized flow with the protocol events accumulated over its lifetime,
/// ready for storage (docs/08).
#[derive(Debug, Clone)]
pub struct FinalizedFlow {
    pub flow: Flow,
    pub events: Vec<ProtoEvent>,
}

impl FlowEngine {
    /// Create an engine with `shard_count` shards (rounded up to at least 1).
    pub fn new(shard_count: u16) -> Self {
        let n = shard_count.max(1);
        Self {
            shards: (0..n).map(|_| Shard::default()).collect(),
            shard_count: n,
            sessions: SessionReconstructor::new(),
            next_flow_id: 0,
            next_session_id: 0,
        }
    }

    /// Ingest one decoded packet: route to its shard, update flow state and
    /// metrics, and feed the session reconstructor.
    pub fn ingest(&mut self, pv: &PacketView) {
        let key = CanonicalKey::from_tuple(&pv.tuple);
        let idx = self.shard_index(key);
        let flow_id = self.shards[idx].ingest(pv, &mut self.next_flow_id);
        self.sessions.observe(pv, flow_id);
    }

    fn shard_index(&self, key: CanonicalKey) -> usize {
        // Route by the *canonical* key so both directions share a shard.
        // `shard_for` hashes a FiveTuple; feed it a stable canonical tuple.
        let repr = canonical_repr(&key);
        shard_for(&repr, self.shard_count) as usize
    }

    /// Finalize all flows that are closed as of `now`, returning them for
    /// storage (docs/06 §8). Called periodically to bound memory.
    pub fn evict_closed(&mut self, now: Timestamp) -> Vec<FinalizedFlow> {
        let mut out = Vec::new();
        for shard in &mut self.shards {
            for (flow, events) in shard.drain_closed(now) {
                out.push(FinalizedFlow { flow, events });
            }
        }
        out
    }

    /// Finalize every remaining flow (end of capture) and return them together
    /// with the reconstructed sessions (docs/06 §8).
    pub fn finish(&mut self) -> (Vec<FinalizedFlow>, Vec<Session>) {
        let mut flows = Vec::new();
        for shard in &mut self.shards {
            for (flow, events) in shard.drain_all() {
                flows.push(FinalizedFlow { flow, events });
            }
        }
        flows.sort_by_key(|f| f.flow.id);
        let sessions = self.sessions.finalize(&mut self.next_session_id);
        (flows, sessions)
    }

    /// The causal links discovered so far (docs/06 §6.2).
    pub fn causal_links(&self) -> &[CausalLink] {
        self.sessions.links()
    }

    /// Total live flows across all shards.
    pub fn live_flows(&self) -> usize {
        self.shards.iter().map(Shard::len).sum()
    }
}

/// Build a stable directional tuple from a canonical key purely for hashing into
/// a shard. Both directions of a flow produce the same `CanonicalKey`, hence the
/// same shard — which is the whole point (docs/06 §7).
fn canonical_repr(key: &CanonicalKey) -> netpulse_core::net::FiveTuple {
    // The canonical key already fixes a deterministic lo/hi ordering; reflect it
    // into a FiveTuple. We reconstruct from its public projection.
    key.to_repr_tuple()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode_view::TcpSignals;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn tcp_pkt(
        mono: u64,
        src: (IpAddr, u16),
        dst: (IpAddr, u16),
        flags: (bool, bool, bool, bool),
        payload: u32,
    ) -> PacketView {
        PacketView {
            ts: Timestamp::new(mono, mono),
            tuple: FiveTuple::new(src.0, src.1, dst.0, dst.1, L4Proto::Tcp),
            l7: L7Proto::Tls,
            payload_len: payload,
            tcp: Some(TcpSignals {
                syn: flags.0,
                ack: flags.1,
                fin: flags.2,
                rst: flags.3,
                seq: mono as u32,
                payload_len: payload,
                window: 65535,
            }),
            events: Vec::new(),
            dns_resolutions: Vec::new(),
            sni: None,
        }
    }

    #[test]
    fn both_directions_join_one_flow() {
        let mut eng = FlowEngine::new(8);
        let client = (ip(192, 168, 0, 1), 50000);
        let server = (ip(93, 184, 216, 34), 443);
        // handshake
        eng.ingest(&tcp_pkt(0, client, server, (true, false, false, false), 0));
        eng.ingest(&tcp_pkt(1, server, client, (true, true, false, false), 0));
        eng.ingest(&tcp_pkt(2, client, server, (false, true, false, false), 0));
        // one flow, not two
        assert_eq!(eng.live_flows(), 1);
    }

    #[test]
    fn closed_flow_is_finalized_with_metrics() {
        let mut eng = FlowEngine::new(4);
        let c = (ip(10, 0, 0, 1), 1111);
        let s = (ip(10, 0, 0, 2), 443);
        eng.ingest(&tcp_pkt(0, c, s, (true, false, false, false), 0));
        eng.ingest(&tcp_pkt(1, s, c, (true, true, false, false), 0));
        eng.ingest(&tcp_pkt(2, c, s, (false, true, false, false), 500));
        eng.ingest(&tcp_pkt(3, c, s, (false, false, false, true), 0)); // RST
        let (flows, _sessions) = eng.finish();
        assert_eq!(flows.len(), 1);
        assert_eq!(flows[0].flow.state, netpulse_core::FlowState::Closed);
        assert!(flows[0].flow.stats.bytes >= 500);
        assert_eq!(flows[0].flow.stats.rtt_estimate_nanos, Some(1));
    }
}
