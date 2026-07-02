//! The Phase 4 intelligence presentation (docs/17–20): the read-only projection
//! of a committed capture into the security findings and grounded AI answers the
//! UI shows. Like the Phase 2/3 projections ([`crate::pipeline::present`],
//! [`crate::education::present_education`]), this is a pure *view* over the store
//! (docs/11 §14): it runs off the hot path (docs/17 §10), gathers the committed
//! reconstruction, and hands the intelligence engines (`netpulse-intel`,
//! `netpulse-ai`) exactly the slices they need — capturing, parsing, and storing
//! nothing (docs/17 §6, observe-only docs/01 X1).
//!
//! Attribution is honestly absent in this build: no live [`SocketTableSource`]
//! (docs/12 §4 stub) is wired, so the process map handed to the detectors is
//! empty and the attribution-dependent detector (unexpected unsigned egress,
//! docs/18 §4.1) stays silent rather than blaming the wrong app (docs/12 §8).
//! When a live socket source lands, feeding a populated map here is the only
//! change needed — the detectors already read it.

use std::collections::HashMap;

use netpulse_ai::Assistant;
use netpulse_api::dto::{AssistantAnswerDto, SecurityFindingDto};
use netpulse_core::{Depth, Flow, Process, ProtoEvent};
use netpulse_intel::{assess, TrafficView};
use netpulse_storage::CaptureStore;

use crate::project;

/// Assess a window of committed traffic and project the corroborated, ranked
/// findings to their wire DTOs at `depth` (docs/17 §6). Most-confident first; an
/// empty result is the honest "nothing looks unusual" (docs/17), never a
/// fabricated alarm.
pub fn present_security(
    store: &CaptureStore,
    from_mono_nanos: u64,
    to_mono_nanos: u64,
    depth: Depth,
) -> Vec<SecurityFindingDto> {
    // Own the flow/event clones so the borrowed view can reference them while the
    // engine runs (same pattern as the other projections, docs/04 §3.6).
    let flows: Vec<Flow> = store
        .flows_in_window(from_mono_nanos, to_mono_nanos)
        .into_iter()
        .cloned()
        .collect();
    let mut events: Vec<ProtoEvent> = Vec::new();
    for f in &flows {
        events.extend(store.events_for_flow(f.id).iter().cloned());
    }

    // No live socket source in this build → no attribution (docs/12 §4, §8).
    let process_of: HashMap<u64, Process> = HashMap::new();
    let view = TrafficView {
        flows: &flows,
        events: &events,
        process_of: &process_of,
    };

    assess(&view)
        .iter()
        .map(|f| project::security_finding_dto(f, depth))
        .collect()
}

/// Answer a natural-language question grounded in the committed capture (docs/19).
/// Uses the local-default assistant — zero egress (docs/19 §4.1) — and projects
/// the grounded, cited answer to its wire DTO.
pub fn ask_assistant(store: &CaptureStore, question: &str) -> AssistantAnswerDto {
    let answer = Assistant::local().answer(store, question);
    project::assistant_answer_dto(&answer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{FlowMetrics, FlowState, Session, Timestamp};
    use netpulse_storage::PayloadPolicy;
    use std::net::{IpAddr, Ipv4Addr};

    fn beacon_flow(id: u64, start_ns: u64) -> Flow {
        let dst = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 20));
        Flow {
            id,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 0, 3)),
                50000,
                dst,
                443,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(start_ns, start_ns),
            last_ts: Timestamp::new(start_ns + 1, start_ns + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes: 200,
                packets: 4,
                rtt_estimate_nanos: None,
                loss_indicators: 0,
                retransmits: 0,
            },
            state: FlowState::Closed,
        }
    }

    fn seeded_store() -> CaptureStore {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        for i in 0..5 {
            store.insert_flow(beacon_flow(i, i * 60_000_000_000), vec![]);
        }
        store.insert_session(Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(0, 0),
            trigger: "beacon".into(),
            flow_ids: (0..5).collect(),
        });
        store
    }

    #[test]
    fn present_security_surfaces_a_grounded_finding() {
        let store = seeded_store();
        let findings = present_security(&store, 0, u64::MAX, Depth::Beginner);
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(
            f.title,
            "An app is contacting one server on a regular schedule"
        );
        assert!(f.confidence_percent < 100); // never certainty (docs/17 §5)
        assert!(!f.evidence.is_empty()); // auditable (docs/02 §6.3)
        assert!(!f.benign_explanations.is_empty()); // names innocence (docs/18 §3)
    }

    #[test]
    fn quiet_capture_yields_no_findings() {
        // A single ordinary flow → nothing unusual, no fabrication (docs/17).
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.insert_flow(beacon_flow(1, 0), vec![]);
        assert!(present_security(&store, 0, u64::MAX, Depth::Beginner).is_empty());
    }

    #[test]
    fn assistant_answers_grounded_and_local() {
        let store = seeded_store();
        let a = ask_assistant(&store, "which host did I talk to the most?");
        assert!(!a.is_remote); // local-default (docs/19 §4.1)
        assert_eq!(a.backend_id, "local-template");
        assert!(a.disclosure.contains("No packet payloads"));
    }
}
