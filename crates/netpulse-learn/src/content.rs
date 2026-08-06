//! The education content model — authored as **data**,
//! not code. A technical writer can add a module, lesson, step, or exercise
//! without touching the engine, exactly as the explanation-key content is
//! authorable in. The engine (`super::engine` *selects* this
//! content when the user's real traffic warrants it; it never invents it.
//!
//! Every step is wired to an [`ExplanationKey`]: the same
//! identifier the dissectors emit, the explorer browses, and the animations
//! key off — one vocabulary unifies the whole education system.
//! That wiring is what keeps a lesson from ever drifting from the engine's
//! reality: a lesson about the handshake cites `tcp.flags.syn`, and the value
//! it shows is pulled from the learner's captured packet, not a textbook.

use netpulse_decode::ExplanationKey;
use serde::{Deserialize, Serialize};

/// A learner-progression level. Mirrors [`netpulse_core::Depth`]
/// so a lesson's level and the UI's disclosure mode speak the same ladder — a
/// Beginner-mode learner is offered Beginner lessons first.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Hash, Serialize, Deserialize,
)]
#[non_exhaustive]
pub enum Level {
    #[default]
    Beginner,
    Intermediate,
    Expert,
}

impl Level {
    /// Map to the equivalent core disclosure depth, so content authored for a
    /// level renders at the matching mode.
    pub fn as_depth(self) -> netpulse_core::Depth {
        match self {
            Level::Beginner => netpulse_core::Depth::Beginner,
            Level::Intermediate => netpulse_core::Depth::Intermediate,
            Level::Expert => netpulse_core::Depth::Expert,
        }
    }
}

/// What real-traffic moment can launch a lesson *grounded* in the learner's own
/// data. The engine watches the event stream for these and offers
/// the matching lesson citing the real evidence. A lesson
/// with [`Trigger::None`] is always available but never *grounded* on its own —
/// it falls back to a curated example.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Trigger {
    /// A DNS query/response was observed — "how your computer found the address".
    DnsLookup,
    /// A TCP three-way handshake — "how a connection is established".
    TcpHandshake,
    /// A TLS handshake — "how your connection got encrypted".
    TlsHandshake,
    /// An HTTP request/response — "how your browser asked for the page".
    HttpExchange,
    /// A retransmission / loss burst — "what packet loss is and why it slows things".
    LossBurst,
    /// A fan-out across many hosts — "why one website talks to many servers".
    FanOut,
    /// A full page-load session — the flagship journey.
    PageLoad,
    /// No live trigger; conceptual lesson, curated-example grounded.
    None,
}

/// A reference to an animation embedded in a step. It is only the
/// *identifier*; the animation model itself is built from real events by
/// [`super::anim`], keyed the same way so lesson and animation stay in sync
///
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum AnimationRef {
    TcpHandshake,
    TlsHandshake,
    Multiplexing,
    FanOut,
    Degradation,
}

/// A comprehension-check kind. Grounded checks operate on the
/// learner's *own* captured evidence, which only NetPulse can generate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum ExerciseKind {
    /// Find/point to a field or packet in real data ("point to the SYN").
    Identify,
    /// Choose the correct plain-language description.
    ExplainBack,
    /// Predict what happens next ("what follows this SYN?").
    Predict,
    /// Given a real slow session, identify the likely cause (ties to .
    Diagnose,
}

/// One comprehension check within a lesson. `answer_key` names the
/// explanation key whose real value in the learner's capture is the correct
/// answer, so the engine can *derive* the answer from the fixture rather than
/// hard-coding it.
///
/// Authored as static data (it holds `&'static` content), so it is `Clone` but
/// not `Deserialize` — the catalog is compiled in, never received over the wire.
#[derive(Debug, Clone, PartialEq)]
pub struct Exercise {
    pub id: &'static str,
    pub kind: ExerciseKind,
    pub prompt: &'static str,
    /// The key whose observed value is the correct answer (for grounded checks).
    pub answer_key: Option<ExplanationKey>,
}

/// One unit of explanation within a lesson. It carries no prose of
/// its own: `body_key` addresses the [`netpulse_decode::explain`] content store,
/// so the same authored text serves the lesson, the explorer, and the tooltip —
/// no duplication, no drift.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub id: &'static str,
    /// The explanation-key providing this step's layered content.
    pub body_key: ExplanationKey,
    /// Optional animation to embed, driven by the learner's real data.
    pub anim: Option<AnimationRef>,
}

/// A single teachable concept. Its `trigger` says what real-traffic
/// moment can ground it; its steps reference explanation keys; its exercises
/// check understanding on the learner's own data.
#[derive(Debug, Clone, PartialEq)]
pub struct Lesson {
    pub id: &'static str,
    pub title: &'static str,
    pub level: Level,
    pub trigger: Trigger,
    pub steps: &'static [Step],
    pub exercises: &'static [Exercise],
}

/// A themed group of lessons — the unit of the curriculum map
///
#[derive(Debug, Clone, PartialEq)]
pub struct Module {
    pub id: &'static str,
    pub title: &'static str,
    pub level: Level,
    pub lessons: &'static [Lesson],
}

// ---- The authored curriculum --------------------------------
//
// A minimal-but-honest realization of the curriculum map: the beginner spine
// (DNS → connect → encrypt), the flagship page-load journey, and one
// intermediate diagnostic lesson. Each lesson's steps cite keys that
// `netpulse-decode` actually emits, so `curriculum_keys_all_resolve` (tests)
// proves "no dead ends" across the whole curriculum.

const DNS_STEPS: &[Step] = &[Step {
    id: "dns.what",
    body_key: ExplanationKey("dns.query"),
    anim: None,
}];

const DNS_EXERCISES: &[Exercise] = &[Exercise {
    id: "dns.identify",
    kind: ExerciseKind::Identify,
    prompt: "Point to the name your computer looked up.",
    answer_key: Some(ExplanationKey("dns.query")),
}];

const HANDSHAKE_STEPS: &[Step] = &[
    Step {
        id: "tcp.syn",
        body_key: ExplanationKey("tcp.flags.syn"),
        anim: Some(AnimationRef::TcpHandshake),
    },
    Step {
        id: "tcp.ack",
        body_key: ExplanationKey("tcp.flags.ack"),
        anim: Some(AnimationRef::TcpHandshake),
    },
];

const HANDSHAKE_EXERCISES: &[Exercise] = &[
    Exercise {
        id: "tcp.identify.syn",
        kind: ExerciseKind::Identify,
        prompt: "Which packet started the connection?",
        answer_key: Some(ExplanationKey("tcp.flags.syn")),
    },
    Exercise {
        id: "tcp.predict",
        kind: ExerciseKind::Predict,
        prompt: "After the SYN, what does the server send back?",
        answer_key: Some(ExplanationKey("tcp.flags.ack")),
    },
];

const TLS_STEPS: &[Step] = &[
    Step {
        id: "tls.hello",
        body_key: ExplanationKey("tls.handshake.client_hello"),
        anim: Some(AnimationRef::TlsHandshake),
    },
    Step {
        id: "tls.sni",
        body_key: ExplanationKey("tls.sni"),
        anim: None,
    },
];

const TLS_EXERCISES: &[Exercise] = &[Exercise {
    id: "tls.explain",
    kind: ExerciseKind::ExplainBack,
    prompt: "In your own words, what did the ClientHello propose?",
    answer_key: Some(ExplanationKey("tls.handshake.client_hello")),
}];

const HTTP_STEPS: &[Step] = &[Step {
    id: "http.request",
    body_key: ExplanationKey("http.request"),
    anim: None,
}];

const HTTP_EXERCISES: &[Exercise] = &[Exercise {
    id: "http.explain",
    kind: ExerciseKind::ExplainBack,
    prompt: "What did your browser ask the server for?",
    answer_key: Some(ExplanationKey("http.request")),
}];

const LOSS_STEPS: &[Step] = &[Step {
    id: "loss.retransmit",
    body_key: ExplanationKey("tcp.seq"),
    anim: Some(AnimationRef::Degradation),
}];

const LOSS_EXERCISES: &[Exercise] = &[Exercise {
    id: "loss.diagnose",
    kind: ExerciseKind::Diagnose,
    prompt: "This session was slow. What do the repeated sequence numbers suggest?",
    answer_key: Some(ExplanationKey("tcp.seq")),
}];

const B3_DNS: Lesson = Lesson {
    id: "b3.dns",
    title: "DNS: finding addresses",
    level: Level::Beginner,
    trigger: Trigger::DnsLookup,
    steps: DNS_STEPS,
    exercises: DNS_EXERCISES,
};

const B4_HANDSHAKE: Lesson = Lesson {
    id: "b4.handshake",
    title: "Connections: the handshake",
    level: Level::Beginner,
    trigger: Trigger::TcpHandshake,
    steps: HANDSHAKE_STEPS,
    exercises: HANDSHAKE_EXERCISES,
};

const B5_ENCRYPTION: Lesson = Lesson {
    id: "b5.encryption",
    title: "Encryption: why the padlock",
    level: Level::Beginner,
    trigger: Trigger::TlsHandshake,
    steps: TLS_STEPS,
    exercises: TLS_EXERCISES,
};

const B2_PAGELOAD: Lesson = Lesson {
    id: "b2.pageload",
    title: "What happens when I type a URL?",
    level: Level::Beginner,
    trigger: Trigger::PageLoad,
    steps: HTTP_STEPS,
    exercises: HTTP_EXERCISES,
};

const I4_LOSS: Lesson = Lesson {
    id: "i4.loss",
    title: "Latency, loss, retransmission",
    level: Level::Intermediate,
    trigger: Trigger::LossBurst,
    steps: LOSS_STEPS,
    exercises: LOSS_EXERCISES,
};

const BEGINNER_LESSONS: &[Lesson] = &[B3_DNS, B4_HANDSHAKE, B5_ENCRYPTION, B2_PAGELOAD];
const INTERMEDIATE_LESSONS: &[Lesson] = &[I4_LOSS];

/// The authored curriculum. Grouped into modules by level; the
/// engine and explorer read it, never mutate it.
pub const CURRICULUM: &[Module] = &[
    Module {
        id: "m.basics",
        title: "How the web loads",
        level: Level::Beginner,
        lessons: BEGINNER_LESSONS,
    },
    Module {
        id: "m.diagnosing",
        title: "Diagnosing slowness",
        level: Level::Intermediate,
        lessons: INTERMEDIATE_LESSONS,
    },
];

/// Look up a lesson by id across the whole curriculum.
pub fn lesson(id: &str) -> Option<&'static Lesson> {
    CURRICULUM
        .iter()
        .flat_map(|m| m.lessons.iter())
        .find(|l| l.id == id)
}

/// The first lesson whose trigger matches an observed teachable moment
///Returned to the engine so an observation maps to a grounded
/// offer.
pub fn lesson_for_trigger(trigger: Trigger) -> Option<&'static Lesson> {
    CURRICULUM
        .iter()
        .flat_map(|m| m.lessons.iter())
        .find(|l| l.trigger == trigger)
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_decode::explain;

    #[test]
    fn curriculum_keys_all_resolve_at_all_depths() {
        // Every step's explanation key must resolve to content at all three
        // depths — the "no dead ends" invariant applied to the
        // curriculum, sharing the coverage guarantee.
        for module in CURRICULUM {
            for lesson in module.lessons {
                for step in lesson.steps {
                    let ex = explain(step.body_key).unwrap_or_else(|| {
                        panic!("lesson {} step {} has no content", lesson.id, step.id)
                    });
                    for depth in [
                        netpulse_decode::DisclosureDepth::Beginner,
                        netpulse_decode::DisclosureDepth::Intermediate,
                        netpulse_decode::DisclosureDepth::Expert,
                    ] {
                        assert!(!ex.at(depth).trim().is_empty());
                    }
                }
                // Grounded exercises must cite a resolvable key too.
                for exercise in lesson.exercises {
                    if let Some(key) = exercise.answer_key {
                        assert!(explain(key).is_some(), "exercise {} key", exercise.id);
                    }
                }
            }
        }
    }

    #[test]
    fn lesson_ids_are_unique() {
        let mut ids: Vec<&str> = CURRICULUM
            .iter()
            .flat_map(|m| m.lessons.iter())
            .map(|l| l.id)
            .collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "duplicate lesson id in curriculum");
    }

    #[test]
    fn trigger_maps_to_lesson() {
        assert_eq!(
            lesson_for_trigger(Trigger::TlsHandshake).map(|l| l.id),
            Some("b5.encryption")
        );
        assert!(lesson_for_trigger(Trigger::None).is_none());
    }

    #[test]
    fn level_maps_to_depth() {
        assert_eq!(Level::Beginner.as_depth(), netpulse_core::Depth::Beginner);
        assert_eq!(Level::Expert.as_depth(), netpulse_core::Depth::Expert);
    }
}
