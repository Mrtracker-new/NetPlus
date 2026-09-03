import type { Cause, MonitorSnapshot, NarrativeCard } from "@netpulse/contract";
import { humanBytes } from "@netpulse/viz";
import type { SituationSummaryModel, RecommendationItem } from "./viewModels";

function formatCauseHeadline(cause: Cause): string {
  switch (cause) {
    case "local_wifi":
      return "Degradation Detected — Likely Local Link / Wi-Fi";
    case "slow_dns":
      return "Degradation Detected — Likely Slow DNS";
    case "distant_server":
      return "Degradation Detected — Likely Distant Server / Path";
    case "congestion":
      return "Degradation Detected — Likely Network Congestion";
    default:
      return "Degradation Detected Across Network";
  }
}

function formatCauseLabel(cause: Cause): string {
  switch (cause) {
    case "local_wifi":
      return "Local Wi-Fi / Link";
    case "slow_dns":
      return "Slow DNS";
    case "distant_server":
      return "Distant Server";
    case "congestion":
      return "Network Congestion";
    default:
      return "Network Degradation";
  }
}

export function generateSituationSummary(
  monitor: MonitorSnapshot | null,
  feed: NarrativeCard[]
): SituationSummaryModel {
  const hostsCount = monitor?.by_host.rows.length ?? 0;
  const flowsCount = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
  const totalBytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;

  const diagnoses = monitor?.diagnoses ?? [];
  const primaryDiagnosis = diagnoses.length > 0 ? diagnoses[0]! : null;

  // Authoritative Domain Severity:
  // Zero client thresholding. If Rust provides a diagnosis, its severity directly sets overallHealth.
  let overallHealth: "healthy" | "notable" | "finding" = "healthy";
  let headline = "Network Operating Normally";
  let explanation = "";
  const recommendations: RecommendationItem[] = [];

  if (primaryDiagnosis) {
    overallHealth = primaryDiagnosis.severity === "finding" ? "finding" : "notable";
    headline = formatCauseHeadline(primaryDiagnosis.cause);
    explanation = primaryDiagnosis.explanation;

    const primaryEvidence = primaryDiagnosis.evidence.length > 0 ? primaryDiagnosis.evidence[0]! : undefined;
    recommendations.push({
      type: primaryDiagnosis.severity === "finding" ? "investigate" : "monitor",
      text: `Investigate ${formatCauseLabel(primaryDiagnosis.cause)} hypothesis (${primaryDiagnosis.confidence_percent}% confidence)`,
      actionText: "Inspect Evidence",
      evidenceRef: primaryEvidence,
    });
  } else {
    // Explicit Precedence: Feed Findings -> Feed Notables -> Nominal Traffic
    const findings = feed.filter((c) => c.severity === "finding");
    const notables = feed.filter((c) => c.severity === "notable");

    if (findings.length > 0) {
      overallHealth = "finding";
      headline = `Security / Protocol Finding — ${findings[0]!.headline}`;
      explanation = findings[0]!.summary || `${findings.length} security finding(s) detected.`;
      recommendations.push({
        type: "investigate",
        text: `Investigate ${findings[0]!.headline}`,
        actionText: "Review Finding",
        evidenceRef: findings[0]!.evidence.length > 0 ? findings[0]!.evidence[0] : undefined,
      });
    } else if (notables.length > 0) {
      overallHealth = "notable";
      headline = `Notable Activity — ${notables[0]!.headline}`;
      explanation = notables[0]!.summary || `${notables.length} notable event(s) observed.`;
      recommendations.push({
        type: "monitor",
        text: `Monitor ${notables[0]!.headline}`,
        actionText: "Review Event",
        evidenceRef: notables[0]!.evidence.length > 0 ? notables[0]!.evidence[0] : undefined,
      });
    } else {
      overallHealth = "healthy";
      headline = "Network Operating Normally";
      explanation = `${hostsCount} host${hostsCount === 1 ? "" : "s"} and ${flowsCount} active flow${
        flowsCount === 1 ? "" : "s"
      } observed across passive capture. Total volume transferred is ${humanBytes(totalBytes)}. No network degradation detected.`;
      recommendations.push({
        type: "ignore",
        text: "No action required — background traffic operating normally.",
      });
    }
  }

  // Highlights
  const highlights: string[] = [
    `${hostsCount} active hosts`,
    `${flowsCount} concurrent flows`,
    `${humanBytes(totalBytes)} transferred`,
  ];

  if (monitor?.network_loss_indicators && monitor.network_loss_indicators > 0) {
    highlights.push(`${monitor.network_loss_indicators} loss indicators detected`);
  }

  return {
    overallHealth,
    headline,
    explanation,
    highlights,
    recommendations,
  };
}
