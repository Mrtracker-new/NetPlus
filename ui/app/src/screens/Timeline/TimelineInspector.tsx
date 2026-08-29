import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EvidenceChips } from "@netpulse/components";
import type { TimelineEvent } from "../../utils/timeline.utils";
import type { NavigationSource } from "../../context/EvidenceNavigationContext";
import { Icon } from "../../icons";

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const severityColor =
    event.severity === "finding"
      ? "var(--np-finding, #ef6167)"
      : event.severity === "notable"
      ? "var(--np-notable, #f2b64d)"
      : "var(--np-accent, #2fe0d6)";

  const handleCopyLogs = async () => {
    if (!event.lines || event.lines.length === 0) return;
    const logText = event.lines.join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(logText);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = logText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
    } catch {
      setCopied(true);
    }
  };

  return (
    <section
      className="np-timeline-inspector"
      aria-label="Selected timeline event inspector"
    >
      {/* Top Subtle Severity Accent Bar */}
      <div
        className="np-timeline-inspector__accent-rim"
        style={{ background: severityColor }}
        aria-hidden="true"
      />

      {/* Header Bar */}
      <div className="np-timeline-inspector__header">
        <div className="np-timeline-inspector__lead">
          <span
            className="np-timeline-inspector__badge"
            style={{ background: severityColor }}
          >
            {event.severity}
          </span>
          <h3 className="np-timeline-inspector__title">{event.headline}</h3>
        </div>

        {/* Previous / Next Stepper Controls */}
        <div className="np-timeline-inspector__controls">
          <span className="np-timeline-inspector__counter">
            {currentIndex + 1} of {totalCount}
          </span>
          <button
            type="button"
            className="np-timeline-inspector__btn-stepper"
            onClick={onPrev}
            disabled={currentIndex <= 0}
            aria-disabled={currentIndex <= 0}
            aria-label={`Previous event (${currentIndex} of ${totalCount})`}
          >
            <span>◀</span>
            <span>{t("prev_event")}</span>
          </button>
          <button
            type="button"
            className="np-timeline-inspector__btn-stepper"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
            aria-disabled={currentIndex >= totalCount - 1}
            aria-label={`Next event (${currentIndex + 2} of ${totalCount})`}
          >
            <span>{t("next_event")}</span>
            <span>▶</span>
          </button>
        </div>
      </div>

      {/* Event Summary Narrative */}
      <p className="np-timeline-inspector__summary">{event.summary}</p>

      {/* Backing Evidence Chips */}
      {event.evidence && event.evidence.length > 0 && (
        <div className="np-timeline-inspector__evidence-section">
          <div className="np-timeline-inspector__section-label">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            <span>Telemetry Evidence</span>
          </div>
          <EvidenceChips
            evidence={event.evidence}
            onNavigate={(ref: any) => onNavigateEvidence(ref, "timeline")}
          />
        </div>
      )}

      {/* Event Log Lines / Telemetry Well */}
      {event.lines && event.lines.length > 0 && (
        <div>
          <div className="np-timeline-inspector__diagnostic-bar">
            <div className="np-timeline-inspector__section-label" style={{ margin: 0 }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>Diagnostic Output</span>
            </div>
            <button
              type="button"
              className="np-btn np-btn--ghost np-timeline-inspector__copy-btn"
              onClick={handleCopyLogs}
              aria-label="Copy diagnostic logs"
            >
              <Icon name="copy" style={{ width: "12px", height: "12px" }} />
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>
          <div className="np-timeline-inspector__log-well">
            {event.lines.map((line, i) => (
              <div className="np-timeline-inspector__log-line" key={i}>
                <span className="np-timeline-inspector__log-num">{i + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}


