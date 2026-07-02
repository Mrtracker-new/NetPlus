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
  | { kind: "askAssistant"; question: string };

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
  | { kind: "assistantAnswer"; answer: AssistantAnswer };

/** The only write paths UI→engine (mirrors `netpulse_api::Command`). Observe-only:
 *  nothing here modifies network traffic (docs/02 §10). */
export type Command =
  | { kind: "startCapture"; iface_id: number }
  | { kind: "stopCapture"; iface_id: number }
  | { kind: "startRecording" }
  | { kind: "stopRecording" }
  | { kind: "setDepth"; depth: ProjectionDepth };
