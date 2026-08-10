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
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1rem",
        }}
      >
        {/* Total Events */}
        <div
          className="np-kpi"
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span className="np-kpi__label" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--np-muted, #8b9bb4)" }}>
              {t("summary_events")}
            </span>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--np-accent, #2fe0d6)" }} />
          </div>
          <div className="np-kpi__value" style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--np-text, #e2e8f0)" }}>
            {metrics.totalEvents}
          </div>
        </div>

        {/* Findings KPI */}
        <div
          className="np-kpi"
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: metrics.findingsCount > 0 ? "1px solid rgba(255, 92, 124, 0.3)" : "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span className="np-kpi__label" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--np-muted, #8b9bb4)" }}>
              {t("summary_findings")}
            </span>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--np-danger, #ff5c7c)" }} />
          </div>
          <div className="np-kpi__value" style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--np-danger, #ff5c7c)" }}>
            {metrics.findingsCount}
          </div>
        </div>

        {/* Notable KPI */}
        <div
          className="np-kpi"
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: metrics.notableCount > 0 ? "1px solid rgba(255, 184, 0, 0.3)" : "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span className="np-kpi__label" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--np-muted, #8b9bb4)" }}>
              {t("summary_notable")}
            </span>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--np-warning, #ffb800)" }} />
          </div>
          <div className="np-kpi__value" style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--np-warning, #ffb800)" }}>
            {metrics.notableCount}
          </div>
        </div>

        {/* Time Span KPI */}
        <div
          className="np-kpi"
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "1rem 1.25rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span className="np-kpi__label" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--np-muted, #8b9bb4)" }}>
              {t("summary_span")}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--np-muted, #8b9bb4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="np-kpi__value" style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--np-text, #e2e8f0)" }}>
            {metrics.timeSpanStr}
          </div>
        </div>
      </div>
    </section>
  );
}
