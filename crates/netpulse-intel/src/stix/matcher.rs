//! STIX offline threat indicator matcher (docs/18 §4.9).

use netpulse_core::EvidenceRef;
use std::collections::HashMap;

use super::indicator::StixIndicator;
use crate::finding::{FindingKind, SecurityFinding};
use crate::view::TrafficView;

/// Local offline threat intelligence feed.
#[derive(Debug, Clone, Default)]
pub struct StixThreatFeed {
    indicators: Vec<StixIndicator>,
}

impl StixThreatFeed {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_indicators(&mut self, indicators: Vec<StixIndicator>) {
        self.indicators.extend(indicators);
    }

    pub fn indicators(&self) -> &[StixIndicator] {
        &self.indicators
    }

    /// Match traffic flows against local offline indicators.
    pub fn match_traffic(&self, view: &TrafficView) -> Vec<SecurityFinding> {
        if self.indicators.is_empty() {
            return Vec::new();
        }

        let mut findings = Vec::new();
        let mut matched_indicators = HashMap::new();

        for f in view.flows {
            for ind in &self.indicators {
                let mut matched = false;

                if let Some(ip) = ind.ip_value {
                    if f.key.dst_ip == ip || f.key.src_ip == ip {
                        matched = true;
                    }
                }

                if matched {
                    matched_indicators
                        .entry(ind.id.clone())
                        .or_insert_with(|| (ind.clone(), Vec::new()))
                        .1
                        .push(f.id);
                }
            }
        }

        for (_, (ind, flow_ids)) in matched_indicators {
            let evidence: Vec<EvidenceRef> = flow_ids.into_iter().map(EvidenceRef::Flow).collect();
            let explanation = format!(
                "Traffic matched local threat intelligence indicator '{}' (ID: {}). Pattern: {}. {}",
                ind.name, ind.id, ind.pattern, ind.description
            );

            if let Some(finding) = SecurityFinding::observe(
                FindingKind::ThreatIntelMatch,
                ind.confidence,
                explanation,
                evidence,
            ) {
                let tech = format!("STIX Indicator Category: {:?}", ind.category);
                findings.push(finding.with_technical(tech));
            }
        }

        findings
    }
}
