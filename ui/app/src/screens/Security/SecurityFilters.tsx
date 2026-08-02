import { useTranslation } from "react-i18next";
import type { FindingCategory } from "../../hooks/useSecurityController";

export interface SecurityFiltersProps {
  category: FindingCategory;
  onCategoryChange: (cat: FindingCategory) => void;
  showExpected: boolean;
  onToggleShowExpected: () => void;
  expectedCount: number;
}

export function SecurityFilters({
  category,
  onCategoryChange,
  showExpected,
  onToggleShowExpected,
  expectedCount,
}: SecurityFiltersProps) {
  const { t } = useTranslation(["security"]);

  const categories: { key: FindingCategory; label: string }[] = [
    { key: "all", label: t("filters.all") },
    { key: "suspicious", label: t("filters.suspicious") },
    { key: "anomaly", label: t("filters.anomaly") },
    { key: "informational", label: t("filters.informational") },
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
        {categories.map((cat) => {
          const isActive = category === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
              style={{
                fontSize: "0.85rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--np-radius-md, 6px)",
              }}
              onClick={() => onCategoryChange(cat.key)}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {expectedCount > 0 && (
        <button
          type="button"
          className="np-btn np-btn--ghost"
          style={{
            fontSize: "0.85rem",
            padding: "0.35rem 0.75rem",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
          }}
          onClick={onToggleShowExpected}
        >
          {showExpected ? t("filters.hide_expected") : `${t("filters.show_expected")} (${expectedCount})`}
        </button>
      )}
    </div>
  );
}
