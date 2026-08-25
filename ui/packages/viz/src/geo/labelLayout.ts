import {
  isNodeSelected,
  type GeoAggregateNode,
  type LabelPlacement,
  type SelectedEntity,
} from "./geoTypes";

export interface LabelLayoutOptions {
  /** Maximum number of labels to place (default: 20) */
  maxLabels?: number;
  /** Current zoom scale (default: 1.0) */
  zoomScale?: number;
  /** Currently selected entity */
  selectedEntity?: SelectedEntity | null;
  /** Target entity identifier (fallback/alternative to selectedEntity) */
  selectedEntityId?: string | null;
  /** Canvas viewport width in map units (default: 720) */
  viewportWidth?: number;
  /** Canvas viewport height in map units (default: 360) */
  viewportHeight?: number;
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersects(a: BoundingBox, b: BoundingBox, padding = 3): boolean {
  return !(
    a.x + a.w + padding < b.x ||
    b.x + b.w + padding < a.x ||
    a.y + a.h + padding < b.y ||
    b.y + b.h + padding < a.y
  );
}

function isInsideViewport(box: BoundingBox, width: number, height: number, margin = 4): boolean {
  return (
    box.x >= margin &&
    box.y >= margin &&
    box.x + box.w <= width - margin &&
    box.y + box.h <= height - margin
  );
}

/**
 * Deterministically truncates a string with ASCII ellipsis '...'
 * to avoid Unicode font-fallback glyph errors on Windows/Tauri renderers.
 */
export function truncateLabel(label: string, maxLength = 22): string {
  if (!label) return "";
  if (label.length <= maxLength) return label;
  const truncateAt = Math.max(0, maxLength - 3);
  return `${label.slice(0, truncateAt)}...`;
}

export interface FormatClusterLabelOptions {
  label: string;
  memberCount?: number;
  countRenderedInGlyph?: boolean;
  maxLength?: number;
}

/**
 * Semantically formats an aggregate cluster/node label.
 * Invariant: If the cluster glyph renders the cardinality badge, the textual label must not duplicate it.
 */
export function formatClusterLabel(options: FormatClusterLabelOptions): string {
  const { label, memberCount = 1, countRenderedInGlyph = true, maxLength = 22 } = options;
  if (!label) return "";
  let cleanLabel = label;
  if (countRenderedInGlyph && memberCount > 1) {
    cleanLabel = cleanLabel.replace(/\s*\(\d+\)$/, "");
  }
  return truncateLabel(cleanLabel, maxLength);
}

/**
 * Normalizes an aggregate node's display label for map text rendering.
 */
export function formatNodeMapLabel(node: GeoAggregateNode, maxLength = 22): string {
  const isAggregate =
    node.nodeKind === "cluster" ||
    node.nodeKind === "cityAggregate" ||
    node.nodeKind === "countryAggregate" ||
    node.nodeKind === "otherResolvedAggregate";

  return formatClusterLabel({
    label: node.label || "",
    memberCount: node.memberCount,
    countRenderedInGlyph: isAggregate,
    maxLength,
  });
}

/**
 * Deterministic greedy collision-avoidance label layout engine.
 * Computes greedy collision-avoiding anchor positions for geographic nodes.
 *
 * Evaluates candidate slots around nodes to avoid bounding-box intersections.
 * Selected entities are guaranteed visibility; if all candidate slots conflict or collide,
 * a fallback candidate slot is placed which may overlap.
 */
export function computeLabelLayout(
  nodes: GeoAggregateNode[],
  options: LabelLayoutOptions = {}
): Map<string, LabelPlacement> {
  const {
    maxLabels = 20,
    zoomScale = 1.0,
    selectedEntity = null,
    selectedEntityId = null,
    viewportWidth = 720,
    viewportHeight = 360,
  } = options;

  const placements = new Map<string, LabelPlacement>();
  if (nodes.length === 0) return placements;

  // Enforce configured hard visual budget ceiling
  const effectiveMaxLabels = Math.max(0, Math.floor(maxLabels));

  // Score and prioritize nodes
  interface ScoredNode {
    node: GeoAggregateNode;
    score: number;
    isSelected: boolean;
  }

  const scoredNodes: ScoredNode[] = nodes.map((node) => {
    let score = 0;
    const isSelected = isNodeSelected(node, selectedEntity, selectedEntityId);

    if (isSelected) {
      score += 100_000;
    }

    if (node.freshness === "active") {
      score += 10_000 + Math.min(5000, node.deltaBytes);
    } else if (node.freshness === "recent") {
      score += 2_000;
    }

    if (
      node.nodeKind === "cluster" ||
      node.nodeKind === "countryAggregate" ||
      node.nodeKind === "cityAggregate" ||
      node.nodeKind === "otherResolvedAggregate"
    ) {
      score += 1_000 + (node.memberCount || 1) * 100;
    }

    score += Math.min(1000, Math.log10(Math.max(1, node.totalBytes)) * 100);

    return { node, score, isSelected };
  });

  // Sort descending by priority score with stable deterministic tie-breaker
  scoredNodes.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));

  const occupiedBoxes: BoundingBox[] = [];
  let visibleCount = 0;

  for (const { node, score, isSelected } of scoredNodes) {
    // Truncate long text deterministically without unicode glyph errors
    const text = formatNodeMapLabel(node);

    // Approximate character width in mono 9px font
    const charWidth = 6.2;
    const textWidth = text.length * charWidth + 4;
    const textHeight = 11;
    const radius = 6;

    // Candidate label positions around the node: Right, Left, Top, Bottom
    const candidateSlots: Array<{
      x: number;
      y: number;
      anchor: "start" | "middle" | "end";
      box: BoundingBox;
    }> = [
      // 0: Right
      {
        x: node.x + radius + 4,
        y: node.y + 3,
        anchor: "start",
        box: { x: node.x + radius + 3, y: node.y - 7, w: textWidth, h: textHeight },
      },
      // 1: Left
      {
        x: node.x - radius - 4,
        y: node.y + 3,
        anchor: "end",
        box: { x: node.x - radius - 4 - textWidth, y: node.y - 7, w: textWidth, h: textHeight },
      },
      // 2: Top
      {
        x: node.x,
        y: node.y - radius - 4,
        anchor: "middle",
        box: { x: node.x - textWidth / 2, y: node.y - radius - 14, w: textWidth, h: textHeight },
      },
      // 3: Bottom
      {
        x: node.x,
        y: node.y + radius + 11,
        anchor: "middle",
        box: { x: node.x - textWidth / 2, y: node.y + radius + 2, w: textWidth, h: textHeight },
      },
    ];

    let placedSlot: (typeof candidateSlots)[0] | null = null;

    if (isSelected) {
      // Selected entity is forced visible (try slots in order: non-overlapping inside viewport first)
      for (const slot of candidateSlots) {
        if (isInsideViewport(slot.box, viewportWidth, viewportHeight)) {
          let hasOverlap = false;
          for (const occ of occupiedBoxes) {
            if (intersects(slot.box, occ)) {
              hasOverlap = true;
              break;
            }
          }
          if (!hasOverlap) {
            placedSlot = slot;
            break;
          }
        }
      }
      // If all non-overlapping slots fail, pick the first slot that fits inside viewport
      if (!placedSlot) {
        for (const slot of candidateSlots) {
          if (isInsideViewport(slot.box, viewportWidth, viewportHeight)) {
            placedSlot = slot;
            break;
          }
        }
      }
      // Fallback to default Right slot if screen boundaries prevent all candidate slots
      if (!placedSlot) {
        placedSlot = candidateSlots[0]!;
      }
    } else if (visibleCount < effectiveMaxLabels) {
      // Non-selected nodes test slots against existing obstacles
      for (const slot of candidateSlots) {
        if (isInsideViewport(slot.box, viewportWidth, viewportHeight)) {
          let hasOverlap = false;
          for (const occ of occupiedBoxes) {
            if (intersects(slot.box, occ)) {
              hasOverlap = true;
              break;
            }
          }
          if (!hasOverlap) {
            placedSlot = slot;
            break;
          }
        }
      }
    }

    if (placedSlot) {
      occupiedBoxes.push(placedSlot.box);
      visibleCount++;
      placements.set(node.id, {
        nodeId: node.id,
        text,
        subText: node.subLabel,
        x: placedSlot.x,
        y: placedSlot.y,
        anchor: placedSlot.anchor,
        visible: true,
        priority: score,
      });
    } else {
      placements.set(node.id, {
        nodeId: node.id,
        text,
        subText: node.subLabel,
        x: node.x + radius + 4,
        y: node.y + 3,
        anchor: "start",
        visible: false,
        priority: score,
      });
    }
  }

  return placements;
}
