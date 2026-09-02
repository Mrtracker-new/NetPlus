import { useState, useEffect, useRef } from "react";
import { TopologyGraph, type TopologyNode, type TopologyEdge } from "@netpulse/viz";
import { Icon } from "../../icons";

export interface ApplicationsLineageCardProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
}

export type LineageFilterMode =
  | "All Endpoints"
  | "External WAN"
  | "Local Subnet"
  | "CDN Edge"
  | "Multicast";

export function ApplicationsLineageCard({
  nodes = [],
  edges = [],
  selectedNodeId,
  onSelectNode,
}: ApplicationsLineageCardProps) {
  const [filterMode, setFilterMode] = useState<LineageFilterMode>("All Endpoints");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on Escape key or outside click
  useEffect(() => {
    if (!showDropdown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowDropdown(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  // Filter nodes & edges based on classification
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (filterMode === "External WAN") {
    const wanNodes = new Set(nodes.filter((n) => n.sublabel === "EXTERNAL_WAN").map((n) => n.id));
    filteredEdges = edges.filter((e) => wanNodes.has(e.source) || wanNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || wanNodes.has(n.id));
  } else if (filterMode === "Local Subnet") {
    const localNodes = new Set(
      nodes.filter((n) => n.sublabel === "LOCAL" || n.sublabel === "LOCAL_SUBNET").map((n) => n.id)
    );
    filteredEdges = edges.filter((e) => localNodes.has(e.source) || localNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || localNodes.has(n.id));
  } else if (filterMode === "CDN Edge") {
    const cdnNodes = new Set(nodes.filter((n) => n.sublabel === "CDN_EDGE").map((n) => n.id));
    filteredEdges = edges.filter((e) => cdnNodes.has(e.source) || cdnNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || cdnNodes.has(n.id));
  } else if (filterMode === "Multicast") {
    const mcNodes = new Set(nodes.filter((n) => n.sublabel === "MULTICAST").map((n) => n.id));
    filteredEdges = edges.filter((e) => mcNodes.has(e.source) || mcNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || mcNodes.has(n.id));
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="np-monitor-card" aria-label="Applications & Lineage Topology Graph">
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">Applications & Lineage</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", position: "relative" }} ref={dropdownRef}>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)" }}>
            {filteredNodes.length} Active Nodes
          </span>
          <button
            type="button"
            className="np-monitor-badge"
            style={{
              background: "var(--np-surface-raised, var(--np-surface-1))",
              color: "var(--np-text)",
              cursor: "pointer",
              border: "1px solid var(--np-border)",
              fontSize: "0.75rem",
              padding: "0.25rem 0.65rem",
              borderRadius: "var(--np-radius-sm)",
              boxShadow: "var(--np-neu-control)",
              outline: "none",
            }}
            onClick={() => setShowDropdown((prev) => !prev)}
            aria-expanded={showDropdown}
            aria-haspopup="listbox"
            aria-label="Filter lineage topology rules"
          >
            {filterMode} ▾
          </button>

          {showDropdown && (
            <div
              aria-label="Topology rules options"
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "6px",
                background: "var(--np-surface-overlay, var(--np-surface-1))",
                border: "1px solid var(--np-border-strong)",
                borderRadius: "var(--np-radius-sm)",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                zIndex: "var(--np-z-overlay, 100)",
                boxShadow: "var(--np-neu-overlay)",
                minWidth: "160px",
                backdropFilter: "var(--np-glass-blur)",
              }}
            >
              {(
                [
                  "All Endpoints",
                  "External WAN",
                  "Local Subnet",
                  "CDN Edge",
                  "Multicast",
                ] as const
              ).map((mode) => {
                const isSelected = filterMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={isSelected}
                    style={{
                      background: isSelected ? "var(--np-surface-2)" : "transparent",
                      color: isSelected ? "var(--np-accent-strong, var(--np-text))" : "var(--np-text)",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "var(--np-radius-xs)",
                      fontSize: "0.78rem",
                      textAlign: "left",
                      cursor: "pointer",
                        fontWeight: isSelected ? 600 : 400,
                        outline: "none",
                        transition: "all var(--np-t)",
                      }}
                      onClick={() => {
                        setFilterMode(mode);
                        setShowDropdown(false);
                      }}
                    >
                      {mode}
                    </button>
                  );
                }
              )}
            </div>
          )}
        </div>
      </div>

      {filteredNodes.length === 0 ? (
        <div
          style={{
            height: 220,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            color: "var(--np-text-mute)",
            fontSize: "0.85rem",
            textAlign: "center",
            padding: "1rem",
          }}
        >
          <Icon name="radio" style={{ width: "24px", height: "24px", color: "var(--np-accent)" }} />
          <span>Capture Standby — Start a packet capture to observe live network flow lineage.</span>
        </div>
      ) : (
        <TopologyGraph
          nodes={filteredNodes}
          edges={filteredEdges}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id: string) => onSelectNode?.(id === selectedNodeId ? null : id)}
          height={220}
        />
      )}

      {/* Node Inspection Detail Popover — Level 4 Overlay Plate */}
      {selectedNode && (
        <div
          style={{
            background: "var(--np-surface-raised, var(--np-surface-1))",
            border: "1px solid var(--np-border)",
            borderRadius: "var(--np-radius-sm)",
            padding: "0.6rem 0.85rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.825rem",
            boxShadow: "var(--np-neu-card)",
            marginTop: "0.5rem",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: "var(--np-text)" }}>
              {selectedNode.label} ({selectedNode.status})
            </div>
            <div style={{ color: "var(--np-text-dim)", fontSize: "0.75rem", marginTop: "2px" }}>
              Rate: {selectedNode.sublabel || "Nominal"} • Protocol: Active Flow • Active
            </div>
          </div>
          <button
            type="button"
            className="np-monitor-icon-btn"
            style={{ padding: "4px 6px" }}
            onClick={() => onSelectNode?.(null)}
            aria-label="Close node details"
          >
            <Icon name="close" style={{ width: "12px", height: "12px" }} />
          </button>
        </div>
      )}
    </div>
  );
}

