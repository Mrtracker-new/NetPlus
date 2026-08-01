import { useTranslation } from "react-i18next";
import type { FleetStatus } from "../../hooks/useFleetController";

export interface FleetFiltersProps {
  search: string;
  onSearchChange: (query: string) => void;
  statusFilter: "all" | FleetStatus;
  onStatusFilterChange: (status: "all" | FleetStatus) => void;
}

export function FleetFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: FleetFiltersProps) {
  const { t } = useTranslation(["fleet"]);

  const chips: Array<{ key: "all" | FleetStatus; labelKey: string }> = [
    { key: "all", labelKey: "filters.status_all" },
    { key: "online", labelKey: "filters.status_online" },
    { key: "degraded", labelKey: "filters.status_degraded" },
    { key: "offline", labelKey: "filters.status_offline" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginBottom: "1.25rem",
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "0.85rem 1.25rem",
      }}
    >
      {/* Search Input */}
      <div style={{ flex: "1 1 240px", minWidth: "200px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("filters.search_placeholder")}
          style={{
            width: "100%",
            padding: "0.45rem 0.85rem",
            fontSize: "0.85rem",
            borderRadius: "var(--np-radius-md, 8px)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
            background: "var(--np-bg, #0b1019)",
            color: "var(--np-text, #e2e8f0)",
            outline: "none",
          }}
          aria-label={t("filters.search_placeholder")}
        />
      </div>

      {/* Status Filter Chips */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
        {chips.map((chip) => {
          const isActive = statusFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
              style={{
                fontSize: "0.8rem",
                padding: "0.3rem 0.75rem",
                borderRadius: "var(--np-radius-md, 8px)",
              }}
              onClick={() => onStatusFilterChange(chip.key)}
            >
              {t(chip.labelKey as any)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
