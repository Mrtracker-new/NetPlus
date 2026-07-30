//! A first-party **detector plugin** reference (docs/24 §4.2). It implements the
//! same [`Detector`] trait the built-ins use and emits [`Finding`]s through the
//! core model, which **structurally requires evidence** — a detector plugin
//! cannot emit a bare verdict (docs/24 §5, docs/17 §4). This toy detector flags a
//! flow that saw an unusually large number of "Other" protocol landmarks, purely
//! to demonstrate the shape; it always carries its evidence reference.
#![forbid(unsafe_code)]

use netpulse_core::model::{Confidence, EvidenceRef, Finding, FindingCategory, ProtoEvent};
use netpulse_core::Result;
use netpulse_plugin::{
    ContractVersion, Detector, PluginManifest, PluginType, Sha256Digest, TrustMetadata, TrustStatus,
};

/// Flags a flow with an unusually chatty stream of protocol landmarks.
#[derive(Debug)]
pub struct ChattyFlowDetector {
    /// The landmark count above which the flow is surfaced (informational).
    pub threshold: usize,
}

impl Default for ChattyFlowDetector {
    fn default() -> Self {
        Self { threshold: 8 }
    }
}

impl Detector for ChattyFlowDetector {
    fn id(&self) -> &'static str {
        "example.chatty-flow"
    }

    fn evaluate(&self, events: &[ProtoEvent]) -> Result<Vec<Finding>> {
        if events.len() < self.threshold {
            // Nothing unusual — no fabricated alarm (docs/17).
            return Ok(Vec::new());
        }
        let flow_id = events[0].flow_id;
        // The finding is un-constructible without evidence: it carries the flow it
        // rests on (docs/02 §6.3, docs/17 §4). Informational, never a verdict.
        Ok(vec![Finding {
            id: flow_id,
            category: FindingCategory::Informational,
            confidence: Confidence::new(0.5),
            evidence_refs: vec![EvidenceRef::Flow(flow_id)],
        }])
    }
}

/// The plugin's self-description (docs/24 §6): a first-party detector reference.
pub fn manifest() -> PluginManifest {
    PluginManifest {
        manifest_version: 1,
        name: "example-detector".into(),
        plugin_type: PluginType::Detector,
        target_contract: ContractVersion(4),
        trust: TrustMetadata {
            source: "in-tree:plugins/example-detector".into(),
            signatures: Vec::new(),
            status: TrustStatus::FirstParty,
        },
        payload_hash: Sha256Digest([0u8; 32]),
        signatures: Vec::new(),
        // Not a dissector, so the fuzz/explanation obligations don't gate it; a
        // detector instead ships positive + benign fixtures (docs/18 §10), which
        // this crate's tests stand in for.
        fuzzed: false,
        has_explanation: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::model::ProtoEventKind;
    use netpulse_core::time::Timestamp;
    use netpulse_plugin::PluginRegistry;

    fn event(flow_id: u64) -> ProtoEvent {
        ProtoEvent {
            flow_id,
            ts: Timestamp::new(0, 0),
            kind: ProtoEventKind::Other("x".into()),
        }
    }

    #[test]
    fn finding_always_carries_evidence() {
        // Honesty by construction (docs/24 §5): a plugin finding cannot exist
        // without its evidence reference.
        let d = ChattyFlowDetector::default();
        let findings = d.evaluate(&vec![event(42); 10]).unwrap();
        assert_eq!(findings.len(), 1);
        assert!(!findings[0].evidence_refs.is_empty());
        assert!(findings[0].confidence.value() < 1.0); // never certainty
    }

    #[test]
    fn quiet_flow_yields_nothing() {
        let d = ChattyFlowDetector::default();
        assert!(d.evaluate(&vec![event(1); 3]).unwrap().is_empty());
    }

    #[test]
    fn first_party_detector_auto_enables() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest();
        reg.register(netpulse_plugin::VerificationOutcome {
            manifest: m,
            claimed_trust: TrustStatus::FirstParty,
            effective_trust: TrustStatus::FirstParty,
            verification_result: Ok(netpulse_plugin::VerificationSuccess::FirstParty(
                "in-tree-key".into(),
            )),
            payload_hash_valid: true,
        });
        assert!(reg.plugins()[0].enabled);
    }
}
