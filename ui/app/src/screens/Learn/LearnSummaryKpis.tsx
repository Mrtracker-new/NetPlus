import { useTranslation } from "react-i18next";

export interface LearnSummaryKpisProps {
  total: number;
  groundedCount: number;
  exampleCount: number;
  groundedPct: number;
}

export function LearnSummaryKpis({
  total,
  groundedCount,
  exampleCount,
  groundedPct,
}: LearnSummaryKpisProps) {
  const { t } = useTranslation(["learn"]);

  const items = [
    { label: t("kpis.total"), value: total, color: "var(--np-text, #e2e8f0)" },
    { label: t("kpis.grounded"), value: groundedCount, color: "#10b981" },
    { label: t("kpis.examples"), value: exampleCount, color: "#60a5fa" },
    { label: t("kpis.grounded_pct"), value: `${groundedPct}%`, color: "var(--np-accent, #2fe0d6)" },
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
