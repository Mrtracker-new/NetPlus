/**
 * Pure Deterministic Diagnostic Inference Engine.
 */

import { extractEvidenceForCategory } from "./evidence";
import type { Diagnosis, Observation } from "./types";

/**
 * Runs deterministic rule-based inference on collected observations.
 * Output is guaranteed to be deterministic and sorted by confidence descending.
 */
export function inferDiagnoses(observations: Observation[]): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];
  const obsMap = new Map<string, Observation>(observations.map((o) => [o.key, o]));

  const targetLoss = obsMap.get("target_packet_loss");
  const dnsRtt = obsMap.get("dns_rtt");
  const dnsResolution = obsMap.get("dns_resolution");
  const bufferbloat = obsMap.get("bufferbloat_delta");
  const gateway = obsMap.get("gateway_reachability");
  const httpStatus = obsMap.get("http_status");
  const httpTtfb = obsMap.get("http_ttfb");
  const httpAvailability = obsMap.get("http_availability");
  const tracerouteHops = obsMap.get("traceroute_hops");

  const hasSimulatedOnly = observations.length > 0 && observations.every((o) => o.source === "simulated");

  // --------------------------------------------------------------------------
  // Rule 1: DNS Failure or High Latency
  // --------------------------------------------------------------------------
  if (dnsResolution && dnsResolution.severity === "severe") {
    const evidence = extractEvidenceForCategory("DNS", observations);
    diagnoses.push({
      category: "DNS",
      confidence: 0.95,
      summary: "DNS Query Resolution Failure",
      explanation: "Domain name resolution failed completely or timed out. Network applications cannot resolve hostnames to IP addresses.",
      evidence,
      severity: hasSimulatedOnly ? "elevated" : "severe",
    });
  } else if (dnsRtt && typeof dnsRtt.value === "number" && dnsRtt.severity !== "normal") {
    const evidence = extractEvidenceForCategory("DNS", observations);
    diagnoses.push({
      category: "DNS",
      confidence: dnsRtt.severity === "severe" ? 0.85 : 0.65,
      summary: "Elevated DNS Resolution Latency",
      explanation: `DNS resolver response time is elevated (${dnsRtt.value} ms), delaying initial connection establishment.`,
      evidence,
      severity: dnsRtt.severity,
    });
  }

  // --------------------------------------------------------------------------
  // Rule 2: Gateway & Local Network Issues (Precedence Rule)
  // --------------------------------------------------------------------------
  if (gateway && gateway.value === null) {
    const evidence = extractEvidenceForCategory("GATEWAY", observations);
    diagnoses.push({
      category: "GATEWAY",
      confidence: 0.90,
      summary: "Default Gateway Unreachable",
      explanation: "The default local gateway could not be discovered or is unreachable, preventing traffic egress to external networks.",
      evidence,
      severity: hasSimulatedOnly ? "elevated" : "severe",
    });
  }

  // --------------------------------------------------------------------------
  // Rule 3: Bufferbloat (Delta under load)
  // --------------------------------------------------------------------------
  if (bufferbloat && typeof bufferbloat.value === "number" && bufferbloat.severity !== "normal") {
    const evidence = extractEvidenceForCategory("BUFFERBLOAT", observations);
    diagnoses.push({
      category: "BUFFERBLOAT",
      confidence: bufferbloat.severity === "severe" ? 0.90 : 0.70,
      summary: "Bufferbloat Latency Spike Under Load",
      explanation: `Network queueing causes round-trip latency to spike by +${bufferbloat.value} ms during traffic bursts.`,
      evidence,
      severity: bufferbloat.severity,
    });
  }

  // --------------------------------------------------------------------------
  // Rule 4: End-to-End Packet Loss (with Hard Invariants)
  // --------------------------------------------------------------------------
  // Invariant 1: If target packet loss is 0%, intermediate traceroute timeouts DO NOT trigger PACKET_LOSS (confidence < 0.10).
  // Invariant 2: Target loss vs gateway loss separation.
  if (targetLoss && typeof targetLoss.value === "number") {
    if (targetLoss.value > 0) {
      const evidence = extractEvidenceForCategory("PACKET_LOSS", observations);
      const isSevere = targetLoss.value >= 10;
      diagnoses.push({
        category: "PACKET_LOSS",
        confidence: isSevere ? 0.92 : 0.75,
        summary: `End-to-End Packet Loss (${targetLoss.value}%)`,
        explanation: `Sustained packet loss of ${targetLoss.value}% detected between local client and target host.`,
        evidence,
        severity: targetLoss.severity,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Rule 5: Remote Service / HTTP Issues
  // --------------------------------------------------------------------------
  if (httpAvailability && httpAvailability.severity === "severe") {
    const evidence = extractEvidenceForCategory("REMOTE_SERVICE_RESPONSE", observations);
    diagnoses.push({
      category: "REMOTE_SERVICE_RESPONSE",
      confidence: 0.88,
      summary: "HTTP Remote Service Unavailable",
      explanation: "HTTP connection or response transfer failed when reaching the target application server.",
      evidence,
      severity: hasSimulatedOnly ? "elevated" : "severe",
    });
  } else if (httpStatus && typeof httpStatus.value === "number" && httpStatus.value >= 400) {
    const evidence = extractEvidenceForCategory("REMOTE_SERVICE_RESPONSE", observations);
    const is5xx = httpStatus.value >= 500;
    diagnoses.push({
      category: "REMOTE_SERVICE_RESPONSE",
      confidence: is5xx ? 0.95 : 0.85,
      summary: `HTTP Server Error (Status ${httpStatus.value})`,
      explanation: `Target application server returned HTTP status code ${httpStatus.value}, indicating remote server or application malfunction.`,
      evidence,
      severity: is5xx ? (hasSimulatedOnly ? "elevated" : "severe") : "elevated",
    });
  } else if (httpTtfb && typeof httpTtfb.value === "number" && httpTtfb.severity !== "normal") {
    const evidence = extractEvidenceForCategory("REMOTE_SERVICE_RESPONSE", observations);
    diagnoses.push({
      category: "REMOTE_SERVICE_RESPONSE",
      confidence: 0.65, // Lower confidence due to lack of separate TLS timing breakdown
      summary: "Elevated HTTP Time to First Byte",
      explanation: `Server processing and delivery time is elevated (${httpTtfb.value} ms TTFB). Note: TLS handshake timing is aggregate.`,
      evidence,
      severity: httpTtfb.severity,
    });
  }

  // --------------------------------------------------------------------------
  // Rule 6: Routing Path
  // --------------------------------------------------------------------------
  if (tracerouteHops && typeof tracerouteHops.value === "number" && tracerouteHops.value > 25) {
    const evidence = extractEvidenceForCategory("ROUTING", observations);
    diagnoses.push({
      category: "ROUTING",
      confidence: 0.60,
      summary: "Extended Routing Path",
      explanation: `Network path requires ${tracerouteHops.value} hops to reach destination, which may increase latency jitter.`,
      evidence,
      severity: "elevated",
    });
  }

  // --------------------------------------------------------------------------
  // Rule 7: Fallback to UNKNOWN if healthy or no candidate matched
  // --------------------------------------------------------------------------
  if (diagnoses.length === 0) {
    // If all available metrics were normal, output a healthy summary
    const allNormal = observations.length > 0 && observations.every((o) => o.severity === "normal");
    diagnoses.push({
      category: allNormal ? "UNKNOWN" : "UNKNOWN",
      confidence: allNormal ? 1.0 : 0.3,
      summary: allNormal ? "All Network Diagnostics Healthy" : "No Critical Anomalies Detected",
      explanation: allNormal
        ? "All diagnostic probes (Gateway, DNS, Ping, Routing, Bufferbloat, HTTP) reported nominal performance within baseline thresholds."
        : "Diagnostic observations were inconclusive or within acceptable operating tolerances.",
      evidence: [],
      severity: "normal",
    });
  }

  // Sort deterministically: confidence descending, then category name
  diagnoses.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.category.localeCompare(b.category);
  });

  return diagnoses;
}
