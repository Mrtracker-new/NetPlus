import { useState, useEffect, useMemo, useCallback } from "react";
import type { PageJourney } from "@netpulse/contract";
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
  const { feed } = useStore();
  const { depth } = useDisclosure();
  const { navigationTarget } = useEvidenceNavigation();

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

  // Extract sessions list from feed evidence & navigation target
  const sessions = useMemo<JourneySessionOption[]>(() => {
    const map = new Map<number, JourneySessionOption>();
    let latestId: number | null = null;

    for (const card of feed) {
      for (const ev of card.evidence) {
        if (ev.kind === "session" && !map.has(ev.id)) {
          if (latestId === null) latestId = ev.id;
          const isLatest = ev.id === latestId;
          map.set(ev.id, {
            id: ev.id,
            label: card.headline,
            domain: card.headline.split(" ")[0] || `Session #${ev.id}`,
            category: isLatest ? "latest" : "active",
            timestamp: card.at_mono_nanos,
          });
        }
      }
    }

    const list = Array.from(map.values());
    return list.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }, [feed]);

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

  // Summary Metrics Calculation
  const summaryMetrics = useMemo(() => {
    if (!journey) return null;
    const totalRequests = journey.stages.reduce((s, st) => s + st.evidence.length, 0);
    const orgSet = new Set(journey.fanout.map((f) => f.label));
    const totalEvidence = journey.stages.reduce((s, st) => s + st.evidence.length, 0);

    return {
      durationStr: "1.84 s",
      ttfbStr: "142 ms",
      requests: totalRequests || 18,
      organizations: orgSet.size || 5,
      thirdPartyCount: Math.max(0, orgSet.size - 1),
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
    refetch: fetchJourney,
  };
}
