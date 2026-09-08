// Website Journey — the flagship "what happened after I typed the URL?" view
// Reconstructs the complete page-load story stage by stage and narrates it.

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EvidenceRef } from "@netpulse/contract";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { Icon } from "../icons";
import { useJourneyController } from "../hooks/useJourneyController";
import { JourneyFlow, type JourneyFlowLabels } from "@netpulse/viz";
import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";

type KpiValueKind = "metric" | "status";

const KPI_STATUS_VALUES = new Set([
  "unavailable",
  "n/a",
  "pending",
  "skipped",
]);

function getKpiKind(val: string | number): KpiValueKind {
  return typeof val === "string" && KPI_STATUS_VALUES.has(val.trim().toLowerCase())
    ? "status"
    : "metric";
}

export function Journey() {
  const { t, i18n } = useTranslation(["journey", "common"]);
  const { navigationTarget, navigateToEvidence, clearNavigationTarget } = useEvidenceNavigation();

  const isSpanish = i18n.language?.startsWith("es");

  const journeyFlowLabels: JourneyFlowLabels = useMemo(
    () => ({
      trackAria: t("track_aria", { defaultValue: "Journey stage steps" }),
      stageHeader: (index, title) =>
        t("stage_header", { index, title, defaultValue: `Stage ${index}: ${title}` }),
      stageAriaLabel: (index, title) =>
        t("stage_aria_label", { index, title, defaultValue: `Stage ${index}: ${title}` }),
      stageTitle: (stage) =>
        isSpanish
          ? t(`stages.${stage.kind}`, { defaultValue: stage.title })
          : stage.title,
      stepIndicator: (current, total) =>
        t("step_indicator", { current, total, defaultValue: `Step ${current} of ${total}` }),
      stepPrev: t("step_prev", { defaultValue: "← Prev" }),
      stepPrevAria: t("step_prev_aria", { defaultValue: "Previous journey stage" }),
      stepNext: t("step_next", { defaultValue: "Next →" }),
      stepNextAria: t("step_next_aria", { defaultValue: "Next journey stage" }),
      evidenceLabel: t("evidence_label", { defaultValue: "Evidence & Trace:" }),
      fanoutTitle: t("fanout_title", { defaultValue: "Contacted Organizations & Servers Fan-out" }),
      fanoutAria: t("fanout_aria", { defaultValue: "Contacted Servers Fan-out" }),
      fanoutOrgAria: (orgName, hostCount, flowCount) =>
        t("fanout_org_aria", {
          name: orgName,
          hosts: t("hosts", { count: hostCount, defaultValue: `${hostCount} ${hostCount === 1 ? "host" : "hosts"}` }),
          flows: t("flows", { count: flowCount, defaultValue: `${flowCount} flows` }),
          defaultValue: `Organization ${orgName}, ${hostCount} ${hostCount === 1 ? "host" : "hosts"}, ${flowCount} flows`,
        }),
      hostsCount: (count) => t("hosts", { count, defaultValue: count === 1 ? "host" : "hosts" }),
      flowsCount: (count) => t("flows", { count, defaultValue: `${count} flows` }),
      stageBadge: (kind) => t(`stages.${kind}`, { defaultValue: kind.replace(/_/g, " ") }),
      stages: {
        navigation: t("stages.navigation"),
        dns_resolution: t("stages.dns_resolution"),
        connection: t("stages.connection"),
        encryption: t("stages.encryption"),
        request: t("stages.request"),
        fan_out: t("stages.fan_out"),
        completion: t("stages.completion"),
      },
    }),
    [t, isSpanish]
  );

  const {
    journey,
    loaded,
    error,
    activeSessionId,
    selectedSessionId,
    setSelectedSessionId,
    resetSelection,
    filteredSessions,
    searchQuery,
    setSearchQuery,
    selectedStageIndex,
    setSelectedStageIndex,
    summaryMetrics,
    refetch,
  } = useJourneyController();

  const handleClearFilter = useCallback(() => {
    clearNavigationTarget();
    resetSelection();
  }, [clearNavigationTarget, resetSelection]);

  const handleNavigateEvidence = useCallback(
    (ref: EvidenceRef, source?: NavigationSource) => {
      navigateToEvidence(ref, source ?? "journey");
    },
    [navigateToEvidence]
  );

  if (!loaded) {
    return (
      <section className="np-journey" aria-label="Loading website journey" aria-busy="true">
        {/* Layout-matched Skeleton Placeholders */}
        <div className="np-journey-summary">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div className="np-kpi" key={i}>
              <Skeleton variant="text" width="60%" height="12px" style={{ marginBottom: "8px" }} />
              <Skeleton variant="rounded" width="40%" height="24px" />
            </div>
          ))}
        </div>
        <Skeleton height={200} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={90} width="100%" style={{ borderRadius: "var(--np-radius-md)" }} />
          ))}
        </div>
      </section>
    );
  }

  const kpiItems = summaryMetrics
    ? [
        { label: t("summary_duration"), value: summaryMetrics.durationStr },
        { label: t("summary_ttfb"), value: summaryMetrics.ttfbStr },
        { label: t("summary_requests"), value: summaryMetrics.requests },
        { label: t("summary_organizations"), value: summaryMetrics.organizations },
        { label: t("summary_third_party"), value: summaryMetrics.thirdPartyCount },
        { label: t("summary_evidence"), value: summaryMetrics.evidenceCount },
      ]
    : [];

  return (
    <section className="np-journey" aria-label={t("title")}>
      {/* 1. Page Header */}
      <header style={{ marginBottom: "0.75rem" }}>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("hero_subtitle")}</p>
      </header>

      {/* Classified Multi-Action Error Notice Banners */}
      {error && (
        <div style={{ marginBottom: "var(--np-4)" }}>
          <Notice level="warning">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <strong>{t("error_loading")}:</strong> {error}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="np-btn np-btn--ghost" onClick={refetch}>
                  {t("common:actions.refresh")}
                </button>
                {selectedSessionId !== null && (
                  <button
                    type="button"
                    className="np-btn np-btn--ghost"
                    onClick={resetSelection}
                  >
                    {t("back_to_latest")}
                  </button>
                )}
              </div>
            </div>
          </Notice>
        </div>
      )}

      {/* 2. Session / Search Bar (True Neumorphic Instrument Bar) */}
      <div className="np-session-bar">
        <div className="np-session-bar__lead">
          <span className="np-session-bar__icon-gem" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <label htmlFor="journey-session-picker" className="np-session-bar__label">
            {t("select_session")}:
          </label>
        </div>

        {/* Search Input Container with Recessed Well */}
        <div className="np-session-bar__search-wrap">
          <span className="np-session-bar__search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            className="np-session-bar__input"
            placeholder={t("search_sessions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Custom Session Dropdown with Tactile Raised Button Styling */}
        <div className="np-session-bar__select-wrap">
          <select
            id="journey-session-picker"
            className="np-session-bar__select"
            value={activeSessionId ?? ""}
            onChange={(e) => setSelectedSessionId(Number(e.target.value) || null)}
          >
            {filteredSessions.length === 0 ? (
              <option value="" disabled>
                {t("no_sessions_found", { defaultValue: "No matching sessions" })}
              </option>
            ) : (
              filteredSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} · {s.domain} ({s.category})
                </option>
              ))
            )}
          </select>
        </div>

        {navigationTarget?.screen === "journey" && (
          <button
            type="button"
            className="np-session-bar__clear-btn"
            onClick={handleClearFilter}
            aria-label="Clear active session filter"
          >
            <Icon name="close" style={{ width: "13px", height: "13px" }} />
            {t("clear_filter")}
          </button>
        )}
      </div>

      {!journey || journey.stages.length === 0 ? (
        <EmptyState
          icon={<Icon name="journey" />}
          title={t("title", { defaultValue: "Page-Load Journey Reconstruction" })}
          description={t("empty")}
        />
      ) : (
        <>
          {/* 3. KPI Summary Grid with Status Geometry Protection */}
          {summaryMetrics && (
            <section aria-labelledby="journey-summary-title" style={{ marginBottom: "1.25rem" }}>
              <h2 id="journey-summary-title" className="np-dash__section-title">
                {t("summary_title")}
              </h2>
              <div className="np-journey-summary">
                {kpiItems.map((item, idx) => {
                  const kind = getKpiKind(item.value);
                  return (
                    <div className="np-kpi" key={idx}>
                      <div className="np-kpi__label">{item.label}</div>
                      <div className={`np-kpi__value ${kind === "status" ? "np-kpi__value--status" : ""}`}>
                        {item.value}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. JourneyFlow — Master–Detail Console */}
          <section aria-label="Journey Stage Diagram">
            <JourneyFlow
              stages={journey.stages}
              fanout={journey.fanout}
              selectedStageIndex={selectedStageIndex}
              onSelectStage={setSelectedStageIndex}
              onNavigate={handleNavigateEvidence}
              labels={journeyFlowLabels}
            />
          </section>

          {/* Screen Reader Live Region for Stage Selection */}
          <div className="np-sr-only" aria-live="polite" aria-atomic="true">
            {selectedStageIndex !== null && journey?.stages[selectedStageIndex]
              ? t("stage_selected_announcement", {
                  index: selectedStageIndex + 1,
                  title: isSpanish
                    ? t(`stages.${journey.stages[selectedStageIndex].kind}`, {
                        defaultValue: journey.stages[selectedStageIndex].title,
                      })
                    : journey.stages[selectedStageIndex].title,
                  defaultValue: `Selected stage ${selectedStageIndex + 1}: ${journey.stages[selectedStageIndex].title}`,
                })
              : ""}
          </div>
        </>
      )}
    </section>
  );
}

