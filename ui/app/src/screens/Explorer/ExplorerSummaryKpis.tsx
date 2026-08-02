import { useTranslation } from "react-i18next";

export interface ExplorerSummaryKpisProps {
  total: number;
  matching: number;
  withExamples: number;
  relatedCount: number;
}

export function ExplorerSummaryKpis({
  total,
  matching,
  withExamples,
  relatedCount,
}: ExplorerSummaryKpisProps) {
  const { t } = useTranslation(["explorer"]);

  const items = [
    { label: t("kpis.total"), value: total, color: "var(--np-text, #e2e8f0)" },
    { label: t("kpis.matching"), value: matching, color: "var(--np-accent, #2fe0d6)" },
    { label: t("kpis.examples"), value: withExamples, color: "#10b981" },
    { label: t("kpis.related"), value: relatedCount, color: "#60a5fa" },
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
