import { useTranslation } from "react-i18next";
import type { BreakdownRow } from "@netpulse/contract";
import { Chart, type ChartSeries, humanBytes, protocolColor } from "@netpulse/viz";

export interface ThroughputLineageCardProps {
  series: ChartSeries[];
  timestamps: string[];
  protocols?: BreakdownRow[];
}

export function ThroughputLineageCard({
  series,
  timestamps,
  protocols,
}: ThroughputLineageCardProps) {
  const { t } = useTranslation(["monitoring"]);
  const hasTraffic = series.some((s) => s.data && s.data.some((d) => d > 0));

  const sortedProtocols = (protocols ?? [])
    .map((p) => ({
      ...p,
      bytes: typeof p.bytes === "number" && !isNaN(p.bytes) ? Math.max(0, p.bytes) : 0,
      flows: typeof p.flows === "number" && !isNaN(p.flows) ? Math.max(0, p.flows) : 0,
    }))
    .filter((p) => p.bytes > 0 || p.flows > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const topProtocols = sortedProtocols.slice(0, 5);
  const totalProtocolBytes = topProtocols.reduce((sum, p) => sum + p.bytes, 0);

  return (
    <div className="np-monitor-card" aria-label={t("throughput_lineage.aria_label", "Throughput & Lineage Chart")}>
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">{t("throughput_lineage.title", "Throughput & Lineage")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Color Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-accent, #2fe0d6)" }} />
            <span>{t("throughput_lineage.ingress", "Ingress (Download)")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--np-accent-2, #7c83f7)" }} />
            <span>{t("throughput_lineage.egress", "Egress (Upload)")}</span>
          </div>
          <span className={`np-monitor-badge ${hasTraffic ? "np-monitor-badge--live" : "np-monitor-badge--idle"}`}>
            {hasTraffic ? t("throughput_lineage.active_telemetry", "Active Telemetry") : t("engine_state.standby", "Standby")}
          </span>
        </div>
      </div>
      <Chart
        variant="throughput"
        series={series}
        timestamps={timestamps}
        height={180}
      />

      {/* Top Protocols Bar */}
      <div
        className="np-protocol-breakdown"
        aria-label={t("throughput_lineage.protocols_breakdown_aria_label", "Top protocols breakdown")}
        data-testid="top-protocols-bar"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "6px",
          }}
        >
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--np-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {t("top_dimension", { dimension: t("dimension_protocols", "Protocols"), defaultValue: "Top Protocols" })}
          </span>
          <span
            style={{
              fontSize: "0.75rem",
              fontFamily: "var(--np-font-mono)",
              color: "var(--np-text-dim)",
            }}
          >
            {topProtocols.length > 0 && totalProtocolBytes > 0
              ? humanBytes(totalProtocolBytes)
              : "0 B"}
          </span>
        </div>

        {/* Segmented Bar Track */}
        <div
          role="progressbar"
          aria-label={t("throughput_lineage.protocols_distribution_aria_label", "Top protocols distribution")}
          aria-valuenow={totalProtocolBytes > 0 ? 100 : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            display: "flex",
            height: "8px",
            borderRadius: "var(--np-radius-pill, 9999px)",
            backgroundColor: "var(--np-surface-recessed, rgba(0, 0, 0, 0.2))",
            overflow: "hidden",
            boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.25)",
            gap: "2px",
          }}
        >
          {topProtocols.length > 0 && totalProtocolBytes > 0 ? (
            topProtocols.map((p, idx) => {
              const pct = (p.bytes / totalProtocolBytes) * 100;
              const color = protocolColor(p.label, idx);
              return (
                <div
                  key={`${p.label}-${idx}`}
                  title={`${p.label}: ${humanBytes(p.bytes)} (${pct.toFixed(1)}%)`}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    minWidth: pct > 0 ? "4px" : "0px",
                    transition: "width 0.3s ease",
                  }}
                />
              );
            })
          ) : (
            <div
              style={{
                width: "100%",
                backgroundColor: "var(--np-surface-2, rgba(255, 255, 255, 0.05))",
              }}
            />
          )}
        </div>

        {/* Legend / Metrics Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginTop: "8px",
            fontSize: "0.75rem",
          }}
        >
          {topProtocols.length > 0 ? (
            topProtocols.map((p, idx) => {
              const pct = totalProtocolBytes > 0 ? (p.bytes / totalProtocolBytes) * 100 : 0;
              const color = protocolColor(p.label, idx);
              return (
                <div
                  key={`${p.label}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: "var(--np-text)" }}>{p.label}</span>
                  <span
                    style={{
                      fontFamily: "var(--np-font-mono)",
                      color: "var(--np-text-dim)",
                      fontSize: "0.7rem",
                    }}
                  >
                    {totalProtocolBytes > 0 ? `${pct.toFixed(0)}%` : "0%"}
                  </span>
                </div>
              );
            })
          ) : (
            <span style={{ color: "var(--np-text-dim)", fontSize: "0.75rem" }}>
              {t("throughput_lineage.no_activity", "No protocol activity observed")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


