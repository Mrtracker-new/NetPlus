// Timeline — "what happened, and when?". One shared time axis with the
// reconstructed events laned by severity, so anything at the same moment lines up
// vertically.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Notice } from "@netpulse/components";
import { Icon } from "../icons";
import { useTimelineController } from "../hooks/useTimelineController";
import { TimeRibbon } from "@netpulse/viz";
import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";
import { TimelineSummary } from "./Timeline/TimelineSummary";
import { TimelineFilters } from "./Timeline/TimelineFilters";
import { TimelineInspector } from "./Timeline/TimelineInspector";

export function Timeline() {
  const { t } = useTranslation(["timeline", "common"]);
  const { navigateToEvidence } = useEvidenceNavigation();

  const {
    events,
    filteredEvents,
    summaryMetrics,
    axisTicks,
    selectedEvent,
    selectedEventIndex,
    searchQuery,
    severityFilter,
    highlightPacketId,
    highlightTimestamp,
    announcement,
    actions,
  } = useTimelineController();

  const handleNavigateEvidence = useCallback(
    (ref: any, source?: NavigationSource) => {
      navigateToEvidence(ref, source ?? "timeline");
    },
    [navigateToEvidence]
  );

  const hasActiveFilters = searchQuery.trim().length > 0 || severityFilter !== "all" || highlightPacketId !== undefined;

  return (
    <section className="np-timeline" aria-label={t("title")}>
      <header style={{ marginBottom: "1rem" }}>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("hero_subtitle")}</p>
      </header>

      {/* Screen Reader Live Announcement Region */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Highlight Filter Banner */}
      {highlightPacketId !== undefined && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Notice level="warning">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{t("filter_banner", { packetId: highlightPacketId })}</span>
              <button
                type="button"
                className="np-btn np-btn--ghost"
                style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
                onClick={actions.clearFilters}
              >
                ✕ {t("clear_filter")}
              </button>
            </div>
          </Notice>
        </div>
      )}

      {/* Classified Capture Empty State */}
      {events.length === 0 ? (
        <EmptyState
          icon={<Icon name="timeline" />}
          title="Timeline Awaiting Traffic"
          description={t("empty")}
        />
      ) : (
        <>
          {/* Summary KPI Header Card */}
          {summaryMetrics && <TimelineSummary metrics={summaryMetrics} />}

          {/* Search & Severity Filter Bar */}
          <TimelineFilters
            searchQuery={searchQuery}
            onSearchChange={actions.setSearchQuery}
            severityFilter={severityFilter}
            onSeverityChange={actions.setSeverityFilter}
            onClearFilters={actions.clearFilters}
            hasActiveFilters={hasActiveFilters}
          />

          {/* Classified Filter Empty State vs Ribbon View */}
          {filteredEvents.length === 0 ? (
            <div style={{ margin: "2rem 0" }}>
              <EmptyState
                compact
                title="No Matching Events"
                description={t("no_match")}
                action={
                  <button type="button" className="np-btn np-btn--primary" onClick={actions.clearFilters}>
                    {t("clear_filter")}
                  </button>
                }
              />
            </div>
          ) : (
            <>
              {/* Interactive Native Button TimeRibbon */}
              <TimeRibbon
                events={filteredEvents}
                highlightPacketId={highlightPacketId}
                highlightTimestamp={highlightTimestamp}
                selectedIndex={selectedEventIndex}
                onSelectEvent={actions.selectEvent}
                axisTicks={axisTicks}
              />

              {/* Selected Event Detail Inspector Card */}
              {selectedEvent && selectedEventIndex !== null && (
                <TimelineInspector
                  event={selectedEvent}
                  currentIndex={selectedEventIndex}
                  totalCount={filteredEvents.length}
                  onPrev={actions.selectPrevEvent}
                  onNext={actions.selectNextEvent}
                  onNavigateEvidence={handleNavigateEvidence}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
