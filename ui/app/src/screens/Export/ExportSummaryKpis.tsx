import { useTranslation } from "react-i18next";

export interface ExportSummaryKpisProps {
  flows: number;
  sessions: number;
  hosts: number;
}

export function ExportSummaryKpis({ flows, sessions, hosts }: ExportSummaryKpisProps) {
  const { t } = useTranslation(["export"]);

  const items = [
    { label: t("kpis.flows"), value: flows.toLocaleString(), color: "var(--np-accent, #2fe0d6)" },
    { label: t("kpis.sessions"), value: sessions.toLocaleString(), color: "#60a5fa" },
    { label: t("kpis.hosts"), value: hosts.toLocaleString(), color: "#10b981" },
  ];

  return (
    <div className="np-kpis" style={{ marginBottom: "1.25rem" }}>
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
