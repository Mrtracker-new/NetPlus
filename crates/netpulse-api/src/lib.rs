//! # netpulse-api — the contract (source of truth)
//!
//! The single versioned Query/Stream/Command message schema for the
//! backend↔frontend IPC boundary. Both the Rust engine and the
//! generated TypeScript types derive from this one crate, so the two sides
//! cannot drift.
//!
//! Three interaction shapes:
//! - **Streams (push):** live channels the UI subscribes to; the backend pushes
//!   deltas.
//! - **Queries (pull):** historical/aggregated requests, paginated and bounded,
//!   each carrying a [`dto::ProjectionDepth`] so a beginner query never hauls raw
//!   payloads across the boundary.
//! - **Commands (control):** the *only* write paths from UI to engine — few and
//!   enumerable, so the observe-only guarantee is easy to audit.
//!
//! The concrete wire shapes live in [`dto`]; their TypeScript mirror is emitted
//! by [`codegen`] into `ui/packages/contract`, kept in sync by a drift test
//!
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
/// and engine can negotiate compatibility. v6 adds passive
/// hostname enrichment on host breakdown rows (`HostNameDto`/`NameSourceDto`,
///  , on top of v5's interface picker and Phase 5's lifecycle DTOs.
pub const API_VERSION: u32 = 6;

/// Minimum API version supported by the host (v-1 backward compatibility .
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

/// A live channel the UI can subscribe to. The engine
/// pushes deltas on these; the UI updates a normalized store rather than polling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum StreamChannel {
    /// `live.flows` — flow lifecycle deltas.
    Flows,
    /// `live.metrics` — throughput/latency/loss meter deltas.
    Metrics,
    /// `live.findings` — security/anomaly findings as they occur.
    Findings,
    /// `live.narratives` — new narrative feed cards. Protocol scaffolding for live push streaming.
    Narratives,
}

/// A historical/aggregated pull request. Each variant is
/// paginated and bounded, and carries the [`ProjectionDepth`] at which the
/// engine should project its answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
// Internally tagged on `kind`, camelCased variant names — the single wire shape
// the TypeScript contract (`ui/packages/contract`) speaks. `rename_all` renames
// the *variants* only; the snake_case field names (`from_mono_nanos`, …) are
// unchanged and already match the contract.
#[serde(tag = "kind", rename_all = "camelCase")]
#[non_exhaustive]
pub enum Query {
    /// The narrative feed for a time window, newest first.
    NarrativeFeed {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
        depth: ProjectionDepth,
    },
    /// The narrative journey for one session.
    JourneyOfSession {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// A monitoring snapshot over a window.
    MonitorSnapshot {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
    },
    /// The process attribution for a flow.
    AttributionOfFlow { flow_id: u64 },
    /// Fetch packets belonging to a flow — the deepest drill-down.
    PacketsOfFlow { flow_id: u64 },
    /// Grounded lesson offers for a session's teachable moments.
    LessonOffers {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// The staged website journey for a session.
    JourneyStagesOfSession {
        session_id: u64,
        depth: ProjectionDepth,
    },
    /// Browse the whole protocol reference.
    ExplorerBrowse,
    /// Search the protocol reference by term/symptom.
    ExplorerSearch { term: String },
    /// The data-driven handshake animation model for a flow.
    HandshakeAnimationForFlow { flow_id: u64 },
    /// Security/anomaly findings over a window, most-confident first.
    SecurityFindings {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
    },
    /// Ask the grounded AI assistant a natural-language question. The
    /// answer is grounded in the committed capture and cites its evidence.
    AskAssistant { question: String },
    // ---- Phase 5 lifecycle queries ----
    /// List the recordings available for replay/export.
    ListRecordings,
    /// The current replay playback state.
    ReplayState,
    /// Preview exactly what an export would contain, before writing it.
    ExportPreview {
        selection: ExportSelectionDto,
        format: ExportFormatDto,
    },
    /// List the registered plugins with their capabilities and trust.
    ListPlugins,
    /// List the capture-capable network interfaces to choose from.
    Interfaces,
    /// Fetch health, readiness, and liveness status of the backend.
    HealthCheck,
    /// Perform API version handshake negotiation before invoking other endpoints.
    Handshake {
        client_min_version: u32,
        client_max_version: u32,
    },
    /// Fetch the capability registry and dependency nodes.
    GetCapabilityRegistry,
    /// Run an active ping diagnostic probe.
    RunPing { target: String, count: u32 },
    /// Run an active traceroute diagnostic probe.
    RunTraceroute {
        target: String,
        transport: String,
        max_hops: u8,
    },
    /// Run a dual-phase bufferbloat latency probe.
    RunBufferbloatTest { target: Option<String> },
    /// Safe offline packet construction and decoding inspection.
    BuildAndDecodePacket { layers: Vec<String> },
    /// Compare two capture sessions side-by-side with rule-based explanations.
    CompareSessions {
        session_id_a: u64,
        session_id_b: u64,
    },
    /// List remote fleet observation hosts.
    ListFleetHosts,
}

/// The typed response to a [`Query`]. One variant per query answer, so the UI
/// matches exhaustively and the TS contract is fully typed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// Internally tagged on `kind`, camelCased variants — the wire shape the TS
// `QueryResponse` union expects (`{ kind: "narrativeFeed", cards: [...] }`).
// serde's internal tagging cannot wrap a newtype-of-`Vec`, so each variant names
// its single payload field explicitly; the field name matches the TS contract
//Regenerating the contract is not required — these envelopes are
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
    /// Honest empty answer when payloads were not stored.
    PayloadsUnavailable,
    /// Grounded lesson offers.
    LessonOffers {
        offers: Vec<LessonOfferDto>,
    },
    /// The staged website journey.
    PageJourney {
        journey: PageJourneyDto,
    },
    /// Protocol reference entries (browse or search, docs/15).
    ExplorerEntries {
        entries: Vec<ExplorerEntryDto>,
    },
    /// A data-driven animation model.
    Animation {
        animation: AnimationModelDto,
    },
    /// Security/anomaly findings, corroborated and ranked.
    Findings {
        findings: Vec<SecurityFindingDto>,
    },
    /// A grounded, cited AI answer.
    AssistantAnswer {
        answer: AssistantAnswerDto,
    },
    /// The recordings available for replay/export.
    Recordings {
        recordings: Vec<RecordingSummaryDto>,
    },
    /// The current replay playback state.
    ReplayState {
        state: ReplayStateDto,
    },
    /// A preview of what an export would contain.
    ExportPreview {
        preview: ExportPreviewDto,
    },
    /// The registered plugins.
    Plugins {
        plugins: Vec<PluginDescriptorDto>,
    },
    /// The capture-capable interfaces to choose from.
    Interfaces {
        interfaces: Vec<InterfaceDto>,
    },
    /// Backend health and liveness status.
    Health {
        status: HealthStatusDto,
    },
    /// API version negotiation result.
    Handshake {
        handshake: HandshakeResponseDto,
    },
    CapabilityRegistry {
        registry: serde_json::Value,
    },
    PingResult {
        result: PingResultDto,
    },
    TracerouteResult {
        hops: Vec<TracerouteHopDto>,
    },
    BufferbloatResult {
        result: BufferbloatResultDto,
    },
    DecodedPacketInspection {
        inspection: PacketInspectionDto,
    },
    SessionDiff {
        diff: SessionDiffDto,
    },
    FleetHosts {
        hosts: Vec<HostIdentityDto>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResultDto {
    pub target: String,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f32,
    pub min_rtt_ms: f32,
    pub avg_rtt_ms: f32,
    pub max_rtt_ms: f32,
    pub stddev_rtt_ms: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteHopDto {
    pub ttl: u8,
    pub ip: String,
    pub hostname: Option<String>,
    pub rtt_ms: f32,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferbloatResultDto {
    pub target: String,
    pub idle_rtt_ms: f32,
    pub loaded_rtt_ms: f32,
    pub delta_rtt_ms: f32,
    pub grade: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDiagnosticDto {
    pub severity: String,
    pub field: String,
    pub rfc_reference: String,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacketInspectionDto {
    pub raw_hex: String,
    pub layers: Vec<String>,
    pub diagnostics: Vec<FieldDiagnosticDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffDto {
    pub session_id_a: u64,
    pub session_id_b: u64,
    pub rtt_delta_ms: f32,
    pub ttfb_delta_ms: f32,
    pub protocol_shift: String,
    pub semantic_explanation: String,
    pub confidence: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentityDto {
    pub host_id: String,
    pub hostname: String,
    pub friendly_name: Option<String>,
    pub os: String,
    pub platform: String,
    pub agent_version: String,
    pub status: String,
}

/// A user-initiated control write — the only write path UI→engine.
/// The set is deliberately small and enumerable for auditability. Observe-only:
/// nothing here modifies network traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
// Same wire discipline as `Query`: internally tagged on `kind`, camelCased
// variants, snake_case fields unchanged (matches the TS contract .
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
    /// projection-depth default.
    SetDepth {
        depth: ProjectionDepth,
    },
    // ---- Phase 5 lifecycle commands ----
    /// Start replay playback of the selected recording.
    ReplayPlay,
    /// Pause replay playback.
    ReplayPause,
    /// Advance replay by one frame/event.
    ReplayStep,
    /// Seek replay to a monotonic timestamp.
    ReplaySeek {
        mono_nanos: u64,
    },
    /// Set replay speed as a percentage of real time (100 = 1× .
    ReplaySetSpeed {
        percent: u32,
    },
    /// Produce an export to a local file. Explicit, user-initiated, and
    /// never auto-transmitted — the single egress boundary stays `netpulse-ai`
    ///
    StartExport {
        selection: ExportSelectionDto,
        format: ExportFormatDto,
        level: PayloadLevelDto,
    },
    /// Enable a registered plugin — an explicit, disclosed user choice.
    EnablePlugin {
        name: String,
    },
    /// Disable a registered plugin.
    DisablePlugin {
        name: String,
    },
    /// Fully update a registered plugin's configuration JSON.
    ConfigurePlugin {
        name: String,
        config: serde_json::Value,
    },
    /// RFC 7396 JSON merge patch a plugin's configuration with optional optimistic concurrency.
    PatchPluginConfig {
        name: String,
        expected_version: Option<u32>,
        patch: serde_json::Value,
    },
    /// Reset a plugin's configuration back to its manifest default.
    ResetPluginConfig {
        name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_advanced_for_hostname_enrichment() {
        // v6 adds passive hostname enrichment on host breakdown rows
        // (`HostNameDto`/`NameSourceDto` , on top of v5's interface
        // picker and Phase 5's lifecycle DTOs.
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
        // A narrative-feed query round-trips with its depth.
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

    #[test]
    fn test_new_queries_roundtrip() {
        let q1 = Query::RunPing {
            target: "1.1.1.1".into(),
            count: 4,
        };
        let json1 = serde_json::to_string(&q1).unwrap();
        let back1: Query = serde_json::from_str(&json1).unwrap();
        assert_eq!(q1, back1);

        let q2 = Query::CompareSessions {
            session_id_a: 10,
            session_id_b: 20,
        };
        let json2 = serde_json::to_string(&q2).unwrap();
        let back2: Query = serde_json::from_str(&json2).unwrap();
        assert_eq!(q2, back2);
    }

    #[test]
    fn test_new_responses_roundtrip() {
        let r1 = QueryResponse::PingResult {
            result: PingResultDto {
                target: "1.1.1.1".into(),
                sent: 4,
                received: 4,
                loss_pct: 0.0,
                min_rtt_ms: 12.0,
                avg_rtt_ms: 14.5,
                max_rtt_ms: 18.0,
                stddev_rtt_ms: 0.5,
            },
        };
        let json1 = serde_json::to_string(&r1).unwrap();
        let back1: QueryResponse = serde_json::from_str(&json1).unwrap();
        assert_eq!(r1, back1);
        assert!(json1.contains("\"kind\":\"pingResult\""));
    }

    #[test]
    fn ping_result_dto_serializes_to_camel_case_snapshot() {
        let dto = PingResultDto {
            target: "1.1.1.1".into(),
            sent: 4,
            received: 4,
            loss_pct: 0.0,
            min_rtt_ms: 10.0,
            avg_rtt_ms: 12.0,
            max_rtt_ms: 15.0,
            stddev_rtt_ms: 0.5,
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "target": "1.1.1.1",
                "sent": 4,
                "received": 4,
                "lossPct": 0.0,
                "minRttMs": 10.0,
                "avgRttMs": 12.0,
                "maxRttMs": 15.0,
                "stddevRttMs": 0.5
            })
        );
        assert!(json.get("loss_pct").is_none());
        assert!(json.get("min_rtt_ms").is_none());
        assert!(json.get("avg_rtt_ms").is_none());
    }

    #[test]
    fn session_diff_dto_serializes_to_camel_case_snapshot() {
        let dto = SessionDiffDto {
            session_id_a: 10,
            session_id_b: 20,
            rtt_delta_ms: -15.5,
            ttfb_delta_ms: -8.0,
            protocol_shift: "HTTP/1.1 -> HTTP/3".into(),
            semantic_explanation: "Faster connection setup".into(),
            confidence: "HIGH".into(),
            evidence: vec!["packet_1".into()],
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "sessionIdA": 10,
                "sessionIdB": 20,
                "rttDeltaMs": -15.5,
                "ttfbDeltaMs": -8.0,
                "protocolShift": "HTTP/1.1 -> HTTP/3",
                "semanticExplanation": "Faster connection setup",
                "confidence": "HIGH",
                "evidence": ["packet_1"]
            })
        );
        assert!(json.get("session_id_a").is_none());
        assert!(json.get("rtt_delta_ms").is_none());
        assert!(json.get("protocol_shift").is_none());
    }
}
