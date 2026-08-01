import { useTranslation } from "react-i18next";
import type { AppsSummaryMetrics } from "../../hooks/useAppsController";

export interface AppsSummaryProps {
  metrics: AppsSummaryMetrics;
}

export function AppsSummary({ metrics }: AppsSummaryProps) {
  const { t } = useTranslation(["apps"]);

  return (
    <section aria-labelledby="apps-summary-title" style={{ marginBottom: "1.5rem" }}>
      <h2 id="apps-summary-title" className="np-sr-only">
        {t("title")} Summary KPIs
      </h2>
      <div
        className="np-apps-summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="np-kpi">
          <div className="np-kpi__label">{t("kpi_apps")}</div>
          <div className="np-kpi__value">{metrics.totalApps}</div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("kpi_flows")}</div>
          <div className="np-kpi__value">{metrics.totalFlows}</div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("kpi_confident")}</div>
          <div className="np-kpi__value" style={{ color: "#10b981" }}>
            {metrics.highConfidenceCount}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("kpi_unattributed")}</div>
          <div className="np-kpi__value" style={{ color: "var(--np-subtext, #94a3b8)" }}>
            {metrics.unattributedCount}
          </div>
        </div>
      </div>
    </section>
  );
}
