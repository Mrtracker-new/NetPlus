import type { NarrativeCard, Severity } from "@netpulse/contract";

export type SeverityFilter = "all" | "finding" | "notable" | "neutral";

export interface TimelineEvent extends NarrativeCard {
  at: number;
  label: string;
  lane: Severity;
}

export interface TimelineAxisTick {
  positionPercent: number;
  label: string;
}

export interface TimelineSummaryMetrics {
  totalEvents: number;
  findingsCount: number;
  notableCount: number;
  neutralCount: number;
  timeSpanStr: string;
}

/** Calculate proportional horizontal percentage position clamped between 2% and 98% */
export function calcRibbonPos(at: number, min: number, max: number): string {
  const span = max - min;
  if (span <= 0) return "50%";
  const ratio = (at - min) / span;
  const clamped = Math.max(0.02, Math.min(0.98, ratio));
  return `${(clamped * 100).toFixed(2)}%`;
}

/** Format time span from nanoseconds into human-readable string */
export function formatTimeSpan(spanNanos: number): string {
  if (spanNanos <= 0) return "0s";
  const totalSeconds = Math.floor(spanNanos / 1e9);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

/** Generate adaptive time axis ticks based on time span */
export function formatTimelineAxis(min: number, max: number): TimelineAxisTick[] {
  const spanNanos = max - min;
  const totalSeconds = spanNanos / 1e9;

  if (totalSeconds <= 0) {
    return [
      { positionPercent: 2, label: "0s" },
      { positionPercent: 98, label: "now" },
    ];
  }

  if (totalSeconds < 60) {
    return [
      { positionPercent: 2, label: `-${Math.round(totalSeconds)}s` },
      { positionPercent: 50, label: `-${Math.round(totalSeconds / 2)}s` },
      { positionPercent: 98, label: "now" },
    ];
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return [
      { positionPercent: 2, label: `-${totalMinutes}m` },
      { positionPercent: 50, label: `-${Math.round(totalMinutes / 2)}m` },
      { positionPercent: 98, label: "now" },
    ];
  }

  const totalHours = Math.round(totalMinutes / 60);
  return [
    { positionPercent: 2, label: `-${totalHours}h` },
    { positionPercent: 50, label: `-${Math.round(totalHours / 2)}h` },
    { positionPercent: 98, label: "now" },
  ];
}

/** Normalize and search timeline event across multiple fields */
export function matchesTimelineSearch(event: NarrativeCard, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase().trim().replace(/\s+/g, " ");

  if (event.headline.toLowerCase().includes(q)) return true;
  if (event.summary.toLowerCase().includes(q)) return true;
  if (event.severity.toLowerCase().includes(q)) return true;

  for (const ev of event.evidence) {
    if (String(ev.id).includes(q)) return true;
    if (ev.kind.toLowerCase().includes(q)) return true;
  }

  return false;
}
