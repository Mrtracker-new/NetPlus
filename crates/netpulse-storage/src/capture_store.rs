//! Tier 3 — the capture store: the authoritative record of
//! flows, sessions, protocol events, and hosts — the structured reconstruction
//! model. The physical design splits indexed metadata
//! (SQLite) from bulk columnar files; this initial slice keeps the *same logical
//! model and query surface* over an in-memory backing, so the SQLite backend can
//! drop in behind the identical API later.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use std::path::Path;

use netpulse_core::{EvidenceRef, Finding, Flow, Host, HostName, NpError, ProtoEvent, Session};
use serde::{Deserialize, Serialize};

use crate::durable::{DurableHealth, DurableLog, DurableRecord};
use crate::error::StorageError;
use crate::repository::{CaptureRepository, MemoryCaptureStore, SqliteCaptureRepository};
use crate::{EvictionStats, PayloadPolicy, StorageConfig};

// NOTE:
// CaptureStore is the authoritative runtime validator for EvidenceRef invariants.
// Repository implementations assume pre-validated input and MUST NOT duplicate invariant validation.

fn check_evidence_exists(
    finding_id: u64,
    entity: &str,
    entity_id: u64,
    exists: bool,
) -> netpulse_core::Result<()> {
    if !exists {
        Err(NpError::Invariant(format!(
            "Finding \"{finding_id}\" references missing {entity}Id({entity_id})"
        )))
    } else {
        Ok(())
    }
}

/// A finding plus the retention annotation from storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredFinding {
    pub finding: Finding,
    /// Set true when evidence it referenced was legitimately aged out; the UI
    /// then shows "evidence no longer retained" rather than a dead link.
    pub evidence_expired: bool,
}

/// Canonical, order-independent deterministic snapshot of all persisted runtime entities in [`CaptureStore`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CaptureStoreSnapshot {
    pub flows: Vec<Flow>,
    pub sessions: Vec<Session>,
    pub proto_events: Vec<ProtoEvent>,
    pub hosts: Vec<(u64, Host)>,
    pub resolutions: Vec<(IpAddr, Vec<HostName>)>,
    pub findings: Vec<StoredFinding>,
}

/// The indexed capture store generic over `R: CaptureRepository`.
/// Defaults to [`MemoryCaptureStore`] for fast in-memory operations.
#[derive(Debug)]
pub struct CaptureStore<R: CaptureRepository = MemoryCaptureStore> {
    config: StorageConfig,
    policy: PayloadPolicy,
    repository: R,
    flows: HashMap<u64, Flow>,
    sessions: HashMap<u64, Session>,
    hosts: HashMap<u64, Host>,
    resolutions: HashMap<IpAddr, Vec<HostName>>,
    findings: HashMap<u64, StoredFinding>,
    events_by_flow: HashMap<u64, Vec<ProtoEvent>>,
    /// Count of packet payload records written — must stay 0 under MetadataOnly.
    payload_records: u64,
    /// Optional durable write-behind mirror (SQLite). `None` means this store is
    /// process-lifetime only, and `flush`/health say so rather than implying
    /// durability that does not exist.
    durable: Option<Arc<DurableLog>>,
    /// Cached newest flow timestamp, kept so `latest_mono_nanos` is O(1) on the
    /// query path instead of an O(n) scan of every retained flow.
    latest_mono_cache: u64,
}

impl CaptureStore<MemoryCaptureStore> {
    /// Create an empty store backed by [`MemoryCaptureStore`] under the given payload policy.
    pub fn new(policy: PayloadPolicy) -> Self {
        Self {
            config: StorageConfig::default(),
            policy,
            repository: MemoryCaptureStore::new(),
            flows: HashMap::new(),
            sessions: HashMap::new(),
            hosts: HashMap::new(),
            resolutions: HashMap::new(),
            findings: HashMap::new(),
            events_by_flow: HashMap::new(),
            payload_records: 0,
            durable: None,
            latest_mono_cache: 0,
        }
    }

    /// Create an empty store with explicit [`StorageConfig`].
    pub fn with_config(policy: PayloadPolicy, config: StorageConfig) -> Self {
        Self {
            config,
            policy,
            repository: MemoryCaptureStore::new(),
            flows: HashMap::new(),
            sessions: HashMap::new(),
            hosts: HashMap::new(),
            resolutions: HashMap::new(),
            findings: HashMap::new(),
            events_by_flow: HashMap::new(),
            payload_records: 0,
            durable: None,
            latest_mono_cache: 0,
        }
    }
}

impl<R: CaptureRepository> CaptureStore<R> {
    /// Create a store with a custom repository implementation.
    pub fn with_repository(policy: PayloadPolicy, repository: R) -> Self {
        Self {
            config: StorageConfig::default(),
            policy,
            repository,
            flows: HashMap::new(),
            sessions: HashMap::new(),
            hosts: HashMap::new(),
            resolutions: HashMap::new(),
            findings: HashMap::new(),
            events_by_flow: HashMap::new(),
            payload_records: 0,
            durable: None,
            latest_mono_cache: 0,
        }
    }

    /// Attach a durable write-behind mirror. Every subsequent synchronous
    /// mutation is also enqueued for durable persistence; the mirror is drained
    /// and joined by [`CaptureStore::shutdown_durable`].
    pub fn attach_durable_log(&mut self, log: DurableLog) {
        self.durable = Some(Arc::new(log));
    }

    /// Health of the durable mirror, or `None` when the store has no durable
    /// backing at all (a fact the caller must report, not hide).
    pub fn durable_health(&self) -> Option<DurableHealth> {
        self.durable.as_ref().map(|log| log.health())
    }

    /// The durable database file backing this store, if any.
    pub fn durable_path(&self) -> Option<String> {
        self.durable
            .as_ref()
            .map(|log| log.path().display().to_string())
    }

    /// True when this store persists beyond the process lifetime.
    pub fn is_durable(&self) -> bool {
        self.durable.is_some()
    }

    /// Wait for all queued durable writes to be attempted, then checkpoint the
    /// WAL. Fails when the writes did not all succeed — callers must not report
    /// success on `Err`.
    pub fn flush_durable(&self, timeout: std::time::Duration) -> netpulse_core::Result<()> {
        match &self.durable {
            Some(log) => log
                .flush(timeout)
                .map_err(|e| NpError::Storage(format!("durable flush failed: {e}"))),
            None => Ok(()),
        }
    }

    /// Drain, stop and join the durable mirror, returning its final health so a
    /// shutdown report can state exactly what was persisted.
    pub fn shutdown_durable(&mut self) -> Option<DurableHealth> {
        let log = self.durable.take()?;
        Some(log.shutdown())
    }

    fn durable_write(&self, record: DurableRecord) -> netpulse_core::Result<()> {
        match &self.durable {
            Some(log) => log
                .enqueue(record)
                .map_err(|e| NpError::Storage(format!("durable persistence failed: {e}"))),
            None => Ok(()),
        }
    }

    /// Access current storage config.
    pub fn config(&self) -> StorageConfig {
        self.config
    }

    /// Update storage config.
    pub fn set_config(&mut self, config: StorageConfig) {
        self.config = config;
    }

    /// Access the underlying repository handle.
    pub fn repository(&self) -> &R {
        &self.repository
    }

    /// The payload policy in force.
    pub fn policy(&self) -> PayloadPolicy {
        self.policy
    }

    /// The names observed for one IP, empty if none.
    pub fn names_for(&self, ip: &IpAddr) -> &[HostName] {
        self.resolutions.get(ip).map_or(&[], |v| v.as_slice())
    }

    /// The whole `IP → names` map, for bulk joins.
    pub fn resolutions(&self) -> &HashMap<IpAddr, Vec<HostName>> {
        &self.resolutions
    }

    /// All flows belonging to a session.
    pub fn flows_for_session(&self, session_id: u64) -> Vec<&Flow> {
        match self.sessions.get(&session_id) {
            Some(s) => s
                .flow_ids
                .iter()
                .filter_map(|id| self.flows.get(id))
                .collect(),
            None => Vec::new(),
        }
    }

    /// Protocol events of a flow.
    pub fn events_for_flow(&self, flow_id: u64) -> &[ProtoEvent] {
        self.events_by_flow
            .get(&flow_id)
            .map_or(&[], |v| v.as_slice())
    }

    /// Flows in time window.
    pub fn flows_in_window(&self, from: u64, to: u64) -> Vec<&Flow> {
        let mut v: Vec<&Flow> = self
            .flows
            .values()
            .filter(|f| {
                let t = f.first_ts.mono_nanos;
                t >= from && t < to
            })
            .collect();
        v.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));
        v
    }

    /// A session by id.
    pub fn session(&self, id: u64) -> Option<&Session> {
        self.sessions.get(&id)
    }

    /// All retained session ids.
    pub fn session_ids(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// A flow by id.
    pub fn flow(&self, id: u64) -> Option<&Flow> {
        self.flows.get(&id)
    }

    /// A finding by id.
    pub fn finding(&self, id: u64) -> Option<&StoredFinding> {
        self.findings.get(&id)
    }

    /// All retained hosts.
    pub fn hosts(&self) -> impl Iterator<Item = &Host> {
        self.hosts.values()
    }

    /// A host by id.
    pub fn host(&self, id: u64) -> Option<&Host> {
        self.hosts.get(&id)
    }

    /// Number of flows / sessions currently retained.
    pub fn flow_count(&self) -> usize {
        self.flows.len()
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// The latest monotonic timestamp observed across all retained flows, or 0.
    ///
    /// Backed by an insert-time cache so it is O(1) on the query path; eviction
    /// recomputes it only when the flow holding the maximum is removed.
    pub fn latest_mono_nanos(&self) -> u64 {
        self.latest_mono_cache
    }

    /// Recompute the cached newest timestamp from scratch (used after bulk loads
    /// and after an eviction removed the newest flow).
    fn recompute_latest_mono(&mut self) {
        self.latest_mono_cache = self
            .flows
            .values()
            .map(|f| f.last_ts.mono_nanos.max(f.first_ts.mono_nanos))
            .max()
            .unwrap_or(0);
    }

    /// Synchronous insert flow.
    ///
    /// Errors mean the write is **not** durable (queue full or writer gone); the
    /// in-memory model is still updated, so the caller must surface the error
    /// rather than assume the flow will survive a restart.
    pub fn insert_flow(
        &mut self,
        flow: Flow,
        mut events: Vec<ProtoEvent>,
    ) -> netpulse_core::Result<()> {
        if self.config.max_events_per_flow > 0 && events.len() > self.config.max_events_per_flow {
            events.truncate(self.config.max_events_per_flow);
        }
        if !events.is_empty() {
            self.events_by_flow
                .entry(flow.id)
                .or_default()
                .extend(events.clone());
        }
        self.latest_mono_cache = self
            .latest_mono_cache
            .max(flow.last_ts.mono_nanos)
            .max(flow.first_ts.mono_nanos);
        self.flows.insert(flow.id, flow.clone());
        let durable = self.durable_write(DurableRecord::Flow(flow, events));
        self.auto_evict_if_needed();
        durable
    }

    /// Synchronous insert session.
    pub fn insert_session(&mut self, session: Session) -> netpulse_core::Result<()> {
        self.sessions.insert(session.id, session.clone());
        self.durable_write(DurableRecord::Session(session))
    }

    /// Synchronous insert host.
    pub fn insert_host(&mut self, id: u64, host: Host) -> netpulse_core::Result<()> {
        self.hosts.insert(id, host.clone());
        self.durable_write(DurableRecord::Host(id, host))
    }

    /// Synchronous set resolution.
    pub fn set_resolution(
        &mut self,
        ip: IpAddr,
        names: Vec<HostName>,
    ) -> netpulse_core::Result<()> {
        if names.is_empty() {
            self.resolutions.remove(&ip);
        } else {
            self.resolutions.insert(ip, names.clone());
        }
        self.durable_write(DurableRecord::Resolution(ip, names))
    }

    /// Synchronous merge resolution.
    pub fn merge_resolution(
        &mut self,
        ip: IpAddr,
        names: Vec<HostName>,
    ) -> netpulse_core::Result<()> {
        if names.is_empty() {
            return Ok(());
        }
        let existing = self.resolutions.entry(ip).or_default();
        for n in &names {
            if !existing
                .iter()
                .any(|h| h.name == n.name && h.source == n.source)
            {
                existing.push(n.clone());
            }
        }
        self.durable_write(DurableRecord::MergeResolution(ip, names))
    }

    /// Synchronous insert finding. Validates that all evidence references exist.
    pub fn insert_finding(&mut self, finding: Finding) -> netpulse_core::Result<()> {
        self.validate_evidence_refs(&finding)?;
        let durable = self.durable_write(DurableRecord::Finding(finding.clone()));
        self.findings.insert(
            finding.id,
            StoredFinding {
                finding,
                evidence_expired: false,
            },
        );
        durable
    }

    /// Trigger automatic eviction if flow or session counts exceed configured limits.
    pub fn auto_evict_if_needed(&mut self) -> EvictionStats {
        if !self.config.auto_evict || self.config.max_flows == 0 {
            return EvictionStats::default();
        }
        let mut stats = EvictionStats::default();
        if self.flows.len() > self.config.max_flows {
            let ratio = (self.config.watermark_ratio as f64).clamp(0.1, 0.95);
            let target = ((self.config.max_flows as f64) * ratio) as usize;
            stats.flows_evicted = self.evict_oldest_flows(target);
        }
        if self.config.max_sessions > 0 && self.sessions.len() > self.config.max_sessions {
            let ratio = (self.config.watermark_ratio as f64).clamp(0.1, 0.95);
            let target = ((self.config.max_sessions as f64) * ratio) as usize;
            stats.sessions_evicted = self.evict_oldest_sessions(target);
        }
        stats
    }

    /// Evict oldest flows down to target count.
    ///
    /// Eviction is an in-memory retention decision only: the durable mirror
    /// deliberately retains the full observed history, so dropping a flow from
    /// the recent window does not delete it from the database.
    pub fn evict_oldest_flows(&mut self, target_max: usize) -> usize {
        if self.flows.len() <= target_max {
            return 0;
        }
        let mut order: Vec<(u64, u64)> = self
            .flows
            .values()
            .map(|f| (f.first_ts.mono_nanos, f.id))
            .collect();
        order.sort_unstable();

        let to_remove = self.flows.len() - target_max;
        let mut evicted = 0;
        let mut removed_newest = false;
        let newest = self.latest_mono_cache;
        for (_, flow_id) in order {
            if evicted >= to_remove {
                break;
            }
            let is_ref = self.findings.values().any(|sf| {
                sf.finding
                    .evidence_refs
                    .iter()
                    .any(|r| matches!(r, EvidenceRef::Flow(id) if *id == flow_id))
            });
            if is_ref {
                for sf in self.findings.values_mut() {
                    if sf
                        .finding
                        .evidence_refs
                        .iter()
                        .any(|r| matches!(r, EvidenceRef::Flow(id) if *id == flow_id))
                    {
                        sf.evidence_expired = true;
                    }
                }
            }
            if let Some(removed) = self.flows.remove(&flow_id) {
                if removed.last_ts.mono_nanos == newest || removed.first_ts.mono_nanos == newest {
                    removed_newest = true;
                }
            }
            self.events_by_flow.remove(&flow_id);
            evicted += 1;
        }
        if removed_newest {
            self.recompute_latest_mono();
        }
        evicted
    }

    /// Evict oldest sessions down to target count.
    pub fn evict_oldest_sessions(&mut self, target_max: usize) -> usize {
        if self.sessions.len() <= target_max {
            return 0;
        }
        let mut order: Vec<(u64, u64)> = self
            .sessions
            .values()
            .map(|s| (s.start_ts.mono_nanos, s.id))
            .collect();
        order.sort_unstable();

        let to_remove = self.sessions.len() - target_max;
        let mut evicted = 0;
        for (_, session_id) in order {
            if evicted >= to_remove {
                break;
            }
            let is_ref = self.findings.values().any(|sf| {
                sf.finding
                    .evidence_refs
                    .iter()
                    .any(|r| matches!(r, EvidenceRef::Session(id) if *id == session_id))
            });
            if is_ref {
                for sf in self.findings.values_mut() {
                    if sf
                        .finding
                        .evidence_refs
                        .iter()
                        .any(|r| matches!(r, EvidenceRef::Session(id) if *id == session_id))
                    {
                        sf.evidence_expired = true;
                    }
                }
            }
            self.sessions.remove(&session_id);
            evicted += 1;
        }
        evicted
    }

    /// Trigger automatic eviction asynchronously.
    pub async fn auto_evict_if_needed_async(&mut self) -> EvictionStats {
        if !self.config.auto_evict || self.config.max_flows == 0 {
            return EvictionStats::default();
        }
        let mut stats = EvictionStats::default();
        if self.flows.len() > self.config.max_flows {
            let ratio = (self.config.watermark_ratio as f64).clamp(0.1, 0.95);
            let target = ((self.config.max_flows as f64) * ratio) as usize;
            stats.flows_evicted = self.evict_oldest_flows_async(target).await;
        }
        if self.config.max_sessions > 0 && self.sessions.len() > self.config.max_sessions {
            let ratio = (self.config.watermark_ratio as f64).clamp(0.1, 0.95);
            let target = ((self.config.max_sessions as f64) * ratio) as usize;
            stats.sessions_evicted = self.evict_oldest_sessions_async(target).await;
        }
        stats
    }

    /// Evict oldest flows down to target count asynchronously.
    ///
    /// Retention is an in-memory concern; the durable mirror keeps the full
    /// observed history (see [`CaptureStore::evict_oldest_flows`]). This shares
    /// one implementation with the synchronous path so the two can never drift.
    pub async fn evict_oldest_flows_async(&mut self, target_max: usize) -> usize {
        self.evict_oldest_flows(target_max)
    }

    /// Evict oldest sessions down to target count asynchronously.
    pub async fn evict_oldest_sessions_async(&mut self, target_max: usize) -> usize {
        self.evict_oldest_sessions(target_max)
    }

    /// Attempt to write packet payload bytes. Honors the payload policy
    ///rejected under `MetadataOnly`. Returns whether the
    /// bytes were accepted.
    #[must_use]
    pub fn try_write_payload(&mut self, _packet_ref: u64, _bytes: &[u8]) -> bool {
        match self.policy {
            PayloadPolicy::MetadataOnly => false,
            PayloadPolicy::Headers | PayloadPolicy::FullPayload => {
                self.payload_records += 1;
                true
            }
        }
    }

    /// How many payload records have been written (0 under MetadataOnly).
    pub fn payload_records(&self) -> u64 {
        self.payload_records
    }

    /// Validate that all evidence references in `finding` exist in `CaptureStore`.
    fn validate_evidence_refs(&self, finding: &Finding) -> netpulse_core::Result<()> {
        // Duplicate evidence references are permitted and represent multiple logical references to the same evidence.
        for r in &finding.evidence_refs {
            match r {
                EvidenceRef::Flow(id) => {
                    check_evidence_exists(finding.id, "Flow", *id, self.flows.contains_key(id))?;
                }
                EvidenceRef::Session(id) => {
                    check_evidence_exists(
                        finding.id,
                        "Session",
                        *id,
                        self.sessions.contains_key(id),
                    )?;
                }
                EvidenceRef::Packet(id) if *id == 0 => {
                    return Err(NpError::Invariant(format!(
                        "Finding \"{}\" references invalid Packet ID 0",
                        finding.id
                    )));
                }
                EvidenceRef::Packet(_) => {
                    // Packet IDs cannot currently be resolved to stored packet objects because
                    // CaptureStore operates in metadata-only mode. The runtime invariant
                    // therefore verifies only that the packet identifier is syntactically valid (non-zero).
                }
                _ => {}
            }
        }
        Ok(())
    }

    // ---- Async Query and Mutation surface ----

    pub async fn insert_flow_async(&mut self, flow: Flow, mut events: Vec<ProtoEvent>) {
        if self.config.max_events_per_flow > 0 && events.len() > self.config.max_events_per_flow {
            events.truncate(self.config.max_events_per_flow);
        }
        if !events.is_empty() {
            self.events_by_flow
                .entry(flow.id)
                .or_default()
                .extend(events.clone());
        }
        self.flows.insert(flow.id, flow.clone());
        let _ = self.repository.insert_flow(flow, events).await;
        self.auto_evict_if_needed();
    }

    pub async fn insert_session_async(&mut self, session: Session) {
        self.sessions.insert(session.id, session.clone());
        let _ = self.repository.insert_session(session).await;
    }

    pub async fn insert_host_async(&mut self, id: u64, host: Host) {
        self.hosts.insert(id, host.clone());
        let _ = self.repository.insert_host(id, host).await;
    }

    pub async fn set_resolution_async(&mut self, ip: IpAddr, names: Vec<HostName>) {
        if names.is_empty() {
            self.resolutions.remove(&ip);
        } else {
            self.resolutions.insert(ip, names.clone());
        }
        let _ = self.repository.set_resolution(ip, names).await;
    }

    pub async fn merge_resolution_async(&mut self, ip: IpAddr, names: Vec<HostName>) {
        if !names.is_empty() {
            let existing = self.resolutions.entry(ip).or_default();
            for n in &names {
                if !existing
                    .iter()
                    .any(|h| h.name == n.name && h.source == n.source)
                {
                    existing.push(n.clone());
                }
            }
            let _ = self.repository.merge_resolution(ip, names).await;
        }
    }

    pub async fn insert_finding_async(&mut self, finding: Finding) -> netpulse_core::Result<()> {
        self.validate_evidence_refs(&finding)?;
        self.repository
            .insert_finding(finding.clone())
            .await
            .map_err(|e| NpError::Storage(e.to_string()))?;
        self.findings.insert(
            finding.id,
            StoredFinding {
                finding,
                evidence_expired: false,
            },
        );
        Ok(())
    }

    /// Produce a canonical, deterministic, order-independent snapshot of all 6 runtime entities.
    pub fn snapshot(&self) -> CaptureStoreSnapshot {
        let mut flows: Vec<Flow> = self.flows.values().cloned().collect();
        flows.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));

        let mut sessions: Vec<Session> = self
            .sessions
            .values()
            .cloned()
            .map(|mut s| {
                s.flow_ids.sort_unstable();
                s
            })
            .collect();
        sessions.sort_by_key(|s| (s.start_ts.mono_nanos, s.id));

        let mut proto_events: Vec<ProtoEvent> = Vec::new();
        for evs in self.events_by_flow.values() {
            proto_events.extend(evs.iter().cloned());
        }
        proto_events.sort_by_key(|e| (e.ts.mono_nanos, e.flow_id));

        let mut hosts: Vec<(u64, Host)> =
            self.hosts.iter().map(|(&id, h)| (id, h.clone())).collect();
        hosts.sort_by_key(|(id, _)| *id);

        let mut resolutions: Vec<(IpAddr, Vec<HostName>)> = self
            .resolutions
            .iter()
            .map(|(&ip, names)| {
                let mut sorted_names = names.clone();
                sorted_names.sort_by(|a, b| a.name.cmp(&b.name));
                (ip, sorted_names)
            })
            .collect();
        resolutions.sort_by_key(|(ip, _)| *ip);

        let mut findings: Vec<StoredFinding> = self.findings.values().cloned().collect();
        findings.sort_by_key(|f| f.finding.id);

        CaptureStoreSnapshot {
            flows,
            sessions,
            proto_events,
            hosts,
            resolutions,
            findings,
        }
    }

    /// Idempotently load and hydrate all 6 data entities from the underlying repository into memory.
    /// Replaces previous in-memory state and verifies referential integrity.
    pub async fn load_from_repository(&mut self) -> Result<(), StorageError> {
        let snapshot = read_repository_snapshot(&self.repository).await?;
        self.apply_snapshot(snapshot)
    }

    /// Replace the in-memory state with `snapshot`, verifying referential
    /// integrity. The durable counterpart of [`CaptureStore::snapshot`], used to
    /// restore a previous session's reconstruction at startup.
    pub fn apply_snapshot(&mut self, snapshot: CaptureStoreSnapshot) -> Result<(), StorageError> {
        // 1. Clear existing in-memory state for idempotent load
        self.flows.clear();
        self.sessions.clear();
        self.events_by_flow.clear();
        self.hosts.clear();
        self.resolutions.clear();
        self.findings.clear();

        // 2. Populate flows
        for flow in snapshot.flows {
            self.flows.insert(flow.id, flow);
        }

        // 3. Populate proto events grouped by flow_id
        for event in snapshot.proto_events {
            self.events_by_flow
                .entry(event.flow_id)
                .or_default()
                .push(event);
        }
        for evs in self.events_by_flow.values_mut() {
            evs.sort_by_key(|e| e.ts.mono_nanos);
        }

        // 4. Populate sessions & verify referential integrity
        for session in snapshot.sessions {
            for &flow_id in &session.flow_ids {
                if !self.flows.contains_key(&flow_id) {
                    return Err(StorageError::IntegrityViolation {
                        reason: format!(
                            "Session {} references flow {} which is not present in flows",
                            session.id, flow_id
                        ),
                    });
                }
            }
            self.sessions.insert(session.id, session);
        }

        // 5. Populate hosts
        for (id, host) in snapshot.hosts {
            self.hosts.insert(id, host);
        }

        // 6. Populate resolutions
        self.resolutions = snapshot.resolutions.into_iter().collect();

        // 7. Populate findings
        for finding in snapshot.findings {
            self.findings.insert(finding.finding.id, finding);
        }

        self.recompute_latest_mono();
        Ok(())
    }
}

/// Read every persisted entity from `repo` into a canonical
/// [`CaptureStoreSnapshot`].
///
/// Free function (rather than a method) so callers that do not own a store —
/// notably the durable writer thread at startup — can hydrate from a repository
/// without materialising a second store just to read through it.
pub async fn read_repository_snapshot<R: CaptureRepository>(
    repo: &R,
) -> Result<CaptureStoreSnapshot, StorageError> {
    let mut flows = repo.all_flows().await?;
    flows.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));

    let mut sessions = repo.all_sessions().await?;
    for session in sessions.iter_mut() {
        session.flow_ids.sort_unstable();
    }
    sessions.sort_by_key(|s| (s.start_ts.mono_nanos, s.id));

    let mut proto_events = repo.all_proto_events().await?;
    proto_events.sort_by_key(|e| (e.ts.mono_nanos, e.flow_id));

    let mut hosts = repo.all_hosts().await?;
    hosts.sort_by_key(|(id, _)| *id);

    let resolutions = repo.resolutions().await?;
    let mut resolutions: Vec<(IpAddr, Vec<HostName>)> = resolutions.into_iter().collect();
    for (_, names) in resolutions.iter_mut() {
        names.sort_by(|a, b| a.name.cmp(&b.name));
    }
    resolutions.sort_by_key(|(ip, _)| *ip);

    let mut findings = repo.all_findings().await?;
    findings.sort_by_key(|f| f.finding.id);

    Ok(CaptureStoreSnapshot {
        flows,
        sessions,
        proto_events,
        hosts,
        resolutions,
        findings,
    })
}

impl CaptureStore<SqliteCaptureRepository> {
    /// Open SQLite database at `path`, run migrations and schema validation,
    /// construct CaptureStore, and hydrate all stored entities into memory.
    pub async fn open_sqlite<P: AsRef<Path>>(
        path: P,
        policy: PayloadPolicy,
    ) -> Result<Self, StorageError> {
        let repo = SqliteCaptureRepository::connect(path).await?;
        let mut store = Self::with_repository(policy, repo);
        store.load_from_repository().await?;
        Ok(store)
    }

    /// Ensure all pending writes are committed and trigger SQLite WAL checkpoint.
    pub async fn flush_async(&mut self) -> Result<(), StorageError> {
        sqlx::query("PRAGMA wal_checkpoint(PASSIVE);")
            .execute(self.repository.pool())
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{
        Confidence, EvidenceRef, FindingCategory, FlowMetrics, FlowState, Timestamp,
    };
    use std::net::{IpAddr, Ipv4Addr};

    fn flow(id: u64, ts: u64) -> Flow {
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        Flow {
            id,
            key: FiveTuple::new(ip, 1, ip, 2, L4Proto::Tcp),
            first_ts: Timestamp::new(ts, ts),
            last_ts: Timestamp::new(ts + 1, ts + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics::default(),
            state: FlowState::Closed,
        }
    }

    #[test]
    fn metadata_only_rejects_payload_writes() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        assert!(!store.try_write_payload(1, &[1, 2, 3]));
        assert_eq!(store.payload_records(), 0);
    }

    #[test]
    fn full_payload_mode_accepts_writes() {
        let mut store = CaptureStore::new(PayloadPolicy::FullPayload);
        assert!(store.try_write_payload(1, &[1, 2, 3]));
        assert_eq!(store.payload_records(), 1);
    }

    #[test]
    fn flows_for_session_resolves_ids() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(10, 100), vec![])
            .expect("store write");

        store
            .insert_flow(flow(11, 200), vec![])
            .expect("store write");

        store
            .insert_session(Session {
                id: 1,
                process_id: 0,
                start_ts: Timestamp::new(100, 100),
                trigger: "t".into(),
                flow_ids: vec![10, 11],
            })
            .expect("store write");
        assert_eq!(store.flows_for_session(1).len(), 2);
    }

    #[test]
    fn window_query_is_time_bounded_and_sorted() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(1, 300), vec![])
            .expect("store write");

        store
            .insert_flow(flow(2, 100), vec![])
            .expect("store write");

        store
            .insert_flow(flow(3, 500), vec![])
            .expect("store write");

        let ids: Vec<u64> = store.flows_in_window(0, 400).iter().map(|f| f.id).collect();
        assert_eq!(ids, vec![2, 1]); // 500 excluded, sorted by time
    }

    #[test]
    fn retention_respects_evidence_invariant() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(1, 100), vec![])
            .expect("store write"); // oldest
        store
            .insert_flow(flow(2, 200), vec![])
            .expect("store write");

        store
            .insert_flow(flow(3, 300), vec![])
            .expect("store write");

        // A finding references the oldest flow (id 1).
        store
            .insert_finding(Finding {
                id: 42,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.9),
                evidence_refs: vec![EvidenceRef::Flow(1)],
            })
            .expect("insert_finding");
        // Ask to shrink to 1 flow: it evicts 2 flows and marks evidence_expired = true for finding 42.
        store.evict_oldest_flows(1);
        assert_eq!(store.flow_count(), 1);
        assert!(store.finding(42).unwrap().evidence_expired);
        assert!(store.flow(1).is_none(), "referenced flow was aged out");
    }

    #[test]
    fn auto_eviction_bounds_flow_count() {
        let config = StorageConfig {
            max_flows: 10,
            max_sessions: 10,
            max_events_per_flow: 10,
            watermark_ratio: 0.5,
            auto_evict: true,
        };
        let mut store = CaptureStore::with_config(PayloadPolicy::MetadataOnly, config);
        for i in 1..=20 {
            store
                .insert_flow(flow(i, i * 10), vec![])
                .expect("store write");
        }
        // Exceeded 10 flows -> auto evicted down to 50% (5 flows) + inserted rest -> stays bounded below or at 10
        assert!(store.flow_count() <= 10);
    }

    #[test]
    fn session_eviction_removes_oldest_sessions() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        for i in 1..=5 {
            store
                .insert_session(Session {
                    id: i,
                    process_id: 100 + i,
                    start_ts: Timestamp::new(i * 100, i * 100),
                    trigger: "test".into(),
                    flow_ids: vec![],
                })
                .expect("store write");
        }
        assert_eq!(store.session_count(), 5);
        let evicted = store.evict_oldest_sessions(2);
        assert_eq!(evicted, 3);
        assert_eq!(store.session_count(), 2);
        assert!(store.session(1).is_none());
        assert!(store.session(4).is_some());
    }

    #[test]
    fn insert_finding_rejects_missing_flow_ref() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let err = store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.8),
                evidence_refs: vec![EvidenceRef::Flow(101)],
            })
            .expect_err("should fail");
        assert_eq!(
            err.to_string(),
            "invariant violated: Finding \"303\" references missing FlowId(101)"
        );
    }

    #[test]
    fn insert_finding_rejects_missing_session_ref() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let err = store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.8),
                evidence_refs: vec![EvidenceRef::Session(202)],
            })
            .expect_err("should fail");
        assert_eq!(
            err.to_string(),
            "invariant violated: Finding \"303\" references missing SessionId(202)"
        );
    }

    #[test]
    fn insert_finding_rejects_zero_packet_id() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let err = store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.8),
                evidence_refs: vec![EvidenceRef::Packet(0)],
            })
            .expect_err("should fail");
        assert_eq!(
            err.to_string(),
            "invariant violated: Finding \"303\" references invalid Packet ID 0"
        );
    }

    #[test]
    fn insert_finding_accepts_empty_evidence_list() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Informational,
                confidence: Confidence::new(1.0),
                evidence_refs: vec![],
            })
            .expect("empty evidence_refs is allowed");
        assert!(store.finding(303).is_some());
    }

    #[test]
    fn insert_finding_rejects_partially_invalid_refs() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(101, 100), vec![])
            .expect("store write");

        let err = store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.85),
                evidence_refs: vec![EvidenceRef::Flow(101), EvidenceRef::Session(999)],
            })
            .expect_err("partially invalid should fail");
        assert_eq!(
            err.to_string(),
            "invariant violated: Finding \"303\" references missing SessionId(999)"
        );
    }

    #[test]
    fn insert_finding_accepts_multiple_valid_refs() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(101, 100), vec![])
            .expect("store write");

        store
            .insert_session(Session {
                id: 202,
                process_id: 1,
                start_ts: Timestamp::new(100, 100),
                trigger: "test".into(),
                flow_ids: vec![101],
            })
            .expect("store write");
        store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.9),
                evidence_refs: vec![
                    EvidenceRef::Flow(101),
                    EvidenceRef::Session(202),
                    EvidenceRef::Packet(5),
                ],
            })
            .expect("valid refs succeed");
        assert!(store.finding(303).is_some());
    }

    #[test]
    fn insert_finding_accepts_duplicate_valid_refs() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store
            .insert_flow(flow(101, 100), vec![])
            .expect("store write");

        store
            .insert_finding(Finding {
                id: 303,
                category: FindingCategory::Suspicious,
                confidence: Confidence::new(0.9),
                evidence_refs: vec![EvidenceRef::Flow(101), EvidenceRef::Flow(101)],
            })
            .expect("duplicate valid refs succeed");
        assert!(store.finding(303).is_some());
    }

    #[test]
    fn insert_finding_atomic_on_failure() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        assert!(store.finding(303).is_none());
        let res = store.insert_finding(Finding {
            id: 303,
            category: FindingCategory::Suspicious,
            confidence: Confidence::new(0.8),
            evidence_refs: vec![EvidenceRef::Flow(999)],
        });
        assert!(res.is_err());
        assert!(store.finding(303).is_none());
    }

    #[tokio::test]
    async fn test_sqlite_hydration_and_restart_snapshot_equality() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("restart_test.db");

        let mut store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
            .await
            .unwrap();

        let flow1 = flow(101, 100);
        let event1 = ProtoEvent {
            flow_id: 101,
            ts: Timestamp::new(105, 105),
            kind: netpulse_core::ProtoEventKind::DnsQuery,
        };
        store.insert_flow_async(flow1, vec![event1]).await;

        let flow2 = flow(102, 120);
        store.insert_flow_async(flow2, vec![]).await;

        let session = Session {
            id: 201,
            process_id: 555,
            start_ts: Timestamp::new(100, 100),
            trigger: "test_session".into(),
            flow_ids: vec![101, 102],
        };
        store.insert_session_async(session).await;

        let host = Host {
            ip: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            names: vec!["example.com".into()],
            geo: Some("US".into()),
            asn: Some(15133),
            org: Some("EDGECAST".into()),
        };
        store.insert_host_async(1, host).await;

        store
            .set_resolution_async(
                IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
                vec![HostName {
                    name: "example.com".into(),
                    source: netpulse_core::NameSource::Dns,
                }],
            )
            .await;

        let finding = Finding {
            id: 301,
            category: FindingCategory::Suspicious,
            confidence: Confidence::new(0.95),
            evidence_refs: vec![EvidenceRef::Flow(101), EvidenceRef::Session(201)],
        };
        store.insert_finding_async(finding).await.unwrap();

        store.flush_async().await.unwrap();
        let before_snapshot = store.snapshot();

        drop(store);

        // Re-open fresh CaptureStore from SQLite database
        let mut reloaded_store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
            .await
            .unwrap();
        let after_snapshot = reloaded_store.snapshot();

        assert_eq!(before_snapshot, after_snapshot);

        // Test idempotent hydration: reloading multiple times produces identical state
        reloaded_store.load_from_repository().await.unwrap();
        let idempotent_snapshot = reloaded_store.snapshot();
        assert_eq!(after_snapshot, idempotent_snapshot);
    }

    #[tokio::test]
    async fn test_hydration_referential_integrity_violation() {
        let memory_repo = MemoryCaptureStore::new();
        // Insert session 999 that references non-existent flow 888
        memory_repo
            .insert_session_sync(Session {
                id: 999,
                process_id: 1,
                start_ts: Timestamp::new(100, 100),
                trigger: "corrupt".into(),
                flow_ids: vec![888],
            })
            .unwrap();

        let mut store = CaptureStore::with_repository(PayloadPolicy::MetadataOnly, memory_repo);
        let res = store.load_from_repository().await;
        assert!(res.is_err());
        match res.unwrap_err() {
            StorageError::IntegrityViolation { reason } => {
                assert!(reason.contains("Session 999 references flow 888"));
            }
            other => panic!("Expected IntegrityViolation, got {:?}", other),
        }
    }
}
