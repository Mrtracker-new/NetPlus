import { useTranslation } from "react-i18next";
import type { FormattedCaptureHealth } from "../../hooks/useMonitoringController";

export interface CaptureHealthPanelProps {
  health: FormattedCaptureHealth;
}

export function CaptureHealthPanel({ health }: CaptureHealthPanelProps) {
  const { t } = useTranslation(["monitoring"]);

  const stageColor =
    health.severity === "healthy"
      ? "#10b981"
      : health.severity === "warning"
      ? "#f59e0b"
      : "#ef4444";

  return (
    <section className="np-panel np-capture-health" aria-label={t("capture_health")}>
      <h3 className="np-panel__title">{t("capture_health")}</h3>
      <div className="np-kpis">
        <div className="np-kpi">
          <div className="np-kpi__label">{t("buffer_usage")}</div>
          <div className="np-kpi__value">{health.bufferPercent}%</div>
          <div style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", marginTop: "2px" }}>
            {t("buffer_frames", { used: health.bufferFrames, capacity: health.bufferCapacity })}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("shedding_stage")}</div>
          <div
            className="np-kpi__value"
            style={{
              color: stageColor,
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: stageColor,
                display: "inline-block",
              }}
            />
            {t(health.stageKey as any)}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("drop_count")}</div>
          <div className="np-kpi__value" style={{ color: health.drops > 0 ? "#ef4444" : "inherit" }}>
            {health.drops}
          </div>
        </div>
      </div>
    </section>
  );
}
