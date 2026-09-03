import { memo, useState } from "react";
import type {
  DiagnosticChain,
  DiagnosticChainStageKind,
  DiagnosticStageNode,
  DiagnosticStageStatus,
  EvidenceRef,
} from "@netpulse/contract";

interface DiagnosticChainStripProps {
  chain?: DiagnosticChain | null;
  onSelectStage?: (stage: DiagnosticStageNode) => void;
  onNavigateToEvidence?: (ref: EvidenceRef) => void;
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
}: DiagnosticChainStripProps) {
  const [inspectedKind, setInspectedKind] = useState<DiagnosticChainStageKind | null>(null);

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

  const handleNodeClick = (def: StageDefinition, node?: DiagnosticStageNode) => {
    if (inspectedKind === def.kind) {
      setInspectedKind(null);
    } else {
      setInspectedKind(def.kind);
      if (node) {
        onSelectStage?.(node);
      }
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
            typeof node?.latency_ms === "number" ? `${Math.round(node.latency_ms)} ms` : null;
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
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={`np-badge np-badge--${statusVariant(inspectedNode?.status ?? "unmeasured")}`}>
                ● {statusText(inspectedNode?.status ?? "unmeasured")}
              </span>
              <strong style={{ fontSize: "0.85rem", color: "var(--np-text)" }}>
                {inspectedNode?.label || inspectedDef.defaultLabel} Stage Measurement
              </strong>
              {typeof inspectedNode?.latency_ms === "number" && (
                <span style={{ fontSize: "0.75rem", fontFamily: "var(--np-font-mono)", color: "var(--np-text-dim)" }}>
                  (RTT: {Math.round(inspectedNode.latency_ms)} ms)
                </span>
              )}
            </div>
            <button
              type="button"
              className="np-btn np-btn--ghost np-btn--xs"
              onClick={() => setInspectedKind(null)}
              aria-label="Close stage details"
            >
              ✕
            </button>
          </div>

          <p style={{ margin: "0.35rem 0 0.5rem 0", fontSize: "0.8rem", color: "var(--np-text-dim)", lineHeight: 1.4 }}>
            {inspectedNode?.summary || inspectedDef.defaultDescription}
            {inspectedNode?.detail ? ` — ${inspectedNode.detail}` : inspectedNode ? "" : " — No probe or passive telemetry recorded for this hop yet."}
          </p>

          {inspectedNode?.evidence && inspectedNode.evidence.length > 0 && onNavigateToEvidence && (
            <div style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="np-btn np-btn--primary np-btn--xs"
                onClick={() => onNavigateToEvidence(inspectedNode.evidence[0]!)}
              >
                Inspect Stage Evidence ({inspectedNode.evidence[0]!.kind} #{inspectedNode.evidence[0]!.id}) →
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
});
