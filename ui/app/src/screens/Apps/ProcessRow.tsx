import { useTranslation } from "react-i18next";
import { humanBytes } from "@netpulse/viz";
import type { GroupedProcess } from "../../hooks/useAppsController";
import { Icon } from "../../icons";

export interface ProcessRowProps {
  group: GroupedProcess;
  isExpanded: boolean;
  onToggleExpand: (groupKey: string) => void;
  onInspectFlow: (flowId: number) => void;
}

function formatClassification(c?: string): string {
  if (!c) return "External WAN";
  switch (c.toLowerCase().replace(/_/g, "")) {
    case "localsubnet":
    case "local":
      return "Local Subnet";
    case "gateway":
      return "Gateway";
    case "cdnedge":
      return "CDN Edge";
    case "multicast":
      return "Multicast";
    case "externalwan":
    case "external":
    default:
      return "External WAN";
  }
}

function formatDirection(d?: string): { label: string; icon: string; className: string } {
  const norm = (d || "").toLowerCase();
  if (norm === "inbound") {
    return { label: "Inbound", icon: "↙", className: "np-apps-conduit-badge--inbound" };
  }
  if (norm === "local") {
    return { label: "Local", icon: "↔", className: "np-apps-conduit-badge--local" };
  }
  return { label: "Outbound", icon: "↗", className: "np-apps-conduit-badge--outbound" };
}

export function ProcessRow({
  group,
  isExpanded,
  onToggleExpand,
  onInspectFlow,
}: ProcessRowProps) {
  const { t } = useTranslation(["apps"]);

  const confidenceBadge =
    group.confidence === "high"
      ? { label: t("confidence_labels.high"), glyph: "●", className: "np-apps-badge--high" }
      : group.confidence === "low"
      ? { label: t("confidence_labels.low"), glyph: "●", className: "np-apps-badge--low" }
      : { label: t("confidence_labels.unknown"), glyph: "○", className: "np-apps-badge--unknown" };

  const lineageRegionId = `flow-lineage-${group.key.replace(/\s+/g, "-")}`;

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    onToggleExpand(group.key);
  };

  const hasLineage = Array.isArray(group.lineage) && group.lineage.length > 0;
  const hasFlowIds = Array.isArray(group.flowIds) && group.flowIds.length > 0;

  return (
    <>
      {/* Primary Collapsible Process Row */}
      <tr
        className="np-apps-row"
        data-expanded={isExpanded}
        onClick={handleRowClick}
      >
        <td className="np-apps-td np-apps-td--name">
          <div className="np-apps-process-cell">
            <div className="np-apps-process-icon" aria-hidden="true">
              <Icon name="apps" style={{ width: "16px", height: "16px" }} />
            </div>
            <span className="np-apps-process-title">{group.processName}</span>
          </div>
        </td>
        <td className="np-apps-td">
          <span className="np-apps-pid-chip">
            {group.pid !== null ? `PID ${group.pid}` : "—"}
          </span>
        </td>
        <td className="np-apps-td">
          <span className="np-apps-flows-count">
            {group.flowsCount} {group.flowsCount === 1 ? "flow" : "flows"}
          </span>
        </td>
        <td className="np-apps-td">
          <span
            className={`np-apps-badge ${confidenceBadge.className}`}
            aria-label={`Attribution confidence: ${confidenceBadge.label}`}
          >
            <span className="np-apps-badge__glyph" aria-hidden="true">
              {confidenceBadge.glyph}
            </span>
            <span>{confidenceBadge.label}</span>
          </span>
        </td>
        <td className="np-apps-td np-apps-td--right">
          <button
            type="button"
            className="np-apps-row__toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(group.key);
            }}
            aria-expanded={isExpanded}
            aria-controls={lineageRegionId}
            aria-label={`${isExpanded ? t("collapse") : t("expand")} ${group.processName}`}
          >
            <span>{isExpanded ? t("collapse") : t("expand")}</span>
            <span
              className="np-apps-row__chevron"
              data-expanded={isExpanded}
              aria-hidden="true"
            >
              <Icon name="chevronRight" style={{ width: "12px", height: "12px" }} />
            </span>
          </button>
        </td>
      </tr>

      {/* Expanded Child Flow Lineage Conduit Tray */}
      {isExpanded && (
        <tr id={lineageRegionId} className="np-apps-lineage-row">
          <td colSpan={5}>
            <div className="np-apps-lineage-tray" data-testid="expanded-lineage-tray">
              <div className="np-apps-lineage-tray__header">
                <Icon name="timeline" style={{ width: "14px", height: "14px", color: "var(--np-accent)" }} />
                <span>
                  Active Flow Lineage ({group.flowsCount} {group.flowsCount === 1 ? "flow" : "flows"})
                </span>
              </div>

              {/* Communicating Endpoint Pairs (Socket Lineage Conduits) */}
              {hasLineage && (
                <div className="np-apps-conduits-section">
                  <div className="np-apps-lineage-tray__section-title">
                    <span>Communicating Endpoint Lineage ({group.lineage.length})</span>
                  </div>
                  <div className="np-apps-conduits-list" data-testid="lineage-conduits-list">
                    {group.lineage.map((conduit, idx) => {
                      const dir = formatDirection(conduit.direction);
                      const classificationLabel = formatClassification(conduit.classification);
                      const safeBytes =
                        typeof conduit.bytes === "number" && !isNaN(conduit.bytes)
                          ? Math.max(0, conduit.bytes)
                          : 0;
                      const bandwidthText = humanBytes(safeBytes);
                      const destinationText = conduit.destination || "—";
                      const protocolText = conduit.protocol || "OTHER";

                      return (
                        <div
                          key={`conduit-${conduit.source || ""}-${conduit.destination || ""}-${protocolText}-${conduit.direction || ""}-${idx}`}
                          className="np-apps-conduit-card"
                          data-testid="lineage-conduit-card"
                        >
                          <div className="np-apps-conduit-card__endpoint">
                            <div className="np-apps-conduit-card__gem" aria-hidden="true" />
                            <div className="np-apps-conduit-card__info">
                              <span
                                className="np-apps-conduit-card__destination"
                                title={`Destination: ${destinationText}`}
                              >
                                {destinationText}
                              </span>
                              {conduit.source && conduit.source !== conduit.destination && (
                                <span
                                  className="np-apps-conduit-card__source"
                                  title={`Source: ${conduit.source}`}
                                >
                                  from {conduit.source}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="np-apps-conduit-card__badges">
                            {/* Protocol Badge */}
                            <span
                              className="np-apps-conduit-badge np-apps-conduit-badge--protocol"
                              aria-label={`Protocol: ${protocolText}`}
                            >
                              {protocolText}
                            </span>

                            {/* Direction Badge */}
                            <span
                              className={`np-apps-conduit-badge np-apps-conduit-badge--direction ${dir.className}`}
                              aria-label={`Direction: ${dir.label}`}
                            >
                              <span className="np-apps-conduit-badge__glyph" aria-hidden="true">
                                {dir.icon}
                              </span>
                              <span>{dir.label}</span>
                            </span>

                            {/* Classification Badge */}
                            <span
                              className="np-apps-conduit-badge np-apps-conduit-badge--classification"
                              aria-label={`Classification: ${classificationLabel}`}
                            >
                              {classificationLabel}
                            </span>

                            {/* Bandwidth Indicator */}
                            <span
                              className="np-apps-conduit-card__bandwidth"
                              aria-label={`Bandwidth: ${bandwidthText}`}
                              title={`Bandwidth: ${bandwidthText} (${safeBytes} bytes)`}
                            >
                              {bandwidthText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Attributed Flow IDs Section */}
              {hasFlowIds && (
                <div
                  className="np-apps-flow-ids-section"
                  style={{ marginTop: hasLineage ? "10px" : "0" }}
                >
                  {hasLineage && (
                    <div className="np-apps-lineage-tray__section-title">
                      <span>Active Flow IDs ({group.flowIds.length})</span>
                    </div>
                  )}
                  <div className="np-apps-lineage-tray__list">
                    {group.flowIds.slice(0, 24).map((flowId) => (
                      <div key={`flow-${flowId}`} className="np-apps-flow-card">
                        <span className="np-apps-flow-card__id">
                          <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                          Flow #{flowId}
                        </span>
                        <button
                          type="button"
                          className="np-apps-flow-card__inspect"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectFlow(flowId);
                          }}
                          aria-label={`${t("inspect_flow")} #${flowId}`}
                        >
                          <Icon name="search" style={{ width: "12px", height: "12px" }} />
                          <span>{t("inspect_flow")}</span>
                        </button>
                      </div>
                    ))}
                    {group.flowIds.length > 24 && (
                      <div className="np-apps-flow-card" style={{ opacity: 0.75, fontStyle: "italic" }}>
                        <span className="np-apps-flow-card__id">
                          <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                          +{group.flowIds.length - 24} more active flows in this session
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Fallback when neither conduits nor individual flow IDs exist */}
              {!hasLineage && !hasFlowIds && (
                <div className="np-apps-flow-card">
                  <span className="np-apps-flow-card__id" style={{ fontStyle: "italic", opacity: 0.85 }}>
                    <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                    {group.flowsCount} {group.flowsCount === 1 ? "active flow" : "active flows"} attributed
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

