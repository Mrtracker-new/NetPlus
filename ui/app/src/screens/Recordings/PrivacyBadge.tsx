import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";

export interface PrivacyBadgeProps {
  level: RecordingSummary["privacy"]["level"];
}

export function PrivacyBadge({ level }: PrivacyBadgeProps) {
  const { t } = useTranslation(["recordings"]);

  const colorMap: Record<RecordingSummary["privacy"]["level"], { bg: string; color: string }> = {
    metadata_only: { bg: "rgba(16, 185, 129, 0.2)", color: "#10b981" },
    headers: { bg: "rgba(59, 130, 246, 0.2)", color: "#60a5fa" },
    full_payload: { bg: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" },
  };

  const style = colorMap[level] || colorMap.metadata_only;

  return (
    <span
      className="np-recording__level"
      style={{
        fontSize: "0.78rem",
        padding: "0.2rem 0.6rem",
        borderRadius: "12px",
        background: style.bg,
        color: style.color,
        fontWeight: 600,
      }}
    >
      {t(`levels.${level}` as any, { defaultValue: level })}
    </span>
  );
}
