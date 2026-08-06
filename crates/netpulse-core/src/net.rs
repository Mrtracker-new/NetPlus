//! Network addressing primitives: the 5-tuple that identifies a flow, and the
//! transport/application protocol enumerations. See and docs/06.

use std::net::IpAddr;

use serde::{Deserialize, Serialize};

/// The bidirectional conversation key: (src ip, src port, dst ip, dst port, L4).
///
/// A `Flow` is identified by this tuple. The flow engine
/// shards state by a hash of this key so a given flow is always handled by the
/// same thread, needing no locks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FiveTuple {
    pub src_ip: IpAddr,
    pub src_port: u16,
    pub dst_ip: IpAddr,
    pub dst_port: u16,
    pub l4: L4Proto,
}

impl FiveTuple {
    /// Construct a 5-tuple.
    pub const fn new(
        src_ip: IpAddr,
        src_port: u16,
        dst_ip: IpAddr,
        dst_port: u16,
        l4: L4Proto,
    ) -> Self {
        Self {
            src_ip,
            src_port,
            dst_ip,
            dst_port,
            l4,
        }
    }
}

/// Layer-4 (transport) protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum L4Proto {
    Tcp,
    Udp,
    /// Any other IP protocol number, retained verbatim for honest reporting.
    Other(u8),
}

/// Detected layer-7 (application) protocol. `Unknown` until the decode layer
/// classifies the flow; NetPulse never guesses beyond the evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[non_exhaustive]
pub enum L7Proto {
    #[default]
    Unknown,
    Dns,
    Tls,
    Http1,
    Http2,
    Http3,
    Quic,
}
