import { useTranslation } from "react-i18next";
import { Notice, Button } from "@netpulse/components";
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
    probeState,
    isRetrying,
    actions,
  } = useMonitoringController();

  const badgeClass =
    viewModel.engineState === "Live"
      ? "np-monitor-badge--live"
      : viewModel.engineState === "Standby"
      ? "np-monitor-badge--idle"
      : viewModel.engineState === "Stale"
      ? "np-monitor-badge--warning"
      : viewModel.engineState === "Unavailable"
      ? "np-monitor-badge--danger"
      : viewModel.engineState === "Degraded"
      ? "np-monitor-badge--warning"
      : "np-monitor-badge--danger";

  const badgeLabel =
    viewModel.engineState === "Live"
      ? t("engine_state.live", "Live")
      : viewModel.engineState === "Standby"
      ? t("engine_state.standby", "Standby")
      : viewModel.engineState === "Stale"
      ? t("engine_state.stale", "Stale")
      : viewModel.engineState === "Unavailable"
      ? t("engine_state.unavailable", "Unavailable")
      : viewModel.engineState;

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
              {badgeLabel}
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

      {/* IPC & Engine Connection Error Banner */}
      {viewModel.error != null && (
        <div style={{ marginBottom: "var(--np-4, 1rem)" }}>
          <Notice level="error">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
                width: "100%",
              }}
            >
              <div>
                <strong>
                  {t(
                    "error_connection_title",
                    typeof viewModel.error === "object" && viewModel.error.title
                      ? viewModel.error.title
                      : "Engine Connection Error"
                  )}
                  :{" "}
                </strong>
                <span>
                  {typeof viewModel.error === "string"
                    ? viewModel.error
                    : viewModel.error.message || t("error_loading", "Failed to load monitoring snapshot.")}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                busy={isRetrying}
                disabled={isRetrying}
                onClick={actions.retryConnection}
              >
                {t("retry_connection", "Retry Connection")}
              </Button>
            </div>
          </Notice>
        </div>
      )}

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
          probeState={probeState}
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
