//! # netpulse-core
//!
//! The shared vocabulary of the whole system: the logical data model from
//! [`docs/0-foundation/02_System_Architecture.md`] §6 plus the core role-noun
//! traits every higher layer implements.
//!
//! This crate is the base of the dependency graph: it depends on
//! nothing internal, so every other crate can speak the same language. There is
//! exactly one `Flow`, one `Session`, one `Finding` — defined here and nowhere
//! else — which is what keeps the model from diverging.
//!
//! Nothing in this crate captures, parses, or stores anything. It only defines
//! *shapes* and *contracts*.
#![forbid(unsafe_code)]

pub mod capabilities;
pub mod config;
pub mod disclosure;
pub mod error;
pub mod events;
pub mod fleet;
pub mod health;
pub mod model;
pub mod net;
pub mod providers;
pub mod telemetry;
pub mod time;
pub mod traits;

pub use capabilities::CapabilityRegistry;
pub use config::AppConfig;
pub use disclosure::Depth;
pub use error::{NpError, Result};
pub use events::SystemEventEnvelope;
pub use fleet::{HostHealthMetrics, HostIdentity};
pub use model::{
    AttributionConfidence, Confidence, EvidenceRef, Finding, FindingCategory, Flow, FlowMetrics,
    FlowState, Host, HostName, Journey, NameSource, Packet, Process, ProtoEvent, ProtoEventKind,
    Session, SocketOwner,
};
pub use net::{FiveTuple, L4Proto, L7Proto};
pub use providers::ProviderRegistry;
pub use time::Timestamp;
pub use traits::{AttributionSource, CaptureSource, Detector, Dissector, SocketTableSource};
