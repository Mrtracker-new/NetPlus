import type { Diagnosis, DiagnosticChain } from "@netpulse/contract";
import type { TopologyNode, TopologyEdge } from "@netpulse/viz";

export type EngineState =
  | "Initializing"
  | "Connecting"
  | "Live"
  | "Standby"
  | "Paused"
  | "Degraded"
  | "Reconnecting"
  | "Simulation"
  | "Disconnected"
  | "Error";

export interface StructuredError {
  code: string;
  title: string;
  message: string;
  recoveryAction?: string;
}

export type DashboardZone = "Header" | "MainLeft" | "MainRight" | "Bottom" | "Sidebar" | "Footer";
export type DashboardTimeRange = "5m" | "15m" | "1h" | "24h";

export type TopologySublabel =
  | "LOCAL"
  | "LOCAL_SUBNET"
  | "EXTERNAL_WAN"
  | "CDN_EDGE"
  | "MULTICAST"
  | "SRC";

export const normalizeTopologySublabel = (value?: string): TopologySublabel | undefined => {
  switch (value?.trim().toUpperCase().replace(/\s+/g, "_")) {
    case "LOCAL":
      return "LOCAL";
    case "LOCAL_SUBNET":
      return "LOCAL_SUBNET";
    case "EXTERNAL_WAN":
      return "EXTERNAL_WAN";
    case "CDN_EDGE":
      return "CDN_EDGE";
    case "MULTICAST":
      return "MULTICAST";
    case "SRC":
      return "SRC";
    default:
      return undefined;
  }
};

export interface ActiveAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  timestamp: string;
}

export interface SubsystemStatus {
  name: string;
  status: "healthy" | "warning" | "degraded" | "critical" | "unknown";
  detail?: string;
}

export interface IntelligentRecommendation {
  id: string;
  title: string;
  action: string;
  category: "performance" | "buffer" | "protocol" | "hardware";
}

export interface ProcessMetricRow {
  id: string;
  pid: number | null;
  name: string;
  exePath: string | null;
  type: string;
  bandwidthBytes: number;
  formattedBandwidth: string;
  utilizationPercent: number;
  cpuPercent: number | null;
  memoryMB: number | null;
  packetsPerSec: number;
  packets: number;
  flows: number;
  rttMs: number;
  errors: number;
  color: string;
  history: number[];
}

export interface DomainTelemetry {
  timestampNanos: number;
  bytesSeen: number;
  activeFlows: number;
  activeHosts: number;
  activeProtocols: number;
  ingressHistory: number[];
  egressHistory: number[];
  gainsHistory: number[];
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  processes: ProcessMetricRow[];
  subsystems: SubsystemStatus[];
  bufferPercent: number;
  bufferFrames: number;
  bufferCapacity: number;
  dropCount: number;
  networkLossCount: number;
  diagnoses: Diagnosis[];
  diagnosticChain?: DiagnosticChain;
}

export interface ViewTelemetry {
  engineState: EngineState;
  error: StructuredError | null;
  formattedTraffic: string;
  activeProtocolsCount: string;
  activeHostsCount: string;
  activeFlowsCount: string;
  throughputSeries: { name: string; data: number[]; color?: string }[];
  gainsSeries: { name: string; data: number[]; color?: string }[];
  timestamps: string[];
  peakGainBadge: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  processes: ProcessMetricRow[];
  alerts: ActiveAlert[];
  subsystems: SubsystemStatus[];
  recommendations: IntelligentRecommendation[];
  diagnosticChain?: DiagnosticChain;
}
