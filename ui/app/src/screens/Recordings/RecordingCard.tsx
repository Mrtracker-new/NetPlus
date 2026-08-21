import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";
import { Card } from "@netpulse/components";
import { Icon } from "../../icons";
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
        <h3 className="np-recording__title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <Icon name="recordings" style={{ width: "16px", height: "16px", color: "var(--np-accent, #2fe0d6)" }} />
          <span>{t("card.title", { id: rec.id })}</span>
        </h3>

        <PrivacyBadge level={rec.privacy.level} />
      </header>

      <div className="np-recording__meta">
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <Icon name="box" style={{ width: "13px", height: "13px" }} />
          <span>{t("card.frames_count", { count: rec.frame_count })}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <Icon name="clock" style={{ width: "13px", height: "13px" }} />
          <span>{seconds(rec.from_mono_nanos)} → {seconds(rec.to_mono_nanos)}</span>
        </span>
        {rec.incomplete && (
          <span className="np-recording__incomplete" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <Icon name="alertTriangle" style={{ width: "13px", height: "13px" }} />
            <span>{t("card.incomplete")}</span>
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <Icon
            name={rec.privacy.contains_payloads ? "shieldAlert" : "shieldCheck"}
            style={{ width: "14px", height: "14px" }}
          />
          <span>{rec.privacy.contains_payloads ? t("card.payload_notice") : t("card.safe_notice")}</span>
        </span>
      </p>

      <VersionPinsInspector versionPins={rec.version_pins} />
    </Card>
  );
}

