import type { DomainTelemetry } from "./monitoringTypes";

export function generateIdleTelemetry(): DomainTelemetry {
  const zeroHistory = Array(12).fill(0);

  return {
    timestampNanos: Date.now() * 1_000_000,
    bytesSeen: 0,
    activeFlows: 0,
    activeHosts: 0,
    activeProtocols: 0,
    ingressHistory: zeroHistory,
    egressHistory: zeroHistory,
    gainsHistory: zeroHistory,
    nodes: [],
    edges: [],
    processes: [],
    bufferPercent: 0,
    bufferFrames: 0,
    bufferCapacity: 1000,
    dropCount: 0,
    networkLossCount: 0,
    diagnoses: [],
  };
}
