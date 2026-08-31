/**
 * Deep Diagnostic Pipeline Orchestrator.
 */

import type { Query, QueryResponse } from "@netpulse/contract";
import {
  observationFromBufferbloat,
  observationFromGateway,
  observationsFromDns,
  observationsFromHttp,
  observationsFromPing,
  observationsFromTraceroute,
} from "./anomaly";
import { inferDiagnoses } from "./inference";
import { generateRecommendations } from "./recommendations";
import { generateMonotonicSessionId } from "./session";
import type {
  DiagnosticSession,
  DiagnosticStepKind,
} from "./types";

export type QueryExecutor = (query: Query) => Promise<QueryResponse>;

export interface PipelineOptions {
  target: string;
  executor: QueryExecutor;
  locationTier?: "local" | "metro" | "continental" | "intercontinental" | "default";
  onProgress?: (session: DiagnosticSession) => void;
  checkCancelled?: (sessionId: number) => boolean;
}

/**
 * Normalizes user input target for individual probe requirements.
 */
export function normalizeTarget(input: string): { host: string; url: string; isExplicitUrl: boolean } {
  let trimmed = input.trim();
  if (!trimmed) {
    trimmed = "1.1.1.1";
  }

  const isExplicitUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
  let host = trimmed;
  let url = trimmed;

  if (isExplicitUrl) {
    url = trimmed;
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
    } catch {
      host = trimmed.replace(/^https?:\/\//, "").split("/")[0] || trimmed;
    }
  } else {
    // If it's bracketed IPv6, e.g. [::1]
    if (trimmed.startsWith("[")) {
      const endBracket = trimmed.indexOf("]");
      host = endBracket !== -1 ? trimmed.substring(1, endBracket) : trimmed;
      url = `http://${trimmed}`;
    } else {
      // If IPv6 with multiple colons
      const colonCount = (trimmed.match(/:/g) || []).length;
      if (colonCount > 1) {
        host = trimmed;
        url = `http://[${trimmed}]`;
      } else {
        host = trimmed.split("/")[0]!.split(":")[0]!;
        url = `http://${trimmed}`;
      }
    }
  }

  return { host, url, isExplicitUrl };
}

/**
 * Executes the complete diagnostic pipeline.
 */
export async function executeDiagnosticPipeline(
  options: PipelineOptions
): Promise<DiagnosticSession> {
  const { target, executor, locationTier = "default", onProgress, checkCancelled } = options;
  const sessionId = generateMonotonicSessionId();
  const { host, url, isExplicitUrl } = normalizeTarget(target);

  const session: DiagnosticSession = {
    sessionId,
    target,
    status: "running",
    startedAt: Date.now(),
    observations: [],
    diagnoses: [],
    recommendations: [],
    currentStep: "gateway",
  };

  const notifyProgress = (step: DiagnosticStepKind) => {
    session.currentStep = step;
    onProgress?.({ ...session, observations: [...session.observations] });
  };

  const isCancelled = () => {
    return session.isCancelled || (checkCancelled ? checkCancelled(sessionId) : false);
  };

  const steps: Array<{
    name: DiagnosticStepKind;
    action: () => Promise<void>;
  }> = [
    {
      name: "gateway",
      action: async () => {
        try {
          const res = await executor({ kind: "discoverGateway" });
          if (res.kind === "gatewayResult") {
            session.observations.push(observationFromGateway(res.result));
          }
        } catch {
          session.observations.push({
            key: "gateway_reachability",
            source: "unavailable",
            severity: "elevated",
            metricName: "Default Gateway Reachability",
            value: null,
            quality: "unverified",
            limitation: "Gateway discovery failed",
          });
        }
      },
    },
    {
      name: "dns",
      action: async () => {
        try {
          const res = await executor({ kind: "runDnsProbe", target: host });
          if (res.kind === "dnsResult") {
            session.observations.push(...observationsFromDns(res.result, locationTier));
          }
        } catch {
          session.observations.push({
            key: "dns_resolution",
            source: "unavailable",
            severity: "severe",
            metricName: "DNS Query Resolution",
            value: null,
            quality: "unverified",
            limitation: "DNS probe execution failed",
          });
        }
      },
    },
    {
      name: "ping",
      action: async () => {
        try {
          const res = await executor({ kind: "runPing", target: host, count: 4 });
          if (res.kind === "pingResult") {
            session.observations.push(...observationsFromPing(res.result, locationTier));
          }
        } catch {
          session.observations.push({
            key: "target_packet_loss",
            source: "unavailable",
            severity: "elevated",
            metricName: "Target End-to-End Packet Loss",
            value: null,
            quality: "unverified",
            limitation: "Ping probe execution failed",
          });
        }
      },
    },
    {
      name: "traceroute",
      action: async () => {
        try {
          const res = await executor({
            kind: "runTraceroute",
            target: host,
            transport: "icmp",
            max_hops: 30,
          });
          if (res.kind === "tracerouteResult") {
            session.observations.push(...observationsFromTraceroute(res.hops));
          }
        } catch {
          // Traceroute failure is non-fatal
        }
      },
    },
    {
      name: "bufferbloat",
      action: async () => {
        try {
          const res = await executor({ kind: "runBufferbloatTest", target: host });
          if (res.kind === "bufferbloatResult") {
            session.observations.push(observationFromBufferbloat(res.result, locationTier));
          }
        } catch {
          // Bufferbloat failure is non-fatal
        }
      },
    },
    {
      name: "http",
      action: async () => {
        try {
          const res = await executor({ kind: "runHttpProbe", url });
          if (res.kind === "httpResult") {
            session.observations.push(...observationsFromHttp(res.result, locationTier, isExplicitUrl));
          }
        } catch {
          session.observations.push({
            key: "http_availability",
            source: "unavailable",
            severity: isExplicitUrl ? "severe" : "normal",
            metricName: "HTTP Service Availability",
            value: null,
            quality: "unverified",
            limitation: isExplicitUrl ? "HTTP probe execution failed" : "Target does not host an HTTP server on port 80",
          });
        }
      },
    },
  ];

  for (const step of steps) {
    if (isCancelled()) {
      session.isCancelled = true;
      session.status = "cancelled";
      break;
    }

    notifyProgress(step.name);
    await step.action();
  }

  // Final Inference & Recommendations on collected observations
  session.diagnoses = inferDiagnoses(session.observations);
  session.recommendations = generateRecommendations(session.diagnoses);
  session.completedAt = Date.now();

  if (!session.isCancelled) {
    session.status = "completed";
  }

  return session;
}
