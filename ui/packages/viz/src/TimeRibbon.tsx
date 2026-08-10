import { memo, useEffect, useRef, useCallback } from "react";
import type { ReactElement } from "react";
import type { Severity } from "@netpulse/contract";
import { EmptyState } from "@netpulse/components";
import type { RibbonEvent } from "./types";

export interface TimeRibbonProps {
  events: RibbonEvent[];
  highlightPacketId?: number;
  highlightTimestamp?: number;
  selectedIndex?: number | null;
  onSelectEvent?: (event: any, index: number) => void;
  axisTicks?: Array<{ positionPercent: number; label: string }>;
}

const RIBBON_LANES: Array<{ severity: Severity; label: string }> = [
  { severity: "finding", label: "Findings" },
  { severity: "notable", label: "Notable" },
  { severity: "neutral", label: "Events" },
];

/** Events on one shared time axis, laned by severity: anything at the
 *  same moment lines up vertically. Interactive native button marks carry severity
 *  by shape+color and support arrow-key navigation. */
export const TimeRibbon = memo(function TimeRibbon({
  events,
  highlightPacketId,
  highlightTimestamp,
  selectedIndex = null,
  onSelectEvent,
  axisTicks,
}: TimeRibbonProps): ReactElement {
  const highlightedRef = useRef<HTMLButtonElement | null>(null);
  const markRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (highlightedRef.current) {
      if (typeof highlightedRef.current.scrollIntoView === "function") {
        highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [highlightPacketId, highlightTimestamp]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (events.length === 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(events.length - 1, index + 1);
        markRefs.current[next]?.focus();
        onSelectEvent?.(events[next]!, next);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(0, index - 1);
        markRefs.current[prev]?.focus();
        onSelectEvent?.(events[prev]!, prev);
      } else if (e.key === "Home") {
        e.preventDefault();
        markRefs.current[0]?.focus();
        onSelectEvent?.(events[0]!, 0);
      } else if (e.key === "End") {
        e.preventDefault();
        const last = events.length - 1;
        markRefs.current[last]?.focus();
        onSelectEvent?.(events[last]!, last);
      }
    },
    [events, onSelectEvent]
  );

  if (events.length === 0) {
    return <EmptyState>No timeline events to display.</EmptyState>;
  }

  const times = events.map((e) => e.at);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;

  // Clamped proportional positioning (2% to 98%)
  const pos = (at: number) => {
    const ratio = (at - min) / span;
    const clamped = Math.max(0.02, Math.min(0.98, ratio));
    return `${(clamped * 100).toFixed(2)}%`;
  };

  return (
    <div className="np-ribbon" role="region" aria-label="Interactive event timeline ribbon">
      {RIBBON_LANES.map((lane) => {
        const laneEvents = events.filter((e) => e.severity === lane.severity);
        return (
          <div className="np-ribbon__lane" key={lane.severity}>
            <span className="np-ribbon__lane-label">{lane.label}</span>
            <div className="np-ribbon__track" style={{ position: "relative" }}>
              {laneEvents.map((e) => {
                const globalIndex = events.indexOf(e);
                const isHighlighted =
                  selectedIndex === globalIndex ||
                  (highlightPacketId !== undefined && (e as { packetId?: number }).packetId === highlightPacketId) ||
                  (highlightTimestamp !== undefined && Math.abs(e.at - highlightTimestamp) < 1000);

                return (
                  <button
                    type="button"
                    key={`${e.at}-${globalIndex}`}
                    ref={(el) => {
                      markRefs.current[globalIndex] = el;
                      if (isHighlighted) highlightedRef.current = el;
                    }}
                    className={`np-ribbon__mark ${isHighlighted ? "np-ribbon__mark--highlighted" : ""}`}
                    aria-pressed={isHighlighted}
                    aria-label={`Event ${globalIndex + 1}: ${e.label} (${e.severity})`}
                    data-sev={e.severity}
                    data-highlighted={isHighlighted ? "true" : undefined}
                    onClick={() => onSelectEvent?.(e, globalIndex)}
                    onKeyDown={(evt) => handleKeyDown(evt, globalIndex)}
                    style={{
                      left: pos(e.at),
                    }}
                    title={e.label}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="np-ribbon__axis">
        <span aria-hidden="true" style={{ fontSize: "0.7rem", color: "var(--np-muted, #8b9bb4)", opacity: 0.85, display: "flex", alignItems: "center" }}>
          ← / → scrub
        </span>
        <div className="np-ribbon__axis-track">
          {axisTicks && axisTicks.length > 0 ? (
            axisTicks.map((tick, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${tick.positionPercent}%`,
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                }}
              >
                {tick.label}
              </span>
            ))
          ) : (
            <>
              <span style={{ position: "absolute", left: "2%", transform: "translateX(-50%)" }}>earlier</span>
              <span style={{ position: "absolute", left: "98%", transform: "translateX(-50%)" }}>now</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

TimeRibbon.displayName = "TimeRibbon";
