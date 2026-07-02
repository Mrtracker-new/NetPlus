//! Context construction (docs/19 §5): turning a question into the *right*
//! evidence, distilled compactly. A [`DistilledContext`] is the structured,
//! minimized bundle a backend reasons over — a few facts, each tied to the exact
//! records that justify it (docs/19 §5, docs/02 §6.3). It is deliberately **not**
//! a raw capture dump: it is small, fast, cheap, and privacy-preserving, which is
//! also exactly what makes a remote send safe to disclose (docs/19 §4.3, §10).

use netpulse_core::EvidenceRef;

/// The kind of question, inferred from the user's words (docs/19 §5 step 1). Each
/// intent knows how to frame its answer and how to decline honestly when there is
/// nothing to say (docs/19 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Intent {
    /// "Which app/host used the most bandwidth?"
    TopBandwidth,
    /// "What protocols am I using?" / "what kind of traffic is this?"
    ProtocolMix,
    /// "How many connections / who did I talk to?"
    Connectivity,
    /// "Why was it slow / why did it buffer?"
    Degradation,
    /// "What happened / summarize."
    Summary,
    /// Unrecognised — the assistant asks for a rephrase rather than guessing
    /// (docs/19 §9 ambiguous question).
    Unknown,
}

impl Intent {
    /// Classify a free-text question by keyword (docs/19 §5 step 1). Deliberately
    /// simple and deterministic so answers are reproducible for regression tests
    /// (docs/19 §11 determinism).
    pub fn classify(question: &str) -> Intent {
        let q = question.to_lowercase();
        let has = |words: &[&str]| words.iter().any(|w| q.contains(w));
        if has(&[
            "bandwidth",
            "most data",
            "used the most",
            "top",
            "heaviest",
            "biggest",
        ]) {
            Intent::TopBandwidth
        } else if has(&["slow", "buffer", "lag", "loss", "why was it", "why did it"]) {
            Intent::Degradation
        } else if has(&[
            "protocol",
            "tls",
            "encrypted",
            "quic",
            "http",
            "dns",
            "kind of traffic",
        ]) {
            Intent::ProtocolMix
        } else if has(&[
            "how many",
            "connection",
            "who did i",
            "hosts",
            "servers",
            "talk to",
        ]) {
            Intent::Connectivity
        } else if has(&[
            "what happened",
            "summar",
            "overview",
            "recap",
            "today",
            "since",
        ]) {
            Intent::Summary
        } else {
            Intent::Unknown
        }
    }

    /// The opening line the backend uses to frame a grounded answer (docs/19 §6).
    pub fn lead_in(self) -> &'static str {
        match self {
            Intent::TopBandwidth => "Looking at your captured flows, ranked by volume:",
            Intent::ProtocolMix => "Here's the mix of protocols in your captured traffic:",
            Intent::Connectivity => "Here's who your captured traffic reached:",
            Intent::Degradation => {
                "Here's what your captured data shows about slowness — I can only point at what's \
                 in the evidence, not guess beyond it:"
            }
            Intent::Summary => "Here's a grounded summary of your captured traffic:",
            Intent::Unknown => "I explain your captured network data. Here's what I can see:",
        }
    }

    /// The honest reply when there is no evidence to answer (docs/19 §3, §9). Never
    /// a fabricated answer — a limit turned into guidance.
    pub fn insufficient_reply(self) -> &'static str {
        match self {
            Intent::Unknown => {
                "I'm not sure what you're asking. I can explain your bandwidth, protocols, who you \
                 connected to, why something was slow, or summarize your capture — try one of those."
            }
            _ => {
                "I don't see enough in your captured data to answer that yet. Capture some traffic \
                 (browse a few sites) and ask again."
            }
        }
    }
}

/// One grounded fact: a plain statement plus the evidence that backs it (docs/19
/// §3). A fact with no evidence is a bug — the assistant never builds one.
#[derive(Debug, Clone, PartialEq)]
pub struct Fact {
    pub text: String,
    pub evidence: Vec<EvidenceRef>,
}

/// The distilled, minimized context a backend explains (docs/19 §5). Compact by
/// design: a handful of facts, not a capture dump (docs/19 §10).
#[derive(Debug, Clone, PartialEq)]
pub struct DistilledContext {
    /// The user's original question, carried for the backend's framing.
    pub question: String,
    pub intent: Intent,
    /// The grounded facts, most-relevant first. May be empty → honest "can't
    /// answer" (docs/19 §3).
    pub facts: Vec<Fact>,
}

impl DistilledContext {
    /// The union of every fact's evidence, de-duplicated in order — the citations
    /// an answer must reference (docs/19 §3). The assistant validates these
    /// against the store before returning (docs/19 §12).
    pub fn citations(&self) -> Vec<EvidenceRef> {
        let mut out: Vec<EvidenceRef> = Vec::new();
        for fact in &self.facts {
            for e in &fact.evidence {
                if !out.contains(e) {
                    out.push(*e);
                }
            }
        }
        out
    }

    /// Exactly what would be transmitted if a remote backend were used, in plain
    /// terms (docs/19 §4.3 per-request disclosure). It is the distilled facts —
    /// **never** raw packets (docs/19 §4.3, docs/02 §10.3) — so the user can see
    /// and approve the full payload before any send. Nothing else leaves.
    pub fn disclosure_preview(&self) -> String {
        let mut out = String::new();
        out.push_str("If you use a remote assistant, only this minimized context is sent:\n");
        out.push_str(&format!("  question: {}\n", self.question));
        if self.facts.is_empty() {
            out.push_str("  (no traffic facts — nothing about your capture would be sent)\n");
        } else {
            out.push_str("  facts:\n");
            for fact in &self.facts {
                out.push_str(&format!("    - {}\n", fact.text));
            }
        }
        out.push_str("No packet payloads, IP-level raw records, or capture files are ever sent.");
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_questions() {
        assert_eq!(
            Intent::classify("Which app used the most bandwidth today?"),
            Intent::TopBandwidth
        );
        assert_eq!(
            Intent::classify("Why did YouTube buffer?"),
            Intent::Degradation
        );
        assert_eq!(
            Intent::classify("What protocols am I using?"),
            Intent::ProtocolMix
        );
        assert_eq!(Intent::classify("blorp?"), Intent::Unknown);
    }

    #[test]
    fn disclosure_preview_lists_only_distilled_facts() {
        let ctx = DistilledContext {
            question: "which app used the most bandwidth?".into(),
            intent: Intent::TopBandwidth,
            facts: vec![Fact {
                text: "203.0.113.9 moved 5.0 MB".into(),
                evidence: vec![EvidenceRef::Flow(1)],
            }],
        };
        let preview = ctx.disclosure_preview();
        assert!(preview.contains("203.0.113.9 moved 5.0 MB"));
        // The guarantee: no raw payloads ever (docs/19 §4.3).
        assert!(preview.contains("No packet payloads"));
    }

    #[test]
    fn citations_dedup_in_order() {
        let ctx = DistilledContext {
            question: "q".into(),
            intent: Intent::Summary,
            facts: vec![
                Fact {
                    text: "a".into(),
                    evidence: vec![EvidenceRef::Flow(1), EvidenceRef::Session(2)],
                },
                Fact {
                    text: "b".into(),
                    evidence: vec![EvidenceRef::Flow(1)],
                },
            ],
        };
        assert_eq!(
            ctx.citations(),
            vec![EvidenceRef::Flow(1), EvidenceRef::Session(2)]
        );
    }
}
