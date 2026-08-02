import { useTranslation } from "react-i18next";
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
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.25rem",
        flexWrap: "wrap",
      }}
    >
      {filters.map((flt) => {
        const isActive = filter === flt.key;
        return (
          <button
            key={flt.key}
            type="button"
            className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
            style={{
              fontSize: "0.85rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--np-radius-md, 6px)",
            }}
            onClick={() => onFilterChange(flt.key)}
          >
            {flt.label}
          </button>
        );
      })}
    </div>
  );
}
