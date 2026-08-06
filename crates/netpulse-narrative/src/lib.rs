//! # netpulse-narrative — storytelling
//!
//! Transforms the reconstruction model (sessions, flows, protocol events) into
//! **human-language narratives**: the signature surface of the Dashboard
//! and the per-application "why". Where Wireshark
//! opens to a packet grid, NetPulse opens to a feed of sentences a beginner can
//! read — each still backed by the structured model, so readability never costs
//! truth.
//!
//! This crate is a **pure projection** over the model from `netpulse-flow` /
//! `netpulse-core`. It captures nothing, parses nothing, stores nothing. Two
//! rules from the design govern every line it emits:
//!
//! - **The evidence-reference invariant**: every card points back
//!   at the exact flows/sessions/events it summarizes. A narrative that asserts
//!   more than its evidence supports is a bug — [`NarrativeCard`] cannot be
//!   constructed without at least one [`netpulse_core::EvidenceRef`], and a test
//!   enforces it.
//! - **Generated, never free-written**: sentences are produced
//!   from the model by the rules here, not authored by hand, so they cannot
//!   drift from what actually happened — the same discipline that lets the AI
//!   assistant stay grounded.
//!
//! Progressive disclosure is honored by rendering the *same* card
//! at a requested [`netpulse_core::Depth`]: density, not vocabulary, is the
//! lever, and nothing is withheld that cannot be reached one step deeper.
#![forbid(unsafe_code)]

mod card;
mod coalesce;
mod journey;
mod render;

pub use card::{NarrativeCard, Severity};
pub use coalesce::coalesce;
pub use journey::{
    build_page_journey, build_page_journey_with_hosts, FanoutNode, JourneyStage, PageJourney,
    StageKind,
};
pub use render::{build_card, build_cards, build_journey, SessionView};
