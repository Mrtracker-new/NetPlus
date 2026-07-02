// GENERATED from the netpulse-api crate — do not hand-edit.
// Regenerate with: cargo test -p netpulse-api -- --ignored write_contract
// A CI drift check fails the build if this file is out of sync (docs/04 §7).

export const API_VERSION = 1 as const;

export type ProjectionDepth = "beginner" | "intermediate" | "expert";

export type Severity = "neutral" | "notable" | "finding";

export type Dimension = "protocol" | "host" | "interface";

export type Cause = "local_wifi" | "distant_server" | "slow_dns" | "congestion";

export type AttributionConfidence = "high" | "low" | "unknown";

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

export interface BreakdownRow {
  label: string;
  bytes: number;
  flows: number;
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

export interface MonitorSnapshot {
  by_protocol: Breakdown;
  by_host: Breakdown;
  diagnoses: Diagnosis[];
  network_loss_indicators: number;
  capture_drops: number;
}

export interface Attribution {
  pid: number | null;
  confidence: AttributionConfidence;
  process_name: string | null;
}
