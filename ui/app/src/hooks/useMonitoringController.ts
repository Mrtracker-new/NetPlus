import { useState, useMemo, useCallback } from "react";
import type {
  EvidenceRef,
  ShedStage,
  MonitorSnapshot,
  StageProbeResult,
} from "@netpulse/contract";
import { humanBytes } from "@netpulse/viz";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { query } from "../ipc";
import { triggerLiveRefresh } from "../state/useLiveData";
import { MonitoringMapper } from "../screens/Monitoring/MonitoringMapper";
import { preferencesManager } from "../screens/Monitoring/MonitoringPreferences";
import {
  normalizeTopologySublabel,
  type DomainTelemetry,
  type ViewTelemetry,
  type DashboardTimeRange,
  type EngineState,
  type ProcessMetricRow,
  type SubsystemStatus,
} from "../screens/Monitoring/monitoringTypes";
import type { TopologyNode, TopologyEdge } from "@netpulse/viz";

export interface FormattedCaptureHealth {
  bufferFrames: number;
  bufferCapacity: number;
  bufferPercent: number;
  stage: ShedStage;
  drops: number;
  severity: "healthy" | "warning" | "critical";
  stageKey: string;
}

const COLORS = [
  "var(--np-accent, #2fe0d6)",
  "var(--np-accent-2, #7c83f7)",
  "var(--np-sem-investigate, #f59e0b)",
  "var(--np-sem-nominal, #10b981)",
  "var(--np-sem-failure, #ef4444)",
];

const LAYOUT_POSITIONS = [
  { x: 250, y: 115 },
  { x: 90, y: 50 },
  { x: 410, y: 50 },
  { x: 90, y: 180 },
  { x: 410, y: 180 },
  { x: 170, y: 40 },
  { x: 330, y: 40 },
  { x: 170, y: 190 },
  { x: 330, y: 190 },
  { x: 250, y: 200 },
];

const EMPTY_DOMAIN_TELEMETRY: DomainTelemetry = {
  timestampNanos: 0,
  bytesSeen: 0,
  activeFlows: 0,
  activeHosts: 0,
  activeProtocols: 0,
  ingressHistory: Array(12).fill(0),
  egressHistory: Array(12).fill(0),
  gainsHistory: Array(12).fill(0),
  nodes: [],
  edges: [],
  processes: [],
  subsystems: [],
  bufferPercent: 0,
  bufferFrames: 0,
  bufferCapacity: 0,
  dropCount: 0,
  networkLossCount: 0,
  diagnoses: [],
  diagnosticChain: undefined,
};

function buildDomainFromSnapshot(monitor: MonitorSnapshot): DomainTelemetry {
  const totalBytes = monitor.by_protocol.rows.reduce((sum, r) => sum + r.bytes, 0);
  const activeFlows = monitor.by_host.rows.reduce((sum, r) => sum + r.flows, 0);
  const activeHosts = monitor.by_host.rows.length;
  const activeProtocols = monitor.by_protocol.rows.length;

  // 1. Directional Throughput History from Rust Monotonic Bucket Series
  const numBuckets = 12;
  const ingressHistory: number[] = Array(numBuckets).fill(0);
  const egressHistory: number[] = Array(numBuckets).fill(0);
  const gainsHistory: number[] = Array(numBuckets).fill(0);

  if (monitor.throughput_history && monitor.throughput_history.length > 0) {
    for (let i = 0; i < monitor.throughput_history.length && i < numBuckets; i++) {
      const sample = monitor.throughput_history[i];
      if (sample) {
        // Convert authentic bytes/sec to KB/s for chart visualization
        const inKb = Math.round(sample.ingress_rate_bytes_sec / 1024);
        const outKb = Math.round(sample.egress_rate_bytes_sec / 1024);
        ingressHistory[i] = inKb;
        egressHistory[i] = outKb;
        gainsHistory[i] = inKb + outKb;
      }
    }
  }

  // 2. Real OS Process Metrics
  const processes: ProcessMetricRow[] = (monitor.processes || []).map((p, idx) => {
    const color = COLORS[idx % COLORS.length] || "var(--np-accent, #2fe0d6)";
    const rateKb = Math.round(p.bytes / 1024);

    return {
      id: p.pid ? `proc-${p.pid}` : `proc-${p.name}`,
      pid: p.pid ?? null,
      name: p.name,
      exePath: p.exe_path ?? null,
      type: p.pid ? `PID ${p.pid}` : "Unattributed",
      bandwidthBytes: p.bytes,
      formattedBandwidth: humanBytes(p.bytes),
      utilizationPercent: totalBytes > 0 ? Math.min(100, Number(((p.bytes / totalBytes) * 100).toFixed(1))) : 0,
      cpuPercent: p.cpu_percent != null ? p.cpu_percent : null,
      memoryMB: p.memory_bytes != null ? Math.round(p.memory_bytes / (1024 * 1024)) : null,
      packetsPerSec: 0,
      packets: p.packets,
      flows: p.flows,
      rttMs: 0,
      errors: 0,
      color,
      history: [rateKb],
    };
  });

  // 3. Communicating Lineage Topology Graph
  const nodeMap = new Map<string, TopologyNode>();
  const edges: TopologyEdge[] = [];
  let posIdx = 0;

  for (const item of monitor.lineage || []) {
    if (!nodeMap.has(item.source)) {
      const pos = LAYOUT_POSITIONS[posIdx % LAYOUT_POSITIONS.length] || { x: 250, y: 115 };
      posIdx++;
      nodeMap.set(item.source, {
        id: `node-${item.source}`,
        label: item.source,
        sublabel: item.direction === "local" ? "LOCAL" : "SRC",
        status: "healthy",
        x: pos.x,
        y: pos.y,
      });
    }

    if (!nodeMap.has(item.destination)) {
      const pos = LAYOUT_POSITIONS[posIdx % LAYOUT_POSITIONS.length] || { x: 250, y: 115 };
      posIdx++;
      nodeMap.set(item.destination, {
        id: `node-${item.destination}`,
        label: item.destination,
        sublabel: normalizeTopologySublabel(item.classification) || "EXTERNAL_WAN",
        status: "healthy",
        x: pos.x,
        y: pos.y,
      });
    }

    edges.push({
      source: `node-${item.source}`,
      target: `node-${item.destination}`,
      bandwidth: humanBytes(item.bytes),
      animated: true,
    });
  }

  const nodes = Array.from(nodeMap.values());

  // 4. Grounded Subsystem Health
  const subsystems: SubsystemStatus[] = (monitor.subsystems || []).map((s) => ({
    name: s.name,
    status: s.status as "healthy" | "warning" | "degraded" | "critical" | "unknown",
    detail: s.detail,
  }));

  return {
    timestampNanos: 0,
    bytesSeen: totalBytes,
    activeFlows,
    activeHosts,
    activeProtocols,
    ingressHistory,
    egressHistory,
    gainsHistory,
    nodes,
    edges,
    processes,
    subsystems,
    bufferPercent:
      monitor.capture_stats && monitor.capture_stats.buffer_capacity > 0
        ? Math.min(
            100,
            Math.round(
              ((monitor.capture_stats.buffer_frames ?? 0) /
                (monitor.capture_stats.buffer_capacity || 1)) *
                100
            )
          )
        : 0,
    bufferFrames: monitor.capture_stats?.buffer_frames ?? 0,
    bufferCapacity: monitor.capture_stats?.buffer_capacity ?? 0,
    dropCount: monitor.capture_drops,
    networkLossCount: monitor.network_loss_indicators,
    diagnoses: monitor.diagnoses ?? [],
    diagnosticChain: monitor.diagnostic_chain,
  };
}

export function useMonitoringController() {
  const { monitor } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();

  const isLive = Boolean(monitor && monitor.by_protocol.rows.length > 0);

  const [preferences, setPreferences] = useState(() => preferencesManager.getPreferences());
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeResult, setProbeResult] = useState<StageProbeResult | null>(null);

  // Single Authoritative Pipeline: Synchronously derive domain telemetry directly from store snapshot
  const domainTelemetry: DomainTelemetry = useMemo(() => {
    if (monitor) {
      return buildDomainFromSnapshot(monitor);
    }
    return EMPTY_DOMAIN_TELEMETRY;
  }, [monitor]);

  // Derived View Model
  const viewModel: ViewTelemetry = useMemo(() => {
    const engineState: EngineState = isLive ? "Live" : "Standby";
    return MonitoringMapper.toViewModel(domainTelemetry, engineState, null, preferences.timeRange);
  }, [domainTelemetry, preferences.timeRange, isLive]);

  // Dynamic Headline KPIs
  const kpis = useMemo(() => {
    return [
      { labelKey: "kpi_traffic", value: viewModel.formattedTraffic },
      { labelKey: "kpi_protocols", value: String(viewModel.activeProtocolsCount) },
      { labelKey: "kpi_hosts", value: String(viewModel.activeHostsCount) },
      { labelKey: "kpi_flows", value: String(viewModel.activeFlowsCount) },
    ];
  }, [viewModel]);

  // Capture Health Panel View Props
  const captureHealth: FormattedCaptureHealth | null = useMemo(() => {
    if (!monitor?.capture_stats) return null;
    const { buffer_capacity, buffer_frames, shed_stage, dropped } = monitor.capture_stats;
    const pct = buffer_capacity > 0 ? Math.round((buffer_frames / buffer_capacity) * 100) : 0;
    const severity = pct > 80 ? "critical" : pct > 50 ? "warning" : "healthy";

    return {
      bufferFrames: buffer_frames,
      bufferCapacity: buffer_capacity,
      bufferPercent: pct,
      stage: shed_stage,
      drops: dropped,
      severity,
      stageKey: `shed_stages.${shed_stage}`,
    };
  }, [monitor]);

  // ARIA Live Announcement Message
  const healthAnnouncement = useMemo(() => {
    if (!captureHealth) return "Capture health metrics unavailable.";
    return `Capture health stage: ${captureHealth.stage}, buffer usage: ${captureHealth.bufferPercent}%, drops: ${captureHealth.drops}.`;
  }, [captureHealth]);

  // Diagnostic Hypotheses
  const diagnoses = useMemo(() => {
    return monitor?.diagnoses ?? [];
  }, [monitor]);

  // Actions
  const setTimeRange = useCallback((tr: DashboardTimeRange) => {
    preferencesManager.setTimeRange(tr);
    setPreferences(preferencesManager.getPreferences());
    triggerLiveRefresh();
  }, []);

  const setSelectedNodeId = useCallback((nodeId: string | null) => {
    preferencesManager.setSelectedNodeId(nodeId);
    setPreferences(preferencesManager.getPreferences());
  }, []);

  const openEvidence = useCallback(
    (ev: EvidenceRef) => {
      navigateToEvidence(ev);
    },
    [navigateToEvidence]
  );

  const runProbe = useCallback(
    async (stageKind: string, target?: string): Promise<StageProbeResult | null> => {
      setProbeRunning(true);
      try {
        const res = await query({
          kind: "runStageProbe",
          stage: stageKind as any,
          target: target || null,
        });
        if (res.kind === "stageProbeResult") {
          setProbeResult(res.result);
          return res.result;
        }
      } catch (err) {
        const errResult: StageProbeResult = {
          stage: stageKind as any,
          probe_type: "Error",
          target: target ?? null,
          status: "error",
          latency_ms: null,
          summary: `Stage probe failed: ${err}`,
          details: [],
        };
        setProbeResult(errResult);
        return errResult;
      } finally {
        setProbeRunning(false);
      }
      return null;
    },
    []
  );

  return {
    monitor,
    kpis,
    captureHealth,
    healthAnnouncement,
    diagnoses,
    viewModel,
    preferences,
    probeState: {
      running: probeRunning,
      result: probeResult,
    },
    actions: {
      setTimeRange,
      setSelectedNodeId,
      openEvidence,
      runProbe,
    },
  };
}
