export interface TooltipPlacementParams {
  /** Target node center X coordinate in pixels relative to wrapper */
  nodeX: number;
  /** Target node center Y coordinate in pixels relative to wrapper */
  nodeY: number;
  /** Target node visual radius in pixels (default: 8) */
  nodeRadius?: number;

  /** Tooltip measured width in pixels */
  tooltipWidth: number;
  /** Tooltip measured height in pixels */
  tooltipHeight: number;

  /** Canvas wrapper width in pixels */
  wrapperWidth: number;
  /** Canvas wrapper height in pixels */
  wrapperHeight: number;

  /** Visual gap between node radius edge and tooltip edge in pixels (default: 10) */
  gap?: number;
  /** Inset padding from wrapper bounds in pixels (default: 8) */
  padding?: number;

  /** Preferred vertical orientation (default: "top") */
  preferredY?: "top" | "bottom";

  /** Left inset boundary for pointer arrow in pixels (default: 16) */
  pointerInsetLeft?: number;
  /** Right inset boundary for pointer arrow in pixels (default: 16) */
  pointerInsetRight?: number;
}

export interface TooltipPlacement {
  /** Final clamped Left coordinate in pixels relative to wrapper */
  left: number;
  /** Final clamped Top coordinate in pixels relative to wrapper */
  top: number;
  /** Tooltip width in pixels */
  width: number;
  /** Tooltip height in pixels */
  height: number;
  /** Resolved vertical placement relative to node */
  placementY: "top" | "bottom";
  /** Resolved pointer arrow X offset in pixels relative to tooltip left edge */
  pointerX: number;
}

/**
 * Computes deterministic, collision-aware tooltip coordinates in pixel screen-space.
 *
 * Evaluates exact geometric clearances, separates preferred placement from fit,
 * guarantees hard rectangular containment for normal dimensions, and computes
 * pointer offsets that track the original node coordinate.
 */
export function calculateTooltipPlacement(params: TooltipPlacementParams): TooltipPlacement {
  const {
    nodeX,
    nodeY,
    nodeRadius = 8,
    tooltipWidth,
    tooltipHeight,
    wrapperWidth,
    wrapperHeight,
    gap = 10,
    padding = 8,
    preferredY = "top",
    pointerInsetLeft = 16,
    pointerInsetRight = 16,
  } = params;

  // 1. Calculate available vertical clearance from node edge to wrapper padding
  const availableAbove = nodeY - nodeRadius - gap - padding;
  const availableBelow = wrapperHeight - nodeY - nodeRadius - gap - padding;

  const fitsAbove = availableAbove >= tooltipHeight;
  const fitsBelow = availableBelow >= tooltipHeight;

  const candidates = preferredY === "top" ? (["top", "bottom"] as const) : (["bottom", "top"] as const);

  let placementY: "top" | "bottom";
  if (candidates[0] === "top" ? fitsAbove : fitsBelow) {
    placementY = candidates[0];
  } else if (candidates[1] === "top" ? fitsAbove : fitsBelow) {
    placementY = candidates[1];
  } else {
    // Neither fits completely: pick the orientation with more available space
    placementY = availableBelow > availableAbove ? "bottom" : "top";
  }

  // 2. Compute unconstrained Top position
  const rawTop =
    placementY === "top"
      ? nodeY - nodeRadius - gap - tooltipHeight
      : nodeY + nodeRadius + gap;

  // 3. Strict vertical rectangle containment
  const maxTop = wrapperHeight - tooltipHeight - padding;
  const top = maxTop < padding ? padding : Math.max(padding, Math.min(rawTop, maxTop));

  // 4. Compute unconstrained Left position (centered over nodeX)
  const rawLeft = nodeX - tooltipWidth / 2;

  // 5. Strict horizontal rectangle containment
  const maxLeft = wrapperWidth - tooltipWidth - padding;
  const left = maxLeft < padding ? padding : Math.max(padding, Math.min(rawLeft, maxLeft));

  // 6. Dynamic pointer arrow offset calculation
  const effInsetLeft = Math.min(pointerInsetLeft, tooltipWidth / 2);
  const effInsetRight = Math.min(pointerInsetRight, tooltipWidth / 2);
  const rawPointerX = nodeX - left;
  const maxPointerX = Math.max(effInsetLeft, tooltipWidth - effInsetRight);
  const pointerX = Math.max(effInsetLeft, Math.min(rawPointerX, maxPointerX));

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: tooltipWidth,
    height: tooltipHeight,
    placementY,
    pointerX: Math.round(pointerX),
  };
}
