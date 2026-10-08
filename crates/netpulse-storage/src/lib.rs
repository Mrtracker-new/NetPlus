//! # netpulse-storage — persistence
//!
//! The readable model is the in-memory, bounded [`capture_store::CaptureStore`]:
//! the flows/sessions/events/hosts/findings the engine answers queries from.
//! Durability is a separate concern handled by [`durable::DurableLog`], a
//! write-behind SQLite mirror drained by its own thread, so the capture loop and
//! every query handler stay free of blocking SQL.
//!
//! Two privacy/honesty invariants are physical here, not conventional: the
//! metadata-only **payload policy** default and the
//! **evidence-reference invariant** in retention.
#![forbid(unsafe_code)]

pub mod capture_store;
pub mod durable;
pub mod error;
pub mod migration;
pub mod models;
pub mod repository;

pub use capture_store::{
    read_repository_snapshot, CaptureStore, CaptureStoreSnapshot, StoredFinding,
};
pub use durable::{DurableHealth, DurableLog, DurableRecord};
pub use error::{MigrationError, Result as StorageResult, StorageError};
pub use migration::{MigrationManager, MigrationStatus};
pub use repository::{
    default_db_path, CaptureRepository, MemoryCaptureStore, SqliteCaptureRepository,
};

use netpulse_core::Result;

/// Configuration bounds for [`CaptureStore`] and [`MemoryCaptureStore`] retention.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StorageConfig {
    /// Maximum flows retained in memory before triggering eviction.
    pub max_flows: usize,
    /// Maximum sessions retained in memory before triggering session eviction.
    pub max_sessions: usize,
    /// Maximum proto events retained per flow.
    pub max_events_per_flow: usize,
    /// Target fraction of `max_flows` to retain after eviction (e.g. 0.8 means evict down to 80%).
    pub watermark_ratio: f32,
    /// Whether automatic eviction is enabled on flow insertion.
    pub auto_evict: bool,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            max_flows: 50_000,
            max_sessions: 10_000,
            max_events_per_flow: 100,
            watermark_ratio: 0.8,
            auto_evict: true,
        }
    }
}

/// Statistics reported after an eviction pass.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EvictionStats {
    pub flows_evicted: usize,
    pub sessions_evicted: usize,
    pub expired_findings: usize,
}

/// How much of each packet is retained. The default trades depth
/// for privacy and disk; the user may widen it.
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

/// The persistence contract shared by every store implementation.
pub trait Store {
    /// The payload policy currently in force for this store.
    fn payload_policy(&self) -> PayloadPolicy;

    /// Flush in-flight data durably. Crash safety (N10) depends on this being
    /// honored on shutdown and checkpoint boundaries.
    fn flush(&mut self) -> Result<()>;
}

impl<R: CaptureRepository> Store for CaptureStore<R> {
    fn payload_policy(&self) -> PayloadPolicy {
        self.policy()
    }

    /// Flush the durable write-behind mirror, waiting until every queued write
    /// has been attempted and the WAL is checkpointed.
    ///
    /// * With a mirror attached, a failure here means data is **not** durable and
    ///   must be reported (never swallowed).
    /// * With no mirror attached the store is process-lifetime only; that is
    ///   reported honestly by [`CaptureStore::is_durable`] / `durable_health`
    ///   rather than by claiming a successful flush.
    fn flush(&mut self) -> Result<()> {
        self.flush_durable(std::time::Duration::from_secs(15))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_metadata_only() {
        // Privacy-preserving default.
        assert_eq!(PayloadPolicy::default(), PayloadPolicy::MetadataOnly);
    }

    #[test]
    fn capture_store_reports_its_policy_via_trait() {
        let store = CaptureStore::new(PayloadPolicy::Headers);
        assert_eq!(store.payload_policy(), PayloadPolicy::Headers);
    }
}
