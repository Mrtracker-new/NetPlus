import { useTranslation } from "react-i18next";

export interface PluginsSummaryKpisProps {
  total: number;
  activeCount: number;
  firstPartyCount: number;
  compatibleCount: number;
}

export function PluginsSummaryKpis({
  total = 0,
  activeCount = 0,
  firstPartyCount = 0,
  compatibleCount = 0,
}: PluginsSummaryKpisProps) {
  const { t } = useTranslation(["plugins"]);

  const items = [
    { label: t("kpis.total"), value: total ?? 0, color: "var(--np-text, #e2e8f0)" },
    { label: t("kpis.active"), value: activeCount ?? 0, color: "var(--np-accent, #2fe0d6)" },
    { label: t("kpis.first_party"), value: firstPartyCount ?? 0, color: "#10b981" },
    { label: t("kpis.compatible"), value: compatibleCount ?? 0, color: "#60a5fa" },
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
