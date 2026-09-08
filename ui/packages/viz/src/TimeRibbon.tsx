import { memo, useEffect, useRef, useCallback } from "react";
import type { ReactElement } from "react";
import type { Severity } from "@netpulse/contract";
import { EmptyState } from "@netpulse/components";
import type { RibbonEvent } from "./types";

export interface TimeDomain {
  min: number;
  max: number;
}

/** Calculate proportional horizontal percentage position clamped between 2% and 98% */
export function calcRibbonPos(at: number, min: number, max: number): string {
  const span = max - min;
  if (span <= 0) return "50%";
  const ratio = (at - min) / span;
  const clamped = Math.max(0.02, Math.min(0.98, ratio));
  return `${(clamped * 100).toFixed(2)}%`;
}

export interface TimeRibbonProps {
  events: RibbonEvent[];
  timeDomain?: TimeDomain;
  highlightPacketId?: number;
  highlightTimestamp?: number;
  selectedIndex?: number | null;
  onSelectEvent?: (event: any, index: number) => void;
  axisTicks?: Array<{ positionPercent: number; label: string }>;
}

const RIBBON_LANES: Array<{ severity: Severity; label: string; color: string }> = [
  { severity: "finding", label: "Findings", color: "var(--np-finding, #ef6167)" },
  { severity: "notable", label: "Notable", color: "var(--np-notable, #f2b64d)" },
  { severity: "neutral", label: "Events", color: "var(--np-accent, #2fe0d6)" },
];

/** Events on one shared time axis, laned by severity: anything at the
 *  same moment lines up vertically. Interactive native button marks carry severity
 *  by shape+color and support arrow-key navigation. */
export const TimeRibbon = memo(function TimeRibbon({
  events,
  timeDomain,
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
    return <EmptyState compact description="No timeline events to display." />;
  }

  let min = timeDomain !== undefined ? timeDomain.min : events[0]!.at;
  let max = timeDomain !== undefined ? timeDomain.max : events[0]!.at;

  if (timeDomain === undefined) {
    for (let i = 1; i < events.length; i++) {
      const at = events[i]!.at;
      if (at < min) min = at;
      if (at > max) max = at;
    }
  }

  // Clamped proportional positioning (2% to 98%)
  const pos = (at: number) => calcRibbonPos(at, min, max);

  const isEventHighlighted = (e: RibbonEvent, index: number) => {
    if (selectedIndex !== null && selectedIndex !== undefined) {
      return selectedIndex === index;
    }
    const hasMatchingPacket =
      highlightPacketId !== undefined &&
      ((e as any).packetId === highlightPacketId ||
        e.evidence?.some((ev: any) => ev.kind === "packet" && ev.id === highlightPacketId));
    return (
      hasMatchingPacket ||
      (highlightTimestamp !== undefined && Math.abs(e.at - highlightTimestamp) < 1000)
    );
  };

  const hasSelectedMark = events.some(isEventHighlighted);
  const activeEvent =
    selectedIndex !== null && selectedIndex !== undefined && events[selectedIndex]
      ? events[selectedIndex]
      : events.find(isEventHighlighted);

  const scrubberTimestamp =
    activeEvent !== undefined
      ? activeEvent.at
      : highlightTimestamp !== undefined
      ? highlightTimestamp
      : events.length > 0
      ? events[0]?.at
      : undefined;

  // Group events by severity with their original globalIndex in a single O(N) pass
  const laneEventsMap: Record<Severity, Array<{ event: RibbonEvent; globalIndex: number }>> = {
    finding: [],
    notable: [],
    neutral: [],
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const lane = laneEventsMap[e.severity];
    if (lane) {
      lane.push({ event: e, globalIndex: i });
    }
  }

  return (
    <div className="np-ribbon" role="region" aria-label="Interactive event timeline ribbon">
      {scrubberTimestamp !== undefined && (
        <div className="np-ribbon__guide-track" aria-hidden="true">
          <div
            className="np-ribbon__scrubber"
            aria-hidden="true"
            style={{ left: pos(scrubberTimestamp) }}
          />
        </div>
      )}
      {RIBBON_LANES.map((lane) => {
        const laneEntries = laneEventsMap[lane.severity] || [];
        return (
          <div className="np-ribbon__lane" key={lane.severity}>
            <span className="np-ribbon__lane-label">
              <span
                className="np-ribbon__lane-dot"
                style={{ background: lane.color }}
                aria-hidden="true"
              />
              {lane.label}
            </span>
            <div
              className={`np-ribbon__track ${laneEntries.length === 0 ? "np-ribbon__track--empty" : ""}`}
            >
              {laneEntries.length === 0 && (
                <span className="np-ribbon__empty-guide" aria-hidden="true">
                  — No {lane.label.toLowerCase()} in window —
                </span>
              )}
              {laneEntries.map(({ event: e, globalIndex }) => {
                const isHighlighted = isEventHighlighted(e, globalIndex);

                return (
                  <button
                    type="button"
                    key={`${e.at}-${globalIndex}`}
                    ref={(el) => {
                      markRefs.current[globalIndex] = el;
                      if (isHighlighted) highlightedRef.current = el;
                    }}
                    className={`np-ribbon__mark ${isHighlighted ? "np-ribbon__mark--highlighted" : ""}`}
                    tabIndex={isHighlighted ? 0 : !hasSelectedMark && globalIndex === 0 ? 0 : -1}
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
        <span
          aria-hidden="true"
          style={{
            fontSize: "0.7rem",
            color: "var(--np-text-mute, #8b9bb4)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span>← / →</span>
          <span>scrub</span>
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
                <span className="np-ribbon__axis-tick-mark" aria-hidden="true" />
                {tick.label}
              </span>
            ))
          ) : (
            <>
              <span style={{ position: "absolute", left: "2%", transform: "translateX(-50%)" }}>
                <span className="np-ribbon__axis-tick-mark" aria-hidden="true" />
                earlier
              </span>
              <span style={{ position: "absolute", left: "98%", transform: "translateX(-50%)" }}>
                <span className="np-ribbon__axis-tick-mark" aria-hidden="true" />
                now
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

TimeRibbon.displayName = "TimeRibbon";

