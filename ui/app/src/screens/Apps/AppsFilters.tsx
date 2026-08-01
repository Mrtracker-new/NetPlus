import { useTranslation } from "react-i18next";
import type { ConfidenceFilterOption } from "../../hooks/useAppsController";

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

  return (
    <div
      className="np-apps-filters"
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

      {/* Confidence Level Filter Buttons */}
      <div
        className="np-filter-group"
        role="group"
        aria-label="Filter applications by attribution confidence"
        style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}
      >
        {filters.map((f) => {
          const isSelected = confidenceFilter === f.id;
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
              onClick={() => onConfidenceChange(f.id)}
            >
              {t(f.labelKey as any)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
