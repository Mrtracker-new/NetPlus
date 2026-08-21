import { memo } from "react";
import type { NarrativeCategory } from "./viewModels";

interface NarrativeFilterBarProps {
  category: NarrativeCategory;
  search: string;
  onSelectCategory: (category: NarrativeCategory) => void;
  onSearchChange: (search: string) => void;
  count: number;
  totalCount: number;
}

const CATEGORIES: Array<{ id: NarrativeCategory; label: string }> = [
  { id: "all", label: "All Activity" },
  { id: "findings", label: "Security Findings" },
  { id: "performance", label: "Performance & Latency" },
  { id: "dns", label: "DNS Queries" },
  { id: "tls", label: "TLS & HTTPS" },
  { id: "applications", label: "Applications" },
  { id: "network", label: "Network Flows" },
];

export const NarrativeFilterBar = memo(function NarrativeFilterBar({
  category,
  search,
  onSelectCategory,
  onSearchChange,
  count,
  totalCount,
}: NarrativeFilterBarProps) {
  return (
    <div className="np-filter-container" role="toolbar" aria-label="Narrative Feed Filters">
      <div className="np-filter-search-row">
        <div className="np-filter-search-input-wrap">
          <svg
            className="np-filter-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="np-filter-search-input"
            placeholder="Search processes (chrome, spotify), IPs (192.168), protocols (DNS, TLS)..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search narrative feed"
          />
          {search && (
            <button
              type="button"
              className="np-filter-search-clear"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="np-filter-counter-badge">
          <span>{count}</span> / {totalCount} cards
        </div>
      </div>

      <div className="np-filter-tabs-row" role="tablist" aria-label="Filter narratives by category">
        {CATEGORIES.map((cat, idx) => (
          <button
            key={cat.id}
            id={`tab-${cat.id}`}
            type="button"
            role="tab"
            tabIndex={category === cat.id ? 0 : -1}
            aria-selected={category === cat.id}
            aria-controls="dashboard-narrative-feed"
            className={`np-filter-tab-pill ${category === cat.id ? "np-filter-tab-pill--active" : ""}`}
            onClick={() => onSelectCategory(cat.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                const nextIdx = (idx + 1) % CATEGORIES.length;
                onSelectCategory(CATEGORIES[nextIdx]!.id);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                const prevIdx = (idx - 1 + CATEGORIES.length) % CATEGORIES.length;
                onSelectCategory(CATEGORIES[prevIdx]!.id);
              } else if (e.key === "Home") {
                e.preventDefault();
                onSelectCategory(CATEGORIES[0]!.id);
              } else if (e.key === "End") {
                e.preventDefault();
                onSelectCategory(CATEGORIES[CATEGORIES.length - 1]!.id);
              }
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>
    </div>
  );
});
