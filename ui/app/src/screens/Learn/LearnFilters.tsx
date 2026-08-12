import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
import type { LevelFilter } from "../../hooks/useLearnController";

export interface LearnFiltersProps {
  level: LevelFilter;
  onLevelChange: (lvl: LevelFilter) => void;
  groundedOnly: boolean;
  onToggleGrounded: () => void;
  groundedCount: number;
}

export function LearnFilters({
  level,
  onLevelChange,
  groundedOnly,
  onToggleGrounded,
  groundedCount,
}: LearnFiltersProps) {
  const { t } = useTranslation(["learn"]);

  const levels: { key: LevelFilter; label: string }[] = [
    { key: "all", label: t("filters.all") },
    { key: "beginner", label: t("filters.beginner") },
    { key: "intermediate", label: t("filters.intermediate") },
    { key: "expert", label: t("filters.expert") },
  ];

  return (
    <div className="np-learn__filters">
      <div className="np-learn__filter-group">
        {levels.map((lvl) => {
          const isActive = level === lvl.key;
          return (
            <Button
              key={lvl.key}
              type="button"
              variant={isActive ? "primary" : "standard"}
              className={`np-learn__filter ${isActive ? "np-learn__filter--active" : ""}`}
              aria-pressed={isActive}
              onClick={() => onLevelChange(lvl.key)}
            >
              {lvl.label}
            </Button>
          );
        })}
      </div>

      <Button
        type="button"
        variant={groundedOnly ? "primary" : "standard"}
        className={`np-learn__filter ${groundedOnly ? "np-learn__filter--active" : ""}`}
        aria-pressed={groundedOnly}
        onClick={onToggleGrounded}
      >
        🎯 {groundedOnly ? t("filters.show_all") : `${t("filters.grounded_only")} (${groundedCount})`}
      </Button>
    </div>
  );
}

