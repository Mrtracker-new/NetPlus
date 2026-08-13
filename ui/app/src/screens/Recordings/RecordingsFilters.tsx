import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
import type { PrivacyFilter } from "../../hooks/useRecordingsController";

export interface RecordingsFiltersProps {
  filter: PrivacyFilter;
  onFilterChange: (f: PrivacyFilter) => void;
}

export function RecordingsFilters({ filter, onFilterChange }: RecordingsFiltersProps) {
  const { t } = useTranslation(["recordings"]);

  const filters: { key: PrivacyFilter; label: string }[] = [
    { key: "all", label: t("filters.all") },
    { key: "metadata_only", label: t("filters.metadata_only") },
    { key: "headers", label: t("filters.headers") },
    { key: "full_payload", label: t("filters.full_payload") },
  ];

  return (
    <div className="np-recordings__filters">
      {filters.map((flt) => {
        const isActive = filter === flt.key;
        return (
          <Button
            key={flt.key}
            type="button"
            className="np-recordings__filter"
            aria-pressed={isActive}
            onClick={() => onFilterChange(flt.key)}
          >
            {flt.label}
          </Button>
        );
      })}
    </div>
  );
}

