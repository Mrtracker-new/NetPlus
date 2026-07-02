//! Anomaly detection (docs/20): learning each machine's *normal* and flagging
//! deviation from it — catching the unknown that the named rules (docs/18) can't.
//!
//! Two honesty rules from docs/20 are load-bearing here:
//! - **Deviation ≠ danger** (docs/20 §5): a finding says "different from your
//!   normal, worth a look", never a verdict (docs/01 X4). Its confidence reflects
//!   *both* how far outside normal the point is *and* how well-established the
//!   baseline is — a shaky baseline yields low confidence (docs/20 §5, §6).
//! - **Anomaly is meaningless without the normal** (docs/20 §8): every finding
//!   states *both* the baseline and the departure as its explanation, so the user
//!   sees what "usual" was, not just the outlier.
//!
//! The statistical floor is deliberately interpretable (docs/20 §4.1): an
//! incremental Welford mean/variance (O(1) per point, docs/20 §10) gives a robust
//! z-score whose explanation writes itself ("8× your usual"). Optional ONNX
//! models (docs/20 §4.2) are a future enhancement layered *above* this floor,
//! never a replacement — the floor always works offline and unexplained-oracle-
//! free (docs/03 §16 graceful degradation).

use netpulse_core::EvidenceRef;

use crate::finding::{FindingKind, SecurityFinding};
use crate::view::TrafficView;

/// How well-established a baseline is (docs/20 §6 cold-start). Confidence and
/// sensitivity rise with maturity; a cold baseline never pretends to know your
/// normal (docs/20 §6 "no fabricated normals").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Maturity {
    /// Too few samples to judge anything (docs/20 §6). No findings emitted.
    Cold,
    /// Some normal observed; conservative thresholds, capped confidence.
    Warming,
    /// Enough normal to flag deviations with fuller confidence.
    Established,
}

/// Sample counts that separate the maturity bands (docs/20 §6 progressive
/// confidence). Deliberately small so the offline slice can demonstrate warming
/// up within one capture, while staying honest about a thin baseline.
const WARMING_MIN: u64 = 4;
const ESTABLISHED_MIN: u64 = 12;

/// An incremental one-dimensional baseline (docs/20 §4.1): Welford's online
/// mean/variance, O(1) per update and tiny memory (docs/20 §10). Robust enough
/// for the interpretable floor; ML augments it later (docs/20 §4.2), never
/// replaces it.
#[derive(Debug, Clone, Default)]
pub struct Baseline {
    count: u64,
    mean: f64,
    /// Sum of squared deviations from the running mean (Welford's M2).
    m2: f64,
}

impl Baseline {
    /// A fresh, empty baseline (Cold until it has seen some normal).
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one observation into the baseline (docs/20 §4.1). Incremental, so
    /// there is never a re-scan (docs/20 §10).
    pub fn observe(&mut self, value: f64) {
        self.count += 1;
        let delta = value - self.mean;
        self.mean += delta / self.count as f64;
        let delta2 = value - self.mean;
        self.m2 += delta * delta2;
    }

    /// The learned mean ("your usual").
    pub fn mean(&self) -> f64 {
        self.mean
    }

    /// The sample standard deviation, or 0 with fewer than two points.
    pub fn std_dev(&self) -> f64 {
        if self.count < 2 {
            0.0
        } else {
            (self.m2 / (self.count - 1) as f64).sqrt()
        }
    }

    /// How well-established this baseline is (docs/20 §6).
    pub fn maturity(&self) -> Maturity {
        if self.count < WARMING_MIN {
            Maturity::Cold
        } else if self.count < ESTABLISHED_MIN {
            Maturity::Warming
        } else {
            Maturity::Established
        }
    }

    /// A robust z-score for `value`: how many standard deviations it sits from
    /// the mean (docs/20 §4.1). Returns 0 when the baseline has no spread yet,
    /// so a flat history never manufactures a deviation (docs/20 §6).
    pub fn deviation(&self, value: f64) -> f64 {
        let sd = self.std_dev();
        if sd <= f64::EPSILON {
            0.0
        } else {
            (value - self.mean).abs() / sd
        }
    }
}

/// The z-score past which a point is "worth a look" once the baseline is
/// [`Maturity::Established`] (docs/20 §5). Conservative — anomaly confidence is
/// inherently fuzzier than a rule match, so the bar is set high (docs/20 §5).
const ESTABLISHED_Z: f64 = 3.0;
/// A higher bar while still Warming (docs/20 §6 conservative early behaviour).
const WARMING_Z: f64 = 4.0;

/// Flag flows whose byte volume deviates sharply from this window's learned
/// normal (docs/20 §3 per-app bandwidth, §8 emitting findings). Only *upward*
/// deviations are surfaced — a quiet flow is never alarming — and only when the
/// baseline is mature enough to mean something (docs/20 §6).
///
/// The baseline here is learned across the flows in view; a persistent per-app
/// baseline (docs/20 §7) is the same machinery fed from storage over time. Both
/// state the normal *and* the departure in the explanation (docs/20 §8).
pub fn bandwidth_anomaly(view: &TrafficView) -> Vec<SecurityFinding> {
    if view.flows.len() < WARMING_MIN as usize {
        // Cold start: not enough normal to judge. Stay quiet and honest
        // (docs/20 §6) rather than flag on a blank slate.
        return Vec::new();
    }

    let mut baseline = Baseline::new();
    for f in view.flows {
        baseline.observe(f.stats.bytes as f64);
    }

    let maturity = baseline.maturity();
    let z_bar = match maturity {
        Maturity::Cold => return Vec::new(),
        Maturity::Warming => WARMING_Z,
        Maturity::Established => ESTABLISHED_Z,
    };

    let mean = baseline.mean();
    let mut out = Vec::new();
    for f in view.flows {
        let value = f.stats.bytes as f64;
        // Only upward departures are notable for exfiltration-shaped concerns
        // (docs/18 §4.3); a below-average flow is normal quiet.
        if value <= mean {
            continue;
        }
        let z = baseline.deviation(value);
        if z < z_bar {
            continue;
        }

        // Confidence blends how-far-out (z) with how-established the baseline is
        // (docs/20 §5): a Warming baseline caps lower, so a thin history never
        // shouts. Scaled into a calm band and capped below certainty by `observe`.
        let z_component = ((z - z_bar) / z_bar).clamp(0.0, 1.0) as f32;
        let base = match maturity {
            Maturity::Warming => 0.35,
            Maturity::Established => 0.5,
            Maturity::Cold => unreachable!(),
        };
        let confidence = base + 0.25 * z_component;

        let ratio = if mean > 0.0 { value / mean } else { 0.0 };
        let explanation = format!(
            "This flow moved {} bytes — about {:.1}× your usual {:.0} bytes for this window. \
             That's different from your normal, which is worth a look, not necessarily a problem.",
            f.stats.bytes, ratio, mean,
        );
        if let Some(finding) = SecurityFinding::observe(
            FindingKind::BandwidthAnomaly,
            confidence,
            explanation,
            vec![EvidenceRef::Flow(f.id)],
        ) {
            let f = finding.with_technical(format!(
                "z-score {z:.1} vs baseline (mean {mean:.0}, sd {:.0}, {maturity:?})",
                baseline.std_dev()
            ));
            out.push(f);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::TrafficView;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Flow, FlowMetrics, FlowState, Timestamp};
    use std::collections::HashMap;
    use std::net::{IpAddr, Ipv4Addr};

    fn flow(id: u64, bytes: u64) -> Flow {
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, id as u8));
        Flow {
            id,
            key: FiveTuple::new(ip, 40000, ip, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(id * 1000, id * 1000),
            last_ts: Timestamp::new(id * 1000 + 1, id * 1000 + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes,
                packets: 4,
                rtt_estimate_nanos: None,
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Closed,
        }
    }

    fn view<'a>(
        flows: &'a [Flow],
        empty: &'a HashMap<u64, netpulse_core::Process>,
    ) -> TrafficView<'a> {
        TrafficView {
            flows,
            events: &[],
            process_of: empty,
        }
    }

    #[test]
    fn welford_tracks_mean_and_spread() {
        let mut b = Baseline::new();
        for v in [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0] {
            b.observe(v);
        }
        assert!((b.mean() - 5.0).abs() < 1e-9);
        assert!((b.std_dev() - 2.138).abs() < 0.01);
    }

    #[test]
    fn flat_history_never_flags() {
        // Every flow identical → zero spread → no deviation invented (docs/20 §6).
        let empty = HashMap::new();
        let flows: Vec<Flow> = (0..20).map(|i| flow(i, 1000)).collect();
        assert!(bandwidth_anomaly(&view(&flows, &empty)).is_empty());
    }

    #[test]
    fn a_clear_outlier_is_flagged_with_baseline_stated() {
        // A stable normal of ~1 KB flows, then one 500 KB flow (docs/20 §11).
        let empty = HashMap::new();
        let mut flows: Vec<Flow> = (0..15).map(|i| flow(i, 1000 + i * 10)).collect();
        flows.push(flow(99, 500_000));
        let found = bandwidth_anomaly(&view(&flows, &empty));
        let hit = found
            .iter()
            .find(|f| f.evidence.contains(&EvidenceRef::Flow(99)))
            .expect("the 500 KB outlier is flagged");
        assert_eq!(hit.kind, FindingKind::BandwidthAnomaly);
        // The explanation states BOTH the normal and the departure (docs/20 §8).
        assert!(hit.explanation.contains("usual"));
        assert!(hit.explanation.contains("500000"));
        // Deviation is never phrased as danger (docs/01 X4).
        assert!(!hit.explanation.contains("malic"));
        assert!(hit.confidence.value() < 1.0);
    }

    #[test]
    fn cold_start_stays_quiet() {
        // Fewer than WARMING_MIN flows → no baseline yet → no findings (docs/20 §6).
        let empty = HashMap::new();
        let flows = vec![flow(1, 1000), flow(2, 900_000)];
        assert!(bandwidth_anomaly(&view(&flows, &empty)).is_empty());
    }
}
