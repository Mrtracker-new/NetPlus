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

export { calcRibbonPos, calcCollisionOffset } from "@netpulse/viz";

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

export interface FormatTimelineAxisOptions {
  nowLabel?: string;
  endLabel?: string;
  isHistorical?: boolean;
}

/** Generate adaptive time axis ticks based on time span with strict label deduplication and parameterized now/end label */
export function formatTimelineAxis(
  min: number,
  max: number,
  nowLabelOrOptions: string | FormatTimelineAxisOptions = "now"
): TimelineAxisTick[] {
  const spanNanos = max - min;
  const totalSeconds = spanNanos / 1e9;

  let endLabel = "now";
  if (typeof nowLabelOrOptions === "string") {
    endLabel = nowLabelOrOptions;
  } else if (nowLabelOrOptions) {
    if (nowLabelOrOptions.nowLabel !== undefined) {
      endLabel = nowLabelOrOptions.nowLabel;
    } else if (nowLabelOrOptions.endLabel !== undefined) {
      endLabel = nowLabelOrOptions.endLabel;
    } else if (nowLabelOrOptions.isHistorical) {
      if (totalSeconds <= 0) {
        endLabel = "0s";
      } else if (totalSeconds < 1) {
        endLabel = `+${totalSeconds.toFixed(1)}s`;
      } else {
        endLabel = `+${formatTimeSpan(spanNanos)}`;
      }
    }
  }

  if (totalSeconds <= 0) {
    const leftLabel = endLabel === "0s" ? "-0s" : "0s";
    return [
      { positionPercent: 2, label: leftLabel },
      { positionPercent: 98, label: endLabel },
    ];
  }

  if (totalSeconds <= 2) {
    const startSec = totalSeconds.toFixed(totalSeconds < 1 ? 1 : 0);
    let startLabel = `-${startSec}s`;
    if (startLabel === endLabel) {
      startLabel = `-${(totalSeconds || 1).toFixed(1)}s`;
    }
    return [
      { positionPercent: 2, label: startLabel },
      { positionPercent: 98, label: endLabel },
    ];
  }

  const startLabel = formatTimeOffset(totalSeconds);
  const midLabel = formatTimeOffset(totalSeconds / 2);

  // Guarantee strict deduplication: if startLabel and midLabel match, fallback to exact seconds
  let finalMidLabel = midLabel;
  if (startLabel === midLabel || midLabel === endLabel || midLabel === "0s" || midLabel === "now") {
    const halfSec = Math.round(totalSeconds / 2);
    finalMidLabel = halfSec > 0 ? `-${halfSec}s` : "-0.5s";
    if (finalMidLabel === endLabel || finalMidLabel === startLabel) {
      finalMidLabel = `-${(totalSeconds / 2).toFixed(1)}s`;
    }
  }

  let finalStartLabel = startLabel;
  if (finalStartLabel === finalMidLabel || finalStartLabel === endLabel) {
    finalStartLabel = `-${totalSeconds.toFixed(1)}s`;
  }

  return [
    { positionPercent: 2, label: finalStartLabel },
    { positionPercent: 50, label: finalMidLabel },
    { positionPercent: 98, label: endLabel },
  ];
}

/** Normalize and search timeline event across multiple fields (headline, summary, severity, evidence, lines) */
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

  if (event.lines && event.lines.some((l) => l.toLowerCase().includes(q))) {
    return true;
  }

  return false;
}

