import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Attribution, AttributionConfidence, FlowLineage, ProcessMetric } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

export type ConfidenceFilterOption = "all" | "high" | "low" | "unknown";

export interface FlowAttributionRow {
  flowId: number;
  attr: Attribution;
}

export interface ConfidenceBreakdown {
  high: number;
  low: number;
  unknown: number;
}

export interface GroupedProcess {
  key: string;
  processName: string;
  pid: number | null;
  confidence: AttributionConfidence;
  confidenceBreakdown?: ConfidenceBreakdown;
  flowIds: number[];
  flowsCount: number;
  normalizedSearch: string;
  lineage: FlowLineage[];
}

export interface AppsSummaryMetrics {
  totalApps: number;
  totalFlows: number;
  highConfidenceCount: number;
  lowConfidenceCount: number;
  unattributedCount: number;
}

export function resolveConservativeConfidence(
  a: AttributionConfidence,
  b: AttributionConfidence
): AttributionConfidence {
  if (a === "unknown" || b === "unknown") return "unknown";
  if (a === "low" || b === "low") return "low";
  return "high";
}

export function aggregateConfidences(
  confidences: AttributionConfidence[]
): AttributionConfidence {
  if (confidences.length === 0) return "unknown";
  if (confidences.includes("unknown")) return "unknown";
  if (confidences.includes("low")) return "low";
  return "high";
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

function deriveFlowConfidence(
  fid: number,
  proc: ProcessMetric,
  procConfidence: AttributionConfidence,
  correlatedLineage: FlowLineage[]
): AttributionConfidence {
  const flowConfidences = (proc as any).flowConfidences || (proc as any).flow_confidences;
  if (flowConfidences) {
    const c = typeof flowConfidences.get === "function" ? flowConfidences.get(fid) : flowConfidences[fid];
    if (c === "high" || c === "low" || c === "unknown") {
      return c;
    }
  }

  if (Array.isArray((proc as any).flows)) {
    const match = (proc as any).flows.find(
      (f: any) => f && (f.id === fid || f.flowId === fid || f.flow_id === fid)
    );
    if (match && (match.confidence === "high" || match.confidence === "low" || match.confidence === "unknown")) {
      return match.confidence;
    }
  }

  for (const lin of correlatedLineage as any[]) {
    const hasFlow =
      (lin.flow_id != null && Number(lin.flow_id) === fid) ||
      (lin.flowId != null && Number(lin.flowId) === fid) ||
      (Array.isArray(lin.flow_ids) && lin.flow_ids.some((id: any) => Number(id) === fid)) ||
      (Array.isArray(lin.flowIds) && lin.flowIds.some((id: any) => Number(id) === fid));
    if (hasFlow && (lin.confidence === "high" || lin.confidence === "low" || lin.confidence === "unknown")) {
      return lin.confidence;
    }
  }

  return procConfidence;
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
  const [sortByFlows, setSortByFlows] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleSortByFlows = useCallback(() => {
    setSortByFlows((prev) => !prev);
  }, []);

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
      setSortByFlows(false);
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

    interface GroupAccumulator {
      key: string;
      processName: string;
      pid: number | null;
      unlistedFlows: number;
      flowIds: Set<number>;
      flowConfidences: Map<number, AttributionConfidence>;
      procConfidences: AttributionConfidence[];
      lineage: FlowLineage[];
    }

    const accMap = new Map<string, GroupAccumulator>();

    for (const proc of effectiveProcesses) {
      const name = proc.name || (proc.pid !== null ? `PID ${proc.pid}` : "unknown owner");
      const pid = proc.pid ?? null;
      const pidStr = pid !== null ? String(pid) : "none";
      const groupKey = `${name}:${pidStr}`;
      const confidence = deriveConfidence(proc);
      const rawProcFlowIds: any[] = Array.isArray((proc as any).flowIds)
        ? (proc as any).flowIds
        : Array.isArray((proc as any).flow_ids)
        ? (proc as any).flow_ids
        : [];
      const procFlowIds: number[] = Array.from(
        new Set(
          rawProcFlowIds
            .filter((fid: any) => fid != null && !isNaN(Number(fid)))
            .map(Number)
        )
      );

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
      const unlistedFlows = Math.max(
        0,
        (typeof proc.flows === "number" ? proc.flows : 0) - combinedFlowIds.length
      );

      // Cache flow attributions in memory with conservative resolution (NET-DATA-003)
      for (const fid of combinedFlowIds) {
        const flowConf = deriveFlowConfidence(fid, proc, confidence, correlatedLineage);
        const existing = attributionCacheRef.current.get(fid);
        const resolvedFlowConf = existing
          ? resolveConservativeConfidence(existing.confidence, flowConf)
          : flowConf;

        const resolvedName =
          existing &&
          existing.process_name &&
          !existing.process_name.toLowerCase().includes("unattributed") &&
          existing.process_name.toLowerCase() !== "unknown owner" &&
          (name.toLowerCase().includes("unattributed") || name === "unknown owner")
            ? existing.process_name
            : name;

        const resolvedPid = existing?.pid != null && pid === null ? existing.pid : pid;

        attributionCacheRef.current.set(fid, {
          process_name: resolvedName,
          pid: resolvedPid,
          confidence: resolvedFlowConf,
        });
      }

      let acc = accMap.get(groupKey);
      if (!acc) {
        acc = {
          key: groupKey,
          processName: name,
          pid,
          unlistedFlows,
          flowIds: new Set(combinedFlowIds),
          flowConfidences: new Map(),
          procConfidences: [confidence],
          lineage: mergeLineage([], correlatedLineage),
        };
        for (const fid of combinedFlowIds) {
          const flowConf = deriveFlowConfidence(fid, proc, confidence, correlatedLineage);
          acc.flowConfidences.set(fid, flowConf);
        }
        accMap.set(groupKey, acc);
      } else {
        acc.unlistedFlows += unlistedFlows;
        acc.lineage = mergeLineage(acc.lineage, correlatedLineage);
        acc.procConfidences.push(confidence);
        for (const fid of combinedFlowIds) {
          acc.flowIds.add(fid);
          const flowConf = deriveFlowConfidence(fid, proc, confidence, correlatedLineage);
          const prevConf = acc.flowConfidences.get(fid);
          acc.flowConfidences.set(
            fid,
            prevConf ? resolveConservativeConfidence(prevConf, flowConf) : flowConf
          );
        }
      }
    }

    const map = new Map<string, GroupedProcess>();

    for (const [groupKey, acc] of accMap.entries()) {
      const flowIds = Array.from(acc.flowIds).sort((a, b) => a - b);
      const allConfidences: AttributionConfidence[] = [
        ...acc.flowConfidences.values(),
        ...acc.procConfidences,
      ];
      const resolvedConfidence = aggregateConfidences(allConfidences);

      const breakdown: ConfidenceBreakdown = {
        high: 0,
        low: 0,
        unknown: 0,
      };

      if (flowIds.length > 0) {
        for (const fid of flowIds) {
          const c = acc.flowConfidences.get(fid) ?? resolvedConfidence;
          breakdown[c]++;
        }
      } else {
        for (const c of acc.procConfidences) {
          breakdown[c]++;
        }
      }

      // Build normalized search string deterministically
      const searchTokens: string[] = [
        acc.processName,
        acc.pid !== null ? `pid ${acc.pid}` : "none",
        resolvedConfidence,
      ];
      if (breakdown.high > 0 && resolvedConfidence !== "high") {
        searchTokens.push("high");
      }
      if (breakdown.low > 0 && resolvedConfidence !== "low") {
        searchTokens.push("low");
      }
      if (breakdown.unknown > 0 && resolvedConfidence !== "unknown") {
        searchTokens.push("unknown");
      }
      for (const fid of flowIds) {
        searchTokens.push(String(fid));
      }
      for (const lin of acc.lineage) {
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
          searchTokens.push(linTokens);
        }
      }

      const group: GroupedProcess = {
        key: groupKey,
        processName: acc.processName,
        pid: acc.pid,
        confidence: resolvedConfidence,
        confidenceBreakdown: breakdown,
        flowIds,
        flowsCount: flowIds.length + acc.unlistedFlows,
        lineage: acc.lineage,
        normalizedSearch: searchTokens.join(" ").toLowerCase(),
      };

      map.set(groupKey, group);
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

    // Multi-tier Sorting:
    // When sortByFlows is true: Most flows first -> High confidence -> Alphabetical -> Group Key
    // Default (sortByFlows false): High confidence first -> Most flows -> Alphabetical -> Group Key
    const confidenceRank: Record<AttributionConfidence, number> = {
      high: 0,
      low: 1,
      unknown: 2,
    };

    return [...map.values()].sort((a, b) => {
      if (sortByFlows) {
        const flowDiff = b.flowsCount - a.flowsCount;
        if (flowDiff !== 0) return flowDiff;
        const confDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
        if (confDiff !== 0) return confDiff;
        const nameDiff = a.processName.localeCompare(b.processName);
        if (nameDiff !== 0) return nameDiff;
        return a.key.localeCompare(b.key);
      }
      const confDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
      if (confDiff !== 0) return confDiff;
      const flowDiff = b.flowsCount - a.flowsCount;
      if (flowDiff !== 0) return flowDiff;
      const nameDiff = a.processName.localeCompare(b.processName);
      if (nameDiff !== 0) return nameDiff;
      return a.key.localeCompare(b.key);
    });
  }, [effectiveMonitor, targetFlowId, sortByFlows]);

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
    let lowCount = 0;
    let unknownCount = 0;
    let totalFlows = 0;

    for (const group of activeGroupedProcesses) {
      totalFlows += group.flowsCount;
      if (group.confidence === "high") highCount++;
      if (group.confidence === "low") lowCount++;
      if (group.confidence === "unknown") unknownCount++;
    }

    return {
      totalApps: activeGroupedProcesses.length,
      totalFlows,
      highConfidenceCount: highCount,
      lowConfidenceCount: lowCount,
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
    sortByFlows,
    toggleSortByFlows,
    setSortByFlows,
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
