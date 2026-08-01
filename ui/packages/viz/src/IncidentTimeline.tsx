import { memo, useMemo } from "react";
import type { ReactElement } from "react";
import type { IncidentTimeline, SecurityFinding, EvidenceRef } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";

export interface IncidentTimelineVizProps {
  timeline?: IncidentTimeline | null;
  findings?: SecurityFinding[];
  onNavigateEvidence?: (ref: EvidenceRef) => void;
  className?: string;
}

export const IncidentTimelineViz = memo(function IncidentTimelineViz({
  timeline,
  findings,
  onNavigateEvidence,
  className = "",
}: IncidentTimelineVizProps): ReactElement | null {
  const nodes = useMemo(() => {
    if (timeline?.nodes && timeline.nodes.length > 0) {
      return timeline.nodes;
    }
    if (findings && findings.length > 0) {
      return findings.map((f, idx) => ({
        finding: f,
        timestamp_nanos: idx * 1000,
        stage_label: f.title,
      }));
    }
    return [];
  }, [timeline, findings]);

  if (nodes.length === 0) {
    return null;
  }

  const title = timeline?.title ?? "Security Incident Timeline";
  const summary =
    timeline?.narrative_summary ??
    `Reconstructed ${nodes.length} multi-stage security finding${nodes.length === 1 ? "" : "s"} along the causal time axis.`;

  return (
    <section
      className={`np-panel np-incident-timeline ${className}`.trim()}
      aria-label="Security Incident Timeline"
      style={{ marginBottom: "1.5rem" }}
    >
      <header style={{ marginBottom: "1rem" }}>
        <h3 className="np-panel__title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "var(--np-accent-strong, #10b981)" }}>⚡</span>
          {title}
        </h3>
        <p className="np-hero__sub" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
          {summary}
        </p>
      </header>

      <div
        className="np-incident-timeline__track"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          position: "relative",
          paddingLeft: "1.5rem",
          borderLeft: "2px solid var(--np-hairline, rgba(255, 255, 255, 0.1))",
        }}
      >
        {nodes.map((node, index) => {
          const f = node.finding;
          const conf = f.confidence_percent;
          const color =
            conf >= 80 ? "var(--np-finding, #ef4444)" : conf >= 50 ? "#f59e0b" : "#10b981";

          return (
            <div
              key={`${node.stage_label}-${index}`}
              className="np-incident-node"
              style={{ position: "relative" }}
            >
              {/* Timeline marker node dot */}
              <span
                style={{
                  position: "absolute",
                  left: "-1.95rem",
                  top: "0.25rem",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: color,
                  boxShadow: `0 0 6px ${color}`,
                }}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{node.stage_label}</div>
                <div
                  className="np-confidence-word"
                  style={{ fontSize: "0.75rem", color: color }}
                >
                  {f.qualitative} · {conf}%
                </div>
              </div>

              <p
                style={{
                  fontSize: "0.82rem",
                  color: "var(--np-text-dim, #94a3b8)",
                  margin: "0.25rem 0 0.5rem 0",
                }}
              >
                {f.explanation}
              </p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <EvidenceChips evidence={f.evidence} onNavigate={onNavigateEvidence} />
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--np-text-mute, #64748b)",
                    fontStyle: "italic",
                  }}
                >
                  {f.suggested_action}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

IncidentTimelineViz.displayName = "IncidentTimelineViz";
