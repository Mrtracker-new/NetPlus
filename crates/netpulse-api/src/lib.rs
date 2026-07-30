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
    handshake_codes, handshake_error_codes, AnimationKindDto, AnimationModelDto,
    AssistantAnswerDto, AttributionConfidenceDto, AttributionDto, BreakdownDto, BreakdownRowDto,
    CauseDto, ComponentCheckDto, DiagnosisDto, DimensionDto, DirectionDto, EvidenceRefDto,
    ExerciseKindDto, ExplorerEntryDto, ExportFormatDto, ExportPreviewDto, ExportSelectionDto,
    FanoutNodeDto, FindingCategoryDto, FindingKindDto, GroundedExerciseDto, HandshakeResponseDto,
    HealthStatusDto, HostNameDto, InterfaceDto, JourneyStageDto, LessonOfferDto,
    MonitorSnapshotDto, NameSourceDto, NarrativeCardDto, PageJourneyDto, PayloadLevelDto,
    PluginCapabilityDto, PluginDescriptorDto, PluginTrustDto, PluginTypeDto, PrivacyManifestDto,
    ProjectionDepth, RecordingSummaryDto, ReplayStateDto, SecurityFindingDto, SeverityDto,
    StageKindDto, VersionPinsDto, VisualEventDto,
};

/// Contract version. Bumped on any breaking change to the message schema so UI
/// and engine can negotiate compatibility (docs/02 §7.2). v6 adds passive
/// hostname enrichment on host breakdown rows (`HostNameDto`/`NameSourceDto`,
/// docs/08 §5), on top of v5's interface picker and Phase 5's lifecycle DTOs.
pub const API_VERSION: u32 = 6;

/// Minimum API version supported by the host (v-1 backward compatibility, docs/02 §7.2).
pub const MIN_SUPPORTED_API_VERSION: u32 = 5;

/// Negotiate API version given a client version range.
///
/// Intersects client range `[client_min, client_max]` with host range
/// `[MIN_SUPPORTED_API_VERSION, API_VERSION]`. Returns a [`HandshakeResponseDto`]
/// with machine-readable warning/error codes.
pub fn negotiate_api_version_range(client_min: u32, client_max: u32) -> HandshakeResponseDto {
    if client_min > client_max {
        return HandshakeResponseDto {
            compatible: false,
            negotiated_version: None,
            host_version: API_VERSION,
            min_supported_version: MIN_SUPPORTED_API_VERSION,
            warning_code: None,
            warning: None,
            error_code: Some(handshake_error_codes::INVALID_VERSION_RANGE.into()),
            error: Some(format!(
                "Invalid client version range: min {client_min} > max {client_max}"
            )),
        };
    }

    let host_min = MIN_SUPPORTED_API_VERSION;
    let host_max = API_VERSION;

    let start = client_min.max(host_min);
    let end = client_max.min(host_max);

    if start <= end {
        let negotiated = end;
        let (warning_code, warning) = if negotiated < host_max {
            (
                Some(handshake_codes::DEPRECATED_API_VERSION.into()),
                Some(format!(
                    "Client requested version {negotiated}, host is on version {host_max}. Backward compatibility mode enabled."
                )),
            )
        } else {
            (None, None)
        };

        HandshakeResponseDto {
            compatible: true,
            negotiated_version: Some(negotiated),
            host_version: host_max,
            min_supported_version: host_min,
            warning_code,
            warning,
            error_code: None,
            error: None,
        }
    } else if client_max < host_min {
        HandshakeResponseDto {
            compatible: false,
            negotiated_version: None,
            host_version: host_max,
            min_supported_version: host_min,
            warning_code: None,
            warning: None,
            error_code: Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_OLD.into()),
            error: Some(format!(
                "Client API version {client_max} is older than host minimum supported version {host_min}."
            )),
        }
    } else {
        HandshakeResponseDto {
            compatible: false,
            negotiated_version: None,
            host_version: host_max,
            min_supported_version: host_min,
            warning_code: None,
            warning: None,
            error_code: Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_NEW.into()),
            error: Some(format!(
                "Client API version {client_min} is newer than host supported version {host_max}."
            )),
        }
    }
}

/// Convenience function for single client version negotiation.
pub fn negotiate_api_version(client_version: u32) -> HandshakeResponseDto {
    negotiate_api_version_range(client_version, client_version)
}

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
// Internally tagged on `kind`, camelCased variant names — the single wire shape
// the TypeScript contract (`ui/packages/contract`) speaks. `rename_all` renames
// the *variants* only; the snake_case field names (`from_mono_nanos`, …) are
// unchanged and already match the contract (docs/02 §7, docs/03 §9).
#[serde(tag = "kind", rename_all = "camelCase")]
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
    // ---- Phase 5 lifecycle queries (docs/21–24) ----
    /// List the recordings available for replay/export (docs/22 §3).
    ListRecordings,
    /// The current replay playback state (docs/21 §5).
    ReplayState,
    /// Preview exactly what an export would contain, before writing it (docs/23 §6).
    ExportPreview {
        selection: ExportSelectionDto,
        format: ExportFormatDto,
    },
    /// List the registered plugins with their capabilities and trust (docs/24 §6).
    ListPlugins,
    /// List the capture-capable network interfaces to choose from (docs/05).
    Interfaces,
    /// Fetch health, readiness, and liveness status of the backend.
    HealthCheck,
    /// Perform API version handshake negotiation before invoking other endpoints.
    Handshake {
        client_min_version: u32,
        client_max_version: u32,
    },
}

/// The typed response to a [`Query`]. One variant per query answer, so the UI
/// matches exhaustively and the TS contract is fully typed (docs/03 §9).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// Internally tagged on `kind`, camelCased variants — the wire shape the TS
// `QueryResponse` union expects (`{ kind: "narrativeFeed", cards: [...] }`).
// serde's internal tagging cannot wrap a newtype-of-`Vec`, so each variant names
// its single payload field explicitly; the field name matches the TS contract
// (docs/03 §9). Regenerating the contract is not required — these envelopes are
// hand-authored in `ui/packages/contract/index.ts`, not emitted by codegen.
#[serde(tag = "kind", rename_all = "camelCase")]
#[non_exhaustive]
pub enum QueryResponse {
    NarrativeFeed {
        cards: Vec<NarrativeCardDto>,
    },
    Journey {
        sentences: Vec<String>,
    },
    MonitorSnapshot {
        snapshot: MonitorSnapshotDto,
    },
    Attribution {
        attribution: AttributionDto,
    },
    /// Honest empty answer when payloads were not stored (docs/09 §8).
    PayloadsUnavailable,
    /// Grounded lesson offers (docs/13 §4).
    LessonOffers {
        offers: Vec<LessonOfferDto>,
    },
    /// The staged website journey (docs/14).
    PageJourney {
        journey: PageJourneyDto,
    },
    /// Protocol reference entries (browse or search, docs/15).
    ExplorerEntries {
        entries: Vec<ExplorerEntryDto>,
    },
    /// A data-driven animation model (docs/16).
    Animation {
        animation: AnimationModelDto,
    },
    /// Security/anomaly findings (docs/17–20), corroborated and ranked.
    Findings {
        findings: Vec<SecurityFindingDto>,
    },
    /// A grounded, cited AI answer (docs/19).
    AssistantAnswer {
        answer: AssistantAnswerDto,
    },
    /// The recordings available for replay/export (docs/22).
    Recordings {
        recordings: Vec<RecordingSummaryDto>,
    },
    /// The current replay playback state (docs/21 §5).
    ReplayState {
        state: ReplayStateDto,
    },
    /// A preview of what an export would contain (docs/23 §6).
    ExportPreview {
        preview: ExportPreviewDto,
    },
    /// The registered plugins (docs/24 §6).
    Plugins {
        plugins: Vec<PluginDescriptorDto>,
    },
    /// The capture-capable interfaces to choose from (docs/05).
    Interfaces {
        interfaces: Vec<InterfaceDto>,
    },
    /// Backend health and liveness status.
    Health {
        status: HealthStatusDto,
    },
    /// API version negotiation result (docs/02 §7.2).
    Handshake {
        handshake: HandshakeResponseDto,
    },
}

/// A user-initiated control write — the only write path UI→engine (docs/02 §7.1).
/// The set is deliberately small and enumerable for auditability. Observe-only:
/// nothing here modifies network traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
// Same wire discipline as `Query`: internally tagged on `kind`, camelCased
// variants, snake_case fields unchanged (matches the TS contract, docs/03 §9).
#[serde(tag = "kind", rename_all = "camelCase")]
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
    // ---- Phase 5 lifecycle commands (docs/21–24) ----
    /// Start replay playback of the selected recording (docs/21 §5).
    ReplayPlay,
    /// Pause replay playback (docs/21 §5).
    ReplayPause,
    /// Advance replay by one frame/event (docs/21 §5).
    ReplayStep,
    /// Seek replay to a monotonic timestamp (docs/21 §5).
    ReplaySeek {
        mono_nanos: u64,
    },
    /// Set replay speed as a percentage of real time (100 = 1×) (docs/21 §5).
    ReplaySetSpeed {
        percent: u32,
    },
    /// Produce an export to a local file (docs/23). Explicit, user-initiated, and
    /// never auto-transmitted — the single egress boundary stays `netpulse-ai`
    /// (docs/23 §6, docs/02 §10).
    StartExport {
        selection: ExportSelectionDto,
        format: ExportFormatDto,
        level: PayloadLevelDto,
    },
    /// Enable a registered plugin — an explicit, disclosed user choice (docs/24 §5).
    EnablePlugin {
        name: String,
    },
    /// Disable a registered plugin (docs/24 §6).
    DisablePlugin {
        name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_advanced_for_hostname_enrichment() {
        // v6 adds passive hostname enrichment on host breakdown rows
        // (`HostNameDto`/`NameSourceDto`, docs/08 §5), on top of v5's interface
        // picker and Phase 5's lifecycle DTOs (docs/21–24).
        assert_eq!(API_VERSION, 6);
    }

    #[test]
    fn wire_shape_matches_ts_contract() {
        // The IPC envelopes must be internally tagged on `kind` with camelCase
        // variant names and snake_case fields — the exact shape the hand-written
        // TS contract (`ui/packages/contract`) sends/reads. A regression here is
        // what silently broke every query/command before (externally tagged).
        let q = serde_json::to_string(&Query::NarrativeFeed {
            from_mono_nanos: 0,
            to_mono_nanos: 1,
            depth: ProjectionDepth::Beginner,
        })
        .unwrap();
        assert!(q.contains("\"kind\":\"narrativeFeed\""), "{q}");
        assert!(q.contains("\"from_mono_nanos\":0"), "{q}");

        let c = serde_json::to_string(&Command::StartCapture { iface_id: 0 }).unwrap();
        assert_eq!(c, r#"{"kind":"startCapture","iface_id":0}"#);

        // And a command deserializes from exactly what the UI sends.
        let back: Command = serde_json::from_str(r#"{"kind":"stopCapture","iface_id":3}"#).unwrap();
        assert_eq!(back, Command::StopCapture { iface_id: 3 });
    }

    #[test]
    fn lifecycle_query_round_trips() {
        let q = Query::ExportPreview {
            selection: ExportSelectionDto::Session { id: 7 },
            format: ExportFormatDto::Json,
        };
        let json = serde_json::to_string(&q).unwrap();
        let back: Query = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn lifecycle_command_round_trips() {
        let c = Command::ReplaySeek {
            mono_nanos: 1_500_000,
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Command = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
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
        let r = QueryResponse::Journey {
            sentences: vec!["Connected to example.com".into()],
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: QueryResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
        // Internally tagged on `kind` — the exact wire shape the TS contract reads.
        assert!(json.contains("\"kind\":\"journey\""));
        assert!(json.contains("\"sentences\""));
    }

    #[test]
    fn handshake_exact_match_succeeds() {
        let res = negotiate_api_version(6);
        assert!(res.compatible);
        assert_eq!(res.negotiated_version, Some(6));
        assert_eq!(res.warning_code, None);
        assert_eq!(res.error_code, None);
    }

    #[test]
    fn handshake_v_minus_1_compatibility_warns_and_succeeds() {
        let res = negotiate_api_version(5);
        assert!(res.compatible);
        assert_eq!(res.negotiated_version, Some(5));
        assert_eq!(
            res.warning_code,
            Some(handshake_codes::DEPRECATED_API_VERSION.into())
        );
        assert_eq!(res.error_code, None);
    }

    #[test]
    fn handshake_range_negotiation_picks_highest_mutual() {
        let res = negotiate_api_version_range(4, 6);
        assert!(res.compatible);
        assert_eq!(res.negotiated_version, Some(6));

        let res_v5 = negotiate_api_version_range(4, 5);
        assert!(res_v5.compatible);
        assert_eq!(res_v5.negotiated_version, Some(5));
        assert_eq!(
            res_v5.warning_code,
            Some(handshake_codes::DEPRECATED_API_VERSION.into())
        );
    }

    #[test]
    fn handshake_too_old_client_fails_with_code() {
        let res = negotiate_api_version(4);
        assert!(!res.compatible);
        assert_eq!(res.negotiated_version, None);
        assert_eq!(
            res.error_code,
            Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_OLD.into())
        );
    }

    #[test]
    fn handshake_too_new_client_fails_with_code() {
        let res = negotiate_api_version(7);
        assert!(!res.compatible);
        assert_eq!(res.negotiated_version, None);
        assert_eq!(
            res.error_code,
            Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_NEW.into())
        );
    }

    #[test]
    fn handshake_invalid_range_fails_with_code() {
        let res = negotiate_api_version_range(6, 4);
        assert!(!res.compatible);
        assert_eq!(
            res.error_code,
            Some(handshake_error_codes::INVALID_VERSION_RANGE.into())
        );
    }
}
