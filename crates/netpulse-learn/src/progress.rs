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

use crate::content::{lesson, CURRICULUM};
use crate::engine::LessonOffer;

/// A learner's status on one lesson.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[non_exhaustive]
pub enum LessonStatus {
    #[default]
    NotStarted,
    InProgress,
    Completed,
    Mastered,
}

/// Per-lesson progress with a `mastery` estimate in `0.0..=1.0`.
/// Mastery drives adaptivity; it is an *estimate*, updated by exercise
/// performance, never a grade.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    pub status: LessonStatus,
    pub mastery: f32,
    pub attempts: u32,
    pub correct_attempts: u32,
    pub completed: bool,
}

impl Default for Progress {
    fn default() -> Self {
        Self {
            status: LessonStatus::NotStarted,
            mastery: 0.0,
            attempts: 0,
            correct_attempts: 0,
            completed: false,
        }
    }
}

/// Mastery at or above this is considered "mastered" and no longer offered
/// unprompted.
pub const MASTERY_THRESHOLD: f32 = 0.8;

/// Overall curriculum progress summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurriculumSummary {
    pub total_lessons: usize,
    pub completed_lessons: usize,
    pub mastered_lessons: usize,
    pub in_progress_lessons: usize,
    pub overall_mastery_pct: u32,
    pub next_recommended_lesson_id: Option<String>,
}

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
    /// Sanitizes corrupted, NaN, or out-of-bound stored values.
    pub fn get(&self, lesson_id: &str) -> Progress {
        let mut p = self.by_lesson.get(lesson_id).copied().unwrap_or_default();
        if p.mastery.is_nan() || p.mastery.is_infinite() {
            p.mastery = 0.0;
        } else {
            p.mastery = p.mastery.clamp(0.0, 1.0);
        }
        if p.correct_attempts > p.attempts {
            p.correct_attempts = p.attempts;
        }
        p
    }

    /// Whether a lesson is mastered: at/above the threshold.
    pub fn is_mastered(&self, lesson_id: &str) -> bool {
        self.get(lesson_id).mastery >= MASTERY_THRESHOLD
    }

    /// Whether a lesson has been completed.
    pub fn is_completed(&self, lesson_id: &str) -> bool {
        let p = self.get(lesson_id);
        p.completed || p.status == LessonStatus::Completed || p.status == LessonStatus::Mastered
    }

    /// Check if all prerequisite lessons have been completed or mastered.
    pub fn are_prerequisites_met(&self, lesson_id: &str) -> bool {
        let Some(l) = lesson(lesson_id) else {
            return true;
        };
        l.prerequisites
            .iter()
            .all(|&prereq_id| self.is_completed(prereq_id))
    }

    /// Record an exercise result, updating the mastery estimate and status.
    /// Mastery moves as an exponential moving average toward 1.0
    /// on a correct answer and toward 0.0 on an incorrect one, so a single slip
    /// does not erase progress and a single fluke does not confer mastery.
    pub fn record_result(&mut self, lesson_id: &str, correct: bool) {
        let mut p = self.get(lesson_id);
        p.attempts = p.attempts.saturating_add(1);
        if correct {
            p.correct_attempts = p.correct_attempts.saturating_add(1);
            p.completed = true;
        }
        let target = if correct { 1.0 } else { 0.0 };
        // EMA with a gentle rate: several consistent results to cross a boundary.
        const RATE: f32 = 0.34;
        let mut current = if p.mastery.is_nan() || p.mastery.is_infinite() {
            0.0
        } else {
            p.mastery.clamp(0.0, 1.0)
        };
        current += (target - current) * RATE;
        p.mastery = if current.is_nan() || current.is_infinite() {
            0.0
        } else {
            current.clamp(0.0, 1.0)
        };
        p.status = if p.mastery >= MASTERY_THRESHOLD {
            LessonStatus::Mastered
        } else if p.completed {
            LessonStatus::Completed
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

    /// Mark a lesson as completed.
    pub fn mark_completed(&mut self, lesson_id: &str) {
        let mut p = self.get(lesson_id);
        p.completed = true;
        if p.status != LessonStatus::Mastered {
            p.status = LessonStatus::Completed;
        }
        self.by_lesson.insert(lesson_id.to_string(), p);
    }

    /// Reset all progress.
    pub fn reset(&mut self) {
        self.by_lesson.clear();
    }

    /// Recommend the next lesson to learn based on prerequisite satisfaction
    /// and lowest mastery score.
    pub fn recommended_lesson(&self) -> Option<&'static str> {
        let mut available = Vec::new();
        for module in CURRICULUM {
            for lesson in module.lessons {
                if !self.is_mastered(lesson.id) && self.are_prerequisites_met(lesson.id) {
                    let progress = self.get(lesson.id);
                    available.push((lesson, progress.mastery));
                }
            }
        }

        // Sort by level (Beginner first) then lowest mastery, then lesson id for deterministic stability
        available.sort_by(|(l_a, m_a), (l_b, m_b)| {
            l_a.level
                .cmp(&l_b.level)
                .then(m_a.partial_cmp(m_b).unwrap_or(std::cmp::Ordering::Equal))
                .then(l_a.id.cmp(l_b.id))
        });

        available.first().map(|(l, _)| l.id)
    }

    /// Compute high-level curriculum progress summary.
    pub fn summary(&self) -> CurriculumSummary {
        let all_lessons: Vec<&'static str> = CURRICULUM
            .iter()
            .flat_map(|m| m.lessons.iter())
            .map(|l| l.id)
            .collect();

        let total = all_lessons.len();
        let mut completed = 0;
        let mut mastered = 0;
        let mut in_progress = 0;
        let mut total_mastery = 0.0f32;

        for &id in &all_lessons {
            let p = self.get(id);
            total_mastery += p.mastery;
            if p.status == LessonStatus::Mastered {
                mastered += 1;
                completed += 1;
            } else if p.status == LessonStatus::Completed || p.completed {
                completed += 1;
            } else if p.status == LessonStatus::InProgress {
                in_progress += 1;
            }
        }

        let overall_mastery_pct =
            if total > 0 && !total_mastery.is_nan() && !total_mastery.is_infinite() {
                (((total_mastery / total as f32) * 100.0).round() as i64).clamp(0, 100) as u32
            } else {
                0
            };

        CurriculumSummary {
            total_lessons: total,
            completed_lessons: completed,
            mastered_lessons: mastered,
            in_progress_lessons: in_progress,
            overall_mastery_pct,
            next_recommended_lesson_id: self.recommended_lesson().map(str::to_string),
        }
    }

    /// Choose the next offer to surface, or `None` when nothing is worth
    /// surfacing. Adaptive and non-nagging: mastered lessons are
    /// filtered out, and among the rest the most foundational (lowest level,
    /// then least mastered) is preferred, nudging the learner along the spine
    /// "DNS → connect → encrypt" rather than repeating what they know.
    ///
    /// Returns a reference into `offers`; the caller decides whether to show it,
    /// and the learner can always dismiss it (calm).
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
        assert!(store.get("b3.dns").completed);
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

    #[test]
    fn prerequisite_checking_and_recommendations_work() {
        let mut store = ProgressStore::new();
        // b1.overview has no prerequisites -> met
        assert!(store.are_prerequisites_met("b1.overview"));
        // b3.dns requires b1.overview -> not met initially
        assert!(!store.are_prerequisites_met("b3.dns"));

        // Recommend b1.overview first
        assert_eq!(store.recommended_lesson(), Some("b1.overview"));

        // Complete b1.overview
        store.record_result("b1.overview", true);
        assert!(store.are_prerequisites_met("b3.dns"));

        // Summary updates accurately
        let summary = store.summary();
        assert!(summary.total_lessons >= 5);
        assert_eq!(summary.completed_lessons, 1);
    }

    #[test]
    fn test_corrupted_float_and_attempt_sanitization() {
        // Construct JSON with NaN, Infinity, out-of-range mastery, and desynced counters
        let corrupted_json = r#"{
            "by_lesson": {
                "b4.handshake": {
                    "status": "InProgress",
                    "mastery": 999.0,
                    "attempts": 5,
                    "correct_attempts": 10,
                    "completed": false
                },
                "b3.dns": {
                    "status": "NotStarted",
                    "mastery": -5.0,
                    "attempts": 0,
                    "correct_attempts": 0,
                    "completed": false
                }
            }
        }"#;

        let mut store: ProgressStore = serde_json::from_str(corrupted_json).unwrap();

        // 1. Check get() sanitization
        let p_handshake = store.get("b4.handshake");
        assert_eq!(
            p_handshake.mastery, 1.0,
            "Mastery must be clamped to <= 1.0"
        );
        assert_eq!(
            p_handshake.correct_attempts, 5,
            "correct_attempts cannot exceed attempts"
        );

        let p_dns = store.get("b3.dns");
        assert_eq!(p_dns.mastery, 0.0, "Mastery must be clamped to >= 0.0");

        // 2. Test record_result on corrupted entry
        store.record_result("b4.handshake", false);
        let updated = store.get("b4.handshake");
        assert!(updated.mastery >= 0.0 && updated.mastery <= 1.0);
        assert!(!updated.mastery.is_nan());
        assert!(!updated.mastery.is_infinite());

        // 3. Summary on sanitized values
        let summary = store.summary();
        assert!(summary.overall_mastery_pct <= 100);
    }

    #[test]
    fn test_curriculum_graph_has_no_cycles() {
        // Verify prerequisite graph is an acyclic DAG using DFS with active path detection
        fn check_cycle(curr: &'static str, path: &mut Vec<&'static str>) {
            assert!(
                !path.contains(&curr),
                "Cycle detected in curriculum prerequisites: {:?} -> {}",
                path,
                curr
            );
            if let Some(l) = crate::content::lesson(curr) {
                path.push(curr);
                for &prereq in l.prerequisites {
                    check_cycle(prereq, path);
                }
                path.pop();
            }
        }

        for module in CURRICULUM {
            for lesson in module.lessons {
                let mut path = Vec::new();
                check_cycle(lesson.id, &mut path);
            }
        }
    }
}
