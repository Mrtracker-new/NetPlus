//! # netpulse-core
//!
//! The shared vocabulary of the whole system: the logical data model from
//! [`docs/0-foundation/02_System_Architecture.md`] §6 plus the core role-noun
//! traits every higher layer implements.
//!
//! This crate is the base of the dependency graph (docs/04 §3.1): it depends on
//! nothing internal, so every other crate can speak the same language. There is
//! exactly one `Flow`, one `Session`, one `Finding` — defined here and nowhere
//! else — which is what keeps the model from diverging (docs/04 §6).
//!
//! Nothing in this crate captures, parses, or stores anything. It only defines
//! *shapes* and *contracts*.
#![forbid(unsafe_code)]

pub mod error;
pub mod model;
pub mod net;
pub mod time;
pub mod traits;

pub use error::{NpError, Result};
pub use model::{
    Confidence, EvidenceRef, Finding, FindingCategory, Flow, FlowMetrics, FlowState, Host, Journey,
    Packet, Process, ProtoEvent, ProtoEventKind, Session,
};
pub use net::{FiveTuple, L4Proto, L7Proto};
pub use time::Timestamp;
pub use traits::{AttributionSource, CaptureSource, Detector, Dissector};
