import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { HealthViewModel } from "./viewModels";

interface HealthStripProps {
  health: HealthViewModel;
}

function compactName(name: string, t: TFunction): string {
  switch (name) {
    case "Capture Pipeline":
      return t("health.capture", "Capture");
    case "Storage Engine":
      return t("health.storage", "Storage");
    case "Process Correlator":
      return t("health.correlator", "Correlator");
    case "Network Driver":
      return t("health.driver", "Driver");
    case "Diagnostic Engine":
      return t("health.diagnostics", "Diagnostics");
    default:
      return name;
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function compactDetail(detail: string): string {
  if (
    detail === "Active streaming" ||
    detail === "Nominal" ||
    detail === "Standby" ||
    detail === "Inactive"
  ) {
    return detail;
  }

  // Handle drops: "Active (68409 drops recorded, stage: None)" -> "Active (68.4k drops)"
  const dropMatch = detail.match(/(\d+)\s+drops/);
  if (dropMatch) {
    const drops = parseInt(dropMatch[1]!, 10);
    const dropStr = drops >= 1000 ? `${(drops / 1000).toFixed(1)}k` : String(drops);
    return `Active (${dropStr} drops)`;
  }

  // Handle flows: "Active (296 flows retained)" -> "296 flows"
  const flowMatch = detail.match(/(\d+)\s+flows/);
  if (flowMatch) {
    return `${flowMatch[1]} flows`;
  }

  // Handle socket correlator: "OS Socket Table Sampling Active" -> "Active"
  if (detail.includes("Sampling Active") || detail.includes("Table Sampling")) {
    return "Active";
  }

  // Handle network driver: "Attached & Capturing" -> "Capturing"
  if (detail.includes("Attached") || detail.includes("Capturing")) {
    return "Capturing";
  }

  // Handle diagnostic engine: "{n}/7 Hops Grounded" -> "{n} Hops Grounded"
  const hopMatch = detail.match(/(\d+)\/7\s+Hops\s+Grounded/);
  if (hopMatch) {
    return `${hopMatch[1]} Hops Grounded`;
  }
  if (detail.includes("7 Hops")) {
    return "7 Hops Grounded";
  }

  return detail;
}

// ARCHITECTURAL INVARIANT: capture_drops is displayed strictly as an independent
// authoritative observation, and MUST NOT modify, override, or reinterpret SubsystemStatus.status.
export const HealthStrip = memo(function HealthStrip({ health }: HealthStripProps) {
  const { t } = useTranslation("dashboard");
  const subsystems = health.subsystems ?? [];
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);

  const dropsTooltipId = "health-tooltip-drops";
  const dropsDescription = t("health.drops_desc", "Kernel / Buffer Packet Drop Count");
  const isDropsActive = activeTooltipId === dropsTooltipId;

  return (
    <div className="np-health-strip" role="region" aria-label={t("health.system_health", "System Health Telemetry")}>
      {subsystems.map((sub, idx) => {
        const isHealthy = sub.status === "healthy";
        const isWarning = sub.status === "warning";
        const isDegraded = sub.status === "degraded";

        const dotClass = isHealthy
          ? "np-health-dot--active"
          : isWarning
          ? "np-health-dot--warning"
          : isDegraded
          ? "np-health-dot--degraded"
          : "";

        const valClass = isHealthy
          ? "np-health-strip__val"
          : isWarning
          ? "np-health-strip__val np-health-strip__val--warning"
          : "np-health-strip__val np-health-strip__val--degraded";

        const displayName = compactName(sub.name, t);
        const displayDetail = compactDetail(sub.detail);
        const slug = slugify(sub.name);
        const tooltipId = `health-tooltip-${slug}`;
        const description = `${sub.name}: ${sub.detail}`;
        const isActive = activeTooltipId === tooltipId;

        return (
          <span key={sub.name} style={{ display: "contents" }}>
            {idx > 0 && <div className="np-health-strip__divider" aria-hidden="true">•</div>}
            <div
              className="np-health-strip__item"
              tabIndex={0}
              title={description}
              aria-description={description}
              aria-describedby={isActive ? tooltipId : undefined}
              onMouseEnter={() => setActiveTooltipId(tooltipId)}
              onMouseLeave={() => setActiveTooltipId((prev) => (prev === tooltipId ? null : prev))}
              onFocus={() => setActiveTooltipId(tooltipId)}
              onBlur={() => setActiveTooltipId((prev) => (prev === tooltipId ? null : prev))}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setActiveTooltipId(null);
                }
              }}
            >
              <span className={`np-health-dot ${dotClass}`} aria-hidden="true" />
              <span className="np-health-strip__label">{displayName}:</span>
              <span className={valClass}>
                {(isWarning || isDegraded) && <span className="np-health-glyph" aria-hidden="true">⚠ </span>}
                {displayDetail}
              </span>
              {isActive && (
                <span id={tooltipId} className="np-health-strip__tooltip" role="tooltip">
                  {description}
                </span>
              )}
            </div>
          </span>
        );
      })}

      {subsystems.length > 0 && <div className="np-health-strip__divider" aria-hidden="true">•</div>}

      <div
        className="np-health-strip__item"
        tabIndex={0}
        title={dropsDescription}
        aria-description={dropsDescription}
        aria-describedby={isDropsActive ? dropsTooltipId : undefined}
        onMouseEnter={() => setActiveTooltipId(dropsTooltipId)}
        onMouseLeave={() => setActiveTooltipId((prev) => (prev === dropsTooltipId ? null : prev))}
        onFocus={() => setActiveTooltipId(dropsTooltipId)}
        onBlur={() => setActiveTooltipId((prev) => (prev === dropsTooltipId ? null : prev))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setActiveTooltipId(null);
          }
        }}
      >
        <span className="np-health-strip__label">{t("health.drops", "Drops")}:</span>
        <span className={health.drops > 0 ? "np-health-strip__val np-health-strip__val--numeric" : "np-health-strip__val"}>
          {health.drops}
        </span>
        {isDropsActive && (
          <span id={dropsTooltipId} className="np-health-strip__tooltip" role="tooltip">
            {dropsDescription}
          </span>
        )}
      </div>
    </div>
  );
});
