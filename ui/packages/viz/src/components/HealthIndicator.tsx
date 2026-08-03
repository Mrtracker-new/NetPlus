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

  const getStatusIcon = () => {
    switch (status) {
      case "healthy":
        return "●";
      case "warning":
      case "degraded":
        return "▲";
      case "critical":
        return "✖";
      default:
        return "○";
    }
  };

  const color = getStatusColor();

  if (layout === "vertical") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }} role="status">
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {showIcon && (
            <span aria-hidden="true" style={{ color, fontSize: "0.75rem", lineHeight: 1 }}>
              {getStatusIcon()}
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
            color,
            fontSize: "0.75rem",
            lineHeight: 1,
          }}
        >
          {getStatusIcon()}
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
