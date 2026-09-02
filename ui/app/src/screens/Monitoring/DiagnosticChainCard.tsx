import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { DiagnosticChain, DiagnosticStageNode, EvidenceRef, StageProbeResult } from "@netpulse/contract";
import { Icon, type IconName } from "../../icons";

interface DiagnosticChainCardProps {
  chain?: DiagnosticChain;
  onSelectEvidence?: (evidence: EvidenceRef) => void;
  onRunProbe?: (stageKind: string, target?: string) => void;
  probeState?: {
    running: boolean;
    result: StageProbeResult | null;
  };
}

const isProbeableStage = (stageKind: string): boolean => {
  return ["destination", "dns", "cdn", "isp", "router"].includes(stageKind.toLowerCase());
};

const validateProbeTarget = (target: string): { valid: boolean; error?: string } => {
  const trimmed = target.trim();
  if (!trimmed) {
    return { valid: false, error: "Target address cannot be empty" };
  }
  if (trimmed.length > 253) {
    return { valid: false, error: "Target exceeds maximum length of 253 characters" };
  }

  // Check IPv4 (4 octets, 0-255)
  const ipv4Parts = trimmed.split(".");
  if (ipv4Parts.length === 4) {
    const allOctetsValid = ipv4Parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255 && String(num) === part;
    });
    if (allOctetsValid) {
      return { valid: true };
    }
  }

  // Check IPv6
  if (trimmed.includes(":")) {
    const isIpv6 = /^([0-9a-fA-F]{1,4}:){1,7}:?([0-9a-fA-F]{1,4})?$/.test(trimmed) || trimmed === "::1" || trimmed === "::";
    if (isIpv6) {
      return { valid: true };
    }
  }

  // Check RFC 1123 Hostname
  const labels = trimmed.split(".");
  const validHostname = labels.every((label) => {
    return (
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    );
  });

  if (validHostname) {
    return { valid: true };
  }

  return {
    valid: false,
    error: "Target must be a valid IPv4 address, IPv6 address, or RFC 1123 hostname",
  };
};

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
  probeState,
}) => {
  const { t } = useTranslation(["monitoring", "common"]);
  const [selectedStage, setSelectedStage] = useState<DiagnosticStageNode | null>(null);
  const [customTarget, setCustomTarget] = useState<string>("");
  const [targetError, setTargetError] = useState<string | null>(null);

  useEffect(() => {
    const defaultTarget = selectedStage?.affected_targets?.[0] ?? "";
    setCustomTarget(defaultTarget);
    setTargetError(null);
  }, [selectedStage]);

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

            {/* Active Stage Probe Runner */}
            {onRunProbe && (
              <div
                style={{
                  background: "var(--np-surface-recessed)",
                  padding: "12px 14px",
                  borderRadius: "var(--np-radius-xs)",
                  border: "1px solid var(--np-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "var(--np-fs-2xs)", textTransform: "uppercase", color: "var(--np-text-mute)", fontWeight: "var(--np-fw-semibold)" }}>
                      Active Stage Probe
                    </span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 6px",
                        borderRadius: "var(--np-radius-xs)",
                        background: isProbeableStage(selectedStage.stage) ? "var(--np-surface-raised)" : "rgba(255,255,255,0.05)",
                        color: isProbeableStage(selectedStage.stage) ? "var(--np-accent)" : "var(--np-text-mute)",
                        fontFamily: "var(--np-font-mono)",
                        fontWeight: 600,
                      }}
                    >
                      {isProbeableStage(selectedStage.stage) ? "PROBEABLE" : "NON-PROBEABLE"}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--np-fs-xs)", color: "var(--np-text-dim)", marginTop: "2px" }}>
                    {isProbeableStage(selectedStage.stage)
                      ? "Execute on-demand diagnostic probe against this stage target"
                      : "Local host OS and physical interface stages are evaluated from local kernel state and cannot be queried via network probes."}
                  </div>
                </div>

                {isProbeableStage(selectedStage.stage) && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ fontSize: "0.72rem", color: "var(--np-text-mute)", display: "flex", justifyContent: "space-between" }}>
                        <span>Probe Target (Default or Override):</span>
                        {targetError && (
                          <span style={{ color: "var(--np-sem-failure, #ef4444)", fontWeight: 500 }}>
                            {targetError}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={customTarget}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTarget(val);
                            if (!val.trim()) {
                              setTargetError(null);
                            } else {
                              const v = validateProbeTarget(val);
                              setTargetError(v.valid ? null : (v.error ?? "Invalid target"));
                            }
                          }}
                          placeholder={selectedStage.affected_targets?.[0] || "e.g. 1.1.1.1, router IP, or domain"}
                          style={{
                            flex: 1,
                            background: "var(--np-surface-raised, var(--np-surface-1))",
                            color: "var(--np-text)",
                            border: targetError ? "1px solid var(--np-sem-failure, #ef4444)" : "1px solid var(--np-border)",
                            borderRadius: "var(--np-radius-xs)",
                            padding: "6px 10px",
                            fontSize: "0.8rem",
                            fontFamily: "var(--np-font-mono)",
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          className="np-monitor-time-btn"
                          disabled={probeState?.running || Boolean(targetError) || (!customTarget.trim() && !selectedStage.affected_targets?.[0])}
                          onClick={() => {
                            const effectiveTarget = customTarget.trim() || selectedStage.affected_targets?.[0];
                            if (effectiveTarget) {
                              const v = validateProbeTarget(effectiveTarget);
                              if (!v.valid) {
                                setTargetError(v.error ?? "Invalid target");
                                return;
                              }
                            }
                            onRunProbe(selectedStage.stage, effectiveTarget);
                          }}
                          style={{
                            fontSize: "0.75rem",
                            padding: "6px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Icon name="zap" style={{ width: 12, height: 12 }} />
                          <span>{probeState?.running ? "Probing..." : "Run Stage Probe"}</span>
                        </button>
                      </div>
                    </div>

                    {probeState?.result && probeState.result.stage === selectedStage.stage && (
                      <div
                        style={{
                          marginTop: "4px",
                          padding: "8px 10px",
                          borderRadius: "var(--np-radius-xs)",
                          background: "var(--np-surface-raised, var(--np-surface-1))",
                          border: "1px solid var(--np-border)",
                          fontSize: "0.78rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 600, color: "var(--np-text)" }}>
                            {probeState.result.probe_type} ({probeState.result.status.toUpperCase()})
                          </span>
                          {probeState.result.latency_ms != null && (
                            <span style={{ fontFamily: "var(--np-font-mono)", color: "var(--np-accent)" }}>
                              {probeState.result.latency_ms.toFixed(1)} ms
                            </span>
                          )}
                        </div>
                        <div style={{ color: "var(--np-text-dim)" }}>{probeState.result.summary}</div>
                        {probeState.result.details && probeState.result.details.length > 0 && (
                          <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.72rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
                            {probeState.result.details.map((d, i) => (
                              <div key={i}>{d}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
