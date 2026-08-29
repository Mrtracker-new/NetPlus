import React, { memo } from "react";

export interface TopologyNode {
  id: string;
  label: string;
  sublabel?: string;
  status: "healthy" | "warning" | "critical";
  x: number;
  y: number;
  icon?: string;
}

export interface TopologyEdge {
  source: string;
  target: string;
  bandwidth?: string;
  animated?: boolean;
}

export interface TopologyGraphProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (id: string) => void;
  width?: number;
  height?: number;
}

/** Formats long IPv6 or hostname strings into clean, unclipped node labels */
function formatNodeLabel(label: string): string {
  if (!label) return "";
  if (label.length <= 15) return label;

  // Format IPv6 addresses intelligently (e.g., 2606:4700...b0c4)
  if (label.includes(":")) {
    const parts = label.split(":");
    if (parts.length >= 4) {
      const start = `${parts[0]}:${parts[1]}`;
      const lastSegment = parts[parts.length - 1] || parts[parts.length - 2] || "";
      return `${start}…${lastSegment}`;
    }
  }

  return `${label.slice(0, 13)}…`;
}

export const TopologyGraph = memo(function TopologyGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  width = 500,
  height = 240,
}: TopologyGraphProps) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeHalfWidth = 72;

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "100%", display: "block" }}
        role="img"
        aria-label="Network applications lineage topology graph"
      >
        {/* Draw Connected Edges with Anchored Boundary Ports */}
        {edges.map((e, idx) => {
          const src = nodeMap.get(e.source);
          const tgt = nodeMap.get(e.target);
          if (!src || !tgt) return null;

          // Anchor ports: attach cleanly to card edges
          let startX = src.x;
          let endX = tgt.x;

          if (src.x < tgt.x) {
            startX = src.x + nodeHalfWidth;
            endX = tgt.x - nodeHalfWidth;
          } else if (src.x > tgt.x) {
            startX = src.x - nodeHalfWidth;
            endX = tgt.x + nodeHalfWidth;
          }

          const startY = src.y;
          const endY = tgt.y;

          // Curved path calculation
          const midX = (startX + endX) / 2;
          const pathD = `M ${startX},${startY} C ${midX},${startY} ${midX},${endY} ${endX},${endY}`;

          return (
            <g key={idx} aria-hidden="true">
              {/* Soft outer line */}
              <path
                d={pathD}
                fill="none"
                stroke="var(--np-accent-soft, rgba(47,224,214,0.15))"
                strokeWidth={4}
              />
              {/* Animated flow line */}
              <path
                d={pathD}
                fill="none"
                stroke="var(--np-accent, #2fe0d6)"
                strokeWidth={1.75}
                className={e.animated !== false ? "np-flow-line" : undefined}
                opacity={0.85}
              />
            </g>
          );
        })}

        {/* Draw Nodes */}
        {nodes.map((n) => {
          const isSelected = selectedNodeId === n.id;
          const statusColor =
            n.status === "healthy"
              ? "var(--np-accent, #2fe0d6)"
              : n.status === "warning"
              ? "var(--np-sem-investigate, #f59e0b)"
              : "var(--np-sem-failure, #ef4444)";

          const displayLabel = formatNodeLabel(n.label);

          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={() => onSelectNode?.(n.id)}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  onSelectNode?.(n.id);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Node ${n.label}, status ${n.status}`}
              style={{ cursor: "pointer", outline: "none" }}
            >
              <title>{`${n.label}${n.sublabel ? ` (${n.sublabel})` : ""}`}</title>
              {/* Outer card box with wider width (144px) */}
              <rect
                x={-72}
                y={-20}
                width={144}
                height={40}
                rx={10}
                fill="var(--np-surface-raised, var(--np-surface-2))"
                stroke={
                  isSelected
                    ? "var(--np-accent, #2fe0d6)"
                    : "var(--np-border-strong)"
                }
                strokeWidth={isSelected ? 2 : 1}
              />
              {/* Status Indicator Dot */}
              <circle cx={-56} cy={0} r={5} fill={statusColor} />
              {/* Label */}
              <text
                x={-44}
                y={n.sublabel ? -3 : 4}
                fill="var(--np-text)"
                fontSize="11"
                fontWeight="600"
              >
                {displayLabel}
              </text>
              {/* Sublabel */}
              {n.sublabel && (
                <text
                  x={-44}
                  y={12}
                  fill="var(--np-text-mute)"
                  fontSize="9.5"
                  fontFamily="var(--np-font-mono)"
                >
                  {n.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
