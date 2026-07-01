//! The core entities (docs/02 §6.1). These are *logical* structures; physical
//! encodings live in netpulse-storage (docs/08).
//!
//! One foundational rule threads through everything here — the
//! **evidence-reference invariant** (docs/02 §6.3): every derived artifact
//! points back to the exact data that justifies it. A [`Finding`] carries
//! [`EvidenceRef`]s; a narrative sentence references its [`ProtoEvent`]s. This
//! is what makes the whole system auditable, and it is not optional.

use std::net::IpAddr;

use serde::{Deserialize, Serialize};

use crate::net::{FiveTuple, L4Proto, L7Proto};
use crate::time::Timestamp;

/// The atomic capture unit.
///
/// `headers_ref` / `payload_ref` are indirections, not inline bytes: payloads
/// may be truncated or omitted entirely under the default metadata-only storage
/// policy (docs/02 §9, docs/08).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Packet {
    pub id: u64,
    pub ts: Timestamp,
    pub length: u32,
    pub iface_id: u16,
    /// Reference to stored header bytes (offset/handle resolved by storage).
    pub headers_ref: u64,
    /// Reference to stored payload bytes, absent when payload is not retained.
    pub payload_ref: Option<u64>,
}

/// A bidirectional 5-tuple conversation with lifecycle and aggregated metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Flow {
    pub id: u64,
    pub key: FiveTuple,
    pub first_ts: Timestamp,
    pub last_ts: Timestamp,
    pub l4: L4Proto,
    pub l7: L7Proto,
    pub stats: FlowMetrics,
    pub state: FlowState,
}

/// Aggregated per-flow measurements (docs/06). Populated by the flow engine.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct FlowMetrics {
    pub bytes: u64,
    pub packets: u64,
    /// Estimated round-trip time in nanoseconds, once observable.
    pub rtt_estimate_nanos: Option<u64>,
    pub retransmits: u32,
    /// Count of packets inferred lost (gaps, duplicate ACKs, etc.).
    pub loss_indicators: u32,
}

/// Flow lifecycle state. TCP walks the connection-oriented variants; UDP/QUIC
/// use [`FlowState::Datagram`] since they have no handshake teardown to track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum FlowState {
    SynSeen,
    Established,
    Closing,
    Closed,
    /// Connectionless (UDP) or connection-migrating (QUIC) conversation.
    Datagram,
}

/// A discrete protocol-level occurrence within a flow (docs/02 §6.2). This is
/// the unit the narrative builder and learning engine consume most.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtoEvent {
    pub flow_id: u64,
    pub ts: Timestamp,
    pub kind: ProtoEventKind,
}

/// The kind of protocol event. Extended per-protocol by the decode layer
/// (docs/07); foundation stage seeds the common landmarks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum ProtoEventKind {
    DnsQuery,
    DnsResponse,
    TlsClientHello,
    TlsServerHello,
    HttpRequest,
    HttpResponse,
    QuicHandshakeComplete,
    /// A protocol landmark not yet modelled, named for honest display.
    Other(String),
}

/// Flows grouped by cause — e.g. every flow spawned loading one page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: u64,
    pub process_id: u64,
    pub start_ts: Timestamp,
    /// Human-readable triggering event, e.g. "user navigated to example.com".
    pub trigger: String,
    pub flow_ids: Vec<u64>,
}

/// The user-facing narrative projection of a [`Session`] (docs/14). A thin
/// placeholder at foundation stage; the narrative builder fills it (docs/09).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Journey {
    pub session_id: u64,
    /// Ordered narrative sentences; each will reference its evidence (docs/14).
    pub sentences: Vec<String>,
}

/// The attributed application behind a flow (docs/12).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Process {
    pub pid: u64,
    pub name: String,
    pub exe_path: String,
    /// Code-signing identity where the OS exposes it.
    pub signer: Option<String>,
}

/// A remote endpoint, enriched from *local* databases only — NetPulse never
/// phones home to resolve a host (docs/02 §10.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Host {
    pub ip: IpAddr,
    pub names: Vec<String>,
    /// Country/region code from a local geo DB.
    pub geo: Option<String>,
    /// Autonomous System Number from a local ASN DB.
    pub asn: Option<u32>,
    /// Inferred owning organization / CDN.
    pub org: Option<String>,
}

/// A security or anomaly observation.
///
/// Per the honesty principle (docs/01 §7.2), a finding is never a bare verdict:
/// it always carries a calibrated [`Confidence`] and [`EvidenceRef`]s pointing
/// back at the data that produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub id: u64,
    pub category: FindingCategory,
    pub confidence: Confidence,
    pub evidence_refs: Vec<EvidenceRef>,
}

/// Broad classification of a [`Finding`]. Detectors refine within a category
/// (docs/17, docs/18, docs/20).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum FindingCategory {
    /// Statistical/ML deviation from this machine's learned normal (docs/20).
    Anomaly,
    /// A rule- or heuristic-matched suspicious behavior (docs/17, docs/18).
    Suspicious,
    /// Informational observation worth surfacing without alarm.
    Informational,
}

/// A calibrated confidence in `0.0..=1.0`. Constructed only via [`Confidence::new`],
/// which clamps out-of-range input, so an invalid confidence cannot exist — the
/// type itself enforces "honest over reassuring" (docs/01 §7.2).
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize)]
pub struct Confidence(f32);

impl Confidence {
    /// Clamp `value` into `0.0..=1.0` and wrap it.
    pub fn new(value: f32) -> Self {
        Self(value.clamp(0.0, 1.0))
    }

    /// The underlying `0.0..=1.0` value.
    pub fn value(self) -> f32 {
        self.0
    }
}

/// A pointer from a derived artifact back to its supporting evidence — the
/// physical form of the evidence-reference invariant (docs/02 §6.3). Storage
/// carries these as first-class foreign keys (docs/08).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum EvidenceRef {
    Packet(u64),
    Flow(u64),
    Session(u64),
}
