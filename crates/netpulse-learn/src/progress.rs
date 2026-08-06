//! Progress tracking and adaptivity. Learning is a loop: after a
//! lesson checks understanding, the engine updates a per-concept **mastery**
//! estimate and uses it to decide what to offer next, and at what depth.
//!
//! Two principles are load-bearing:
//! - **Local-first**: progress lives in the learner's own store
//!   and is *never uploaded*. These types are `serde`-serializable so
//!   the engine can persist them alongside settings — nothing more.
//! - **Non-nagging**: the adaptive next-offer is
//!   calm and *optional*. Mastered concepts are not re-taught; when nothing is
//!   worth offering, the answer is honestly `None`, not a manufactured prompt.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::engine::LessonOffer;

/// A learner's status on one lesson.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[non_exhaustive]
pub enum LessonStatus {
    #[default]
    NotStarted,
    InProgress,
    Mastered,
}

/// Per-lesson progress with a `mastery` estimate in `0.0.=1.0`.
/// Mastery drives adaptivity; it is an *estimate*, updated by exercise
/// performance, never a grade.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    pub status: LessonStatus,
    pub mastery: f32,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            status: LessonStatus::NotStarted,
            mastery: 0.0,
        }
    }
}

/// Mastery at or above this is considered "mastered" and no longer offered
/// unprompted.
pub const MASTERY_THRESHOLD: f32 = 0.8;

/// The learner's progress across lessons. Local-only; serialized
/// into the capture/settings store, never transmitted.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProgressStore {
    /// Keyed by lesson id.
    by_lesson: HashMap<String, Progress>,
}

impl ProgressStore {
    /// An empty progress store (a first-run learner).
    pub fn new() -> Self {
        Self::default()
    }

    /// Progress on one lesson, defaulting to `NotStarted` for an untouched one.
    pub fn get(&self, lesson_id: &str) -> Progress {
        self.by_lesson.get(lesson_id).copied().unwrap_or_default()
    }

    /// Whether a lesson is mastered: at/above the threshold.
    pub fn is_mastered(&self, lesson_id: &str) -> bool {
        self.get(lesson_id).mastery >= MASTERY_THRESHOLD
    }

    /// Record an exercise result, updating the mastery estimate and status
    ///Mastery moves as an exponential moving average toward 1.0
    /// on a correct answer and toward 0.0 on an incorrect one, so a single slip
    /// does not erase progress and a single fluke does not confer mastery.
    pub fn record_result(&mut self, lesson_id: &str, correct: bool) {
        let mut p = self.get(lesson_id);
        let target = if correct { 1.0 } else { 0.0 };
        // EMA with a gentle rate: several consistent results to cross a boundary.
        const RATE: f32 = 0.34;
        p.mastery += (target - p.mastery) * RATE;
        p.mastery = p.mastery.clamp(0.0, 1.0);
        p.status = if p.mastery >= MASTERY_THRESHOLD {
            LessonStatus::Mastered
        } else {
            LessonStatus::InProgress
        };
        self.by_lesson.insert(lesson_id.to_string(), p);
    }

    /// Mark a lesson opened (moves `NotStarted` → `InProgress`) without changing
    /// mastery — used when the learner begins but hasn't answered yet.
    pub fn mark_started(&mut self, lesson_id: &str) {
        let mut p = self.get(lesson_id);
        if p.status == LessonStatus::NotStarted {
            p.status = LessonStatus::InProgress;
            self.by_lesson.insert(lesson_id.to_string(), p);
        }
    }

    /// Choose the next offer to surface, or `None` when nothing is worth
    /// surfacing. Adaptive and non-nagging: mastered lessons are
    /// filtered out, and among the rest the most foundational (lowest level,
    /// then least mastered) is preferred, nudging the learner along the spine
    /// "DNS → connect → encrypt" rather than repeating what they know.
    ///
    /// Returns a reference into `offers`; the caller decides whether to show it,
    /// and the learner can always dismiss it (calm .
    pub fn next_offer<'a>(&self, offers: &'a [LessonOffer]) -> Option<&'a LessonOffer> {
        offers
            .iter()
            .filter(|o| !self.is_mastered(o.lesson_id))
            .min_by(|a, b| {
                a.level.cmp(&b.level).then_with(|| {
                    // Prefer the less-mastered of two same-level lessons.
                    let ma = self.get(a.lesson_id).mastery;
                    let mb = self.get(b.lesson_id).mastery;
                    ma.partial_cmp(&mb)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.lesson_id.cmp(b.lesson_id))
                })
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{Level, Trigger};

    fn offer(id: &'static str, level: Level) -> LessonOffer {
        LessonOffer {
            lesson_id: id,
            title: "t",
            level,
            trigger: Trigger::None,
            grounding: vec![],
            exercise: None,
            evidence: vec![],
            grounded: false,
        }
    }

    #[test]
    fn mastery_requires_repeated_success_not_one_fluke() {
        let mut store = ProgressStore::new();
        store.record_result("b3.dns", true);
        // One correct answer must not confer mastery.
        assert!(!store.is_mastered("b3.dns"));
        for _ in 0..6 {
            store.record_result("b3.dns", true);
        }
        assert!(store.is_mastered("b3.dns"));
        assert_eq!(store.get("b3.dns").status, LessonStatus::Mastered);
    }

    #[test]
    fn a_single_slip_does_not_erase_progress() {
        let mut store = ProgressStore::new();
        for _ in 0..8 {
            store.record_result("b3.dns", true);
        }
        let before = store.get("b3.dns").mastery;
        store.record_result("b3.dns", false);
        let after = store.get("b3.dns").mastery;
        assert!(after < before, "a wrong answer lowers the estimate");
        assert!(after > 0.4, "but does not wipe out prior mastery");
    }

    #[test]
    fn next_offer_skips_mastered_and_prefers_foundational() {
        let mut store = ProgressStore::new();
        for _ in 0..8 {
            store.record_result("b3.dns", true); // master DNS
        }
        let offers = [
            offer("b3.dns", Level::Beginner),
            offer("b5.encryption", Level::Beginner),
            offer("i4.loss", Level::Intermediate),
        ];
        let next = store.next_offer(&offers).expect("something to offer");
        // DNS is mastered → skipped; a Beginner lesson beats the Intermediate one.
        assert_eq!(next.lesson_id, "b5.encryption");
    }

    #[test]
    fn nothing_to_offer_is_honestly_none() {
        let mut store = ProgressStore::new();
        for _ in 0..8 {
            store.record_result("b3.dns", true);
        }
        let offers = [offer("b3.dns", Level::Beginner)];
        // The only offer is mastered → no nag.
        assert!(store.next_offer(&offers).is_none());
    }

    #[test]
    fn progress_round_trips_through_serde() {
        // Progress persists locally across restart.
        let mut store = ProgressStore::new();
        store.record_result("b4.handshake", true);
        store.mark_started("b5.encryption");
        let json = serde_json::to_string(&store).unwrap();
        let back: ProgressStore = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.get("b4.handshake").status,
            store.get("b4.handshake").status
        );
        assert_eq!(back.get("b5.encryption").status, LessonStatus::InProgress);
    }
}
