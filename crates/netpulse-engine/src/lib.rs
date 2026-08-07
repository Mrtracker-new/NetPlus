//! # netpulse-engine (library)
//!
//! The analysis process's reusable core. It wires
//! the Phase 1 pipeline — capture → decode → flow/session → storage — behind
//! [`run_offline`]/[`analyze_pcap`], so both the `netpulse-engine` binary and
//! integration tests drive the identical path.
//!
//! Runs at user privilege; it holds no raw-capture capability (that lives in the
//! separate `netpulse-capture-svc` process .
//!
//! Presentation-side analysis layers project the core
//! model into what the UI shows: [`monitor`] (usage breakdowns + "why is it
//! slow?" diagnostics) and [`attribution`] (socket→process correlation).
//! [`project`] maps those and narrative cards into the `netpulse-api`
//! wire DTOs. [`security`] is the intelligence projection that runs
//! the `netpulse-intel` detectors and the grounded `netpulse-ai` assistant over
//! the committed store. All are read-only projections over committed
//! data.
#![forbid(unsafe_code)]

pub mod attribution;
pub mod education;
pub mod export;
pub mod monitor;
pub mod pipeline;
pub mod project;
pub mod security;
pub mod supervisor;

pub use supervisor::{TaskStatus, TaskSupervisor};

pub use education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
    EducationView,
};
pub use export::{
    export_csv, export_json, export_pcapng, export_report, import_capture,
    preview as export_preview, ExportFormat, ExportPreview, Sanitizer, Selection,
};
pub use pipeline::{
    analyze_file, analyze_pcap, run_offline, run_replay, LivePipeline, OfflineReport,
    PresentationView,
};
pub use security::{ask_assistant, present_security};
