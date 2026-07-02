//! # netpulse-engine (library)
//!
//! The analysis process's reusable core (docs/02 §5.1, docs/04 §3.12). It wires
//! the Phase 1 pipeline — capture → decode → flow/session → storage — behind
//! [`run_offline`]/[`analyze_pcap`], so both the `netpulse-engine` binary and
//! integration tests drive the identical path (docs/04 §9).
//!
//! Runs at user privilege; it holds no raw-capture capability (that lives in the
//! separate `netpulse-capture-svc` process, docs/02 §10.2).
//!
//! Phase 2 adds the presentation-side analysis layers that project the Phase 1
//! model into what the UI shows: [`monitor`] (usage breakdowns + "why is it
//! slow?" diagnostics, docs/11) and [`attribution`] (socket→process correlation,
//! docs/12). [`project`] maps those and narrative cards into the `netpulse-api`
//! wire DTOs. Phase 4 adds [`security`] — the intelligence projection that runs
//! the `netpulse-intel` detectors and the grounded `netpulse-ai` assistant over
//! the committed store (docs/17–20). All are read-only projections over committed
//! data (docs/11 §14).
#![forbid(unsafe_code)]

pub mod attribution;
pub mod education;
pub mod monitor;
pub mod pipeline;
pub mod project;
pub mod security;

pub use education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
    EducationView,
};
pub use pipeline::{analyze_pcap, run_offline, OfflineReport, PresentationView};
pub use security::{ask_assistant, present_security};
