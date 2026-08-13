import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";
import { Card } from "@netpulse/components";
import { PrivacyBadge } from "./PrivacyBadge";
import { VersionPinsInspector } from "./VersionPinsInspector";

export interface RecordingCardProps {
  rec: RecordingSummary;
}

function seconds(ns: number): string {
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

export function RecordingCard({ rec }: RecordingCardProps) {
  const { t } = useTranslation(["recordings"]);

  return (
    <Card as="article" className="np-recording">
      <header className="np-recording__head">
        <h3 className="np-recording__title">
          📹 {t("card.title", { id: rec.id })}
        </h3>

        <PrivacyBadge level={rec.privacy.level} />
      </header>

      <div className="np-recording__meta">
        <span>📦 {t("card.frames_count", { count: rec.frame_count })}</span>
        <span>
          ⏱️ {seconds(rec.from_mono_nanos)} → {seconds(rec.to_mono_nanos)}
        </span>
        {rec.incomplete && (
          <span className="np-recording__incomplete">
            ⚠️ {t("card.incomplete")}
          </span>
        )}
      </div>

      <p
        className={
          rec.privacy.contains_payloads
            ? "np-recording__privacy np-recording__privacy--payload"
            : "np-recording__privacy np-recording__privacy--safe"
        }
      >
        {rec.privacy.contains_payloads ? `⚠️ ${t("card.payload_notice")}` : `✅ ${t("card.safe_notice")}`}
      </p>

      <VersionPinsInspector versionPins={rec.version_pins} />
    </Card>
  );
}

