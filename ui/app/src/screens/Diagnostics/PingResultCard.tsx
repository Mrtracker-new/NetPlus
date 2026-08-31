import { useTranslation } from "react-i18next";
import { formatMs, type ExtendedPingResult } from "../../hooks/useDiagnosticsController";

export interface PingResultCardProps {
  result: ExtendedPingResult;
}

export function PingResultCard({ result }: PingResultCardProps) {
  const { t } = useTranslation(["diagnostics"]);

  const lossPct = Math.round((result.lossPct ?? 0) * 10) / 10;
  const avgRttStr = formatMs(result.avgRttMs ?? 0);
  const minRttStr = formatMs(result.minRttMs ?? 0);
  const maxRttStr = formatMs(result.maxRttMs ?? 0);
  const jitterStr = formatMs(result.jitterMs ?? 0);

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

  return (
    <article className="np-diagnostics__result" aria-label={t("ping.title", { target: result.target })}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("ping.title", { target: result.target })}
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {result.source && (
            <span
              className={`np-diagnostics-provenance ${provenanceClass}`}
              data-provenance={result.source}
            >
              {result.source}
            </span>
          )}
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
          <div className="np-diagnostics-kpi-pod__value" style={{ color: "var(--np-accent-strong)" }}>
            {avgRttStr}ms
          </div>
        </div>

        <div className="np-diagnostics-kpi-pod">
          <div className="np-diagnostics-kpi-pod__label">{t("ping.jitter")}</div>
          <div className="np-diagnostics-kpi-pod__value" style={{ color: "var(--np-notable)" }}>
            {jitterStr}ms
          </div>
        </div>
      </div>

      {/* Level 3 Recessed Telemetry Breakdown Strip */}
      <div className="np-diagnostics-telemetry-strip">
        <span>{t("ping.rtt_min", { min: minRttStr })}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{t("ping.rtt_avg", { avg: avgRttStr })}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{t("ping.rtt_max", { max: maxRttStr })}</span>
      </div>
    </article>
  );
}
