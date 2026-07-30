//! # netpulse-intel — security + anomaly (Phase 4)
//!
//! The reasoning layer: it surfaces *suspicious behaviour* with explicit
//! confidence and evidence, and **never** an unqualified malware verdict
//! (docs/17, docs/01 X4). Three parts under one finding framework:
//!
//! - **Security Engine** (docs/17): the [`SecurityFinding`] model whose structure
//!   encodes the honesty guarantees, and the [`assess`] assembler that unifies
//!   the two reasoning styles and corroborates their signals (docs/17 §6).
//! - **Threat detectors** (docs/18): [`rules`] — the named rule/heuristic shapes
//!   (beaconing, port scan, unexpected egress, DNS bursts, connection storms),
//!   each carrying its benign explanations (docs/18 §3).
//! - **Anomaly detection** (docs/20): [`anomaly`] — learning this machine's
//!   *normal* with an interpretable statistical floor and flagging deviation
//!   with maturity-aware confidence (docs/20 §4.1, §6).
//!
//! Everything runs **off the hot path** (docs/02 §5.2): it reads committed data
//! through a [`TrafficView`] and emits findings; it captures, parses, and stores
//! nothing, and it can never alter traffic (observe-only, docs/01 X1). Honesty is
//! structural — a [`SecurityFinding`] is un-constructible without evidence and an
//! explanation, and its confidence is capped below certainty (docs/17 §4, §5).
#![forbid(unsafe_code)]

pub use netpulse_core::traits::Detector;

pub mod anomaly;
pub mod app_profile;
pub mod behavioral_chain;
pub mod engine;
pub mod explainable_ml;
pub mod finding;
pub mod incident_timeline;
pub mod rules;
pub mod stix;
pub mod view;

pub use anomaly::{Baseline, Maturity};
pub use app_profile::{AppProfileStore, ConfiguredPolicy, ObservedProfile, ProfileViolation};
pub use behavioral_chain::{BehavioralChainEngine, ChainRule, ChainStage};
pub use engine::assess;
pub use explainable_ml::{FeatureAttribution, FeatureKind, FeatureWeight, MlAnomalyDetector};
pub use finding::{qualitative, FindingKind, SecurityFinding, MAX_INFERRED_CONFIDENCE};
pub use incident_timeline::{IncidentSeverity, IncidentStitcher, IncidentTimeline, TimelineNode};
pub use stix::{StixIndicator, StixThreatFeed, ThreatCategory};
pub use view::TrafficView;

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Flow, FlowMetrics, FlowState, Timestamp};
    use std::collections::HashMap;
    use std::net::{IpAddr, Ipv4Addr};

    /// End-to-end: a beacon in real-looking flows produces exactly one grounded,
    /// confidence-scored finding — proving the whole layer links (docs/17 §6).
    #[test]
    fn assess_links_the_whole_layer() {
        let h = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 7));
        let flows: Vec<Flow> = (0..5)
            .map(|i| Flow {
                id: i,
                key: FiveTuple::new(
                    IpAddr::V4(Ipv4Addr::new(192, 168, 0, 5)),
                    50000,
                    h,
                    443,
                    L4Proto::Tcp,
                ),
                first_ts: Timestamp::new(i * 60_000_000_000, i * 60_000_000_000),
                last_ts: Timestamp::new(i * 60_000_000_000 + 1, i * 60_000_000_000 + 1),
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
            })
            .collect();
        let procs = HashMap::new();
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };
        let found = assess(&view);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, FindingKind::Beaconing);
        assert!(!found[0].evidence.is_empty());
    }
}
