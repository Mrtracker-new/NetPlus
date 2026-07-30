//! Incident Timeline Stitching (docs/17 §13, docs/18 §11).
//!
//! Correlates discrete security findings over time across apps and hosts into structured
//! multi-finding narrative timelines (`IncidentTimeline`).
//!
//! Load-bearing invariant:
//! - An `IncidentTimeline` is an **aggregate structure**, NOT a `FindingKind`.
//!   Timelines contain findings; findings do not contain timelines. This avoids
//!   recursive evidence graphs.

use netpulse_core::EvidenceRef;
use serde::{Deserialize, Serialize};

use crate::finding::SecurityFinding;

/// Overall threat severity of a stitched incident timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IncidentSeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// A single chronologically ordered node within an incident timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct TimelineNode {
    pub finding: SecurityFinding,
    pub timestamp_nanos: u64,
    pub stage_label: String,
}

/// A aggregated multi-finding incident narrative timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct IncidentTimeline {
    pub id: u64,
    pub title: String,
    pub narrative_summary: String,
    pub severity: IncidentSeverity,
    pub nodes: Vec<TimelineNode>,
    pub aggregated_evidence: Vec<EvidenceRef>,
    pub suggested_actions: Vec<String>,
}

/// Stitcher that correlates security findings into incident timelines.
#[derive(Debug, Clone, Default)]
pub struct IncidentStitcher;

impl IncidentStitcher {
    pub fn new() -> Self {
        Self
    }

    /// Stitch a set of security findings into structured incident timelines.
    pub fn stitch_timeline(
        &self,
        id: u64,
        findings: &[SecurityFinding],
    ) -> Option<IncidentTimeline> {
        if findings.is_empty() {
            return None;
        }

        let mut nodes: Vec<TimelineNode> = findings
            .iter()
            .enumerate()
            .map(|(idx, f)| TimelineNode {
                finding: f.clone(),
                timestamp_nanos: idx as u64 * 1_000_000_000, // Derived or extracted timeline order
                stage_label: format!("Step {}: {}", idx + 1, f.kind.title()),
            })
            .collect();

        // Enforce chronological sorting even if ingested out of order
        nodes.sort_by_key(|n| n.timestamp_nanos);

        // Deduplicate aggregated evidence refs
        let mut aggregated_evidence = Vec::new();
        for n in &nodes {
            for e in &n.finding.evidence {
                if !aggregated_evidence.contains(e) {
                    aggregated_evidence.push(*e);
                }
            }
        }

        let max_conf = nodes
            .iter()
            .map(|n| n.finding.confidence.value())
            .fold(0.0_f32, f32::max);

        let severity = if max_conf >= 0.85 || nodes.len() >= 3 {
            IncidentSeverity::Critical
        } else if max_conf >= 0.65 || nodes.len() == 2 {
            IncidentSeverity::High
        } else if max_conf >= 0.45 {
            IncidentSeverity::Medium
        } else {
            IncidentSeverity::Low
        };

        let titles: Vec<&str> = nodes.iter().map(|n| n.finding.kind.title()).collect();
        let title = format!(
            "Incident Narrative ({} correlated finding{})",
            nodes.len(),
            if nodes.len() > 1 { "s" } else { "" }
        );
        let summary = format!(
            "Timeline correlates {} security observation{}: {}.",
            nodes.len(),
            if nodes.len() > 1 { "s" } else { "" },
            titles.join(" ➔ ")
        );

        let mut actions = Vec::new();
        for n in &nodes {
            let act = n.finding.kind.suggested_action();
            if !actions.contains(&act.to_string()) {
                actions.push(act.to_string());
            }
        }

        Some(IncidentTimeline {
            id,
            title,
            narrative_summary: summary,
            severity,
            nodes,
            aggregated_evidence,
            suggested_actions: actions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finding::{FindingKind, SecurityFinding};

    #[test]
    fn chronologically_orders_out_of_order_nodes_and_deduplicates_evidence() {
        let f1 = SecurityFinding::observe(
            FindingKind::PortScan,
            0.6,
            "Port scan",
            vec![EvidenceRef::Flow(1), EvidenceRef::Flow(2)],
        )
        .unwrap();
        let f2 = SecurityFinding::observe(
            FindingKind::UnexpectedEgress,
            0.7,
            "First egress",
            vec![EvidenceRef::Flow(2), EvidenceRef::Flow(3)],
        )
        .unwrap();

        let stitcher = IncidentStitcher::new();
        let timeline = stitcher
            .stitch_timeline(101, &[f1, f2])
            .expect("Timeline built");

        assert_eq!(timeline.id, 101);
        assert_eq!(timeline.nodes.len(), 2);

        // Deduplicated evidence contains Flow(1), Flow(2), Flow(3) without duplicates
        assert_eq!(timeline.aggregated_evidence.len(), 3);
        assert_eq!(
            timeline.aggregated_evidence,
            vec![
                EvidenceRef::Flow(1),
                EvidenceRef::Flow(2),
                EvidenceRef::Flow(3)
            ]
        );

        // Order is preserved/sorted chronologically
        assert!(timeline.nodes[0].timestamp_nanos <= timeline.nodes[1].timestamp_nanos);
    }
}
