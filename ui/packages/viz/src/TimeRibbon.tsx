import { memo, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { Severity } from "@netpulse/contract";
import { EmptyState } from "@netpulse/components";
import type { RibbonEvent } from "./types";

export interface TimeRibbonProps {
  events: RibbonEvent[];
  highlightPacketId?: number;
  highlightTimestamp?: number;
}

const RIBBON_LANES: Array<{ severity: Severity; label: string }> = [
  { severity: "finding", label: "Findings" },
  { severity: "notable", label: "Notable" },
  { severity: "neutral", label: "Events" },
];

/** Events on one shared time axis, laned by severity (docs/10 §4): anything at the
 *  same moment lines up vertically. Marks carry severity by shape+color and name
 *  themselves on hover — the drill-down entry point from the time axis (docs/10 §6). */
export const TimeRibbon = memo(function TimeRibbon({
  events,
  highlightPacketId,
  highlightTimestamp,
}: TimeRibbonProps): ReactElement {
  const highlightedRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [highlightPacketId, highlightTimestamp]);

  if (events.length === 0) {
    return <EmptyState>No events yet — the timeline fills as traffic is reconstructed.</EmptyState>;
  }

  const times = events.map((e) => e.at);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  const pos = (at: number) => `${(((at - min) / span) * 98).toFixed(2)}%`;

  return (
    <div className="np-ribbon">
      {RIBBON_LANES.map((lane) => {
        const laneEvents = events.filter((e) => e.severity === lane.severity);
        return (
          <div className="np-ribbon__lane" key={lane.severity}>
            <span className="np-ribbon__lane-label">{lane.label}</span>
            <div className="np-ribbon__track">
              {laneEvents.map((e, i) => {
                const isHighlighted =
                  (highlightPacketId !== undefined && (e as { packetId?: number }).packetId === highlightPacketId) ||
                  (highlightTimestamp !== undefined && Math.abs(e.at - highlightTimestamp) < 1000);

                return (
                  <span
                    key={`${e.at}-${i}`}
                    ref={isHighlighted ? highlightedRef : undefined}
                    className={`np-ribbon__mark ${isHighlighted ? "np-ribbon__mark--highlighted" : ""}`}
                    data-sev={e.severity}
                    data-highlighted={isHighlighted ? "true" : undefined}
                    style={{ left: pos(e.at) }}
                    title={e.label}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="np-ribbon__axis">
        <span>earlier</span>
        <span>now</span>
      </div>
    </div>
  );
});

TimeRibbon.displayName = "TimeRibbon";
