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
          <span className="np-filter-search-icon" aria-hidden="true">🔍</span>
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
              ✕
            </button>
          )}
        </div>

        <div className="np-filter-counter-badge">
          <span>{count}</span> / {totalCount} cards
        </div>
      </div>

      <div className="np-filter-tabs-row" role="tablist">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            className={`np-filter-tab-pill ${category === cat.id ? "np-filter-tab-pill--active" : ""}`}
            onClick={() => onSelectCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>
    </div>
  );
});
