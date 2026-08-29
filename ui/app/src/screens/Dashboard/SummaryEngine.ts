import type { MonitorSnapshot, NarrativeCard } from "@netpulse/contract";
import { humanBytes } from "@netpulse/viz";
import type { SituationSummaryModel, RecommendationItem } from "./viewModels";

export function generateSituationSummary(
  monitor: MonitorSnapshot | null,
  feed: NarrativeCard[]
): SituationSummaryModel {
  const hostsCount = monitor?.by_host.rows.length ?? 0;
  const flowsCount = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
  const totalBytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;
  
  const findings = feed.filter((c) => c.severity === "finding");
  const notables = feed.filter((c) => c.severity === "notable");

  // Determine overall health
  let overallHealth: "healthy" | "notable" | "finding" = "healthy";
  if (findings.length > 0) {
    overallHealth = "finding";
  } else if (notables.length > 0) {
    overallHealth = "notable";
  }

  // Generate headline
  let headline = "Network Operating Normally";
  if (overallHealth === "finding") {
    headline = `Attention Needed — ${findings.length} security/performance finding${findings.length > 1 ? "s" : ""}`;
  } else if (overallHealth === "notable") {
    headline = `Notable Activity — ${notables.length} event${notables.length > 1 ? "s" : ""} recorded`;
  }

  // Generate natural language explanation paragraph
  const sentenceList: string[] = [];
  if (overallHealth === "healthy") {
    sentenceList.push("Everything looks normal across your local connection.");
  } else if (overallHealth === "finding") {
    sentenceList.push("Recent security or performance findings require your review.");
  } else {
    sentenceList.push("Notable network events recorded across your connection.");
  }

  sentenceList.push(`${hostsCount} host${hostsCount === 1 ? "" : "s"} and ${flowsCount} active flow${flowsCount === 1 ? "" : "s"} observed.`);
  sentenceList.push(`Total volume transferred is ${humanBytes(totalBytes)}.`);

  if (findings.length > 0) {
    sentenceList.push(`Most critical: "${findings[0]!.headline}".`);
  } else {
    sentenceList.push("No critical security anomalies or traffic anomalies detected.");
  }

  const explanation = sentenceList.join(" ");

  // Highlights
  const highlights: string[] = [
    `${hostsCount} active hosts`,
    `${flowsCount} concurrent flows`,
    `${humanBytes(totalBytes)} transferred`,
  ];

  if (monitor?.network_loss_indicators && monitor.network_loss_indicators > 0) {
    highlights.push(`${monitor.network_loss_indicators} loss indicators detected`);
  }

  // Recommendations
  const recommendations: RecommendationItem[] = [];
  if (findings.length > 0) {
    recommendations.push({
      type: "investigate",
      text: `Investigate ${findings[0]!.headline}`,
      actionText: "Review Finding",
    });
  }
  if (notables.length > 0 && recommendations.length < 2) {
    recommendations.push({
      type: "monitor",
      text: `Monitor ${notables[0]!.headline}`,
      actionText: "Inspect Event",
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      type: "ignore",
      text: "No action required — background traffic operating normally.",
    });
  }

  return {
    overallHealth,
    headline,
    explanation,
    highlights,
    recommendations,
  };
}
