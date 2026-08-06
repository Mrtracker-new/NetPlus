//! Declarative behavioral chain detection.
//!
//! Evaluated against corroborated findings to detect multi-stage attack patterns
//! across sliding time windows (e.g. Reconnaissance -> Initial Access -> C2 Beaconing).

use netpulse_core::EvidenceRef;

use crate::finding::{FindingKind, SecurityFinding, MAX_INFERRED_CONFIDENCE};

/// A single stage in a multi-stage attack pattern chain rule.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainStage {
    pub name: &'static str,
    pub kind: FindingKind,
    pub attack_phase: &'static str, // e.g. "Reconnaissance", "Initial Access", "Command and Control", "Exfiltration"
}

/// A declarative behavioral chain rule definition.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainRule {
    pub id: &'static str,
    pub name: &'static str,
    pub stages: Vec<ChainStage>,
    pub window_nanos: u64,
    pub required_confidence: f32,
}

impl ChainRule {
    /// Built-in rule: Recon -> Access -> C2 Beaconing.
    pub fn recon_egress_beacon() -> Self {
        Self {
            id: "chain-recon-egress-c2",
            name: "Reconnaissance to Egress and Command & Control",
            stages: vec![
                ChainStage {
                    name: "Port Scan or DNS Anomaly",
                    kind: FindingKind::PortScan,
                    attack_phase: "Reconnaissance",
                },
                ChainStage {
                    name: "Unexpected Egress",
                    kind: FindingKind::UnexpectedEgress,
                    attack_phase: "Initial Access",
                },
                ChainStage {
                    name: "Beaconing Check-ins",
                    kind: FindingKind::Beaconing,
                    attack_phase: "Command and Control",
                },
            ],
            window_nanos: 3600 * 1_000_000_000, // 1 hour
            required_confidence: 0.4,
        }
    }

    /// Built-in rule: Profile Breach -> Exfiltration / Bandwidth Anomaly.
    pub fn breach_exfil() -> Self {
        Self {
            id: "chain-breach-exfil",
            name: "App Profile Breach to Large Exfiltration",
            stages: vec![
                ChainStage {
                    name: "App Profile Breach",
                    kind: FindingKind::AppProfileBreach,
                    attack_phase: "Policy Violation",
                },
                ChainStage {
                    name: "Bandwidth Anomaly",
                    kind: FindingKind::BandwidthAnomaly,
                    attack_phase: "Exfiltration",
                },
            ],
            window_nanos: 1800 * 1_000_000_000, // 30 minutes
            required_confidence: 0.4,
        }
    }
}

/// Stateful engine that evaluates behavioral chain rules against corroborated findings.
#[derive(Debug, Clone, Default)]
pub struct BehavioralChainEngine {
    rules: Vec<ChainRule>,
}

impl BehavioralChainEngine {
    pub fn new() -> Self {
        let mut engine = Self::default();
        engine.register_rule(ChainRule::recon_egress_beacon());
        engine.register_rule(ChainRule::breach_exfil());
        engine
    }

    pub fn register_rule(&mut self, rule: ChainRule) {
        self.rules.push(rule);
    }

    /// Evaluate rules against corroborated findings.
    pub fn detect_chains(&self, findings: &[SecurityFinding]) -> Vec<SecurityFinding> {
        if findings.len() < 2 {
            return Vec::new();
        }

        let mut out = Vec::new();

        for rule in &self.rules {
            if let Some(matched_chain) = self.match_rule(rule, findings) {
                out.push(matched_chain);
            }
        }

        out
    }

    fn match_rule(
        &self,
        rule: &ChainRule,
        findings: &[SecurityFinding],
    ) -> Option<SecurityFinding> {
        let mut matched_findings: Vec<&SecurityFinding> = Vec::new();
        let mut matched_stages: Vec<&ChainStage> = Vec::new();

        // Sequential stage matching
        for stage in &rule.stages {
            if let Some(f) = findings
                .iter()
                .find(|f| f.kind == stage.kind && !matched_findings.contains(f))
            {
                matched_findings.push(f);
                matched_stages.push(stage);
            }
        }

        // Require matching at least 2 distinct stages in order
        if matched_findings.len() < 2 {
            return None;
        }

        // Noisy-OR over matched stage confidences with chain progression boost
        let base_confidence = 1.0
            - matched_findings
                .iter()
                .fold(1.0_f32, |acc, f| acc * (1.0 - f.confidence.value()));
        let boost = 0.1 * (matched_findings.len() as f32);
        let final_conf = (base_confidence + boost).clamp(0.5, MAX_INFERRED_CONFIDENCE);

        // Union evidence references across matched findings
        let mut evidence: Vec<EvidenceRef> = Vec::new();
        for f in &matched_findings {
            for e in &f.evidence {
                if !evidence.contains(e) {
                    evidence.push(*e);
                }
            }
        }

        let stage_names: Vec<String> = matched_stages
            .iter()
            .map(|s| format!("{} ({})", s.name, s.attack_phase))
            .collect();

        let explanation = format!(
            "Multi-stage behavioral chain detected ('{}'): {}. Sequence of {} related stages matched over the observation window.",
            rule.name,
            stage_names.join(" ➔ "),
            matched_findings.len()
        );

        let tech = format!(
            "Rule ID: {} · Matched stages: {}",
            rule.id,
            matched_findings.len()
        );

        SecurityFinding::observe(
            FindingKind::BehavioralChain,
            final_conf,
            explanation,
            evidence,
        )
        .map(|f| f.with_technical(tech))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finding::{FindingKind, SecurityFinding};

    #[test]
    fn detects_multi_stage_chain_sequence() {
        let f1 = SecurityFinding::observe(
            FindingKind::PortScan,
            0.6,
            "Port scan detected",
            vec![EvidenceRef::Flow(1)],
        )
        .unwrap();
        let f2 = SecurityFinding::observe(
            FindingKind::UnexpectedEgress,
            0.5,
            "First time egress",
            vec![EvidenceRef::Flow(2)],
        )
        .unwrap();

        let engine = BehavioralChainEngine::new();
        let chains = engine.detect_chains(&[f1, f2]);

        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].kind, FindingKind::BehavioralChain);
        assert!(chains[0].explanation.contains("Reconnaissance to Egress"));
        // Combined confidence is boosted above single signals
        assert!(chains[0].confidence.value() > 0.6);
        assert!(chains[0].confidence.value() <= MAX_INFERRED_CONFIDENCE);
    }

    #[test]
    fn single_finding_does_not_trigger_chain() {
        let f1 = SecurityFinding::observe(
            FindingKind::PortScan,
            0.6,
            "Port scan detected",
            vec![EvidenceRef::Flow(1)],
        )
        .unwrap();

        let engine = BehavioralChainEngine::new();
        let chains = engine.detect_chains(&[f1]);

        assert!(
            chains.is_empty(),
            "Single finding must not trigger multi-stage chain"
        );
    }
}
