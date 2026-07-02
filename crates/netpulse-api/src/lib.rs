//! # netpulse-api — the contract (source of truth)
//!
//! The single versioned Query/Stream/Command message schema for the
//! backend↔frontend IPC boundary (docs/02 §7). Both the Rust engine and the
//! generated TypeScript types derive from this one crate, so the two sides
//! cannot drift (docs/03 §7, docs/04 §3.11).
//!
//! Three interaction shapes (docs/02 §7.1):
//! - **Streams (push):** live channels the UI subscribes to; the backend pushes
//!   deltas (docs/09 §7).
//! - **Queries (pull):** historical/aggregated requests, paginated and bounded,
//!   each carrying a [`dto::ProjectionDepth`] so a beginner query never hauls raw
//!   payloads across the boundary (docs/09 §6.3).
//! - **Commands (control):** the *only* write paths from UI to engine — few and
//!   enumerable, so the observe-only guarantee is easy to audit (docs/02 §10).
//!
//! The concrete wire shapes live in [`dto`]; their TypeScript mirror is emitted
//! by [`codegen`] into `ui/packages/contract`, kept in sync by a drift test
//! (docs/04 §7).
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

pub mod codegen;
pub mod dto;

pub use dto::{
    AnimationKindDto, AnimationModelDto, AssistantAnswerDto, AttributionConfidenceDto,
    AttributionDto, BreakdownDto, BreakdownRowDto, CauseDto, DiagnosisDto, DimensionDto,
    DirectionDto, EvidenceRefDto, ExerciseKindDto, ExplorerEntryDto, FanoutNodeDto,
    FindingCategoryDto, FindingKindDto, GroundedExerciseDto, JourneyStageDto, LessonOfferDto,
    MonitorSnapshotDto, NarrativeCardDto, PageJourneyDto, ProjectionDepth, SecurityFindingDto,
    SeverityDto, StageKindDto, VisualEventDto,
};

/// Contract version. Bumped on any breaking change to the message schema so UI
/// and engine can negotiate compatibility (docs/02 §7.2). Phase 4 adds the
/// intelligence queries/DTOs (docs/17–20: security findings + AI assistant),
/// advancing the version from Phase 3's `2`.
pub const API_VERSION: u32 = 3;

/// A live channel the UI can subscribe to (docs/02 §7.1, docs/09 §7). The engine
/// pushes deltas on these; the UI updates a normalized store rather than polling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum StreamChannel {
    /// `live.flows` — flow lifecycle deltas.
    Flows,
    /// `live.metrics` — throughput/latency/loss meter deltas (docs/11 §7).
    Metrics,
    /// `live.findings` — security/anomaly findings as they occur (docs/17).
    Findings,
    /// `live.narratives` — new narrative feed cards (docs/09 §5).
    Narratives,
}

/// A historical/aggregated pull request (docs/02 §7.1). Each variant is
/// paginated and bounded, and carries the [`ProjectionDepth`] at which the
/// engine should project its answer (docs/09 §6.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Query {
    /// The narrative feed for a time window (docs/09 §5), newest first.
    NarrativeFeed {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
        depth: ProjectionDepth,
    },
    /// The narrative journey for one session (docs/14).
    JourneyOfSession {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// A monitoring snapshot over a window (docs/11 §5).
    MonitorSnapshot {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
    },
    /// The process attribution for a flow (docs/12 §7).
    AttributionOfFlow { flow_id: u64 },
    /// Fetch packets belonging to a flow — the deepest drill-down (docs/09 §8).
    PacketsOfFlow { flow_id: u64 },
    /// Grounded lesson offers for a session's teachable moments (docs/13 §4).
    LessonOffers {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// The staged website journey for a session (docs/14).
    JourneyStagesOfSession {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// Browse the whole protocol reference (docs/15 §4).
    ExplorerBrowse,
    /// Search the protocol reference by term/symptom (docs/15 §8).
    ExplorerSearch { term: String },
    /// The data-driven handshake animation model for a flow (docs/16 §4.2).
    HandshakeAnimationForFlow { flow_id: u64 },
    /// Security/anomaly findings over a window (docs/17 §6), most-confident first.
    SecurityFindings {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
    },
    /// Ask the grounded AI assistant a natural-language question (docs/19). The
    /// answer is grounded in the committed capture and cites its evidence.
    AskAssistant { question: String },
}

/// The typed response to a [`Query`]. One variant per query answer, so the UI
/// matches exhaustively and the TS contract is fully typed (docs/03 §9).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum QueryResponse {
    NarrativeFeed(Vec<NarrativeCardDto>),
    Journey(Vec<String>),
    MonitorSnapshot(MonitorSnapshotDto),
    Attribution(AttributionDto),
    /// Honest empty answer when payloads were not stored (docs/09 §8).
    PayloadsUnavailable,
    /// Grounded lesson offers (docs/13 §4).
    LessonOffers(Vec<LessonOfferDto>),
    /// The staged website journey (docs/14).
    PageJourney(PageJourneyDto),
    /// Protocol reference entries (browse or search, docs/15).
    ExplorerEntries(Vec<ExplorerEntryDto>),
    /// A data-driven animation model (docs/16).
    Animation(AnimationModelDto),
    /// Security/anomaly findings (docs/17–20), corroborated and ranked.
    Findings(Vec<SecurityFindingDto>),
    /// A grounded, cited AI answer (docs/19).
    AssistantAnswer(AssistantAnswerDto),
}

/// A user-initiated control write — the only write path UI→engine (docs/02 §7.1).
/// The set is deliberately small and enumerable for auditability. Observe-only:
/// nothing here modifies network traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Command {
    StartCapture {
        iface_id: u16,
    },
    StopCapture {
        iface_id: u16,
    },
    StartRecording,
    StopRecording,
    /// Change the UI's global disclosure mode; travels to the engine as a
    /// projection-depth default (docs/09 §6.3).
    SetDepth {
        depth: ProjectionDepth,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_advanced_for_phase4() {
        // Phase 4 adds the intelligence queries/DTOs (docs/17–20).
        assert_eq!(API_VERSION, 3);
    }

    #[test]
    fn intelligence_query_round_trips() {
        let q = Query::AskAssistant {
            question: "why was it slow?".into(),
        };
        let json = serde_json::to_string(&q).unwrap();
        let back: Query = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn education_query_round_trips() {
        let q = Query::LessonOffers {
            session_id: 7,
            depth: ProjectionDepth::Beginner,
        };
        let json = serde_json::to_string(&q).unwrap();
        let back: Query = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn query_carries_projection_depth() {
        // A narrative-feed query round-trips with its depth (docs/09 §6.3).
        let q = Query::NarrativeFeed {
            from_mono_nanos: 0,
            to_mono_nanos: 1_000,
            depth: ProjectionDepth::Beginner,
        };
        let json = serde_json::to_string(&q).unwrap();
        let back: Query = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn response_is_exhaustively_typed() {
        let r = QueryResponse::Journey(vec!["Connected to example.com".into()]);
        let json = serde_json::to_string(&r).unwrap();
        let back: QueryResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }
}
