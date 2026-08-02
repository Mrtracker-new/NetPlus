import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";
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
    <article
      className="np-recording"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      <header
        className="np-recording__head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
      >
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          📹 {t("card.title", { id: rec.id })}
        </h3>

        <PrivacyBadge level={rec.privacy.level} />
      </header>

      <div
        className="np-recording__meta"
        style={{ display: "flex", gap: "1rem", fontSize: "0.88rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.75rem", flexWrap: "wrap" }}
      >
        <span>📦 {t("card.frames_count", { count: rec.frame_count })}</span>
        <span>
          ⏱️ {seconds(rec.from_mono_nanos)} → {seconds(rec.to_mono_nanos)}
        </span>
        {rec.incomplete && (
          <span className="np-recording__incomplete" style={{ color: "#ef4444", fontWeight: 600 }}>
            ⚠️ {t("card.incomplete")}
          </span>
        )}
      </div>

      <p
        className="np-recording__privacy"
        style={{ fontSize: "0.9rem", color: rec.privacy.contains_payloads ? "#f59e0b" : "#10b981", margin: "0 0 0.75rem 0", lineHeight: "1.5" }}
      >
        {rec.privacy.contains_payloads ? `⚠️ ${t("card.payload_notice")}` : `✅ ${t("card.safe_notice")}`}
      </p>

      <VersionPinsInspector versionPins={rec.version_pins} />
    </article>
  );
}
