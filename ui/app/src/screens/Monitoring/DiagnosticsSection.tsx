import { useState, useEffect } from "react";
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

  // Close subsystem details on Escape key
  useEffect(() => {
    if (!selectedSubsystem) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedSubsystem(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSubsystem]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "0.5rem" }}>
      {/* Subsystem Health Grid — True Neumorphic Tiles */}
      <div className="np-monitor-card" aria-label="System Subsystem Health">
        <div className="np-monitor-card__header">
          <h3 className="np-monitor-card__title">System Subsystem Health</h3>
          <span style={{ fontSize: "0.78rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
            {subsystems.filter((s) => s.status === "healthy").length}/{subsystems.length} Subsystems Healthy
          </span>
        </div>

        {/* Spacious 4-Column Responsive Grid */}
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
                className={`np-subsystem-tile ${isSelected ? "np-subsystem-tile--selected" : ""}`}
                onClick={() => setSelectedSubsystem(isSelected ? null : sub)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSubsystem(isSelected ? null : sub);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Inspect ${sub.name} status: ${sub.status}, ${sub.detail}`}
              >
                <HealthIndicator status={sub.status} label={sub.name} sublabel={sub.detail} layout="vertical" />
              </div>
            );
          })}
        </div>

        {/* Subsystem Detail Drawer — Level 4 Overlay Plate */}
        {selectedSubsystem && (
          <div className="np-subsystem-detail-drawer" style={{ marginTop: "0.75rem" }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--np-text)" }}>
                {selectedSubsystem.name} Subsystem
              </span>
              <span style={{ color: "var(--np-text-dim)", marginLeft: "0.75rem", fontFamily: "var(--np-font-mono)", fontSize: "0.8rem" }}>
                Status: {selectedSubsystem.status.toUpperCase()} • Metric: {selectedSubsystem.detail}
              </span>
            </div>
            <button
              type="button"
              className="np-monitor-icon-btn"
              style={{ padding: "4px 6px" }}
              onClick={() => setSelectedSubsystem(null)}
              aria-label="Close details"
            >
              <Icon name="close" style={{ width: "12px", height: "12px" }} />
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
              <p style={{ color: "var(--np-sem-nominal, var(--np-good))", fontSize: "0.85rem", margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
                        ? "var(--np-finding-soft)"
                        : "var(--np-notable-soft)",
                    borderLeft: `3px solid ${
                      a.severity === "critical" ? "var(--np-sem-failure, #ef4444)" : "var(--np-sem-investigate, #f59e0b)"
                    }`,
                    padding: "0.6rem 0.85rem",
                    borderRadius: "var(--np-radius-xs)",
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
                  background: "var(--np-surface-recessed)",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "var(--np-radius-sm)",
                  fontSize: "0.825rem",
                  border: "1px solid var(--np-border)",
                  boxShadow: "var(--np-neu-sm)",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--np-accent-strong, var(--np-text))", display: "flex", alignItems: "center", gap: "0.35rem" }}>
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

