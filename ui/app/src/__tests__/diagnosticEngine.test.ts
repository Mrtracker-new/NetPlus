import { describe, expect, it } from "vitest";
import type { Query, QueryResponse } from "@netpulse/contract";
import {
  classifySeverity,
  executeDiagnosticPipeline,
  generateMonotonicSessionId,
  getBaseline,
  inferDiagnoses,
  isValidSessionCommit,
  normalizeSource,
  observationFromBufferbloat,
  observationFromGateway,
  observationsFromDns,
  observationsFromHttp,
  observationsFromPing,
  observationsFromTraceroute,
} from "../diagnostic";
import type { Observation } from "../diagnostic";

describe("Diagnostic Baselines & Anomaly Normalization", () => {
  it("retrieves standard baselines across location tiers", () => {
    const localPing = getBaseline("ping_rtt", "local");
    const interPing = getBaseline("ping_rtt", "intercontinental");
    expect(localPing.normalMax).toBeLessThan(interPing.normalMax);
    expect(localPing.unit).toBe("ms");
  });

  it("caps simulated numeric extremes at 'elevated' severity (never 'severe')", () => {
    // 250 ms ping is above severe threshold (> 100 ms)
    const liveSeverity = classifySeverity(250, "ping_rtt", "live");
    expect(liveSeverity).toBe("severe");

    const simSeverity = classifySeverity(250, "ping_rtt", "simulated");
    expect(simSeverity).toBe("elevated");
  });

  it("correctly normalizes source strings", () => {
    expect(normalizeSource("live")).toBe("live");
    expect(normalizeSource("SIMULATED")).toBe("simulated");
    expect(normalizeSource("derived")).toBe("derived");
    expect(normalizeSource("unavailable")).toBe("unavailable");
    expect(normalizeSource(null)).toBe("simulated");
  });
});

describe("Deterministic Diagnostic Rule Inference Engine", () => {
  it("Fixture 1: Clean / Healthy Network outputs nominal status", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: "192.168.1.1",
        interfaceName: "Ethernet",
        status: "discovered",
        source: "live",
      }),
      ...observationsFromDns({
        target: "example.com",
        resolutionRttMs: 14.2,
        resolvedIps: ["93.184.216.34"],
        timedOut: false,
        source: "live",
      }),
      ...observationsFromPing({
        target: "example.com",
        sent: 4,
        received: 4,
        lossPct: 0,
        avgRttMs: 12.1,
        source: "live",
      }),
      ...observationsFromTraceroute([
        { ttl: 1, ip: "192.168.1.1", rttMs: 1.1, status: "ok", source: "live" },
        { ttl: 2, ip: "10.0.0.1", rttMs: 4.5, status: "ok", source: "live" },
        { ttl: 3, ip: "93.184.216.34", rttMs: 12.0, status: "ok", source: "live" },
      ]),
      observationFromBufferbloat({
        target: "example.com",
        idleRttMs: 12.0,
        loadedRttMs: 16.2,
        deltaRttMs: 4.2,
        grade: "A+",
        source: "live",
      }),
      ...observationsFromHttp({
        url: "http://example.com",
        statusCode: 200,
        connectMs: 8.0,
        ttfbMs: 45.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses.length).toBeGreaterThan(0);
    expect(diagnoses[0]!.category).toBe("UNKNOWN");
    expect(diagnoses[0]!.summary).toBe("All Network Diagnostics Healthy");
    expect(diagnoses[0]!.severity).toBe("normal");
    expect(diagnoses[0]!.confidence).toBe(1.0);
  });

  it("Fixture 2: DNS Failure diagnoses DNS with high confidence", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: "192.168.1.1",
        interfaceName: "Ethernet",
        status: "discovered",
        source: "live",
      }),
      ...observationsFromDns({
        target: "broken.domain",
        resolutionRttMs: null,
        resolvedIps: [],
        timedOut: true,
        error: "DNS resolution timed out after 5000ms",
        source: "live",
      }),
      ...observationsFromPing({
        target: "1.1.1.1",
        sent: 4,
        received: 4,
        lossPct: 0,
        avgRttMs: 14.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses.length).toBeGreaterThan(0);
    expect(diagnoses[0]!.category).toBe("DNS");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(diagnoses[0]!.severity).toBe("severe");
  });

  it("Fixture 3: Bufferbloat Spike under load diagnoses BUFFERBLOAT", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: "192.168.1.1",
        status: "discovered",
        source: "live",
      }),
      ...observationsFromDns({
        target: "example.com",
        resolutionRttMs: 20.0,
        resolvedIps: ["93.184.216.34"],
        timedOut: false,
        source: "live",
      }),
      ...observationsFromPing({
        target: "example.com",
        sent: 4,
        received: 4,
        lossPct: 0,
        avgRttMs: 15.0,
        source: "live",
      }),
      observationFromBufferbloat({
        target: "example.com",
        idleRttMs: 15.0,
        loadedRttMs: 200.0,
        deltaRttMs: 185.0,
        grade: "F",
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("BUFFERBLOAT");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(diagnoses[0]!.severity).toBe("severe");
  });

  it("Hard Invariant 1: Intermediate traceroute timeouts do NOT diagnose end-to-end PACKET_LOSS", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: "192.168.1.1",
        status: "discovered",
        source: "live",
      }),
      ...observationsFromDns({
        target: "example.com",
        resolutionRttMs: 15.0,
        resolvedIps: ["93.184.216.34"],
        timedOut: false,
        source: "live",
      }),
      // Target ping has 0% loss!
      ...observationsFromPing({
        target: "example.com",
        sent: 10,
        received: 10,
        lossPct: 0,
        avgRttMs: 18.0,
        source: "live",
      }),
      // Traceroute has intermediate timeouts on hops 2 and 3
      ...observationsFromTraceroute([
        { ttl: 1, ip: "192.168.1.1", rttMs: 1.0, status: "ok", source: "live" },
        { ttl: 2, ip: "*", rttMs: 0, status: "timeout", source: "live" },
        { ttl: 3, ip: "*", rttMs: 0, status: "timeout", source: "live" },
        { ttl: 4, ip: "93.184.216.34", rttMs: 18.2, status: "ok", source: "live" },
      ]),
      ...observationsFromHttp({
        url: "http://example.com",
        statusCode: 200,
        ttfbMs: 60.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    // Must NOT have PACKET_LOSS in top diagnoses
    const packetLossDiagnosis = diagnoses.find((d) => d.category === "PACKET_LOSS");
    expect(packetLossDiagnosis).toBeUndefined();
    expect(diagnoses[0]!.category).not.toBe("PACKET_LOSS");
  });

  it("Hard Invariant 2: Gateway loss vs target loss separation", () => {
    const observations: Observation[] = [
      // Gateway unreachable / lost
      observationFromGateway({
        gatewayIp: null,
        status: "unavailable",
        source: "unavailable",
      }),
      // Target ping has 0% packet loss
      ...observationsFromPing({
        target: "8.8.8.8",
        sent: 4,
        received: 4,
        lossPct: 0,
        avgRttMs: 12.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("GATEWAY");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.70);
    const packetLossDiagnosis = diagnoses.find((d) => d.category === "PACKET_LOSS");
    expect(packetLossDiagnosis).toBeUndefined();
  });

  it("Gateway Precedence: unreachable gateway takes precedence over downstream timeouts", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: null,
        status: "unavailable",
        source: "live",
      }),
      ...observationsFromHttp({
        url: "http://example.com",
        statusCode: null,
        error: "Connection timed out",
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("GATEWAY");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it("HTTP 404 Client Error diagnoses REMOTE_SERVICE_RESPONSE with elevated severity", () => {
    const observations: Observation[] = [
      ...observationsFromHttp({
        url: "http://example.com/not-found",
        statusCode: 404,
        connectMs: 10.0,
        ttfbMs: 35.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("REMOTE_SERVICE_RESPONSE");
    expect(diagnoses[0]!.confidence).toBeGreaterThan(0.50);
    expect(diagnoses[0]!.confidence).toBe(0.85);
    expect(diagnoses[0]!.severity).toBe("elevated");
  });

  it("HTTP 500 Server Error diagnoses REMOTE_SERVICE_RESPONSE with severe severity and high confidence", () => {
    const observations: Observation[] = [
      ...observationsFromHttp({
        url: "http://example.com/api",
        statusCode: 500,
        connectMs: 12.0,
        ttfbMs: 150.0,
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("REMOTE_SERVICE_RESPONSE");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(diagnoses[0]!.confidence).toBe(0.95);
    expect(diagnoses[0]!.severity).toBe("severe");
  });

  it("HTTP Connection Refusal diagnoses service availability failure", () => {
    const observations: Observation[] = [
      ...observationsFromHttp({
        url: "http://127.0.0.1:59999",
        statusCode: null,
        error: "TCP connection failed: Connection refused",
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("REMOTE_SERVICE_RESPONSE");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.80);
    expect(diagnoses[0]!.summary).toBe("HTTP Remote Service Unavailable");
  });

  it("Gateway Discovery Failure produces GATEWAY diagnosis with confidence >= 0.70", () => {
    const observations: Observation[] = [
      observationFromGateway({
        gatewayIp: null,
        interfaceName: null,
        status: "unavailable",
        source: "unavailable",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("GATEWAY");
    expect(diagnoses[0]!.confidence).toBeGreaterThanOrEqual(0.70);
    expect(diagnoses[0]!.summary).toBe("Default Gateway Unreachable");
  });

  it("Missing Corroborating Evidence / Support Normalization", () => {
    // When TTFB is elevated but without separate TLS breakdown, confidence is normalized lower
    const observations: Observation[] = [
      ...observationsFromHttp({
        url: "http://example.com",
        statusCode: 200,
        ttfbMs: 950.0, // elevated/severe TTFB
        tlsMs: null, // missing TLS breakdown
        limitation: "TLS timing unavailable",
        source: "live",
      }),
    ];

    const diagnoses = inferDiagnoses(observations);
    expect(diagnoses[0]!.category).toBe("REMOTE_SERVICE_RESPONSE");
    // Normalized to 0.65 due to lack of separate TLS timing breakdown
    expect(diagnoses[0]!.confidence).toBeLessThan(0.80);
    expect(diagnoses[0]!.confidence).toBe(0.65);
  });
});

describe("Session Concurrency & Monotonic Race Condition Guard", () => {
  it("generates strictly monotonic session IDs", () => {
    const s1 = generateMonotonicSessionId();
    const s2 = generateMonotonicSessionId();
    const s3 = generateMonotonicSessionId();
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it("guards against stale session results overwriting active state", () => {
    const activeSessionId = 5;
    expect(isValidSessionCommit(activeSessionId, 5)).toBe(true);
    expect(isValidSessionCommit(activeSessionId, 4)).toBe(false);
    expect(isValidSessionCommit(activeSessionId, 6)).toBe(false);
    expect(isValidSessionCommit(null, 5)).toBe(false);
  });
});

describe("Pipeline Execution & Cancellation", () => {
  const mockExecutor = async (query: Query): Promise<QueryResponse> => {
    switch (query.kind) {
      case "discoverGateway":
        return {
          kind: "gatewayResult",
          result: { gatewayIp: "192.168.1.1", status: "discovered", source: "live" },
        };
      case "runDnsProbe":
        return {
          kind: "dnsResult",
          result: {
            target: query.target,
            resolutionRttMs: 15.0,
            resolvedIps: ["1.1.1.1"],
            timedOut: false,
            source: "live",
          },
        };
      case "runPing":
        return {
          kind: "pingResult",
          result: {
            target: query.target,
            sent: 4,
            received: 4,
            lossPct: 0,
            avgRttMs: 12.0,
            minRttMs: 10.0,
            maxRttMs: 15.0,
            stddevRttMs: 0.5,
            source: "live",
          },
        };
      case "runTraceroute":
        return {
          kind: "tracerouteResult",
          hops: [{ ttl: 1, ip: "192.168.1.1", rttMs: 1.0, status: "ok", source: "live" }],
        };
      case "runBufferbloatTest":
        return {
          kind: "bufferbloatResult",
          result: {
            target: query.target || "1.1.1.1",
            idleRttMs: 12.0,
            loadedRttMs: 15.0,
            deltaRttMs: 3.0,
            grade: "A+",
            source: "live",
          },
        };
      case "runHttpProbe":
        return {
          kind: "httpResult",
          result: {
            url: query.url,
            statusCode: 200,
            connectMs: 5.0,
            ttfbMs: 30.0,
            source: "live",
          },
        };
      default:
        throw new Error(`Unhandled query ${JSON.stringify(query)}`);
    }
  };

  it("executes full pipeline successfully and computes diagnoses and recommendations", async () => {
    const session = await executeDiagnosticPipeline({
      target: "1.1.1.1",
      executor: mockExecutor,
    });

    expect(session.status).toBe("completed");
    expect(session.observations.length).toBeGreaterThanOrEqual(5);
    expect(session.diagnoses.length).toBeGreaterThan(0);
    expect(session.recommendations.length).toBeGreaterThan(0);
  });

  it("handles non-destructive cancellation cleanly", async () => {
    let cancelled = false;
    const session = await executeDiagnosticPipeline({
      target: "1.1.1.1",
      executor: async (q) => {
        if (q.kind === "runPing") {
          cancelled = true;
        }
        return mockExecutor(q);
      },
      checkCancelled: () => cancelled,
    });

    expect(session.status).toBe("cancelled");
    expect(session.isCancelled).toBe(true);
    // Partial observations should be preserved and inference still run
    expect(session.observations.length).toBeGreaterThan(0);
    expect(session.diagnoses.length).toBeGreaterThan(0);
  });
});
