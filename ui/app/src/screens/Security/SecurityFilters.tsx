import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
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
    <div className="np-security__filters">
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {categories.map((cat) => {
          const isActive = category === cat.key;
          return (
            <Button
              key={cat.key}
              variant={isActive ? "primary" : "standard"}
              onClick={() => onCategoryChange(cat.key)}
            >
              {cat.label}
            </Button>
          );
        })}
      </div>

      {expectedCount > 0 && (
        <Button
          variant="standard"
          onClick={onToggleShowExpected}
        >
          {showExpected ? t("filters.hide_expected") : `${t("filters.show_expected")} (${expectedCount})`}
        </Button>
      )}
    </div>
  );
}
