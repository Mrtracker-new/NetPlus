import { Component, type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NarrativeCard, Severity, EvidenceRef } from "@netpulse/contract";
import { EmptyState, EvidenceChips, Notice, Skeleton } from "@netpulse/components";
import { Constellation, GlobalTrafficMap, type SelectedEntity } from "@netpulse/viz";

import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";
import { useDisclosure } from "../modes/DisclosureContext";
import { useStore, setMonitor, setFeed, setError } from "../state/store";
import { query } from "../ipc";
import { useDashboardController } from "./Dashboard/useDashboardController";
import { HealthStrip } from "./Dashboard/HealthStrip";
import { SituationSummary } from "./Dashboard/SituationSummary";
import { NarrativeFilterBar } from "./Dashboard/NarrativeFilterBar";
import { KpiCards } from "./Dashboard/KpiCards";
import { CardExplainBox } from "./Dashboard/CardExplainBox";
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
  neutral: "•",
  notable: "◆",
  finding: <Icon name="alertTriangle" style={{ width: "12px", height: "12px", display: "inline-block", verticalAlign: "middle" }} />,
};

interface CardProps {
  card: NarrativeCard;
  onNavigate: (ref: EvidenceRef, source?: NavigationSource) => void;
  onNavigateToScreen: (ref: EvidenceRef) => void;
}

function Card({ card, onNavigate, onNavigateToScreen }: CardProps) {
  const [showExplain, setShowExplain] = useState(false);

  const handleCardNavigate = useCallback(
    (ref: EvidenceRef) => {
      onNavigate(ref, "feed");
    },
    [onNavigate]
  );

  return (
    <article className={`np-card np-card--${card.severity}`}>
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
          aria-label={`Explain ${card.headline}`}
        >
          {showExplain ? "Hide Explanation" : "Explain"}
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
  const { monitor, error: storeError } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();
  const hostRows = monitor?.by_host.rows ?? [];
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
    feedCount,
    filteredNarratives,
    dispatchEvent,
  } = useDashboardController();

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

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      Promise.all([
        query({ kind: "narrativeFeed", from_mono_nanos: 0, to_mono_nanos: Number.MAX_SAFE_INTEGER, depth }),
        query({ kind: "monitorSnapshot", from_mono_nanos: 0, to_mono_nanos: Number.MAX_SAFE_INTEGER }),
      ])
        .then(([feedRes, monRes]) => {
          if (feedRes.kind === "narrativeFeed") {
            setFeed(feedRes.cards);
          }
          if (monRes.kind === "monitorSnapshot") {
            setMonitor(monRes.snapshot);
          }
          setError(null);
        })
        .catch((e) => {
          setError(String(e));
        });
    }
  }, [onRetry, depth]);

  return (
    <section className="np-dash" aria-label="Network Dashboard">
      {/* 1. Capture & System Health Telemetry Strip */}
      <WidgetErrorBoundary title="System Health">
        <HealthStrip health={healthViewModel} />
      </WidgetErrorBoundary>

      {/* 2. Situation Summary & Dynamic Hero Header */}
      <WidgetErrorBoundary title="Situation Summary">
        <SituationSummary
          hero={heroViewModel}
          summary={situationSummaryModel}
          onSelectCategory={(cat) => dispatchEvent({ type: "SET_CATEGORY", category: cat })}
        />
      </WidgetErrorBoundary>

      {error && (
        <div style={{ marginBottom: "var(--np-4)" }}>
          <Notice level="warning">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <strong>{t("error_backend_disconnected_title")}:</strong>{" "}
                {error || t("error_backend_disconnected_desc")}
              </div>
              <button type="button" className="np-btn np-btn--ghost" onClick={handleRetry}>
                {t("retry_connection")}
              </button>
            </div>
          </Notice>
        </div>
      )}

      {/* 3. Dynamic KPI Cards with Micro-Sparklines & Status Badges */}
      <WidgetErrorBoundary title="KPI Metrics">
        <KpiCards kpis={kpiViewModels} loading={loading} />
      </WidgetErrorBoundary>

      {/* 4. Live Global Traffic Map / Constellation Topology Switcher */}
      <WidgetErrorBoundary title="Live Network Telemetry">
        <section aria-labelledby="dashboard-live-title" role="region">
          <div className="np-dash__section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--np-2)" }}>
              <h2 id="dashboard-live-title" className="np-dash__section-title">
                {vizMode === "map" ? "Global Traffic Map" : t("live_traffic")}
              </h2>
              <span className="np-situation-chip" style={{ fontSize: "0.68rem" }}>
                ● LIVE TELEMETRY
              </span>
            </div>
            <div className="np-viz-mode-toggle" role="group" aria-label="Traffic visualization mode">
              <button
                type="button"
                className={`np-viz-mode-btn ${vizMode === "map" ? "np-viz-mode-btn--active" : ""}`}
                onClick={() => dispatchEvent({ type: "SET_VIZ_MODE", mode: "map" })}
                aria-pressed={vizMode === "map"}
              >
                🌍 GLOBAL MAP
              </button>
              <button
                type="button"
                className={`np-viz-mode-btn ${vizMode === "topology" ? "np-viz-mode-btn--active" : ""}`}
                onClick={() => dispatchEvent({ type: "SET_VIZ_MODE", mode: "topology" })}
                aria-pressed={vizMode === "topology"}
              >
                🕸 TOPOLOGY
              </button>
            </div>
          </div>
          {loading ? (
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
              title={search || category !== "all" ? "No Matching Narratives" : t("no_traffic")}
              description={
                search || category !== "all"
                  ? "No narrative items match your search or filter criteria."
                  : "Start packet capture or select an active network adapter in the header bar to observe real-time network activity."
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
                    Reset Filters
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
