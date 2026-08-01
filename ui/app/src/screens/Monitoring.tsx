// Monitoring — usage breakdowns + "why is it slow?" diagnostics (docs/11).
// Every diagnosis is a hypothesis with confidence and evidence, phrased
// "looks like", never a verdict (docs/11 §6.3). Capture loss and network loss
// are shown as distinct figures — conflating them would be a lie (docs/11 §6.4).

import { useTranslation } from "react-i18next";
import type { Breakdown, Diagnosis, CaptureStats, ShedStage } from "@netpulse/contract";
import { EmptyState, EvidenceChips } from "@netpulse/components";
import { useStore } from "../state/store";
import { AreaChart, BarRow, ConfidenceMeter, Donut, humanBytes, primaryHostName } from "@netpulse/viz";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

function CaptureHealthPanel({
  stats,
  captureDrops,
}: {
  stats?: CaptureStats;
  captureDrops: number;
}) {
  const bufferFrames = stats?.buffer_frames ?? 0;
  const bufferCapacity = stats?.buffer_capacity ?? 1000;
  const bufferPercent =
    bufferCapacity > 0 ? Math.round((bufferFrames / bufferCapacity) * 100) : 0;
  const stage: ShedStage = stats?.shed_stage ?? "none";
  const drops = stats?.dropped ?? captureDrops;

  const stageInfo: Record<ShedStage, { label: string; color: string }> = {
    none: { label: "Full Fidelity", color: "#10b981" },
    payloads_off: { label: "Payloads Off", color: "#f59e0b" },
    sample_dissection: { label: "Sample Dissection", color: "#f59e0b" },
    coarsen_metrics: { label: "Coarsened Metrics", color: "#f59e0b" },
    drop_packets: { label: "Dropping Packets", color: "#ef4444" },
  };

  const currentStage = stageInfo[stage] ?? stageInfo.none;

  return (
    <section className="np-panel np-capture-health" aria-label="Capture Health">
      <h3 className="np-panel__title">Capture Health</h3>
      <div className="np-kpis">
        <div className="np-kpi">
          <div className="np-kpi__label">Buffer Usage</div>
          <div className="np-kpi__value">{bufferPercent}%</div>
          <div style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", marginTop: "2px" }}>
            {bufferFrames} / {bufferCapacity} frames
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Shedding Stage</div>
          <div
            className="np-kpi__value"
            style={{
              color: currentStage.color,
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: currentStage.color,
                display: "inline-block",
              }}
            />
            {currentStage.label}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Drop Count</div>
          <div className="np-kpi__value" style={{ color: drops > 0 ? "#ef4444" : "inherit" }}>
            {drops}
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  const { navigateToEvidence } = useEvidenceNavigation();
  const confidenceWord = (diagnosis as { confidence_word?: string }).confidence_word;

  return (
    <article className="np-diagnosis">
      <p>{diagnosis.explanation}</p>
      {/* Confidence is always shown — honest over reassuring (docs/11 §6.3). */}
      <ConfidenceMeter
        percent={diagnosis.confidence_percent}
        qualitative={confidenceWord}
      />
      <EvidenceChips evidence={diagnosis.evidence} onNavigate={navigateToEvidence} />
    </article>
  );
}

function BreakdownTable({ breakdown }: { breakdown: Breakdown }) {
  const rows = [...breakdown.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  if (rows.length === 0) return null;
  return (
    <section className="np-panel">
      <table className="np-breakdown" aria-label={`Top ${breakdown.dimension} breakdown`}>
        <caption>Top {breakdown.dimension} breakdown</caption>
        <tbody>
          {rows.map((r) => {
            const nm = primaryHostName(r);
            return (
              <tr key={r.label}>
                <td>{nm ? nm.name : r.label}</td>
                <td>{nm ? r.label : `${r.flows} flow${r.flows === 1 ? "" : "s"}`}</td>
                <td style={{ textAlign: "right" }}>{humanBytes(r.bytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function HostBars({ breakdown }: { breakdown: Breakdown }) {
  const rows = [...breakdown.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  const max = rows.reduce((m, r) => Math.max(m, r.bytes), 0);
  if (rows.length === 0) return null;
  return (
    <section className="np-panel">
      <h3 className="np-panel__title">Top {breakdown.dimension}</h3>
      {rows.map((r) => {
        // For the host dimension, foreground an observed name when we have one;
        // the raw IP stays the row key. Other dimensions have no name to join.
        const nm = primaryHostName(r);
        return (
          <BarRow
            key={r.label}
            label={nm ? `${nm.name} (${r.label})` : r.label}
            value={r.bytes}
            max={max}
            suffix={humanBytes(r.bytes)}
          />
        );
      })}
    </section>
  );
}

export function Monitoring() {
  const { t } = useTranslation(["monitoring", "common"]);
  const { monitor, throughput } = useStore();
  if (!monitor) {
    return <EmptyState>Idle — no traffic to measure.</EmptyState>;
  }

  const protocolSlices = monitor.by_protocol.rows.map((r) => ({ label: r.label, value: r.bytes }));
  // Real headline figures, straight from the snapshot — never derived by guess.
  const totalBytes = monitor.by_protocol.rows.reduce((s, r) => s + r.bytes, 0);
  const totalFlows = monitor.by_host.rows.reduce((s, r) => s + r.flows, 0);
  const kpis = [
    { label: "Traffic seen", value: humanBytes(totalBytes) },
    { label: "Protocols", value: String(monitor.by_protocol.rows.length) },
    { label: "Hosts", value: String(monitor.by_host.rows.length) },
    { label: "Active flows", value: String(totalFlows) },
  ];

  return (
    <section className="np-monitor" aria-label={t("common:navigation.monitoring")}>
      <div className="np-kpis">
        {kpis.map((k) => (
          <div className="np-kpi" key={k.label}>
            <div className="np-kpi__label">{k.label}</div>
            <div className="np-kpi__value">{k.value}</div>
          </div>
        ))}
      </div>

      <CaptureHealthPanel stats={monitor.capture_stats} captureDrops={monitor.capture_drops} />

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
