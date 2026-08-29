import { useTranslation } from "react-i18next";
import type { TimelineSummaryMetrics, SeverityFilter } from "../../utils/timeline.utils";

export interface TimelineSummaryProps {
  metrics: TimelineSummaryMetrics;
  activeSeverity?: SeverityFilter;
  onSelectSeverity?: (severity: SeverityFilter) => void;
}

export function TimelineSummary({
  metrics,
  activeSeverity = "all",
  onSelectSeverity,
}: TimelineSummaryProps) {
  const { t } = useTranslation(["timeline"]);

  const handleCardClick = (targetSev: SeverityFilter) => {
    if (!onSelectSeverity) return;
    if (activeSeverity === targetSev) {
      onSelectSeverity("all");
    } else {
      onSelectSeverity(targetSev);
    }
  };

  return (
    <section aria-labelledby="timeline-summary-title" style={{ marginBottom: "1.25rem" }}>
      <h2 id="timeline-summary-title" className="np-sr-only">
        {t("title")} {t("summary_events")}
      </h2>
      <div className="np-timeline-summary">
        {/* Total Events KPI Tile */}
        <button
          type="button"
          className="np-timeline-kpi"
          data-sev="all"
          data-active={activeSeverity === "all" ? "true" : "false"}
          onClick={() => handleCardClick("all")}
          aria-pressed={activeSeverity === "all"}
          aria-label={`${t("summary_events")}: ${metrics.totalEvents}. Click to show all events.`}
        >
          <div className="np-timeline-kpi__top">
            <span className="np-timeline-kpi__label">{t("summary_events")}</span>
            <span className="np-timeline-kpi__gem" data-sev="all" aria-hidden="true" />
          </div>
          <div className="np-timeline-kpi__value">{metrics.totalEvents}</div>
        </button>

        {/* Findings KPI Tile */}
        <button
          type="button"
          className="np-timeline-kpi"
          data-sev="finding"
          data-has-count={metrics.findingsCount > 0 ? "true" : "false"}
          data-active={activeSeverity === "finding" ? "true" : "false"}
          onClick={() => handleCardClick("finding")}
          aria-pressed={activeSeverity === "finding"}
          aria-label={`${t("summary_findings")}: ${metrics.findingsCount}. Click to filter by findings.`}
        >
          <div className="np-timeline-kpi__top">
            <span className="np-timeline-kpi__label">{t("summary_findings")}</span>
            <span className="np-timeline-kpi__gem" data-sev="finding" aria-hidden="true" />
          </div>
          <div className="np-timeline-kpi__value">{metrics.findingsCount}</div>
        </button>

        {/* Notable KPI Tile */}
        <button
          type="button"
          className="np-timeline-kpi"
          data-sev="notable"
          data-has-count={metrics.notableCount > 0 ? "true" : "false"}
          data-active={activeSeverity === "notable" ? "true" : "false"}
          onClick={() => handleCardClick("notable")}
          aria-pressed={activeSeverity === "notable"}
          aria-label={`${t("summary_notable")}: ${metrics.notableCount}. Click to filter by notable events.`}
        >
          <div className="np-timeline-kpi__top">
            <span className="np-timeline-kpi__label">{t("summary_notable")}</span>
            <span className="np-timeline-kpi__gem" data-sev="notable" aria-hidden="true" />
          </div>
          <div className="np-timeline-kpi__value">{metrics.notableCount}</div>
        </button>

        {/* Time Span KPI Tile */}
        <div
          className="np-timeline-kpi"
          data-sev="span"
          style={{ cursor: "default" }}
          aria-label={`${t("summary_span")}: ${metrics.timeSpanStr}`}
        >
          <div className="np-timeline-kpi__top">
            <span className="np-timeline-kpi__label">{t("summary_span")}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--np-text-mute, #8b9bb4)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="np-timeline-kpi__value">{metrics.timeSpanStr}</div>
        </div>
      </div>
    </section>
  );
}


