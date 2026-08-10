import { Fragment, memo, useState, useCallback } from "react";
import type { ReactElement } from "react";
import type { FanoutNode, JourneyStage, StageKind, EvidenceRef } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { humanBytes } from "./utils";

export interface StageConfig {
  kind: StageKind;
  glyph: ReactElement;
  glyphString: string;
  labelKey: string;
  order: number;
}

export const STAGE_CONFIG_REGISTRY: Record<StageKind, StageConfig> = {
  navigation: {
    kind: "navigation",
    glyphString: "⌖",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
    labelKey: "stages.navigation",
    order: 0,
  },
  dns_resolution: {
    kind: "dns_resolution",
    glyphString: "?",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    labelKey: "stages.dns_resolution",
    order: 1,
  },
  connection: {
    kind: "connection",
    glyphString: "⇄",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5" />
        <path d="M7 11 3 15l4 4" />
        <path d="M7 3v2a4 4 0 0 0 4 4h8" />
        <path d="M17 13l4-4-4-4" />
      </svg>
    ),
    labelKey: "stages.connection",
    order: 2,
  },
  encryption: {
    kind: "encryption",
    glyphString: "🛡",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    labelKey: "stages.encryption",
    order: 3,
  },
  request: {
    kind: "request",
    glyphString: "↧",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    labelKey: "stages.request",
    order: 4,
  },
  fan_out: {
    kind: "fan_out",
    glyphString: "⋔",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" />
        <line x1="6" y1="9" x2="6" y2="21" />
      </svg>
    ),
    labelKey: "stages.fan_out",
    order: 5,
  },
  completion: {
    kind: "completion",
    glyphString: "✓",
    glyph: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    labelKey: "stages.completion",
    order: 6,
  },
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
      >
        {stages.map((s, i) => {
          const isSelected = selectedStageIndex === i;
          const config = STAGE_CONFIG_REGISTRY[s.kind];
          const glyphNode = config?.glyph ?? null;

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
              >
                <span className="np-jflow__glyph" aria-hidden="true">
                  {glyphNode}
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
        <div className="np-jflow__fanout" aria-label="Contacted Servers Fan-out">
          <div className="np-jflow__fanout-title">
            <span className="np-jflow__hub" aria-hidden="true">
              {orgGroups.length}
            </span>
            <span>Contacted Organizations & Servers Fan-out</span>
          </div>

          <ul className="np-jflow__dests">
            {orgGroups.slice(0, 5).map((group) => {
              const isExpanded = expandedOrgs.has(group.orgName);
              return (
                <li className="np-jflow__dest" key={group.orgName}>
                  <div
                    className="np-jflow__dest-header"
                    onClick={() => toggleOrg(group.orgName)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={`Organization ${group.orgName}, ${group.nodes.length} hosts, ${group.totalFlows} flows`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleOrg(group.orgName);
                      }
                    }}
                  >
                    <span className="np-jflow__dest-label" title={group.orgName}>
                      {group.orgName} ({group.nodes.length} {group.nodes.length === 1 ? "host" : "hosts"})
                    </span>
                    <span className="np-jflow__dest-meta">
                      <span>{group.totalFlows} flows</span> · <span>{humanBytes(group.totalBytes)}</span>
                      <span aria-hidden="true">{isExpanded ? "▲" : "▼"}</span>
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="np-jflow__dest-children">
                      {group.nodes.map((node) => (
                        <div className="np-jflow__dest-child" key={node.label}>
                          <span title={node.label}>{node.label}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span>{humanBytes(node.bytes)}</span>
                            {node.evidence && node.evidence.length > 0 && (
                              <EvidenceChips
                                evidence={node.evidence}
                                onNavigate={handleNavigateFanout}
                                className="np-evidence-chips--compact"
                              />
                            )}
                          </span>
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

