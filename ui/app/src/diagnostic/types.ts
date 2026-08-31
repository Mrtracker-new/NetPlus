/**
 * Core Types and Interfaces for the NetPlus Diagnostic Engine.
 */

export type ObservationSource = "live" | "simulated" | "derived" | "unavailable";

export type ObservationSeverity = "normal" | "elevated" | "severe";

export type MeasurementQuality = "high" | "medium" | "low" | "unverified";

export type DiagnosisCategory =
  | "LOCAL_NETWORK"
  | "GATEWAY"
  | "DNS"
  | "ROUTING"
  | "PACKET_LOSS"
  | "BUFFERBLOAT"
  | "REMOTE_SERVICE_RESPONSE"
  | "BANDWIDTH"
  | "UNKNOWN";

export type DiagnosticStepKind =
  | "gateway"
  | "dns"
  | "ping"
  | "traceroute"
  | "bufferbloat"
  | "http";

export type DiagnosticSessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface Observation {
  key: string;
  source: ObservationSource;
  severity: ObservationSeverity;
  metricName: string;
  value: number | string | boolean | null;
  unit?: string;
  quality: MeasurementQuality;
  rawDetails?: Record<string, unknown>;
  limitation?: string;
  isSimulated?: boolean;
}

export type EvidenceRole = "corroborating" | "contradicting" | "neutral";

export interface Evidence {
  observationKey: string;
  role: EvidenceRole;
  explanation: string;
  weight: number; // 0.0 to 1.0
}

export interface Diagnosis {
  category: DiagnosisCategory;
  confidence: number; // 0.0 to 1.0
  summary: string;
  explanation: string;
  evidence: Evidence[];
  severity: ObservationSeverity;
}

export interface Recommendation {
  title: string;
  description: string;
  actionType: "recheck" | "settings" | "hardware" | "provider" | "info";
  priority: "high" | "medium" | "low";
}

export interface DiagnosticSession {
  sessionId: number;
  target: string;
  status: DiagnosticSessionStatus;
  startedAt: number;
  completedAt?: number;
  observations: Observation[];
  diagnoses: Diagnosis[];
  recommendations: Recommendation[];
  currentStep?: DiagnosticStepKind;
  error?: string;
  isCancelled?: boolean;
}
