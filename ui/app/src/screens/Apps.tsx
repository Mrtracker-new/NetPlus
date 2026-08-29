import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { Icon } from "../icons";
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
        <header className="np-apps__header">
          <Skeleton height={32} width={280} />
          <div className="np-apps-skeleton__sub">
            <Skeleton height={18} width={420} />
          </div>
        </header>

        <div className="np-apps-summary">
          <Skeleton height={82} width="100%" />
          <Skeleton height={82} width="100%" />
          <Skeleton height={82} width="100%" />
          <Skeleton height={82} width="100%" />
        </div>

        <div className="np-apps-skeleton__bar">
          <Skeleton height={52} width="100%" />
        </div>

        <div className="np-apps-table-container">
          <Skeleton height={220} width="100%" />
        </div>
      </section>
    );
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || confidenceFilter !== "all";

  return (
    <section className="np-apps" aria-label={t("title")}>
      <header className="np-apps__header">
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
        <div className="np-apps-filter-banner" role="status">
          <span>{t("filtered_banner", { flowId: targetFlowId })}</span>
          <button
            type="button"
            className="np-btn np-btn--ghost np-apps-filter-banner__clear"
            onClick={clearTargetFlow}
          >
            <Icon name="close" style={{ width: "14px", height: "14px" }} />
            {t("clear_filter")}
          </button>
        </div>
      )}

      {/* Classified Empty Capture State */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon name="apps" />}
          title="Application Process Lineage"
          description={targetFlowId !== null ? t("empty_filtered", { flowId: targetFlowId }) : t("empty_default")}
        />
      ) : (
        <>
          {/* Header Summary KPI Cards */}
          <AppsSummary
            metrics={summaryMetrics}
            activeConfidence={confidenceFilter}
            onSelectConfidence={setConfidenceFilter}
          />

          {/* Search & Confidence Level Filter Bar */}
          <AppsFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            confidenceFilter={confidenceFilter}
            onConfidenceChange={setConfidenceFilter}
          />

          {/* Classified Filter Empty State vs Process Table */}
          {groupedProcesses.length === 0 ? (
            <div className="np-apps-empty-tray">
              <EmptyState
                compact
                title="No Matching Processes"
                description={t("empty_search")}
                action={
                  hasActiveFilters ? (
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
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="np-apps-table-container">
              <table className="np-apps-table" aria-label={t("title")}>
                <colgroup>
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="np-apps-th">{t("table_headers.process")}</th>
                    <th scope="col" className="np-apps-th">{t("table_headers.pid")}</th>
                    <th scope="col" className="np-apps-th">{t("table_headers.flows")}</th>
                    <th scope="col" className="np-apps-th">{t("table_headers.confidence")}</th>
                    <th scope="col" className="np-apps-th np-apps-th--right">{t("table_headers.actions")}</th>
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

