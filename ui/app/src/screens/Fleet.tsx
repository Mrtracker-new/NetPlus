import { useTranslation } from "react-i18next";
import { Button, Notice, Skeleton, EmptyState } from "@netpulse/components";
import { Icon } from "../icons";
import { useFleetController } from "../hooks/useFleetController";
import { FleetSummaryKpis } from "./Fleet/FleetSummaryKpis";
import { FleetFilters } from "./Fleet/FleetFilters";
import { FleetNodeCard } from "./Fleet/FleetNodeCard";

export function FleetScreen() {
  const { t } = useTranslation(["fleet", "common"]);
  const {
    hosts,
    filteredHosts,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    summary,
    loaded,
    refreshing,
    notice,
    setNotice,
    lastSyncedTime,
    refresh,
    announcement,
  } = useFleetController();

  return (
    <section className="np-fleet" aria-label={t("title")}>
      {/* Screen Reader Live Announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ margin: "0 0 0.25rem 0", color: "var(--np-text)" }}>{t("title")}</h2>
          <p className="np-fleet__desc" style={{ margin: 0, color: "var(--np-subtext)" }}>
            {t("desc")}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {lastSyncedTime && (
            <span style={{ fontSize: "0.8rem", color: "var(--np-subtext)", fontFamily: "var(--np-font-mono)" }}>
              {t("sync_time", { time: lastSyncedTime })}
            </span>
          )}
          <Button variant="standard" busy={refreshing} disabled={refreshing} onClick={refresh}>
            <Icon name="fleet" style={{ width: 14, height: 14, marginRight: "0.4rem" }} />
            {refreshing ? t("actions.refreshing") : t("actions.refresh")}
          </Button>
        </div>
      </div>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Fleet Summary KPIs Bar */}
      <FleetSummaryKpis summary={summary} />

      {/* Search & Status Filters */}
      <FleetFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* Main Node List */}
      {!loaded ? (
        <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Skeleton height="80px" />
          <Skeleton height="80px" />
          <Skeleton height="80px" />
        </div>
      ) : hosts.length === 0 ? (
        <EmptyState
          icon={<Icon name="fleet" />}
          title="Standalone Local Node"
          description={t("empty")}
        />
      ) : filteredHosts.length === 0 ? (
        <EmptyState
          compact
          title="No Matching Nodes"
          description={t("no_filter_matches")}
          action={
            <button
              type="button"
              className="np-btn np-btn--ghost np-btn--sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Reset Filters
            </button>
          }
        />
      ) : (
        <div className="np-fleet__grid" role="list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filteredHosts.map((h) => (
            <FleetNodeCard key={h.hostId} host={h} />
          ))}
        </div>
      )}
    </section>
  );
}
