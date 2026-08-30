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

export interface MonitoringWidget {
  id: string;
  title: string;
  priority: number;
  placement: DashboardZone;
  loader: () => Promise<{ default: React.ComponentType<any> }>;
  onInit?: () => Promise<void>;
  onCleanup?: () => void;
  onRefresh?: () => void;
  settingsSchema?: Record<string, any>;
  permissions?: string[];
  minWidth?: number;
  supportsFullscreen?: boolean;
}

export interface ActiveAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  timestamp: string;
}

export interface SubsystemStatus {
  name: string;
  status: "healthy" | "warning" | "critical";
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
  name: string;
  type: string;
  bandwidthBytes: number;
  formattedBandwidth: string;
  utilizationPercent: number;
  cpuPercent: number;
  memoryMB: number;
  packetsPerSec: number;
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

export interface MonitoringEvents {
  telemetryUpdated: DomainTelemetry;
  alertRaised: ActiveAlert;
  captureStarted: void;
  captureStopped: void;
  engineStateChanged: { state: EngineState; error?: StructuredError };
  widgetRegistered: MonitoringWidget;
}
