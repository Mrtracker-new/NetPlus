/**
 * Observation Normalization and Anomaly Classification.
 */

import type {
  BufferbloatResult,
  DnsResult,
  GatewayResult,
  HttpResult,
  PingResult,
  TracerouteHop,
} from "@netpulse/contract";
import { getBaseline } from "./baselines";
import type { BaselineTier } from "./baselines";
import type {
  Observation,
  ObservationSeverity,
  ObservationSource,
} from "./types";

/**
 * Normalizes raw probe source string to strict ObservationSource.
 */
export function normalizeSource(source?: string | null): ObservationSource {
  if (!source) return "simulated";
  const s = source.toLowerCase();
  if (s === "live") return "live";
  if (s === "derived") return "derived";
  if (s === "unavailable") return "unavailable";
  return "simulated";
}

/**
 * Applies severity evaluation with mandatory capping for simulated data.
 */
export function classifySeverity(
  val: number,
  metric: string,
  source: ObservationSource,
  tier: BaselineTier = "default"
): ObservationSeverity {
  const baseline = getBaseline(metric, tier);
  let severity: ObservationSeverity = "normal";

  if (val > baseline.elevatedMax) {
    severity = "severe";
  } else if (val > baseline.normalMax) {
    severity = "elevated";
  }

  // Mandatory Invariant: Simulated numeric extremes are capped at "elevated"
  if (source === "simulated" && severity === "severe") {
    severity = "elevated";
  }

  return severity;
}

/**
 * Convert Gateway Discovery probe result to Observation.
 */
export function observationFromGateway(res: GatewayResult): Observation {
  const source = normalizeSource(res.source);
  const isAvailable = Boolean(res.gatewayIp && res.status === "discovered");
  return {
    key: "gateway_reachability",
    source,
    severity: isAvailable ? "normal" : "elevated",
    metricName: "Default Gateway Reachability",
    value: isAvailable ? res.gatewayIp! : null,
    unit: isAvailable ? undefined : undefined,
    quality: isAvailable ? "high" : "unverified",
    rawDetails: {
      interfaceName: res.interfaceName ?? null,
      status: res.status,
    },
    limitation: !isAvailable ? "Default gateway route discovery was unavailable or failed" : undefined,
    isSimulated: source === "simulated",
  };
}

/**
 * Convert DNS probe result to Observations.
 */
export function observationsFromDns(res: DnsResult, tier: BaselineTier = "default"): Observation[] {
  const source = normalizeSource(res.source);
  const observations: Observation[] = [];

  if (res.timedOut || res.error || res.resolutionRttMs === null || res.resolutionRttMs === undefined) {
    observations.push({
      key: "dns_resolution",
      source,
      severity: "severe",
      metricName: "DNS Query Resolution",
      value: null,
      quality: "unverified",
      rawDetails: { target: res.target, error: res.error, timedOut: res.timedOut },
      limitation: res.error ?? "DNS query resolution failed or timed out",
      isSimulated: source === "simulated",
    });
    return observations;
  }

  const rtt = res.resolutionRttMs;
  const severity = classifySeverity(rtt, "dns_rtt", source, tier);

  observations.push({
    key: "dns_rtt",
    source,
    severity,
    metricName: "DNS Resolution Latency",
    value: rtt,
    unit: "ms",
    quality: source === "live" ? "high" : "medium",
    rawDetails: {
      target: res.target,
      resolvedIps: res.resolvedIps,
      ipCount: res.resolvedIps.length,
    },
    isSimulated: source === "simulated",
  });

  return observations;
}

/**
 * Convert Ping probe result to Observations.
 */
export function observationsFromPing(res: PingResult, tier: BaselineTier = "default"): Observation[] {
  const source = normalizeSource(res.source);
  const observations: Observation[] = [];

  const lossPct = res.lossPct ?? (res.sent > 0 ? ((res.sent - res.received) / res.sent) * 100 : 0);
  const lossSeverity = classifySeverity(lossPct, "loss_pct", source, tier);

  observations.push({
    key: "target_packet_loss",
    source,
    severity: lossSeverity,
    metricName: "Target End-to-End Packet Loss",
    value: lossPct,
    unit: "%",
    quality: source === "live" ? "high" : "medium",
    rawDetails: { sent: res.sent, received: res.received, target: res.target },
    isSimulated: source === "simulated",
  });

  if (res.avgRttMs !== undefined && res.avgRttMs !== null) {
    const rttSeverity = classifySeverity(res.avgRttMs, "ping_rtt", source, tier);
    observations.push({
      key: "target_ping_rtt",
      source,
      severity: rttSeverity,
      metricName: "Target Round-Trip Latency",
      value: res.avgRttMs,
      unit: "ms",
      quality: source === "live" ? "high" : "medium",
      rawDetails: {
        minRttMs: res.minRttMs,
        maxRttMs: res.maxRttMs,
        stddevRttMs: res.stddevRttMs,
        target: res.target,
      },
      isSimulated: source === "simulated",
    });
  }

  return observations;
}

/**
 * Convert Traceroute probe result to Observations.
 */
export function observationsFromTraceroute(hops: TracerouteHop[]): Observation[] {
  const observations: Observation[] = [];
  if (hops.length === 0) return observations;

  const source = normalizeSource(hops[0]?.source);
  const totalHops = hops.length;
  const timeoutHops = hops.filter((h) => h.status === "timeout" || h.ip === "*" || h.rttMs === 0 || h.rttMs === undefined);
  const intermediateTimeouts = timeoutHops.length;

  observations.push({
    key: "traceroute_hops",
    source,
    severity: totalHops > 25 ? "elevated" : "normal",
    metricName: "Routing Hop Count",
    value: totalHops,
    unit: "hops",
    quality: source === "live" ? "high" : "medium",
    rawDetails: {
      totalHops,
      timeoutHopsCount: intermediateTimeouts,
      hops: hops.map((h) => ({ ttl: h.ttl, ip: h.ip, rttMs: h.rttMs, status: h.status })),
    },
    isSimulated: source === "simulated",
  });

  if (intermediateTimeouts > 0) {
    observations.push({
      key: "traceroute_intermediate_timeouts",
      source,
      // Intermediate timeouts are typical for ICMP-rate-limiting routers, NOT end-to-end loss
      severity: "normal",
      metricName: "Intermediate Hop ICMP Timeouts",
      value: intermediateTimeouts,
      unit: "hops",
      quality: "medium",
      rawDetails: {
        timeoutHopTtls: timeoutHops.map((h) => h.ttl),
      },
      limitation: "Intermediate hops that discard ICMP TTL-exceeded do not indicate end-to-end packet loss",
      isSimulated: source === "simulated",
    });
  }

  return observations;
}

/**
 * Convert Bufferbloat probe result to Observation.
 */
export function observationFromBufferbloat(res: BufferbloatResult, tier: BaselineTier = "default"): Observation {
  const source = normalizeSource(res.source);
  const delta = res.deltaRttMs ?? (res.loadedRttMs !== undefined && res.idleRttMs !== undefined ? res.loadedRttMs - res.idleRttMs : 0);
  const severity = classifySeverity(delta, "bufferbloat_delta", source, tier);

  return {
    key: "bufferbloat_delta",
    source,
    severity,
    metricName: "Bufferbloat Latency Delta Under Load",
    value: delta,
    unit: "ms",
    quality: source === "live" ? "high" : "medium",
    rawDetails: {
      idleRttMs: res.idleRttMs,
      loadedRttMs: res.loadedRttMs,
      grade: res.grade,
      target: res.target,
    },
    isSimulated: source === "simulated",
  };
}

/**
 * Convert HTTP probe result to Observations.
 */
export function observationsFromHttp(
  res: HttpResult,
  tier: BaselineTier = "default",
  isExplicitUrl: boolean = true
): Observation[] {
  const source = normalizeSource(res.source);
  const observations: Observation[] = [];

  if (res.error || res.statusCode === null || res.statusCode === undefined) {
    observations.push({
      key: "http_availability",
      source,
      severity: isExplicitUrl ? "severe" : "elevated",
      metricName: "HTTP Service Availability",
      value: null,
      quality: "unverified",
      rawDetails: { url: res.url, error: res.error, isExplicitUrl },
      limitation: res.error ?? (isExplicitUrl ? "HTTP connection or transfer failed" : "Target does not host an HTTP server on port 80"),
      isSimulated: source === "simulated",
    });
    return observations;
  }

  if (res.statusCode >= 500) {
    observations.push({
      key: "http_status",
      source,
      severity: "severe",
      metricName: "HTTP Status Code",
      value: res.statusCode,
      quality: "high",
      rawDetails: { url: res.url, statusCode: res.statusCode },
      isSimulated: source === "simulated",
    });
  } else if (res.statusCode >= 400) {
    observations.push({
      key: "http_status",
      source,
      severity: "elevated",
      metricName: "HTTP Status Code",
      value: res.statusCode,
      quality: "high",
      rawDetails: { url: res.url, statusCode: res.statusCode },
      isSimulated: source === "simulated",
    });
  } else {
    observations.push({
      key: "http_status",
      source,
      severity: "normal",
      metricName: "HTTP Status Code",
      value: res.statusCode,
      quality: "high",
      rawDetails: { url: res.url, statusCode: res.statusCode },
      isSimulated: source === "simulated",
    });
  }

  if (res.ttfbMs !== undefined && res.ttfbMs !== null) {
    const ttfbSeverity = classifySeverity(res.ttfbMs, "http_ttfb", source, tier);
    observations.push({
      key: "http_ttfb",
      source,
      severity: ttfbSeverity,
      metricName: "HTTP Time to First Byte",
      value: res.ttfbMs,
      unit: "ms",
      quality: res.tlsMs === null ? "medium" : "high",
      rawDetails: {
        connectMs: res.connectMs,
        ttfbMs: res.ttfbMs,
        transferMs: res.transferMs,
        tlsMs: res.tlsMs,
      },
      limitation: res.limitation ?? (res.tlsMs === null ? "TLS timing unavailable in platform HTTP probe" : undefined),
      isSimulated: source === "simulated",
    });
  }

  return observations;
}
