import { memo, useState, useEffect } from "react";
import type {
  DiagnosticChain,
  DiagnosticChainStageKind,
  DiagnosticStageNode,
  DiagnosticStageStatus,
  EvidenceRef,
  MeasurementState,
  StageProbeResult,
} from "@netpulse/contract";
import { query } from "../../ipc";

interface DiagnosticChainStripProps {
  chain?: DiagnosticChain | null;
  onSelectStage?: (stage: DiagnosticStageNode) => void;
  onNavigateToEvidence?: (ref: EvidenceRef) => void;
  onRunProbe?: (stageKind: DiagnosticChainStageKind, target?: string | null) => Promise<StageProbeResult | null> | void;
  probeResult?: StageProbeResult | null;
}

interface StageDefinition {
  kind: DiagnosticChainStageKind;
  defaultLabel: string;
  defaultDescription: string;
}

const ORDERED_STAGES: StageDefinition[] = [
  { kind: "device", defaultLabel: "Device", defaultDescription: "Local OS network stack" },
  { kind: "interface", defaultLabel: "Interface", defaultDescription: "Network adapter & driver" },
  { kind: "router", defaultLabel: "Router", defaultDescription: "Local gateway / first hop" },
  { kind: "isp", defaultLabel: "ISP", defaultDescription: "Upstream internet provider" },
  { kind: "dns", defaultLabel: "DNS", defaultDescription: "Domain name resolution resolver" },
  { kind: "cdn", defaultLabel: "CDN", defaultDescription: "Content delivery network edge" },
  { kind: "destination", defaultLabel: "Destination", defaultDescription: "Target server / remote endpoint" },
];

function statusGlyph(status: DiagnosticStageStatus | "unmeasured"): string {
  switch (status) {
    case "healthy":
      return "✓";
    case "degraded":
      return "⚠";
    case "investigate":
      return "✕";
    case "unknown":
    case "not_measurable":
    case "unmeasured":
    default:
      return "—";
  }
}

function statusText(status: DiagnosticStageStatus | "unmeasured"): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "investigate":
      return "Investigate";
    case "not_measurable":
      return "Not Measurable";
    case "unknown":
    case "unmeasured":
    default:
      return "Unmeasured";
  }
}

function statusVariant(status: DiagnosticStageStatus | "unmeasured"): string {
  switch (status) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "warning";
    case "investigate":
      return "finding";
    case "not_measurable":
    case "unknown":
    case "unmeasured":
    default:
      return "muted";
  }
}

function measurementStateLabel(state: MeasurementState): string {
  switch (state) {
    case "observed":
      return "Observed";
    case "inferred":
      return "Inferred";
    case "not_measurable":
      return "Not Measurable";
    case "unknown":
    default:
      return "Unobserved";
  }
}

function measurementStateVariant(state: MeasurementState): string {
  switch (state) {
    case "observed":
      return "healthy";
    case "inferred":
      return "spike";
    case "not_measurable":
    case "unknown":
    default:
      return "idle";
  }
}

function compactStageLabel(kind: DiagnosticChainStageKind, fullLabel?: string): string {
  switch (kind) {
    case "device":
      return "Device";
    case "interface":
      return "Interface";
    case "router":
      return "Gateway";
    case "isp":
      return "ISP";
    case "dns":
      return "DNS";
    case "cdn":
      return "CDN";
    case "destination":
      return "Destination";
    default:
      return fullLabel || "Stage";
  }
}

export const DiagnosticChainStrip = memo(function DiagnosticChainStrip({
  chain,
  onSelectStage,
  onNavigateToEvidence,
  onRunProbe,
  probeResult,
}: DiagnosticChainStripProps) {
  const [inspectedKind, setInspectedKind] = useState<DiagnosticChainStageKind | null>(null);
  const [probingStage, setProbingStage] = useState<DiagnosticChainStageKind | null>(null);
  const [probeResults, setProbeResults] = useState<Partial<Record<DiagnosticChainStageKind, StageProbeResult>>>({});
  const [probeError, setProbeError] = useState<string | null>(null);
  const [customTarget, setCustomTarget] = useState<string>("");

  const stageMap = new Map<DiagnosticChainStageKind, DiagnosticStageNode>();
  if (chain?.stages) {
    for (const s of chain.stages) {
      stageMap.set(s.stage, s);
    }
  }

  const inspectedNode = inspectedKind ? stageMap.get(inspectedKind) : null;
  const inspectedDef = inspectedKind
    ? ORDERED_STAGES.find((s) => s.kind === inspectedKind)
    : null;

  useEffect(() => {
    setCustomTarget(inspectedNode?.affected_targets?.[0] ?? "");
  }, [inspectedKind, inspectedNode]);

  const currentProbeResult =
    probeResult && probeResult.stage === inspectedDef?.kind
      ? probeResult
      : inspectedDef
      ? probeResults[inspectedDef.kind]
      : undefined;

  const handleNodeClick = (def: StageDefinition, node?: DiagnosticStageNode) => {
    if (inspectedKind === def.kind) {
      setInspectedKind(null);
    } else {
      setInspectedKind(def.kind);
      setProbeError(null);
      if (node) {
        onSelectStage?.(node);
      }
    }
  };

  const handleRunProbe = async (stageKind: DiagnosticChainStageKind) => {
    setProbingStage(stageKind);
    setProbeError(null);
    try {
      const target = customTarget.trim() || inspectedNode?.affected_targets?.[0] || null;
      let result: StageProbeResult | null = null;
      if (onRunProbe) {
        const res = await onRunProbe(stageKind, target);
        result = res || null;
      } else {
        const res = await query({
          kind: "runStageProbe",
          stage: stageKind,
          target,
        });
        if (res.kind === "stageProbeResult") {
          result = res.result;
        }
      }
      if (result) {
        setProbeResults((prev) => ({ ...prev, [stageKind]: result! }));
      }
    } catch (err: any) {
      setProbeError(err?.message || String(err));
    } finally {
      setProbingStage(null);
    }
  };

  return (
    <nav
      className="np-diag-chain"
      aria-label="7-Stage Diagnostic Telemetry Chain"
      role="region"
    >
      <div className="np-diag-chain__track">
        {ORDERED_STAGES.map((def, idx) => {
          const node = stageMap.get(def.kind);
          const status = node?.status ?? "unmeasured";
          const fullLabel = node?.label || def.defaultLabel;
          const displayLabel = compactStageLabel(def.kind, node?.label);
          const latencyText =
            typeof node?.latency_ms === "number"
              ? `${node.latency_ms < 1 ? node.latency_ms.toFixed(1) : Math.round(node.latency_ms)} ms`
              : null;
          const glyph = statusGlyph(status);
          const statusLabel = statusText(status);
          const variant = statusVariant(status);
          const isInspected = inspectedKind === def.kind;

          const ariaLabel = `${fullLabel} — Status: ${statusLabel}${
            latencyText ? ` — Latency: ${latencyText}` : ""
          } — ${node?.summary || def.defaultDescription}`;

          return (
            <div key={def.kind} className="np-diag-chain__item">
              <button
                type="button"
                className={`np-diag-chain__node np-diag-chain__node--${variant}${
                  isInspected ? " np-diag-chain__node--active" : ""
                }`}
                title={fullLabel}
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                aria-expanded={isInspected}
                onClick={() => handleNodeClick(def, node)}
                tabIndex={0}
              >
                <span className="np-diag-chain__glyph" aria-hidden="true">
                  {glyph}
                </span>
                <div className="np-diag-chain__meta">
                  <span className="np-diag-chain__label">{displayLabel}</span>
                  <span className="np-diag-chain__status-row">
                    <span className={`np-diag-chain__status-badge np-diag-chain__status-badge--${variant}`}>
                      {statusLabel}
                    </span>
                    {latencyText && (
                      <span className="np-diag-chain__latency">{latencyText}</span>
                    )}
                  </span>
                </div>
              </button>
              {idx < ORDERED_STAGES.length - 1 && (
                <span className="np-diag-chain__connector" aria-hidden="true">
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Stage Measurement Inspection Drawer */}
      {inspectedDef && (
        <div
          className="np-diag-chain__inspector"
          role="region"
          aria-label={`Inspection details for ${inspectedNode?.label || inspectedDef.defaultLabel}`}
        >
          <div className="np-diag-chain__inspector-head">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className={`np-badge np-badge--${statusVariant(inspectedNode?.status ?? "unmeasured")}`}>
                ● {statusText(inspectedNode?.status ?? "unmeasured")}
              </span>
              {inspectedNode?.measurement_state && (
                <span
                  className={`np-badge np-badge--${measurementStateVariant(inspectedNode.measurement_state)}`}
                  data-testid="stage-measurement-badge"
                  title={`Measurement state: ${measurementStateLabel(inspectedNode.measurement_state)}`}
                >
                  {measurementStateLabel(inspectedNode.measurement_state)}
                </span>
              )}
              <strong style={{ fontSize: "0.85rem", color: "var(--np-text)" }}>
                {inspectedNode?.label || inspectedDef.defaultLabel} Stage Measurement
              </strong>
              {typeof inspectedNode?.latency_ms === "number" && (
                <span style={{ fontSize: "0.75rem", fontFamily: "var(--np-font-mono)", color: "var(--np-text-dim)" }}>
                  (RTT: {inspectedNode.latency_ms < 1 ? inspectedNode.latency_ms.toFixed(1) : Math.round(inspectedNode.latency_ms)} ms)
                </span>
              )}
            </div>
            <button
              type="button"
              className="np-btn np-btn--ghost np-btn--xs"
              onClick={() => setInspectedKind(null)}
              aria-label="Close stage details"
              style={{ padding: "2px 6px", background: "transparent", border: "none", boxShadow: "none", color: "var(--np-text-dim)" }}
            >
              ✕
            </button>
          </div>

          <p style={{ margin: "0.35rem 0 0.5rem 0", fontSize: "0.8rem", color: "var(--np-text-dim)", lineHeight: 1.4 }}>
            {inspectedNode?.summary || inspectedDef.defaultDescription}
            {inspectedNode?.detail ? ` — ${inspectedNode.detail}` : inspectedNode ? "" : " — No probe or passive telemetry recorded for this hop yet."}
          </p>

          {/* Affected Targets List */}
          {inspectedNode?.affected_targets && inspectedNode.affected_targets.length > 0 && (
            <div
              className="np-diag-chain__affected-targets"
              style={{
                margin: "0.4rem 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
              data-testid="stage-affected-targets"
            >
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--np-text-dim)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Affected Targets:
              </span>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                {inspectedNode.affected_targets.map((target, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCustomTarget(target)}
                    title={`Click to set ${target} as probe target`}
                    style={{
                      fontSize: "0.72rem",
                      fontFamily: "var(--np-font-mono)",
                      background: customTarget === target ? "var(--np-accent-soft, rgba(56, 189, 248, 0.15))" : "var(--np-surface-1, rgba(255, 255, 255, 0.05))",
                      padding: "2px 6px",
                      borderRadius: "var(--np-radius-xs, 3px)",
                      border: customTarget === target ? "1px solid var(--np-accent, #38bdf8)" : "1px solid var(--np-hairline, rgba(255, 255, 255, 0.1))",
                      color: customTarget === target ? "var(--np-accent, #38bdf8)" : "var(--np-text)",
                      cursor: "pointer",
                    }}
                  >
                    {target}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action Row: Target Input, Run Stage Probe & Inspect Stage Evidence */}
          <div
            style={{
              marginTop: "0.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            {inspectedDef.kind !== "device" && inspectedDef.kind !== "interface" && (
              <input
                type="text"
                value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value)}
                placeholder={inspectedNode?.affected_targets?.[0] || "Target IP or hostname"}
                aria-label="Probe target"
                data-testid="stage-probe-target-input"
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "var(--np-font-mono)",
                  background: "var(--np-surface-1, rgba(255, 255, 255, 0.05))",
                  color: "var(--np-text)",
                  border: "1px solid var(--np-hairline, rgba(255, 255, 255, 0.15))",
                  borderRadius: "var(--np-radius-xs, 3px)",
                  padding: "3px 8px",
                  width: "170px",
                }}
              />
            )}

            <button
              type="button"
              className="np-btn np-btn--xs"
              onClick={() => handleRunProbe(inspectedDef.kind)}
              disabled={probingStage === inspectedDef.kind}
              aria-busy={probingStage === inspectedDef.kind}
              data-testid="run-stage-probe-btn"
              style={{
                fontSize: "0.75rem",
                padding: "4px 10px",
                border: "1px solid var(--np-hairline)",
              }}
            >
              {probingStage === inspectedDef.kind ? "Probing Stage..." : "Run Stage Probe"}
            </button>

            {inspectedNode?.evidence && inspectedNode.evidence.length > 0 && onNavigateToEvidence && (
              <button
                type="button"
                className="np-btn np-btn--primary np-btn--xs"
                onClick={() => onNavigateToEvidence(inspectedNode.evidence[0]!)}
                style={{ fontSize: "0.75rem", padding: "4px 10px" }}
              >
                Inspect Stage Evidence ({inspectedNode.evidence[0]!.kind} #{inspectedNode.evidence[0]!.id}) →
              </button>
            )}
          </div>

          {/* Active Stage Probe Execution Result */}
          {currentProbeResult && (
            <div
              className="np-diag-chain__probe-result"
              style={{
                marginTop: "0.6rem",
                padding: "0.5rem 0.75rem",
                background: "var(--np-surface-1, rgba(0, 0, 0, 0.2))",
                border: "1px solid var(--np-hairline, rgba(255, 255, 255, 0.1))",
                borderRadius: "var(--np-radius-sm, 4px)",
                fontSize: "0.78rem",
              }}
              data-testid="stage-probe-result"
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.25rem",
                  flexWrap: "wrap",
                  gap: "0.4rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ color: "var(--np-text)" }}>
                    {currentProbeResult.probe_type}
                  </strong>
                  <span
                    className={`np-badge np-badge--${
                      currentProbeResult.status === "success"
                        ? "healthy"
                        : currentProbeResult.status === "degraded"
                        ? "spike"
                        : "finding"
                    }`}
                  >
                    {currentProbeResult.status.replace(/_/g, " ").toUpperCase()}
                  </span>
                  {currentProbeResult.target && (
                    <span
                      style={{
                        fontFamily: "var(--np-font-mono)",
                        color: "var(--np-text-dim)",
                        fontSize: "0.72rem",
                      }}
                    >
                      ({currentProbeResult.target})
                    </span>
                  )}
                </div>
                {typeof currentProbeResult.latency_ms === "number" && (
                  <span
                    style={{
                      fontFamily: "var(--np-font-mono)",
                      color: "var(--np-accent)",
                      fontWeight: 600,
                    }}
                  >
                    {currentProbeResult.latency_ms.toFixed(1)} ms
                  </span>
                )}
              </div>
              <p style={{ margin: "0.2rem 0", color: "var(--np-text-dim)", lineHeight: 1.4 }}>
                {currentProbeResult.summary}
              </p>
              {currentProbeResult.details && currentProbeResult.details.length > 0 && (
                <ul
                  style={{
                    margin: "0.3rem 0 0 0",
                    paddingLeft: "1.2rem",
                    color: "var(--np-text-mute)",
                    fontSize: "0.72rem",
                    fontFamily: "var(--np-font-mono)",
                  }}
                >
                  {currentProbeResult.details.map((detail, idx) => (
                    <li key={idx}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Probe Failure Notice */}
          {probeError && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.4rem 0.6rem",
                color: "var(--np-sem-failure, #ef4444)",
                background: "var(--np-finding-soft, rgba(239, 68, 68, 0.1))",
                borderRadius: "var(--np-radius-xs, 3px)",
                fontSize: "0.75rem",
              }}
              data-testid="stage-probe-error"
            >
              Probe error: {probeError}
            </div>
          )}
        </div>
      )}
    </nav>
  );
});
