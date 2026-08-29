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
  return (
    <div className="np-monitor-card" aria-label="Throughput Gains Chart">
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">Throughput Gains</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Color Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-accent, #2fe0d6)" }} />
            <span>Flow Spikes (Burst Rate)</span>
          </div>
          <span className="np-monitor-badge np-monitor-badge--live">Good / Balanced</span>
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

