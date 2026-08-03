import { useState } from "react";
import { TopologyGraph, type TopologyNode, type TopologyEdge } from "@netpulse/viz";

export interface ApplicationsLineageCardProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
}

export function ApplicationsLineageCard({
  nodes = [],
  edges = [],
  selectedNodeId,
  onSelectNode,
}: ApplicationsLineageCardProps) {
  const [filterMode, setFilterMode] = useState<
    "Custom Rules" | "All Traffic" | "High Bandwidth" | "Critical Path"
  >("Custom Rules");
  const [showDropdown, setShowDropdown] = useState(false);

  // Filter nodes & edges based on active filter mode
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (filterMode === "High Bandwidth") {
    filteredNodes = nodes.filter(
      (n) => n.sublabel?.includes("MB/s") && parseFloat(n.sublabel) >= 3.0
    );
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );
  } else if (filterMode === "Critical Path") {
    const criticalIds = new Set(["enc", "engine", "orch"]);
    filteredNodes = nodes.map((n) => ({
      ...n,
      status: criticalIds.has(n.id) ? "healthy" : "warning",
    }));
    filteredEdges = edges.filter(
      (e) => criticalIds.has(e.source) && criticalIds.has(e.target)
    );
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="np-monitor-card" aria-label="Applications & Lineage Topology Graph">
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">Applications & Lineage</h3>
        <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)" }}>
          {filteredNodes.length} Active Nodes
        </span>
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
            color: "var(--np-text-mute, #9ca3af)",
            fontSize: "0.85rem",
            textAlign: "center",
            padding: "1rem",
          }}
        >
          <span style={{ fontSize: "1.5rem" }}>📡</span>
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

      {/* Node Inspection Detail Popover */}
      {selectedNode && (
        <div
          style={{
            background: "var(--np-surface-2, #1e2636)",
            border: "1px solid var(--np-monitor-primary, #00f2fe)",
            borderRadius: "var(--np-radius-sm, 8px)",
            padding: "0.6rem 0.85rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.825rem",
            boxShadow: "0 0 16px rgba(0,242,254,0.15)",
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
            style={{
              background: "transparent",
              border: "none",
              color: "var(--np-text-mute)",
              fontSize: "1rem",
              cursor: "pointer",
            }}
            onClick={() => onSelectNode?.(null)}
            aria-label="Close node details"
          >
            ✕
          </button>
        </div>
      )}

      {/* Interactive Rules Filter Dropdown Selector */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: "0.25rem",
          position: "relative",
        }}
      >
        <button
          className="np-monitor-badge"
          style={{
            background: "var(--np-surface-2, #1e2636)",
            color: "var(--np-text, #fff)",
            cursor: "pointer",
            border: "1px solid var(--np-border-strong, rgba(255,255,255,0.12))",
          }}
          onClick={() => setShowDropdown((prev) => !prev)}
        >
          {filterMode} ▾
        </button>

        {showDropdown && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              marginBottom: "6px",
              background: "var(--np-surface-1, #151d2a)",
              border: "1px solid var(--np-border-strong, rgba(255,255,255,0.15))",
              borderRadius: "8px",
              padding: "4px",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              zIndex: 50,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              minWidth: "150px",
            }}
          >
            {(["Custom Rules", "All Traffic", "High Bandwidth", "Critical Path"] as const).map(
              (mode) => (
                <button
                  key={mode}
                  style={{
                    background:
                      filterMode === mode ? "var(--np-surface-3, #1e293b)" : "transparent",
                    color:
                      filterMode === mode
                        ? "var(--np-monitor-primary, #00f2fe)"
                        : "var(--np-text)",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    fontSize: "0.78rem",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: filterMode === mode ? 600 : 400,
                  }}
                  onClick={() => {
                    setFilterMode(mode);
                    setShowDropdown(false);
                  }}
                >
                  {mode}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
