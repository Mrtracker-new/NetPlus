// Monitoring — usage breakdowns + "why is it slow?" diagnostics (docs/11).
// Every diagnosis is a hypothesis with confidence and evidence, phrased
// "looks like", never a verdict (docs/11 §6.3).

import { useTranslation } from "react-i18next";
import { EmptyState, Skeleton } from "@netpulse/components";
import { useMonitoringController } from "../hooks/useMonitoringController";
import { AreaChart, Donut, humanBytes } from "@netpulse/viz";
import { CaptureHealthPanel } from "./Monitoring/CaptureHealthPanel";
import { DiagnosisCard } from "./Monitoring/DiagnosisCard";
import { HostBars } from "./Monitoring/HostBars";
import { BreakdownTable } from "./Monitoring/BreakdownTable";

export function Monitoring() {
  const { t } = useTranslation(["monitoring", "common"]);
  const {
    monitor,
    throughput,
    kpis,
    protocolSlices,
    captureHealth,
    healthAnnouncement,
    diagnoses,
    networkLoss,
    captureDrops,
    actions,
  } = useMonitoringController();

  if (!monitor) {
    return (
      <section className="np-monitor" aria-label="Loading monitoring telemetry" aria-busy="true">
        {/* Layout-Matched Skeleton Loading Placeholders */}
        <div className="np-kpis" style={{ marginBottom: "1.5rem" }}>
          {[1, 2, 3, 4].map((i) => (
            <div className="np-kpi" key={i}>
              <Skeleton variant="text" width="60%" height="12px" style={{ marginBottom: "8px" }} />
              <Skeleton variant="rounded" width="40%" height="24px" />
            </div>
          ))}
        </div>
        <Skeleton height={140} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <Skeleton height={160} width="100%" style={{ borderRadius: "var(--np-radius-md)" }} />
          <Skeleton height={160} width="100%" style={{ borderRadius: "var(--np-radius-md)" }} />
        </div>
        <EmptyState>{t("idle")}</EmptyState>
      </section>
    );
  }

  return (
    <section className="np-monitor" aria-label={t("title")}>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("hero_subtitle")}</p>
      </header>

      {/* Screen Reader Live Announcement Region */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {healthAnnouncement}
      </div>

      {/* Headline KPI Metric Cards */}
      <div className="np-kpis">
        {kpis.map((k) => (
          <div className="np-kpi" key={k.labelKey}>
            <div className="np-kpi__label">{t(k.labelKey as any)}</div>
            <div className="np-kpi__value">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Capture Health Panel */}
      {captureHealth && <CaptureHealthPanel health={captureHealth} />}

      {/* Throughput AreaChart & Protocol Donut */}
      <div className="np-monitor__top">
        <section className="np-panel">
          <h3 className="np-panel__title">{t("throughput")}</h3>
          <AreaChart values={throughput} label={t("bytes_observed")} format={humanBytes} />
        </section>
        <section className="np-panel">
          <h3 className="np-panel__title">{t("by_protocol")}</h3>
          <Donut slices={protocolSlices} centerLabel={t("total_protocol")} format={humanBytes} />
        </section>
      </div>

      {/* Host Bar Rows & Breakdown Table */}
      <HostBars breakdown={monitor.by_host} />
      <BreakdownTable breakdown={monitor.by_host} />

      {/* Loss Indicators (Never summed — docs/11 §6.4) */}
      <div className="np-loss">
        <span>{t("network_loss", { count: networkLoss })}</span>
        <span>{t("capture_drops", { count: captureDrops })}</span>
      </div>

      {/* Diagnostic Hypotheses */}
      {diagnoses.length === 0 ? (
        <p className="np-ok">{t("no_issues")}</p>
      ) : (
        diagnoses.map((d, i) => (
          <DiagnosisCard key={i} diagnosis={d} onNavigateEvidence={actions.openEvidence} />
        ))
      )}
    </section>
  );
}
