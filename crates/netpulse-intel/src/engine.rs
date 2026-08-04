//! The Security Engine assembler (docs/17 §6): it unifies the two reasoning
//! styles — named rules (docs/18) and deviation-from-normal (docs/20) — under one
//! finding framework, then *corroborates* related signals into single coherent
//! findings before ranking them (docs/18 §5).
//!
//! Corroboration is the anti-fatigue mechanism (docs/17 §7.2): three weak signals
//! about the same host ("new unsigned app" + "beaconing" + "odd volume") become
//! *one* higher-confidence finding that tells a clearer story, rather than three
//! noisy cards. Multiple *independent* signals raise confidence honestly (a
//! noisy-OR combination), and the merged explanation lists every contributing
//! signal — so the raise is auditable, never a black box (docs/17 §5).
//!
//! Everything runs off the hot path on committed data (docs/02 §5.2): assessing
//! traffic never back-pressures capture and cannot alter it (observe-only,
//! docs/01 X1).

use std::collections::BTreeMap;
use std::net::IpAddr;

use netpulse_core::{Confidence, EvidenceRef};

use crate::anomaly;
use crate::app_profile::AppProfileStore;
use crate::behavioral_chain::BehavioralChainEngine;
use crate::explainable_ml;
use crate::finding::{FindingKind, SecurityFinding, MAX_INFERRED_CONFIDENCE};
use crate::rules;
use crate::stix::StixThreatFeed;
use crate::view::TrafficView;

/// Assess a window of committed traffic and return the corroborated, ranked
/// findings (docs/17 §6). Most-confident first; an empty result is the honest
/// "nothing looks unusual" (docs/17, never a fabricated alarm).
pub fn assess(view: &TrafficView) -> Vec<SecurityFinding> {
    // 1. Statistical detectors (rules)
    let mut findings = rules::detect_all(view);

    // 2. Application profile evaluation
    let app_store = AppProfileStore::new();
    findings.extend(app_store.evaluate(view));

    // 3. Threat intelligence offline matching
    let feed = StixThreatFeed::new();
    findings.extend(feed.match_traffic(view));

    // 4. ML feature attribution & statistical bandwidth anomaly
    findings.extend(anomaly::bandwidth_anomaly(view));
    findings.extend(explainable_ml::detect_ml_anomalies(view));

    // 5. Corroborate signals concerning the same host (docs/18 §5)
    let mut merged = corroborate(view, findings);

    // 6. Behavioral chain detection (consumes corroborated findings)
    let chain_engine = BehavioralChainEngine::new();
    let chains = chain_engine.detect_chains(&merged);
    merged.extend(chains);

    // 7. Rank most-confident first; stable so ties keep insertion order.
    merged.sort_by(|a, b| {
        b.confidence
            .value()
            .partial_cmp(&a.confidence.value())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged
}

/// The destination host a finding is "about": the dst IP of its first evidence
/// flow. Findings in this catalog are per-host, so this groups them correctly for
/// corroboration without threading host context through every detector.
fn host_of(view: &TrafficView, finding: &SecurityFinding) -> Option<IpAddr> {
    finding.evidence.iter().find_map(|e| match e {
        EvidenceRef::Flow(id) => view
            .flows
            .iter()
            .find(|f| f.id == *id)
            .map(|f| f.key.dst_ip),
        _ => None,
    })
}

/// Merge findings that concern the same host into one coherent, higher-confidence
/// finding (docs/18 §5). A single finding for a host passes through unchanged;
/// two or more of *different* kinds combine.
fn corroborate(view: &TrafficView, findings: Vec<SecurityFinding>) -> Vec<SecurityFinding> {
    // Group by host; findings with no resolvable host (e.g. a DNS-volume finding
    // spanning many hosts) pass through standalone.
    let mut by_host: BTreeMap<IpAddr, Vec<SecurityFinding>> = BTreeMap::new();
    let mut standalone: Vec<SecurityFinding> = Vec::new();
    for f in findings {
        match host_of(view, &f) {
            Some(h) => by_host.entry(h).or_default().push(f),
            None => standalone.push(f),
        }
    }

    let mut out = standalone;
    for (host, group) in by_host {
        if group.len() == 1 {
            if let Some(single) = group.into_iter().next() {
                out.push(single);
            }
            continue;
        }
        // Distinct kinds only corroborate; duplicate kinds for one host would be a
        // detector firing twice, which we also fold together.
        let distinct_kinds: Vec<FindingKind> = {
            let mut ks: Vec<FindingKind> = group.iter().map(|f| f.kind).collect();
            ks.dedup();
            ks
        };
        if distinct_kinds.len() < 2 {
            // Same kind repeated → keep the strongest single card.
            let best = group
                .into_iter()
                .max_by(|a, b| a.confidence.value().total_cmp(&b.confidence.value()));
            if let Some(best_finding) = best {
                out.push(best_finding);
            }
            continue;
        }
        out.push(merge_group(host, group));
    }
    out
}

/// Combine a group of same-host findings into one (docs/18 §5). Independent
/// signals raise confidence via noisy-OR (`1 - Π(1 - cᵢ)`), capped below
/// certainty (docs/17 §5, docs/01 X4). The primary kind is the most-confident;
/// the rest are recorded as `contributing`, and the explanation lists them all.
fn merge_group(host: IpAddr, mut group: Vec<SecurityFinding>) -> SecurityFinding {
    group.sort_by(|a, b| {
        b.confidence
            .value()
            .partial_cmp(&a.confidence.value())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Noisy-OR over independent signal confidences.
    let combined = 1.0
        - group
            .iter()
            .fold(1.0_f32, |acc, f| acc * (1.0 - f.confidence.value()));
    let combined = combined.min(MAX_INFERRED_CONFIDENCE);

    let primary = &group[0];
    let contributing: Vec<FindingKind> = group[1..].iter().map(|f| f.kind).collect();

    // Union evidence, de-duplicated, keeping order.
    let mut evidence: Vec<EvidenceRef> = Vec::new();
    for f in &group {
        for e in &f.evidence {
            if !evidence.contains(e) {
                evidence.push(*e);
            }
        }
    }

    // A combined explanation that names each contributing signal (docs/17 §5:
    // the raise is auditable). Reads as a clearer single story (docs/18 §5).
    let signals: Vec<&str> = group.iter().map(|f| f.kind.title()).collect();
    let explanation = format!(
        "Several signals point at {host} together: {}. Independently each is mild, but seeing \
         them at once makes the pattern more notable. Here is the strongest reason: {}",
        signals.join("; "),
        primary.explanation,
    );

    SecurityFinding {
        kind: primary.kind,
        confidence: Confidence::new(combined),
        explanation,
        technical: primary.technical.clone(),
        evidence,
        contributing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Flow, FlowMetrics, FlowState, Process, Timestamp};
    use std::collections::HashMap;
    use std::net::Ipv4Addr;

    fn host(d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, d))
    }

    fn flow(id: u64, dst: IpAddr, start_ns: u64, bytes: u64) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
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
                bytes,
                packets: 4,
                rtt_estimate_nanos: None,
                loss_indicators: 0,
                retransmits: 0,
            },
            state: FlowState::Closed,
        }
    }

    #[test]
    fn healthy_traffic_yields_no_findings() {
        // A couple of ordinary flows → nothing unusual, no fabrication (docs/17).
        let procs = HashMap::new();
        let flows = vec![flow(1, host(1), 0, 1000), flow(2, host(2), 1000, 1200)];
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };
        assert!(assess(&view).is_empty());
    }

    #[test]
    fn beaconing_and_unsigned_egress_corroborate_into_one() {
        // Same host: a steady beacon AND an unsigned app behind it → merged into a
        // single, more-confident finding listing both signals (docs/18 §5).
        let h = host(9);
        let flows: Vec<Flow> = (0..5)
            .map(|i| flow(i, h, i * 60_000_000_000, 200))
            .collect();
        let mut procs = HashMap::new();
        for i in 0..5 {
            procs.insert(
                i,
                Process {
                    pid: 777,
                    name: "agent.bin".into(),
                    exe_path: "/tmp/agent.bin".into(),
                    signer: None, // unsigned
                    start_mono_nanos: 0,
                },
            );
        }
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };
        let found = assess(&view);
        // One merged finding, not two noisy ones.
        assert_eq!(found.len(), 1, "same-host signals corroborate into one");
        let f = &found[0];
        assert!(
            !f.contributing.is_empty(),
            "records the corroborating signal"
        );
        // Combined confidence exceeds either signal alone (noisy-OR), still < 1.
        assert!(f.confidence.value() > 0.45);
        assert!(f.confidence.value() < 1.0);
        assert!(f.explanation.contains("Several signals"));
    }

    #[test]
    fn ranked_most_confident_first() {
        // Two independent hosts, each with a lone beacon of differing strength.
        let strong: Vec<Flow> = (0..9)
            .map(|i| flow(i, host(1), i * 60_000_000_000, 200))
            .collect();
        let weak: Vec<Flow> = (0..4)
            .map(|i| flow(100 + i, host(2), i * 60_000_000_000, 200))
            .collect();
        let mut flows = strong;
        flows.extend(weak);
        let procs = HashMap::new();
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };
        let found = assess(&view);
        assert!(found.len() >= 2);
        // Sorted descending by confidence.
        for w in found.windows(2) {
            assert!(w[0].confidence.value() >= w[1].confidence.value());
        }
    }
}
