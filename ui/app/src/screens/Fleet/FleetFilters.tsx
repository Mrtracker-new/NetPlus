import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
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
    <div className="np-fleet__filters">
      {/* Search Input */}
      <div style={{ flex: "1 1 240px", minWidth: "200px" }}>
        <input
          type="text"
          className="np-fleet__search-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("filters.search_placeholder")}
          aria-label={t("filters.search_placeholder")}
        />
      </div>

      {/* Status Filter Chips */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
        {chips.map((chip) => {
          const isActive = statusFilter === chip.key;
          return (
            <Button
              key={chip.key}
              variant={isActive ? "primary" : "standard"}
              onClick={() => onStatusFilterChange(chip.key)}
            >
              {t(chip.labelKey as any)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
