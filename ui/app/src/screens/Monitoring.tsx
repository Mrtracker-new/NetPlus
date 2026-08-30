import { useTranslation } from "react-i18next";
import { useMonitoringController } from "../hooks/useMonitoringController";
import { CaptureHealthPanel } from "./Monitoring/CaptureHealthPanel";
import { DiagnosticChainCard } from "./Monitoring/DiagnosticChainCard";
import { ThroughputLineageCard } from "./Monitoring/ThroughputLineageCard";
import { ThroughputGainsCard } from "./Monitoring/ThroughputGainsCard";
import { ApplicationsLineageCard } from "./Monitoring/ApplicationsLineageCard";
import { ProcessAttributesCard } from "./Monitoring/ProcessAttributesCard";
import { DiagnosticsSection } from "./Monitoring/DiagnosticsSection";

export function Monitoring() {
  const { t } = useTranslation(["monitoring", "common"]);
  const {
    kpis,
    captureHealth,
    healthAnnouncement,
    diagnoses,
    viewModel,
    preferences,
    actions,
  } = useMonitoringController();

  const badgeClass =
    viewModel.engineState === "Live"
      ? "np-monitor-badge--live"
      : viewModel.engineState === "Standby"
      ? "np-monitor-badge--idle"
      : viewModel.engineState === "Degraded"
      ? "np-monitor-badge--warning"
      : "np-monitor-badge--danger";

  const displayKpis =
    kpis.length > 0
      ? kpis
      : [
          { labelKey: "kpi_traffic", value: viewModel.formattedTraffic },
          { labelKey: "kpi_protocols", value: viewModel.activeProtocolsCount },
          { labelKey: "kpi_hosts", value: viewModel.activeHostsCount },
          { labelKey: "kpi_flows", value: viewModel.activeFlowsCount },
        ];

  return (
    <section className="np-monitor np-monitor-dashboard" aria-label="Live Monitoring & System Health">
      {/* Header with Title & Engine Status Pill Badge */}
      <header className="np-monitor-header">
        <div className="np-monitor-header__titles">
          <h1 className="np-monitor-header__title">
            {t("title", "Live Monitoring & System Health")}
            <span className={`np-monitor-badge ${badgeClass}`}>
              <span className="np-health-dot" style={{ width: 6, height: 6 }} />
              {viewModel.engineState}
            </span>
          </h1>
          <p className="np-monitor-header__subtitle">
            {t("hero_subtitle", "Real-time packet telemetry, network flow lineage, throughput metrics & process attribute tracking.")}
          </p>
        </div>

        {/* Time-Range Selection Filter Segmented Control */}
        <div
          className="np-monitor-time-segmented"
          role="group"
          aria-label="Time range filter"
        >
          {(["5m", "15m", "1h", "24h"] as const).map((tr) => {
            const isSelected = preferences.timeRange === tr;
            return (
              <button
                key={tr}
                type="button"
                className={`np-monitor-time-btn ${isSelected ? "np-monitor-time-btn--active" : ""}`}
                aria-pressed={isSelected}
                aria-label={`Set time range to ${tr}`}
                onClick={() => actions.setTimeRange(tr)}
              >
                {tr}
              </button>
            );
          })}
        </div>
      </header>

      {/* Screen Reader Live Announcement Region */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {healthAnnouncement}
      </div>

      {/* Headline KPI Metric Cards — Level 1 Raised Plates */}
      <div className="np-kpis">
        {displayKpis.map((k) => (
          <div className="np-kpi-card" key={k.labelKey}>
            <div className="np-kpi-card__header">
              <span className="np-kpi-card__label">{t(k.labelKey as any)}</span>
            </div>
            <div className="np-kpi-card__main">
              <span className="np-kpi-card__val">{k.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Diagnostic Chain Card — Evidence-Grounded Hop Telemetry */}
      {viewModel.diagnosticChain && (
        <DiagnosticChainCard
          chain={viewModel.diagnosticChain}
          onSelectEvidence={actions.openEvidence}
          onRunProbe={actions.runProbe}
        />
      )}

      {/* Capture Health Panel */}
      {captureHealth && <CaptureHealthPanel health={captureHealth} />}

      {/* Perfectly Symmetrical 2x2 Grid */}
      <div className="np-monitor-grid">
        <ThroughputLineageCard
          series={viewModel.throughputSeries}
          timestamps={viewModel.timestamps}
        />
        <ApplicationsLineageCard
          nodes={viewModel.nodes}
          edges={viewModel.edges}
          selectedNodeId={preferences.selectedNodeId}
          onSelectNode={actions.setSelectedNodeId}
        />
        <ThroughputGainsCard
          series={viewModel.gainsSeries}
          timestamps={viewModel.timestamps}
          peakBadgeText={viewModel.peakGainBadge}
        />
        <ProcessAttributesCard processes={viewModel.processes} />
      </div>

      {/* Subsystem Health, Active Alerts, Auto-Recommendations & Hypotheses */}
      <DiagnosticsSection
        alerts={viewModel.alerts}
        subsystems={viewModel.subsystems}
        recommendations={viewModel.recommendations}
        diagnoses={diagnoses}
        onNavigateEvidence={actions.openEvidence}
      />
    </section>
  );
}
