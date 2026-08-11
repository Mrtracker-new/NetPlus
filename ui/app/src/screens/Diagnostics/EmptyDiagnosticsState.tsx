import { Button } from "@netpulse/components";
import { Icon } from "../../icons";

interface EmptyDiagnosticsStateProps {
  target: string;
  onSetTarget: (newTarget: string) => void;
  onRunPing: () => void;
  onRunTraceroute: () => void;
  onRunBufferbloat: () => void;
}

const QUICK_TARGETS = [
  { label: "1.1.1.1", value: "1.1.1.1" },
  { label: "8.8.8.8", value: "8.8.8.8" },
  { label: "9.9.9.9", value: "9.9.9.9" },
  { label: "Local Gateway", value: "192.168.1.1" },
];

export function EmptyDiagnosticsState({
  target,
  onSetTarget,
  onRunPing,
  onRunTraceroute,
  onRunBufferbloat,
}: EmptyDiagnosticsStateProps) {
  return (
    <div className="np-diagnostics__empty">
      <div className="np-diagnostics__empty-icon">
        <Icon name="diagnostics" />
      </div>

      <h3
        style={{
          margin: "0 0 0.4rem 0",
          fontSize: "1.1rem",
          fontWeight: 600,
          color: "var(--np-text)",
        }}
      >
        Run a network diagnostic
      </h3>

      <p
        style={{
          margin: 0,
          maxWidth: "52ch",
          fontSize: "0.875rem",
          color: "var(--np-text-dim)",
          lineHeight: 1.5,
        }}
      >
        Enter a target hostname or IP address (IPv4, IPv6, domain) and choose a diagnostic probe.
      </p>

      {/* Direct Probe Actions */}
      <div className="np-diagnostics__empty-actions">
        <Button variant="primary" onClick={onRunPing} aria-label="Run Ping Probe">
          Ping Probe
        </Button>
        <Button variant="standard" onClick={onRunTraceroute} aria-label="Run Traceroute">
          Traceroute
        </Button>
        <Button variant="standard" onClick={onRunBufferbloat} aria-label="Run Bufferbloat Test">
          Bufferbloat Test
        </Button>
      </div>

      {/* Quick Targets Selection */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontWeight: 600 }}>
          Quick targets
        </span>
        <div className="np-diagnostics__presets">
          {QUICK_TARGETS.map((qt) => (
            <button
              key={qt.value}
              type="button"
              className={`np-diagnostics__preset-btn ${target === qt.value ? "np-diagnostics__preset-btn--active" : ""}`}
              onClick={() => onSetTarget(qt.value)}
            >
              {qt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
