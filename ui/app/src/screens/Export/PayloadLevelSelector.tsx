import { useTranslation } from "react-i18next";
import type { PayloadLevel } from "@netpulse/contract";

export interface PayloadLevelSelectorProps {
  selectedLevel: PayloadLevel;
  onLevelChange: (level: PayloadLevel) => void;
  disabled: boolean;
}

export function PayloadLevelSelector({
  selectedLevel,
  onLevelChange,
  disabled,
}: PayloadLevelSelectorProps) {
  const { t } = useTranslation(["export"]);

  const levels: Array<{ id: PayloadLevel; title: string; color: string }> = [
    { id: "metadata_only", title: t("levels.metadata_only"), color: "#10b981" },
    { id: "headers", title: t("levels.headers"), color: "#60a5fa" },
    { id: "full_payload", title: t("levels.full_payload"), color: "#f59e0b" },
  ];

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--np-subtext, #94a3b8)", marginBottom: "0.5rem" }}>
        {t("level_label")}
      </label>
      <div role="radiogroup" aria-label={t("level_label")} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {levels.map((lvl) => {
          const isSelected = lvl.id === selectedLevel;
          return (
            <button
              key={lvl.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              className={`np-btn ${isSelected ? "np-btn--primary" : "np-btn--ghost"}`}
              onClick={() => onLevelChange(lvl.id)}
              style={{
                fontSize: "0.85rem",
                padding: "0.4rem 0.85rem",
                borderRadius: "16px",
                borderColor: isSelected ? lvl.color : undefined,
              }}
            >
              {lvl.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
