// GENERATED from the netpulse-api crate — do not hand-edit.
// Regenerate with: cargo test -p netpulse-api -- --ignored write_contract
// A CI drift check fails the build if this file is out of sync.

export const API_VERSION = 6 as const;
export const MIN_SUPPORTED_API_VERSION = 5 as const;

export type ProjectionDepth = "beginner" | "intermediate" | "expert";

export type Severity = "neutral" | "notable" | "finding";

export type Dimension = "protocol" | "host" | "interface";

export type NameSource = "dns" | "sni" | "hosts_file" | "os_resolver";

export type Cause = "local_wifi" | "distant_server" | "slow_dns" | "congestion";

export type AttributionConfidence = "high" | "low" | "unknown";

export type ShedStage = "none" | "payloads_off" | "sample_dissection" | "coarsen_metrics" | "drop_packets";

export type EvidenceRef =
  | { kind: "packet"; id: number }
  | { kind: "flow"; id: number }
  | { kind: "session"; id: number };

export interface NarrativeCard {
  headline: string;
  summary: string;
  lines: string[];
  severity: Severity;
  evidence: EvidenceRef[];
  at_mono_nanos: number;
}

export interface HostName {
  name: string;
  source: NameSource;
}

export interface BreakdownRow {
  label: string;
  bytes: number;
  flows: number;
  hostnames: HostName[];
  evidence: EvidenceRef[];
}

export interface Breakdown {
  dimension: Dimension;
  rows: BreakdownRow[];
}

export interface Diagnosis {
  cause: Cause;
  confidence_percent: number;
  explanation: string;
  evidence: EvidenceRef[];
}

export interface CaptureStats {
  buffer_frames: number;
  buffer_capacity: number;
  shed_stage: ShedStage;
  dropped: number;
}

export interface MonitorSnapshot {
  by_protocol: Breakdown;
  by_host: Breakdown;
  diagnoses: Diagnosis[];
  network_loss_indicators: number;
  capture_drops: number;
  capture_stats?: CaptureStats;
}

export interface Attribution {
  pid: number | null;
  confidence: AttributionConfidence;
  process_name: string | null;
}

export interface Interface {
  id: number;
  name: string;
  description: string | null;
}

export type ExerciseKind = "identify" | "explain_back" | "predict" | "diagnose";

export type StageKind = "navigation" | "dns_resolution" | "connection" | "encryption" | "request" | "fan_out" | "completion";

export type Direction = "client_to_server" | "server_to_client";

export type AnimationKind = "packet_flow" | "handshake" | "multiplexing" | "fan_out" | "degradation";

export interface GroundedExercise {
  kind: ExerciseKind;
  prompt: string;
  answer: string;
}

export interface LessonOffer {
  lesson_id: string;
  title: string;
  level: ProjectionDepth;
  grounded: boolean;
  grounding: string[];
  exercise: GroundedExercise | null;
  evidence: EvidenceRef[];
}

export interface ExplorerEntry {
  key: string;
  title: string;
  layer: string;
  rfc_references: number[];
  related_lessons: string[];
  beginner: string;
  intermediate: string;
  expert: string;
  related: string[];
  examples_available: boolean;
}

export interface ExerciseChoice {
  id: string;
  text: string;
}

export interface LessonExercise {
  id: string;
  kind: ExerciseKind;
  prompt: string;
  choices: ExerciseChoice[];
  explanation: string;
}

export interface LessonStep {
  id: string;
  body_key: string;
  title: string;
  content: string;
  anim: string | null;
}

export interface CurriculumLesson {
  id: string;
  title: string;
  level: ProjectionDepth;
  prerequisites: string[];
  objectives: string[];
  related_concepts: string[];
  status: string;
  mastery: number;
  is_locked: boolean;
  is_grounded: boolean;
}

export interface CurriculumModule {
  id: string;
  title: string;
  description: string;
  level: ProjectionDepth;
  lessons: CurriculumLesson[];
}

export interface LessonDetail {
  lesson_id: string;
  title: string;
  level: ProjectionDepth;
  prerequisites: string[];
  objectives: string[];
  related_concepts: string[];
  steps: LessonStep[];
  exercises: LessonExercise[];
  animation: AnimationModel | null;
  evidence: EvidenceRef[];
  grounding: string[];
  status: string;
  mastery: number;
}

export interface LearningProgress {
  total_lessons: number;
  completed_lessons: number;
  mastered_lessons: number;
  in_progress_lessons: number;
  overall_mastery_pct: number;
  next_recommended_lesson_id: string | null;
}

export interface ExerciseValidationOutcome {
  is_correct: boolean;
  feedback: string;
  explanation: string;
  correct_choice_index: number;
  new_mastery: number;
  status: string;
}

export interface JourneyStage {
  kind: StageKind;
  title: string;
  narration: string;
  detail: string | null;
  evidence: EvidenceRef[];
}

export interface FanoutNode {
  label: string;
  flows: number;
  bytes: number;
  evidence: EvidenceRef[];
}

export interface PageJourney {
  session_id: number;
  stages: JourneyStage[];
  fanout: FanoutNode[];
}

export interface VisualEvent {
  at_nanos: number;
  direction: Direction;
  label: string;
  key: string | null;
}

export interface AnimationModel {
  kind: AnimationKind;
  events: VisualEvent[];
  total_nanos: number;
  reduced_motion: string[];
}

export type FindingCategory = "anomaly" | "suspicious" | "informational";

export type FindingKind = "unexpected_egress" | "beaconing" | "port_scan" | "dns_anomaly" | "connection_storm" | "bandwidth_anomaly" | "ml_feature_anomaly" | "threat_intel_match" | "app_profile_breach" | "behavioral_chain";

export interface SecurityFinding {
  kind: FindingKind;
  category: FindingCategory;
  title: string;
  confidence_percent: number;
  qualitative: string;
  explanation: string;
  technical: string | null;
  benign_explanations: string[];
  suggested_action: string;
  evidence: EvidenceRef[];
  corroboration: FindingKind[];
}

export interface TimelineNode {
  finding: SecurityFinding;
  timestamp_nanos: number;
  stage_label: string;
}

export interface IncidentTimeline {
  id: number;
  title: string;
  narrative_summary: string;
  severity: string;
  nodes: TimelineNode[];
  aggregated_evidence: EvidenceRef[];
  suggested_actions: string[];
}

export interface AssistantAnswer {
  text: string;
  citations: EvidenceRef[];
  grounded: boolean;
  backend_id: string;
  is_remote: boolean;
  disclosure: string;
}

export type PayloadLevel = "metadata_only" | "headers" | "full_payload";

export type ExportFormat = "pcapng" | "json" | "csv" | "report";

export type PluginType = "dissector" | "enrichment" | "detector" | "view" | "export";

export type PluginCapability = "parse_bytes" | "read_model" | "emit_findings" | "read_local_data" | "api_read" | "write_output";

export type PluginTrust = "unreviewed" | "reviewed" | "first_party";

export type ExportSelection =
  | { kind: "window"; from_mono_nanos: number; to_mono_nanos: number }
  | { kind: "session"; id: number }
  | { kind: "finding"; id: number }
  | { kind: "all" };

export interface VersionPins {
  engine: string;
  decode: string;
  intel: string;
  ai: string;
  content: string;
}

export interface PrivacyManifest {
  level: PayloadLevel;
  contains_payloads: boolean;
  redactions: string[];
}

export interface RecordingSummary {
  id: number;
  from_mono_nanos: number;
  to_mono_nanos: number;
  frame_count: number;
  api_version: number;
  version_pins: VersionPins;
  privacy: PrivacyManifest;
  incomplete: boolean;
}

export interface ReplayState {
  position_nanos: number;
  total_nanos: number;
  speed_percent: number;
  playing: boolean;
  frame_index: number;
  incomplete: boolean;
}

export interface ExportPreview {
  format: ExportFormat;
  level: PayloadLevel;
  flows: number;
  sessions: number;
  hosts: number;
  contains_payloads: boolean;
  sanitized: string[];
  provenance: string;
}

export interface PluginDescriptor {
  name: string;
  plugin_type: PluginType;
  capabilities: PluginCapability[];
  trust: PluginTrust;
  source: string;
  target_contract: number;
  compatible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  config_version: number;
  config: any;
  config_schema: any | null;
}

export interface HandshakeResponse {
  compatible: boolean;
  negotiated_version: number | null;
  host_version: number;
  min_supported_version: number;
  warning_code: string | null;
  warning: string | null;
  error_code: string | null;
  error: string | null;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface PingResult {
  target: string;
  sent: number;
  received: number;
  lossPct?: number;
  minRttMs?: number;
  avgRttMs?: number;
  maxRttMs?: number;
  stddevRttMs?: number;
}

export interface TracerouteHop {
  ttl: number;
  ip: string;
  hostname?: string | null;
  rttMs?: number;
  status?: string;
}

export interface BufferbloatResult {
  target: string;
  idleRttMs?: number;
  loadedRttMs?: number;
  deltaRttMs?: number;
  grade: string;
}

export interface FieldDiagnostic {
  severity: DiagnosticSeverity;
  field: string;
  rfcReference: string;
  explanation: string;
}

export interface PacketInspection {
  rawHex: string;
  layers: readonly string[];
  diagnostics: readonly FieldDiagnostic[];
}

export interface SessionDiff {
  sessionIdA: number;
  sessionIdB: number;
  rttDeltaMs: number;
  ttfbDeltaMs: number;
  protocolShift: string;
  semanticExplanation: string;
  confidence: string;
  evidence: string[];
}

export interface FleetHost {
  hostId: string;
  hostname: string;
  friendlyName?: string | null;
  os: string;
  platform: string;
  agentVersion: string;
  status: string;
}
