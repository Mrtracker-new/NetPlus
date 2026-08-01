import { useTranslation } from "react-i18next";
import { EvidenceChips } from "@netpulse/components";
import type { TimelineEvent } from "../../utils/timeline.utils";
import type { NavigationSource } from "../../context/EvidenceNavigationContext";

export interface TimelineInspectorProps {
  event: TimelineEvent;
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  onNavigateEvidence: (ref: any, source?: NavigationSource) => void;
}

export function TimelineInspector({
  event,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  onNavigateEvidence,
}: TimelineInspectorProps) {
  const { t } = useTranslation(["timeline"]);

  const severityColor =
    event.severity === "finding"
      ? "var(--np-danger, #ff5c7c)"
      : event.severity === "notable"
      ? "var(--np-warning, #ffb800)"
      : "var(--np-accent, #2fe0d6)";

  return (
    <section
      aria-label="Selected timeline event inspector"
      style={{
        marginTop: "2rem",
        background: "var(--np-surface-1, #131b2a)",
        border: `1px solid ${severityColor}`,
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
        transition: "all 0.2s ease-in-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              padding: "0.2rem 0.6rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              borderRadius: "var(--np-radius-sm, 4px)",
              background: severityColor,
              color: "#000",
            }}
          >
            {event.severity}
          </span>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            {event.headline}
          </h3>
        </div>

        {/* Previous / Next Stepper Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--np-muted, #8b9bb4)", marginRight: "0.5rem" }}>
            {currentIndex + 1} of {totalCount}
          </span>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            onClick={onPrev}
            disabled={currentIndex <= 0}
            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem", cursor: currentIndex <= 0 ? "not-allowed" : "pointer", opacity: currentIndex <= 0 ? 0.5 : 1 }}
          >
            ◀ {t("prev_event")}
          </button>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem", cursor: currentIndex >= totalCount - 1 ? "not-allowed" : "pointer", opacity: currentIndex >= totalCount - 1 ? 0.5 : 1 }}
          >
            {t("next_event")} ▶
          </button>
        </div>
      </div>

      <p style={{ margin: "0 0 1rem 0", fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", lineHeight: "1.5" }}>
        {event.summary}
      </p>

      {/* Backing Evidence Chips */}
      {event.evidence && event.evidence.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--np-muted, #8b9bb4)", marginBottom: "0.35rem" }}>
            Telemetry Evidence:
          </div>
          <EvidenceChips evidence={event.evidence} onNavigate={(ref) => onNavigateEvidence(ref, "timeline")} />
        </div>
      )}

      {/* Event Details Grid */}
      {event.lines && event.lines.length > 0 && (
        <div
          style={{
            background: "var(--np-bg, #0b1019)",
            padding: "0.75rem 1rem",
            borderRadius: "var(--np-radius-md, 8px)",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            color: "var(--np-text, #e2e8f0)",
          }}
        >
          {event.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </section>
  );
}
