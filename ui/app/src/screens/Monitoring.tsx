// Monitoring — usage breakdowns + "why is it slow?" diagnostics (docs/11).
// Every diagnosis is a hypothesis with confidence and evidence, phrased
// "looks like", never a verdict (docs/11 §6.3). Capture loss and network loss
// are shown as distinct figures — conflating them would be a lie (docs/11 §6.4).

import type { Breakdown, Diagnosis } from "@netpulse/contract";
import { useStore } from "../state/store";

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function BreakdownTable({ breakdown }: { breakdown: Breakdown }) {
  return (
    <table className="np-breakdown">
      <caption>By {breakdown.dimension}</caption>
      <tbody>
        {breakdown.rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{humanBytes(row.bytes)}</td>
            <td>
              {row.flows} flow{row.flows === 1 ? "" : "s"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <article className="np-diagnosis">
      <p>{diagnosis.explanation}</p>
      {/* Confidence is always shown — honest over reassuring (docs/11 §6.3). */}
      <span className="np-confidence">Confidence: {diagnosis.confidence_percent}%</span>
      <span className="np-evidence-count">{diagnosis.evidence.length} evidence</span>
    </article>
  );
}

export function Monitoring() {
  const { monitor } = useStore();
  if (!monitor) {
    return <div className="np-empty">Idle — no traffic to measure.</div>;
  }

  return (
    <section className="np-monitor" aria-label="Monitoring">
      <BreakdownTable breakdown={monitor.by_protocol} />
      <BreakdownTable breakdown={monitor.by_host} />

      <div className="np-loss">
        {/* Two separate figures — never summed (docs/11 §6.4). */}
        <span>Network loss indicators: {monitor.network_loss_indicators}</span>
        <span>Capture drops (ours): {monitor.capture_drops}</span>
      </div>

      {monitor.diagnoses.length === 0 ? (
        <p className="np-ok">Nothing looks wrong.</p>
      ) : (
        monitor.diagnoses.map((d, i) => <DiagnosisCard key={i} diagnosis={d} />)
      )}
    </section>
  );
}
