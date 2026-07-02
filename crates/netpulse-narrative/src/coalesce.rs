//! Coalescing high-frequency cards into rolling summaries (docs/09 §7).
//!
//! Under a traffic storm, emitting one card per event would both bury the story
//! (docs/01 §7.6, "calm, not noisy") and overwhelm the renderer (docs/09 §13).
//! Instead, bursts of same-headline cards within a time window collapse into a
//! single summary card ("Chrome: 320 connections in the last second") while
//! *preserving every card's evidence* — the count is real and each reference is
//! carried through, so drill-down still reaches all of it (docs/02 §6.3).

use crate::card::{NarrativeCard, Severity};

/// Collapse runs of cards that share a headline and fall within
/// `window_nanos` of each other into one summary card. Input is assumed
/// feed-ordered (newest first, as [`crate::build_cards`] returns); output keeps
/// that order. A run of one card passes through unchanged.
///
/// The merged card unions the evidence of every card it represents, so no
/// provenance is lost when the feed is compacted (docs/09 §7).
pub fn coalesce(cards: Vec<NarrativeCard>, window_nanos: u64) -> Vec<NarrativeCard> {
    let mut out: Vec<NarrativeCard> = Vec::new();
    let mut iter = cards.into_iter();
    let Some(mut run_seed) = iter.next() else {
        return out;
    };
    let mut run: Vec<NarrativeCard> = vec![run_seed.clone()];

    for card in iter {
        let same_group = card.headline == run_seed.headline
            && run_seed.at_mono_nanos.saturating_sub(card.at_mono_nanos) <= window_nanos;
        if same_group {
            run.push(card);
        } else {
            out.push(merge_run(std::mem::take(&mut run)));
            run_seed = card.clone();
            run.push(card);
        }
    }
    out.push(merge_run(run));
    out
}

/// Merge a run of same-headline cards into one. A single-card run is returned
/// as-is; a multi-card run becomes a summary that counts the burst and unions
/// all evidence (docs/09 §7).
fn merge_run(mut run: Vec<NarrativeCard>) -> NarrativeCard {
    if run.len() == 1 {
        return run.pop().expect("run has one element");
    }
    let count = run.len();
    // Anchor on the newest card in the run (runs are newest-first).
    let newest = &run[0];
    let mut evidence = Vec::new();
    for c in &run {
        evidence.extend_from_slice(c.evidence());
    }
    // Preserve the loudest severity in the run — a finding in a burst must not be
    // hidden by coalescing (docs/09 §5.2, findings stay visible).
    let severity = run
        .iter()
        .map(|c| c.severity)
        .max_by_key(|s| severity_rank(*s))
        .unwrap_or(Severity::Neutral);

    NarrativeCard::new(
        format!("{} ×{count}", newest.headline),
        newest.at_mono_nanos,
        evidence,
    )
    .with_severity(severity)
    .line(
        netpulse_core::Depth::Beginner,
        format!("{count} similar events coalesced"),
    )
}

fn severity_rank(s: Severity) -> u8 {
    match s {
        Severity::Neutral => 0,
        Severity::Notable => 1,
        Severity::Finding => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::EvidenceRef;

    fn card(headline: &str, at: u64, ev: u64) -> NarrativeCard {
        NarrativeCard::new(headline, at, vec![EvidenceRef::Flow(ev)])
    }

    #[test]
    fn single_cards_pass_through() {
        let cards = vec![card("A", 100, 1)];
        let out = coalesce(cards, 1_000);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].headline, "A");
    }

    #[test]
    fn burst_of_same_headline_coalesces_and_unions_evidence() {
        // Three "Chrome" cards within the window collapse to one ×3 summary.
        let cards = vec![
            card("Chrome connected", 3_000, 3),
            card("Chrome connected", 2_500, 2),
            card("Chrome connected", 2_000, 1),
        ];
        let out = coalesce(cards, 2_000);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].headline, "Chrome connected ×3");
        // All three flows remain reachable via the merged card (docs/02 §6.3).
        assert_eq!(out[0].evidence().len(), 3);
    }

    #[test]
    fn different_headlines_do_not_merge() {
        let cards = vec![card("A", 3_000, 1), card("B", 2_900, 2)];
        let out = coalesce(cards, 5_000);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn events_outside_window_stay_separate() {
        let cards = vec![
            card("A", 10_000, 1),
            card("A", 1_000, 2), // 9s earlier, window is 2s
        ];
        let out = coalesce(cards, 2_000);
        assert_eq!(out.len(), 2, "gap wider than window is not coalesced");
    }

    #[test]
    fn finding_severity_survives_coalescing() {
        let mut findy = card("X", 3_000, 3);
        findy.severity = Severity::Finding;
        let cards = vec![findy, card("X", 2_900, 2), card("X", 2_800, 1)];
        let out = coalesce(cards, 2_000);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].severity,
            Severity::Finding,
            "a finding is not buried"
        );
    }
}
