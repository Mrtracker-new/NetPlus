import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NarrativeCard, Severity, EvidenceRef } from "@netpulse/contract";
import { Button, EmptyState, EvidenceChips, Notice, Skeleton } from "@netpulse/components";
import { Constellation, GlobalTrafficMap, type SelectedEntity } from "@netpulse/viz";

import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";
import { useDisclosure } from "../modes/DisclosureContext";
import { useStore, setSnapshotBatch, setError } from "../state/store";
import { query } from "../ipc";
import { useDashboardController, cardMatchesCategory } from "./Dashboard/useDashboardController";
import type { RecommendationItem } from "./Dashboard/viewModels";
import { HealthStrip } from "./Dashboard/HealthStrip";
import { SituationSummary } from "./Dashboard/SituationSummary";
import { NarrativeFilterBar } from "./Dashboard/NarrativeFilterBar";
import { KpiCards } from "./Dashboard/KpiCards";
import { CardExplainBox } from "./Dashboard/CardExplainBox";
import { DiagnosticChainStrip } from "./Dashboard/DiagnosticChainStrip";
import { getActiveMonitorTimeRange } from "./Monitoring/MonitoringPreferences";
import { Icon } from "../icons";

export class WidgetErrorBoundary extends Component<
  { children: ReactNode; title: string },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error(`Widget Error in [${this.props.title}]:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="np-panel" style={{ border: "1px dashed var(--np-finding, #ef4444)", padding: "1.5rem" }}>
          <h3 style={{ color: "var(--np-finding, #ef4444)", margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>
            Widget Failure: {this.props.title}
          </h3>
          <p style={{ fontSize: "0.8rem", color: "var(--np-muted, #8b9bb4)", margin: "0 0 1rem 0" }}>
            {this.state.error}
          </p>
          <div>
            <button
              type="button"
              className="np-btn np-btn--ghost np-btn--sm"
              onClick={() => this.setState({ hasError: false, error: "" })}
            >
              Retry Widget
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SEVERITY_ICON: Record<Severity, ReactNode> = {
  neutral: <span className="np-card__pip np-card__pip--neutral" aria-hidden="true" />,
  notable: <span className="np-card__pip np-card__pip--notable" aria-hidden="true" />,
  finding: <Icon name="alertTriangle" className="np-card__finding-icon" style={{ width: "13px", height: "13px", display: "inline-block", verticalAlign: "middle" }} />,
};

interface CardProps {
  card: NarrativeCard;
  onNavigate: (ref: EvidenceRef, source?: NavigationSource) => void;
  onNavigateToScreen: (ref: EvidenceRef) => void;
}

function Card({ card, onNavigate, onNavigateToScreen }: CardProps) {
  const { t } = useTranslation("dashboard");
  const [showExplain, setShowExplain] = useState(false);

  const handleCardNavigate = useCallback(
    (ref: EvidenceRef) => {
      onNavigate(ref, "feed");
    },
    [onNavigate]
  );

  return (
    <article
      id={`card-${card.at_mono_nanos}`}
      data-evidence-id={card.evidence[0]?.id}
      className={`np-card np-card--${card.severity}`}
    >
      <header className="np-card__headline">
        <span aria-hidden="true" className="np-card__severity-icon">
          {SEVERITY_ICON[card.severity]}
        </span>{" "}
        {card.headline}
      </header>

      {card.summary && <p className="np-card__summary">{card.summary}</p>}

      {/* In-Card Collapsible Explanation & Technical Quick Peek Drawer */}
      {showExplain && (
        <CardExplainBox
          card={card}
          onNavigateToScreen={onNavigateToScreen}
          onClose={() => setShowExplain(false)}
        />
      )}

      <footer className="np-card__foot">
        <EvidenceChips evidence={card.evidence} onNavigate={handleCardNavigate} />
        <button
          type="button"
          className={`np-btn np-btn--sm ${showExplain ? "np-btn--primary" : "np-btn--ghost"}`}
          onClick={() => setShowExplain(!showExplain)}
          aria-expanded={showExplain}
          aria-label={t("explain_headline", { headline: card.headline, defaultValue: `Explain ${card.headline}` })}
        >
          {showExplain ? t("hide_explanation", "Hide Explanation") : t("explain", "Explain")}
        </button>
      </footer>
    </article>
  );
}

export interface DashboardProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function Dashboard({ loading = false, error: propsError = null, onRetry }: DashboardProps) {
  const { t } = useTranslation("dashboard");
  const { depth } = useDisclosure();
  const { error: storeError } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();
  const error = propsError ?? storeError;

  const {
    heroViewModel,
    situationSummaryModel,
    healthViewModel,
    kpiViewModels,
    category,
    search,
    vizMode,
    selectedEntity,
    captureSessionId,
    snapshotSequence,
    monitor,
    telemetryState,
    feed,
    feedCount,
    filteredNarratives,
    dispatchEvent,
    navigateToRecommendation,
  } = useDashboardController();

  const isLoading = loading || (monitor === null && !error);

  const hostRows = monitor?.by_host.rows ?? [];
  const [evidenceNotice, setEvidenceNotice] = useState<{
    message: string;
    ref?: EvidenceRef;
  } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const isRetryingRef = useRef(false);
  const isMountedRef = useRef(true);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const dismissEvidenceNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setEvidenceNotice(null);
  }, []);

  const handleNavigateToEvidence = useCallback(
    (ref: EvidenceRef) => {
      const targetCard = feed.find((c) =>
        c.evidence?.some((e) => e.kind === ref.kind && e.id === ref.id)
      );

      if (targetCard) {
        dismissEvidenceNotice();
        if (!cardMatchesCategory(targetCard, category)) {
          dispatchEvent({
            type: "SET_CATEGORY",
            category: targetCard.severity === "finding" ? "findings" : (targetCard.category ?? "all"),
          });
        }
        dispatchEvent({ type: "SET_SEARCH", search: "" });

        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }
        scrollTimerRef.current = setTimeout(() => {
          const cardElem =
            document.getElementById(`card-${targetCard.at_mono_nanos}`) ||
            document.querySelector(`[data-evidence-id="${ref.id}"]`);
          if (cardElem) {
            cardElem.scrollIntoView?.({ behavior: "smooth", block: "center" });
            cardElem.classList.remove("np-card--highlight-pulse");
            void (cardElem as HTMLElement).offsetWidth;
            cardElem.classList.add("np-card--highlight-pulse");
          }
          scrollTimerRef.current = null;
        }, 60);
      } else {
        if (noticeTimerRef.current) {
          clearTimeout(noticeTimerRef.current);
        }
        setEvidenceNotice({
          message: t("evidence_outside_feed", {
            kind: ref.kind === "flow" ? "flow" : ref.kind,
            id: ref.id,
            defaultValue: `Evidence ${ref.kind === "flow" ? "flow" : ref.kind} #${ref.id} is outside the active visible feed window.`,
          }),
          ref,
        });
        noticeTimerRef.current = setTimeout(() => {
          setEvidenceNotice(null);
          noticeTimerRef.current = null;
        }, 6000);
      }
    },
    [feed, category, dispatchEvent, dismissEvidenceNotice, t]
  );

  const handleRecommendationClick = useCallback(
    (rec: RecommendationItem) => {
      const { targetCard } = navigateToRecommendation(rec);

      if (targetCard) {
        dismissEvidenceNotice();

        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }
        scrollTimerRef.current = setTimeout(() => {
          const cardElem =
            document.getElementById(`card-${targetCard.at_mono_nanos}`) ||
            (rec.evidenceRef ? document.querySelector(`[data-evidence-id="${rec.evidenceRef.id}"]`) : null);
          if (cardElem) {
            cardElem.scrollIntoView?.({ behavior: "smooth", block: "center" });
            cardElem.classList.remove("np-card--highlight-pulse");
            void (cardElem as HTMLElement).offsetWidth;
            cardElem.classList.add("np-card--highlight-pulse");
          }
          scrollTimerRef.current = null;
        }, 60);
      } else if (rec.evidenceRef) {
        if (noticeTimerRef.current) {
          clearTimeout(noticeTimerRef.current);
        }
        setEvidenceNotice({
          message: t("evidence_outside_feed", {
            kind: rec.evidenceRef.kind === "flow" ? "flow" : rec.evidenceRef.kind,
            id: rec.evidenceRef.id,
            defaultValue: `Evidence ${rec.evidenceRef.kind === "flow" ? "flow" : rec.evidenceRef.kind} #${rec.evidenceRef.id} is outside the active visible feed window.`,
          }),
          ref: rec.evidenceRef,
        });
        noticeTimerRef.current = setTimeout(() => {
          setEvidenceNotice(null);
          noticeTimerRef.current = null;
        }, 6000);
      }
    },
    [navigateToRecommendation, dismissEvidenceNotice, t]
  );

  const handleNoticeNavigate = useCallback(() => {
    if (evidenceNotice?.ref) {
      navigateToEvidence(evidenceNotice.ref, "dashboard");
      dismissEvidenceNotice();
    }
  }, [evidenceNotice, navigateToEvidence, dismissEvidenceNotice]);

  const handleConstellationNavigate = useCallback(
    (ref: EvidenceRef) => {
      navigateToEvidence(ref, "feed");
    },
    [navigateToEvidence]
  );

  const handleNavigateToScreen = useCallback(
    (ref: EvidenceRef) => {
      navigateToEvidence(ref, "feed");
    },
    [navigateToEvidence]
  );

  const handleRetry = useCallback(async () => {
    if (isRetryingRef.current) return;
    isRetryingRef.current = true;
    setIsRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      } else {
        const time_range = getActiveMonitorTimeRange();
        const [feedRes, monRes] = await Promise.all([
          query({ kind: "narrativeFeed", depth }),
          query({ kind: "monitorSnapshot", time_range }),
        ]);
        const cards = feedRes.kind === "narrativeFeed" ? feedRes.cards : null;
        const snapshot = monRes.kind === "monitorSnapshot" ? monRes.snapshot : null;
        if (cards != null || snapshot != null) {
          setSnapshotBatch(cards, snapshot, null);
        } else {
          setError(null);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      isRetryingRef.current = false;
      if (isMountedRef.current) {
        setIsRetrying(false);
      }
    }
  }, [onRetry, depth]);

  return (
    <section className="np-dash" aria-label={t("title", "Network Dashboard")}>
      {/* 1. Capture & System Health Telemetry Strip */}
      <WidgetErrorBoundary title="System Health">
        <HealthStrip health={healthViewModel} />
      </WidgetErrorBoundary>

      {/* 2. Situation Summary & Dynamic Hero Header */}
      <WidgetErrorBoundary title="Situation Summary">
        <SituationSummary
          hero={heroViewModel}
          summary={situationSummaryModel}
          onRecommendationClick={handleRecommendationClick}
          onNavigateToEvidence={handleNavigateToEvidence}
        />
      </WidgetErrorBoundary>

      {/* 2.5 7-Stage Diagnostic Telemetry Chain */}
      <WidgetErrorBoundary title="Diagnostic Chain">
        <DiagnosticChainStrip
          chain={monitor?.diagnostic_chain}
          onNavigateToEvidence={handleNavigateToEvidence}
        />
      </WidgetErrorBoundary>

      {evidenceNotice && (
        <div style={{ marginBottom: "var(--np-4)" }}>
          <Notice>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <span>{evidenceNotice.message}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {evidenceNotice.ref && (
                  <button
                    type="button"
                    className="np-btn np-btn--primary np-btn--sm"
                    onClick={handleNoticeNavigate}
                  >
                    {t("view_in_apps_timeline", "View in Apps / Timeline →")}
                  </button>
                )}
                <button
                  type="button"
                  className="np-btn np-btn--ghost np-btn--sm"
                  onClick={dismissEvidenceNotice}
                >
                  {t("common:actions.dismiss", "Dismiss")}
                </button>
              </div>
            </div>
          </Notice>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: "var(--np-4)" }}>
          <Notice level="warning">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <strong>{t("error_backend_disconnected_title")}:</strong>{" "}
                {error || t("error_backend_disconnected_desc")}
              </div>
              <Button
                type="button"
                variant="ghost"
                busy={isRetrying}
                disabled={isRetrying}
                onClick={handleRetry}
              >
                {t("retry_connection")}
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {/* 3. Dynamic KPI Cards with Micro-Sparklines & Status Badges */}
      <WidgetErrorBoundary title="KPI Metrics">
        <KpiCards kpis={kpiViewModels} loading={isLoading} />
      </WidgetErrorBoundary>

      {/* 4. Live Global Traffic Map / Constellation Topology Switcher */}
      <WidgetErrorBoundary title="Live Network Telemetry">
        <section aria-labelledby="dashboard-live-title" role="region">
          <div className="np-dash__section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--np-2)" }}>
              <h2 id="dashboard-live-title" className="np-dash__section-title">
                {vizMode === "map" ? t("global_traffic_map", "Global Traffic Map") : t("live_traffic")}
              </h2>
              {telemetryState === "standby" ? (
                <span className="np-telemetry-badge np-telemetry-badge--standby np-telemetry-badge--quiet" aria-label="Telemetry Standby">
                  <span>{t("telemetry_state.standby", "STANDBY")}</span>
                </span>
              ) : telemetryState === "stale" ? (
                <span className="np-telemetry-badge np-telemetry-badge--stale" aria-label="Telemetry Stale">
                  <span>{t("telemetry_state.stale", "STALE")}</span>
                </span>
              ) : telemetryState === "unavailable" ? (
                <span className="np-telemetry-badge np-telemetry-badge--unavailable np-telemetry-badge--quiet" aria-label="Telemetry Unavailable">
                  <span>{t("telemetry_state.unavailable", "UNAVAILABLE")}</span>
                </span>
              ) : (
                <span className="np-telemetry-badge np-telemetry-badge--active" aria-label="Live Telemetry Active">
                  <span className="np-pulse-dot" aria-hidden="true" />
                  <span>{t("telemetry_state.live", "LIVE TELEMETRY")}</span>
                </span>
              )}
            </div>
            <div className="np-viz-mode-toggle" role="group" aria-label="Traffic visualization mode">
              <button
                type="button"
                className={`np-viz-mode-btn ${vizMode === "map" ? "np-viz-mode-btn--active" : ""}`}
                onClick={() => dispatchEvent({ type: "SET_VIZ_MODE", mode: "map" })}
                aria-pressed={vizMode === "map"}
              >
                <svg
                  className="np-viz-mode-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>{t("viz_mode.map", "GLOBAL MAP")}</span>
              </button>
              <button
                type="button"
                className={`np-viz-mode-btn ${vizMode === "topology" ? "np-viz-mode-btn--active" : ""}`}
                onClick={() => dispatchEvent({ type: "SET_VIZ_MODE", mode: "topology" })}
                aria-pressed={vizMode === "topology"}
              >
                <svg
                  className="np-viz-mode-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span>{t("viz_mode.topology", "TOPOLOGY")}</span>
              </button>
            </div>
          </div>
          {isLoading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "400px",
                background: "var(--np-surface-1)",
                borderRadius: "var(--np-radius-lg)",
              }}
            >
              <Skeleton variant="circular" width="280px" height="280px" />
            </div>
          ) : vizMode === "map" ? (
            <GlobalTrafficMap
              hosts={hostRows}
              captureSessionId={captureSessionId}
              snapshotSequence={snapshotSequence}
              selectedEntity={selectedEntity}
              onSelectEntity={(entity: SelectedEntity | null) => dispatchEvent({ type: "SET_SELECTED_ENTITY", entity })}
              onNavigate={handleConstellationNavigate}
            />
          ) : (
            <Constellation
              hosts={hostRows}
              lossIndicators={monitor?.network_loss_indicators ?? 0}
              selectedEntity={selectedEntity}
              onSelectEntity={(entity: SelectedEntity | null) => dispatchEvent({ type: "SET_SELECTED_ENTITY", entity })}
              onNavigate={handleConstellationNavigate}
            />
          )}
        </section>
      </WidgetErrorBoundary>

      {/* 5. Filtered Narrative Feed ("What's Happening") */}
      <WidgetErrorBoundary title="Narrative Feed">
        <section id="dashboard-narrative-feed" aria-labelledby="dashboard-feed-title" role="region">
          <div className="np-dash__section-header">
            <h2 id="dashboard-feed-title" className="np-dash__section-title">
              {t("whats_happening")}
            </h2>
          </div>

          {/* Narrative Feed Filter & Search Toolbar */}
          <NarrativeFilterBar
            category={category}
            search={search}
            onSelectCategory={(cat) => dispatchEvent({ type: "SET_CATEGORY", category: cat })}
            onSearchChange={(s) => dispatchEvent({ type: "SET_SEARCH", search: s })}
            count={filteredNarratives.length}
            totalCount={feedCount}
          />

          {loading ? (
            <div className="np-feed">
              {[1, 2].map((i) => (
                <div key={i} className="np-card" style={{ padding: "var(--np-5)" }}>
                  <Skeleton variant="text" width="50%" height="16px" style={{ marginBottom: "12px" }} />
                  <Skeleton variant="text" width="85%" height="14px" style={{ marginBottom: "8px" }} />
                  <Skeleton variant="text" width="30%" height="12px" />
                </div>
              ))}
            </div>
          ) : filteredNarratives.length === 0 ? (
            <EmptyState
              compact
              title={search || category !== "all" ? t("no_matching_narratives", "No Matching Narratives") : t("no_traffic")}
              description={
                search || category !== "all"
                  ? t("no_matching_narratives_desc", "No narrative items match your search or filter criteria.")
                  : t("no_traffic_desc", "Start packet capture or select an active network adapter in the header bar to observe real-time network activity.")
              }
              action={
                (search || category !== "all") ? (
                  <button
                    type="button"
                    className="np-btn np-btn--ghost np-btn--sm"
                    onClick={() => {
                      dispatchEvent({ type: "SET_CATEGORY", category: "all" });
                      dispatchEvent({ type: "SET_SEARCH", search: "" });
                    }}
                  >
                    {t("reset_filters", "Reset Filters")}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="np-feed">
              {filteredNarratives.map((card) => (
                <Card
                  key={`${card.at_mono_nanos}-${card.headline}`}
                  card={card}
                  onNavigate={handleNavigateToScreen}
                  onNavigateToScreen={handleNavigateToScreen}
                />
              ))}
            </div>
          )}
        </section>
      </WidgetErrorBoundary>
    </section>
  );
}
