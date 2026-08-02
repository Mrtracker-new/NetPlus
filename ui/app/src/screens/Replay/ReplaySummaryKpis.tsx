import { useTranslation } from "react-i18next";

export interface ReplaySummaryKpisProps {
  frameIndex: number;
  formattedPosition: string;
  formattedTotal: string;
  speedLabel: string;
}

export function ReplaySummaryKpis({
  frameIndex,
  formattedPosition,
  formattedTotal,
  speedLabel,
}: ReplaySummaryKpisProps) {
  const { t } = useTranslation(["replay"]);

  const items = [
    { label: t("kpis.frame"), value: `#${frameIndex}`, color: "var(--np-text, #e2e8f0)" },
    { label: t("kpis.position"), value: formattedPosition, color: "var(--np-accent, #2fe0d6)" },
    { label: t("kpis.duration"), value: formattedTotal, color: "#60a5fa" },
    { label: t("kpis.speed"), value: speedLabel, color: "#10b981" },
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
