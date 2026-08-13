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
    { label: t("kpis.total"), value: total, color: "var(--np-text)" },
    { label: t("kpis.frames"), value: totalFrames.toLocaleString(), color: "var(--np-accent-strong)" },
    { label: t("kpis.safe_share"), value: safeToShareCount, color: "var(--np-good)" },
    { label: t("kpis.payloads"), value: payloadCount, color: "var(--np-notable)" },
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

