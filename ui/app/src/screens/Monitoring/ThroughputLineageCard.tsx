import { Chart, type ChartSeries } from "@netpulse/viz";

export interface ThroughputLineageCardProps {
  series: ChartSeries[];
  timestamps: string[];
}

export function ThroughputLineageCard({
  series,
  timestamps,
}: ThroughputLineageCardProps) {
  return (
    <div className="np-monitor-card" aria-label="Throughput & Lineage Chart">
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">Throughput & Lineage</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Color Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-monitor-primary, #00f2fe)" }} />
            <span>Ingress (Download)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-accent-2, #7c83f7)" }} />
            <span>Egress (Upload)</span>
          </div>
          <span className="np-monitor-badge np-monitor-badge--live">Good / Balanced</span>
        </div>
      </div>
      <Chart
        variant="throughput"
        series={series}
        timestamps={timestamps}
        height={180}
      />
    </div>
  );
}
