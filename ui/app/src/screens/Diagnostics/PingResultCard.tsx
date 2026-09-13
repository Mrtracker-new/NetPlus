import { memo } from "react";
import { useTranslation } from "react-i18next";
import { formatMs, type ExtendedPingResult } from "../../hooks/useDiagnosticsController";

export interface PingResultCardProps {
  result: ExtendedPingResult;
}

export function getJitterColor(jitterMs: number, isUnreachable = false): string {
  if (isUnreachable) return "var(--np-text-dim)";
  const val = isNaN(jitterMs) ? 0 : jitterMs;
  if (val < 5) return "var(--np-good)";
  if (val < 20) return "var(--np-notable)";
  return "var(--np-finding)";
}

export const PingResultCard = memo(function PingResultCard({ result }: PingResultCardProps) {
  const { t } = useTranslation(["diagnostics"]);

  const isUnreachable = (result.received ?? 0) === 0 && (result.sent ?? 0) > 0;
  const lossPct = Math.round((result.lossPct ?? 0) * 10) / 10;
  const avgRttStr = formatMs(result.avgRttMs ?? 0);
  const minRttStr = formatMs(result.minRttMs ?? 0);
  const maxRttStr = formatMs(result.maxRttMs ?? 0);
  const jitterStr = formatMs(result.jitterMs ?? 0);
  const jitterColor = getJitterColor(Number(result.jitterMs ?? 0), isUnreachable);

  const sourceNormalized = (result.source ?? "").toLowerCase();
  const provenanceClass =
    sourceNormalized === "live"
      ? "np-diagnostics-provenance--live"
      : sourceNormalized === "simulated"
      ? "np-diagnostics-provenance--simulated"
      : sourceNormalized === "derived"
      ? "np-diagnostics-provenance--derived"
      : sourceNormalized === "unavailable"
      ? "np-diagnostics-provenance--unavailable"
      : "";

  const headingId = "ping-result-heading";

  return (
    <article className="np-diagnostics__result" aria-labelledby={headingId}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("ping.title", { target: result.target })}
        </h2>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {result.source ? (
            <span
              className={`np-diagnostics-provenance ${provenanceClass}`.trim()}
              data-provenance={sourceNormalized}
            >
              {result.source}
            </span>
          ) : null}
        </div>
      </div>

      {/* Level 3 Recessed KPI Grid */}
      <div className="np-diagnostics-kpi-grid">
        <div className="np-diagnostics-kpi-pod">
          <div className="np-diagnostics-kpi-pod__label">{t("ping.sent_received")}</div>
          <div className="np-diagnostics-kpi-pod__value">
            {result.sent} / {result.received}
          </div>
        </div>

        <div className="np-diagnostics-kpi-pod">
          <div className="np-diagnostics-kpi-pod__label">{t("ping.packet_loss")}</div>
          <div
            className="np-diagnostics-kpi-pod__value"
            style={{ color: lossPct > 0 ? "var(--np-finding)" : "var(--np-good)" }}
          >
            {lossPct}%
          </div>
        </div>

        <div className="np-diagnostics-kpi-pod">
          <div className="np-diagnostics-kpi-pod__label">{t("ping.avg_rtt")}</div>
          <div
            className="np-diagnostics-kpi-pod__value"
            style={{ color: isUnreachable ? "var(--np-text-dim)" : "var(--np-accent-strong)" }}
          >
            {isUnreachable ? "—" : `${avgRttStr}ms`}
          </div>
        </div>

        <div className="np-diagnostics-kpi-pod">
          <div className="np-diagnostics-kpi-pod__label">{t("ping.jitter")}</div>
          <div className="np-diagnostics-kpi-pod__value" style={{ color: jitterColor }}>
            {isUnreachable ? "—" : `${jitterStr}ms`}
          </div>
        </div>
      </div>

      {/* Level 3 Recessed Telemetry Breakdown Strip */}
      <div className="np-diagnostics-telemetry-strip">
        <span>{t("ping.rtt_min", { min: isUnreachable ? "—" : minRttStr })}</span>
        <span style={{ opacity: 0.4 }} aria-hidden="true">·</span>
        <span>{t("ping.rtt_avg", { avg: isUnreachable ? "—" : avgRttStr })}</span>
        <span style={{ opacity: 0.4 }} aria-hidden="true">·</span>
        <span>{t("ping.rtt_max", { max: isUnreachable ? "—" : maxRttStr })}</span>
      </div>
    </article>
  );
});
