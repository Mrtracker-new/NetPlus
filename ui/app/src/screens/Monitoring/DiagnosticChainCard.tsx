import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiagnosticChain, DiagnosticStageNode, EvidenceRef } from "@netpulse/contract";
import { Icon, type IconName } from "../../icons";

interface DiagnosticChainCardProps {
  chain?: DiagnosticChain;
  onSelectEvidence?: (evidence: EvidenceRef) => void;
  onRunProbe?: (stageKind: string, target?: string) => void;
}

const STAGE_ICONS: Record<string, IconName> = {
  device: "cpu",
  interface: "wifi",
  router: "router",
  isp: "globe",
  dns: "database",
  cdn: "layers",
  destination: "server",
};

export const DiagnosticChainCard: React.FC<DiagnosticChainCardProps> = ({
  chain,
  onSelectEvidence,
  onRunProbe,
}) => {
  const { t } = useTranslation(["monitoring", "common"]);
  const [selectedStage, setSelectedStage] = useState<DiagnosticStageNode | null>(null);

  const stages = chain?.stages ?? [];

  if (stages.length === 0) {
    return null;
  }

  const handleStageClick = (stage: DiagnosticStageNode) => {
    setSelectedStage((prev: DiagnosticStageNode | null) => (prev?.stage === stage.stage ? null : stage));
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "healthy":
        return "np-diagnostic-chain__node--healthy";
      case "degraded":
        return "np-diagnostic-chain__node--degraded";
      case "investigate":
        return "np-diagnostic-chain__node--investigate";
      case "not_measurable":
        return "np-diagnostic-chain__node--not_measurable";
      case "unknown":
      default:
        return "np-diagnostic-chain__node--unknown";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "healthy":
        return "np-diagnostic-chain__node-status--healthy";
      case "degraded":
        return "np-diagnostic-chain__node-status--degraded";
      case "investigate":
        return "np-diagnostic-chain__node-status--investigate";
      case "not_measurable":
        return "np-diagnostic-chain__node-status--not_measurable";
      case "unknown":
      default:
        return "np-diagnostic-chain__node-status--unknown";
    }
  };

  const formatStatusLabel = (status: string) => {
    switch (status) {
      case "healthy":
        return t("diagnostic_chain.statuses.nominal", "Nominal");
      case "degraded":
        return t("diagnostic_chain.statuses.degraded", "Degraded");
      case "investigate":
        return t("diagnostic_chain.statuses.investigate", "Investigate");
      case "not_measurable":
        return t("diagnostic_chain.statuses.not_measurable", "Not Measurable");
      case "unknown":
      default:
        return t("diagnostic_chain.statuses.unknown", "Unknown");
    }
  };

  const formatMeasurementLabel = (ms: string) => {
    switch (ms) {
      case "observed":
        return t("diagnostic_chain.measurements.observed", "Observed");
      case "inferred":
        return t("diagnostic_chain.measurements.inferred", "Inferred");
      case "not_measurable":
        return t("diagnostic_chain.measurements.not_measurable", "Not Measurable");
      case "unknown":
      default:
        return t("diagnostic_chain.measurements.unknown", "Unobserved");
    }
  };

  const formatStageLabel = (stageKind: string, fallback: string) => {
    return t(`diagnostic_chain.stages.${stageKind}` as any, fallback);
  };

  return (
    <section className="np-diagnostic-chain" aria-label={t("diagnostic_chain.title", "End-to-End Diagnostic Chain")}>
      <div className="np-diagnostic-chain__header">
        <div className="np-diagnostic-chain__title">
          <Icon name="activity" style={{ width: 18, height: 18, color: "var(--np-accent)" }} />
          <span>{t("diagnostic_chain.title", "Diagnostic Chain")}</span>
        </div>
        <span className="np-diagnostic-chain__subtitle">
          {t("diagnostic_chain.subtitle", "Evidence-grounded hop analysis · Passive telemetry")}
        </span>
      </div>

      <div className="np-diagnostic-chain__track" role="tablist" aria-label="Diagnostic Hops">
        {stages.map((stage: DiagnosticStageNode) => {
          const isSelected = selectedStage?.stage === stage.stage;
          const iconName = STAGE_ICONS[stage.stage] || "activity";
          const statusClass = getStatusClass(stage.status);
          const statusBadgeClass = getStatusBadgeClass(stage.status);

          return (
            <button
              key={stage.stage}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-expanded={isSelected}
              className={`np-diagnostic-chain__node ${statusClass} ${isSelected ? "np-diagnostic-chain__node--selected" : ""}`}
              onClick={() => handleStageClick(stage)}
            >
              <div className="np-diagnostic-chain__node-icon-wrapper">
                <Icon name={iconName} style={{ width: 18, height: 18 }} />
              </div>
              <span className="np-diagnostic-chain__node-label">{formatStageLabel(stage.stage, stage.label)}</span>
              <span className={`np-diagnostic-chain__node-status ${statusBadgeClass}`}>
                {formatStatusLabel(stage.status)}
              </span>
              <span style={{ fontSize: "var(--np-fs-2xs)", color: "var(--np-text-mute)" }}>
                {formatMeasurementLabel(stage.measurement_state)}
              </span>
            </button>
          );
        })}
      </div>

      {selectedStage && (
        <div className="np-diagnostic-chain__drawer" role="region" aria-label={`${formatStageLabel(selectedStage.stage, selectedStage.label)} Inspection`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--np-2)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--np-2)", marginBottom: "4px" }}>
                <span style={{ fontWeight: "var(--np-fw-bold)", fontSize: "var(--np-fs-md)", color: "var(--np-text)" }}>
                  {formatStageLabel(selectedStage.stage, selectedStage.label)}
                </span>
                <span className={`np-diagnostic-chain__node-status ${getStatusBadgeClass(selectedStage.status)}`}>
                  {formatStatusLabel(selectedStage.status)}
                </span>
                <span style={{ fontSize: "var(--np-fs-xs)", color: "var(--np-text-dim)" }}>
                  [{formatMeasurementLabel(selectedStage.measurement_state)}]
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "var(--np-fs-sm)", color: "var(--np-text)" }}>
                {selectedStage.summary}
              </p>
              {selectedStage.detail && (
                <p style={{ margin: "4px 0 0 0", fontSize: "var(--np-fs-xs)", color: "var(--np-text-dim)" }}>
                  {selectedStage.detail}
                </p>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--np-2)" }}>
              {onRunProbe && (
                <button
                  type="button"
                  className="np-monitor-icon-btn"
                  onClick={() => onRunProbe(selectedStage.stage, selectedStage.affected_targets[0])}
                  style={{ gap: "6px", padding: "6px 12px", fontSize: "var(--np-fs-xs)" }}
                >
                  <Icon name="crosshair" style={{ width: 14, height: 14 }} />
                  <span>{t("diagnostic_chain.run_active_probe", "Run Active Probe")}</span>
                </button>
              )}
              <button
                type="button"
                className="np-monitor-icon-btn"
                onClick={() => setSelectedStage(null)}
                aria-label={t("diagnostic_chain.close_inspection", "Close stage inspection")}
              >
                <Icon name="close" style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--np-3)", marginTop: "var(--np-2)" }}>
            {selectedStage.latency_ms !== undefined && selectedStage.latency_ms !== null && (
              <div style={{ background: "var(--np-surface-recessed)", padding: "8px 12px", borderRadius: "var(--np-radius-xs)", border: "1px solid var(--np-border)" }}>
                <span style={{ fontSize: "var(--np-fs-2xs)", textTransform: "uppercase", color: "var(--np-text-mute)", fontWeight: "var(--np-fw-semibold)" }}>
                  {t("diagnostic_chain.measured_latency", "Measured Latency")}
                </span>
                <div style={{ fontSize: "var(--np-fs-base)", fontFamily: "var(--np-font-mono)", fontWeight: "var(--np-fw-bold)", color: "var(--np-text)" }}>
                  {selectedStage.latency_ms.toFixed(1)} ms
                </div>
              </div>
            )}

            {selectedStage.affected_targets && selectedStage.affected_targets.length > 0 && (
              <div style={{ background: "var(--np-surface-recessed)", padding: "8px 12px", borderRadius: "var(--np-radius-xs)", border: "1px solid var(--np-border)" }}>
                <span style={{ fontSize: "var(--np-fs-2xs)", textTransform: "uppercase", color: "var(--np-text-mute)", fontWeight: "var(--np-fw-semibold)" }}>
                  {t("diagnostic_chain.identified_endpoints", "Identified Endpoints")}
                </span>
                <div style={{ fontSize: "var(--np-fs-xs)", fontFamily: "var(--np-font-mono)", color: "var(--np-text-dim)" }}>
                  {selectedStage.affected_targets.slice(0, 3).join(", ")}
                  {selectedStage.affected_targets.length > 3 ? ` +${selectedStage.affected_targets.length - 3} more` : ""}
                </div>
              </div>
            )}

            {selectedStage.evidence && selectedStage.evidence.length > 0 && onSelectEvidence && selectedStage.evidence[0] && (
              <div style={{ background: "var(--np-surface-recessed)", padding: "8px 12px", borderRadius: "var(--np-radius-xs)", border: "1px solid var(--np-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: "var(--np-fs-2xs)", textTransform: "uppercase", color: "var(--np-text-mute)", fontWeight: "var(--np-fw-semibold)" }}>
                    {t("diagnostic_chain.evidence_backing", "Evidence Backing")}
                  </span>
                  <div style={{ fontSize: "var(--np-fs-xs)", color: "var(--np-text)" }}>
                    {selectedStage.evidence.length === 1
                      ? t("diagnostic_chain.flow_sample", { count: 1, defaultValue: "1 flow sample" })
                      : t("diagnostic_chain.flow_samples", { count: selectedStage.evidence.length, defaultValue: `${selectedStage.evidence.length} flow samples` })}
                  </div>
                </div>
                <button
                  type="button"
                  className="np-monitor-icon-btn"
                  onClick={() => {
                    const ev = selectedStage.evidence[0];
                    if (ev) onSelectEvidence(ev);
                  }}
                  style={{ fontSize: "var(--np-fs-2xs)", padding: "4px 8px" }}
                >
                  <span>{t("diagnostic_chain.drill_down", "Drill Down")}</span>
                  <Icon name="arrowRight" style={{ width: 12, height: 12, marginLeft: 4 }} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
