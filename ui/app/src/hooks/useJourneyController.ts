import { useState, useEffect, useMemo, useCallback } from "react";
import type { PageJourney, SessionSummary } from "@netpulse/contract";
import { query } from "../ipc";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

export interface JourneySessionOption {
  id: number;
  label: string;
  domain: string;
  category: "latest" | "active" | "historical";
  timestamp?: number;
}

export function useJourneyController() {
  const { feed, snapshotSequence } = useStore();
  const { depth } = useDisclosure();
  const { navigationTarget } = useEvidenceNavigation();

  const [storedSessions, setStoredSessions] = useState<SessionSummary[]>([]);
  const [journey, setJourney] = useState<PageJourney | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  // Debounce search query (200ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Authoritatively discover sessions from IPC on mount and on capture updates
  const fetchSessions = useCallback(async () => {
    try {
      const res = await query({ kind: "listSessions" });
      if (res.kind === "sessions") {
        setStoredSessions(res.sessions);
      }
    } catch {
      // Gracefully ignore in offline or test environments
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, snapshotSequence, feed]);

  // Extract sessions list from authoritative stored sessions merged with feed evidence
  const sessions = useMemo<JourneySessionOption[]>(() => {
    const map = new Map<number, JourneySessionOption>();

    // 1. Authoritative sessions from CaptureStore
    for (const s of storedSessions) {
      map.set(s.id, {
        id: s.id,
        label: s.domain,
        domain: s.domain,
        category: "historical",
        timestamp: s.start_mono_nanos,
      });
    }

    // 2. Augment and correlate with live feed cards evidence
    for (const card of feed) {
      for (const ev of card.evidence) {
        if (ev.kind === "session") {
          const existing = map.get(ev.id);
          if (existing) {
            existing.category = "active";
            if (!existing.timestamp && card.at_mono_nanos) {
              existing.timestamp = card.at_mono_nanos;
            }
            if (card.headline) {
              existing.label = card.headline;
            }
          } else {
            map.set(ev.id, {
              id: ev.id,
              label: card.headline,
              domain: card.headline.split(" ")[0] || `Session #${ev.id}`,
              category: "active",
              timestamp: card.at_mono_nanos,
            });
          }
        }
      }
    }

    const list = Array.from(map.values());
    list.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    if (list.length > 0) {
      list[0]!.category = "latest";
    }
    return list;
  }, [storedSessions, feed]);

  const activeSessionId =
    selectedSessionId !== null
      ? selectedSessionId
      : navigationTarget?.screen === "journey"
      ? navigationTarget.sessionId
      : sessions[0]?.id ?? null;

  // Filtered session list based on debounced search
  const filteredSessions = useMemo(() => {
    if (!debouncedSearch.trim()) return sessions;
    const q = debouncedSearch.toLowerCase();
    return sessions.filter(
      (s) =>
        String(s.id).includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.domain.toLowerCase().includes(q)
    );
  }, [sessions, debouncedSearch]);

  // Fetch page journey for active session
  const fetchJourney = useCallback(async () => {
    if (activeSessionId === null) {
      setJourney(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    try {
      const res = await query({
        kind: "journeyStagesOfSession",
        session_id: activeSessionId,
        depth,
      });
      if (res.kind === "pageJourney") {
        setJourney(res.journey);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [activeSessionId, depth]);

  useEffect(() => {
    setSelectedStageIndex(null);
    fetchJourney();
  }, [fetchJourney]);

  const refetch = useCallback(async () => {
    await fetchSessions();
    await fetchJourney();
  }, [fetchSessions, fetchJourney]);

  // Summary Metrics Calculation — Authoritative derivation from real PageJourney data
  const summaryMetrics = useMemo(() => {
    if (!journey) return null;
    const totalFlows = journey.fanout.reduce((s, f) => s + f.flows, 0);
    const totalEvidence = journey.stages.reduce((s, st) => s + st.evidence.length, 0);
    const orgSet = new Set(journey.fanout.map((f) => f.label));

    // Directly bind to authoritative journey metrics (never regex parse)
    const durationMs = journey.duration_ms;
    const ttfbMs = journey.ttfb_ms;

    const durationStr =
      durationMs !== null && durationMs !== undefined
        ? durationMs >= 1000
          ? `${(durationMs / 1000).toFixed(2)} s`
          : `${durationMs.toFixed(0)} ms`
        : "Unavailable";

    const ttfbStr =
      ttfbMs !== null && ttfbMs !== undefined ? `${ttfbMs.toFixed(0)} ms` : "Unavailable";

    return {
      durationStr,
      ttfbStr,
      requests: totalFlows > 0 ? totalFlows : totalEvidence,
      organizations: orgSet.size,
      thirdPartyCount: Math.max(0, orgSet.size > 0 ? orgSet.size - 1 : 0),
      evidenceCount: totalEvidence,
    };
  }, [journey]);

  return {
    journey,
    loaded,
    error,
    activeSessionId,
    selectedSessionId,
    setSelectedSessionId,
    sessions,
    filteredSessions,
    searchQuery,
    setSearchQuery,
    selectedStageIndex,
    setSelectedStageIndex,
    summaryMetrics,
    refetch,
  };
}
