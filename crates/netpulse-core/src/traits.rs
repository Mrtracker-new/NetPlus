//! The core role-noun traits (docs/04 §6). Each names a *role* a lower layer
//! plays for the layers above it. Foundation stage defines the contracts only;
//! the phase crates implement them (docs/05–08, docs/12, docs/17).
//!
//! Two design rules hold throughout:
//! - **Observe-only** (docs/01 X1, docs/02 §2): a [`CaptureSource`] yields a
//!   read-only frame stream. No trait here can inject, block, or modify traffic.
//! - **Grounded** (docs/02 §6.3): a [`Detector`] emits [`Finding`]s that already
//!   carry their evidence references; it cannot produce a free-floating verdict.

use crate::error::Result;
use crate::model::{Finding, Process, ProtoEvent, SocketOwner};
use crate::net::FiveTuple;

/// A read-only source of raw frames from one interface (docs/05).
///
/// Deliberately narrow: the only capability is "hand me the next batch of
/// bytes". This is what keeps the privileged capture process's TCB tiny
/// (docs/02 §5.1, docs/04 §3.12).
pub trait CaptureSource {
    /// Pull the next batch of raw frames, blocking until some are available or
    /// the source is closed. Returns an empty batch on clean shutdown.
    fn next_batch(&mut self) -> Result<Vec<RawFrame>>;
}

/// A raw captured frame: bytes plus the capture-time metadata the pipeline
/// needs before decode. Payload interpretation happens later, in the decode
/// layer — this struct makes no claim about protocol.
#[derive(Debug, Clone)]
pub struct RawFrame {
    /// Nanosecond monotonic capture timestamp (paired with wall-clock upstream).
    pub mono_nanos: u64,
    pub iface_id: u16,
    /// The raw link-layer bytes, borrowed-then-owned from the capture ring.
    pub bytes: Vec<u8>,
}

/// Maps a flow's 5-tuple to the OS process that owns it (docs/12).
pub trait AttributionSource {
    /// Resolve the process owning `tuple`, if the OS socket tables know it.
    fn attribute(&self, tuple: &FiveTuple) -> Result<Option<Process>>;
}

/// A source of periodic OS socket-table snapshots for time-correlated
/// attribution (docs/12 §4). Unlike [`AttributionSource`]'s point lookup, this
/// is the enumeration the correlator polls and caches so it can resolve a flow's
/// owner *as of the flow's start time* — the core of docs/12 §5.
///
/// Per-OS implementations (netlink/`sock_diag`, `GetExtendedTcpTable`,
/// `libproc`) live in `netpulse-platform` behind this trait (docs/12 §4); the
/// correlator itself is platform-neutral and testable against a synthetic
/// source.
pub trait SocketTableSource {
    /// Enumerate the current socket→owner mappings (docs/12 §4). Called on the
    /// adaptive poll cadence of docs/12 §5.1.
    fn snapshot(&self) -> Result<Vec<SocketOwner>>;

    /// Resolve richer identity for a PID (name, exe, signer) (docs/12 §6). Split
    /// from [`Self::snapshot`] because it is looked up lazily, only for PIDs that
    /// actually own observed flows.
    fn process_info(&self, pid: u64) -> Result<Option<Process>>;
}

/// Parses one protocol layer from a byte slice into structured events (docs/07).
///
/// Implementors live in netpulse-decode and are the primary attack surface
/// (hostile input): strict bounds checks, no `unsafe` without review, and a
/// corresponding fuzz target each (docs/03 §3, docs/04 §3.4).
pub trait Dissector {
    /// Stable protocol name used for explanation-key addressing (docs/07 §7).
    fn protocol(&self) -> &'static str;

    /// Attempt to dissect `bytes`, emitting any protocol events found. A
    /// malformed packet yields a decode error and is quarantined, never
    /// allowed to stall the engine (docs/02 §11).
    fn dissect(&self, flow_id: u64, bytes: &[u8]) -> Result<Vec<ProtoEvent>>;
}

/// Evaluates the reconstruction model and emits confidence-scored findings
/// (docs/17, docs/18, docs/20). Runs off the hot path (docs/02 §5.2).
pub trait Detector {
    /// Stable detector identifier, surfaced in findings for auditability.
    fn id(&self) -> &'static str;

    /// Inspect `events` for one flow and emit any findings. Each returned
    /// [`Finding`] must already carry its evidence references (docs/02 §6.3).
    fn evaluate(&self, events: &[ProtoEvent]) -> Result<Vec<Finding>>;
}
