import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { useAppsController } from "../hooks/useAppsController";
import { AppsSummary } from "./Apps/AppsSummary";
import { AppsFilters } from "./Apps/AppsFilters";
import { ProcessRow } from "./Apps/ProcessRow";

export function Apps() {
  const { t } = useTranslation(["apps", "common"]);

  const {
    rows,
    groupedProcesses,
    summaryMetrics,
    searchQuery,
    setSearchQuery,
    confidenceFilter,
    setConfidenceFilter,
    targetFlowId,
    clearTargetFlow,
    expandedKeys,
    toggleExpandGroup,
    inspectFlow,
    loaded,
    notice,
    setNotice,
    announcement,
  } = useAppsController();

  if (!loaded) {
    return (
      <section className="np-apps" aria-label="Applications loading" aria-busy="true">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%" }}>
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
        </div>
      </section>
    );
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || confidenceFilter !== "all";

  return (
    <section className="np-apps" aria-label={t("title")}>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("hero_subtitle")}</p>
      </header>

      {/* Screen Reader Live Announcement Region */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Error Notice Banner */}
      <Notice message={notice} onDismiss={() => setNotice(null)} />

      {/* Filtered Target Flow Banner */}
      {targetFlowId !== null && (
        <div
          className="np-filter-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1.25rem",
            background: "var(--np-surface-1, #131b2a)",
            border: "1px solid var(--np-accent, #2fe0d6)",
            padding: "0.6rem 1rem",
            borderRadius: "var(--np-radius-md, 8px)",
          }}
          role="status"
        >
          <span>{t("filtered_banner", { flowId: targetFlowId })}</span>
          <button type="button" className="np-btn np-btn--ghost" onClick={clearTargetFlow}>
            ✕ {t("clear_filter")}
          </button>
        </div>
      )}

      {/* Classified Empty Capture State */}
      {rows.length === 0 ? (
        <EmptyState>
          {targetFlowId !== null ? t("empty_filtered", { flowId: targetFlowId }) : t("empty_default")}
        </EmptyState>
      ) : (
        <>
          {/* Header Summary KPI Cards */}
          <AppsSummary metrics={summaryMetrics} />

          {/* Search & Confidence Level Filter Bar */}
          <AppsFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            confidenceFilter={confidenceFilter}
            onConfidenceChange={setConfidenceFilter}
          />

          {/* Classified Filter Empty State vs Process Table */}
          {groupedProcesses.length === 0 ? (
            <div style={{ margin: "2rem 0" }}>
              <EmptyState>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                  <div>{t("empty_search")}</div>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="np-btn np-btn--primary"
                      onClick={() => {
                        setSearchQuery("");
                        setConfidenceFilter("all");
                      }}
                    >
                      {t("clear_filter")}
                    </button>
                  )}
                </div>
              </EmptyState>
            </div>
          ) : (
            <div
              className="np-table-container"
              style={{
                overflowX: "auto",
                background: "var(--np-surface-1, #131b2a)",
                border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
                borderRadius: "var(--np-radius-lg, 12px)",
                padding: "0.5rem",
                boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
              }}
            >
              <table
                aria-label={t("title")}
                style={{
                  width: "100%",
                  minWidth: "600px",
                  borderCollapse: "separate",
                  borderSpacing: "0 0.4rem",
                }}
              >
                <colgroup>
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--np-muted, #8b9bb4)", fontSize: "0.8rem" }}>
                    <th scope="col" style={{ padding: "0.5rem 0.85rem" }}>{t("table_headers.process")}</th>
                    <th scope="col" style={{ padding: "0.5rem 0.85rem" }}>{t("table_headers.pid")}</th>
                    <th scope="col" style={{ padding: "0.5rem 0.85rem" }}>{t("table_headers.flows")}</th>
                    <th scope="col" style={{ padding: "0.5rem 0.85rem" }}>{t("table_headers.confidence")}</th>
                    <th scope="col" style={{ padding: "0.5rem 0.85rem", textAlign: "right" }}>{t("table_headers.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedProcesses.map((group) => (
                    <ProcessRow
                      key={group.key}
                      group={group}
                      isExpanded={expandedKeys.has(group.key)}
                      onToggleExpand={toggleExpandGroup}
                      onInspectFlow={inspectFlow}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
