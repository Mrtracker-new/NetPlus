//! The Security Engine finding model — the atomic, honest unit the
//! whole intelligence layer produces. Where `netpulse-core`'s [`Finding`] is the
//! compact *storage* record (id + category + confidence + evidence), this is the
//! rich *domain* type the detectors and anomaly engine build
//! and the engine projects to the UI — exactly as `netpulse-engine`'s `Diagnosis`
//! sits above core's model.
//!
//! The structure *encodes* the honesty guarantees:
//! - A [`SecurityFinding`] is constructed only by [`SecurityFinding::observe`],
//!   which requires an explanation and at least one [`EvidenceRef`] — so an
//!   "unexplained alert" or an evidence-free verdict is impossible to build
//!
//! - Every finding names *benign explanations*: a detector that
//!   cannot say why the behaviour might be innocent is a false-positive factory.
//! - Confidence is a calibrated [`Confidence`] that is **never 1.0** for an
//!   inference: [`observe`](SecurityFinding::observe caps it below
//!   certainty, because NetPulse detects *suspicion, not certainty*.
//! - Language is disciplined: "unusual/notable", never "malicious".

use netpulse_core::{Confidence, EvidenceRef, FindingCategory};

/// The maximum confidence any inferred finding may carry: a
/// confidence-scored observation is never a certainty, so we cap strictly below
/// 1.0. A rule match can be *strong*; it is never *proof*.
pub const MAX_INFERRED_CONFIDENCE: f32 = 0.95;

/// The specific behaviour a finding describes — the named, bounded set (docs/17
/// §4, "no vague 'threat'"). Each maps up to a broad [`FindingCategory`] for
/// storage and carries its own human title and benign-explanation list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum FindingKind {
    /// A process not seen before reaching the network, especially unsigned
    ///Rule/heuristic.
    UnexpectedEgress,
    /// Highly regular check-ins to one host — a beaconing shape.
    Beaconing,
    /// Connections fanned across many ports of one host.
    PortScan,
    /// A burst of DNS queries far above the usual rate.
    DnsAnomaly,
    /// One host contacted by an unusually large number of connections
    ///
    ConnectionStorm,
    /// A flow whose volume deviates sharply from this machine's learned normal
    ///Statistical anomaly.
    BandwidthAnomaly,
    /// Multi-dimensional anomaly flagged with explainable feature attribution.
    MlFeatureAnomaly,
    /// Match against local offline STIX 2.1 threat intelligence indicators.
    ThreatIntelMatch,
    /// An application's behavior breached its observed baseline or configured policy.
    AppProfileBreach,
    /// Multi-stage attack pattern detected across corroborated findings.
    BehavioralChain,
}

impl FindingKind {
    /// The broad storage category this kind rolls up to.
    pub fn category(self) -> FindingCategory {
        match self {
            FindingKind::BandwidthAnomaly | FindingKind::MlFeatureAnomaly => {
                FindingCategory::Anomaly
            }
            FindingKind::UnexpectedEgress
            | FindingKind::Beaconing
            | FindingKind::PortScan
            | FindingKind::DnsAnomaly
            | FindingKind::ConnectionStorm
            | FindingKind::ThreatIntelMatch
            | FindingKind::AppProfileBreach
            | FindingKind::BehavioralChain => FindingCategory::Suspicious,
        }
    }

    /// A short, calm, non-accusatory title (, language
    /// discipline — describes *behaviour*, never judges a person or declares
    /// malware).
    pub fn title(self) -> &'static str {
        match self {
            FindingKind::UnexpectedEgress => "An app reached the Internet for the first time",
            FindingKind::Beaconing => "An app is contacting one server on a regular schedule",
            FindingKind::PortScan => "Many ports on one host were contacted quickly",
            FindingKind::DnsAnomaly => "An unusual burst of DNS lookups",
            FindingKind::ConnectionStorm => "An unusually large number of connections to one host",
            FindingKind::BandwidthAnomaly => "Traffic volume outside this machine's usual range",
            FindingKind::MlFeatureAnomaly => {
                "Multi-dimensional anomaly detected with feature attribution"
            }
            FindingKind::ThreatIntelMatch => {
                "Connection matched a local threat intelligence indicator"
            }
            FindingKind::AppProfileBreach => {
                "An app's network activity breached its security profile"
            }
            FindingKind::BehavioralChain => "Multi-stage attack pattern detected across activities",
        }
    }

    /// Innocent readings the finding must weigh. Surfaced to the
    /// user so a benign-but-unusual event never reads as an accusation (docs/17
    /// §9). A non-empty list is required by [`SecurityFinding::observe`].
    pub fn benign_explanations(self) -> &'static [&'static str] {
        match self {
            FindingKind::UnexpectedEgress => &[
                "A newly installed app or updater reaching out for the first time",
                "A legitimate background service you haven't noticed before",
            ],
            FindingKind::Beaconing => &[
                "Software update checks or telemetry",
                "A keep-alive or sync client staying connected",
            ],
            FindingKind::PortScan => &[
                "Service discovery on your own network",
                "A network tool you ran yourself",
            ],
            FindingKind::DnsAnomaly => &[
                "A page with many resources on different domains",
                "Aggressive prefetch or a CDN with many hostnames",
            ],
            FindingKind::ConnectionStorm => &[
                "A browser or P2P app, which naturally open many connections",
                "A buggy retry loop reconnecting repeatedly",
            ],
            FindingKind::BandwidthAnomaly => &[
                "A large but legitimate upload — cloud backup, sync, or a video",
                "A one-off download that simply differs from your norm",
            ],
            FindingKind::MlFeatureAnomaly => &[
                "A batch process or cloud sync operating under unusual network conditions",
                "A newly updated app with altered traffic characteristics",
            ],
            FindingKind::ThreatIntelMatch => &[
                "A shared infrastructure host or CDN IP listed in threat feeds",
                "An old or overly broad threat intelligence rule match",
            ],
            FindingKind::AppProfileBreach => &[
                "An app update adding new legitimate endpoints or features",
                "A temporary manual change in application configuration or usage pattern",
            ],
            FindingKind::BehavioralChain => &[
                "A sequence of legitimate automated administration or setup tasks",
                "Coincidental overlap of separate routine application actions",
            ],
        }
    }

    /// A non-destructive, observe-only suggestion.
    /// Always framed as "you might look", never "block/kill/quarantine".
    pub fn suggested_action(self) -> &'static str {
        match self {
            FindingKind::UnexpectedEgress => {
                "If you don't recognise this app, you might look at what it is before trusting it."
            }
            FindingKind::Beaconing => {
                "If you recognise the app, you can mark this as expected so it stops surfacing."
            }
            FindingKind::PortScan => {
                "If you didn't run a scanning tool, you might note which host this came from."
            }
            FindingKind::DnsAnomaly => {
                "You might check which site was loading when this burst happened."
            }
            FindingKind::ConnectionStorm => {
                "If this is a browser or download manager, you can mark it as expected."
            }
            FindingKind::BandwidthAnomaly => {
                "If you started a backup or upload, this is expected — you can mark it so."
            }
            FindingKind::MlFeatureAnomaly => {
                "Review the feature attribution breakdown to understand which metric deviated most."
            }
            FindingKind::ThreatIntelMatch => {
                "Check the matched indicator metadata and destination hostname before proceeding."
            }
            FindingKind::AppProfileBreach => {
                "Review the application profile and update expected policies if this activity is legitimate."
            }
            FindingKind::BehavioralChain => {
                "Examine the incident sequence across all stages to verify whether the pattern is expected."
            }
        }
    }
}

/// A confidence-scored, evidence-backed security *observation*.
///
/// Public fields for reading, but constructible only through
/// [`SecurityFinding::observe`], so the evidence + explanation + calibrated-
/// confidence invariants hold by construction — mirroring how `Diagnosis` is
/// built only by `diagnose`.
#[derive(Debug, Clone, PartialEq)]
pub struct SecurityFinding {
    pub kind: FindingKind,
    /// Calibrated, capped below 1.0 for inferences.
    pub confidence: Confidence,
    /// Plain-language "why this is notable", including the honest limits of what
    /// we can tell. Never a verdict.
    pub explanation: String,
    /// Optional deeper/technical line, disclosed at Intermediate+.
    pub technical: Option<String>,
    /// The exact data that triggered this — always non-empty.
    pub evidence: Vec<EvidenceRef>,
    /// Other kinds that corroborated into this one. Empty for a
    /// standalone finding; populated when the assembler merges signals.
    pub contributing: Vec<FindingKind>,
}

impl SecurityFinding {
    /// Build a finding, enforcing the honesty invariants:
    /// - `evidence` must be non-empty — a claim with nothing behind it cannot
    ///   exist;
    /// - `explanation` must be non-empty — every warning explains itself
    ///
    /// - confidence is clamped to at most [`MAX_INFERRED_CONFIDENCE`] so an
    ///   inference is never laundered into certainty.
    ///
    /// Returns `None` if the evidence or explanation is missing, so a detector
    /// physically cannot emit a bare verdict (the callers in [`crate::rules`] and
    /// [`crate::anomaly`] always supply both).
    pub fn observe(
        kind: FindingKind,
        raw_confidence: f32,
        explanation: impl Into<String>,
        evidence: Vec<EvidenceRef>,
    ) -> Option<Self> {
        let explanation = explanation.into();
        if evidence.is_empty() || explanation.trim().is_empty() {
            return None;
        }
        Some(Self {
            kind,
            confidence: Confidence::new(raw_confidence.min(MAX_INFERRED_CONFIDENCE)),
            explanation,
            technical: None,
            evidence,
            contributing: Vec::new(),
        })
    }

    /// Attach a technical detail line, disclosed only at deeper modes.
    pub fn with_technical(mut self, technical: impl Into<String>) -> Self {
        self.technical = Some(technical.into());
        self
    }

    /// The calibrated confidence as a plain qualitative word, so a
    /// beginner isn't forced to interpret a raw percentage. Deliberately tentative
    /// — never "malicious", always "unusual".
    pub fn qualitative(&self) -> &'static str {
        qualitative(self.confidence)
    }

    /// Project to the compact core [`netpulse_core::Finding`] storage record with
    /// a stable id. The rich text lives in the domain type / DTO; the
    /// stored record keeps only what retention and the evidence invariant need.
    pub fn to_core(&self, id: u64) -> netpulse_core::Finding {
        netpulse_core::Finding {
            id,
            category: self.kind.category(),
            confidence: self.confidence,
            evidence_refs: self.evidence.clone(),
        }
    }
}

/// Map a calibrated confidence to a calm qualitative word. The
/// bands are deliberately conservative — a weak signal stays weak, and nothing
/// here ever reads as certainty.
pub fn qualitative(c: Confidence) -> &'static str {
    let v = c.value();
    if v < 0.4 {
        "possibly unusual"
    } else if v < 0.7 {
        "notably unusual"
    } else {
        "strongly unusual"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observe_requires_evidence_and_explanation() {
        // No evidence → cannot construct.
        assert!(SecurityFinding::observe(FindingKind::Beaconing, 0.6, "regular", vec![]).is_none());
        // No explanation → cannot construct.
        assert!(SecurityFinding::observe(
            FindingKind::Beaconing,
            0.6,
            "   ",
            vec![EvidenceRef::Flow(1)]
        )
        .is_none());
        // Both present → fine.
        assert!(SecurityFinding::observe(
            FindingKind::Beaconing,
            0.6,
            "regular check-ins",
            vec![EvidenceRef::Flow(1)]
        )
        .is_some());
    }

    #[test]
    fn confidence_is_never_certainty() {
        // Even a detector shouting 1.0 is capped below certainty.
        let f = SecurityFinding::observe(
            FindingKind::PortScan,
            1.0,
            "many ports",
            vec![EvidenceRef::Flow(1)],
        )
        .unwrap();
        assert!(f.confidence.value() <= MAX_INFERRED_CONFIDENCE);
        assert!(f.confidence.value() < 1.0);
    }

    #[test]
    fn every_kind_names_a_benign_explanation() {
        // a detector that can't model innocence is a false-positive
        // factory. Enforce that structurally for the whole catalog.
        for k in [
            FindingKind::UnexpectedEgress,
            FindingKind::Beaconing,
            FindingKind::PortScan,
            FindingKind::DnsAnomaly,
            FindingKind::ConnectionStorm,
            FindingKind::BandwidthAnomaly,
        ] {
            assert!(
                !k.benign_explanations().is_empty(),
                "{k:?} has no benign case"
            );
            assert!(!k.title().is_empty());
            assert!(!k.suggested_action().is_empty());
        }
    }

    #[test]
    fn qualitative_never_asserts_malice() {
        for v in [0.1_f32, 0.5, 0.9] {
            let word = qualitative(Confidence::new(v));
            assert!(word.contains("unusual"), "{word} should be tentative");
            assert!(!word.contains("malic"));
        }
    }

    #[test]
    fn core_projection_preserves_category_and_evidence() {
        let f = SecurityFinding::observe(
            FindingKind::BandwidthAnomaly,
            0.5,
            "220 MB vs a 2 MB norm",
            vec![EvidenceRef::Flow(9)],
        )
        .unwrap();
        let core = f.to_core(1);
        assert_eq!(core.category, FindingCategory::Anomaly);
        assert_eq!(core.evidence_refs, vec![EvidenceRef::Flow(9)]);
    }
}
