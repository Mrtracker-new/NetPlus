import { useTranslation } from "react-i18next";

export interface RecordingsSummaryKpisProps {
  total: number;
  totalFrames: number;
  safeToShareCount: number;
  payloadCount: number;
}

export function RecordingsSummaryKpis({
  total,
  totalFrames,
  safeToShareCount,
  payloadCount,
}: RecordingsSummaryKpisProps) {
  const { t } = useTranslation(["recordings"]);

  const items = [
    { label: t("kpis.total"), value: total, color: "var(--np-text, #e2e8f0)" },
    { label: t("kpis.frames"), value: totalFrames.toLocaleString(), color: "var(--np-accent, #2fe0d6)" },
    { label: t("kpis.safe_share"), value: safeToShareCount, color: "#10b981" },
    { label: t("kpis.payloads"), value: payloadCount, color: "#f59e0b" },
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
