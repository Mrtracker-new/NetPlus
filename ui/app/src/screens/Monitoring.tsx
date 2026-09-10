import { useTranslation } from "react-i18next";
import { Notice, Button, Skeleton } from "@netpulse/components";
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
    monitor,
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

  const isLoading = monitor === null && !viewModel.error;

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
      <div
        className="np-kpis"
        role="region"
        aria-label={isLoading ? t("loading_statistics", "Loading statistics") : undefined}
      >
        {isLoading
          ? [1, 2, 3, 4].map((i) => (
              <div className="np-kpi-card np-kpi-card--skeleton" key={i} data-testid="kpi-skeleton-card">
                <Skeleton variant="text" width="60%" height="12px" style={{ marginBottom: "8px" }} />
                <Skeleton variant="rounded" width="40%" height="24px" />
              </div>
            ))
          : displayKpis.map((k) => (
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

      {/* Network Loss & Capture Drops Counters — distinct figures, never conflated */}
      {monitor && (
        <div
          className="np-loss"
          aria-label="Loss telemetry"
          data-testid="monitoring-loss-counters"
        >
          <span>
            {t("network_loss", {
              count: monitor.network_loss_indicators ?? 0,
              defaultValue: `Network loss indicators: ${monitor.network_loss_indicators ?? 0}`,
            })}
          </span>
          <span>
            {t("capture_drops", {
              count: monitor.capture_drops ?? 0,
              defaultValue: `Capture drops (ours): ${monitor.capture_drops ?? 0}`,
            })}
          </span>
        </div>
      )}

      {/* Perfectly Symmetrical 2x2 Grid */}
      <div className="np-monitor-grid" data-testid={isLoading ? "monitor-grid-skeleton" : undefined}>
        {isLoading ? (
          [1, 2, 3, 4].map((i) => (
            <div
              className="np-monitor-card np-monitor-card--skeleton"
              key={i}
              data-testid="monitor-skeleton-card"
              aria-label="Loading telemetry..."
              style={{ minHeight: "260px" }}
            >
              <div className="np-monitor-card__header">
                <Skeleton variant="text" width="45%" height="16px" />
                <Skeleton variant="rounded" width="20%" height="16px" />
              </div>
              <div
                style={{
                  height: "180px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                }}
              >
                <Skeleton variant="rounded" width="100%" height="100%" />
              </div>
            </div>
          ))
        ) : (
          <>
            <ThroughputLineageCard
              series={viewModel.throughputSeries}
              timestamps={viewModel.timestamps}
              protocols={monitor?.by_protocol?.rows}
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
          </>
        )}
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
