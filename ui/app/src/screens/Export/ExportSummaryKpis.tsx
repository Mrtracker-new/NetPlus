import { useTranslation } from "react-i18next";

export interface ExportSummaryKpisProps {
  flows: number;
  sessions: number;
  hosts: number;
}

export function ExportSummaryKpis({ flows, sessions, hosts }: ExportSummaryKpisProps) {
  const { t } = useTranslation(["export"]);

  const items = [
    { label: t("kpis.flows"), value: flows.toLocaleString(), color: "var(--np-accent-strong)" },
    { label: t("kpis.sessions"), value: sessions.toLocaleString(), color: "var(--np-accent-2)" },
    { label: t("kpis.hosts"), value: hosts.toLocaleString(), color: "var(--np-good)" },
  ];

  return (
    <div className="np-kpis">
      {items.map((item) => (
        <div key={item.label} className="np-kpi">
          <div className="np-kpi__label">{item.label}</div>
          <div className="np-kpi__value" style={{ color: item.color }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

