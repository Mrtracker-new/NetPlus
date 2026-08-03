import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NarrativeCard, Severity, EvidenceRef } from "@netpulse/contract";
import { EmptyState, EvidenceChips, Notice, Skeleton } from "@netpulse/components";
import { Constellation } from "@netpulse/viz";
import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";
import { useStore } from "../state/store";
import { useDashboardController } from "./Dashboard/useDashboardController";
import { HealthStrip } from "./Dashboard/HealthStrip";
import { SituationSummary } from "./Dashboard/SituationSummary";
import { NarrativeFilterBar } from "./Dashboard/NarrativeFilterBar";
import { KpiCards } from "./Dashboard/KpiCards";
import { CardExplainBox } from "./Dashboard/CardExplainBox";

const SEVERITY_ICON: Record<Severity, string> = {
  neutral: "•",
  notable: "◆",
  finding: "⚠",
};

interface CardProps {
  card: NarrativeCard;
  onNavigate: (ref: EvidenceRef, source?: NavigationSource) => void;
  onNavigateToScreen: (ref: EvidenceRef) => void;
}

function Card({ card, onNavigate, onNavigateToScreen }: CardProps) {
  const { shows } = useDashboardController();
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

      {/* Expert mode surfaces detail lines beneath summary */}
      {shows("expert") && card.lines.length > 0 && (
        <ul className="np-card__lines">
          {card.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

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

export function Dashboard({ loading = false, error = null, onRetry }: DashboardProps) {
  const { t } = useTranslation("dashboard");
  const { monitor } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();
  const hostRows = monitor?.by_host.rows ?? [];

  const {
    heroViewModel,
    situationSummaryModel,
    healthViewModel,
    kpiViewModels,
    category,
    search,
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

  return (
    <section className="np-dash" aria-label="Network Dashboard">
      {/* 1. Capture & System Health Telemetry Strip */}
      <HealthStrip health={healthViewModel} />

      {/* 2. Situation Summary & Dynamic Hero Header */}
      <SituationSummary
        hero={heroViewModel}
        summary={situationSummaryModel}
        onSelectCategory={(cat) => dispatchEvent({ type: "SET_CATEGORY", category: cat })}
      />

      {error && (
        <div style={{ marginBottom: "var(--np-4)" }}>
          <Notice level="warning">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <strong>{t("error_backend_disconnected_title")}:</strong>{" "}
                {error || t("error_backend_disconnected_desc")}
              </div>
              {onRetry && (
                <button type="button" className="np-btn np-btn--ghost" onClick={onRetry}>
                  {t("retry_connection")}
                </button>
              )}
            </div>
          </Notice>
        </div>
      )}

      {/* 3. Smart Narrative Feed Filter & Search Bar */}
      <NarrativeFilterBar
        category={category}
        search={search}
        onSelectCategory={(cat) => dispatchEvent({ type: "SET_CATEGORY", category: cat })}
        onSearchChange={(s) => dispatchEvent({ type: "SET_SEARCH", search: s })}
        count={filteredNarratives.length}
        totalCount={feedCount}
      />

      {/* 4. Dynamic KPI Cards with Micro-Sparklines & Status Badges */}
      <KpiCards kpis={kpiViewModels} loading={loading} />

      {/* 5. Live Network Constellation Visualization */}
      <section aria-labelledby="dashboard-live-title" role="region">
        <h2 id="dashboard-live-title" className="np-dash__section-title">
          {t("live_traffic")}
        </h2>
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
        ) : (
          <Constellation
            hosts={hostRows}
            lossIndicators={monitor?.network_loss_indicators ?? 0}
            onNavigate={handleConstellationNavigate}
          />
        )}
      </section>

      {/* 6. Filtered Narrative Feed ("What's Happening") */}
      <section aria-labelledby="dashboard-feed-title" role="region">
        <h2 id="dashboard-feed-title" className="np-dash__section-title">
          {t("whats_happening")}
        </h2>
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
          <EmptyState compact>
            {search || category !== "all"
              ? "No narrative items match your search or filter criteria."
              : t("no_traffic")}
          </EmptyState>
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
    </section>
  );
}
