import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";

export interface VersionPinsInspectorProps {
  versionPins: RecordingSummary["version_pins"];
}

export function VersionPinsInspector({ versionPins }: VersionPinsInspectorProps) {
  const { t } = useTranslation(["recordings"]);

  return (
    <details
      className="np-recording__pins"
      style={{
        marginTop: "0.85rem",
        fontSize: "0.85rem",
        color: "var(--np-subtext, #94a3b8)",
        background: "var(--np-bg, #0b1019)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-md, 6px)",
        padding: "0.75rem 1rem",
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        📌 {t("card.version_pins")}
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginTop: "0.5rem", fontSize: "0.82rem" }}>
        <div><strong style={{ color: "var(--np-subtext, #94a3b8)" }}>Engine:</strong> <code>{versionPins.engine}</code></div>
        <div><strong style={{ color: "var(--np-subtext, #94a3b8)" }}>Decoder:</strong> <code>{versionPins.decode}</code></div>
        <div><strong style={{ color: "var(--np-subtext, #94a3b8)" }}>Intel:</strong> <code>{versionPins.intel}</code></div>
        <div><strong style={{ color: "var(--np-subtext, #94a3b8)" }}>AI:</strong> <code>{versionPins.ai}</code></div>
        <div><strong style={{ color: "var(--np-subtext, #94a3b8)" }}>Content:</strong> <code>{versionPins.content}</code></div>
      </div>
    </details>
  );
}
