//! The core entities. These are *logical* structures; physical
//! encodings live in netpulse-storage.
//!
//! One foundational rule threads through everything here — the
//! **evidence-reference invariant**: every derived artifact
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
/// policy.
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

/// Aggregated per-flow measurements. Populated by the flow engine.
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
    /// Connection entering TCP FIN teardown (`FinWait`/`Closing`).
    Closing,
    Closed,
    /// Connectionless (UDP) or connection-migrating (QUIC) conversation.
    Datagram,
}

/// A discrete protocol-level occurrence within a flow. This is
/// the unit the narrative builder and learning engine consume most.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtoEvent {
    pub flow_id: u64,
    pub ts: Timestamp,
    pub kind: ProtoEventKind,
}

/// The kind of protocol event. Extended per-protocol by the decode layer
///foundation stage seeds the common landmarks.
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

/// The user-facing narrative projection of a [`Session`]. A thin
/// placeholder at foundation stage; the narrative builder fills it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Journey {
    pub session_id: u64,
    /// Ordered narrative sentences; each will reference its evidence.
    pub sentences: Vec<String>,
}

/// The attributed application behind a flow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Process {
    pub pid: u64,
    pub name: String,
    pub exe_path: String,
    /// Code-signing identity where the OS exposes it.
    pub signer: Option<String>,
    /// Process start time (monotonic ns), used to distinguish a reused PID from
    /// the original process. `0` when the OS did not expose it.
    #[serde(default)]
    pub start_mono_nanos: u64,
    /// Measured CPU utilization percentage from the OS, if available.
    #[serde(default)]
    pub cpu_percent: Option<f32>,
    /// Resident memory bytes from the OS, if available.
    #[serde(default)]
    pub memory_bytes: Option<u64>,
}

/// A snapshot row mapping one socket (its 5-tuple) to its owning process, as read
/// from the OS socket tables. Attribution correlates these snapshots
/// against the packet/flow stream over time — it is not a per-packet lookup
///
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketOwner {
    /// The socket's 5-tuple as the OS reports it.
    pub tuple: FiveTuple,
    /// The owning process's PID.
    pub pid: u64,
    /// The process's start time (monotonic ns) for PID-reuse safety
    ///
    pub start_mono_nanos: u64,
}

/// How confident an attribution is. Attribution is a
/// time-sensitive correlation, so its certainty is graded, and "unknown" is a
/// first-class, correct answer — a wrong PID is worse than an admitted unknown
///
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum AttributionConfidence {
    /// A direct snapshot match whose validity window contained the flow start.
    High,
    /// A retro-matched or inferred match near a window edge.
    Low,
    /// The OS gave no clear owner; surfaced honestly.
    Unknown,
}

/// A remote endpoint, enriched from *local* databases only — NetPulse never
/// phones home to resolve a host.
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

/// How a hostname for an IP was learned — always from traffic we *observed*,
/// never an active lookup. NetPulse resolves names passively (a DNS answer it
/// saw, a TLS SNI the client sent) so naming stays offline and deterministic; it
/// never issues a reverse-DNS/PTR query, which would be egress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum NameSource {
    /// A DNS A/AAAA answer that resolved this name to the IP — the authoritative
    /// name→address mapping, seen on the wire *this session*.
    Dns,
    /// A TLS SNI the client sent when opening a connection to this IP — the
    /// hostname the user's software *asked for*, often the real site behind a
    /// shared CDN address. Seen on the wire this session.
    Sni,
    /// A static mapping from the machine's `hosts` file. Local host configuration,
    /// not wire traffic — names LAN devices and developer overrides the capture
    /// itself may never carry a DNS answer for.
    HostsFile,
    /// A cached entry read from the OS DNS resolver (e.g. Windows DNS Client
    /// cache). This is how a name is recovered for a connection whose DNS lookup
    /// happened *before* capture started, and it includes any mDNS `.local` names
    /// the resolver already cached. It is read from local OS state only — NetPulse
    /// never issues a query to populate it, so no egress occurs.
    OsResolver,
}

/// One passively-observed name for an IP, tagged with how it was learned. An IP
/// can carry several (a CDN address serves many sites, a DNS name and its SNI may
/// differ), so these are collected as a set rather than reduced to one guessed
/// "primary" — presenting a single name as authoritative would overclaim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostName {
    pub name: String,
    pub source: NameSource,
}

/// A security or anomaly observation.
///
/// Per the honesty principle, a finding is never a bare verdict:
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
///
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum FindingCategory {
    /// Statistical/ML deviation from this machine's learned normal.
    Anomaly,
    /// A rule- or heuristic-matched suspicious behavior.
    Suspicious,
    /// Informational observation worth surfacing without alarm.
    Informational,
}

/// A calibrated confidence in `0.0..=1.0`. Constructed only via [`Confidence::new`],
/// which clamps out-of-range input, so an invalid confidence cannot exist — the
/// type itself enforces "honest over reassuring".
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
/// physical form of the evidence-reference invariant. Storage
/// carries these as first-class foreign keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum EvidenceRef {
    Packet(u64),
    Flow(u64),
    Session(u64),
}
