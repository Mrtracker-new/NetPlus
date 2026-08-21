import React from "react";

export interface HealthIndicatorProps {
  status: "healthy" | "warning" | "critical" | "unknown" | "degraded";
  label: string;
  sublabel?: string;
  showIcon?: boolean;
  layout?: "horizontal" | "vertical";
}

export function HealthIndicator({
  status,
  label,
  sublabel,
  showIcon = true,
  layout = "vertical",
}: HealthIndicatorProps) {
  const getStatusColor = () => {
    switch (status) {
      case "healthy":
        return "var(--np-good, #10b981)";
      case "warning":
      case "degraded":
        return "var(--np-notable, #f59e0b)";
      case "critical":
        return "var(--np-finding, #ef4444)";
      default:
        return "var(--np-neutral, #9ca3af)";
    }
  };

  const renderStatusIcon = () => {
    switch (status) {
      case "healthy":
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill={color} aria-hidden="true">
            <circle cx="5" cy="5" r="4.5" />
          </svg>
        );
      case "warning":
      case "degraded":
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case "critical":
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      default:
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={color} strokeWidth="2" aria-hidden="true">
            <circle cx="5" cy="5" r="4" />
          </svg>
        );
    }
  };

  const color = getStatusColor();

  if (layout === "vertical") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }} role="status">
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {showIcon && (
            <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {renderStatusIcon()}
            </span>
          )}
          <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--np-text, #fff)" }}>
            {label}
          </span>
        </div>
        {sublabel && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--np-text-dim, #9ca3af)",
              paddingLeft: showIcon ? "1.15rem" : "0",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {sublabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        fontSize: "0.825rem",
        fontWeight: 500,
        color: "var(--np-text)",
      }}
      role="status"
    >
      {showIcon && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderStatusIcon()}
        </span>
      )}
      <span>{label}</span>
      {sublabel && (
        <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)" }}>
          ({sublabel})
        </span>
      )}
    </div>
  );
}
