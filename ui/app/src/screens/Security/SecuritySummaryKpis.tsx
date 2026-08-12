import { useTranslation } from "react-i18next";

export interface SecuritySummaryKpisProps {
  total: number;
  anomaly: number;
  suspicious: number;
  informational: number;
}

export function SecuritySummaryKpis({
  total,
  anomaly,
  suspicious,
  informational,
}: SecuritySummaryKpisProps) {
  const { t } = useTranslation(["security"]);

  const items = [
    { label: t("kpis.total"), value: total, color: "var(--np-text)" },
    { label: t("kpis.suspicious"), value: suspicious, color: "var(--np-finding)" },
    { label: t("kpis.anomaly"), value: anomaly, color: "var(--np-notable)" },
    { label: t("kpis.informational"), value: informational, color: "var(--np-accent)" },
  ];

  return (
    <div className="np-kpis" style={{ marginBottom: "1.25rem" }}>
      {items.map((item) => (
        <div key={item.label} className="np-kpi" style={{ boxShadow: "var(--np-neu)" }}>
          <div className="np-kpi__label">{item.label}</div>
          <div className="np-kpi__value" style={{ color: item.color }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
