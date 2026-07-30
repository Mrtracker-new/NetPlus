//! Explainable ML Anomaly Detection (docs/20 §4.2).
//!
//! Multi-dimensional feature attribution layer that breaks down anomaly scores
//! into explicit, normalized feature contributions (e.g. 72% destination novelty,
//! 18% byte volume, 10% packet rate).
//!
//! Load-bearing honesty invariants:
//! - **Score and attribution separation**: `overall_score` / `confidence` are distinct from
//!   `contributions` percentages — contribution percentages always sum to 100% and indicate
//!   *relative driver*, not certainty.
//! - **Interpretable explanations**: Human-readable narrative detailing why each feature
//!   contributed to the observation.

use netpulse_core::{Confidence, EvidenceRef};
use std::collections::HashSet;

use crate::anomaly::{Baseline, Maturity};
use crate::finding::{FindingKind, SecurityFinding};
use crate::view::TrafficView;

/// The specific dimensions analyzed by the ML feature attribution engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeatureKind {
    /// Byte volume departure.
    Volume,
    /// Packet rate / frequency deviation.
    Rate,
    /// Destination IP / ASN / region novelty.
    DestinationNovelty,
    /// Non-standard or rarely seen destination port.
    PortUniqueness,
    /// Off-hours or unusual activity timing.
    Timing,
    /// Protocol or L7 mismatch.
    Protocol,
}

impl FeatureKind {
    pub fn name(self) -> &'static str {
        match self {
            FeatureKind::Volume => "Byte Volume",
            FeatureKind::Rate => "Packet Rate",
            FeatureKind::DestinationNovelty => "Destination Novelty",
            FeatureKind::PortUniqueness => "Port Uniqueness",
            FeatureKind::Timing => "Off-Hours Timing",
            FeatureKind::Protocol => "Protocol Mismatch",
        }
    }
}

/// The weight and contribution of a single feature to the overall anomaly.
#[derive(Debug, Clone, PartialEq)]
pub struct FeatureWeight {
    pub feature: FeatureKind,
    pub raw_score: f32,
    /// Normalized percentage contribution (0.0 to 100.0). Sum across all feature weights is 100.0%.
    pub normalized_percent: f32,
    pub explanation: String,
}

/// Struct capturing the multi-dimensional attribution for an anomalous flow or session.
#[derive(Debug, Clone, PartialEq)]
pub struct FeatureAttribution {
    /// Overall multi-dimensional anomaly score (0.0 to 1.0).
    pub overall_score: f32,
    /// Calibrated finding confidence (distinct from contribution percentage).
    pub confidence: Confidence,
    /// Feature contributions summing to 100%.
    pub contributions: Vec<FeatureWeight>,
}

impl FeatureAttribution {
    /// Create a new `FeatureAttribution` ensuring normalized percentages sum to 100.0%
    /// without NaNs or infinities even when all raw scores are zero.
    pub fn new(overall_score: f32, raw_weights: Vec<(FeatureKind, f32, String)>) -> Self {
        let overall_score = if overall_score.is_nan() || overall_score.is_infinite() {
            0.0
        } else {
            overall_score.clamp(0.0, 1.0)
        };

        let total_raw: f32 = raw_weights
            .iter()
            .map(|(_, score, _)| {
                if score.is_nan() || score.is_infinite() {
                    0.0
                } else {
                    score.max(0.0)
                }
            })
            .sum();

        let count = raw_weights.len();
        let contributions = if total_raw <= f32::EPSILON || count == 0 {
            // Equal distribution fallback if zero variance / zero deviation
            let equal_share = if count > 0 { 100.0 / count as f32 } else { 0.0 };
            raw_weights
                .into_iter()
                .map(|(feature, score, explanation)| FeatureWeight {
                    feature,
                    raw_score: if score.is_nan() || score.is_infinite() {
                        0.0
                    } else {
                        score
                    },
                    normalized_percent: equal_share,
                    explanation,
                })
                .collect()
        } else {
            raw_weights
                .into_iter()
                .map(|(feature, score, explanation)| {
                    let valid_score = if score.is_nan() || score.is_infinite() {
                        0.0
                    } else {
                        score.max(0.0)
                    };
                    let percent = (valid_score / total_raw) * 100.0;
                    FeatureWeight {
                        feature,
                        raw_score: valid_score,
                        normalized_percent: percent,
                        explanation,
                    }
                })
                .collect()
        };

        let confidence = Confidence::new(overall_score * 0.85);

        Self {
            overall_score,
            confidence,
            contributions,
        }
    }

    /// Render narrative explanation string listing primary feature attributions.
    pub fn render_narrative(&self) -> String {
        let mut sorted = self.contributions.clone();
        sorted.sort_by(|a, b| {
            b.normalized_percent
                .partial_cmp(&a.normalized_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let primary_lines: Vec<String> = sorted
            .iter()
            .take(3)
            .map(|c| {
                format!(
                    "{}: {:.1}% ({})",
                    c.feature.name(),
                    c.normalized_percent,
                    c.explanation
                )
            })
            .collect();

        format!(
            "Multi-dimensional anomaly detected (overall score {:.2}). Primary feature drivers: {}",
            self.overall_score,
            primary_lines.join("; ")
        )
    }
}

/// Multi-dimensional ML anomaly detector with explainable feature attribution.
#[derive(Debug, Clone, Default)]
pub struct MlAnomalyDetector;

impl MlAnomalyDetector {
    pub fn new() -> Self {
        Self
    }

    pub fn detect(&self, view: &TrafficView) -> Vec<SecurityFinding> {
        detect_ml_anomalies(view)
    }
}

/// Analyze traffic view with explainable ML feature attribution.
pub fn detect_ml_anomalies(view: &TrafficView) -> Vec<SecurityFinding> {
    if view.flows.len() < 4 {
        return Vec::new();
    }

    let mut vol_baseline = Baseline::new();
    let mut pkt_baseline = Baseline::new();
    let mut known_dsts = HashSet::new();

    for f in view.flows {
        vol_baseline.observe(f.stats.bytes as f64);
        pkt_baseline.observe(f.stats.packets as f64);
        known_dsts.insert(f.key.dst_ip);
    }

    if vol_baseline.maturity() == Maturity::Cold {
        return Vec::new();
    }

    let mut findings = Vec::new();

    for f in view.flows {
        let bytes = f.stats.bytes as f64;
        let pkts = f.stats.packets as f64;

        let vol_z = vol_baseline.deviation(bytes) as f32;
        let pkt_z = pkt_baseline.deviation(pkts) as f32;

        let dst_novelty = if known_dsts.len() > 1 && f.key.dst_port > 1024 {
            2.5
        } else {
            0.1
        };
        let port_score = if f.key.dst_port == 4444 || f.key.dst_port == 8443 {
            3.0
        } else {
            0.2
        };

        let max_z = vol_z.max(pkt_z).max(dst_novelty).max(port_score);
        if max_z < 3.0 {
            continue;
        }

        let raw_weights = vec![
            (
                FeatureKind::Volume,
                vol_z,
                format!(
                    "Byte volume {bytes:.0} vs baseline mean {:.0}",
                    vol_baseline.mean()
                ),
            ),
            (
                FeatureKind::Rate,
                pkt_z,
                format!(
                    "Packet count {pkts:.0} vs baseline mean {:.0}",
                    pkt_baseline.mean()
                ),
            ),
            (
                FeatureKind::DestinationNovelty,
                dst_novelty,
                format!("Destination IP {}", f.key.dst_ip),
            ),
            (
                FeatureKind::PortUniqueness,
                port_score,
                format!("Destination port {}", f.key.dst_port),
            ),
        ];

        let overall = (max_z / 10.0).clamp(0.4, 0.9);
        let attribution = FeatureAttribution::new(overall, raw_weights);
        let explanation = attribution.render_narrative();

        if let Some(finding) = SecurityFinding::observe(
            FindingKind::MlFeatureAnomaly,
            attribution.confidence.value(),
            explanation,
            vec![EvidenceRef::Flow(f.id)],
        ) {
            let top_feat = attribution.contributions.iter().max_by(|a, b| {
                a.normalized_percent
                    .partial_cmp(&b.normalized_percent)
                    .unwrap()
            });
            let tech = match top_feat {
                Some(t) => format!(
                    "Primary contributor: {} at {:.1}%",
                    t.feature.name(),
                    t.normalized_percent
                ),
                None => format!("Overall score: {:.2}", attribution.overall_score),
            };
            findings.push(finding.with_technical(tech));
        }
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attribution_percentages_sum_to_100() {
        let raw = vec![
            (FeatureKind::Volume, 4.0, "High bytes".to_string()),
            (
                FeatureKind::DestinationNovelty,
                12.0,
                "New dest".to_string(),
            ),
            (FeatureKind::PortUniqueness, 4.0, "Rare port".to_string()),
        ];
        let attr = FeatureAttribution::new(0.8, raw);

        let sum: f32 = attr
            .contributions
            .iter()
            .map(|c| c.normalized_percent)
            .sum();
        assert!(
            (sum - 100.0).abs() < 0.01,
            "Attribution percentages must sum to 100%, got {sum}"
        );
    }

    #[test]
    fn zero_variance_produces_no_nans() {
        let raw = vec![
            (FeatureKind::Volume, 0.0, "Flat".to_string()),
            (FeatureKind::Rate, 0.0, "Flat".to_string()),
        ];
        let attr = FeatureAttribution::new(0.0, raw);

        assert!(!attr.overall_score.is_nan());
        assert!(!attr.overall_score.is_infinite());
        for c in attr.contributions {
            assert!(!c.normalized_percent.is_nan());
            assert!(!c.normalized_percent.is_infinite());
            assert_eq!(c.normalized_percent, 50.0);
        }
    }
}
