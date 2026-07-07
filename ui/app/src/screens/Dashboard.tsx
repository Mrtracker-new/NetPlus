// The Dashboard — NetPulse's signature surface (docs/09 §5). A hero header, a set
// of real KPI tiles, the live Network Constellation centerpiece, and the
// narrative feed: human-language cards, each backed by evidence and drilling down
// toward raw data (docs/09 §8). Every number here is real — sourced from the
// monitor snapshot / store, never fabricated. Density scales with disclosure mode.

import type { NarrativeCard, Severity } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";
import { Constellation } from "../viz/Constellation";
import { humanBytes } from "../viz";

// Severity as icon + label — colour is never the sole carrier of meaning
// (docs/09 §12), and findings stay calm, never alarmist (docs/09 §5.2).
const SEVERITY_ICON: Record<Severity, string> = {
  neutral: "•",
  notable: "◆",
  finding: "⚠",
};

function EvidenceBadge({ card }: { card: NarrativeCard }) {
  const n = card.evidence.length;
  // Provenance is always present (docs/02 §6.3); the badge is the drill-down
  // affordance toward session → flow → protocol → raw (docs/09 §8).
  return (
    <button className="np-evidence" title="Show the flows and session behind this">
      {n} evidence →
    </button>
  );
}

function Card({ card }: { card: NarrativeCard }) {
  const { shows } = useDisclosure();
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
        <EvidenceBadge card={card} />
      </footer>
    </article>
  );
}

// The KPI row (ref "You have been online / visited"). Real figures from the
// monitor snapshot; shows zeros honestly before the first snapshot arrives.
function Kpis() {
  const { monitor, feed } = useStore();
  const hosts = monitor?.by_host.rows.length ?? 0;
  const flows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
  const bytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;
  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Hosts observed", value: String(hosts) },
    { label: "Active flows", value: String(flows) },
    { label: "Traffic seen", value: humanBytes(bytes) },
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
  const { feed, monitor } = useStore();
  const hostRows = monitor?.by_host.rows ?? [];

  return (
    <section className="np-dash" aria-label="Dashboard">
      <header>
        <h1 className="np-hero__title">Network at a glance</h1>
        <p className="np-hero__sub">
          A live, honest picture of what this device is talking to — nothing invented.
        </p>
      </header>

      <Kpis />

      <section aria-label="Network constellation">
        <h2 className="np-dash__section-title">Live constellation</h2>
        <Constellation hosts={hostRows} lossIndicators={monitor?.network_loss_indicators ?? 0} />
      </section>

      <section aria-label="Narrative feed">
        <h2 className="np-dash__section-title">What's happening</h2>
        {feed.length === 0 ? (
          // Calm empty state — a quiet network shows "nothing notable", not a void
          // (docs/09 §11).
          <div className="np-empty np-empty--compact">Quiet — nothing notable right now.</div>
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
