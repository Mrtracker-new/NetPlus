import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";
import { Badge } from "@netpulse/components";

export interface PrivacyBadgeProps {
  level: RecordingSummary["privacy"]["level"];
}

export function PrivacyBadge({ level }: PrivacyBadgeProps) {
  const { t } = useTranslation(["recordings"]);

  return (
    <Badge
      variant="level"
      className={`np-recording__level np-recording__level--${level}`}
    >
      {t(`levels.${level}` as any, { defaultValue: level })}
    </Badge>
  );
}

