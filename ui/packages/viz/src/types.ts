import type { Severity, EvidenceRef } from "@netpulse/contract";

export interface Slice {
  label: string;
  value: number;
}

export interface RibbonEvent {
  at: number;
  label: string;
  severity: Severity;
  packetId?: number;
  summary?: string;
  evidence?: EvidenceRef[];
  lines?: string[];
  [key: string]: any;
}
