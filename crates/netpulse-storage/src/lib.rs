//! # netpulse-storage — persistence
//!
//! The three stores from docs/02 §9 / docs/08 §3, tiered by access pattern:
//! - Tier 1 [`ring::RingBuffer`] — the in-memory ring of newest items (seconds),
//! - Tier 2 [`timeseries::TimeSeriesStore`] — downsampled metrics (hours→days),
//! - Tier 3 [`capture_store::CaptureStore`] — the durable flows/sessions/events
//!   record (SQLite + columnar in the full build; an in-memory backing behind
//!   the identical query surface for the Phase 1 slice, docs/08 §13).
//!
//! Two privacy/honesty invariants are physical here, not conventional: the
//! metadata-only **payload policy** default (docs/08 §4) and the
//! **evidence-reference invariant** in retention (docs/08 §6).
#![forbid(unsafe_code)]

pub mod capture_store;
pub mod error;
pub mod migration;
pub mod models;
pub mod repository;
pub mod ring;
pub mod timeseries;

pub use capture_store::{CaptureStore, StoredFinding};
pub use error::{MigrationError, Result as StorageResult};
pub use migration::{MigrationManager, MigrationStatus};
pub use repository::{
    default_db_path, CaptureRepository, MemoryCaptureStore, SqliteCaptureRepository,
};
pub use ring::RingBuffer;
pub use timeseries::{Point, SeriesId, TimeSeriesStore};

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
pub trait Store {
    /// The payload policy currently in force for this store.
    fn payload_policy(&self) -> PayloadPolicy;

    /// Flush in-flight data durably. Crash safety (N10) depends on this being
    /// honored on shutdown and checkpoint boundaries (docs/02 §11).
    fn flush(&mut self) -> Result<()>;
}

impl<R: CaptureRepository> Store for CaptureStore<R> {
    fn payload_policy(&self) -> PayloadPolicy {
        self.policy()
    }

    fn flush(&mut self) -> Result<()> {
        // In-memory backing is always durable-in-process; the SQLite backend
        // (docs/08 §9) commits the WAL here.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_metadata_only() {
        // Privacy-preserving default (docs/02 §10.3).
        assert_eq!(PayloadPolicy::default(), PayloadPolicy::MetadataOnly);
    }

    #[test]
    fn capture_store_reports_its_policy_via_trait() {
        let store = CaptureStore::new(PayloadPolicy::Headers);
        assert_eq!(store.payload_policy(), PayloadPolicy::Headers);
    }
}
