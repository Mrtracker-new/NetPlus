// The Dashboard — NetPulse's signature surface (docs/09 §5). A hero header, a set
// of real KPI tiles, the live Network Constellation centerpiece, and the
// narrative feed: human-language cards, each backed by evidence and drilling down
// toward raw data (docs/09 §8). Every number here is real — sourced from the
// monitor snapshot / store, never fabricated. Density scales with disclosure mode.

import { useTranslation } from "react-i18next";
import type { NarrativeCard, Severity } from "@netpulse/contract";
import { EmptyState, EvidenceChips } from "@netpulse/components";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";
import { Constellation, humanBytes } from "@netpulse/viz";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

// Severity as icon + label — colour is never the sole carrier of meaning
// (docs/09 §12), and findings stay calm, never alarmist (docs/09 §5.2).
const SEVERITY_ICON: Record<Severity, string> = {
  neutral: "•",
  notable: "◆",
  finding: "⚠",
};

function Card({ card }: { card: NarrativeCard }) {
  const { shows } = useDisclosure();
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <article className={`np-card np-card--${card.severity}`}>
      <header className="np-card__headline">
        <span aria-hidden="true">{SEVERITY_ICON[card.severity]}</span> {card.headline}
      </header>
      {card.summary && <p className="np-card__summary">{card.summary}</p>}
      {/* Expert mode surfaces the individual detail lines beneath the summary. */}
      {shows("expert") && card.lines.length > 0 && (
        <ul className="np-card__lines">
          {card.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <footer className="np-card__foot">
        <EvidenceChips evidence={card.evidence} onNavigate={navigateToEvidence} />
      </footer>
    </article>
  );
}

// The KPI row (ref "You have been online / visited"). Real figures from the
// monitor snapshot; shows zeros honestly before the first snapshot arrives.
function Kpis() {
  const { t } = useTranslation("dashboard");
  const { monitor, feed } = useStore();
  const hosts = monitor?.by_host.rows.length ?? 0;
  const flows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
  const bytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;
  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Hosts observed", value: String(hosts) },
    { label: t("active_flows"), value: String(flows) },
    { label: t("total_bytes"), value: humanBytes(bytes) },
    { label: "Narrative cards", value: String(feed.length) },
  ];
  return (
    <div className="np-kpis">
      {tiles.map((t) => (
        <div className="np-kpi" key={t.label}>
          <div className="np-kpi__label">{t.label}</div>
          <div className="np-kpi__value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { feed, monitor } = useStore();
  const hostRows = monitor?.by_host.rows ?? [];

  return (
    <section className="np-dash" aria-label="Dashboard">
      <header>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">
          A live, honest picture of what this device is talking to — nothing invented.
        </p>
      </header>

      <Kpis />

      <section aria-label="Network constellation">
        <h2 className="np-dash__section-title">{t("live_traffic")}</h2>
        <Constellation hosts={hostRows} lossIndicators={monitor?.network_loss_indicators ?? 0} />
      </section>

      <section aria-label="Narrative feed">
        <h2 className="np-dash__section-title">What's happening</h2>
        {feed.length === 0 ? (
          // Calm empty state — a quiet network shows "nothing notable", not a void
          // (docs/09 §11).
          <EmptyState compact>{t("no_traffic")}</EmptyState>
        ) : (
          <div className="np-feed">
            {feed.map((card) => (
              <Card key={`${card.at_mono_nanos}-${card.headline}`} card={card} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
