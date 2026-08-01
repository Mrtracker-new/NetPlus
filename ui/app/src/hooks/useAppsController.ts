import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Attribution, AttributionConfidence } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { query } from "../ipc";

export type ConfidenceFilterOption = "all" | "high" | "low" | "unknown";

export interface FlowAttributionRow {
  flowId: number;
  attr: Attribution;
}

export interface GroupedProcess {
  key: string;
  processName: string;
  pid: number | null;
  confidence: AttributionConfidence;
  flowIds: number[];
  flowsCount: number;
  normalizedSearch: string;
}

export interface AppsSummaryMetrics {
  totalApps: number;
  totalFlows: number;
  highConfidenceCount: number;
  unattributedCount: number;
}

// Collect distinct flow IDs from feed cards
function extractFlowIdsFromFeed(feed: ReturnType<typeof useStore>["feed"]): number[] {
  const ids = new Set<number>();
  for (const card of feed) {
    for (const ev of card.evidence) {
      if (ev.kind === "flow") ids.add(ev.id);
    }
  }
  return [...ids];
}

export function useAppsController() {
  const { feed } = useStore();
  const { navigationTarget, clearNavigationTarget, navigateToEvidence } = useEvidenceNavigation();

  const [searchQuery, setSearchQuery] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterOption>("all");
  const [rows, setRows] = useState<FlowAttributionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // In-memory attribution cache keyed by Flow ID
  const attributionCacheRef = useRef<Map<number, Attribution>>(new Map());

  const targetFlowId = navigationTarget?.screen === "apps" ? navigationTarget.flowId : null;

  // IPC Data Fetching & Caching Pipeline
  useEffect(() => {
    let cancelled = false;
    const feedFlowIds = extractFlowIdsFromFeed(feed);
    const flowIdsSet = new Set(feedFlowIds);
    if (targetFlowId !== null) {
      flowIdsSet.add(targetFlowId);
    }
    const flowIds = [...flowIdsSet];

    // Determine which flow IDs need fresh IPC queries vs cached results
    const missingIds = flowIds.filter((id) => !attributionCacheRef.current.has(id));

    if (missingIds.length === 0) {
      // All flow attributions exist in cache
      const cachedRows = flowIds
        .map((id) => {
          const attr = attributionCacheRef.current.get(id);
          return attr ? { flowId: id, attr } : null;
        })
        .filter((r): r is FlowAttributionRow => r !== null);

      setRows(cachedRows);
      setLoaded(true);
      return;
    }

    Promise.all(
      missingIds.map(async (flowId) => {
        try {
          const res = await query({ kind: "attributionOfFlow", flow_id: flowId });
          if (res.kind === "attribution") {
            attributionCacheRef.current.set(flowId, res.attribution);
            return { flowId, attr: res.attribution };
          }
        } catch (e) {
          // Ignore individual flow query errors
        }
        return null;
      })
    )
      .then(() => {
        if (!cancelled) {
          const currentRows = flowIds
            .map((id) => {
              const attr = attributionCacheRef.current.get(id);
              return attr ? { flowId: id, attr } : null;
            })
            .filter((r): r is FlowAttributionRow => r !== null);

          setRows(currentRows);
        }
      })
      .catch((e) => {
        if (!cancelled) setNotice(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [feed, targetFlowId]);

  // Target flow filtering
  const activeRows = useMemo(() => {
    if (targetFlowId !== null) {
      return rows.filter((r) => r.flowId === targetFlowId);
    }
    return rows;
  }, [rows, targetFlowId]);

  // Process Aggregation & Grouping
  const allGroupedProcesses = useMemo(() => {
    const map = new Map<string, GroupedProcess>();

    for (const { flowId, attr } of activeRows) {
      const name = attr.process_name || "unknown owner";
      const pidStr = attr.pid !== null ? String(attr.pid) : "none";
      const groupKey = `${name}:${pidStr}`;

      let group = map.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          processName: name,
          pid: attr.pid,
          confidence: attr.confidence,
          flowIds: [],
          flowsCount: 0,
          normalizedSearch: `${name} ${pidStr} ${attr.confidence}`.toLowerCase(),
        };
        map.set(groupKey, group);
      }

      group.flowIds.push(flowId);
      group.flowsCount += 1;
      group.normalizedSearch += ` ${flowId}`;
    }

    // Multi-tier Sorting: High confidence first -> Most flows -> Alphabetical
    const confidenceRank: Record<AttributionConfidence, number> = {
      high: 0,
      low: 1,
      unknown: 2,
    };

    return [...map.values()].sort((a, b) => {
      const confDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
      if (confDiff !== 0) return confDiff;
      const flowDiff = b.flowsCount - a.flowsCount;
      if (flowDiff !== 0) return flowDiff;
      return a.processName.localeCompare(b.processName);
    });
  }, [activeRows]);

  // Filtered Process Groups (Search + Confidence)
  const filteredGroupedProcesses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allGroupedProcesses.filter((group) => {
      // Confidence level filter
      if (confidenceFilter !== "all" && group.confidence !== confidenceFilter) {
        return false;
      }
      // Normalized multi-field search
      if (q && !group.normalizedSearch.includes(q)) {
        return false;
      }
      return true;
    });
  }, [allGroupedProcesses, searchQuery, confidenceFilter]);

  // Summary Metrics Computation
  const summaryMetrics = useMemo<AppsSummaryMetrics>(() => {
    let highCount = 0;
    let unknownCount = 0;
    let totalFlows = 0;

    for (const group of allGroupedProcesses) {
      totalFlows += group.flowsCount;
      if (group.confidence === "high") highCount++;
      if (group.confidence === "unknown") unknownCount++;
    }

    return {
      totalApps: allGroupedProcesses.length,
      totalFlows,
      highConfidenceCount: highCount,
      unattributedCount: unknownCount,
    };
  }, [allGroupedProcesses]);

  // Expand / Collapse Group Actions
  const toggleExpandGroup = useCallback((groupKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const inspectFlow = useCallback(
    (flowId: number) => {
      navigateToEvidence({ kind: "flow", id: flowId }, "apps");
    },
    [navigateToEvidence]
  );

  const announcement = useMemo(() => {
    if (!loaded) return "Loading application process attributions";
    return `Showing ${filteredGroupedProcesses.length} process groups`;
  }, [loaded, filteredGroupedProcesses.length]);

  return {
    rows: activeRows,
    groupedProcesses: filteredGroupedProcesses,
    summaryMetrics,
    searchQuery,
    setSearchQuery,
    confidenceFilter,
    setConfidenceFilter,
    targetFlowId,
    clearTargetFlow: clearNavigationTarget,
    expandedKeys,
    toggleExpandGroup,
    inspectFlow,
    loaded,
    notice,
    setNotice,
    announcement,
  };
}
