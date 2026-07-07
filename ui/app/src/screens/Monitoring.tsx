// Monitoring — usage breakdowns + "why is it slow?" diagnostics (docs/11).
// Every diagnosis is a hypothesis with confidence and evidence, phrased
// "looks like", never a verdict (docs/11 §6.3). Capture loss and network loss
// are shown as distinct figures — conflating them would be a lie (docs/11 §6.4).

import type { Breakdown, Diagnosis } from "@netpulse/contract";
import { useStore } from "../state/store";
import { AreaChart, BarRow, ConfidenceMeter, Donut, humanBytes } from "../viz";

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <article className="np-diagnosis">
      <p>{diagnosis.explanation}</p>
      {/* Confidence is always shown — honest over reassuring (docs/11 §6.3). */}
      <ConfidenceMeter percent={diagnosis.confidence_percent} />
      <span className="np-evidence-count">{diagnosis.evidence.length} evidence</span>
    </article>
  );
}

function HostBars({ breakdown }: { breakdown: Breakdown }) {
  const rows = [...breakdown.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  const max = rows.reduce((m, r) => Math.max(m, r.bytes), 0);
  if (rows.length === 0) return null;
  return (
    <section className="np-panel">
      <h3 className="np-panel__title">Top {breakdown.dimension}</h3>
      {rows.map((r) => (
        <BarRow key={r.label} label={r.label} value={r.bytes} max={max} suffix={humanBytes(r.bytes)} />
      ))}
    </section>
  );
}

export function Monitoring() {
  const { monitor, throughput } = useStore();
  if (!monitor) {
    return <div className="np-empty">Idle — no traffic to measure.</div>;
  }

  const protocolSlices = monitor.by_protocol.rows.map((r) => ({ label: r.label, value: r.bytes }));

  return (
    <section className="np-monitor" aria-label="Monitoring">
      <div className="np-monitor__top">
        <section className="np-panel">
          <h3 className="np-panel__title">Throughput</h3>
          <AreaChart values={throughput} label="Bytes observed" format={humanBytes} />
        </section>
        <section className="np-panel">
          <h3 className="np-panel__title">By protocol</h3>
          <Donut slices={protocolSlices} centerLabel="total" format={humanBytes} />
        </section>
      </div>

      <HostBars breakdown={monitor.by_host} />

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
