import { describe, it, expect } from "vitest";
import { computeLabelLayout, type GeoAggregateNode } from "@netpulse/viz";

describe("Deterministic Greedy Collision-Avoidance Label Layout in @netpulse/app", () => {
  it("prevents overlapping labels by choosing alternative slots or suppressing excess labels", () => {
    const nodes: GeoAggregateNode[] = [
      {
        id: "node-1",
        entityId: "entity-host-1.1.1.1",
        geoCellId: "geocell-377_-1224",
        nodeKind: "endpoint",
        label: "Primary Service Node Alpha",
        countryCode: "US",
        latitude: 37.7749,
        longitude: -122.4194,
        x: 115,
        y: 104,
        totalBytes: 5_000_000,
        totalFlows: 20,
        sampleEndpointIps: ["1.1.1.1"],
        endpointIps: ["1.1.1.1"],
        asns: [13335],
        freshness: "active",
        deltaBytes: 50_000,
        memberCount: 1,
      },
      {
        id: "node-2",
        entityId: "entity-host-8.8.8.8",
        geoCellId: "geocell-377_-1224",
        nodeKind: "endpoint",
        label: "Secondary Service Node Beta",
        countryCode: "US",
        latitude: 37.7750,
        longitude: -122.4195,
        x: 116,
        y: 105,
        totalBytes: 3_000_000,
        totalFlows: 15,
        sampleEndpointIps: ["8.8.8.8"],
        endpointIps: ["8.8.8.8"],
        asns: [15169],
        freshness: "active",
        deltaBytes: 30_000,
        memberCount: 1,
      },
    ];

    const placements = computeLabelLayout(nodes, { maxLabels: 20 });
    expect(placements.size).toBe(2);

    const p1 = placements.get("node-1");
    const p2 = placements.get("node-2");

    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p1!.visible).toBe(true);

    if (p1!.visible && p2!.visible) {
      const isDistinct = p1!.x !== p2!.x || p1!.y !== p2!.y || p1!.anchor !== p2!.anchor;
      expect(isDistinct).toBe(true);
    }
  });

  it("strictly enforces hard maxLabels budget regardless of zoom scale", () => {
    const nodes: GeoAggregateNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `node-${i}`,
      entityId: `entity-host-10.0.0.${i}`,
      geoCellId: `geocell-${i}`,
      nodeKind: "endpoint",
      label: `Service Node ${i}`,
      countryCode: "US",
      latitude: 10 + i * 2,
      longitude: -100 + (i % 5) * 20,
      x: 50 + (i % 5) * 120,
      y: 30 + Math.floor(i / 5) * 50,
      totalBytes: (25 - i) * 10_000,
      totalFlows: 5,
      sampleEndpointIps: [`10.0.0.${i}`],
      endpointIps: [`10.0.0.${i}`],
      asns: [13335],
      freshness: "active",
      deltaBytes: 1000,
      memberCount: 1,
    }));

    const placements = computeLabelLayout(nodes, {
      maxLabels: 8,
      zoomScale: 8.0,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    const visibleLabels = Array.from(placements.values()).filter((p) => p.visible);
    expect(visibleLabels.length).toBeLessThanOrEqual(8);
    expect(visibleLabels.length).toBe(8);
  });
});
