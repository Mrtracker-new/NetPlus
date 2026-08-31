/**
 * Rule-Based Actionable Recommendations Generator.
 */

import type { Diagnosis, Recommendation } from "./types";

/**
 * Generates prioritized, concrete recommendations based on diagnoses.
 */
export function generateRecommendations(diagnoses: Diagnosis[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const seen = new Set<string>();

  for (const d of diagnoses) {
    switch (d.category) {
      case "DNS":
        if (!seen.has("dns")) {
          seen.add("dns");
          recommendations.push({
            title: "Check DNS Resolver Configuration",
            description: "Verify primary and secondary DNS server addresses. Test using reliable public resolvers (such as 1.1.1.1 or 8.8.8.8) to isolate provider resolver slowdowns.",
            actionType: "settings",
            priority: "high",
          });
        }
        break;

      case "GATEWAY":
      case "LOCAL_NETWORK":
        if (!seen.has("gateway")) {
          seen.add("gateway");
          recommendations.push({
            title: "Inspect Local Router & Gateway Connection",
            description: "Check physical cable connections or Wi-Fi signal strength to your local router/gateway. Restart the local router if the default route remains unreachable.",
            actionType: "hardware",
            priority: "high",
          });
        }
        break;

      case "BUFFERBLOAT":
        if (!seen.has("bufferbloat")) {
          seen.add("bufferbloat");
          recommendations.push({
            title: "Enable Smart Queue Management (SQM)",
            description: "Configure modern queue management (such as CAKE or fq_codel) on your router to prevent latency spikes during high-throughput downloads or uploads.",
            actionType: "settings",
            priority: "high",
          });
        }
        break;

      case "PACKET_LOSS":
        if (!seen.has("loss")) {
          seen.add("loss");
          recommendations.push({
            title: "Isolate Packet Loss Location",
            description: "Run continuous ping against your local gateway first. If gateway loss is 0%, contact your Internet Service Provider to investigate upstream packet drops.",
            actionType: "provider",
            priority: "high",
          });
        }
        break;

      case "REMOTE_SERVICE_RESPONSE":
        if (!seen.has("http")) {
          seen.add("http");
          recommendations.push({
            title: "Verify Remote Server Status",
            description: "The remote application server is experiencing errors or high latency. Check status pages or contact the service administrator to determine if an outage is underway.",
            actionType: "info",
            priority: "medium",
          });
        }
        break;

      case "ROUTING":
        if (!seen.has("routing")) {
          seen.add("routing");
          recommendations.push({
            title: "Monitor Route Stability",
            description: "An extended or suboptimal routing path was detected. If persistent, check if a VPN or proxy is causing traffic hair-pinning.",
            actionType: "settings",
            priority: "low",
          });
        }
        break;

      default:
        break;
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: "Network Operating Nominally",
      description: "No remedial actions required. Continue monitoring traffic for transient anomalies.",
      actionType: "info",
      priority: "low",
    });
  }

  return recommendations;
}
