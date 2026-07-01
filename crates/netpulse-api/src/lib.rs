//! # netpulse-api — the contract (source of truth)
//!
//! The single versioned Query/Stream/Command message schema for the
//! backend↔frontend IPC boundary (docs/02 §7). Both the Rust engine and the
//! generated TypeScript types derive from this one crate, so the two sides
//! cannot drift (docs/03 §7, docs/04 §3.11).
//!
//! Three interaction shapes (docs/02 §7.1):
//! - **Streams (push):** live channels the UI subscribes to.
//! - **Queries (pull):** historical/aggregated requests, paginated and bounded.
//! - **Commands (control):** the *only* write paths from UI to engine — few and
//!   enumerable, so the observe-only guarantee is easy to audit.
//!
//! **Status: foundation stub.** Message payloads are placeholders; ts-rs
//! codegen into `ui/packages/contract` is deferred until the schema firms up.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// Contract version. Bumped on any breaking change to the message schema so UI
/// and engine can negotiate compatibility (docs/02 §7.2).
pub const API_VERSION: u32 = 0;

/// A live channel the UI can subscribe to (docs/02 §7.1). Placeholder set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum StreamChannel {
    Flows,
    Metrics,
    Findings,
    Narratives,
}

/// A historical/aggregated pull request (docs/02 §7.1). Placeholder set;
/// each variant is paginated and bounded once defined (docs/02 §7.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Query {
    /// Fetch packets belonging to a flow.
    PacketsOfFlow { flow_id: u64 },
    /// Fetch the narrative journey for a session.
    JourneyOfSession { session_id: u64 },
}

/// A user-initiated control write — the only write path UI→engine (docs/02 §7.1).
/// The set is deliberately small and enumerable for auditability. Observe-only:
/// nothing here modifies network traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Command {
    StartCapture { iface_id: u16 },
    StopCapture { iface_id: u16 },
    StartRecording,
    StopRecording,
}

#[cfg(test)]
mod tests {
    use super::API_VERSION;

    #[test]
    fn version_is_defined() {
        assert_eq!(API_VERSION, 0);
    }
}
