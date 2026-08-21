import { useState } from "react";
import { HealthIndicator } from "@netpulse/viz";
import type { Diagnosis, EvidenceRef } from "@netpulse/contract";
import type { SubsystemStatus, ActiveAlert, IntelligentRecommendation } from "./monitoringTypes";
import { DiagnosisCard } from "./DiagnosisCard";
import { Icon } from "../../icons";

export interface DiagnosticsSectionProps {
  alerts: ActiveAlert[];
  subsystems: SubsystemStatus[];
  recommendations: IntelligentRecommendation[];
  diagnoses: Diagnosis[];
  onNavigateEvidence: (ref: EvidenceRef) => void;
}

export function DiagnosticsSection({
  alerts,
  subsystems,
  recommendations,
  diagnoses,
  onNavigateEvidence,
}: DiagnosticsSectionProps) {
  const [selectedSubsystem, setSelectedSubsystem] = useState<SubsystemStatus | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "0.5rem" }}>
      {/* Subsystem Health Grid - Neumorphic Style */}
      <div className="np-monitor-card" aria-label="System Subsystem Health">
        <div className="np-monitor-card__header">
          <h3 className="np-monitor-card__title">System Subsystem Health</h3>
          <span style={{ fontSize: "0.78rem", color: "var(--np-text-mute)" }}>
            {subsystems.filter((s) => s.status === "healthy").length}/{subsystems.length} Subsystems Healthy
          </span>
        </div>

        {/* Spacious 4-Column Responsive Neumorphic Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "0.85rem",
            marginTop: "0.5rem",
          }}
        >
          {subsystems.map((sub, i) => {
            const isSelected = selectedSubsystem?.name === sub.name;
            return (
              <div
                key={i}
                style={{
                  background: isSelected
                    ? "var(--np-surface-3, #27354a)"
                    : "var(--np-surface-2, #161d2b)",
                  padding: "0.85rem 1rem",
                  borderRadius: "var(--np-radius-sm, 12px)",
                  border: isSelected
                    ? "1px solid var(--np-monitor-primary, #00f2fe)"
                    : "1px solid var(--np-border-strong, rgba(255,255,255,0.1))",
                  cursor: "pointer",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: isSelected
                    ? "var(--np-neu-inset), 0 0 16px rgba(0,242,254,0.25)"
                    : "var(--np-neu-sm)",
                }}
                onClick={() => setSelectedSubsystem(isSelected ? null : sub)}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${sub.name} status`}
              >
                <HealthIndicator status={sub.status} label={sub.name} sublabel={sub.detail} layout="vertical" />
              </div>
            );
          })}
        </div>

        {/* Subsystem Detail Popover */}
        {selectedSubsystem && (
          <div
            style={{
              background: "var(--np-surface-2, #161d2b)",
              border: "1px solid var(--np-monitor-primary, #00f2fe)",
              borderRadius: "var(--np-radius-sm, 12px)",
              padding: "0.75rem 1rem",
              marginTop: "0.75rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.85rem",
              boxShadow: "var(--np-neu-inset), 0 0 20px rgba(0,242,254,0.15)",
            }}
          >
            <div>
              <span style={{ fontWeight: 600, color: "var(--np-text)" }}>
                {selectedSubsystem.name} Subsystem
              </span>
              <span style={{ color: "var(--np-text-dim)", marginLeft: "0.75rem" }}>
                Status: {selectedSubsystem.status.toUpperCase()} • Metric: {selectedSubsystem.detail}
              </span>
            </div>
            <button
              style={{
                background: "transparent",
                border: "none",
                color: "var(--np-text-mute)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
              }}
              onClick={() => setSelectedSubsystem(null)}
              aria-label="Close details"
            >
              <Icon name="close" style={{ width: "14px", height: "14px" }} />
            </button>
          </div>
        )}
      </div>

      {/* Active Alerts & Intelligent Recommendations Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.25rem" }}>
        {/* Active Alerts Card */}
        <div className="np-monitor-card" aria-label="Active System Alerts">
          <div className="np-monitor-card__header">
            <h3 className="np-monitor-card__title">Active Alerts</h3>
            {alerts.length > 0 && (
              <span className="np-monitor-badge np-monitor-badge--warning">{alerts.length} Active</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, justifyContent: "center" }}>
            {alerts.length === 0 ? (
              <p style={{ color: "var(--np-good, #10b981)", fontSize: "0.85rem", margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Icon name="checkCircle" style={{ width: "14px", height: "14px" }} />
                <span>No active telemetry alerts detected. System metrics nominal.</span>
              </p>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    background:
                      a.severity === "critical"
                        ? "rgba(239, 68, 68, 0.1)"
                        : "rgba(245, 158, 11, 0.1)",
                    borderLeft: `3px solid ${
                      a.severity === "critical" ? "#ef4444" : "#f59e0b"
                    }`,
                    padding: "0.6rem 0.85rem",
                    borderRadius: "8px",
                    boxShadow: "var(--np-neu-sm)",
                    fontSize: "0.825rem",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--np-text)" }}>{a.title}</div>
                  <div style={{ color: "var(--np-text-dim)", marginTop: "2px" }}>{a.message}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Automated Recommendations Card */}
        <div className="np-monitor-card" aria-label="Intelligent System Recommendations">
          <div className="np-monitor-card__header">
            <h3 className="np-monitor-card__title">Automated Recommendations</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, justifyContent: "center" }}>
            {recommendations.map((r) => (
              <div
                key={r.id}
                style={{
                  background: "var(--np-surface-2, #161d2b)",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "var(--np-radius-sm, 12px)",
                  fontSize: "0.825rem",
                  border: "1px solid var(--np-border, rgba(255,255,255,0.06))",
                  boxShadow: "var(--np-neu-sm)",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--np-monitor-primary, #00f2fe)", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <Icon name="lightbulb" style={{ width: "13px", height: "13px" }} />
                  <span>{r.title}</span>
                </div>
                <div style={{ color: "var(--np-text-dim)", marginTop: "3px" }}>{r.action}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diagnostic Hypotheses Cards */}
      {diagnoses.length > 0 && (
        <div className="np-monitor-card" aria-label="Diagnostic Hypotheses">
          <div className="np-monitor-card__header">
            <h3 className="np-monitor-card__title">Diagnostic Hypotheses</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {diagnoses.map((d, i) => (
              <DiagnosisCard key={i} diagnosis={d} onNavigateEvidence={onNavigateEvidence} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
