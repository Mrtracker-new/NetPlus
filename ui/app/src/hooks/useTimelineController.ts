import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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

export interface UseTimelineControllerOptions {
  nowLabel?: string;
  isHistorical?: boolean;
}

export function useTimelineController(options?: UseTimelineControllerOptions) {
  const { feed } = useStore();
  const { navigationTarget, clearNavigationTarget } = useEvidenceNavigation();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const isInitialMount = useRef(true);
  const isClearingFiltersRef = useRef(false);
  const prevFiltersRef = useRef({ searchQuery, severityFilter });

  const highlightPacketId =
    navigationTarget?.screen === "timeline" ? navigationTarget.packetId : undefined;
  const highlightTimestamp =
    navigationTarget?.screen === "timeline" ? navigationTarget.timestamp : undefined;

  // Preserve all original FeedEvent fields, sort chronologically & add lane
  const events = useMemo<TimelineEvent[]>(() => {
    return [...feed]
      .sort((a, b) => a.at_mono_nanos - b.at_mono_nanos)
      .map((card) => ({
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

  // Announce filter result counts via setAnnouncement on search/severity change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFiltersRef.current = { searchQuery, severityFilter };
      return;
    }

    if (isClearingFiltersRef.current) {
      isClearingFiltersRef.current = false;
      prevFiltersRef.current = { searchQuery, severityFilter };
      return;
    }

    const filtersChanged =
      prevFiltersRef.current.searchQuery !== searchQuery ||
      prevFiltersRef.current.severityFilter !== severityFilter;

    prevFiltersRef.current = { searchQuery, severityFilter };

    if (!filtersChanged) {
      return;
    }

    const count = filteredEvents.length;
    const total = events.length;
    const eventWord = count === 1 && total === 1 ? "event" : "events";
    setAnnouncement(`Showing ${count} of ${total} ${eventWord}.`);
  }, [searchQuery, severityFilter, filteredEvents.length, events.length]);

  // Sync evidence navigation highlightPacketId to selectedEventKey
  useEffect(() => {
    if (highlightPacketId !== undefined && filteredEvents.length > 0) {
      const target = filteredEvents.find(
        (e) =>
          (e as any).packetId === highlightPacketId ||
          e.evidence?.some((ev) => ev.kind === "packet" && ev.id === highlightPacketId)
      );
      if (target) {
        setSelectedEventKey(`${target.at}-${target.headline}`);
      }
    }
  }, [highlightPacketId, filteredEvents]);

  // Derive selectedEventIndex by matching key in filteredEvents.
  // If key is not found, default to highest-severity event.
  const selectedEventIndex = useMemo<number | null>(() => {
    if (filteredEvents.length === 0) return null;

    if (selectedEventKey !== null) {
      const matchIndex = filteredEvents.findIndex(
        (e) => `${e.at}-${e.headline}` === selectedEventKey
      );
      if (matchIndex !== -1) {
        return matchIndex;
      }
    }

    if (highlightPacketId !== undefined) {
      const matchIndex = filteredEvents.findIndex(
        (e) =>
          (e as any).packetId === highlightPacketId ||
          e.evidence?.some((ev) => ev.kind === "packet" && ev.id === highlightPacketId)
      );
      if (matchIndex !== -1) {
        return matchIndex;
      }
    }

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
    return bestIndex;
  }, [filteredEvents, selectedEventKey, highlightPacketId]);


  // Unified Time Domain for synchronized mark positions and axis ticks
  const timeDomain = useMemo(() => {
    const activeEvents = filteredEvents.length > 0 ? filteredEvents : events;
    if (activeEvents.length === 0) return { min: 0, max: 0 };
    const times = activeEvents.map((e) => e.at);
    return { min: Math.min(...times), max: Math.max(...times) };
  }, [filteredEvents, events]);

  // Dynamic Time Axis Ticks
  const axisTicks = useMemo(() => {
    if (timeDomain.min === 0 && timeDomain.max === 0) return [];
    const nowLabelOrOptions =
      options?.nowLabel !== undefined
        ? options.nowLabel
        : options?.isHistorical
        ? { isHistorical: true }
        : "now";
    return formatTimelineAxis(timeDomain.min, timeDomain.max, nowLabelOrOptions);
  }, [timeDomain, options?.nowLabel, options?.isHistorical]);

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
      setSelectedEventKey(`${event.at}-${event.headline}`);
      setAnnouncement(`Selected event ${index + 1}: ${event.headline}`);
    },
    []
  );

  const selectNextEvent = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const next = selectedEventIndex === null ? 0 : Math.min(filteredEvents.length - 1, selectedEventIndex + 1);
    const ev = filteredEvents[next];
    if (ev) {
      setSelectedEventKey(`${ev.at}-${ev.headline}`);
      setAnnouncement(`Selected event ${next + 1}: ${ev.headline}`);
    }
  }, [filteredEvents, selectedEventIndex]);

  const selectPrevEvent = useCallback(() => {
    if (filteredEvents.length === 0) return;
    const prev = selectedEventIndex === null ? 0 : Math.max(0, selectedEventIndex - 1);
    const ev = filteredEvents[prev];
    if (ev) {
      setSelectedEventKey(`${ev.at}-${ev.headline}`);
      setAnnouncement(`Selected event ${prev + 1}: ${ev.headline}`);
    }
  }, [filteredEvents, selectedEventIndex]);

  const clearFilters = useCallback(() => {
    const hadActiveFilter = searchQuery !== "" || severityFilter !== "all";
    if (hadActiveFilter) {
      isClearingFiltersRef.current = true;
    }
    setSearchQuery("");
    setSeverityFilter("all");
    setSelectedEventKey(null);
    clearNavigationTarget();
    setAnnouncement("Filters cleared.");
  }, [clearNavigationTarget, searchQuery, severityFilter]);

  return {
    events,
    filteredEvents,
    summaryMetrics,
    timeDomain,
    axisTicks,
    selectedEvent,
    selectedEventIndex,
    selectedEventKey,
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
      setSelectedEventKey,
    },
  };
}
