//! # netpulse-engine (library)
//!
//! The analysis process's reusable core (docs/02 §5.1, docs/04 §3.12). It wires
//! the Phase 1 pipeline — capture → decode → flow/session → storage — behind
//! [`run_offline`]/[`analyze_pcap`], so both the `netpulse-engine` binary and
//! integration tests drive the identical path (docs/04 §9).
//!
//! Runs at user privilege; it holds no raw-capture capability (that lives in the
//! separate `netpulse-capture-svc` process, docs/02 §10.2).
#![forbid(unsafe_code)]

pub mod pipeline;

pub use pipeline::{analyze_pcap, run_offline, OfflineReport};
