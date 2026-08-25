import { describe, it, expect } from "vitest";
import { calculateTooltipPlacement } from "../tooltipPlacement";

describe("calculateTooltipPlacement Geometry Engine", () => {
  const defaultWrapper = {
    wrapperWidth: 800,
    wrapperHeight: 400,
    tooltipWidth: 200,
    tooltipHeight: 120,
    gap: 10,
    padding: 8,
    pointerInsetLeft: 16,
    pointerInsetRight: 16,
  };

  function assertNormalContainment(
    placement: ReturnType<typeof calculateTooltipPlacement>,
    wrapperW = 800,
    wrapperH = 400,
    padding = 8,
    pointerInsetLeft = 16,
    pointerInsetRight = 16
  ) {
    expect(placement.left).toBeGreaterThanOrEqual(padding);
    expect(placement.left + placement.width).toBeLessThanOrEqual(wrapperW - padding);
    expect(placement.top).toBeGreaterThanOrEqual(padding);
    expect(placement.top + placement.height).toBeLessThanOrEqual(wrapperH - padding);

    expect(placement.pointerX).toBeGreaterThanOrEqual(pointerInsetLeft);
    expect(placement.pointerX).toBeLessThanOrEqual(placement.width - pointerInsetRight);
    expect(placement.pointerX).toBeGreaterThanOrEqual(0);
    expect(placement.pointerX).toBeLessThanOrEqual(placement.width);
  }

  it("places tooltip ABOVE node in bottom-center area when space permits", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 400,
      nodeY: 300,
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("top");
    // top = nodeY (300) - radius (8) - gap (10) - height (120) = 162
    expect(res.top).toBe(162);
    expect(res.left).toBe(300); // 400 - 100
    expect(res.pointerX).toBe(100); // perfectly centered
    assertNormalContainment(res);
  });

  it("flips tooltip to BELOW node when node is near the top edge", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 400,
      nodeY: 60, // availableAbove = 60 - 8 - 10 - 8 = 34 < 120
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("bottom");
    // top = nodeY (60) + radius (8) + gap (10) = 78
    expect(res.top).toBe(78);
    expect(res.left).toBe(300);
    expect(res.pointerX).toBe(100);
    assertNormalContainment(res);
  });

  it("respects preferredY='bottom' when bottom clearance is available", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 400,
      nodeY: 200,
      nodeRadius: 8,
      preferredY: "bottom",
    });

    expect(res.placementY).toBe("bottom");
    // top = 200 + 8 + 10 = 218
    expect(res.top).toBe(218);
    assertNormalContainment(res);
  });

  it("handles exact vertical clearance boundary", () => {
    // Exactly fits above: nodeY - nodeRadius - gap - padding === tooltipHeight
    // nodeY = 120 + 8 + 10 + 8 = 146
    const exactFitAbove = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 400,
      nodeY: 146,
      nodeRadius: 8,
    });
    expect(exactFitAbove.placementY).toBe("top");
    expect(exactFitAbove.top).toBe(8); // exactly at top padding
    assertNormalContainment(exactFitAbove);

    // One pixel less than required space above: must flip to bottom
    const onePixelBelow = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 400,
      nodeY: 145,
      nodeRadius: 8,
    });
    expect(onePixelBelow.placementY).toBe("bottom");
    expect(onePixelBelow.top).toBe(145 + 8 + 10);
    assertNormalContainment(onePixelBelow);
  });

  it("handles extreme top-left node with clamped left and bounded pointerX", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 10,
      nodeY: 20,
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("bottom");
    expect(res.left).toBe(8); // clamped to padding (8)
    expect(res.top).toBe(38); // 20 + 8 + 10 = 38
    // nodeX (10) - left (8) = 2, clamped to pointerInsetLeft (16)
    expect(res.pointerX).toBe(16);
    assertNormalContainment(res);
  });

  it("handles extreme top-right node with clamped right and bounded pointerX", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 795,
      nodeY: 25,
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("bottom");
    // Clamped left: 800 - 200 - 8 = 592
    expect(res.left).toBe(592);
    expect(res.top).toBe(43);
    // nodeX (795) - left (592) = 203, clamped to 200 - 16 = 184
    expect(res.pointerX).toBe(184);
    assertNormalContainment(res);
  });

  it("handles extreme bottom-left node", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 5,
      nodeY: 395,
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("top");
    expect(res.left).toBe(8);
    // 395 - 8 - 10 - 120 = 257
    expect(res.top).toBe(257);
    expect(res.pointerX).toBe(16);
    assertNormalContainment(res);
  });

  it("handles extreme bottom-right node", () => {
    const res = calculateTooltipPlacement({
      ...defaultWrapper,
      nodeX: 795,
      nodeY: 390,
      nodeRadius: 8,
    });

    expect(res.placementY).toBe("top");
    expect(res.left).toBe(592);
    // 390 - 8 - 10 - 120 = 252
    expect(res.top).toBe(252);
    expect(res.pointerX).toBe(184);
    assertNormalContainment(res);
  });

  it("handles tooltip that exactly fills available wrapper width/height", () => {
    const exactFit = calculateTooltipPlacement({
      wrapperWidth: 400,
      wrapperHeight: 300,
      tooltipWidth: 384, // 400 - 2 * 8
      tooltipHeight: 284, // 300 - 2 * 8
      nodeX: 200,
      nodeY: 150,
      nodeRadius: 6,
      padding: 8,
    });

    expect(exactFit.left).toBe(8);
    expect(exactFit.top).toBe(8);
    assertNormalContainment(exactFit, 400, 300, 8);
  });

  it("handles oversized tooltip with graceful fallback containment", () => {
    const oversized = calculateTooltipPlacement({
      wrapperWidth: 200,
      wrapperHeight: 150,
      tooltipWidth: 300, // exceeds wrapper width
      tooltipHeight: 250, // exceeds wrapper height
      nodeX: 100,
      nodeY: 75,
      nodeRadius: 8,
      padding: 8,
    });

    // When physically oversized, coordinates fallback to padding origin without negative offsets
    expect(oversized.left).toBe(8);
    expect(oversized.top).toBe(8);
  });
});
