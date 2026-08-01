import { useMemo, useState, useEffect, useCallback } from "react";
import type { ShedStage, EvidenceRef } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { humanBytes, protocolColor } from "@netpulse/viz";

export interface FormattedCaptureHealth {
  bufferFrames: number;
  bufferCapacity: number;
  bufferPercent: number;
  stage: ShedStage;
  drops: number;
  severity: "healthy" | "warning" | "critical";
  stageKey: string;
}

export function useMonitoringController() {
  const { monitor, throughput } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();
  const [healthAnnouncement, setHealthAnnouncement] = useState("");

  // Headline KPIs Derived Selectors
  const kpis = useMemo(() => {
    if (!monitor) return [];
    const totalBytes = monitor.by_protocol.rows.reduce((s, r) => s + r.bytes, 0);
    const totalFlows = monitor.by_host.rows.reduce((s, r) => s + r.flows, 0);

    return [
      { labelKey: "kpi_traffic", value: humanBytes(totalBytes) },
      { labelKey: "kpi_protocols", value: String(monitor.by_protocol.rows.length) },
      { labelKey: "kpi_hosts", value: String(monitor.by_host.rows.length) },
      { labelKey: "kpi_flows", value: String(totalFlows) },
    ];
  }, [monitor]);

  // Stable Protocol Slices for Donut with Stable Protocol Colors
  const protocolSlices = useMemo(() => {
    if (!monitor) return [];
    return monitor.by_protocol.rows.map((r, i) => ({
      label: r.label,
      value: r.bytes,
      color: protocolColor(r.label, i),
    }));
  }, [monitor]);

  // Typed Capture Health Model
  const captureHealth = useMemo<FormattedCaptureHealth | null>(() => {
    if (!monitor) return null;
    const stats = monitor.capture_stats;
    const bufferFrames = stats?.buffer_frames ?? 0;
    const bufferCapacity = stats?.buffer_capacity ?? 1000;
    const bufferPercent =
      bufferCapacity > 0 ? Math.round((bufferFrames / bufferCapacity) * 100) : 0;
    const stage: ShedStage = stats?.shed_stage ?? "none";
    const drops = stats?.dropped ?? monitor.capture_drops;

    let severity: "healthy" | "warning" | "critical" = "healthy";
    if (stage === "drop_packets" || drops > 0 || bufferPercent > 85) {
      severity = "critical";
    } else if (stage !== "none" || bufferPercent > 60) {
      severity = "warning";
    }

    return {
      bufferFrames,
      bufferCapacity,
      bufferPercent,
      stage,
      drops,
      severity,
      stageKey: `shed_stages.${stage}`,
    };
  }, [monitor]);

  // Announce capture health stage transitions for screen readers
  useEffect(() => {
    if (captureHealth) {
      setHealthAnnouncement(`Capture health stage: ${captureHealth.stage}`);
    }
  }, [captureHealth?.stage]);

  const openEvidence = useCallback(
    (ref: EvidenceRef) => {
      navigateToEvidence(ref, "kpi");
    },
    [navigateToEvidence]
  );

  return {
    monitor,
    throughput,
    kpis,
    protocolSlices,
    captureHealth,
    healthAnnouncement,
    diagnoses: monitor?.diagnoses ?? [],
    networkLoss: monitor?.network_loss_indicators ?? 0,
    captureDrops: monitor?.capture_drops ?? 0,
    actions: {
      openEvidence,
    },
  };
}
