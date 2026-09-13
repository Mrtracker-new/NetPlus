/**
 * Rule-Based Actionable Recommendations Generator.
 */

import type { Diagnosis, Recommendation } from "./types";

export interface RecommendationTemplate extends Recommendation {
  key: string;
  titleKey: string;
  descriptionKey: string;
}

export type RecommendationKey =
  | "dns"
  | "gateway"
  | "bufferbloat"
  | "loss"
  | "http"
  | "routing"
  | "nominal";

export const RECOMMENDATION_TEMPLATES: Record<RecommendationKey, RecommendationTemplate> = {
  dns: {
    key: "dns",
    titleKey: "assessment.recommendations.dns.title",
    descriptionKey: "assessment.recommendations.dns.desc",
    title: "Check DNS Resolver Configuration",
    description:
      "Verify primary and secondary DNS server addresses. Test using reliable public resolvers (such as 1.1.1.1 or 8.8.8.8) to isolate provider resolver slowdowns.",
    actionType: "settings",
    priority: "high",
  },
  gateway: {
    key: "gateway",
    titleKey: "assessment.recommendations.gateway.title",
    descriptionKey: "assessment.recommendations.gateway.desc",
    title: "Inspect Local Router & Gateway Connection",
    description:
      "Check physical cable connections or Wi-Fi signal strength to your local router/gateway. Restart the local router if the default route remains unreachable.",
    actionType: "hardware",
    priority: "high",
  },
  bufferbloat: {
    key: "bufferbloat",
    titleKey: "assessment.recommendations.bufferbloat.title",
    descriptionKey: "assessment.recommendations.bufferbloat.desc",
    title: "Enable Smart Queue Management (SQM)",
    description:
      "Configure modern queue management (such as CAKE or fq_codel) on your router to prevent latency spikes during high-throughput downloads or uploads.",
    actionType: "settings",
    priority: "high",
  },
  loss: {
    key: "loss",
    titleKey: "assessment.recommendations.loss.title",
    descriptionKey: "assessment.recommendations.loss.desc",
    title: "Isolate Packet Loss Location",
    description:
      "Run continuous ping against your local gateway first. If gateway loss is 0%, contact your Internet Service Provider to investigate upstream packet drops.",
    actionType: "provider",
    priority: "high",
  },
  http: {
    key: "http",
    titleKey: "assessment.recommendations.http.title",
    descriptionKey: "assessment.recommendations.http.desc",
    title: "Verify Remote Server Status",
    description:
      "The remote application server is experiencing errors or high latency. Check status pages or contact the service administrator to determine if an outage is underway.",
    actionType: "info",
    priority: "medium",
  },
  routing: {
    key: "routing",
    titleKey: "assessment.recommendations.routing.title",
    descriptionKey: "assessment.recommendations.routing.desc",
    title: "Monitor Route Stability",
    description:
      "An extended or suboptimal routing path was detected. If persistent, check if a VPN or proxy is causing traffic hair-pinning.",
    actionType: "settings",
    priority: "low",
  },
  nominal: {
    key: "nominal",
    titleKey: "assessment.recommendations.nominal.title",
    descriptionKey: "assessment.recommendations.nominal.desc",
    title: "Network Operating Nominally",
    description: "No remedial actions required. Continue monitoring traffic for transient anomalies.",
    actionType: "info",
    priority: "low",
  },
};

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
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.dns });
        }
        break;

      case "GATEWAY":
      case "LOCAL_NETWORK":
        if (!seen.has("gateway")) {
          seen.add("gateway");
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.gateway });
        }
        break;

      case "BUFFERBLOAT":
        if (!seen.has("bufferbloat")) {
          seen.add("bufferbloat");
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.bufferbloat });
        }
        break;

      case "PACKET_LOSS":
        if (!seen.has("loss")) {
          seen.add("loss");
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.loss });
        }
        break;

      case "REMOTE_SERVICE_RESPONSE":
        if (!seen.has("http")) {
          seen.add("http");
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.http });
        }
        break;

      case "ROUTING":
        if (!seen.has("routing")) {
          seen.add("routing");
          recommendations.push({ ...RECOMMENDATION_TEMPLATES.routing });
        }
        break;

      default:
        break;
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({ ...RECOMMENDATION_TEMPLATES.nominal });
  }

  return recommendations;
}
