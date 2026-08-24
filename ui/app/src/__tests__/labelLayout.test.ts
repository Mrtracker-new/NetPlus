import { describe, it, expect } from "vitest";
import { computeLabelLayout, type GeoAggregateNode } from "@netpulse/viz";

describe("Deterministic Collision-Free Label Layout in @netpulse/app", () => {
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
        endpointIps: ["1.1.1.1"],
        asns: [13335],
        freshness: "active",
        deltaBytes: 50_000,
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
        endpointIps: ["8.8.8.8"],
        asns: [15169],
        freshness: "active",
        deltaBytes: 30_000,
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
});
