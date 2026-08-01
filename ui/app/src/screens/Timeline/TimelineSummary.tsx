import { useTranslation } from "react-i18next";
import type { TimelineSummaryMetrics } from "../../utils/timeline.utils";

export interface TimelineSummaryProps {
  metrics: TimelineSummaryMetrics;
}

export function TimelineSummary({ metrics }: TimelineSummaryProps) {
  const { t } = useTranslation(["timeline"]);

  return (
    <section aria-labelledby="timeline-summary-title" style={{ marginBottom: "1.5rem" }}>
      <h2 id="timeline-summary-title" className="np-sr-only">
        {t("title")} {t("summary_events")}
      </h2>
      <div
        className="np-timeline-summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="np-kpi">
          <div className="np-kpi__label">{t("summary_events")}</div>
          <div className="np-kpi__value">{metrics.totalEvents}</div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("summary_findings")}</div>
          <div className="np-kpi__value" style={{ color: "var(--np-danger, #ff5c7c)" }}>
            {metrics.findingsCount}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("summary_notable")}</div>
          <div className="np-kpi__value" style={{ color: "var(--np-warning, #ffb800)" }}>
            {metrics.notableCount}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">{t("summary_span")}</div>
          <div className="np-kpi__value">{metrics.timeSpanStr}</div>
        </div>
      </div>
    </section>
  );
}
