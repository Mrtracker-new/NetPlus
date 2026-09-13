import { useState, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@netpulse/components";
import type { DiagnosticSession, Diagnosis, Observation } from "../../diagnostic";
import { Icon } from "../../icons";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface DeepDiagnosticCardProps {
  session: DiagnosticSession;
  activeStage?: string | null;
}

const SEVERITY_COLORS: Record<string, { color: string; bg: string }> = {
  normal: { color: "var(--np-good)", bg: "var(--np-good-soft)" },
  elevated: { color: "var(--np-notable)", bg: "var(--np-notable-soft)" },
  severe: { color: "var(--np-finding)", bg: "var(--np-finding-soft)" },
};

const STAGES = [
  { id: "gateway", labelKey: "assessment.stages.gateway" as const },
  { id: "dns", labelKey: "assessment.stages.dns" as const },
  { id: "ping", labelKey: "assessment.stages.ping" as const },
  { id: "traceroute", labelKey: "assessment.stages.traceroute" as const },
  { id: "bufferbloat", labelKey: "assessment.stages.bufferbloat" as const },
  { id: "http", labelKey: "assessment.stages.http" as const },
];

function getProvenanceClass(source?: string) {
  const norm = (source ?? "").toLowerCase();
  switch (norm) {
    case "live":
      return "np-diagnostics-provenance--live";
    case "simulated":
      return "np-diagnostics-provenance--simulated";
    case "derived":
      return "np-diagnostics-provenance--derived";
    case "unavailable":
      return "np-diagnostics-provenance--unavailable";
    default:
      return "";
  }
}

export const DeepDiagnosticCard = memo(function DeepDiagnosticCard({ session, activeStage }: DeepDiagnosticCardProps) {
  const { t } = useTranslation(["diagnostics"]);
  const [showEvidence, setShowEvidence] = useState(false);

  const handleToggleEvidence = useCallback(() => {
    setShowEvidence((prev) => !prev);
  }, []);

  const diagnoses = session?.diagnoses ?? [];
  const observations = session?.observations ?? [];
  const recommendations = session?.recommendations ?? [];

  const topDiagnosis: Diagnosis | undefined = diagnoses[0];
  const severityStyle = topDiagnosis
    ? SEVERITY_COLORS[topDiagnosis.severity] ?? SEVERITY_COLORS.normal!
    : SEVERITY_COLORS.normal!;

  // Observation lookup
  const gatewayObs: Observation | undefined = observations.find(
    (o) => o.key === "gateway_reachability" || o.metricName?.toLowerCase().includes("gateway")
  );
  const dnsObs: Observation | undefined = observations.find(
    (o) => o.key === "dns_rtt" || o.key === "dns_resolution" || o.metricName?.toLowerCase().includes("dns")
  );
  const pingRttObs: Observation | undefined = observations.find(
    (o) =>
      o.key === "target_ping_rtt" ||
      o.key === "ping_rtt" ||
      (Boolean(o.metricName?.toLowerCase().includes("ping")) &&
        (Boolean(o.metricName?.toLowerCase().includes("latency")) || Boolean(o.metricName?.toLowerCase().includes("rtt")))) ||
      Boolean(o.metricName?.toLowerCase().includes("round-trip"))
  );
  const pingLossObs: Observation | undefined = observations.find(
    (o) => o.key === "target_packet_loss" || o.key === "packet_loss" || o.metricName?.toLowerCase().includes("loss")
  );
  const httpTtfbObs: Observation | undefined = observations.find(
    (o) =>
      o.key === "http_ttfb" ||
      o.key === "http_availability" ||
      Boolean(o.metricName?.toLowerCase().includes("ttfb")) ||
      Boolean(o.metricName?.toLowerCase().includes("time to first byte"))
  );
  const httpStatusObs: Observation | undefined = observations.find(
    (o) => o.key === "http_status_code" || o.key === "http_status" || o.metricName?.toLowerCase().includes("status")
  );

  const confidencePct = topDiagnosis ? Math.round((topDiagnosis.confidence ?? 1.0) * 100) : 100;

  const currentStageObj = STAGES.find((s) => s.id === activeStage);
  const activeStageLabel = currentStageObj
    ? t(currentStageObj.labelKey)
    : activeStage
    ? activeStage.toUpperCase()
    : t("assessment.status.analyzing");

  const gatewayIp =
    (gatewayObs?.rawDetails?.gatewayIp as string) ||
    (typeof gatewayObs?.value === "string"
      ? gatewayObs.value
      : gatewayObs?.value
      ? t("assessment.gateway.reachable", "Reachable")
      : t("assessment.gateway.unreachable", "Unreachable"));
  const interfaceName = gatewayObs?.rawDetails?.interfaceName as string | undefined;

  const dnsRtt = typeof dnsObs?.value === "number" ? dnsObs.value : null;
  const resolvedIps = (dnsObs?.rawDetails?.resolvedIps || gatewayObs?.rawDetails?.resolvedIps) as string[] | undefined;

  const httpStatusCode = typeof httpStatusObs?.value === "number" ? httpStatusObs.value : null;
  const httpTtfb = typeof httpTtfbObs?.value === "number" ? httpTtfbObs.value : null;
  const httpConnectMs = typeof httpTtfbObs?.rawDetails?.connectMs === "number" ? httpTtfbObs.rawDetails.connectMs : null;

  const pingRtt = typeof pingRttObs?.value === "number" ? pingRttObs.value : null;
  const pingLoss = typeof pingLossObs?.value === "number" ? pingLossObs.value : 0;
  const pingJitter = typeof pingRttObs?.rawDetails?.stddevRttMs === "number" ? pingRttObs.rawDetails.stddevRttMs : (typeof pingRttObs?.rawDetails?.jitterMs === "number" ? pingRttObs.rawDetails.jitterMs : 0);

  const isHttpPending =
    (!httpTtfbObs && !httpStatusObs) ||
    (httpStatusCode === null && httpTtfb === null && session?.status !== "completed");
  const httpSeverity =
    httpStatusCode !== null
      ? (httpStatusObs?.severity ?? "normal")
      : (httpTtfbObs?.severity ?? "normal");

  const isPingPending = !pingRttObs || (pingRtt === null && session?.status !== "completed");
  const pingSeverity =
    pingRttObs?.severity === "severe" || pingLossObs?.severity === "severe"
      ? "severe"
      : pingRttObs?.severity === "elevated" || pingLossObs?.severity === "elevated"
      ? "elevated"
      : "normal";

  const headingId = "deep-assessment-card-title";

  return (
    <article className="np-diagnostics-assessment" aria-labelledby={headingId}>
      {/* 1. Header: Session & Stage Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 id={headingId} style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--np-text)" }}>
            {t("assessment.title")}
          </h2>
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "var(--np-radius-pill)",
              fontSize: "0.7rem",
              fontWeight: 700,
              textTransform: "uppercase",
              background: session?.status === "completed" ? "var(--np-good-soft)" : "var(--np-accent-soft)",
              color: session?.status === "completed" ? "var(--np-good)" : "var(--np-accent-strong)",
              border: `1px solid ${session?.status === "completed" ? "var(--np-good)" : "var(--np-accent)"}`,
            }}
          >
            {session?.status === "completed"
              ? t("assessment.status.completed")
              : session?.status === "running"
              ? t("assessment.status.analyzing")
              : t("assessment.status.active")}
          </span>
        </div>

        <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
          {t("assessment.session_target", { session: session?.sessionId ?? 0, target: session?.target })}
        </span>
      </div>

      {/* Progressive Stage Stepper rendered from domain session */}
      {(() => {
        const stageIdx = activeStage ? STAGES.findIndex((s) => s.id === activeStage) : -1;
        const currentStageIndex = session?.status === "completed" ? STAGES.length : stageIdx >= 0 ? stageIdx : 0;
        return (
          <div
            className="np-diagnostics-pipeline-stepper"
            role="progressbar"
            aria-label={t("assessment.pipeline_progress", "Diagnostic pipeline progress")}
            aria-valuemin={0}
            aria-valuemax={STAGES.length}
            aria-valuenow={currentStageIndex}
          >
            {STAGES.map((s, idx) => {
              const isCurrent = session?.status !== "completed" && activeStage === s.id;
              const isPast =
                session?.status === "completed" ||
                (stageIdx >= 0 && stageIdx > idx);

              return (
                <div
                  key={s.id}
                  className={`np-diagnostics-step ${
                    isPast
                      ? "np-diagnostics-step--complete"
                      : isCurrent
                      ? "np-diagnostics-step--running"
                      : ""
                  }`}
                >
                  <Icon
                    name={isPast ? "check" : isCurrent ? "activity" : "circleDot"}
                    style={{ width: "12px", height: "12px" }}
                  />
                  <span>{t(s.labelKey)}</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 2. Primary Diagnosis (or In-Flight Analysis, or No Bottleneck Detected) */}
      {session?.status === "running" ? (
        <div className="np-diagnostics-finding-banner np-diagnostics-finding-banner--analyzing" data-testid="deep-diagnostics-analyzing-banner">
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span
                className="np-diagnostics-step--running"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "var(--np-radius-pill)",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  background: "var(--np-accent-soft)",
                  color: "var(--np-accent-strong)",
                  border: "1px solid var(--np-accent)",
                }}
              >
                <Icon name="activity" style={{ width: "12px", height: "12px" }} />
                <span>{activeStageLabel}</span>
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: "var(--np-accent-strong)",
                  letterSpacing: "0.5px",
                }}
              >
                {t("assessment.status.analyzing")}
              </span>
            </div>
            <h3 className="np-diagnostics-finding-title">
              {t("assessment.in_flight_title", "In-Flight Analysis")}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
              <Skeleton variant="text" width="75%" height="16px" />
              <Skeleton variant="text" width="55%" height="14px" />
            </div>
          </div>

          <div className="np-diagnostics-confidence-meter" style={{ minWidth: "120px" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)", fontWeight: 600 }}>
              {t("assessment.evaluating_evidence", "Evaluating Evidence...")}
            </span>
            <Skeleton variant="rounded" width="60px" height="24px" style={{ margin: "4px 0" }} />
            <Skeleton variant="rounded" width="100px" height="6px" />
          </div>
        </div>
      ) : topDiagnosis ? (
        <div className="np-diagnostics-finding-banner">
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
              <span
                style={{
                  padding: "0.2rem 0.6rem",
                  borderRadius: "var(--np-radius-pill)",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  background: severityStyle.bg,
                  color: severityStyle.color,
                  border: `1px solid ${severityStyle.color}`,
                }}
              >
                {t("assessment.categories." + topDiagnosis.category.toLowerCase(), topDiagnosis.category)}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: severityStyle.color,
                }}
              >
                {t("assessment.severity." + topDiagnosis.severity, topDiagnosis.severity)}
              </span>
            </div>
            <h3 className="np-diagnostics-finding-title">{t(topDiagnosis.summary, topDiagnosis.summary)}</h3>
            <p className="np-diagnostics-finding-desc">{t(topDiagnosis.explanation, topDiagnosis.explanation)}</p>
          </div>

          <div className="np-diagnostics-confidence-meter">
            <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)", fontWeight: 600 }}>
              {t("assessment.confidence_score")}
            </span>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, fontFamily: "var(--np-font-mono)", color: severityStyle.color }}>
              {confidencePct}%
            </div>
            <div className="np-diagnostics__latency-bar" style={{ width: "100px", height: "6px" }}>
              <div
                className="np-diagnostics__latency-fill"
                style={{ width: `${confidencePct}%`, background: severityStyle.color }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="np-diagnostics-no-bottleneck">
          <Icon name="check" style={{ width: "20px", height: "20px", color: "var(--np-good)", flexShrink: 0 }} />
          <div>
            <h3 style={{ margin: "0 0 0.2rem 0", fontSize: "0.95rem", fontWeight: 700, color: "var(--np-good)" }}>
              {t("assessment.no_bottleneck_title")}
            </h3>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--np-text-dim)" }}>
              {t("assessment.no_bottleneck_desc")}
            </p>
          </div>
        </div>
      )}

      {/* 3. Evidence (Supporting & Contradicting) */}
      {topDiagnosis?.evidence && topDiagnosis.evidence.length > 0 && (
        <div>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem" }}
            onClick={handleToggleEvidence}
            aria-expanded={showEvidence}
            aria-controls="deep-diagnostics-evidence-list"
          >
            <Icon
              name="chevronRight"
              style={{
                width: "14px",
                height: "14px",
                transform: showEvidence ? "rotate(90deg)" : "none",
                transition: "transform 0.2s",
              }}
            />
            {showEvidence
              ? t("assessment.hide_evidence")
              : t("assessment.view_evidence", { count: topDiagnosis.evidence.length })}
          </button>

          {showEvidence && (
            <div
              id="deep-diagnostics-evidence-list"
              style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}
            >
              {topDiagnosis.evidence.map((ev, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.4rem 0.75rem",
                    borderRadius: "var(--np-radius-sm)",
                    background: "var(--np-surface-2)",
                    border: "1px solid var(--np-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "0.1rem 0.35rem",
                        borderRadius: "var(--np-radius-pill)",
                        background: ev.role === "corroborating" ? "var(--np-good-soft)" : "var(--np-finding-soft)",
                        color: ev.role === "corroborating" ? "var(--np-good)" : "var(--np-finding)",
                      }}
                    >
                      {t("assessment.evidence_role." + ev.role, ev.role)}
                    </span>
                    <span style={{ color: "var(--np-text)" }}>{ev.explanation}</span>
                  </div>
                  <span style={{ fontFamily: "var(--np-font-mono)", fontWeight: 600, color: "var(--np-accent-strong)", flexShrink: 0 }}>
                    {t("assessment.weight", { weight: Math.round(ev.weight * 100) })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. Observations Grid with Direct Domain Provenance and Units */}
      <div className="np-diagnostics-observations-grid">
        {/* Gateway Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">
              {t("assessment.observations.gateway", "Default Gateway")}
            </span>
            <span
              className={`np-diagnostics-provenance ${gatewayObs?.source ? getProvenanceClass(gatewayObs.source) : ""}`}
              data-provenance={gatewayObs?.source ? gatewayObs.source : "pending"}
            >
              {gatewayObs?.source ? t(`provenance.${gatewayObs.source.toLowerCase()}`, gatewayObs.source.toUpperCase()) : t("provenance.pending", "PENDING")}
            </span>
          </div>
          <div
            className="np-diagnostics-observation-card__metric"
            style={{
              color: !gatewayObs || (gatewayObs.value === null && session?.status !== "completed")
                ? "var(--np-text-dim)"
                : gatewayObs.severity === "normal"
                ? "var(--np-good)"
                : "var(--np-finding)",
            }}
          >
            {!gatewayObs || (gatewayObs.value === null && session?.status !== "completed")
              ? t("assessment.pending", "Pending...")
              : gatewayIp}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {gatewayObs && (gatewayObs.value !== null || session?.status === "completed")
              ? (gatewayObs?.limitation || (interfaceName ? t("assessment.gateway.interface", { name: interfaceName }) : t("assessment.gateway.direct_route", "Direct default route")))
              : t("assessment.gateway.discovering", "Discovering default route...")}
          </span>
        </div>

        {/* DNS Resolver Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">
              {t("assessment.observations.dns", "DNS Resolution")}
            </span>
            <span
              className={`np-diagnostics-provenance ${dnsObs?.source ? getProvenanceClass(dnsObs.source) : ""}`}
              data-provenance={dnsObs?.source ? dnsObs.source : "pending"}
            >
              {dnsObs?.source ? t(`provenance.${dnsObs.source.toLowerCase()}`, dnsObs.source.toUpperCase()) : t("provenance.pending", "PENDING")}
            </span>
          </div>
          <div
            className="np-diagnostics-observation-card__metric"
            style={{
              color: !dnsObs || (dnsObs.value === null && session?.status !== "completed")
                ? "var(--np-text-dim)"
                : dnsObs.severity === "normal"
                ? "var(--np-good)"
                : "var(--np-finding)",
            }}
          >
            {!dnsObs
              ? t("assessment.pending", "Pending...")
              : dnsRtt !== null
              ? `${formatMs(dnsRtt)} ${dnsObs.unit ?? "ms"}`
              : dnsObs.value === null && session?.status === "completed"
              ? dnsObs.limitation || t("assessment.timed_out", "Timed Out")
              : t("assessment.pending", "Pending...")}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dnsObs
              ? resolvedIps && resolvedIps.length > 0
                ? resolvedIps.slice(0, 2).join(", ")
                : session?.status === "completed"
                ? dnsObs.limitation || t("assessment.dns.system_resolver", "System resolver")
                : t("assessment.dns.awaiting", "Awaiting DNS query...")
              : t("assessment.dns.awaiting", "Awaiting DNS query...")}
          </span>
        </div>

        {/* HTTP Web Probe Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">
              {t("assessment.observations.http", "HTTP Web Probe")}
            </span>
            <span
              className={`np-diagnostics-provenance ${httpTtfbObs?.source ? getProvenanceClass(httpTtfbObs.source) : ""}`}
              data-provenance={httpTtfbObs?.source ? httpTtfbObs.source : "pending"}
            >
              {httpTtfbObs?.source ? t(`provenance.${httpTtfbObs.source.toLowerCase()}`, httpTtfbObs.source.toUpperCase()) : t("provenance.pending", "PENDING")}
            </span>
          </div>
          <div
            className="np-diagnostics-observation-card__metric"
            style={{
              color: isHttpPending
                ? "var(--np-text-dim)"
                : httpSeverity === "normal"
                ? "var(--np-good)"
                : "var(--np-finding)",
            }}
          >
            {httpTtfbObs || httpStatusObs
              ? httpStatusCode
                ? `HTTP ${httpStatusCode}`
                : httpTtfb !== null
                ? `${formatMs(httpTtfb)} ${httpTtfbObs?.unit ?? "ms"}`
                : session?.status === "completed"
                ? httpTtfbObs?.limitation || t("assessment.unavailable", "Unavailable")
                : t("assessment.pending", "Pending...")
              : t("assessment.pending", "Pending...")}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {httpTtfbObs || httpStatusObs
              ? httpConnectMs !== null && httpTtfb !== null
                ? t("assessment.http.connect_ttfb", { connect: formatMs(httpConnectMs), ttfb: formatMs(httpTtfb) })
                : httpConnectMs !== null
                ? t("assessment.http.connect_only", { connect: formatMs(httpConnectMs) })
                : httpTtfb !== null
                ? t("assessment.http.ttfb_only", { ttfb: formatMs(httpTtfb) })
                : session?.status === "completed"
                ? httpTtfbObs?.limitation || httpStatusObs?.limitation || t("assessment.http.bounded", "Bounded connection")
                : t("assessment.http.awaiting", "Awaiting HTTP response...")
              : t("assessment.http.awaiting", "Awaiting HTTP response...")}
          </span>
        </div>

        {/* Latency & Loss Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">
              {t("assessment.observations.latency", "Round-Trip Latency")}
            </span>
            <span
              className={`np-diagnostics-provenance ${pingRttObs?.source ? getProvenanceClass(pingRttObs.source) : ""}`}
              data-provenance={pingRttObs?.source ? pingRttObs.source : "pending"}
            >
              {pingRttObs?.source ? t(`provenance.${pingRttObs.source.toLowerCase()}`, pingRttObs.source.toUpperCase()) : t("provenance.pending", "PENDING")}
            </span>
          </div>
          <div
            className="np-diagnostics-observation-card__metric"
            style={{
              color: isPingPending
                ? "var(--np-text-dim)"
                : pingSeverity === "normal"
                ? "var(--np-good)"
                : "var(--np-finding)",
            }}
          >
            {isPingPending
              ? t("assessment.pending", "Pending...")
              : pingRtt !== null
              ? `${formatMs(pingRtt)} ${pingRttObs?.unit ?? "ms"}`
              : session?.status === "completed"
              ? t("assessment.timed_out", "Timed Out")
              : t("assessment.pending", "Pending...")}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {pingRttObs && pingRtt !== null
              ? t("assessment.latency.loss_jitter", { loss: pingLoss, jitter: formatMs(pingJitter) })
              : session?.status === "completed" && pingRttObs
              ? t("assessment.latency.loss_jitter", { loss: pingLoss, jitter: formatMs(pingJitter) })
              : t("assessment.latency.awaiting", "Awaiting ICMP samples...")}
          </span>
        </div>
      </div>

      {/* 5. Authoritative Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", fontWeight: 700, color: "var(--np-text)" }}>
            {t("assessment.remediations_title")}
          </h4>
          <div className="np-diagnostics-remediation-list">
            {recommendations.map((rec, i) => (
              <div key={i} className="np-diagnostics-remediation-item">
                <Icon
                  name={rec.priority === "high" ? "alertTriangle" : "alertCircle"}
                  style={{
                    width: "16px",
                    height: "16px",
                    color: rec.priority === "high" ? "var(--np-finding)" : "var(--np-accent)",
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "var(--np-text)" }}>
                    {rec.titleKey ? t(rec.titleKey, rec.title) : t(rec.title, rec.title)}
                  </div>
                  <div style={{ color: "var(--np-text-dim)", fontSize: "0.8rem" }}>
                    {rec.descriptionKey ? t(rec.descriptionKey, rec.description) : t(rec.description, rec.description)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
});
