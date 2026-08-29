import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { SeverityFilter } from "../../utils/timeline.utils";
import { Icon } from "../../icons";

export interface TimelineFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  severityFilter: SeverityFilter;
  onSeverityChange: (severity: SeverityFilter) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export function TimelineFilters({
  searchQuery,
  onSearchChange,
  severityFilter,
  onSeverityChange,
  onClearFilters,
  hasActiveFilters,
}: TimelineFiltersProps) {
  const { t } = useTranslation(["timeline"]);
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filters: Array<{ id: SeverityFilter; label: string }> = [
    { id: "all", label: t("filter_all") },
    { id: "finding", label: t("filter_findings") },
    { id: "notable", label: t("filter_notable") },
    { id: "neutral", label: t("filter_neutral") },
  ];

  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = (index + 1) % filters.length;
        filterRefs.current[next]?.focus();
        onSeverityChange(filters[next]!.id);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = (index - 1 + filters.length) % filters.length;
        filterRefs.current[prev]?.focus();
        onSeverityChange(filters[prev]!.id);
      }
    },
    [filters, onSeverityChange]
  );

  return (
    <div className="np-timeline-filters" role="search" aria-label="Filter timeline events">
      {/* Recessed Search Input Container */}
      <div className="np-timeline-filters__search">
        <span aria-hidden="true" className="np-timeline-filters__search-icon">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          className="np-timeline-filters__search-input"
          placeholder={t("search_placeholder")}
          aria-label={t("search_placeholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="np-timeline-filters__clear-search"
            onClick={() => onSearchChange("")}
            aria-label="Clear search text"
          >
            <Icon name="close" style={{ width: "12px", height: "12px" }} />
          </button>
        )}
      </div>

      {/* Tactile Severity Selector Group */}
      <div
        className="np-timeline-filters__group"
        role="group"
        aria-label="Filter events by severity"
      >
        {filters.map((f, i) => {
          const isSelected = severityFilter === f.id;

          return (
            <button
              type="button"
              key={f.id}
              ref={(el) => {
                filterRefs.current[i] = el;
              }}
              className="np-timeline-filters__btn"
              data-sev={f.id}
              aria-pressed={isSelected}
              onClick={() => onSeverityChange(f.id)}
              onKeyDown={(e) => handleFilterKeyDown(e, i)}
            >
              {f.id !== "all" && (
                <span
                  className="np-timeline-filters__dot"
                  data-sev={f.id}
                  aria-hidden="true"
                />
              )}
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Clear Active Filters Action */}
      {hasActiveFilters && (
        <button
          type="button"
          className="np-timeline-filters__clear-btn"
          onClick={onClearFilters}
          aria-label="Clear Timeline Filters"
        >
          <Icon name="close" style={{ width: "12px", height: "12px" }} />
          <span>{t("clear_filter")}</span>
        </button>
      )}
    </div>
  );
}


