import type {
  DomainTelemetry,
  ActiveAlert,
  SubsystemStatus,
  IntelligentRecommendation,
} from "./monitoringTypes";

export interface DiagnosticsEvaluation {
  alerts: ActiveAlert[];
  subsystems: SubsystemStatus[];
  recommendations: IntelligentRecommendation[];
}

/**
 * Worker-ready pure evaluation function deriving diagnostic insights from raw telemetry.
 */
export function evaluateDiagnosticsRules(
  telemetry: DomainTelemetry
): DiagnosticsEvaluation {
  const alerts: ActiveAlert[] = [];
  const subsystems: SubsystemStatus[] = [];
  const recommendations: IntelligentRecommendation[] = [];
  const now = new Date().toLocaleTimeString();

  // 1. Buffer Saturation & Shed Stage Rules
  if (telemetry.bufferPercent > 85) {
    alerts.push({
      id: "alert-buf-crit",
      severity: "critical",
      title: "Critical Buffer Saturation",
      message: `Ring buffer is at ${telemetry.bufferPercent}% capacity. Dropped frames: ${telemetry.dropCount}`,
      timestamp: now,
    });
    recommendations.push({
      id: "rec-buf-expand",
      title: "Expand Buffer Allocation",
      action: "Increase ring buffer capacity or enable hardware packet drop filters.",
      category: "buffer",
    });
  } else if (telemetry.bufferPercent > 60) {
    alerts.push({
      id: "alert-buf-warn",
      severity: "warning",
      title: "Elevated Ring Buffer Usage",
      message: `Ring buffer saturation at ${telemetry.bufferPercent}%.`,
      timestamp: now,
    });
  }

  // 2. Subsystem Health Checks (Authoritative from Rust Backend)
  if (telemetry.subsystems && telemetry.subsystems.length > 0) {
    subsystems.push(...telemetry.subsystems);
  }

  const highCpuProc = telemetry.processes.find((p) => p.cpuPercent != null && p.cpuPercent > 80);
  if (highCpuProc) {
    alerts.push({
      id: "alert-cpu-high",
      severity: "warning",
      title: "Process CPU Spike",
      message: `Process ${highCpuProc.name} is consuming ${highCpuProc.cpuPercent}% CPU.`,
      timestamp: now,
    });
    recommendations.push({
      id: "rec-proc-isolate",
      title: "Disable Unused Protocol Dissectors",
      action: "Turn off deep payload parsing for non-critical flows to reduce CPU overhead.",
      category: "performance",
    });
  }

  // 3. Loss Indicator Rules
  if (telemetry.networkLossCount > 0) {
    alerts.push({
      id: "alert-loss-net",
      severity: "warning",
      title: "TCP Retransmission Burst Detected",
      message: `Detected ${telemetry.networkLossCount} network packet loss indicators.`,
      timestamp: now,
    });
    recommendations.push({
      id: "rec-loss-diag",
      title: "Run Hop Diagnostics",
      action: "Execute traceroute to identify potential edge gateway interface congestion.",
      category: "hardware",
    });
  }

  // Fallback nominal recommendation if clean
  if (recommendations.length === 0) {
    recommendations.push({
      id: "rec-nominal",
      title: "System Operating at Peak Efficiency",
      action: "All packet capture pipelines and telemetry stream filters are operating normally.",
      category: "performance",
    });
  }

  return { alerts, subsystems, recommendations };
}
