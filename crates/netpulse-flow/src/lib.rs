//! # netpulse-flow — reconstruction
//!
//! The sharded flow state machines, direction pairing, per-flow metrics (RTT,
//! retransmits, loss), and session reconstruction — grouping flows into
//! sessions with causal/lineage ordering (docs/06).
//!
//! Flow state is partitioned by a hash of the 5-tuple across shards, each owned
//! by a single thread, so a given flow is always handled by the same shard and
//! per-flow state needs no locks (docs/02 §5.2).
//!
//! **Status: foundation stub.** See Phase 1, docs/06.
#![forbid(unsafe_code)]

use netpulse_core::net::FiveTuple;

/// Map a flow key to its owning shard index (docs/02 §5.2). A concrete,
/// testable seam even before the state machines exist.
pub fn shard_for(key: &FiveTuple, shard_count: u16) -> u16 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    (h.finish() % u64::from(shard_count.max(1))) as u16
}

#[cfg(test)]
mod tests {
    use super::shard_for;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn same_flow_maps_to_same_shard() {
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let key = FiveTuple::new(ip, 5000, ip, 443, L4Proto::Tcp);
        assert_eq!(shard_for(&key, 8), shard_for(&key, 8));
    }

    #[test]
    fn shard_is_in_range() {
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5));
        let key = FiveTuple::new(ip, 1234, ip, 80, L4Proto::Udp);
        assert!(shard_for(&key, 4) < 4);
    }
}
