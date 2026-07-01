//! Incremental per-flow metrics (docs/06 §5). Every metric updates in O(1) as
//! packets arrive, so a flow's stats are always current without a re-scan
//! (docs/06 §10). Each answers a concrete user question (docs/06 §5 table).
//!
//! Loss/retransmit detection is **inferential** and never needs decryption
//! (docs/01 X2, docs/06 §5.1): it reasons from TCP sequence numbers alone. All
//! interval math uses the monotonic clock so wall-clock steps can't distort RTT
//! (docs/05 §6).

use std::collections::HashSet;

use netpulse_core::net::{FiveTuple, L7Proto};
use netpulse_core::FlowMetrics;

use crate::decode_view::PacketView;
use crate::identity::CanonicalKey;

/// Accumulates the running statistics for one flow.
#[derive(Debug, Clone)]
pub struct MetricsAccumulator {
    key: CanonicalKey,
    /// Bytes sent by the initiator (`lo`) side and the responder side.
    bytes_up: u64,
    bytes_down: u64,
    pkts_up: u64,
    pkts_down: u64,
    /// Monotonic ns of the first initiator segment and first responder reply,
    /// for the connection-setup RTT (docs/06 §5, SYN → SYN-ACK).
    first_up_mono: Option<u64>,
    first_down_mono: Option<u64>,
    rtt_nanos: Option<u64>,
    retransmits: u32,
    /// Highest sequence number seen per direction, to infer retransmits: a
    /// segment whose seq we've already passed is a likely retransmission.
    seen_seqs_up: HashSet<u32>,
    seen_seqs_down: HashSet<u32>,
    /// The most-specific L7 protocol observed (never downgraded once known).
    l7: L7Proto,
    /// A representative directional tuple for display (initiator → responder).
    sample_tuple: FiveTuple,
}

impl MetricsAccumulator {
    pub fn new(key: CanonicalKey) -> Self {
        Self {
            key,
            bytes_up: 0,
            bytes_down: 0,
            pkts_up: 0,
            pkts_down: 0,
            first_up_mono: None,
            first_down_mono: None,
            rtt_nanos: None,
            retransmits: 0,
            seen_seqs_up: HashSet::new(),
            seen_seqs_down: HashSet::new(),
            l7: L7Proto::Unknown,
            // Placeholder; overwritten by the first observed packet.
            sample_tuple: dummy_tuple(),
        }
    }

    /// Fold one packet into the running metrics.
    pub fn observe(&mut self, pv: &PacketView, from_lo: bool) {
        if self.pkts_up + self.pkts_down == 0 {
            self.sample_tuple = pv.tuple;
        }
        if pv.l7 != L7Proto::Unknown {
            self.l7 = pv.l7;
        }
        let len = u64::from(pv.payload_len);
        if from_lo {
            self.bytes_up += len;
            self.pkts_up += 1;
            self.first_up_mono.get_or_insert(pv.ts.mono_nanos);
        } else {
            self.bytes_down += len;
            self.pkts_down += 1;
            self.first_down_mono.get_or_insert(pv.ts.mono_nanos);
        }

        // Setup RTT: the gap between the initiator's first segment and the
        // responder's first reply, computed once both are seen.
        if self.rtt_nanos.is_none() {
            if let (Some(up), Some(down)) = (self.first_up_mono, self.first_down_mono) {
                if down >= up {
                    self.rtt_nanos = Some(down - up);
                }
            }
        }

        // Retransmit inference from TCP sequence numbers, per direction. Only
        // segments carrying data (or SYN/FIN, which consume a sequence number)
        // are meaningful; pure ACKs reuse the same seq and are ignored.
        if let Some(tcp) = pv.tcp {
            let consumes_seq = tcp.payload_len > 0 || tcp.syn || tcp.fin;
            if consumes_seq {
                let set = if from_lo {
                    &mut self.seen_seqs_up
                } else {
                    &mut self.seen_seqs_down
                };
                if !set.insert(tcp.seq) {
                    // This sequence number was already observed in this
                    // direction: a retransmission (docs/06 §5).
                    self.retransmits += 1;
                }
            }
        }
    }

    /// Total packets observed across both directions.
    pub fn total_packets(&self) -> u64 {
        self.pkts_up + self.pkts_down
    }

    /// The canonical key this accumulator belongs to.
    pub fn key(&self) -> CanonicalKey {
        self.key
    }

    /// The most-specific L7 protocol observed on this flow.
    pub fn l7(&self) -> L7Proto {
        self.l7
    }

    /// A representative directional 5-tuple (first packet's direction).
    pub fn representative_tuple(&self) -> FiveTuple {
        self.sample_tuple
    }

    /// Seal the running counters into the immutable [`FlowMetrics`] (docs/02 §6).
    pub fn snapshot(&self) -> FlowMetrics {
        FlowMetrics {
            bytes: self.bytes_up + self.bytes_down,
            packets: self.total_packets(),
            rtt_estimate_nanos: self.rtt_nanos,
            retransmits: self.retransmits,
            // Retransmits are our primary packet-loss indicator (docs/06 §5).
            loss_indicators: self.retransmits,
        }
    }
}

fn dummy_tuple() -> FiveTuple {
    use netpulse_core::net::L4Proto;
    use std::net::{IpAddr, Ipv4Addr};
    let z = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
    FiveTuple::new(z, 0, z, 0, L4Proto::Other(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode_view::TcpSignals;
    use netpulse_core::net::{L4Proto, L7Proto};
    use netpulse_core::Timestamp;
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn pv(mono: u64, from_lo_dir: bool, seq: u32, payload: u32, syn: bool) -> PacketView {
        // lo endpoint is 10.0.0.1:1000, hi is 10.0.0.2:80 (10.0.0.1 < 10.0.0.2).
        let tuple = if from_lo_dir {
            FiveTuple::new(ip(10, 0, 0, 1), 1000, ip(10, 0, 0, 2), 80, L4Proto::Tcp)
        } else {
            FiveTuple::new(ip(10, 0, 0, 2), 80, ip(10, 0, 0, 1), 1000, L4Proto::Tcp)
        };
        PacketView {
            ts: Timestamp::new(mono, mono),
            tuple,
            l7: L7Proto::Http1,
            payload_len: payload,
            tcp: Some(TcpSignals {
                syn,
                ack: !syn,
                fin: false,
                rst: false,
                seq,
                payload_len: payload,
                window: 65535,
            }),
            events: Vec::new(),
            dns_resolutions: Vec::new(),
            sni: None,
        }
    }

    #[test]
    fn counts_bytes_per_direction() {
        let key = CanonicalKey::from_tuple(&pv(0, true, 0, 0, true).tuple);
        let mut m = MetricsAccumulator::new(key);
        m.observe(&pv(0, true, 100, 500, false), true);
        m.observe(&pv(1, false, 200, 1200, false), false);
        let snap = m.snapshot();
        assert_eq!(snap.bytes, 1700);
        assert_eq!(snap.packets, 2);
    }

    #[test]
    fn setup_rtt_from_first_exchange() {
        let key = CanonicalKey::from_tuple(&pv(0, true, 0, 0, true).tuple);
        let mut m = MetricsAccumulator::new(key);
        m.observe(&pv(1000, true, 0, 0, true), true); // SYN at t=1000
        m.observe(&pv(1500, false, 0, 0, true), false); // SYN-ACK at t=1500
        assert_eq!(m.snapshot().rtt_estimate_nanos, Some(500));
    }

    #[test]
    fn duplicate_sequence_counts_as_retransmit() {
        let key = CanonicalKey::from_tuple(&pv(0, true, 0, 0, true).tuple);
        let mut m = MetricsAccumulator::new(key);
        m.observe(&pv(0, true, 5000, 100, false), true);
        m.observe(&pv(1, true, 5000, 100, false), true); // same seq again
        assert_eq!(m.snapshot().retransmits, 1);
    }

    #[test]
    fn pure_ack_is_not_a_retransmit() {
        let key = CanonicalKey::from_tuple(&pv(0, true, 0, 0, true).tuple);
        let mut m = MetricsAccumulator::new(key);
        m.observe(&pv(0, true, 9, 0, false), true);
        m.observe(&pv(1, true, 9, 0, false), true); // duplicate pure ACK, seq 9
        assert_eq!(m.snapshot().retransmits, 0);
    }
}
