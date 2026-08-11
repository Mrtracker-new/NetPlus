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
        gap: "0.85rem",
        marginBottom: "1.25rem",
      }}
    >
      <div className="np-kpi" style={{ boxShadow: "var(--np-neu)" }}>
        <div className="np-kpi__label">{t("kpis.total")}</div>
        <div className="np-kpi__value" style={{ color: "var(--np-text)" }}>
          {summary.total}
        </div>
      </div>
      <div className="np-kpi" style={{ boxShadow: "var(--np-neu)" }}>
        <div className="np-kpi__label">{t("kpis.online")}</div>
        <div className="np-kpi__value" style={{ color: "var(--np-good)" }}>
          {summary.online}
        </div>
      </div>
      <div className="np-kpi" style={{ boxShadow: "var(--np-neu)" }}>
        <div className="np-kpi__label">{t("kpis.degraded")}</div>
        <div className="np-kpi__value" style={{ color: "var(--np-notable)" }}>
          {summary.degraded}
        </div>
      </div>
      <div className="np-kpi" style={{ boxShadow: "var(--np-neu)" }}>
        <div className="np-kpi__label">{t("kpis.offline")}</div>
        <div className="np-kpi__value" style={{ color: "var(--np-finding)" }}>
          {summary.offline}
        </div>
      </div>
    </div>
  );
}
