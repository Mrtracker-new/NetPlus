//! The Security Engine finding model (docs/17 §4) — the atomic, honest unit the
//! whole intelligence layer produces. Where `netpulse-core`'s [`Finding`] is the
//! compact *storage* record (id + category + confidence + evidence), this is the
//! rich *domain* type the detectors (docs/18) and anomaly engine (docs/20) build
//! and the engine projects to the UI — exactly as `netpulse-engine`'s `Diagnosis`
//! sits above core's model (docs/11 §6, docs/04 §3.6).
//!
//! The structure *encodes* the honesty guarantees (docs/17 §3):
//! - A [`SecurityFinding`] is constructed only by [`SecurityFinding::observe`],
//!   which requires an explanation and at least one [`EvidenceRef`] — so an
//!   "unexplained alert" or an evidence-free verdict is impossible to build
//!   (docs/17 §4, docs/02 §6.3).
//! - Every finding names *benign explanations* (docs/18 §3): a detector that
//!   cannot say why the behaviour might be innocent is a false-positive factory.
//! - Confidence is a calibrated [`Confidence`] that is **never 1.0** for an
//!   inference (docs/17 §5): [`observe`](SecurityFinding::observe) caps it below
//!   certainty, because NetPulse detects *suspicion, not certainty* (docs/01 X4).
//! - Language is disciplined: "unusual/notable", never "malicious" (docs/17 §12).

use netpulse_core::{Confidence, EvidenceRef, FindingCategory};

/// The maximum confidence any inferred finding may carry (docs/17 §5): a
/// confidence-scored observation is never a certainty, so we cap strictly below
/// 1.0. A rule match can be *strong*; it is never *proof* (docs/01 X4).
pub const MAX_INFERRED_CONFIDENCE: f32 = 0.95;

/// The specific behaviour a finding describes — the named, bounded set (docs/17
/// §4, "no vague 'threat'"). Each maps up to a broad [`FindingCategory`] for
/// storage and carries its own human title and benign-explanation list (docs/18).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum FindingKind {
    /// A process not seen before reaching the network, especially unsigned
    /// (docs/18 §4.1). Rule/heuristic.
    UnexpectedEgress,
    /// Highly regular check-ins to one host — a beaconing shape (docs/18 §4.2).
    Beaconing,
    /// Connections fanned across many ports of one host (docs/18 §4.7).
    PortScan,
    /// A burst of DNS queries far above the usual rate (docs/18 §4.4).
    DnsAnomaly,
    /// One host contacted by an unusually large number of connections
    /// (docs/18 §4.8).
    ConnectionStorm,
    /// A flow whose volume deviates sharply from this machine's learned normal
    /// (docs/20 §3). Statistical anomaly.
    BandwidthAnomaly,
}

impl FindingKind {
    /// The broad storage category this kind rolls up to (docs/17 §4).
    pub fn category(self) -> FindingCategory {
        match self {
            FindingKind::BandwidthAnomaly => FindingCategory::Anomaly,
            FindingKind::UnexpectedEgress
            | FindingKind::Beaconing
            | FindingKind::PortScan
            | FindingKind::DnsAnomaly
            | FindingKind::ConnectionStorm => FindingCategory::Suspicious,
        }
    }

    /// A short, calm, non-accusatory title (docs/17 §7.1, docs/18 §10 language
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
        }
    }

    /// Innocent readings the finding must weigh (docs/18 §3, §4). Surfaced to the
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
        }
    }

    /// A non-destructive, observe-only suggestion (docs/17 §7.3, docs/01 X1).
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
        }
    }
}

/// A confidence-scored, evidence-backed security *observation* (docs/17 §4).
///
/// Public fields for reading, but constructible only through
/// [`SecurityFinding::observe`], so the evidence + explanation + calibrated-
/// confidence invariants hold by construction — mirroring how `Diagnosis` is
/// built only by `diagnose` (docs/11 §6).
#[derive(Debug, Clone, PartialEq)]
pub struct SecurityFinding {
    pub kind: FindingKind,
    /// Calibrated, capped below 1.0 for inferences (docs/17 §5).
    pub confidence: Confidence,
    /// Plain-language "why this is notable", including the honest limits of what
    /// we can tell (docs/17 §3.3). Never a verdict.
    pub explanation: String,
    /// Optional deeper/technical line, disclosed at Intermediate+ (docs/09 §6.3).
    pub technical: Option<String>,
    /// The exact data that triggered this — always non-empty (docs/02 §6.3).
    pub evidence: Vec<EvidenceRef>,
    /// Other kinds that corroborated into this one (docs/18 §5). Empty for a
    /// standalone finding; populated when the assembler merges signals.
    pub contributing: Vec<FindingKind>,
}

impl SecurityFinding {
    /// Build a finding, enforcing the honesty invariants (docs/17 §4):
    /// - `evidence` must be non-empty — a claim with nothing behind it cannot
    ///   exist (docs/02 §6.3);
    /// - `explanation` must be non-empty — every warning explains itself
    ///   (docs/01 §7);
    /// - confidence is clamped to at most [`MAX_INFERRED_CONFIDENCE`] so an
    ///   inference is never laundered into certainty (docs/01 X4).
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

    /// Attach a technical detail line, disclosed only at deeper modes (docs/14 §7).
    pub fn with_technical(mut self, technical: impl Into<String>) -> Self {
        self.technical = Some(technical.into());
        self
    }

    /// The calibrated confidence as a plain qualitative word (docs/17 §5), so a
    /// beginner isn't forced to interpret a raw percentage. Deliberately tentative
    /// — never "malicious", always "unusual" (docs/17 §12).
    pub fn qualitative(&self) -> &'static str {
        qualitative(self.confidence)
    }

    /// Project to the compact core [`netpulse_core::Finding`] storage record with
    /// a stable id (docs/08 §6). The rich text lives in the domain type / DTO; the
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

/// Map a calibrated confidence to a calm qualitative word (docs/17 §5). The
/// bands are deliberately conservative — a weak signal stays weak, and nothing
/// here ever reads as certainty (docs/01 X4).
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
        // No evidence → cannot construct (docs/02 §6.3).
        assert!(SecurityFinding::observe(FindingKind::Beaconing, 0.6, "regular", vec![]).is_none());
        // No explanation → cannot construct (docs/01 §7).
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
        // Even a detector shouting 1.0 is capped below certainty (docs/01 X4).
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
        // docs/18 §3: a detector that can't model innocence is a false-positive
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
