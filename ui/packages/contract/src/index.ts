// Barrel for the generated contract types.
//
// `generated.ts` is emitted from the `netpulse-api` Rust crate and must not be
// hand-edited (see its header). This file adds the hand-written *message*
// wrappers — the Query/Command/StreamChannel envelopes — that reference those
// generated shapes, so the whole IPC contract is importable from one place:
//
//   import type { NarrativeCard, Query } from "@netpulse/contract";

export * from "./generated";

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
} from "./generated";

/** Live channels the UI subscribes to (mirrors `netpulse_api::StreamChannel`). */
export type StreamChannel = "flows" | "metrics" | "findings" | "narratives";

/** Pull requests (mirrors `netpulse_api::Query`). Each carries a depth where the
 *  engine projects at that disclosure level (docs/09 §6.3). */
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
  // Phase 3 education queries (docs/13–16).
  | { kind: "lessonOffers"; session_id: number; depth: ProjectionDepth }
  | { kind: "journeyStagesOfSession"; session_id: number; depth: ProjectionDepth }
  | { kind: "explorerBrowse" }
  | { kind: "explorerSearch"; term: string }
  | { kind: "handshakeAnimationForFlow"; flow_id: number }
  // Phase 4 intelligence queries (docs/17–20).
  | { kind: "securityFindings"; from_mono_nanos: number; to_mono_nanos: number }
  | { kind: "askAssistant"; question: string }
  // Phase 5 lifecycle queries (docs/21–24).
  | { kind: "listRecordings" }
  | { kind: "replayState" }
  | { kind: "exportPreview"; selection: ExportSelection; format: ExportFormat }
  | { kind: "listPlugins" }
  | { kind: "interfaces" }
  | { kind: "handshake"; client_version: number }
  | { kind: "getCapabilityRegistry" }
  | { kind: "runPing"; target: string; count: number }
  | { kind: "runTraceroute"; target: string; transport: string; max_hops: number; maxHops?: number }
  | { kind: "runBufferbloatTest"; target?: string }
  | { kind: "buildAndDecodePacket"; layers: string[] }
  | { kind: "compareSessions"; session_id_a: number; session_id_b: number; sessionIdA?: number; sessionIdB?: number }
  | { kind: "listFleetHosts" };

export interface PingResult {
  target: string;
  sent: number;
  received: number;
  loss_pct?: number;
  lossPct?: number;
  min_rtt_ms?: number;
  minRttMs?: number;
  avg_rtt_ms?: number;
  avgRttMs?: number;
  max_rtt_ms?: number;
  maxRttMs?: number;
  stddev_rtt_ms?: number;
  stddevRttMs?: number;
}

export interface TracerouteHop {
  ttl: number;
  ip: string;
  hostname?: string | null;
  rtt_ms?: number;
  rttMs?: number;
  status?: string;
}

export interface BufferbloatResult {
  target: string;
  idle_rtt_ms?: number;
  idleRttMs?: number;
  loaded_rtt_ms?: number;
  loadedRttMs?: number;
  delta_rtt_ms?: number;
  deltaRttMs?: number;
  grade: string;
}

export type FleetHostStatus = "Online" | "Offline" | "Degraded" | "Healthy" | "Unknown";

export interface FleetHost {
  hostId: string;
  hostname: string;
  friendlyName?: string | null;
  os: string;
  platform: string;
  agentVersion: string;
  status: FleetHostStatus;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

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
  session_id_a?: number;
  sessionIdA: number;
  session_id_b?: number;
  sessionIdB: number;
  rtt_delta_ms?: number;
  rttDeltaMs: number;
  ttfb_delta_ms?: number;
  ttfbDeltaMs: number;
  protocolShift: string;
  protocol_shift?: string;
  semanticExplanation: string;
  semantic_explanation?: string;
  confidence: string;
  evidence: string[];
}

/** Typed answers to a {@link Query} (mirrors `netpulse_api::QueryResponse`). */
export type QueryResponse =
  | { kind: "narrativeFeed"; cards: NarrativeCard[] }
  | { kind: "journey"; sentences: string[] }
  | { kind: "monitorSnapshot"; snapshot: MonitorSnapshot }
  | { kind: "attribution"; attribution: Attribution }
  | { kind: "payloadsUnavailable" }
  // Phase 3 education answers (docs/13–16).
  | { kind: "lessonOffers"; offers: LessonOffer[] }
  | { kind: "pageJourney"; journey: PageJourney }
  | { kind: "explorerEntries"; entries: ExplorerEntry[] }
  | { kind: "animation"; animation: AnimationModel }
  // Phase 4 intelligence answers (docs/17–20).
  | { kind: "findings"; findings: SecurityFinding[] }
  | { kind: "assistantAnswer"; answer: AssistantAnswer }
  // Phase 5 lifecycle answers (docs/21–24).
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
  | { kind: "decodedPacketInspection"; inspection: PacketInspection }
  | { kind: "sessionDiff"; diff: SessionDiff }
  | { kind: "fleetHosts"; hosts: FleetHost[] };

/** The only write paths UI→engine (mirrors `netpulse_api::Command`). Observe-only:
 *  nothing here modifies network traffic (docs/02 §10). */
export type Command =
  | { kind: "startCapture"; iface_id: number }
  | { kind: "stopCapture"; iface_id: number }
  | { kind: "startRecording" }
  | { kind: "stopRecording" }
  | { kind: "setDepth"; depth: ProjectionDepth }
  // Phase 5 lifecycle commands (docs/21–24). Replay transport (docs/21 §5),
  // explicit local export (docs/23 §6, never auto-transmitted), and plugin
  // enable/disable as an explicit user choice (docs/24 §5).
  | { kind: "replayPlay" }
  | { kind: "replayPause" }
  | { kind: "replayStep" }
  | { kind: "replaySeek"; mono_nanos: number }
  | { kind: "replaySetSpeed"; percent: number }
  | { kind: "startExport"; selection: ExportSelection; format: ExportFormat; level: PayloadLevel }
  | { kind: "enablePlugin"; name: string }
  | { kind: "disablePlugin"; name: string };
