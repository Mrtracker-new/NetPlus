import { useTranslation } from "react-i18next";
import type { PluginFilter } from "../../hooks/usePluginsController";

export interface PluginsFiltersProps {
  filter: PluginFilter;
  counts: Record<PluginFilter, number>;
  onFilterChange: (f: PluginFilter) => void;
}

export function PluginsFilters({ filter, counts, onFilterChange }: PluginsFiltersProps) {
  const { t } = useTranslation(["plugins"]);

  const safeCounts = counts || {
    all: 0,
    dissector: 0,
    enrichment: 0,
    detector: 0,
    view: 0,
    export: 0,
  };

  const filters: { key: PluginFilter; label: string }[] = [
    { key: "all", label: t("filters.all", { count: safeCounts.all ?? 0 }) },
    { key: "dissector", label: t("filters.dissector", { count: safeCounts.dissector ?? 0 }) },
    { key: "enrichment", label: t("filters.enrichment", { count: safeCounts.enrichment ?? 0 }) },
    { key: "detector", label: t("filters.detector", { count: safeCounts.detector ?? 0 }) },
    { key: "view", label: t("filters.view", { count: safeCounts.view ?? 0 }) },
    { key: "export", label: t("filters.export", { count: safeCounts.export ?? 0 }) },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Plugin Type Filters"
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
            role="radio"
            aria-checked={isActive}
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
