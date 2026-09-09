import { useTranslation } from "react-i18next";
import { Chart, type ChartSeries } from "@netpulse/viz";

export interface ThroughputGainsCardProps {
  series: ChartSeries[];
  timestamps: string[];
  peakBadgeText: string;
}

export function ThroughputGainsCard({
  series,
  timestamps,
  peakBadgeText,
}: ThroughputGainsCardProps) {
  const { t } = useTranslation(["monitoring"]);
  const hasVolume = series.some((s) => s.data && s.data.some((d) => d > 0));

  return (
    <div className="np-monitor-card" aria-label={t("total_throughput_volume", "Total Throughput Volume")}>
      <div className="np-monitor-card__header">
        <div>
          <h3 className="np-monitor-card__title">
            {t("total_throughput_volume", "Total Throughput Volume")}
          </h3>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {t("throughput_volume_subtitle", "Combined ingress and egress traffic volume")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Color Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-accent, #2fe0d6)" }} />
            <span>{t("throughput_volume_legend", "Combined Rate")}</span>
          </div>
          <span className={`np-monitor-badge ${hasVolume ? "np-monitor-badge--live" : "np-monitor-badge--idle"}`}>
            {hasVolume ? peakBadgeText : t("engine_state.standby", "Standby")}
          </span>
        </div>
      </div>
      <Chart
        variant="gains"
        series={series}
        timestamps={timestamps}
        height={180}
        peakBadgeText={peakBadgeText}
      />
    </div>
  );
}

