//! # netpulse-storage — persistence
//!
//! The three stores from docs/02 §9 behind a [`Store`] trait: the in-memory
//! ring buffer (seconds), the time-series metrics store (hours→days,
//! downsampled), and the durable capture store (flows/sessions/events, SQLite +
//! columnar). Also owns the payload-policy modes and retention/downsampling
//! (docs/08).
//!
//! **Status: foundation stub.** See Phase 1, docs/08.
#![forbid(unsafe_code)]

use netpulse_core::Result;

/// How much of each packet is retained (docs/02 §9). The default trades depth
/// for privacy and disk; the user may widen it (docs/02 §10.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PayloadPolicy {
    /// Default: flow/session metadata only, no packet bytes.
    #[default]
    MetadataOnly,
    /// Retain headers, drop payloads.
    Headers,
    /// Retain full payloads (largest footprint; explicit user choice).
    FullPayload,
}

/// The persistence contract shared by every store implementation (docs/08).
/// Method surface is intentionally empty at foundation stage.
pub trait Store {
    /// The payload policy currently in force for this store.
    fn payload_policy(&self) -> PayloadPolicy;

    /// Flush in-flight data durably. Crash safety (N10) depends on this being
    /// honored on shutdown and checkpoint boundaries (docs/02 §11).
    fn flush(&mut self) -> Result<()>;
}

#[cfg(test)]
mod tests {
    use super::PayloadPolicy;

    #[test]
    fn default_policy_is_metadata_only() {
        // Privacy-preserving default (docs/02 §10.3).
        assert_eq!(PayloadPolicy::default(), PayloadPolicy::MetadataOnly);
    }
}
