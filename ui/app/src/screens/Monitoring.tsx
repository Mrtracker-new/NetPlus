import { useTranslation } from "react-i18next";
import { useMonitoringController } from "../hooks/useMonitoringController";
import { CaptureHealthPanel } from "./Monitoring/CaptureHealthPanel";
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
      : viewModel.engineState === "Simulation"
      ? "np-monitor-badge--simulation"
      : viewModel.engineState === "Degraded"
      ? "np-monitor-badge--warning"
      : "np-monitor-badge--danger";

  // Provide fallback KPIs from simulation telemetry when monitor is null
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
            Live Monitoring & System Health
            <span className={`np-monitor-badge ${badgeClass}`}>
              ● {viewModel.engineState}
            </span>
          </h1>
          <p className="np-monitor-header__subtitle">
            Real-time packet telemetry, network flow lineage, throughput metrics & process attribute tracking.
          </p>
        </div>

        {/* Time-Range Selection Filter Segmented Control */}
        <div
          className="np-monitor-header__controls"
          role="group"
          aria-label="Time range filter"
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: "var(--np-surface-1, #131b2a)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.1))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "3px",
            gap: "2px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          }}
        >
          {(["5m", "15m", "1h", "24h"] as const).map((tr) => {
            const isSelected = preferences.timeRange === tr;
            return (
              <button
                key={tr}
                type="button"
                className={`np-btn ${isSelected ? "np-btn--primary" : "np-btn--ghost"}`}
                aria-pressed={isSelected}
                aria-label={`Set time range to ${tr}`}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.85rem",
                  borderRadius: "var(--np-radius-md, 8px)",
                  background: isSelected ? "var(--np-monitor-primary, #00f2fe)" : "transparent",
                  color: isSelected ? "#000" : "var(--np-text-dim, #9ca3af)",
                  fontWeight: isSelected ? 700 : 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
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

      {/* Headline KPI Metric Cards */}
      <div className="np-kpis">
        {displayKpis.map((k) => (
          <div className="np-kpi" key={k.labelKey}>
            <div className="np-kpi__label">{t(k.labelKey as any)}</div>
            <div className="np-kpi__value">{k.value}</div>
          </div>
        ))}
      </div>

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
