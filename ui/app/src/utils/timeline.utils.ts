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

/** Helper to format relative time offset in seconds into human-readable label */
export function formatTimeOffset(seconds: number): string {
  const rounded = Math.round(seconds);
  if (rounded <= 0) return "0s";
  if (rounded < 60) return `-${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (secs === 0) return `-${mins}m`;
  if (mins < 60) return `-${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (remMins === 0) return `-${hrs}h`;
  return `-${hrs}h ${remMins}m`;
}

/** Generate adaptive time axis ticks based on time span with strict label deduplication */
export function formatTimelineAxis(min: number, max: number): TimelineAxisTick[] {
  const spanNanos = max - min;
  const totalSeconds = spanNanos / 1e9;

  if (totalSeconds <= 0) {
    return [
      { positionPercent: 2, label: "0s" },
      { positionPercent: 98, label: "now" },
    ];
  }

  if (totalSeconds <= 2) {
    return [
      { positionPercent: 2, label: `-${totalSeconds.toFixed(totalSeconds < 1 ? 1 : 0)}s` },
      { positionPercent: 98, label: "now" },
    ];
  }

  const startLabel = formatTimeOffset(totalSeconds);
  const midLabel = formatTimeOffset(totalSeconds / 2);

  // Guarantee strict deduplication: if startLabel and midLabel match, fallback to exact seconds
  let finalMidLabel = midLabel;
  if (startLabel === midLabel || midLabel === "now" || midLabel === "0s") {
    const halfSec = Math.round(totalSeconds / 2);
    finalMidLabel = halfSec > 0 ? `-${halfSec}s` : "-0.5s";
  }

  return [
    { positionPercent: 2, label: startLabel },
    { positionPercent: 50, label: finalMidLabel },
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
