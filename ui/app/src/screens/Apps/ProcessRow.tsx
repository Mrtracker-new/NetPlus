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
      ? { label: t("confidence_labels.high"), color: "var(--np-good, #28926d)" }
      : group.confidence === "low"
      ? { label: t("confidence_labels.low"), color: "var(--np-notable, #b87a1f)" }
      : { label: t("confidence_labels.unknown"), color: "var(--np-neutral, #97a0b4)" };

  const lineageRegionId = `flow-lineage-${group.key}`;

  return (
    <>
      {/* Primary Collapsible Process Row */}
      <tr
        onClick={() => onToggleExpand(group.key)}
        style={{
          cursor: "pointer",
          background: isExpanded ? "var(--np-surface-2, rgba(255, 255, 255, 0.04))" : "transparent",
          transition: "background var(--np-t, 0.15s ease)",
        }}
      >
        <td style={{ padding: "0.65rem 0.85rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span aria-hidden="true" style={{ fontSize: "0.75rem", color: "var(--np-muted, #8b9bb4)", transition: "transform 0.15s ease" }}>
              {isExpanded ? "▼" : "▶"}
            </span>
            <span>{group.processName}</span>
          </div>
        </td>
        <td style={{ padding: "0.65rem 0.85rem", color: "var(--np-text-dim, #9ca3af)" }}>
          {group.pid !== null ? `PID ${group.pid}` : "—"}
        </td>
        <td style={{ padding: "0.65rem 0.85rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--np-accent, #2fe0d6)" }}>
            {group.flowsCount} {group.flowsCount === 1 ? "flow" : "flows"}
          </span>
        </td>
        <td style={{ padding: "0.65rem 0.85rem" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "var(--np-radius-sm, 4px)",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "rgba(255, 255, 255, 0.05)",
              color: confidenceBadge.color,
              border: `1px solid ${confidenceBadge.color}`,
            }}
            aria-label={`Attribution confidence: ${confidenceBadge.label}`}
          >
            <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: confidenceBadge.color, display: "inline-block" }} />
            {confidenceBadge.label}
          </span>
        </td>
        <td style={{ padding: "0.65rem 0.85rem", textAlign: "right" }}>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(group.key);
            }}
            aria-expanded={isExpanded}
            aria-controls={lineageRegionId}
            aria-label={`${isExpanded ? t("collapse") : t("expand")} ${group.processName}`}
          >
            {isExpanded ? t("collapse") : t("expand")}
          </button>
        </td>
      </tr>

      {/* Expanded Child Flow Rows */}
      {isExpanded && (
        <tr id={lineageRegionId}>
          <td colSpan={5} style={{ padding: "0.65rem 1rem 1rem 2.5rem", background: "var(--np-bg, #0b1019)" }}>
            <div style={{ fontSize: "0.8rem", color: "var(--np-muted, #8b9bb4)", marginBottom: "0.5rem", fontWeight: 600 }}>
              Active Flow Lineage:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {group.flowIds.map((flowId) => (
                <div
                  key={flowId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--np-surface-1, #131b2a)",
                    padding: "0.4rem 0.75rem",
                    borderRadius: "var(--np-radius-md, 8px)",
                    border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
                  }}
                >
                  <span style={{ fontSize: "0.85rem", fontFamily: "monospace", color: "var(--np-text, #e2e8f0)" }}>
                    Flow #{flowId}
                  </span>
                  <button
                    type="button"
                    className="np-btn np-btn--ghost"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", border: "1px solid var(--np-accent, #2fe0d6)", color: "var(--np-accent, #2fe0d6)", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onInspectFlow(flowId)}
                  >
                    <Icon name="search" style={{ width: "12px", height: "12px" }} />
                    {t("inspect_flow")}
                  </button>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
