//! # netpulse-flow — reconstruction
//!
//! Turns the unordered stream of dissected packets from [`netpulse_decode`] into
//! **flows** (bidirectional conversations) and **sessions** (causally-related
//! groups of flows) — the reconstruction that makes understanding-first
//! buildable (docs/06).
//!
//! Pipeline position: consume decoded packets → [`decode_view::PacketView`] →
//! [`engine::FlowEngine`] → finalized [`netpulse_core::Flow`] +
//! [`netpulse_core::Session`] records for storage and narrative (docs/06 §2).
//!
//! Flow state is partitioned by a hash of the canonical 5-tuple across shards
//! (docs/06 §7). Both directions of a conversation canonicalize to the same key
//! (docs/06 §3.1), so a flow is always handled by one shard and per-flow state
//! needs no locks (docs/02 §5.2).
#![forbid(unsafe_code)]

pub mod decode_view;
pub mod engine;
pub mod identity;
pub mod metrics;
pub mod session;
pub mod state;
pub mod table;

pub use decode_view::{DnsResolution, PacketView, TcpSignals};
pub use engine::{FinalizedFlow, FlowEngine};
pub use identity::{CanonicalKey, Direction};
pub use session::{CausalLink, SessionReconstructor};
pub use state::TcpState;

use netpulse_core::net::FiveTuple;

/// Map a flow key to its owning shard index (docs/02 §5.2). A concrete,
/// testable seam: all packets of one flow hash here to the same shard, giving
/// that shard sole ownership of the flow's mutable state.
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
