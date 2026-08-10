import { useState, useMemo, useCallback, useEffect } from "react";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import {
  type TimelineEvent,
  type SeverityFilter,
  type TimelineSummaryMetrics,
  formatTimeSpan,
  formatTimelineAxis,
  matchesTimelineSearch,
} from "../utils/timeline.utils";

export function useTimelineController() {
  const { feed } = useStore();
  const { navigationTarget, clearNavigationTarget } = useEvidenceNavigation();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const highlightPacketId =
    navigationTarget?.screen === "timeline" ? navigationTarget.packetId : undefined;
  const highlightTimestamp =
    navigationTarget?.screen === "timeline" ? navigationTarget.timestamp : undefined;

  // Preserve all original FeedEvent fields & add lane
  const events = useMemo<TimelineEvent[]>(() => {
    return feed.map((card) => ({
      ...card,
      at: card.at_mono_nanos,
      label: card.headline,
      lane: card.severity,
    }));
  }, [feed]);

  // Filtered Events with normalized search & severity filter
  const filteredEvents = useMemo<TimelineEvent[]>(() => {
    return events.filter((e) => {
      const matchesSeverity = severityFilter === "all" || e.severity === severityFilter;
      const matchesSearch = matchesTimelineSearch(e, searchQuery);
      return matchesSeverity && matchesSearch;
    });
  }, [events, severityFilter, searchQuery]);

  // Deterministic initial auto-selection:
  // Runs only when selectedEventIndex === null and filteredEvents become available.
  // Selects highest-severity event (finding > notable > neutral), breaking ties by earliest timestamp.
  useEffect(() => {
    if (selectedEventIndex === null && filteredEvents.length > 0) {
      let bestIndex = 0;
      let bestSeverityWeight = -1;

      for (let i = 0; i < filteredEvents.length; i++) {
        const ev = filteredEvents[i]!;
        const weight = ev.severity === "finding" ? 3 : ev.severity === "notable" ? 2 : 1;
        if (weight > bestSeverityWeight) {
          bestSeverityWeight = weight;
          bestIndex = i;
        }
      }
      setSelectedEventIndex(bestIndex);
    } else if (selectedEventIndex !== null && selectedEventIndex >= filteredEvents.length) {
      setSelectedEventIndex(filteredEvents.length > 0 ? filteredEvents.length - 1 : null);
    }
  }, [filteredEvents, selectedEventIndex]);

  // Dynamic Time Axis Ticks
  const axisTicks = useMemo(() => {
    if (events.length === 0) return [];
    const times = events.map((e) => e.at);
    return formatTimelineAxis(Math.min(...times), Math.max(...times));
  }, [events]);

  // Summary Metrics Computation
  const summaryMetrics = useMemo<TimelineSummaryMetrics | null>(() => {
    if (events.length === 0) return null;
    const times = events.map((e) => e.at);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    let findingsCount = 0;
    let notableCount = 0;
    let neutralCount = 0;

    for (const e of events) {
      if (e.severity === "finding") findingsCount++;
      else if (e.severity === "notable") notableCount++;
      else neutralCount++;
    }

    return {
      totalEvents: events.length,
      findingsCount,
      notableCount,
      neutralCount,
      timeSpanStr: formatTimeSpan(maxTime - minTime),
    };
  }, [events]);

  const selectedEvent =
    selectedEventIndex !== null && filteredEvents[selectedEventIndex]
      ? filteredEvents[selectedEventIndex]
      : null;

  const selectEvent = useCallback(
    (event: TimelineEvent, index: number) => {
      setSelectedEventIndex(index);
      setAnnouncement(`Selected event ${index + 1}: ${event.headline}`);
    },
    []
  );

  const selectNextEvent = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const next = selectedEventIndex === null ? 0 : Math.min(filteredEvents.length - 1, selectedEventIndex + 1);
    setSelectedEventIndex(next);
    const ev = filteredEvents[next];
    if (ev) setAnnouncement(`Selected event ${next + 1}: ${ev.headline}`);
  }, [filteredEvents, selectedEventIndex]);

  const selectPrevEvent = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const prev = selectedEventIndex === null ? 0 : Math.max(0, selectedEventIndex - 1);
    setSelectedEventIndex(prev);
    const ev = filteredEvents[prev];
    if (ev) setAnnouncement(`Selected event ${prev + 1}: ${ev.headline}`);
  }, [filteredEvents, selectedEventIndex]);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setSeverityFilter("all");
    setSelectedEventIndex(null);
    clearNavigationTarget();
    setAnnouncement("Filters cleared.");
  }, [clearNavigationTarget]);

  return {
    events,
    filteredEvents,
    summaryMetrics,
    axisTicks,
    selectedEvent,
    selectedEventIndex,
    searchQuery,
    severityFilter,
    highlightPacketId,
    highlightTimestamp,
    announcement,
    actions: {
      setSearchQuery,
      setSeverityFilter,
      selectEvent,
      selectNextEvent,
      selectPrevEvent,
      clearFilters,
    },
  };
}
