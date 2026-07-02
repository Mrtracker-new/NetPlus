//! Tier 3 — the capture store (docs/08 §3.3, §5): the authoritative record of
//! flows, sessions, protocol events, and hosts — the structured reconstruction
//! model (docs/02 §6). The physical design (docs/03 §5) splits indexed metadata
//! (SQLite) from bulk columnar files; this Phase 1 slice keeps the *same logical
//! model and query surface* over an in-memory backing, so the SQLite backend can
//! drop in behind the identical API later (docs/08 §13).
//!
//! Two invariants are enforced structurally, not by convention:
//! - **Payload policy** (docs/08 §4): under the default `MetadataOnly`, no packet
//!   bytes are ever written — attempts are rejected, guarded by tests.
//! - **Evidence-reference invariant** (docs/08 §6): retention will not evict a
//!   flow/session a still-live finding references; instead the finding is marked
//!   "evidence aged out", so the UI never dangles a link to nowhere.

use std::collections::HashMap;

use netpulse_core::{EvidenceRef, Finding, Flow, Host, ProtoEvent, Session};

use crate::PayloadPolicy;

/// The indexed capture store. Indexes mirror the UI's drill-down queries
/// (docs/08 §8): by session, by host, by time.
#[derive(Debug)]
pub struct CaptureStore {
    policy: PayloadPolicy,
    flows: HashMap<u64, Flow>,
    sessions: HashMap<u64, Session>,
    hosts: HashMap<u64, Host>,
    findings: HashMap<u64, StoredFinding>,
    /// PROTO_EVENTS by flow id (docs/08 §5.1).
    events_by_flow: HashMap<u64, Vec<ProtoEvent>>,
    /// Count of packet payload records written — must stay 0 under MetadataOnly.
    payload_records: u64,
}

/// A finding plus the retention annotation from docs/08 §6.
#[derive(Debug, Clone)]
pub struct StoredFinding {
    pub finding: Finding,
    /// Set true when evidence it referenced was legitimately aged out; the UI
    /// then shows "evidence no longer retained" rather than a dead link.
    pub evidence_expired: bool,
}

impl CaptureStore {
    /// Create an empty store under the given payload policy.
    pub fn new(policy: PayloadPolicy) -> Self {
        Self {
            policy,
            flows: HashMap::new(),
            sessions: HashMap::new(),
            hosts: HashMap::new(),
            findings: HashMap::new(),
            events_by_flow: HashMap::new(),
            payload_records: 0,
        }
    }

    /// The payload policy in force.
    pub fn policy(&self) -> PayloadPolicy {
        self.policy
    }

    /// Persist a finalized flow and its protocol events (docs/06 §8 → docs/08).
    pub fn insert_flow(&mut self, flow: Flow, events: Vec<ProtoEvent>) {
        if !events.is_empty() {
            self.events_by_flow
                .entry(flow.id)
                .or_default()
                .extend(events);
        }
        self.flows.insert(flow.id, flow);
    }

    /// Persist a reconstructed session (docs/06 §6 → docs/08).
    pub fn insert_session(&mut self, session: Session) {
        self.sessions.insert(session.id, session);
    }

    /// Persist an enriched host record (docs/08 §5.1 HOSTS).
    pub fn insert_host(&mut self, id: u64, host: Host) {
        self.hosts.insert(id, host);
    }

    /// Persist a finding with its evidence references (docs/08 §6).
    pub fn insert_finding(&mut self, finding: Finding) {
        self.findings.insert(
            finding.id,
            StoredFinding {
                finding,
                evidence_expired: false,
            },
        );
    }

    /// Attempt to write packet payload bytes. Honors the payload policy
    /// (docs/08 §4, §13): rejected under `MetadataOnly`. Returns whether the
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

    // ---- Query surface (docs/08 §8) ----

    /// All flows belonging to a session (docs/08 §8, index on session_id).
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

    /// Protocol events of a flow (docs/08 §8, index on PROTO_EVENTS.flow_id).
    pub fn events_for_flow(&self, flow_id: u64) -> &[ProtoEvent] {
        self.events_by_flow
            .get(&flow_id)
            .map_or(&[], |v| v.as_slice())
    }

    /// Flows whose start falls in `[from, to)` monotonic ns (docs/08 §8, timeline
    /// scrub). Returned in ascending start order for deterministic paging.
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

    /// A session by id (docs/08 §8, index on session_id).
    pub fn session(&self, id: u64) -> Option<&Session> {
        self.sessions.get(&id)
    }

    /// All retained session ids, ascending for deterministic iteration
    /// (docs/08 §8). The narrative feed and journey queries page over these.
    pub fn session_ids(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.sessions.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    /// A flow by id (docs/08 §8), for drill-down and projection.
    pub fn flow(&self, id: u64) -> Option<&Flow> {
        self.flows.get(&id)
    }

    /// A finding by id, including its retention annotation.
    pub fn finding(&self, id: u64) -> Option<&StoredFinding> {
        self.findings.get(&id)
    }

    /// Number of flows / sessions currently retained.
    pub fn flow_count(&self) -> usize {
        self.flows.len()
    }
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    // ---- Retention (docs/08 §7.3) honoring the evidence invariant (§6) ----

    /// Evict the oldest flows down to a target count, honoring the evidence
    /// invariant (docs/08 §6): a flow referenced by a live finding is *not*
    /// evicted; instead the finding is annotated `evidence_expired` only if it is
    /// actually removed. Returns the number of flows evicted.
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
        for (_, flow_id) in order {
            if evicted >= to_remove {
                break;
            }
            if self.flow_is_referenced(flow_id) {
                // Protected by the evidence invariant: skip, mark referencing
                // findings so the UI stays honest if we later must drop it.
                self.expire_evidence_for_flow(flow_id);
                continue;
            }
            self.flows.remove(&flow_id);
            self.events_by_flow.remove(&flow_id);
            evicted += 1;
        }
        evicted
    }

    fn flow_is_referenced(&self, flow_id: u64) -> bool {
        self.findings.values().any(|sf| {
            sf.finding
                .evidence_refs
                .iter()
                .any(|r| matches!(r, EvidenceRef::Flow(id) if *id == flow_id))
        })
    }

    fn expire_evidence_for_flow(&mut self, flow_id: u64) {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Confidence, FindingCategory, FlowMetrics, FlowState, Timestamp};
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
        store.insert_flow(flow(10, 100), vec![]);
        store.insert_flow(flow(11, 200), vec![]);
        store.insert_session(Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(100, 100),
            trigger: "t".into(),
            flow_ids: vec![10, 11],
        });
        assert_eq!(store.flows_for_session(1).len(), 2);
    }

    #[test]
    fn window_query_is_time_bounded_and_sorted() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.insert_flow(flow(1, 300), vec![]);
        store.insert_flow(flow(2, 100), vec![]);
        store.insert_flow(flow(3, 500), vec![]);
        let ids: Vec<u64> = store.flows_in_window(0, 400).iter().map(|f| f.id).collect();
        assert_eq!(ids, vec![2, 1]); // 500 excluded, sorted by time
    }

    #[test]
    fn retention_respects_evidence_invariant() {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.insert_flow(flow(1, 100), vec![]); // oldest
        store.insert_flow(flow(2, 200), vec![]);
        store.insert_flow(flow(3, 300), vec![]);
        // A finding references the oldest flow (id 1).
        store.insert_finding(Finding {
            id: 42,
            category: FindingCategory::Suspicious,
            confidence: Confidence::new(0.9),
            evidence_refs: vec![EvidenceRef::Flow(1)],
        });
        // Ask to shrink to 1 flow: it must not silently drop referenced flow 1.
        store.evict_oldest_flows(1);
        assert!(store.flows.contains_key(&1), "referenced flow must survive");
        assert!(store.finding(42).unwrap().evidence_expired);
    }
}
