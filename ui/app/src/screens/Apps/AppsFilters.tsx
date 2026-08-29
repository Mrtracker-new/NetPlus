import { useTranslation } from "react-i18next";
import type { ConfidenceFilterOption } from "../../hooks/useAppsController";
import { Icon } from "../../icons";

export interface AppsFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  confidenceFilter: ConfidenceFilterOption;
  onConfidenceChange: (option: ConfidenceFilterOption) => void;
}

export function AppsFilters({
  searchQuery,
  onSearchChange,
  confidenceFilter,
  onConfidenceChange,
}: AppsFiltersProps) {
  const { t } = useTranslation(["apps"]);

  const filters: Array<{ id: ConfidenceFilterOption; labelKey: string }> = [
    { id: "all", labelKey: "filter_all" },
    { id: "high", labelKey: "filter_confident" },
    { id: "low", labelKey: "filter_tentative" },
    { id: "unknown", labelKey: "filter_unknown" },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && searchQuery.length > 0) {
      e.preventDefault();
      onSearchChange("");
    }
  };

  const handleFilterClick = (targetId: ConfidenceFilterOption) => {
    if (targetId === "all") {
      onConfidenceChange("all");
    } else if (confidenceFilter === targetId) {
      onConfidenceChange("all");
    } else {
      onConfidenceChange(targetId);
    }
  };

  return (
    <div className="np-apps-filters">
      {/* Search Input Container */}
      <div className="np-apps-filters__search">
        <span className="np-apps-filters__search-icon" aria-hidden="true">
          <Icon name="search" style={{ width: "14px", height: "14px" }} />
        </span>
        <input
          type="search"
          aria-label={t("search_placeholder")}
          placeholder={t("search_placeholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="np-apps-filters__search-input"
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="np-apps-filters__clear-search"
            onClick={() => onSearchChange("")}
            aria-label={t("clear_search")}
            title={t("clear_search")}
          >
            <Icon name="close" style={{ width: "12px", height: "12px" }} />
          </button>
        )}
      </div>

      {/* Confidence Level Filter Buttons */}
      <div
        className="np-apps-filters__group"
        role="group"
        aria-label="Filter applications by attribution confidence"
      >
        {filters.map((f) => {
          const isSelected = confidenceFilter === f.id;
          return (
            <button
              type="button"
              key={f.id}
              className="np-apps-filters__btn"
              data-active={isSelected}
              data-tier={f.id}
              aria-pressed={isSelected}
              aria-label={`Filter by ${t(f.labelKey as any)}`}
              onClick={() => handleFilterClick(f.id)}
            >
              <span
                className="np-apps-filters__btn-gem"
                data-tier={f.id}
                aria-hidden="true"
              />
              <span>{t(f.labelKey as any)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

