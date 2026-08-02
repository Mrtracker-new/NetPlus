import { useTranslation } from "react-i18next";
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginBottom: "1.25rem",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {levels.map((lvl) => {
          const isActive = level === lvl.key;
          return (
            <button
              key={lvl.key}
              type="button"
              className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
              style={{
                fontSize: "0.85rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--np-radius-md, 6px)",
              }}
              onClick={() => onLevelChange(lvl.key)}
            >
              {lvl.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`np-btn ${groundedOnly ? "np-btn--primary" : "np-btn--ghost"}`}
        style={{
          fontSize: "0.85rem",
          padding: "0.35rem 0.75rem",
          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
        }}
        onClick={onToggleGrounded}
      >
        🎯 {groundedOnly ? t("filters.show_all") : `${t("filters.grounded_only")} (${groundedCount})`}
      </button>
    </div>
  );
}
