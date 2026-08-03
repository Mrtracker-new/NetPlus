import { useState, useEffect, useMemo, useCallback } from "react";
import type { EvidenceRef, ShedStage, MonitorSnapshot } from "@netpulse/contract";
import { humanBytes } from "@netpulse/viz";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { monitoringService } from "../screens/Monitoring/MonitoringService";
import { monitoringEventBus } from "../screens/Monitoring/monitoringEventBus";
import { MonitoringMapper } from "../screens/Monitoring/MonitoringMapper";
import { preferencesManager } from "../screens/Monitoring/MonitoringPreferences";
import { generateIdleTelemetry } from "../screens/Monitoring/monitoringMock";
import type {
  DomainTelemetry,
  ViewTelemetry,
  DashboardTimeRange,
  EngineState,
  ProcessMetricRow,
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

function buildDomainFromSnapshot(
  monitor: MonitorSnapshot,
  throughput: number[]
): DomainTelemetry {
  const totalBytes = monitor.by_protocol.rows.reduce((sum, r) => sum + r.bytes, 0);
  const activeFlows = monitor.by_host.rows.reduce((sum, r) => sum + r.flows, 0);
  const activeHosts = monitor.by_host.rows.length;
  const activeProtocols = monitor.by_protocol.rows.length;

  const targetLen = 12;
  const ingressHistory: number[] = Array(targetLen).fill(0);
  const egressHistory: number[] = Array(targetLen).fill(0);
  const gainsHistory: number[] = Array(targetLen).fill(0);

  if (throughput && throughput.length >= 2) {
    const rates: number[] = [];
    for (let i = 1; i < throughput.length; i++) {
      const curr = throughput[i] ?? 0;
      const prev = throughput[i - 1] ?? 0;
      const delta = Math.max(0, curr - prev);
      rates.push(Math.round(delta / 1024));
    }
    const recent = rates.slice(-targetLen);
    for (let i = 0; i < recent.length; i++) {
      const idx = targetLen - recent.length + i;
      const rate = recent[i] ?? 0;
      ingressHistory[idx] = rate;
      egressHistory[idx] = Math.round(rate * 0.45);
      gainsHistory[idx] = Math.round(rate * 0.25);
    }
  }

  const positions = [
    { x: 90, y: 50 },
    { x: 410, y: 50 },
    { x: 250, y: 115 },
    { x: 90, y: 180 },
    { x: 410, y: 180 },
  ];
  const nodes: TopologyNode[] = monitor.by_host.rows.slice(0, 5).map((row, idx) => {
    const pos = positions[idx % positions.length] || { x: 250, y: 115 };
    return {
      id: `host-${row.label}`,
      label: row.label,
      sublabel: humanBytes(row.bytes),
      status: "healthy",
      x: pos.x,
      y: pos.y,
    };
  });

  const edges: TopologyEdge[] = [];
  if (nodes.length > 1) {
    const centerNode = nodes[2] || nodes[0];
    const centerId = centerNode ? centerNode.id : "";
    for (let i = 0; i < nodes.length; i++) {
      const currentNode = nodes[i];
      if (currentNode && currentNode.id !== centerId) {
        const hostRow = monitor.by_host.rows[i];
        edges.push({
          source: currentNode.id,
          target: centerId,
          bandwidth: humanBytes(hostRow?.bytes ?? 0),
          animated: true,
        });
      }
    }
  }

  const colors = [
    "var(--np-monitor-primary, #00f2fe)",
    "var(--np-accent-2, #7c83f7)",
    "var(--np-monitor-warning, #f59e0b)",
    "var(--np-monitor-success, #10b981)",
    "var(--np-monitor-danger, #ef4444)",
  ];

  const processes: ProcessMetricRow[] = monitor.by_protocol.rows.map((row, idx) => {
    const color = colors[idx % colors.length] || "var(--np-monitor-primary, #00f2fe)";
    const rateKb = Math.round(row.bytes / 1024);

    return {
      id: `proc-${row.label}`,
      name: `${row.label} Telemetry Stream`,
      type: `${row.label} Protocol`,
      bandwidthBytes: row.bytes,
      formattedBandwidth: humanBytes(row.bytes),
      utilizationPercent: Math.min(100, Number(((row.bytes / (totalBytes || 1)) * 100).toFixed(1))),
      cpuPercent: Math.min(100, Number(((row.flows / (activeFlows || 1)) * 15).toFixed(1))),
      memoryMB: Math.min(1024, Math.round(64 + row.flows * 4)),
      packetsPerSec: Math.round(row.flows * 12),
      rttMs: Number((0.5 + idx * 0.3).toFixed(1)),
      errors: 0,
      color,
      history: Array(10).fill(rateKb),
    };
  });

  return {
    timestampNanos: Date.now() * 1000000,
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
    bufferPercent: monitor.capture_stats
      ? Math.round(
          ((monitor.capture_stats.buffer_frames ?? 0) /
            (monitor.capture_stats.buffer_capacity ?? 1000)) *
            100
        )
      : 0,
    bufferFrames: monitor.capture_stats?.buffer_frames ?? 0,
    bufferCapacity: monitor.capture_stats?.buffer_capacity ?? 1000,
    dropCount: monitor.capture_drops,
    networkLossCount: monitor.network_loss_indicators,
    diagnoses: monitor.diagnoses ?? [],
  };
}

export function useMonitoringController() {
  const { monitor, throughput } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();

  // Capture is live only when a non-empty monitor snapshot exists
  const isLive = Boolean(monitor && monitor.by_protocol.rows.length > 0);

  const [domainTelemetry, setDomainTelemetry] = useState<DomainTelemetry>(() =>
    monitor && monitor.by_protocol.rows.length > 0
      ? buildDomainFromSnapshot(monitor, throughput)
      : generateIdleTelemetry()
  );

  const [preferences, setPreferences] = useState(() => preferencesManager.getPreferences());

  // Listen to event bus updates
  useEffect(() => {
    monitoringService.start();

    const unsubTelemetry = monitoringEventBus.on("telemetryUpdated", (data) => {
      setDomainTelemetry(data);
    });

    return () => {
      unsubTelemetry();
      monitoringService.stop();
    };
  }, []);

  // Sync domain telemetry when backend monitor snapshot arrives
  useEffect(() => {
    if (monitor && monitor.by_protocol.rows.length > 0) {
      setDomainTelemetry(buildDomainFromSnapshot(monitor, throughput));
    } else {
      setDomainTelemetry(generateIdleTelemetry());
    }
  }, [monitor, throughput]);

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

  return {
    monitor,
    kpis,
    captureHealth,
    healthAnnouncement,
    diagnoses,
    viewModel,
    preferences,
    actions: {
      setTimeRange,
      setSelectedNodeId,
      openEvidence,
    },
  };
}
