import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { HealthIndicator } from "@netpulse/viz";
import type { Diagnosis, EvidenceRef } from "@netpulse/contract";
import type { SubsystemStatus, ActiveAlert, IntelligentRecommendation } from "./monitoringTypes";
import { DiagnosisCard } from "./DiagnosisCard";
import { Icon } from "../../icons";

export interface DiagnosticsSectionProps {
  /** @deprecated Synthetic alerts are retired in favor of authoritative Rust diagnoses */
  alerts?: ActiveAlert[];
  subsystems: SubsystemStatus[];
  /** @deprecated Synthetic recommendations are retired in favor of authoritative Rust diagnoses */
  recommendations?: IntelligentRecommendation[];
  diagnoses: Diagnosis[];
  onNavigateEvidence: (ref: EvidenceRef) => void;
}

export function DiagnosticsSection({
  subsystems = [],
  diagnoses = [],
  onNavigateEvidence,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation(["monitoring"]);
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
      {/* Diagnostic Hypotheses Cards — Prioritized Rust Engine Diagnoses */}
      {diagnoses.length > 0 && (
        <div className="np-monitor-card" aria-label={t("diagnostics.hypotheses_aria_label", "Diagnostic Hypotheses")}>
          <div className="np-monitor-card__header">
            <h3 className="np-monitor-card__title">{t("diagnostics.hypotheses_title", "Diagnostic Hypotheses")}</h3>
            <span className="np-monitor-badge np-monitor-badge--warning">
              {t("diagnostics.hypotheses_active_count", {
                count: diagnoses.length,
                defaultValue: `${diagnoses.length} Active`,
              })}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {diagnoses.map((d, i) => (
              <DiagnosisCard key={i} diagnosis={d} onNavigateEvidence={onNavigateEvidence} />
            ))}
          </div>
        </div>
      )}

      {/* Subsystem Health Grid — True Neumorphic Tiles (Authoritative Rust Telemetry) */}
      <div className="np-monitor-card" aria-label={t("diagnostics.subsystems_aria_label", "System Subsystem Health")}>
        <div className="np-monitor-card__header">
          <h3 className="np-monitor-card__title">{t("diagnostics.subsystems_title", "System Subsystem Health")}</h3>
          <span style={{ fontSize: "0.78rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
            {t("diagnostics.subsystems_healthy", {
              healthy: subsystems.filter((s) => s.status === "healthy").length,
              total: subsystems.length,
              defaultValue: `${subsystems.filter((s) => s.status === "healthy").length}/${subsystems.length} Subsystems Healthy`,
            })}
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
                aria-label={t("diagnostics.inspect_subsystem", {
                  name: sub.name,
                  status: sub.status,
                  detail: sub.detail,
                  defaultValue: `Inspect ${sub.name} status: ${sub.status}, ${sub.detail}`,
                })}
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
                {t("diagnostics.subsystem_name", {
                  name: selectedSubsystem.name,
                  defaultValue: `${selectedSubsystem.name} Subsystem`,
                })}
              </span>
              <span style={{ color: "var(--np-text-dim)", marginLeft: "0.75rem", fontFamily: "var(--np-font-mono)", fontSize: "0.8rem" }}>
                {t("diagnostics.subsystem_status_metric", {
                  status: selectedSubsystem.status.toUpperCase(),
                  detail: selectedSubsystem.detail,
                  defaultValue: `Status: ${selectedSubsystem.status.toUpperCase()} • Metric: ${selectedSubsystem.detail}`,
                })}
              </span>
            </div>
            <button
              type="button"
              className="np-monitor-icon-btn"
              style={{ padding: "4px 6px" }}
              onClick={() => setSelectedSubsystem(null)}
              aria-label={t("diagnostics.close_details", "Close details")}
            >
              <Icon name="close" style={{ width: "12px", height: "12px" }} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

