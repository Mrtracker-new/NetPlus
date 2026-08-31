import { useState } from "react";
import { useTranslation } from "react-i18next";
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

export function DeepDiagnosticCard({ session, activeStage }: DeepDiagnosticCardProps) {
  const { t } = useTranslation(["diagnostics"]);
  const [showEvidence, setShowEvidence] = useState(false);

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
    (o) => o.key === "target_ping_rtt" || o.key === "ping_rtt" || o.metricName?.toLowerCase().includes("latency") || o.metricName?.toLowerCase().includes("rtt")
  );
  const pingLossObs: Observation | undefined = observations.find(
    (o) => o.key === "target_packet_loss" || o.key === "packet_loss" || o.metricName?.toLowerCase().includes("loss")
  );
  const httpTtfbObs: Observation | undefined = observations.find(
    (o) => o.key === "http_ttfb" || o.key === "http_availability" || o.metricName?.toLowerCase().includes("http")
  );
  const httpStatusObs: Observation | undefined = observations.find(
    (o) => o.key === "http_status_code" || o.key === "http_status" || o.metricName?.toLowerCase().includes("status")
  );

  const confidencePct = topDiagnosis ? Math.round((topDiagnosis.confidence ?? 1.0) * 100) : 100;

  const gatewayIp = (gatewayObs?.rawDetails?.gatewayIp as string) || (typeof gatewayObs?.value === "string" ? gatewayObs.value : gatewayObs?.value ? "Reachable" : "Unreachable");
  const interfaceName = gatewayObs?.rawDetails?.interfaceName as string | undefined;

  const dnsRtt = typeof dnsObs?.value === "number" ? dnsObs.value : null;
  const resolvedIps = (gatewayObs?.rawDetails?.resolvedIps || dnsObs?.rawDetails?.resolvedIps) as string[] | undefined;

  const httpStatusCode = typeof httpStatusObs?.value === "number" ? httpStatusObs.value : null;
  const httpTtfb = typeof httpTtfbObs?.value === "number" ? httpTtfbObs.value : null;
  const httpConnectMs = typeof httpTtfbObs?.rawDetails?.connectMs === "number" ? httpTtfbObs.rawDetails.connectMs : null;

  const pingRtt = typeof pingRttObs?.value === "number" ? pingRttObs.value : null;
  const pingLoss = typeof pingLossObs?.value === "number" ? pingLossObs.value : 0;
  const pingJitter = typeof pingRttObs?.rawDetails?.jitterMs === "number" ? pingRttObs.rawDetails.jitterMs : (typeof pingRttObs?.rawDetails?.stddevRttMs === "number" ? pingRttObs.rawDetails.stddevRttMs : 0);

  return (
    <article className="np-diagnostics-assessment" aria-label={t("assessment.title")}>
      {/* 1. Header: Session & Stage Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--np-text)" }}>
            {t("assessment.title")}
          </h3>
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
      <div className="np-diagnostics-pipeline-stepper" role="progressbar" aria-label="Diagnostic pipeline progress">
        {STAGES.map((s, idx) => {
          const isCurrent = activeStage === s.id;
          const isPast =
            session?.status === "completed" ||
            (activeStage
              ? STAGES.findIndex((x) => x.id === activeStage) > idx
              : false);

          return (
            <div
              key={s.id}
              className={`np-diagnostics-step ${
                isCurrent
                  ? "np-diagnostics-step--running"
                  : isPast
                  ? "np-diagnostics-step--complete"
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

      {/* 2. Primary Diagnosis (or No Bottleneck Detected) */}
      {topDiagnosis ? (
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
                {topDiagnosis.category}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  color: severityStyle.color,
                }}
              >
                {topDiagnosis.severity}
              </span>
            </div>
            <h4 className="np-diagnostics-finding-title">{topDiagnosis.summary}</h4>
            <p className="np-diagnostics-finding-desc">{topDiagnosis.explanation}</p>
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
            <h4 style={{ margin: "0 0 0.2rem 0", fontSize: "0.95rem", fontWeight: 700, color: "var(--np-good)" }}>
              {t("assessment.no_bottleneck_title")}
            </h4>
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
            onClick={() => setShowEvidence((prev) => !prev)}
            aria-expanded={showEvidence}
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
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
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
                      {ev.role}
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
            <span className="np-diagnostics-observation-card__title">Default Gateway</span>
            <span
              className={`np-diagnostics-provenance ${getProvenanceClass(gatewayObs?.source)}`}
              data-provenance={gatewayObs?.source ?? "unavailable"}
            >
              {gatewayObs?.source ?? "UNAVAILABLE"}
            </span>
          </div>
          <div className="np-diagnostics-observation-card__metric">
            {gatewayIp}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {gatewayObs?.limitation || (interfaceName ? `Interface: ${interfaceName}` : "Direct default route")}
          </span>
        </div>

        {/* DNS Resolver Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">DNS Resolution</span>
            <span
              className={`np-diagnostics-provenance ${getProvenanceClass(dnsObs?.source)}`}
              data-provenance={dnsObs?.source ?? "live"}
            >
              {dnsObs?.source ?? "LIVE"}
            </span>
          </div>
          <div
            className="np-diagnostics-observation-card__metric"
            style={{ color: dnsObs?.severity === "normal" ? "var(--np-good)" : "var(--np-finding)" }}
          >
            {dnsRtt !== null ? `${formatMs(dnsRtt)} ${dnsObs?.unit ?? "ms"}` : (dnsObs?.limitation || "Timed Out")}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {resolvedIps && resolvedIps.length > 0 ? resolvedIps.slice(0, 2).join(", ") : (dnsObs?.limitation || "System resolver")}
          </span>
        </div>

        {/* HTTP Web Probe Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">HTTP Web Probe</span>
            <span
              className={`np-diagnostics-provenance ${getProvenanceClass(httpTtfbObs?.source)}`}
              data-provenance={httpTtfbObs?.source ?? "live"}
            >
              {httpTtfbObs?.source ?? "LIVE"}
            </span>
          </div>
          <div className="np-diagnostics-observation-card__metric">
            {httpStatusCode ? `HTTP ${httpStatusCode}` : httpTtfb !== null ? `${formatMs(httpTtfb)} ${httpTtfbObs?.unit ?? "ms"}` : (httpTtfbObs?.limitation || "Unavailable")}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {httpConnectMs !== null ? `Connect: ${formatMs(httpConnectMs)}ms · TTFB: ${formatMs(httpTtfb ?? 0)}ms` : (httpTtfbObs?.limitation || "Bounded connection")}
          </span>
        </div>

        {/* Latency & Loss Card */}
        <div className="np-diagnostics-observation-card">
          <div className="np-diagnostics-observation-card__header">
            <span className="np-diagnostics-observation-card__title">Round-Trip Latency</span>
            <span
              className={`np-diagnostics-provenance ${getProvenanceClass(pingRttObs?.source)}`}
              data-provenance={pingRttObs?.source ?? "simulated"}
            >
              {pingRttObs?.source ?? "SIMULATED"}
            </span>
          </div>
          <div className="np-diagnostics-observation-card__metric">
            {pingRtt !== null ? `${formatMs(pingRtt)} ${pingRttObs?.unit ?? "ms"}` : "—"}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            Loss: {pingLoss}% · Jitter: {formatMs(pingJitter)}ms
          </span>
        </div>
      </div>

      {/* 5. Authoritative Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <h5 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", fontWeight: 700, color: "var(--np-text)" }}>
            {t("assessment.remediations_title")}
          </h5>
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
                  <div style={{ fontWeight: 600, color: "var(--np-text)" }}>{rec.title}</div>
                  <div style={{ color: "var(--np-text-dim)", fontSize: "0.8rem" }}>{rec.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
