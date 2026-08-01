// The Dashboard — NetPulse's signature surface (docs/09 §5). A hero header, a set
// of real KPI tiles, the live Network Constellation centerpiece, and the
// narrative feed: human-language cards, each backed by evidence and drilling down
// toward raw data (docs/09 §8). Every number here is real — sourced from the
// monitor snapshot / store, never fabricated. Density scales with disclosure mode.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { NarrativeCard, Severity, EvidenceRef } from "@netpulse/contract";
import { EmptyState, EvidenceChips, Notice, Skeleton } from "@netpulse/components";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";
import { Constellation, humanBytes } from "@netpulse/viz";
import { useEvidenceNavigation, type NavigationSource } from "../context/EvidenceNavigationContext";

// Severity as icon + label — colour is never the sole carrier of meaning
// (docs/09 §12), and findings stay calm, never alarmist (docs/09 §5.2).
const SEVERITY_ICON: Record<Severity, string> = {
  neutral: "•",
  notable: "◆",
  finding: "⚠",
};

interface CardProps {
  card: NarrativeCard;
  onNavigate: (ref: EvidenceRef, source?: NavigationSource) => void;
}

function Card({ card, onNavigate }: CardProps) {
  const { shows } = useDisclosure();

  const handleCardNavigate = useCallback(
    (ref: EvidenceRef) => {
      onNavigate(ref, "feed");
    },
    [onNavigate]
  );

  return (
    <article className={`np-card np-card--${card.severity}`}>
      <header className="np-card__headline">
        <span aria-hidden="true">{SEVERITY_ICON[card.severity]}</span> {card.headline}
      </header>
      {card.summary && <p className="np-card__summary">{card.summary}</p>}
      {/* Expert mode surfaces individual detail lines beneath the summary */}
      {shows("expert") && card.lines.length > 0 && (
        <ul className="np-card__lines">
          {card.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <footer className="np-card__foot">
        <EvidenceChips evidence={card.evidence} onNavigate={handleCardNavigate} />
      </footer>
    </article>
  );
}

interface KpisProps {
  loading?: boolean;
}

function Kpis({ loading }: KpisProps) {
  const { t } = useTranslation("dashboard");
  const { monitor, feed } = useStore();

  if (loading) {
    return (
      <div className="np-kpis" role="region" aria-label="Loading statistics">
        {[1, 2, 3, 4].map((i) => (
          <div className="np-kpi" key={i}>
            <Skeleton variant="text" width="60%" height="12px" style={{ marginBottom: "8px" }} />
            <Skeleton variant="rounded" width="40%" height="24px" />
          </div>
        ))}
      </div>
    );
  }

  const hosts = monitor?.by_host.rows.length ?? 0;
  const flows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
  const bytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;

  const tiles: Array<{ label: string; value: string }> = [
    { label: t("hosts_observed"), value: String(hosts) },
    { label: t("active_flows"), value: String(flows) },
    { label: t("total_bytes"), value: humanBytes(bytes) },
    { label: t("narrative_cards"), value: String(feed.length) },
  ];

  return (
    <div className="np-kpis" role="region" aria-label="Key Performance Indicators">
      {tiles.map((tile) => (
        <div className="np-kpi" key={tile.label}>
          <div className="np-kpi__label">{tile.label}</div>
          <div className="np-kpi__value">{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

export interface DashboardProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function Dashboard({ loading = false, error = null, onRetry }: DashboardProps) {
  const { t } = useTranslation("dashboard");
  const { feed, monitor } = useStore();
  const { navigateToEvidence } = useEvidenceNavigation();
  const hostRows = monitor?.by_host.rows ?? [];

  const handleConstellationNavigate = useCallback(
    (ref: EvidenceRef, source?: NavigationSource) => {
      navigateToEvidence(ref, source ?? "constellation");
    },
    [navigateToEvidence]
  );

  return (
    <section className="np-dash" aria-label="Network Dashboard">
      <header>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("hero_subtitle")}</p>
      </header>

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

      <Kpis loading={loading} />

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
        ) : feed.length === 0 ? (
          // Calm empty state
          <EmptyState compact>{t("no_traffic")}</EmptyState>
        ) : (
          <div className="np-feed">
            {feed.map((card) => (
              <Card
                key={`${card.at_mono_nanos}-${card.headline}`}
                card={card}
                onNavigate={navigateToEvidence}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
