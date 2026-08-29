import { useTranslation } from "react-i18next";
import type { AppsSummaryMetrics, ConfidenceFilterOption } from "../../hooks/useAppsController";

export interface AppsSummaryProps {
  metrics: AppsSummaryMetrics;
  activeConfidence?: ConfidenceFilterOption;
  onSelectConfidence?: (option: ConfidenceFilterOption) => void;
}

export function AppsSummary({
  metrics,
  activeConfidence = "all",
  onSelectConfidence,
}: AppsSummaryProps) {
  const { t } = useTranslation(["apps"]);

  const handleCardClick = (targetOption: ConfidenceFilterOption) => {
    if (!onSelectConfidence) return;
    if (targetOption === "all") {
      onSelectConfidence("all");
    } else if (activeConfidence === targetOption) {
      onSelectConfidence("all");
    } else {
      onSelectConfidence(targetOption);
    }
  };

  return (
    <section aria-labelledby="apps-summary-title" className="np-apps__header">
      <h2 id="apps-summary-title" className="np-sr-only">
        {t("title")} Summary KPIs
      </h2>
      <div className="np-apps-summary">
        {/* Attributed Apps Total Tile */}
        <button
          type="button"
          className="np-apps-kpi"
          data-tier="all"
          data-active={activeConfidence === "all"}
          onClick={() => handleCardClick("all")}
          aria-pressed={activeConfidence === "all"}
          aria-label={`${t("kpi_apps")}: ${metrics.totalApps}. Click to show all applications.`}
        >
          <div className="np-apps-kpi__top">
            <span className="np-apps-kpi__label">{t("kpi_apps")}</span>
            <span className="np-apps-kpi__gem" data-tier="all" aria-hidden="true" />
          </div>
          <div className="np-apps-kpi__value">{metrics.totalApps}</div>
        </button>

        {/* Active Flows Total Tile */}
        <button
          type="button"
          className="np-apps-kpi"
          data-tier="flows"
          data-active={false}
          onClick={() => handleCardClick("all")}
          aria-pressed={false}
          aria-label={`${t("kpi_flows")}: ${metrics.totalFlows}. Click to reset confidence filter.`}
        >
          <div className="np-apps-kpi__top">
            <span className="np-apps-kpi__label">{t("kpi_flows")}</span>
            <span className="np-apps-kpi__gem" data-tier="flows" aria-hidden="true" />
          </div>
          <div className="np-apps-kpi__value">{metrics.totalFlows}</div>
        </button>

        {/* High Confidence Tile */}
        <button
          type="button"
          className="np-apps-kpi"
          data-tier="high"
          data-has-count={metrics.highConfidenceCount > 0}
          data-active={activeConfidence === "high"}
          onClick={() => handleCardClick("high")}
          aria-pressed={activeConfidence === "high"}
          aria-label={`${t("kpi_confident")}: ${metrics.highConfidenceCount}. Click to filter by high confidence.`}
        >
          <div className="np-apps-kpi__top">
            <span className="np-apps-kpi__label">{t("kpi_confident")}</span>
            <span className="np-apps-kpi__gem" data-tier="high" aria-hidden="true" />
          </div>
          <div className="np-apps-kpi__value">{metrics.highConfidenceCount}</div>
        </button>

        {/* Unattributed / Unknown Owner Tile */}
        <button
          type="button"
          className="np-apps-kpi"
          data-tier="unknown"
          data-has-count={metrics.unattributedCount > 0}
          data-active={activeConfidence === "unknown"}
          onClick={() => handleCardClick("unknown")}
          aria-pressed={activeConfidence === "unknown"}
          title={t("unattributed_hint")}
          aria-label={`${t("kpi_unattributed")}: ${metrics.unattributedCount} (${t("unattributed_hint")}). Click to filter by unknown owner.`}
        >
          <div className="np-apps-kpi__top">
            <span className="np-apps-kpi__label">{t("kpi_unattributed")}</span>
            <span className="np-apps-kpi__gem" data-tier="unknown" aria-hidden="true" />
          </div>
          <div className="np-apps-kpi__value">{metrics.unattributedCount}</div>
        </button>
      </div>
    </section>
  );
}

