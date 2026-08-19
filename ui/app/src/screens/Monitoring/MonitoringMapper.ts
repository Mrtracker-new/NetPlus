import { humanBytes } from "@netpulse/viz";
import type {
  DomainTelemetry,
  ViewTelemetry,
  EngineState,
  StructuredError,
  DashboardTimeRange,
} from "./monitoringTypes";
import { evaluateDiagnosticsRules } from "./monitoringRulesEngine";

export class MonitoringMapper {
  public static toViewModel(
    domain: DomainTelemetry,
    engineState: EngineState,
    error: StructuredError | null,
    timeRange: DashboardTimeRange = "24h"
  ): ViewTelemetry {
    const evaluation = evaluateDiagnosticsRules(domain);

    // Dynamic, meaningful X-axis timestamps
    let timestamps: string[] = [];

    switch (timeRange) {
      case "5m":
        timestamps = ["5m ago", "4m ago", "3m ago", "2m ago", "1m ago", "Now"];
        break;
      case "15m":
        timestamps = ["15m ago", "12m ago", "9m ago", "6m ago", "3m ago", "Now"];
        break;
      case "1h":
        timestamps = ["60m ago", "45m ago", "30m ago", "15m ago", "Now"];
        break;
      case "24h":
      default:
        timestamps = ["12 AM", "06 AM", "12 PM", "06 PM", "12 AM"];
        break;
    }

    // Dynamic time-series window downsampling & rate calculation
    const aggregatedIngress = this.downsampleSeries(domain.ingressHistory);
    const aggregatedEgress = this.downsampleSeries(domain.egressHistory);
    const aggregatedGains = this.downsampleSeries(domain.gainsHistory);

    const maxGain = Math.max(...aggregatedGains, 0);
    const peakGainBadge = maxGain > 0 ? `+${humanBytes(maxGain * 1024)}/s` : "+0 B/s";

    return {
      engineState,
      error,
      formattedTraffic: humanBytes(domain.bytesSeen),
      activeProtocolsCount: String(domain.activeProtocols),
      activeHostsCount: String(domain.activeHosts),
      activeFlowsCount: String(domain.activeFlows),
      throughputSeries: [
        { name: "Ingress", data: aggregatedIngress, color: "var(--np-monitor-primary, #00f2fe)" },
        { name: "Egress", data: aggregatedEgress, color: "var(--np-accent-2, #7c83f7)" },
      ],
      gainsSeries: [
        { name: "Throughput Gains", data: aggregatedGains, color: "var(--np-monitor-primary, #00f2fe)" },
      ],
      timestamps,
      peakGainBadge,
      nodes: domain.nodes,
      edges: domain.edges,
      processes: domain.processes,
      alerts: evaluation.alerts,
      subsystems: evaluation.subsystems,
      recommendations: evaluation.recommendations,
    };
  }

  private static downsampleSeries(series: number[]): number[] {
    if (!series || series.length === 0) return Array(12).fill(0);

    const targetLen = 12;
    const result: number[] = [];

    for (let i = 0; i < targetLen; i++) {
      const srcIndex = Math.min(
        series.length - 1,
        Math.floor((i / (targetLen - 1)) * (series.length - 1))
      );
      const val = series[srcIndex] ?? 0;
      result.push(val);
    }

    return result;
  }
}
