// Barrel for the generated contract types.
//
// `generated.ts` is emitted from the `netpulse-api` Rust crate and must not be
// hand-edited (see its header). This file adds the hand-written *message*
// wrappers — the Query/Command/StreamChannel envelopes — that reference those
// generated shapes, so the whole IPC contract is importable from one place:
//
//   import type { NarrativeCard, Query } from "@netpulse/contract";

export * from "./generated";

export type {
  DiagnosticChain,
  DiagnosticStageNode,
  DiagnosticChainStageKind,
  DiagnosticStageStatus,
  MeasurementState,
  DetectionState,
} from "./generated";

import type {
  MonitorSnapshot,
  NarrativeCard,
  Attribution,
  ProjectionDepth,
  LessonOffer,
  ExplorerEntry,
  PageJourney,
  AnimationModel,
  SecurityFinding,
  AssistantAnswer,
  RecordingSummary,
  ReplayState,
  ExportPreview,
  ExportSelection,
  ExportFormat,
  PayloadLevel,
  PluginDescriptor,
  Interface,
  HandshakeResponse,
  PingResult,
  TracerouteHop,
  BufferbloatResult,
  GatewayResult,
  DnsResult,
  HttpResult,
  PacketInspection,
  SessionDiff,
  FleetHost,
  CurriculumModule,
  LessonDetail,
  LearningProgress,
  ExerciseValidationOutcome,
} from "./generated";

/** Live channels the UI subscribes to (mirrors `netpulse_api::StreamChannel`). */
export type StreamChannel = "flows" | "metrics" | "findings" | "narratives";

/** Pull requests (mirrors `netpulse_api::Query`). Each carries a depth where the
 *  engine projects at that disclosure level. */
export type Query =
  | {
      kind: "narrativeFeed";
      from_mono_nanos: number;
      to_mono_nanos: number;
      depth: ProjectionDepth;
    }
  | { kind: "journeyOfSession"; session_id: number; depth: ProjectionDepth }
  | { kind: "monitorSnapshot"; from_mono_nanos: number; to_mono_nanos: number }
  | { kind: "attributionOfFlow"; flow_id: number }
  | { kind: "packetsOfFlow"; flow_id: number }
  // Phase 3 education queries.
  | { kind: "lessonOffers"; session_id: number; depth: ProjectionDepth }
  | { kind: "getCurriculum" }
  | { kind: "getLessonDetail"; lesson_id: string }
  | { kind: "getLearningProgress" }
  | { kind: "validateExerciseChoice"; lesson_id: string; exercise_id: string; choice_index: number }
  | { kind: "journeyStagesOfSession"; session_id: number; depth: ProjectionDepth }
  | { kind: "explorerBrowse" }
  | { kind: "explorerSearch"; term: string }
  | { kind: "handshakeAnimationForFlow"; flow_id: number }
  // Phase 4 intelligence queries.
  | { kind: "securityFindings"; from_mono_nanos: number; to_mono_nanos: number }
  | { kind: "askAssistant"; question: string }
  // Phase 5 lifecycle queries.
  | { kind: "listRecordings" }
  | { kind: "replayState" }
  | { kind: "exportPreview"; selection: ExportSelection; format: ExportFormat }
  | { kind: "listPlugins" }
  | { kind: "interfaces" }
  | { kind: "handshake"; client_version: number }
  | { kind: "getCapabilityRegistry" }
  | { kind: "runPing"; target: string; count: number }
  | { kind: "runTraceroute"; target: string; transport: string; max_hops: number }
  | { kind: "runBufferbloatTest"; target?: string }
  | { kind: "discoverGateway" }
  | { kind: "runDnsProbe"; target: string }
  | { kind: "runHttpProbe"; url: string }
  | { kind: "buildAndDecodePacket"; layers: string[] }
  | { kind: "compareSessions"; session_id_a: number; session_id_b: number }
  | { kind: "listFleetHosts" };

export type FleetHostStatus = "Online" | "Offline" | "Degraded" | "Healthy" | "Unknown";

/** Typed answers to a {@link Query} (mirrors `netpulse_api::QueryResponse`). */
export type QueryResponse =
  | { kind: "narrativeFeed"; cards: NarrativeCard[] }
  | { kind: "journey"; sentences: string[] }
  | { kind: "monitorSnapshot"; snapshot: MonitorSnapshot }
  | { kind: "attribution"; attribution: Attribution }
  | { kind: "payloadsUnavailable" }
  // Phase 3 education answers.
  | { kind: "lessonOffers"; offers: LessonOffer[] }
  | { kind: "curriculum"; modules: CurriculumModule[]; summary: LearningProgress }
  | { kind: "lessonDetail"; lesson: LessonDetail }
  | { kind: "learningProgress"; progress: LearningProgress }
  | { kind: "exerciseValidation"; outcome: ExerciseValidationOutcome }
  | { kind: "pageJourney"; journey: PageJourney }
  | { kind: "explorerEntries"; entries: ExplorerEntry[] }
  | { kind: "animation"; animation: AnimationModel }
  // Phase 4 intelligence answers.
  | { kind: "findings"; findings: SecurityFinding[] }
  | { kind: "assistantAnswer"; answer: AssistantAnswer }
  // Phase 5 lifecycle answers.
  | { kind: "recordings"; recordings: RecordingSummary[] }
  | { kind: "replayState"; state: ReplayState }
  | { kind: "exportPreview"; preview: ExportPreview }
  | { kind: "plugins"; plugins: PluginDescriptor[] }
  | { kind: "interfaces"; interfaces: Interface[] }
  | { kind: "handshake"; handshake: HandshakeResponse }
  | { kind: "capabilityRegistry"; registry: any }
  | { kind: "pingResult"; result: PingResult }
  | { kind: "tracerouteResult"; hops: TracerouteHop[] }
  | { kind: "bufferbloatResult"; result: BufferbloatResult }
  | { kind: "gatewayResult"; result: GatewayResult }
  | { kind: "dnsResult"; result: DnsResult }
  | { kind: "httpResult"; result: HttpResult }
  | { kind: "decodedPacketInspection"; inspection: PacketInspection }
  | { kind: "sessionDiff"; diff: SessionDiff }
  | { kind: "fleetHosts"; hosts: FleetHost[] };

/** The only write paths UI→engine (mirrors `netpulse_api::Command`). Observe-only:
 *  nothing here modifies network traffic. */
export type Command =
  | { kind: "startCapture"; iface_id: number }
  | { kind: "stopCapture"; iface_id: number }
  | { kind: "startRecording" }
  | { kind: "stopRecording" }
  | { kind: "setDepth"; depth: ProjectionDepth }
  | { kind: "startLesson"; lesson_id: string }
  | { kind: "submitExerciseChoice"; lesson_id: string; exercise_id: string; choice_index: number }
  | { kind: "resetLearningProgress" }
  // Phase 5 lifecycle commands. Replay transport,
  // explicit local export, and plugin
  // enable/disable as an explicit user choice.
  | { kind: "replayPlay" }
  | { kind: "replayPause" }
  | { kind: "replayStep" }
  | { kind: "replaySeek"; mono_nanos: number }
  | { kind: "replaySetSpeed"; percent: number }
  | { kind: "startExport"; selection: ExportSelection; format: ExportFormat; level: PayloadLevel }
  | { kind: "enablePlugin"; name: string }
  | { kind: "disablePlugin"; name: string }
  | { kind: "configurePlugin"; name: string; config: any }
  | { kind: "patchPluginConfig"; name: string; expected_version?: number; patch: any }
  | { kind: "resetPluginConfig"; name: string };

