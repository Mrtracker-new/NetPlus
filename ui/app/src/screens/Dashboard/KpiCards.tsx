import { memo } from "react";
import { Skeleton } from "@netpulse/components";
import { Sparkline } from "@netpulse/viz";
import type { KpiViewModel } from "./viewModels";

interface KpiCardsProps {
  kpis: KpiViewModel[];
  loading?: boolean;
}

export const KpiCards = memo(function KpiCards({ kpis, loading }: KpiCardsProps) {
  if (loading) {
    return (
      <div className="np-kpis" role="region" aria-label="Loading statistics">
        {[1, 2, 3, 4].map((i) => (
          <div className="np-kpi-card" key={i}>
            <Skeleton variant="text" width="60%" height="12px" style={{ marginBottom: "8px" }} />
            <Skeleton variant="rounded" width="40%" height="24px" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="np-kpis" role="region" aria-label="Key Performance Indicators">
      {kpis.map((kpi) => (
        <div className="np-kpi-card" key={kpi.id} tabIndex={0} aria-describedby={`kpi-tooltip-${kpi.id}`}>
          <div className="np-kpi-card__header">
            <span className="np-kpi-card__label">{kpi.label}</span>
            <span className={`np-status-badge np-status-badge--${kpi.statusBadge.variant}`}>
              {kpi.statusBadge.text}
            </span>
          </div>

          <div className="np-kpi-card__main">
            <div className="np-kpi-card__val">{kpi.value}</div>
            {(kpi.rateDown || kpi.rateUp) && (
              <div className="np-kpi-card__rates">
                {kpi.rateDown && <span className="np-kpi-rate np-kpi-rate--down">▼ {kpi.rateDown.replace("▼", "").trim()}</span>}
                {kpi.rateUp && <span className="np-kpi-rate np-kpi-rate--up">▲ {kpi.rateUp.replace("▲", "").trim()}</span>}
              </div>
            )}
          </div>

          {kpi.sparklineData.length > 1 && (
            <div className="np-kpi-card__spark">
              <Sparkline
                data={kpi.sparklineData}
                width={110}
                height={28}
                color={
                  kpi.statusBadge.variant === "spike"
                    ? "var(--np-finding)"
                    : kpi.statusBadge.variant === "congested"
                    ? "var(--np-notable)"
                    : "var(--np-accent)"
                }
              />
            </div>
          )}

          <div className="np-kpi-card__tooltip" id={`kpi-tooltip-${kpi.id}`} role="tooltip">
            <div>Peak: {kpi.tooltip.peak}</div>
            <div>Avg: {kpi.tooltip.avg}</div>
            <div>{kpi.tooltip.percentile}</div>
            <div>Trend: {kpi.tooltip.trend}</div>
          </div>
        </div>
      ))}
    </div>
  );
});
