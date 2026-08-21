import { useTranslation } from "react-i18next";
import type { RecordingSummary } from "@netpulse/contract";
import { Icon } from "../../icons";

export interface VersionPinsInspectorProps {
  versionPins: RecordingSummary["version_pins"];
}

export function VersionPinsInspector({ versionPins }: VersionPinsInspectorProps) {
  const { t } = useTranslation(["recordings"]);

  return (
    <details className="np-recording__pins">
      <summary style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
        <Icon name="pin" style={{ width: "13px", height: "13px" }} />
        <span>{t("card.version_pins")}</span>
      </summary>
      <div className="np-recording__pins-grid">
        <div><strong>Engine:</strong> <code>{versionPins.engine}</code></div>
        <div><strong>Decoder:</strong> <code>{versionPins.decode}</code></div>
        <div><strong>Intel:</strong> <code>{versionPins.intel}</code></div>
        <div><strong>AI:</strong> <code>{versionPins.ai}</code></div>
        <div><strong>Content:</strong> <code>{versionPins.content}</code></div>
      </div>
    </details>
  );
}

