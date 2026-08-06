// Website Journey — the flagship "what happened after I typed the URL?" view
//Reconstructs the complete page-load story stage by stage and narrates it.

import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { EvidenceRef } from "@netpulse/contract";
import { EmptyState, Notice, Skeleton, EvidenceChips } from "@netpulse/components";
import { useJourneyController } from "../hooks/useJourneyController";
import { JourneyFlow, STAGE_CONFIG_REGISTRY } from "@netpulse/viz";
import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";

export function Journey() {
  const { t } = useTranslation(["journey", "common"]);
  const { navigationTarget, navigateToEvidence, clearNavigationTarget } = useEvidenceNavigation();
  const stageRefs = useRef<Array<HTMLLIElement | null>>([]);

  const {
    journey,
    loaded,
    error,
    activeSessionId,
    selectedSessionId,
    setSelectedSessionId,
    filteredSessions,
    searchQuery,
    setSearchQuery,
    selectedStageIndex,
    setSelectedStageIndex,
    summaryMetrics,
    refetch,
  } = useJourneyController();

  // Scroll into view centered when selectedStageIndex changes
  useEffect(() => {
    if (selectedStageIndex !== null && stageRefs.current[selectedStageIndex]) {
      const el = stageRefs.current[selectedStageIndex];
      if (typeof el?.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [selectedStageIndex]);

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
        <div className="np-journey-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
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

  return (
    <section className="np-journey" aria-label={t("title")}>
      <header style={{ marginBottom: "1rem" }}>
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
                    onClick={() => setSelectedSessionId(null)}
                  >
                    {t("back_to_latest")}
                  </button>
                )}
              </div>
            </div>
          </Notice>
        </div>
      )}

      {/* Searchable Session Selector Bar */}
      <div
        className="np-session-selector"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.75rem",
          background: "var(--np-surface-1, #131b2a)",
          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
          backdropFilter: "blur(12px)",
          padding: "0.85rem 1.25rem",
          borderRadius: "var(--np-radius-lg, 12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", whiteSpace: "nowrap" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--np-accent, #2fe0d6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <label htmlFor="journey-session-picker" style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--np-text)" }}>
            {t("select_session")}:
          </label>
        </div>

        {/* Search Input Container with Icon */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", flex: "1 1 240px", minWidth: "200px" }}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "0.75rem",
              display: "flex",
              alignItems: "center",
              color: "var(--np-muted, #8b9bb4)",
              pointerEvents: "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            placeholder={t("search_sessions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "0.45rem 0.75rem 0.45rem 2.2rem",
              fontSize: "0.85rem",
              borderRadius: "var(--np-radius-md, 8px)",
              border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.12))",
              background: "var(--np-bg, #0b1019)",
              color: "var(--np-text, #e2e8f0)",
              outline: "none",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            }}
          />
        </div>

        {/* Custom Session Dropdown */}
        <div style={{ flex: "2 1 280px", minWidth: "220px" }}>
          <select
            id="journey-session-picker"
            value={activeSessionId ?? ""}
            onChange={(e) => setSelectedSessionId(Number(e.target.value) || null)}
            style={{
              width: "100%",
              padding: "0.45rem 0.85rem",
              fontSize: "0.85rem",
              fontWeight: 500,
              borderRadius: "var(--np-radius-md, 8px)",
              background: "var(--np-bg, #0b1019)",
              color: "var(--np-text, #e2e8f0)",
              border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.12))",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {filteredSessions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} · {s.domain} ({s.category})
              </option>
            ))}
          </select>
        </div>

        {navigationTarget?.screen === "journey" && (
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{
              fontSize: "0.8rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--np-radius-md, 8px)",
              border: "1px solid var(--np-accent, #2fe0d6)",
              color: "var(--np-accent, #2fe0d6)",
              whiteSpace: "nowrap",
            }}
            onClick={clearNavigationTarget}
          >
            ✕ {t("clear_filter")}
          </button>
        )}
      </div>

      {!journey ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          {/* Journey Summary Header Card */}
          {summaryMetrics && (
            <section aria-labelledby="journey-summary-title" style={{ marginBottom: "1.5rem" }}>
              <h2 id="journey-summary-title" className="np-dash__section-title">
                {t("summary_title")}
              </h2>
              <div
                className="np-journey-summary"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: "1rem",
                }}
              >
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_duration")}</div>
                <div className="np-kpi__value">{summaryMetrics.durationStr}</div>
              </div>
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_ttfb")}</div>
                <div className="np-kpi__value">{summaryMetrics.ttfbStr}</div>
              </div>
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_requests")}</div>
                <div className="np-kpi__value">{summaryMetrics.requests}</div>
              </div>
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_organizations")}</div>
                <div className="np-kpi__value">{summaryMetrics.organizations}</div>
              </div>
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_third_party")}</div>
                <div className="np-kpi__value">{summaryMetrics.thirdPartyCount}</div>
              </div>
              <div className="np-kpi">
                <div className="np-kpi__label">{t("summary_evidence")}</div>
                <div className="np-kpi__value">{summaryMetrics.evidenceCount}</div>
              </div>
            </div>
          </section>
        )}

          {/* Signature flow diagram with packet links & collapsible fan-out */}
          <section aria-label="Journey Stage Diagram">
            <JourneyFlow
              stages={journey.stages}
              fanout={journey.fanout}
              selectedStageIndex={selectedStageIndex}
              onSelectStage={setSelectedStageIndex}
              onNavigate={handleNavigateEvidence}
            />
          </section>

          {/* Screen Reader Live Region for Stage Selection */}
          <div className="np-sr-only" aria-live="polite" aria-atomic="true">
            {selectedStageIndex !== null && journey?.stages[selectedStageIndex]
              ? `Selected stage ${selectedStageIndex + 1}: ${journey.stages[selectedStageIndex].title}`
              : ""}
          </div>

          {/* Mini Progress Step Timeline Bar for 3-Way Sync */}
          <div
            className="np-journey__stepper"
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "1.5rem",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "0.5rem",
            }}
            role="tablist"
            aria-label="Progress timeline stepper"
          >
            {journey.stages.map((st, i) => {
              const isSelected = selectedStageIndex === i;
              const config = STAGE_CONFIG_REGISTRY[st.kind];
              return (
                <button
                  type="button"
                  key={`step-${st.kind}-${i}`}
                  role="tab"
                  aria-selected={isSelected}
                  aria-label={`Step ${i + 1}: ${st.title}`}
                  onClick={() => setSelectedStageIndex(i)}
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.75rem",
                    borderRadius: "var(--np-radius-full, 9999px)",
                    background: isSelected ? "var(--np-accent, #2fe0d6)" : "var(--np-surface-2, #1c2636)",
                    color: isSelected ? "#000" : "var(--np-text)",
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {config?.glyph} {st.title}
                </button>
              );
            })}
          </div>

          {/* Detailed Stage Narration List with 3-Way Synchronization */}
          <ol className="np-journey__stages" style={{ marginTop: "1rem" }}>
            {journey.stages.map((stage, i) => {
              const isSelected = selectedStageIndex === i;
              const config = STAGE_CONFIG_REGISTRY[stage.kind];

              return (
                <li
                  key={`${stage.kind}-${i}`}
                  ref={(el) => {
                    stageRefs.current[i] = el;
                  }}
                  tabIndex={0}
                  role="tab"
                  aria-selected={isSelected}
                  aria-label={`Stage ${i + 1}: ${stage.title}`}
                  className={`np-stage ${isSelected ? "np-stage--active" : ""}`}
                  onClick={() => setSelectedStageIndex(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedStageIndex(i);
                    }
                  }}
                  style={{
                    outline: isSelected ? "2px solid var(--np-accent, #2fe0d6)" : undefined,
                    outlineOffset: "2px",
                    borderRadius: "var(--np-radius-md, 6px)",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div className="np-stage__title">
                    <span aria-hidden="true" style={{ marginRight: "0.5rem" }}>
                      {config?.glyph ?? "•"}
                    </span>
                    {stage.title}
                  </div>
                  <p className="np-stage__narration">{stage.narration}</p>
                  {stage.detail && <p className="np-stage__detail">{stage.detail}</p>}
                  <EvidenceChips evidence={stage.evidence} onNavigate={handleNavigateEvidence} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
