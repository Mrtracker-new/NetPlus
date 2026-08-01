import { Fragment, memo, useState, useCallback } from "react";
import type { ReactElement } from "react";
import type { FanoutNode, JourneyStage, StageKind, EvidenceRef } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { humanBytes } from "./utils";

export interface StageConfig {
  kind: StageKind;
  glyph: string;
  labelKey: string;
  order: number;
}

export const STAGE_CONFIG_REGISTRY: Record<StageKind, StageConfig> = {
  navigation: { kind: "navigation", glyph: "⌖", labelKey: "stages.navigation", order: 0 },
  dns_resolution: { kind: "dns_resolution", glyph: "?", labelKey: "stages.dns_resolution", order: 1 },
  connection: { kind: "connection", glyph: "⇄", labelKey: "stages.connection", order: 2 },
  encryption: { kind: "encryption", glyph: "🛡", labelKey: "stages.encryption", order: 3 },
  request: { kind: "request", glyph: "↧", labelKey: "stages.request", order: 4 },
  fan_out: { kind: "fan_out", glyph: "⋔", labelKey: "stages.fan_out", order: 5 },
  completion: { kind: "completion", glyph: "✓", labelKey: "stages.completion", order: 6 },
};

export interface JourneyFlowProps {
  stages: JourneyStage[];
  fanout: FanoutNode[];
  selectedStageIndex?: number | null;
  onSelectStage?: (index: number) => void;
  onNavigate?: (ref: EvidenceRef, source?: any) => void;
}

interface OrgGroup {
  orgName: string;
  nodes: FanoutNode[];
  totalBytes: number;
  totalFlows: number;
}

/** Group fanout nodes by primary organization domain / host label */
function groupFanoutByOrg(nodes: FanoutNode[]): OrgGroup[] {
  const map = new Map<string, FanoutNode[]>();
  for (const n of nodes) {
    const parts = n.label.split(".");
    const org = parts.length > 2 ? parts.slice(-2).join(".") : n.label;
    const list = map.get(org) ?? [];
    list.push(n);
    map.set(org, list);
  }

  const groups: OrgGroup[] = [];
  map.forEach((list, orgName) => {
    const totalBytes = list.reduce((s, x) => s + x.bytes, 0);
    const totalFlows = list.reduce((s, x) => s + x.flows, 0);
    groups.push({ orgName, nodes: list, totalBytes, totalFlows });
  });

  return groups.sort((a, b) => b.totalBytes - a.totalBytes);
}

export const JourneyFlow = memo(function JourneyFlow({
  stages,
  fanout,
  selectedStageIndex = null,
  onSelectStage,
  onNavigate,
}: JourneyFlowProps): ReactElement {
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  const toggleOrg = useCallback((orgName: string) => {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(orgName)) next.delete(orgName);
      else next.add(orgName);
      return next;
    });
  }, []);

  const handleNavigateFanout = useCallback(
    (ref: EvidenceRef) => {
      if (onNavigate) {
        onNavigate(ref, "journey");
      }
    },
    [onNavigate]
  );

  const orgGroups = groupFanoutByOrg(fanout);

  return (
    <div className="np-jflow">
      <div
        className="np-jflow__track"
        role="tablist"
        aria-label="Journey stage steps"
        style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "0.5rem" }}
      >
        {stages.map((s, i) => {
          const isSelected = selectedStageIndex === i;
          const config = STAGE_CONFIG_REGISTRY[s.kind];
          const glyph = config?.glyph ?? "•";

          return (
            <Fragment key={`${s.kind}-${i}`}>
              <div
                tabIndex={0}
                role="tab"
                aria-selected={isSelected}
                aria-label={`Stage ${i + 1}: ${s.title}`}
                className={`np-jflow__node ${isSelected ? "np-jflow__node--active" : ""}`}
                title={s.narration}
                onClick={() => onSelectStage?.(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectStage?.(i);
                  }
                }}
                style={{
                  cursor: "pointer",
                  outline: isSelected ? "2px solid var(--np-accent, #2fe0d6)" : undefined,
                  outlineOffset: "2px",
                  borderRadius: "var(--np-radius-md, 6px)",
                }}
              >
                <span className="np-jflow__glyph" aria-hidden="true">
                  {glyph}
                </span>
                <span className="np-jflow__label">{s.title}</span>
              </div>
              {i < stages.length - 1 && (
                <div className="np-jflow__link" aria-hidden="true">
                  <span className="np-jflow__packet" style={{ animationDelay: `${i * 0.35}s` }} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {orgGroups.length > 0 && (
        <div className="np-jflow__fanout" aria-label="Servers contacted">
          <div className="np-jflow__hub" aria-hidden="true">
            {stages.length}
          </div>
          <ul className="np-jflow__dests" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {orgGroups.slice(0, 5).map((group) => {
              const isExpanded = expandedOrgs.has(group.orgName);
              return (
                <li
                  className="np-jflow__dest"
                  key={group.orgName}
                  style={{ display: "flex", flexDirection: "column", gap: "0.2rem", cursor: "pointer" }}
                >
                  <div
                    onClick={() => toggleOrg(group.orgName)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <span className="np-jflow__dest-label" title={group.orgName}>
                      {group.orgName} ({group.nodes.length})
                    </span>
                    <span className="np-jflow__dest-meta">
                      {group.totalFlows} conn · {humanBytes(group.totalBytes)} {isExpanded ? "▲" : "▼"}
                    </span>
                  </div>

                  {isExpanded && (
                    <div style={{ marginLeft: "0.5rem", borderLeft: "2px solid var(--np-surface-2)", paddingLeft: "0.5rem" }}>
                      {group.nodes.map((node) => (
                        <div key={node.label} style={{ fontSize: "0.75rem", margin: "0.2rem 0" }}>
                          <span>{node.label}</span> · <span>{humanBytes(node.bytes)}</span>
                          {node.evidence && node.evidence.length > 0 && (
                            <EvidenceChips
                              evidence={node.evidence}
                              onNavigate={handleNavigateFanout}
                              className="np-evidence-chips--compact"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
});

JourneyFlow.displayName = "JourneyFlow";
