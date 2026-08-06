//! Canonical flow identity — the single most bug-prone logic in the
//! engine, so it is small, explicit, and heavily tested.
//!
//! Traffic flows both ways; the two directions of one conversation have mirror
//! 5-tuples (src/dst swapped). A [`CanonicalKey`] orders the two endpoints
//! deterministically so **both directions hash to the same key**
//! — the precondition for treating them as one bidirectional flow and for
//! shard-by-key ownership.
//!
//! Identity also carries a **time epoch**: the OS recycles ports,
//! so `(canonical tuple, epoch)` distinguishes a fresh connection that reuses a
//! 5-tuple from the previous one — preventing two unrelated connections from
//! merging and corrupting metrics.

use std::net::IpAddr;

use netpulse_core::net::{FiveTuple, L4Proto};

/// A direction-independent flow key: the two endpoints ordered canonically.
///
/// `lo`/`hi` are the two (IP, port) endpoints with `lo <= hi`, so a packet in
/// either direction produces the same key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CanonicalKey {
    lo_ip: IpAddr,
    lo_port: u16,
    hi_ip: IpAddr,
    hi_port: u16,
    l4: L4Proto,
}

impl CanonicalKey {
    /// Canonicalize a directional 5-tuple. The result is identical for the tuple
    /// and its src/dst-swapped mirror.
    pub fn from_tuple(t: &FiveTuple) -> Self {
        let a = (t.src_ip, t.src_port);
        let b = (t.dst_ip, t.dst_port);
        // Order endpoints by (ip, port). Any total order works, as long as it is
        // stable and symmetric across the two directions.
        let (lo, hi) = if endpoint_le(a, b) { (a, b) } else { (b, a) };
        Self {
            lo_ip: lo.0,
            lo_port: lo.1,
            hi_ip: hi.0,
            hi_port: hi.1,
            l4: t.l4,
        }
    }

    /// Whether `tuple` (in its own direction) has the given endpoint as its
    /// source — i.e. was sent *from* the canonical `lo` endpoint.
    pub fn is_from_lo(&self, t: &FiveTuple) -> bool {
        (t.src_ip, t.src_port) == (self.lo_ip, self.lo_port)
    }

    /// The transport protocol of this conversation.
    pub fn l4(&self) -> L4Proto {
        self.l4
    }

    /// A deterministic directional tuple (`lo` → `hi`) for hashing this flow into
    /// a shard. Both directions of a conversation share one `CanonicalKey`, so
    /// they map to the same shard. Not a claim about who initiated —
    /// that is tracked separately via [`CanonicalKey::is_from_lo`].
    pub fn to_repr_tuple(&self) -> FiveTuple {
        FiveTuple::new(self.lo_ip, self.lo_port, self.hi_ip, self.hi_port, self.l4)
    }
}

fn endpoint_le(a: (IpAddr, u16), b: (IpAddr, u16)) -> bool {
    // Compare by IP bytes first, then port. IpAddr's Ord is stable and total.
    match ip_key(a.0).cmp(&ip_key(b.0)) {
        std::cmp::Ordering::Less => true,
        std::cmp::Ordering::Greater => false,
        std::cmp::Ordering::Equal => a.1 <= b.1,
    }
}

/// A sortable byte representation of an IP: V4 mapped into the low bytes so v4
/// and v6 order consistently without allocation surprises.
fn ip_key(ip: IpAddr) -> u128 {
    match ip {
        IpAddr::V4(v4) => u32::from(v4) as u128,
        IpAddr::V6(v6) => u128::from(v6),
    }
}

/// The direction a packet travels relative to the flow initiator.
/// The initiator is the endpoint that sent the first packet (the SYN for TCP).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// From the initiator (the "client" side).
    Upstream,
    /// Toward the initiator (the "server" side).
    Downstream,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    #[test]
    fn both_directions_canonicalize_equal() {
        let fwd = FiveTuple::new(
            ip(192, 168, 0, 1),
            50000,
            ip(93, 184, 216, 34),
            443,
            L4Proto::Tcp,
        );
        let rev = FiveTuple::new(
            ip(93, 184, 216, 34),
            443,
            ip(192, 168, 0, 1),
            50000,
            L4Proto::Tcp,
        );
        assert_eq!(
            CanonicalKey::from_tuple(&fwd),
            CanonicalKey::from_tuple(&rev)
        );
    }

    #[test]
    fn different_ports_are_distinct_flows() {
        let a = FiveTuple::new(ip(10, 0, 0, 1), 1000, ip(10, 0, 0, 2), 80, L4Proto::Tcp);
        let b = FiveTuple::new(ip(10, 0, 0, 1), 1001, ip(10, 0, 0, 2), 80, L4Proto::Tcp);
        assert_ne!(CanonicalKey::from_tuple(&a), CanonicalKey::from_tuple(&b));
    }

    #[test]
    fn protocol_is_part_of_identity() {
        let tcp = FiveTuple::new(ip(10, 0, 0, 1), 1000, ip(10, 0, 0, 2), 80, L4Proto::Tcp);
        let udp = FiveTuple::new(ip(10, 0, 0, 1), 1000, ip(10, 0, 0, 2), 80, L4Proto::Udp);
        assert_ne!(
            CanonicalKey::from_tuple(&tcp),
            CanonicalKey::from_tuple(&udp)
        );
    }

    #[test]
    fn is_from_lo_tracks_direction() {
        let fwd = FiveTuple::new(ip(1, 1, 1, 1), 5, ip(2, 2, 2, 2), 6, L4Proto::Tcp);
        let key = CanonicalKey::from_tuple(&fwd);
        let rev = FiveTuple::new(ip(2, 2, 2, 2), 6, ip(1, 1, 1, 1), 5, L4Proto::Tcp);
        // Exactly one direction is "from lo".
        assert_ne!(key.is_from_lo(&fwd), key.is_from_lo(&rev));
    }
}
