import { useTranslation } from "react-i18next";
import type { SeverityFilter } from "../../utils/timeline.utils";

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

  const filters: Array<{ id: SeverityFilter; label: string }> = [
    { id: "all", label: t("filter_all") },
    { id: "finding", label: t("filter_findings") },
    { id: "notable", label: t("filter_notable") },
    { id: "neutral", label: t("filter_neutral") },
  ];

  return (
    <div
      className="np-timeline-filters"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "1rem",
        marginBottom: "1.5rem",
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        padding: "0.85rem 1.25rem",
        borderRadius: "var(--np-radius-lg, 12px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      {/* Search Input Container */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", flex: "1 1 260px", minWidth: "200px" }}>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "0.75rem",
            display: "flex",
            alignItems: "center",
            color: "var(--np-muted, #8b9bb4)",
            pointerEvents: "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          placeholder={t("search_placeholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            width: "100%",
            padding: "0.45rem 0.75rem 0.45rem 2.2rem",
            fontSize: "0.85rem",
            borderRadius: "var(--np-radius-md, 8px)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.12))",
            background: "var(--np-bg, #0b1019)",
            color: "var(--np-text, #e2e8f0)",
            outline: "none",
          }}
        />
      </div>

      {/* Severity Filter Toggle Buttons */}
      <div
        className="np-filter-group"
        role="group"
        aria-label="Filter events by severity"
        style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}
      >
        {filters.map((f) => {
          const isSelected = severityFilter === f.id;
          return (
            <button
              type="button"
              key={f.id}
              className={`np-btn ${isSelected ? "np-btn--primary" : "np-btn--ghost"}`}
              style={{
                fontSize: "0.8rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--np-radius-md, 8px)",
                background: isSelected ? "var(--np-accent, #2fe0d6)" : "var(--np-surface-2, #1c2636)",
                color: isSelected ? "#000" : "var(--np-text, #e2e8f0)",
                border: "none",
                fontWeight: isSelected ? 600 : 400,
                cursor: "pointer",
              }}
              onClick={() => onSeverityChange(f.id)}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          className="np-btn np-btn--ghost"
          style={{
            fontSize: "0.8rem",
            padding: "0.35rem 0.75rem",
            borderRadius: "var(--np-radius-md, 8px)",
            border: "1px solid var(--np-accent, #2fe0d6)",
            color: "var(--np-accent, #2fe0d6)",
            whiteSpace: "nowrap",
          }}
          onClick={onClearFilters}
        >
          ✕ {t("clear_filter")}
        </button>
      )}
    </div>
  );
}
