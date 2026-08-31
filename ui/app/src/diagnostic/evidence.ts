/**
 * Corroborating and Contradicting Evidence Evaluation for Candidate Hypotheses.
 */

import type { DiagnosisCategory, Evidence, Observation } from "./types";

/**
 * Extracts corroborating and contradicting evidence items for a given diagnosis category from observations.
 */
export function extractEvidenceForCategory(
  category: DiagnosisCategory,
  observations: Observation[]
): Evidence[] {
  const evidence: Evidence[] = [];
  const obsMap = new Map<string, Observation>(observations.map((o) => [o.key, o]));

  const targetLoss = obsMap.get("target_packet_loss");
  const dnsRtt = obsMap.get("dns_rtt");
  const dnsResolution = obsMap.get("dns_resolution");
  const bufferbloat = obsMap.get("bufferbloat_delta");
  const gateway = obsMap.get("gateway_reachability");
  const httpStatus = obsMap.get("http_status");
  const httpTtfb = obsMap.get("http_ttfb");
  const tracerouteTimeouts = obsMap.get("traceroute_intermediate_timeouts");

  switch (category) {
    case "PACKET_LOSS": {
      if (targetLoss && typeof targetLoss.value === "number") {
        if (targetLoss.value > 0) {
          evidence.push({
            observationKey: targetLoss.key,
            role: "corroborating",
            explanation: `Measured target packet loss of ${targetLoss.value}% (source: ${targetLoss.source})`,
            weight: targetLoss.value > 5 ? 1.0 : 0.7,
          });
        } else {
          evidence.push({
            observationKey: targetLoss.key,
            role: "contradicting",
            explanation: "Target packet loss is 0%, demonstrating no end-to-end transport drops",
            weight: 1.0,
          });
        }
      }

      if (tracerouteTimeouts && typeof tracerouteTimeouts.value === "number" && tracerouteTimeouts.value > 0) {
        evidence.push({
          observationKey: tracerouteTimeouts.key,
          role: "contradicting",
          explanation: `Intermediate traceroute timeouts (${tracerouteTimeouts.value} hops) are ICMP rate-limiting artifacts, not end-to-end loss`,
          weight: 0.8,
        });
      }
      break;
    }

    case "DNS": {
      if (dnsResolution && dnsResolution.severity === "severe") {
        evidence.push({
          observationKey: dnsResolution.key,
          role: "corroborating",
          explanation: "DNS query resolution failed or timed out",
          weight: 1.0,
        });
      } else if (dnsRtt && typeof dnsRtt.value === "number") {
        if (dnsRtt.severity !== "normal") {
          evidence.push({
            observationKey: dnsRtt.key,
            role: "corroborating",
            explanation: `Elevated DNS query latency of ${dnsRtt.value} ms (source: ${dnsRtt.source})`,
            weight: dnsRtt.severity === "severe" ? 0.9 : 0.6,
          });
        } else {
          evidence.push({
            observationKey: dnsRtt.key,
            role: "contradicting",
            explanation: `DNS resolution latency is normal at ${dnsRtt.value} ms`,
            weight: 0.7,
          });
        }
      }
      break;
    }

    case "BUFFERBLOAT": {
      if (bufferbloat && typeof bufferbloat.value === "number") {
        if (bufferbloat.severity !== "normal") {
          evidence.push({
            observationKey: bufferbloat.key,
            role: "corroborating",
            explanation: `Loaded latency spiked by +${bufferbloat.value} ms over idle baseline (source: ${bufferbloat.source})`,
            weight: bufferbloat.severity === "severe" ? 0.95 : 0.7,
          });
        } else {
          evidence.push({
            observationKey: bufferbloat.key,
            role: "contradicting",
            explanation: `Bufferbloat delta latency is negligible at +${bufferbloat.value} ms`,
            weight: 0.8,
          });
        }
      }
      break;
    }

    case "GATEWAY":
    case "LOCAL_NETWORK": {
      if (gateway) {
        if (gateway.value === null) {
          evidence.push({
            observationKey: gateway.key,
            role: "corroborating",
            explanation: "Default gateway route is unreachable or unconfigured",
            weight: 0.9,
          });
        } else {
          evidence.push({
            observationKey: gateway.key,
            role: "contradicting",
            explanation: `Default gateway ${gateway.value} is reachable on local network`,
            weight: 0.6,
          });
        }
      }
      break;
    }

    case "REMOTE_SERVICE_RESPONSE": {
      if (httpStatus && typeof httpStatus.value === "number") {
        if (httpStatus.value >= 500) {
          evidence.push({
            observationKey: httpStatus.key,
            role: "corroborating",
            explanation: `Server returned HTTP ${httpStatus.value} internal error`,
            weight: 1.0,
          });
        } else if (httpStatus.value >= 400) {
          evidence.push({
            observationKey: httpStatus.key,
            role: "corroborating",
            explanation: `Server returned HTTP ${httpStatus.value} client error`,
            weight: 0.8,
          });
        }
      }

      if (httpTtfb && typeof httpTtfb.value === "number") {
        if (httpTtfb.severity !== "normal") {
          evidence.push({
            observationKey: httpTtfb.key,
            role: "corroborating",
            explanation: `High HTTP Time to First Byte (${httpTtfb.value} ms)${httpTtfb.limitation ? ` [${httpTtfb.limitation}]` : ""}`,
            weight: httpTtfb.quality === "high" ? 0.85 : 0.6,
          });
        }
      }
      break;
    }

    case "ROUTING": {
      const tracerouteHops = obsMap.get("traceroute_hops");
      if (tracerouteHops && typeof tracerouteHops.value === "number" && tracerouteHops.value > 25) {
        evidence.push({
          observationKey: tracerouteHops.key,
          role: "corroborating",
          explanation: `Excessive routing path length of ${tracerouteHops.value} hops`,
          weight: 0.7,
        });
      }
      break;
    }

    default:
      break;
  }

  return evidence;
}
