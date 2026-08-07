//! The narrative card — the unit of the Dashboard feed.
//!
//! A card summarizes one session or notable event in plain language. Its
//! anatomy is fixed by: a plain-language *headline* (what/who , a
//! one-line technical *summary* (depth scales with mode), *provenance* (links to
//! the evidence it summarizes), and *severity/affect* (neutral by default;
//! findings render calm and confidence-scored, never alarmist).
//!
//! The evidence-reference invariant is enforced by construction:
//! there is no way to build a card without at least one [`EvidenceRef`].

use netpulse_core::{Depth, EvidenceRef};
use serde::{Deserialize, Serialize};

/// The affect of a card. Neutral by default; findings are calm
/// and explained, never alarms. Colour is never the
/// sole carrier of meaning, so this also names the severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Severity {
    /// Ordinary activity — the overwhelming default.
    #[default]
    Neutral,
    /// Worth a glance, not a worry (e.g. an unfamiliar app, first-seen host).
    Notable,
    /// A confidence-scored finding surfaced calmly; still not an alarm.
    Finding,
}

/// One card in the narrative feed.
///
/// Construct via [`NarrativeCard::new`], which requires the provenance up front
/// so the evidence-reference invariant cannot be violated. `headline` is the
/// beginner-readable "what/who"; `lines` are technical detail ordered from
/// least to most advanced, disclosed progressively by [`NarrativeCard::render`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NarrativeCard {
    /// Plain-language "what happened / who did it" — no jargon.
    pub headline: String,
    /// Technical detail lines, each tagged with the minimum [`Depth`] at which
    /// it should appear. Kept ordered beginner→expert for stable rendering.
    lines: Vec<DepthLine>,
    /// Everything this card asserts is justified by these.
    evidence: Vec<EvidenceRef>,
    pub severity: Severity,
    /// Monotonic capture time of the summarized event, for feed ordering.
    pub at_mono_nanos: u64,
}

/// A technical detail line gated by the depth at which it becomes relevant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct DepthLine {
    min_depth: Depth,
    text: String,
}

impl NarrativeCard {
    /// Start a card. `evidence` must be non-empty — a card that summarizes
    /// nothing has nothing to say and would violate; the assert
    /// turns a would-be silent honesty bug into an immediate, loud failure.
    pub fn new(
        headline: impl Into<String>,
        at_mono_nanos: u64,
        evidence: Vec<EvidenceRef>,
    ) -> Self {
        assert!(
            !evidence.is_empty(),
            "a narrative card must reference its evidence"
        );
        Self {
            headline: headline.into(),
            lines: Vec::new(),
            evidence,
            severity: Severity::Neutral,
            at_mono_nanos,
        }
    }

    /// Set severity (builder style).
    pub fn with_severity(mut self, severity: Severity) -> Self {
        self.severity = severity;
        self
    }

    /// Add a detail line visible at `min_depth` and above (builder style).
    pub fn line(mut self, min_depth: Depth, text: impl Into<String>) -> Self {
        self.lines.push(DepthLine {
            min_depth,
            text: text.into(),
        });
        self
    }

    /// The evidence this card is built from. Always non-empty.
    pub fn evidence(&self) -> &[EvidenceRef] {
        &self.evidence
    }

    /// Render the card at a disclosure depth: the headline plus every detail
    /// line authored for `depth` or shallower.
    /// The same card yields a terse beginner summary or a dense expert one —
    /// density, not vocabulary, is the lever.
    pub fn render(&self, depth: Depth) -> Vec<String> {
        let mut out = Vec::with_capacity(1 + self.lines.len());
        out.push(self.headline.clone());
        for l in &self.lines {
            if depth.shows(l.min_depth) {
                out.push(l.text.clone());
            }
        }
        out
    }

    /// The one-line technical summary shown under the headline at `depth`
    /// — the visible detail lines joined with a middot, matching
    /// the card mockups ("TLS 1.3 · DNS 12 ms · 240 KB").
    pub fn summary(&self, depth: Depth) -> String {
        self.lines
            .iter()
            .filter(|l| depth.shows(l.min_depth))
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> NarrativeCard {
        NarrativeCard::new(
            "Chrome loaded example.com",
            1_000,
            vec![EvidenceRef::Session(7)],
        )
        .line(Depth::Beginner, "Encrypted (TLS)")
        .line(Depth::Intermediate, "DNS resolved in 12 ms")
        .line(Depth::Expert, "seq/ack, fingerprints available")
    }

    #[test]
    #[should_panic(expected = "must reference its evidence")]
    fn card_without_evidence_is_impossible() {
        // The invariant is structural: no evidence, no card.
        let _ = NarrativeCard::new("orphan", 0, vec![]);
    }

    #[test]
    fn render_depth_is_additive() {
        let c = card();
        // Beginner sees the headline + the beginner line only.
        assert_eq!(c.render(Depth::Beginner).len(), 2);
        // Intermediate adds the intermediate line.
        assert_eq!(c.render(Depth::Intermediate).len(), 3);
        // Expert sees everything.
        assert_eq!(c.render(Depth::Expert).len(), 4);
        // The headline is always present and first.
        assert_eq!(c.render(Depth::Beginner)[0], "Chrome loaded example.com");
    }

    #[test]
    fn summary_joins_visible_lines() {
        let c = card();
        assert_eq!(c.summary(Depth::Beginner), "Encrypted (TLS)");
        assert_eq!(
            c.summary(Depth::Intermediate),
            "Encrypted (TLS) · DNS resolved in 12 ms"
        );
    }

    #[test]
    fn evidence_is_preserved() {
        assert_eq!(card().evidence(), &[EvidenceRef::Session(7)]);
    }
}
