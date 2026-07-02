//! The pluggable explanation backend (docs/19 §4, docs/03 §11). The default is
//! **local** and does zero egress; a remote endpoint is an explicit, disclosed
//! opt-in (docs/19 §4.1–4.2). Whichever backend, it is handed a *distilled,
//! grounded* [`DistilledContext`] and must explain **only** that — it may add no
//! facts of its own (docs/19 §3, the iron rule).
//!
//! Confining egress to this crate makes the privacy guarantee auditable (docs/02
//! §10.1): the only type that could ever leave the device is a
//! [`DistilledContext`], and exactly what it discloses is inspectable via
//! [`DistilledContext::disclosure_preview`] before any send (docs/19 §4.3).

use crate::context::DistilledContext;

/// A pluggable explanation backend (docs/19 §4). Local by default; remote is an
/// explicit, disclosed opt-in.
pub trait AiBackend: std::fmt::Debug {
    /// Stable backend identifier (e.g. "local-template", "remote-openai"),
    /// surfaced to the user so the active posture is always visible (docs/19 §4).
    fn id(&self) -> &'static str;

    /// True if using this backend causes any network egress. The UI discloses the
    /// privacy posture before a query runs (docs/19 §4).
    fn is_remote(&self) -> bool;

    /// Produce a grounded explanation for `context`. The backend must explain the
    /// provided facts and cite their evidence, adding nothing of its own (docs/19
    /// §3). Returns the answer text; the assistant validates its citations against
    /// the store afterwards (docs/19 §12), so grounding is *checked, not trusted*.
    fn explain(&self, context: &DistilledContext) -> String;
}

/// The default, zero-egress backend (docs/19 §4.1, §9). It composes the distilled
/// facts into a plain-language answer deterministically — no model, no network —
/// so NetPulse is fully explanatory offline (docs/03 §16 graceful degradation).
/// Eloquence is modest; honesty and grounding are intact, which is the trade the
/// design chooses (docs/19 §9 "degraded eloquence, intact honesty").
#[derive(Debug, Default, Clone, Copy)]
pub struct LocalTemplateBackend;

impl AiBackend for LocalTemplateBackend {
    fn id(&self) -> &'static str {
        "local-template"
    }

    fn is_remote(&self) -> bool {
        false // zero egress by construction (docs/19 §4.1)
    }

    fn explain(&self, context: &DistilledContext) -> String {
        if context.facts.is_empty() {
            // Honest "can't answer" rather than a fabricated one (docs/19 §3, §9).
            return context.intent.insufficient_reply().to_string();
        }
        // Lead with the intent's framing, then each grounded fact on its own line.
        // Every line here traces to a fact that carries evidence, so the answer is
        // cited by construction (docs/19 §6, §3).
        let mut out = String::new();
        out.push_str(context.intent.lead_in());
        for fact in &context.facts {
            out.push_str("\n• ");
            out.push_str(&fact.text);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{DistilledContext, Fact, Intent};
    use netpulse_core::EvidenceRef;

    #[test]
    fn local_backend_is_zero_egress() {
        let b = LocalTemplateBackend;
        assert!(!b.is_remote());
        assert_eq!(b.id(), "local-template");
    }

    #[test]
    fn local_backend_explains_only_the_given_facts() {
        let ctx = DistilledContext {
            question: "which app used the most bandwidth?".into(),
            intent: Intent::TopBandwidth,
            facts: vec![Fact {
                text: "203.0.113.9 moved 5.0 MB across 3 flows".into(),
                evidence: vec![EvidenceRef::Flow(1)],
            }],
        };
        let text = LocalTemplateBackend.explain(&ctx);
        assert!(text.contains("203.0.113.9"));
        assert!(text.contains("5.0 MB"));
    }

    #[test]
    fn empty_context_yields_honest_cant_answer() {
        let ctx = DistilledContext {
            question: "which app used the most bandwidth?".into(),
            intent: Intent::TopBandwidth,
            facts: vec![],
        };
        let text = LocalTemplateBackend.explain(&ctx);
        assert!(text.to_lowercase().contains("don't see enough"));
    }
}
