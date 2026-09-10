import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Attribution, AttributionConfidence, FlowLineage, ProcessMetric } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

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
  lineage: FlowLineage[];
}

export interface AppsSummaryMetrics {
  totalApps: number;
  totalFlows: number;
  highConfidenceCount: number;
  unattributedCount: number;
}

function deriveConfidence(proc: ProcessMetric): AttributionConfidence {
  if ((proc as any).confidence) {
    return (proc as any).confidence;
  }
  const name = (proc.name || "").toLowerCase();
  if (
    proc.pid === null ||
    !proc.name ||
    name.includes("unattributed") ||
    name === "unknown owner"
  ) {
    return "unknown";
  }
  if ((proc.name.startsWith("PID ") || name.startsWith("pid ")) && !proc.exe_path) {
    return "low";
  }
  return "high";
}

function correlateLineageForProcess(
  proc: ProcessMetric,
  rawLineage: FlowLineage[],
  procFlowIds: number[],
  allProcesses: ProcessMetric[]
): FlowLineage[] {
  if (Array.isArray((proc as any).lineage) && (proc as any).lineage.length > 0) {
    return (proc as any).lineage;
  }

  const name = (proc.name || "").toLowerCase();
  const pid = proc.pid ?? null;

  const hasExplicitTags = rawLineage.some(
    (l: any) =>
      l.pid != null ||
      l.process_name != null ||
      l.process != null ||
      l.processName != null ||
      l.name != null ||
      l.flow_id != null ||
      l.flowId != null ||
      l.flow_ids != null ||
      l.flowIds != null
  );

  if (hasExplicitTags) {
    return rawLineage.filter((l: any) => {
      // 1. Strict PID isolation: when both have a PID, they must match.
      // Different PIDs sharing the same executable name (e.g. svchost.exe or chrome.exe) must never bleed conduits.
      if (pid !== null && l.pid != null) {
        return Number(l.pid) === Number(pid);
      }

      // 2. Flow ID correlation
      if (procFlowIds.length > 0) {
        if (l.flow_id != null && procFlowIds.includes(Number(l.flow_id))) return true;
        if (l.flowId != null && procFlowIds.includes(Number(l.flowId))) return true;
        if (Array.isArray(l.flow_ids) && l.flow_ids.some((fid: any) => procFlowIds.includes(Number(fid)))) return true;
        if (Array.isArray(l.flowIds) && l.flowIds.some((fid: any) => procFlowIds.includes(Number(fid)))) return true;
      }

      // 3. Name-based attribution when PID is absent on conduit or process
      if (l.pid == null || pid === null) {
        const lName = (l.process_name || l.process || l.processName || l.name || "").toLowerCase();
        if (lName && (lName === name || name.includes(lName) || lName.includes(name))) {
          return true;
        }
      }

      // 4. Fallback for unattributed/unknown owner bucket
      if (
        (name.includes("unattributed") || name === "unknown owner" || (pid === null && !proc.name)) &&
        l.pid == null &&
        !l.process_name &&
        !l.process &&
        !l.processName &&
        !l.name &&
        l.flow_id == null &&
        l.flowId == null
      ) {
        return true;
      }
      return false;
    });
  }

  if (allProcesses.length === 1) {
    return rawLineage;
  }

  if (pid === null || name.includes("unattributed") || name === "unknown owner") {
    return rawLineage;
  }

  return [];
}

function mergeLineage(existing: FlowLineage[] = [], incoming: FlowLineage[] = []): FlowLineage[] {
  const map = new Map<string, FlowLineage>();
  for (const item of existing || []) {
    const key = `${item.source || ""}:${item.destination || ""}:${item.protocol || ""}:${item.direction || ""}:${item.classification || ""}`;
    map.set(key, { ...item });
  }
  for (const item of incoming || []) {
    const key = `${item.source || ""}:${item.destination || ""}:${item.protocol || ""}:${item.direction || ""}:${item.classification || ""}`;
    const prev = map.get(key);
    if (prev) {
      prev.bytes = (prev.bytes || 0) + (item.bytes || 0);
      prev.packets = (prev.packets || 0) + (item.packets || 0);
      prev.flow_count = (prev.flow_count || 0) + (item.flow_count || 1);
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

export function useAppsController() {
  const { monitor, captureSessionId, snapshotSequence } = useStore();
  const { navigationTarget, clearNavigationTarget, navigateToEvidence } = useEvidenceNavigation();

  const [searchQuery, setSearchQuery] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterOption>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // In-memory attribution cache keyed by Flow ID (NET-DATA-003)
  const attributionCacheRef = useRef<Map<number, Attribution>>(new Map());
  const prevSessionIdRef = useRef<string | null>(captureSessionId);

  // Invalidate in-memory attribution cache and expanded rows on capture session reset (NET-DATA-003)
  useEffect(() => {
    if (prevSessionIdRef.current !== captureSessionId) {
      prevSessionIdRef.current = captureSessionId;
      attributionCacheRef.current.clear();
      setExpandedKeys(new Set());
      setNotice(null);
      if (navigationTarget?.screen === "apps") {
        clearNavigationTarget();
      }
    }
  }, [captureSessionId, navigationTarget?.screen, clearNavigationTarget]);

  const targetFlowId = navigationTarget?.screen === "apps" ? navigationTarget.flowId : null;

  // Loading state clears when authoritative monitor snapshot is first populated for active session
  const effectiveMonitor = snapshotSequence > 0 ? monitor : null;
  const loaded = effectiveMonitor !== null;

  // Derive grouped processes directly from monitor.processes and monitor.lineage
  const allGroupedProcesses = useMemo(() => {
    if (!effectiveMonitor) return [];

    const rawProcesses = effectiveMonitor.processes || [];
    const rawLineage = effectiveMonitor.lineage || [];

    let effectiveProcesses = rawProcesses;
    if (effectiveProcesses.length === 0 && rawLineage.length > 0) {
      const totalLineageFlows = rawLineage.reduce((sum, l) => sum + (l.flow_count || 1), 0);
      effectiveProcesses = [
        {
          pid: null,
          name: "Unattributed Flows",
          flows: totalLineageFlows,
          bytes: rawLineage.reduce((sum, l) => sum + (l.bytes || 0), 0),
          packets: rawLineage.reduce((sum, l) => sum + (l.packets || 0), 0),
        },
      ];
    }

    const map = new Map<string, GroupedProcess>();

    for (const proc of effectiveProcesses) {
      const name = proc.name || (proc.pid !== null ? `PID ${proc.pid}` : "unknown owner");
      const pid = proc.pid ?? null;
      const pidStr = pid !== null ? String(pid) : "none";
      const groupKey = `${name}:${pidStr}`;
      const confidence = deriveConfidence(proc);
      const rawProcFlowIds: number[] = Array.isArray((proc as any).flowIds)
        ? (proc as any).flowIds
        : Array.isArray((proc as any).flow_ids)
        ? (proc as any).flow_ids
        : [];
      const procFlowIds = Array.from(new Set(rawProcFlowIds));

      const correlatedLineage = correlateLineageForProcess(
        proc,
        rawLineage,
        procFlowIds,
        effectiveProcesses
      );

      // Extract any flow IDs referenced inside correlated lineage conduits
      const lineageFlowIds: number[] = [];
      for (const lin of correlatedLineage as any[]) {
        if (lin.flow_id != null && !isNaN(Number(lin.flow_id))) {
          lineageFlowIds.push(Number(lin.flow_id));
        }
        if (lin.flowId != null && !isNaN(Number(lin.flowId))) {
          lineageFlowIds.push(Number(lin.flowId));
        }
        if (Array.isArray(lin.flow_ids)) {
          for (const fid of lin.flow_ids) {
            if (fid != null && !isNaN(Number(fid))) lineageFlowIds.push(Number(fid));
          }
        }
        if (Array.isArray(lin.flowIds)) {
          for (const fid of lin.flowIds) {
            if (fid != null && !isNaN(Number(fid))) lineageFlowIds.push(Number(fid));
          }
        }
      }
      const combinedFlowIds = Array.from(new Set([...procFlowIds, ...lineageFlowIds]));
      const flowsCount = Math.max(
        typeof proc.flows === "number" ? proc.flows : 0,
        combinedFlowIds.length
      );

      // Cache flow attributions in memory (NET-DATA-003)
      for (const fid of combinedFlowIds) {
        attributionCacheRef.current.set(fid, {
          process_name: name,
          pid,
          confidence,
        });
      }

      let group = map.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          processName: name,
          pid,
          confidence,
          flowIds: [...combinedFlowIds],
          flowsCount,
          lineage: mergeLineage([], correlatedLineage),
          normalizedSearch: `${name} ${pid !== null ? `pid ${pid}` : "none"} ${confidence}`.toLowerCase(),
        };
        for (const fid of combinedFlowIds) {
          group.normalizedSearch += ` ${fid}`;
        }
        for (const lin of group.lineage) {
          const linTokens = [
            lin.destination,
            lin.protocol,
            lin.classification,
            lin.classification ? lin.classification.replace(/_/g, " ") : "",
            lin.direction,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (linTokens) {
            group.normalizedSearch += ` ${linTokens}`;
          }
        }
        map.set(groupKey, group);
      } else {
        group.flowsCount = Math.max(group.flowsCount + flowsCount, group.flowIds.length);
        group.lineage = mergeLineage(group.lineage, correlatedLineage);
        for (const fid of combinedFlowIds) {
          if (!group.flowIds.includes(fid)) {
            group.flowIds.push(fid);
            group.normalizedSearch += ` ${fid}`;
          }
        }
        for (const lin of correlatedLineage) {
          const linTokens = [
            lin.destination,
            lin.protocol,
            lin.classification,
            lin.classification ? lin.classification.replace(/_/g, " ") : "",
            lin.direction,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (linTokens && !group.normalizedSearch.includes(linTokens)) {
            group.normalizedSearch += ` ${linTokens}`;
          }
        }
        group.flowsCount = Math.max(group.flowsCount, group.flowIds.length);
      }
    }

    // Ensure target flow ID is indexed in search if navigated to
    if (targetFlowId !== null) {
      for (const group of map.values()) {
        if (group.flowIds.includes(targetFlowId)) {
          if (!group.normalizedSearch.includes(String(targetFlowId))) {
            group.normalizedSearch += ` ${targetFlowId}`;
          }
        }
      }
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
  }, [effectiveMonitor, targetFlowId]);

  // Target flow filtering
  const activeGroupedProcesses = useMemo(() => {
    if (targetFlowId !== null) {
      return allGroupedProcesses.filter((g) => g.flowIds.includes(targetFlowId));
    }
    return allGroupedProcesses;
  }, [allGroupedProcesses, targetFlowId]);

  // Derive rows model for empty-state evaluation and downstream consumers
  const rows = useMemo<FlowAttributionRow[]>(() => {
    const result: FlowAttributionRow[] = [];
    for (const group of activeGroupedProcesses) {
      if (group.flowIds.length > 0) {
        for (const flowId of group.flowIds) {
          const cached = attributionCacheRef.current.get(flowId);
          result.push({
            flowId,
            attr: cached ?? {
              process_name: group.processName,
              pid: group.pid,
              confidence: group.confidence,
            },
          });
        }
      } else {
        result.push({
          flowId: group.pid ?? 0,
          attr: {
            process_name: group.processName,
            pid: group.pid,
            confidence: group.confidence,
          },
        });
      }
    }
    return result;
  }, [activeGroupedProcesses]);

  // Filtered Process Groups (Search + Confidence)
  const filteredGroupedProcesses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    return activeGroupedProcesses.filter((group) => {
      // Confidence level filter
      if (confidenceFilter !== "all" && group.confidence !== confidenceFilter) {
        return false;
      }
      // Normalized multi-field search (matches each space-separated token)
      if (terms.length > 0 && !terms.every((term) => group.normalizedSearch.includes(term))) {
        return false;
      }
      return true;
    });
  }, [activeGroupedProcesses, searchQuery, confidenceFilter]);

  // Summary Metrics Computation
  const summaryMetrics = useMemo<AppsSummaryMetrics>(() => {
    let highCount = 0;
    let unknownCount = 0;
    let totalFlows = 0;

    for (const group of activeGroupedProcesses) {
      totalFlows += group.flowsCount;
      if (group.confidence === "high") highCount++;
      if (group.confidence === "unknown") unknownCount++;
    }

    return {
      totalApps: activeGroupedProcesses.length,
      totalFlows,
      highConfidenceCount: highCount,
      unattributedCount: unknownCount,
    };
  }, [activeGroupedProcesses]);

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
    rows,
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
    captureSessionId,
  };
}
