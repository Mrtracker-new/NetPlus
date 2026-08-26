import { memo, useRef, type ReactNode } from "react";
import type { NarrativeCategory } from "./viewModels";

interface NarrativeFilterBarProps {
  category: NarrativeCategory;
  search: string;
  onSelectCategory: (category: NarrativeCategory) => void;
  onSearchChange: (search: string) => void;
  count: number;
  totalCount: number;
}

interface CategoryDefinition {
  id: NarrativeCategory;
  label: string;
  icon: ReactNode;
}

const CATEGORIES: CategoryDefinition[] = [
  {
    id: "all",
    label: "All Activity",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "findings",
    label: "Security Findings",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    id: "performance",
    label: "Performance & Latency",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "dns",
    label: "DNS Queries",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    id: "tls",
    label: "TLS & HTTPS",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    id: "applications",
    label: "Applications",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" />
        <line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" />
        <line x1="15" y1="20" x2="15" y2="23" />
        <line x1="20" y1="9" x2="23" y2="9" />
        <line x1="20" y1="14" x2="23" y2="14" />
        <line x1="1" y1="9" x2="4" y2="9" />
        <line x1="1" y1="14" x2="4" y2="14" />
      </svg>
    ),
  },
  {
    id: "network",
    label: "Network Flows",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
  },
];

export const NarrativeFilterBar = memo(function NarrativeFilterBar({
  category,
  search,
  onSelectCategory,
  onSearchChange,
  count,
  totalCount,
}: NarrativeFilterBarProps) {
  const tabRefs = useRef<Map<NarrativeCategory, HTMLButtonElement>>(new Map());

  const focusAndSelect = (catId: NarrativeCategory) => {
    onSelectCategory(catId);
    const targetBtn = tabRefs.current.get(catId);
    if (targetBtn) {
      targetBtn.focus();
      targetBtn.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  };

  return (
    <div className="np-filter-container" aria-label="Narrative Feed Filters">
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
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                e.preventDefault();
                onSearchChange("");
              }
            }}
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

        <div className="np-filter-counter-badge" aria-live="polite" aria-atomic="true">
          <span><strong>{count}</strong> / {totalCount} cards</span>
        </div>
      </div>

      <div
        className="np-filter-tabs-row"
        role="tablist"
        aria-label="Filter narrative feed by category"
        aria-orientation="horizontal"
      >
        {CATEGORIES.map((cat, idx) => {
          const isSelected = category === cat.id;
          return (
            <button
              key={cat.id}
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(cat.id, el);
                } else {
                  tabRefs.current.delete(cat.id);
                }
              }}
              id={`tab-${cat.id}`}
              type="button"
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              aria-selected={isSelected}
              aria-controls="dashboard-narrative-feed"
              className={`np-filter-tab-pill ${isSelected ? "np-filter-tab-pill--active" : ""}`}
              onClick={() => onSelectCategory(cat.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  const nextIdx = (idx + 1) % CATEGORIES.length;
                  focusAndSelect(CATEGORIES[nextIdx]!.id);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  const prevIdx = (idx - 1 + CATEGORIES.length) % CATEGORIES.length;
                  focusAndSelect(CATEGORIES[prevIdx]!.id);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  focusAndSelect(CATEGORIES[0]!.id);
                } else if (e.key === "End") {
                  e.preventDefault();
                  focusAndSelect(CATEGORIES[CATEGORIES.length - 1]!.id);
                }
              }}
            >
              <span className="np-filter-tab-icon" aria-hidden="true">
                {cat.icon}
              </span>
              <span className="np-filter-tab-label">{cat.label}</span>
              {isSelected && <span className="np-filter-tab-indicator" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
});
