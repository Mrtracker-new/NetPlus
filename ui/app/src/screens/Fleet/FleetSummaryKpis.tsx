import { useTranslation } from "react-i18next";

export interface FleetSummaryKpisProps {
  summary: {
    total: number;
    online: number;
    degraded: number;
    offline: number;
  };
}

export function FleetSummaryKpis({ summary }: FleetSummaryKpisProps) {
  const { t } = useTranslation(["fleet"]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.25rem",
      }}
    >
      <div className="np-kpi">
        <div className="np-kpi__label">{t("kpis.total")}</div>
        <div className="np-kpi__value" style={{ color: "var(--np-text, #e2e8f0)" }}>
          {summary.total}
        </div>
      </div>
      <div className="np-kpi">
        <div className="np-kpi__label">{t("kpis.online")}</div>
        <div className="np-kpi__value" style={{ color: "#10b981" }}>
          {summary.online}
        </div>
      </div>
      <div className="np-kpi">
        <div className="np-kpi__label">{t("kpis.degraded")}</div>
        <div className="np-kpi__value" style={{ color: "#f59e0b" }}>
          {summary.degraded}
        </div>
      </div>
      <div className="np-kpi">
        <div className="np-kpi__label">{t("kpis.offline")}</div>
        <div className="np-kpi__value" style={{ color: "#ef4444" }}>
          {summary.offline}
        </div>
      </div>
    </div>
  );
}
