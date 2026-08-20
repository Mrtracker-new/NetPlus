//! # netpulse-learn — the education engine
//!
//! Turns NetPulse from a tool you *use* into a tool you *learn from*, using the
//! learner's own captured traffic as the curriculum.
//! This crate is the backend substrate for three of the four surfaces:
//!
//! - **Learning Engine**: [`content`] authors lessons as data;
//!   [`engine`] detects teachable moments in real traffic and offers grounded
//!   lessons citing real evidence; [`progress`] tracks mastery locally and
//!   adapts the next offer, calmly and without nagging.
//! - **Protocol Explorer**: [`explorer`] presents the `netpulse-decode`
//!   explanation-key content as a browsable, searchable reference wired to the
//!   learner's own observations both ways.
//! - **Animations**: [`anim`] builds the data-driven, timed animation
//!   *model* (with its mandatory reduced-motion equivalent) from real events.
//!
//! The fourth surface — the Website Journey — is a narrative
//! projection and lives in `netpulse-narrative`, whose journey this crate's
//! flagship page-load lesson uses as its substrate.
//!
//! Everything here is a **pure projection** over already-committed data: it
//! captures nothing, parses nothing, and (beyond local progress) stores nothing.
//! One explanation-key vocabulary unifies lessons, explorer entries,
//! and animations, so a field, anywhere, can offer its lesson.
#![forbid(unsafe_code)]

pub mod anim;
pub mod content;
pub mod engine;
pub mod explorer;
pub mod progress;
pub mod rfc;
pub mod sandbox;

pub use rfc::{RfcMetadata, RfcRegistry};
pub use sandbox::{DecodedPacketInspection, FieldDiagnostic, PacketBuilderEngine};

pub use anim::{fan_out, tcp_handshake, AnimationKind, AnimationModel, Direction, VisualEvent};
pub use content::{
    lesson, lesson_for_trigger, validate_exercise_choice, AnimationRef, Exercise, ExerciseChoice,
    ExerciseKind, ExerciseValidationResult, Lesson, Level, Module, Step, Trigger, CURRICULUM,
};
pub use engine::{detect_offers, GroundedExercise, LessonOffer, TrafficView};
pub use explorer::{
    annotate, browse, content_at, entry, examples_for, search, AnnotatedField, ExplorerEntry,
};
pub use progress::{CurriculumSummary, LessonStatus, Progress, ProgressStore, MASTERY_THRESHOLD};
