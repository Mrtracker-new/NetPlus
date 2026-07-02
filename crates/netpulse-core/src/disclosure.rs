//! Progressive-disclosure depth (docs/09 §6) — the UX backbone of all of
//! Phase 2/3, defined here because more than one crate speaks it.
//!
//! The design bet (docs/01 §7.3, docs/09 §6.1): there is exactly **one** data
//! model; the depth only chooses *how much of it is shown by default*. Nothing
//! is deleted for a beginner — only deferred, always one step away. So this is
//! not a filter that removes truth; it is a projection selector.
//!
//! The same value is a **UI disclosure mode** on the frontend and a
//! **projection depth** on a query (docs/09 §6.3), so a beginner card never
//! hauls raw payloads across the API boundary. Keeping the enum in `core` means
//! narrative (docs/09), monitoring (docs/11) and the API contract (docs/02 §7)
//! all agree on the ladder.

use serde::{Deserialize, Serialize};

/// How much of the one model to render/return by default (docs/09 §6.2).
///
/// Ordered: `Beginner < Intermediate < Expert`. A projection at a given depth
/// includes everything at the depths below it — depth is additive, never
/// subtractive, mirroring "progressive *disclosure*, not progressive
/// *deprivation*" (docs/09 §6.3).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Hash, Serialize, Deserialize,
)]
#[non_exhaustive]
pub enum Depth {
    /// Narratives, plain words, no jargon in headlines. First-run default
    /// (docs/09 §6.3).
    #[default]
    Beginner,
    /// Flows, protocols, key metrics, host orgs — semi-technical.
    Intermediate,
    /// Everything: raw fields, sequence numbers, fingerprints, packet bytes.
    Expert,
}

impl Depth {
    /// Whether content authored for `required` depth should be shown at `self`.
    /// True when `self` is at least as deep as what the content needs — the
    /// additive rule (an expert view shows beginner content too, docs/09 §6.1).
    pub fn shows(self, required: Depth) -> bool {
        self >= required
    }
}

#[cfg(test)]
mod tests {
    use super::Depth;

    #[test]
    fn default_is_beginner() {
        // First run defaults to Beginner (docs/09 §6.3).
        assert_eq!(Depth::default(), Depth::Beginner);
    }

    #[test]
    fn depth_is_additive_not_subtractive() {
        // An expert view still shows beginner-level content (docs/09 §6.1).
        assert!(Depth::Expert.shows(Depth::Beginner));
        assert!(Depth::Expert.shows(Depth::Intermediate));
        assert!(Depth::Intermediate.shows(Depth::Beginner));
        // A beginner view does not pull in expert detail by default.
        assert!(!Depth::Beginner.shows(Depth::Expert));
        assert!(!Depth::Beginner.shows(Depth::Intermediate));
    }

    #[test]
    fn ordering_matches_ladder() {
        assert!(Depth::Beginner < Depth::Intermediate);
        assert!(Depth::Intermediate < Depth::Expert);
    }
}
