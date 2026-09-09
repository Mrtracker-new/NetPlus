import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EvidenceChips } from "@netpulse/components";
import type { TimelineEvent } from "../../utils/timeline.utils";
import type { NavigationSource } from "../../context/EvidenceNavigationContext";
import { useStore } from "../../state/store";
import { Icon } from "../../icons";

export interface TimelineInspectorProps {
  event: TimelineEvent;
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  onNavigateEvidence: (ref: any, source?: NavigationSource) => void;
}

/** Format monotonic elapsed nanoseconds into standard telemetry relative time offset (e.g. T +14.2s) */
export function formatRelativeTime(event: TimelineEvent): string {
  const atNanos = event.at ?? event.at_mono_nanos ?? 0;
  const seconds =
    atNanos > 0 && atNanos < 1000 && !Number.isInteger(atNanos)
      ? atNanos
      : atNanos / 1e9;
  return `T +${Math.max(0, seconds).toFixed(1)}s`;
}

/** Format wall-clock time string based on authoritative session or event timestamp */
export function formatWallTimeClock(event: TimelineEvent, captureSessionId?: string | null): string {
  const ev = event as any;
  if (typeof ev.wall_time === "string") return ev.wall_time;
  if (typeof ev.wallTime === "string") return ev.wallTime;
  if (typeof ev.wall_clock === "string") return ev.wall_clock;
  if (typeof ev.wallClock === "string") return ev.wallClock;
  if (typeof ev.clock === "string") return ev.clock;

  const rawWall = ev.wall_nanos ?? ev.timestamp ?? ev.wallNanos;
  if (typeof rawWall === "number" && !isNaN(rawWall)) {
    const ms = rawWall > 1e14 ? rawWall / 1e6 : rawWall > 1e11 ? rawWall : rawWall * 1000;
    return new Date(ms).toLocaleTimeString();
  }

  const atNanos = event.at ?? event.at_mono_nanos ?? 0;
  if (atNanos > 1e14) {
    return new Date(atNanos / 1e6).toLocaleTimeString();
  }
  if (atNanos > 1e11) {
    return new Date(atNanos).toLocaleTimeString();
  }

  if (captureSessionId) {
    const match = captureSessionId.match(/session-(\d+)/);
    if (match && match[1]) {
      const baseMs = Number(match[1]);
      const offsetMs =
        atNanos > 0 && atNanos < 1000 && !Number.isInteger(atNanos)
          ? atNanos * 1000
          : atNanos / 1e6;
      return new Date(baseMs + offsetMs).toLocaleTimeString();
    }
  }

  const offsetMs =
    atNanos > 0 && atNanos < 1000 && !Number.isInteger(atNanos)
      ? atNanos * 1000
      : atNanos / 1e6;
  return new Date(offsetMs).toLocaleTimeString();
}

/** Resolve canonical category identifier and human-readable label */
export function resolveCategory(event: TimelineEvent): { id: string; label: string } {
  if (event.category) {
    const cat = event.category.toLowerCase();
    switch (cat) {
      case "security":
      case "findings":
        return { id: "security", label: "Security" };
      case "dns":
        return { id: "dns", label: "DNS" };
      case "network":
        return { id: "network", label: "Network" };
      case "tls":
        return { id: "tls", label: "TLS" };
      case "performance":
        return { id: "performance", label: "Performance" };
      case "applications":
        return { id: "applications", label: "Applications" };
      case "general":
        return { id: "general", label: "General" };
      default:
        return { id: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1) };
    }
  }

  if (event.protocol) {
    const proto = event.protocol.toUpperCase();
    if (proto === "DNS") return { id: "dns", label: "DNS" };
    if (["TLS", "TLS 1.3", "TLS 1.2", "HTTPS", "QUIC", "HTTP/3"].some((p) => proto.includes(p))) {
      return { id: "tls", label: "TLS" };
    }
    if (["TCP", "UDP", "HTTP", "HTTP/2", "IP"].some((p) => proto.includes(p))) {
      return { id: "network", label: "Network" };
    }
  }

  const text = `${event.headline} ${event.summary || ""}`.toLowerCase();
  if (/\bdns\b/i.test(text)) {
    return { id: "dns", label: "DNS" };
  }
  if (/\b(tls|ssl|cert|handshake|cipher)\b/i.test(text)) {
    return { id: "tls", label: "TLS" };
  }
  if (event.severity === "finding" || /\b(attack|threat|flood|exfiltration|vulnerability|suspicious|anomaly)\b/i.test(text)) {
    return { id: "security", label: "Security" };
  }
  if (/\b(latency|rtt|timeout|drop|retransmit|performance|congestion)\b/i.test(text)) {
    return { id: "performance", label: "Performance" };
  }
  if (event.evidence?.some((e) => e.kind === "flow" || e.kind === "packet")) {
    return { id: "network", label: "Network" };
  }

  return { id: "general", label: "General" };
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
  const { captureSessionId } = useStore();
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

  const relativeTime = formatRelativeTime(event);
  const wallTimeClock = formatWallTimeClock(event, captureSessionId);
  const category = resolveCategory(event);

  const diagnosticLines = event.lines && event.lines.length > 0 ? event.lines : [];

  const handleCopyLogs = async () => {
    if (diagnosticLines.length === 0) return;
    const logText = diagnosticLines.join("\n");
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
      // Clipboard write failed; do not report "Copied!" on catch
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
            className={`np-timeline-inspector__badge np-timeline-inspector__badge--${event.severity}`}
            data-sev={event.severity}
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

      {/* Metadata Header: Relative elapsed time, wall time clock, category badge, protocol tag */}
      <div className="np-timeline-inspector__metadata" role="region" aria-label="Event metadata">
        <div className="np-timeline-inspector__time-group" title="Event timing">
          <Icon name="clock" style={{ width: "13px", height: "13px" }} aria-hidden="true" />
          <span className="np-timeline-inspector__time-relative">{relativeTime}</span>
          <span className="np-timeline-inspector__time-divider" aria-hidden="true">·</span>
          <span className="np-timeline-inspector__time-clock">{wallTimeClock}</span>
        </div>

        <span
          className={`np-timeline-inspector__category-badge np-timeline-inspector__category-badge--${category.id}`}
        >
          {category.label}
        </span>

        {event.protocol &&
          event.protocol.trim().toUpperCase() !== category.label.trim().toUpperCase() && (
            <span className="np-timeline-inspector__protocol-tag">
              {event.protocol}
            </span>
          )}
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
      {diagnosticLines.length > 0 && (
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
            {diagnosticLines.map((line, i) => (
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


