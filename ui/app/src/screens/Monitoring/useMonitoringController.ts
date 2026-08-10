import { useState, useEffect, useMemo, useCallback } from "react";
import type { EvidenceRef } from "@netpulse/contract";
import { useStore } from "../../state/store";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";
import { monitoringService } from "./MonitoringService";
import { monitoringEventBus } from "./monitoringEventBus";
import { MonitoringMapper } from "./MonitoringMapper";
import { preferencesManager } from "./MonitoringPreferences";
import { generateSimulationTelemetry } from "./monitoringMock";
import type { DomainTelemetry, ViewTelemetry, DashboardTimeRange } from "./monitoringTypes";

export function useMonitoringController() {
  const { monitor, throughput } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();

  const [domainTelemetry, setDomainTelemetry] = useState<DomainTelemetry>(() =>
    generateSimulationTelemetry()
  );

  const [preferences, setPreferences] = useState(() => preferencesManager.getPreferences());

  // Start service & listen to event bus
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

  // Update domain telemetry if backend monitor snapshot is present in store
  useEffect(() => {
    if (monitor) {
      const totalBytes = monitor.by_protocol.rows.reduce((s, r) => s + r.bytes, 0);
      const activeFlows = monitor.by_host.rows.reduce((s, r) => s + r.flows, 0);

      const backendDomain: DomainTelemetry = {
        timestampNanos: Date.now() * 1000000,
        bytesSeen: totalBytes,
        activeFlows,
        activeHosts: monitor.by_host.rows.length,
        activeProtocols: monitor.by_protocol.rows.length,
        ingressHistory: throughput.length >= 2 ? throughput : domainTelemetry.ingressHistory,
        egressHistory: domainTelemetry.egressHistory,
        gainsHistory: domainTelemetry.gainsHistory,
        nodes: domainTelemetry.nodes,
        edges: domainTelemetry.edges,
        processes: domainTelemetry.processes,
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

      monitoringService.setBackendTelemetry(backendDomain);
    }
  }, [monitor, throughput]);

  // Compute ViewModel via pure mapper with reactive timeRange preference
  const viewModel: ViewTelemetry = useMemo(() => {
    return MonitoringMapper.toViewModel(
      domainTelemetry,
      monitoringService.getEngineState(),
      monitoringService.getEngineError(),
      preferences.timeRange
    );
  }, [domainTelemetry, preferences.timeRange]);

  // Preference handlers
  const setTimeRange = useCallback((tr: DashboardTimeRange) => {
    preferencesManager.setTimeRange(tr);
    setPreferences(preferencesManager.getPreferences());
  }, []);

  const setSelectedNodeId = useCallback((id: string | null) => {
    preferencesManager.setSelectedNodeId(id);
    setPreferences(preferencesManager.getPreferences());
  }, []);

  const openEvidence = useCallback(
    (ref: EvidenceRef) => {
      navigateToEvidence(ref, "kpi");
    },
    [navigateToEvidence]
  );

  return {
    monitor,
    throughput,
    viewModel,
    preferences,
    healthAnnouncement: `Monitoring engine state: ${viewModel.engineState}`,
    diagnoses: monitor?.diagnoses ?? domainTelemetry.diagnoses,
    networkLoss: monitor?.network_loss_indicators ?? domainTelemetry.networkLossCount,
    captureDrops: monitor?.capture_drops ?? domainTelemetry.dropCount,
    actions: {
      openEvidence,
      setTimeRange,
      setSelectedNodeId,
    },
  };
}
