// The Dashboard — the narrative feed, NetPulse's signature surface (docs/09 §5).
// A live feed of human-language cards; each is backed by evidence and drills
// down toward raw data (docs/09 §8). Density scales with disclosure mode.

import type { NarrativeCard, Severity } from "@netpulse/contract";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";

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

export function Dashboard() {
  const { feed } = useStore();

  // Calm empty state — a quiet network shows "nothing notable", not a void
  // (docs/09 §11).
  if (feed.length === 0) {
    return <div className="np-empty">Quiet — nothing notable right now.</div>;
  }

  return (
    <section className="np-feed" aria-label="Narrative feed">
      {feed.map((card) => (
        <Card key={`${card.at_mono_nanos}-${card.headline}`} card={card} />
      ))}
    </section>
  );
}
