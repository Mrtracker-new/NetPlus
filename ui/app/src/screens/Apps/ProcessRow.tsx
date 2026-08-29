import { useTranslation } from "react-i18next";
import type { GroupedProcess } from "../../hooks/useAppsController";
import { Icon } from "../../icons";

export interface ProcessRowProps {
  group: GroupedProcess;
  isExpanded: boolean;
  onToggleExpand: (groupKey: string) => void;
  onInspectFlow: (flowId: number) => void;
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

  const lineageRegionId = `flow-lineage-${group.key}`;

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    onToggleExpand(group.key);
  };

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
            <div className="np-apps-lineage-tray">
              <div className="np-apps-lineage-tray__header">
                <Icon name="timeline" style={{ width: "14px", height: "14px", color: "var(--np-accent)" }} />
                <span>Active Flow Lineage ({group.flowsCount})</span>
              </div>
              <div className="np-apps-lineage-tray__list">
                {group.flowIds.map((flowId) => (
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
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

