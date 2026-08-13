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

  const levels: Array<{ id: PayloadLevel; title: string }> = [
    { id: "metadata_only", title: t("levels.metadata_only") },
    { id: "headers", title: t("levels.headers") },
    { id: "full_payload", title: t("levels.full_payload") },
  ];

  return (
    <div>
      <label className="np-export__label">
        {t("level_label")}
      </label>
      <div className="np-export__levels" role="radiogroup" aria-label={t("level_label")}>
        {levels.map((lvl) => {
          const isSelected = lvl.id === selectedLevel;
          return (
            <button
              key={lvl.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              className={`np-export__level np-export__level--${lvl.id}`}
              onClick={() => onLevelChange(lvl.id)}
            >
              {lvl.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

