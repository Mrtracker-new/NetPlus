//! The wire types. These are the *contract
//! DTOs*: the exact shapes that cross the Tauri IPC boundary between engine and
//! UI. They are deliberately separate from the internal domain types in
//! `netpulse-narrative` / `netpulse-engine` (which sit *above* this crate in the
//! layer graph — the engine maps its rich types down into these
//! stable, serializable projections when it answers a query or pushes a delta.
//!
//! Keeping wire types distinct from domain types means the UI contract can stay
//! stable while internal representations evolve, and it keeps this crate's
//! dependency set tiny (core + serde only) — the contract is security-sensitive
//! surface, so it carries no heavy dependencies.
//!
//! Every serde representation here is mirrored, field-for-field, by the
//! TypeScript emitter in [`crate::codegen`]; a test asserts the two agree, and a
//! serde round-trip test per type exercises the field names.

use serde::{Deserialize, Serialize};

/// The disclosure/projection depth carried on a query. Mirrors
/// `netpulse_core::Depth`, restated here so the contract crate is self-contained
/// and the TS emitter has a single local source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum ProjectionDepth {
    #[default]
    Beginner,
    Intermediate,
    Expert,
}

/// A pointer back to the evidence a projection rests on, as a
/// tagged union: `{ "kind": "flow", "id": 12 }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
#[non_exhaustive]
pub enum EvidenceRefDto {
    Packet(u64),
    Flow(u64),
    Session(u64),
}

/// A narrative card's affect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum SeverityDto {
    #[default]
    Neutral,
    Notable,
    Finding,
}

/// One narrative feed card, already rendered at the query's depth.
/// `lines` is the depth-appropriate detail; `summary` is those lines joined for
/// the one-line under-headline view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NarrativeCardDto {
    pub headline: String,
    pub summary: String,
    pub lines: Vec<String>,
    pub severity: SeverityDto,
    pub evidence: Vec<EvidenceRefDto>,
    pub at_mono_nanos: u64,
}

/// The dimension a usage breakdown decomposes along.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum DimensionDto {
    Protocol,
    Host,
    Interface,
}

/// How a hostname for an IP was learned. Mirrors
/// `netpulse_core::NameSource`. Always egress-free — a name we *saw* on the wire
/// or read from *local* OS state, never a lookup we made — so the UI can label the
/// provenance honestly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum NameSourceDto {
    /// A DNS A/AAAA answer resolved this name to the IP.
    Dns,
    /// A TLS SNI the client sent to this IP.
    Sni,
    /// A static mapping from the machine's `hosts` file.
    HostsFile,
    /// A cached entry from the OS DNS resolver (incl. cached mDNS `.local`),
    /// recovering names for lookups made before capture started.
    OsResolver,
}

/// One passively-observed name for a breakdown row's endpoint, tagged with how it
/// was learned. Several may travel for one IP; the UI picks what to
/// show and can surface the source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostNameDto {
    pub name: String,
    pub source: NameSourceDto,
}

/// One row of a usage breakdown. `label` is the raw key (an IP for
/// the host dimension); `hostnames` enriches it with any names seen for that IP,
/// empty when none — the label is never replaced by a name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakdownRowDto {
    pub label: String,
    pub bytes: u64,
    pub flows: u32,
    pub hostnames: Vec<HostNameDto>,
    pub evidence: Vec<EvidenceRefDto>,
}

/// A ranked usage breakdown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakdownDto {
    pub dimension: DimensionDto,
    pub rows: Vec<BreakdownRowDto>,
}

/// The likely cause a diagnosis settles on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum CauseDto {
    LocalWifi,
    DistantServer,
    SlowDns,
    Congestion,
}

/// A "why is it slow?" diagnosis. `confidence_percent` is the
/// calibrated confidence as a 0–100 integer for display; `explanation` is the
/// ready-to-show "looks like …" text (never a verdict .
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagnosisDto {
    pub cause: CauseDto,
    pub confidence_percent: u8,
    pub explanation: String,
    pub evidence: Vec<EvidenceRefDto>,
}

/// Staged traffic/capture shedding stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ShedStageDto {
    #[default]
    None,
    PayloadsOff,
    SampleDissection,
    CoarsenMetrics,
    DropPackets,
}

/// Capture pipeline buffer and health metrics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureStatsDto {
    pub buffer_frames: usize,
    pub buffer_capacity: usize,
    pub shed_stage: ShedStageDto,
    pub dropped: u64,
}

/// Diagnostic chain stage kind on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DiagnosticChainStageKindDto {
    Device,
    Interface,
    Router,
    Isp,
    Dns,
    Cdn,
    Destination,
}

/// Diagnostic stage status on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DiagnosticStageStatusDto {
    Healthy,
    Degraded,
    Investigate,
    Unknown,
    NotMeasurable,
}

/// Measurement state on the wire (observed vs inferred vs unknown vs not measurable).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum MeasurementStateDto {
    Observed,
    Inferred,
    Unknown,
    NotMeasurable,
}

/// Detection state on the wire (detected vs not detected).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DetectionStateDto {
    Detected,
    NotDetected,
}

/// A node/stage in the diagnostic chain wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagnosticStageNodeDto {
    pub stage: DiagnosticChainStageKindDto,
    pub status: DiagnosticStageStatusDto,
    pub measurement_state: MeasurementStateDto,
    pub detection_state: DetectionStateDto,
    pub label: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f32>,
    pub evidence: Vec<EvidenceRefDto>,
    pub causes: Vec<CauseDto>,
    pub affected_targets: Vec<String>,
}

/// Complete diagnostic chain wire DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DiagnosticChainDto {
    pub stages: Vec<DiagnosticStageNodeDto>,
}

/// A monitoring snapshot over a window. Note the two loss
/// figures are separate fields — capture loss is never network loss
///
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorSnapshotDto {
    pub by_protocol: BreakdownDto,
    pub by_host: BreakdownDto,
    pub diagnoses: Vec<DiagnosisDto>,
    pub network_loss_indicators: u32,
    pub capture_drops: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_stats: Option<CaptureStatsDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_chain: Option<DiagnosticChainDto>,
}

/// How confident a flow's process attribution is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum AttributionConfidenceDto {
    High,
    Low,
    Unknown,
}

/// The attributed owner of a flow. `pid` is absent when honestly
/// unattributed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributionDto {
    pub pid: Option<u64>,
    pub confidence: AttributionConfidenceDto,
    pub process_name: Option<String>,
}

/// A capture-capable network interface offered for selection. `id` is
/// the handle passed back in `StartCapture`; `0` means "let the platform pick the
/// default adapter".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterfaceDto {
    pub id: u16,
    pub name: String,
    pub description: Option<String>,
}

// ===== Education ====================================
//
// The wire projections of the education surfaces. Like the DTOs above,
// these are deliberately distinct from the rich domain types in `netpulse-learn`
// / `netpulse-narrative`; the engine maps down into these stable shapes. Every
// one that asserts something about the learner's traffic carries `evidence`
//The `level` field reuses [`ProjectionDepth`] because a lesson's
// level and the UI disclosure mode share one ladder.

/// The kind of comprehension check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ExerciseKindDto {
    Identify,
    ExplainBack,
    Predict,
    Diagnose,
}

/// A comprehension check derived from the learner's own capture.
/// The `answer` is computed from real evidence, so it cannot be wrong about the
/// learner's data — kept local, never uploaded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GroundedExerciseDto {
    pub kind: ExerciseKindDto,
    pub prompt: String,
    pub answer: String,
}

/// A lesson offered because a real teachable moment occurred.
/// Calm and dismissible in the UI. `grounded` is false only for a
/// curated-example fallback, shown honestly as such.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LessonOfferDto {
    pub lesson_id: String,
    pub title: String,
    pub level: ProjectionDepth,
    pub grounded: bool,
    pub grounding: Vec<String>,
    pub exercise: Option<GroundedExerciseDto>,
    pub evidence: Vec<EvidenceRefDto>,
}

/// One reference entry in the Protocol Explorer: layered
/// content plus navigation. `examples_available` reflects a real storage lookup
/// never a guess.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplorerEntryDto {
    pub key: String,
    pub title: String,
    pub layer: String,
    pub rfc_references: Vec<u32>,
    pub related_lessons: Vec<String>,
    pub beginner: String,
    pub intermediate: String,
    pub expert: String,
    pub related: Vec<String>,
    pub examples_available: bool,
}

/// One selectable option for an interactive exercise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExerciseChoiceDto {
    pub id: String,
    pub text: String,
}

/// An interactive comprehension check for a lesson.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LessonExerciseDto {
    pub id: String,
    pub kind: ExerciseKindDto,
    pub prompt: String,
    pub choices: Vec<ExerciseChoiceDto>,
    pub explanation: String,
}

/// One step in an educational walkthrough.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LessonStepDto {
    pub id: String,
    pub body_key: String,
    pub title: String,
    pub content: String,
    pub anim: Option<String>,
}

/// A lesson summary item within a curriculum module.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurriculumLessonDto {
    pub id: String,
    pub title: String,
    pub level: ProjectionDepth,
    pub prerequisites: Vec<String>,
    pub objectives: Vec<String>,
    pub related_concepts: Vec<String>,
    pub status: String,
    pub mastery: f32,
    pub is_locked: bool,
    pub is_grounded: bool,
}

/// A module containing a cohesive group of lessons.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurriculumModuleDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub level: ProjectionDepth,
    pub lessons: Vec<CurriculumLessonDto>,
}

/// Complete detail for one lesson workspace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LessonDetailDto {
    pub lesson_id: String,
    pub title: String,
    pub level: ProjectionDepth,
    pub prerequisites: Vec<String>,
    pub objectives: Vec<String>,
    pub related_concepts: Vec<String>,
    pub steps: Vec<LessonStepDto>,
    pub exercises: Vec<LessonExerciseDto>,
    pub animation: Option<AnimationModelDto>,
    pub evidence: Vec<EvidenceRefDto>,
    pub grounding: Vec<String>,
    pub status: String,
    pub mastery: f32,
}

/// High-level learning progress and mastery summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LearningProgressDto {
    pub total_lessons: u32,
    pub completed_lessons: u32,
    pub mastered_lessons: u32,
    pub in_progress_lessons: u32,
    pub overall_mastery_pct: u32,
    pub next_recommended_lesson_id: Option<String>,
}

/// Outcome of submitting an exercise answer choice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExerciseValidationOutcomeDto {
    pub is_correct: bool,
    pub feedback: String,
    pub explanation: String,
    pub correct_choice_index: u32,
    pub new_mastery: f32,
    pub status: String,
}

/// A stage of a website journey.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum StageKindDto {
    Navigation,
    DnsResolution,
    Connection,
    Encryption,
    Request,
    FanOut,
    Completion,
}

/// One narrated journey stage. `detail` is the intermediate+
/// technical line, disclosed progressively.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JourneyStageDto {
    pub kind: StageKindDto,
    pub title: String,
    pub narration: String,
    pub detail: Option<String>,
    pub evidence: Vec<EvidenceRefDto>,
}

/// One node of the CDN/organization fan-out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FanoutNodeDto {
    pub label: String,
    pub flows: u32,
    pub bytes: u64,
    pub evidence: Vec<EvidenceRefDto>,
}

/// The complete website journey for one session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageJourneyDto {
    pub session_id: u64,
    pub stages: Vec<JourneyStageDto>,
    pub fanout: Vec<FanoutNodeDto>,
}

/// Which way a visual element moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DirectionDto {
    ClientToServer,
    ServerToClient,
}

/// The concept an animation makes legible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum AnimationKindDto {
    PacketFlow,
    Handshake,
    Multiplexing,
    FanOut,
    Degradation,
}

/// One timed, typed visual event on the real timeline. `key` ties
/// the element to its explanation. Colour is deliberately absent —
/// styling lives in the design system, not the wire model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VisualEventDto {
    pub at_nanos: u64,
    pub direction: DirectionDto,
    pub label: String,
    pub key: Option<String>,
}

/// A complete animation model. `reduced_motion` is the mandatory
/// static/step-through equivalent — always present, so a
/// reduced-motion or screen-reader user gets the same events as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnimationModelDto {
    pub kind: AnimationKindDto,
    pub events: Vec<VisualEventDto>,
    pub total_nanos: u64,
    pub reduced_motion: Vec<String>,
}

// ===== Intelligence =================================
//
// The wire projections of the Security Engine and AI Assistant. Like every DTO
// above, these are distinct from the rich domain types in `netpulse-intel` /
// `netpulse-ai`; the engine maps down into these stable shapes. Honesty is on
// the wire, not just in the backend: a finding carries its confidence, its
// qualitative word, its *benign* explanations, and its evidence — so the UI
// physically cannot render an unexplained, evidence-free, or over-certain alert
//The assistant answer carries its citations and privacy posture
//

/// The broad category a [`SecurityFindingDto`] rolls up to. Mirrors
/// `netpulse_core::FindingCategory`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum FindingCategoryDto {
    /// Statistical/ML deviation from this machine's learned normal.
    Anomaly,
    /// A rule/heuristic-matched suspicious behavior.
    Suspicious,
    /// Informational observation worth surfacing without alarm.
    Informational,
}

/// The specific behavior a finding describes — the
/// named, bounded set, never a vague "threat". Mirrors `netpulse_intel::FindingKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum FindingKindDto {
    UnexpectedEgress,
    Beaconing,
    PortScan,
    DnsAnomaly,
    ConnectionStorm,
    BandwidthAnomaly,
    MlFeatureAnomaly,
    ThreatIntelMatch,
    AppProfileBreach,
    BehavioralChain,
}

/// A security/anomaly finding, ready to render as a calm, confidence-labeled card
///Every field encodes an honesty guarantee: `confidence_percent`
/// is calibrated and never 100 for an inference; `qualitative` is the
/// plain word a beginner reads instead of a percentage; `benign_explanations` names
/// why the behavior might be innocent; `suggested_action` is always
/// non-destructive; `evidence` makes every claim auditable
///`corroboration` lists the other signals that combined into this
/// one. `technical` is disclosed only at Intermediate+.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SecurityFindingDto {
    pub kind: FindingKindDto,
    pub category: FindingCategoryDto,
    pub title: String,
    pub confidence_percent: u8,
    pub qualitative: String,
    pub explanation: String,
    pub technical: Option<String>,
    pub benign_explanations: Vec<String>,
    pub suggested_action: String,
    pub evidence: Vec<EvidenceRefDto>,
    pub corroboration: Vec<FindingKindDto>,
}

/// A node within an incident narrative timeline DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimelineNodeDto {
    pub finding: SecurityFindingDto,
    pub timestamp_nanos: u64,
    pub stage_label: String,
}

/// Stitched incident narrative timeline DTO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IncidentTimelineDto {
    pub id: u64,
    pub title: String,
    pub narrative_summary: String,
    pub severity: String,
    pub nodes: Vec<TimelineNodeDto>,
    pub aggregated_evidence: Vec<EvidenceRefDto>,
    pub suggested_actions: Vec<String>,
}

/// A grounded AI answer. `citations` are validated to exist before
/// send; `grounded` is false for an honest "can't answer from your
/// data". `is_remote`/`backend_id` keep the privacy posture visible
///and `disclosure` is exactly what a remote backend *would* be sent
/// — shown before any opt-in so there are no silent uploads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssistantAnswerDto {
    pub text: String,
    pub citations: Vec<EvidenceRefDto>,
    pub grounded: bool,
    pub backend_id: String,
    pub is_remote: bool,
    pub disclosure: String,
}

// ===== Lifecycle & Extensibility ====================
//
// The wire projections of Recording, Replay, Export, and Plugins. As with every
// DTO above, these are distinct from the rich domain types in `netpulse-capture`
// / `netpulse-engine` / `netpulse-plugin`; the engine maps down into these stable
// shapes. Honesty travels on the wire: a recording states its exact payload level
// and version pins; a replay reports incompleteness;
// an export preview names exactly what it contains before any bytes are written
//a plugin descriptor exposes its capabilities and trust so enabling
// one is an informed act.

/// The payload level a recording/export carries. Mirrors
/// `netpulse_capture::RecordingPayloadLevel`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PayloadLevelDto {
    #[default]
    MetadataOnly,
    Headers,
    FullPayload,
}

/// The engine/model/content versions pinned into a recording, so
/// replay can reproduce the same processing or honestly disclose drift.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionPinsDto {
    pub engine: String,
    pub decode: String,
    pub intel: String,
    pub ai: String,
    pub content: String,
}

/// What a recording actually holds, made explicit. `contains_payloads`
/// is a tested invariant for metadata-only recordings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivacyManifestDto {
    pub level: PayloadLevelDto,
    pub contains_payloads: bool,
    pub redactions: Vec<String>,
}

/// A recording listed for the user. Everything needed to understand
/// and choose a recording without opening it: its window, size, privacy level, and
/// determinism metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingSummaryDto {
    pub id: u64,
    pub from_mono_nanos: u64,
    pub to_mono_nanos: u64,
    pub frame_count: u64,
    pub api_version: u32,
    pub version_pins: VersionPinsDto,
    pub privacy: PrivacyManifestDto,
    /// True when the recording was truncated/recovered — surfaced so
    /// review knows the reconstruction is incomplete.
    pub incomplete: bool,
}

/// The playback state of a replay. `speed_percent` is 100 for 1×, 10
/// for slow-motion teaching, 1000 for 10× review — an integer so it stays exact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayStateDto {
    pub position_nanos: u64,
    pub total_nanos: u64,
    pub speed_percent: u32,
    pub playing: bool,
    pub frame_index: u64,
    pub incomplete: bool,
}

/// An open export format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ExportFormatDto {
    /// Raw frames for Wireshark/tcpdump (the interop gold standard .
    Pcapng,
    /// The structured model — flows/sessions/events/findings with evidence refs.
    Json,
    /// Tabular flows/metrics for spreadsheets.
    Csv,
    /// A narrated, human-readable journey/incident (HTML).
    Report,
}

/// What to export — a selection, not just "everything". Tagged union:
/// `{ "kind": "session", "id": 7 }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[non_exhaustive]
pub enum ExportSelectionDto {
    /// A time window (from Timeline range-select .
    Window {
        from_mono_nanos: u64,
        to_mono_nanos: u64,
    },
    /// A single session/journey.
    Session { id: u64 },
    /// A finding + its evidence.
    Finding { id: u64 },
    /// The entire committed capture.
    All,
}

/// A preview of exactly what an export will contain, shown before it is written or
/// shared. Default least-revealing; the user sees payload level,
/// counts, the sanitizations applied, and provenance before any bytes exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportPreviewDto {
    pub format: ExportFormatDto,
    pub level: PayloadLevelDto,
    pub flows: u32,
    pub sessions: u32,
    pub hosts: u32,
    pub contains_payloads: bool,
    /// The sanitizations applied to this export, each named.
    pub sanitized: Vec<String>,
    /// Provenance line: producing version + payload level.
    pub provenance: String,
}

/// A plugin extension seam. Mirrors `netpulse_plugin::PluginType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PluginTypeDto {
    Dissector,
    Enrichment,
    Detector,
    View,
    Export,
}

/// A capability granted to a plugin. Note there is **no** network or
/// system variant — no plugin can acquire egress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PluginCapabilityDto {
    ParseBytes,
    ReadModel,
    EmitFindings,
    ReadLocalData,
    ApiRead,
    WriteOutput,
}

/// A plugin's trust/review status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PluginTrustDto {
    Unreviewed,
    Reviewed,
    FirstParty,
}

/// A plugin as listed for the user. Its type, granted capabilities,
/// trust, contract compatibility, activation state, and active configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginDescriptorDto {
    pub name: String,
    pub plugin_type: PluginTypeDto,
    pub capabilities: Vec<PluginCapabilityDto>,
    pub trust: PluginTrustDto,
    pub source: String,
    pub target_contract: u32,
    pub compatible: bool,
    pub enabled: bool,
    /// Present when inactive, explaining why — never a silent disable.
    pub disabled_reason: Option<String>,
    pub config_version: u32,
    pub config: serde_json::Value,
    pub config_schema: Option<serde_json::Value>,
}

/// Individual component check item for health DTO reporting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComponentCheckDto {
    pub component: String,
    pub status: String,
    pub message: Option<String>,
}

/// Machine-readable warning codes for API version negotiation.
pub mod handshake_codes {
    pub const DEPRECATED_API_VERSION: &str = "DEPRECATED_API_VERSION";
}

/// Machine-readable error codes for API version negotiation failures.
pub mod handshake_error_codes {
    pub const UNSUPPORTED_CLIENT_VERSION_TOO_OLD: &str = "UNSUPPORTED_CLIENT_VERSION_TOO_OLD";
    pub const UNSUPPORTED_CLIENT_VERSION_TOO_NEW: &str = "UNSUPPORTED_CLIENT_VERSION_TOO_NEW";
    pub const INVALID_VERSION_RANGE: &str = "INVALID_VERSION_RANGE";
}

/// API handshake result DTO returned directly by version negotiation.
/// The client MUST execute a handshake query upon connection before issuing other queries.
/// The `negotiated_version` is authoritative for all subsequent communication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandshakeResponseDto {
    pub compatible: bool,
    pub negotiated_version: Option<u32>,
    pub host_version: u32,
    pub min_supported_version: u32,
    pub warning_code: Option<String>,
    pub warning: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
}

/// Comprehensive health and liveness status DTO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthStatusDto {
    pub schema_version: u32,
    pub status: String,
    pub uptime_secs: u64,
    pub capture_running: bool,
    pub active_flows: usize,
    pub active_sessions: usize,
    pub store_records: u64,
    pub checks: Vec<ComponentCheckDto>,
    pub version: String,
    pub api_version: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip<T>(value: &T)
    where
        T: Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_string(value).expect("serialize");
        let back: T = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(value, &back);
    }

    #[test]
    fn evidence_ref_is_tagged() {
        let json = serde_json::to_string(&EvidenceRefDto::Flow(12)).unwrap();
        assert_eq!(json, r#"{"kind":"flow","id":12}"#);
    }

    #[test]
    fn dtos_round_trip() {
        roundtrip(&ProjectionDepth::Intermediate);
        roundtrip(&EvidenceRefDto::Session(1));
        roundtrip(&NarrativeCardDto {
            headline: "Connected to example.com".into(),
            summary: "Encrypted · 240 KB".into(),
            lines: vec!["Encrypted".into(), "240 KB from 6 servers".into()],
            severity: SeverityDto::Neutral,
            evidence: vec![EvidenceRefDto::Session(1), EvidenceRefDto::Flow(2)],
            at_mono_nanos: 1_000,
        });
        roundtrip(&MonitorSnapshotDto {
            by_protocol: BreakdownDto {
                dimension: DimensionDto::Protocol,
                rows: vec![BreakdownRowDto {
                    label: "TLS".into(),
                    bytes: 1500,
                    flows: 2,
                    hostnames: vec![],
                    evidence: vec![EvidenceRefDto::Flow(1)],
                }],
            },
            by_host: BreakdownDto {
                dimension: DimensionDto::Host,
                rows: vec![BreakdownRowDto {
                    label: "93.184.216.34".into(),
                    bytes: 2400,
                    flows: 1,
                    hostnames: vec![HostNameDto {
                        name: "example.com".into(),
                        source: NameSourceDto::Dns,
                    }],
                    evidence: vec![EvidenceRefDto::Flow(2)],
                }],
            },
            diagnoses: vec![DiagnosisDto {
                cause: CauseDto::SlowDns,
                confidence_percent: 70,
                explanation: "looks like slow DNS".into(),
                evidence: vec![EvidenceRefDto::Flow(1)],
            }],
            network_loss_indicators: 0,
            capture_drops: 3,
            capture_stats: Some(CaptureStatsDto {
                buffer_frames: 100,
                buffer_capacity: 1000,
                shed_stage: ShedStageDto::SampleDissection,
                dropped: 3,
            }),
            diagnostic_chain: Some(DiagnosticChainDto {
                stages: vec![DiagnosticStageNodeDto {
                    stage: DiagnosticChainStageKindDto::Device,
                    status: DiagnosticStageStatusDto::Healthy,
                    measurement_state: MeasurementStateDto::Observed,
                    detection_state: DetectionStateDto::Detected,
                    label: "Device (Local Stack)".into(),
                    summary: "Nominal".into(),
                    detail: None,
                    latency_ms: None,
                    evidence: vec![],
                    causes: vec![],
                    affected_targets: vec![],
                }],
            }),
        });
        roundtrip(&AttributionDto {
            pid: None,
            confidence: AttributionConfidenceDto::Unknown,
            process_name: None,
        });
        roundtrip(&InterfaceDto {
            id: 3,
            name: "\\Device\\NPF_{GUID}".into(),
            description: Some("Wi-Fi".into()),
        });
    }

    #[test]
    fn shed_stage_uses_snake_case() {
        assert_eq!(
            serde_json::to_string(&ShedStageDto::SampleDissection).unwrap(),
            r#""sample_dissection""#
        );
        assert_eq!(
            serde_json::to_string(&ShedStageDto::PayloadsOff).unwrap(),
            r#""payloads_off""#
        );
        assert_eq!(
            serde_json::to_string(&ShedStageDto::CoarsenMetrics).unwrap(),
            r#""coarsen_metrics""#
        );
        assert_eq!(
            serde_json::to_string(&ShedStageDto::DropPackets).unwrap(),
            r#""drop_packets""#
        );
    }

    #[test]
    fn cause_uses_snake_case() {
        let json = serde_json::to_string(&CauseDto::LocalWifi).unwrap();
        assert_eq!(json, r#""local_wifi""#);
    }

    #[test]
    fn name_source_is_snake_case_and_hostname_round_trips() {
        assert_eq!(
            serde_json::to_string(&NameSourceDto::Sni).unwrap(),
            r#""sni""#
        );
        assert_eq!(
            serde_json::to_string(&NameSourceDto::Dns).unwrap(),
            r#""dns""#
        );
        // The host-environment sources are multi-word; snake_case must match the
        // codegen union string exactly or the drift gate fails.
        assert_eq!(
            serde_json::to_string(&NameSourceDto::HostsFile).unwrap(),
            r#""hosts_file""#
        );
        assert_eq!(
            serde_json::to_string(&NameSourceDto::OsResolver).unwrap(),
            r#""os_resolver""#
        );
        roundtrip(&HostNameDto {
            name: "netflix.com".into(),
            source: NameSourceDto::Sni,
        });
        roundtrip(&HostNameDto {
            name: "nas.local".into(),
            source: NameSourceDto::OsResolver,
        });
    }

    #[test]
    fn education_dtos_round_trip() {
        roundtrip(&LessonOfferDto {
            lesson_id: "b5.encryption".into(),
            title: "Encryption: why the padlock".into(),
            level: ProjectionDepth::Beginner,
            grounded: true,
            grounding: vec!["Your connection to example.com was encrypted (TLS).".into()],
            exercise: Some(GroundedExerciseDto {
                kind: ExerciseKindDto::ExplainBack,
                prompt: "What did the ClientHello propose?".into(),
                answer: "TLS versions and cipher suites".into(),
            }),
            evidence: vec![EvidenceRefDto::Session(7), EvidenceRefDto::Flow(10)],
        });
        roundtrip(&ExplorerEntryDto {
            key: "tcp.flags.syn".into(),
            title: "TCP flags syn".into(),
            layer: "L4 (Transport)".into(),
            rfc_references: vec![9293],
            related_lessons: vec!["b4.handshake".into()],
            beginner: "starts a connection".into(),
            intermediate: "opens a connection".into(),
            expert: "TCP SYN control bit".into(),
            related: vec!["tcp.flags.ack".into()],
            examples_available: true,
        });
        roundtrip(&CurriculumModuleDto {
            id: "m.basics".into(),
            title: "How the web loads".into(),
            description: "Core fundamentals".into(),
            level: ProjectionDepth::Beginner,
            lessons: vec![CurriculumLessonDto {
                id: "b3.dns".into(),
                title: "DNS".into(),
                level: ProjectionDepth::Beginner,
                prerequisites: vec![],
                objectives: vec!["Learn DNS".into()],
                related_concepts: vec!["dns.query".into()],
                status: "not_started".into(),
                mastery: 0.0,
                is_locked: false,
                is_grounded: true,
            }],
        });
        roundtrip(&LearningProgressDto {
            total_lessons: 5,
            completed_lessons: 1,
            mastered_lessons: 0,
            in_progress_lessons: 1,
            overall_mastery_pct: 20,
            next_recommended_lesson_id: Some("b4.handshake".into()),
        });
        roundtrip(&ExerciseValidationOutcomeDto {
            is_correct: true,
            feedback: "Correct!".into(),
            explanation: "RFC 9293".into(),
            correct_choice_index: 0,
            new_mastery: 0.34,
            status: "in_progress".into(),
        });
        roundtrip(&PageJourneyDto {
            session_id: 1,
            stages: vec![JourneyStageDto {
                kind: StageKindDto::DnsResolution,
                title: "DNS resolution".into(),
                narration: "Your computer looked up example.com.".into(),
                detail: Some("DNS resolved in 12 ms".into()),
                evidence: vec![EvidenceRefDto::Session(1)],
            }],
            fanout: vec![FanoutNodeDto {
                label: "Cloudflare".into(),
                flows: 2,
                bytes: 300,
                evidence: vec![EvidenceRefDto::Flow(1)],
            }],
        });
        roundtrip(&AnimationModelDto {
            kind: AnimationKindDto::Handshake,
            events: vec![VisualEventDto {
                at_nanos: 0,
                direction: DirectionDto::ClientToServer,
                label: "SYN".into(),
                key: Some("tcp.flags.syn".into()),
            }],
            total_nanos: 30_000_000,
            reduced_motion: vec!["0.0 ms · SYN (you → server)".into()],
        });
    }

    #[test]
    fn intelligence_dtos_round_trip() {
        roundtrip(&SecurityFindingDto {
            kind: FindingKindDto::Beaconing,
            category: FindingCategoryDto::Suspicious,
            title: "An app is contacting one server on a regular schedule".into(),
            confidence_percent: 61,
            qualitative: "notably unusual".into(),
            explanation: "Connected every ~60s; often telemetry, sometimes beaconing.".into(),
            technical: Some("interval mean 60.0s, cv 0.02".into()),
            benign_explanations: vec!["Software update checks or telemetry".into()],
            suggested_action: "You can mark this as expected if you recognize it.".into(),
            evidence: vec![EvidenceRefDto::Flow(10), EvidenceRefDto::Flow(11)],
            corroboration: vec![FindingKindDto::UnexpectedEgress],
        });
        roundtrip(&AssistantAnswerDto {
            text: "203.0.113.9 moved 5.7 MB".into(),
            citations: vec![EvidenceRefDto::Flow(1)],
            grounded: true,
            backend_id: "local-template".into(),
            is_remote: false,
            disclosure: "No packet payloads are ever sent.".into(),
        });
    }

    #[test]
    fn intelligence_enums_use_expected_reprs() {
        // The TS emitter mirrors these exact wire strings; a mismatch fails the
        // drift gate.
        assert_eq!(
            serde_json::to_string(&FindingKindDto::PortScan).unwrap(),
            r#""port_scan""#
        );
        assert_eq!(
            serde_json::to_string(&FindingKindDto::BandwidthAnomaly).unwrap(),
            r#""bandwidth_anomaly""#
        );
        assert_eq!(
            serde_json::to_string(&FindingCategoryDto::Suspicious).unwrap(),
            r#""suspicious""#
        );
    }

    #[test]
    fn lifecycle_dtos_round_trip() {
        roundtrip(&RecordingSummaryDto {
            id: 1,
            from_mono_nanos: 0,
            to_mono_nanos: 5_000_000_000,
            frame_count: 128,
            api_version: 4,
            version_pins: VersionPinsDto {
                engine: "0.1.0".into(),
                decode: "0.1.0".into(),
                intel: "0.1.0".into(),
                ai: "0.1.0".into(),
                content: "0.1.0".into(),
            },
            privacy: PrivacyManifestDto {
                level: PayloadLevelDto::MetadataOnly,
                contains_payloads: false,
                redactions: vec![],
            },
            incomplete: false,
        });
        roundtrip(&ReplayStateDto {
            position_nanos: 1_000_000,
            total_nanos: 5_000_000,
            speed_percent: 100,
            playing: true,
            frame_index: 12,
            incomplete: false,
        });
        roundtrip(&ExportSelectionDto::Session { id: 7 });
        roundtrip(&ExportPreviewDto {
            format: ExportFormatDto::Json,
            level: PayloadLevelDto::MetadataOnly,
            flows: 10,
            sessions: 2,
            hosts: 4,
            contains_payloads: false,
            sanitized: vec!["metadata-only: no payloads".into()],
            provenance: "NetPulse 0.1.0 · metadata-only".into(),
        });
        roundtrip(&PluginDescriptorDto {
            name: "example-dissector".into(),
            plugin_type: PluginTypeDto::Dissector,
            capabilities: vec![PluginCapabilityDto::ParseBytes],
            trust: PluginTrustDto::FirstParty,
            source: "in-tree".into(),
            target_contract: 4,
            compatible: true,
            enabled: true,
            disabled_reason: None,
            config_version: 1,
            config: serde_json::json!({}),
            config_schema: None,
        });
    }

    #[test]
    fn lifecycle_enums_use_expected_reprs() {
        // The TS emitter mirrors these exact wire strings; a mismatch fails the
        // drift gate.
        assert_eq!(
            serde_json::to_string(&PayloadLevelDto::MetadataOnly).unwrap(),
            r#""metadata_only""#
        );
        assert_eq!(
            serde_json::to_string(&ExportFormatDto::Pcapng).unwrap(),
            r#""pcapng""#
        );
        assert_eq!(
            serde_json::to_string(&PluginCapabilityDto::ReadLocalData).unwrap(),
            r#""read_local_data""#
        );
        // The export selection is an internally-tagged union.
        assert_eq!(
            serde_json::to_string(&ExportSelectionDto::All).unwrap(),
            r#"{"kind":"all"}"#
        );
        assert_eq!(
            serde_json::to_string(&ExportSelectionDto::Window {
                from_mono_nanos: 1,
                to_mono_nanos: 2
            })
            .unwrap(),
            r#"{"kind":"window","from_mono_nanos":1,"to_mono_nanos":2}"#
        );
    }

    #[test]
    fn education_enums_use_snake_case() {
        // The TS emitter mirrors these exact wire strings; a mismatch fails the
        // drift gate.
        assert_eq!(
            serde_json::to_string(&ExerciseKindDto::ExplainBack).unwrap(),
            r#""explain_back""#
        );
        assert_eq!(
            serde_json::to_string(&StageKindDto::DnsResolution).unwrap(),
            r#""dns_resolution""#
        );
        assert_eq!(
            serde_json::to_string(&AnimationKindDto::FanOut).unwrap(),
            r#""fan_out""#
        );
        assert_eq!(
            serde_json::to_string(&DirectionDto::ClientToServer).unwrap(),
            r#""client_to_server""#
        );
    }

    #[test]
    fn diagnostic_chain_enums_use_snake_case() {
        assert_eq!(
            serde_json::to_string(&DiagnosticChainStageKindDto::Device).unwrap(),
            r#""device""#
        );
        assert_eq!(
            serde_json::to_string(&DiagnosticChainStageKindDto::Interface).unwrap(),
            r#""interface""#
        );
        assert_eq!(
            serde_json::to_string(&DiagnosticStageStatusDto::Healthy).unwrap(),
            r#""healthy""#
        );
        assert_eq!(
            serde_json::to_string(&DiagnosticStageStatusDto::NotMeasurable).unwrap(),
            r#""not_measurable""#
        );
        assert_eq!(
            serde_json::to_string(&MeasurementStateDto::Observed).unwrap(),
            r#""observed""#
        );
        assert_eq!(
            serde_json::to_string(&MeasurementStateDto::NotMeasurable).unwrap(),
            r#""not_measurable""#
        );
        assert_eq!(
            serde_json::to_string(&DetectionStateDto::Detected).unwrap(),
            r#""detected""#
        );
        assert_eq!(
            serde_json::to_string(&DetectionStateDto::NotDetected).unwrap(),
            r#""not_detected""#
        );
    }

    #[test]
    fn diagnostic_chain_dto_roundtrips() {
        let chain = DiagnosticChainDto {
            stages: vec![DiagnosticStageNodeDto {
                stage: DiagnosticChainStageKindDto::Device,
                status: DiagnosticStageStatusDto::Healthy,
                measurement_state: MeasurementStateDto::Observed,
                detection_state: DetectionStateDto::Detected,
                label: "Device (Local Stack)".to_string(),
                summary: "Local Capture Pipeline Operational".to_string(),
                detail: Some("Buffer nominal".to_string()),
                latency_ms: None,
                evidence: vec![EvidenceRefDto::Flow(1)],
                causes: vec![CauseDto::LocalWifi],
                affected_targets: vec!["1.1.1.1".to_string()],
            }],
        };
        let json = serde_json::to_string(&chain).unwrap();
        let parsed: DiagnosticChainDto = serde_json::from_str(&json).unwrap();
        assert_eq!(chain, parsed);
    }
}
