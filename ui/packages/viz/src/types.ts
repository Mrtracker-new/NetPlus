import type { Severity } from "@netpulse/contract";

export interface Slice {
  label: string;
  value: number;
}

export interface RibbonEvent {
  at: number;
  label: string;
  severity: Severity;
}
