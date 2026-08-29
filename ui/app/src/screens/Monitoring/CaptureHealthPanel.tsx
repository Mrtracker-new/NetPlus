import { useTranslation } from "react-i18next";
import type { FormattedCaptureHealth } from "../../hooks/useMonitoringController";

export interface CaptureHealthPanelProps {
  health: FormattedCaptureHealth;
}

export function CaptureHealthPanel({ health }: CaptureHealthPanelProps) {
  const { t } = useTranslation(["monitoring"]);

  const severityColor =
    health.severity === "healthy"
      ? "var(--np-sem-nominal, #10b981)"
      : health.severity === "warning"
      ? "var(--np-sem-investigate, #f59e0b)"
      : "var(--np-sem-failure, #ef4444)";

  const severityBg =
    health.severity === "healthy"
      ? "var(--np-good-soft)"
      : health.severity === "warning"
      ? "var(--np-notable-soft)"
      : "var(--np-finding-soft)";

  return (
    <section className="np-capture-health-panel" aria-label={t("capture_health")}>
      <h3 className="np-capture-health-panel__title">{t("capture_health")}</h3>

      <div className="np-capture-health-wells">
        {/* Well 1: Buffer Usage & Inset Level Gauge */}
        <div className="np-capture-health-well">
          <div className="np-capture-health-well__header">
            <span>{t("buffer_usage")}</span>
            <span
              style={{
                fontFamily: "var(--np-font-mono)",
                fontSize: "11px",
                fontWeight: 700,
                color: severityColor,
              }}
            >
              {health.bufferPercent}%
            </span>
          </div>

          {/* Recessed Gauge Track */}
          <div className="np-capture-health-gauge-track">
            <div
              className="np-capture-health-gauge-fill"
              style={{
                width: `${Math.min(100, Math.max(2, health.bufferPercent))}%`,
                backgroundColor: severityColor,
              }}
            />
          </div>

          <div className="np-capture-health-well__sub">
            {t("buffer_frames", { used: health.bufferFrames, capacity: health.bufferCapacity })}
          </div>
        </div>

        {/* Well 2: Shedding Stage Indicator */}
        <div className="np-capture-health-well">
          <div className="np-capture-health-well__header">
            <span>{t("shedding_stage")}</span>
            <span
              style={{
                padding: "2px 7px",
                borderRadius: "var(--np-radius-pill)",
                fontSize: "9px",
                fontFamily: "var(--np-font-mono)",
                fontWeight: 700,
                textTransform: "uppercase",
                background: severityBg,
                color: severityColor,
              }}
            >
              {health.stage}
            </span>
          </div>

          <div className="np-capture-health-well__main">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: severityColor,
                fontSize: "0.95rem",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: severityColor,
                  display: "inline-block",
                }}
              />
              <span>{t(health.stageKey as any)}</span>
            </div>
          </div>

          <div className="np-capture-health-well__sub">
            Engine Dissection Mode
          </div>
        </div>

        {/* Well 3: Drop Count Metric */}
        <div className="np-capture-health-well">
          <div className="np-capture-health-well__header">
            <span>{t("drop_count")}</span>
            {health.drops > 0 ? (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: "var(--np-radius-pill)",
                  fontSize: "9px",
                  fontFamily: "var(--np-font-mono)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  background: "var(--np-finding-soft)",
                  color: "var(--np-sem-failure, #ef4444)",
                }}
              >
                Loss Detected
              </span>
            ) : (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: "var(--np-radius-pill)",
                  fontSize: "9px",
                  fontFamily: "var(--np-font-mono)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  background: "var(--np-good-soft)",
                  color: "var(--np-sem-nominal, #10b981)",
                }}
              >
                Zero Loss
              </span>
            )}
          </div>

          <div className="np-capture-health-well__main">
            <span
              className="np-capture-health-well__val"
              style={{
                color: health.drops > 0 ? "var(--np-sem-failure, #ef4444)" : "var(--np-text)",
              }}
            >
              {health.drops.toLocaleString()}
            </span>
          </div>

          <div className="np-capture-health-well__sub">
            {health.drops > 0 ? "Packets dropped due to buffer limit" : "Full packet capture fidelity"}
          </div>
        </div>
      </div>
    </section>
  );
}

