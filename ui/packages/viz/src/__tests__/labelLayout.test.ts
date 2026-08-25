import { describe, it, expect } from "vitest";
import { computeLabelLayout } from "../geo/labelLayout";
import { makeHostEntityId, type GeoAggregateNode, type SelectedEntity } from "../geo/geoTypes";

describe("Deterministic Collision-Free Label Layout", () => {
  it("prevents overlapping labels by choosing alternative slots or suppressing excess labels", () => {
    // 3 nodes situated right next to each other
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
      {
        id: "node-3",
        entityId: "entity-host-9.9.9.9",
        geoCellId: "geocell-377_-1224",
        nodeKind: "endpoint",
        label: "Tertiary Service Node Gamma",
        countryCode: "US",
        latitude: 37.7751,
        longitude: -122.4196,
        x: 117,
        y: 106,
        totalBytes: 1_000_000,
        totalFlows: 5,
        sampleEndpointIps: ["9.9.9.9"],
        endpointIps: ["9.9.9.9"],
        asns: [19281],
        freshness: "recent",
        deltaBytes: 0,
        memberCount: 1,
      },
    ];

    const placements = computeLabelLayout(nodes, { maxLabels: 20 });
    expect(placements.size).toBe(3);

    const p1 = placements.get("node-1");
    const p2 = placements.get("node-2");
    const p3 = placements.get("node-3");

    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p3).toBeDefined();

    // Highest priority active node must be visible
    expect(p1!.visible).toBe(true);

    // If both p1 and p2 are visible, they must not share the exact same anchor coordinates
    if (p1!.visible && p2!.visible) {
      const isDistinct = p1!.x !== p2!.x || p1!.y !== p2!.y || p1!.anchor !== p2!.anchor;
      expect(isDistinct).toBe(true);
    }
  });

  it("always forces selected entity label to be visible with maximum priority", () => {
    const nodes: GeoAggregateNode[] = [
      {
        id: "node-1",
        entityId: "entity-host-1.1.1.1",
        geoCellId: "geocell-377_-1224",
        nodeKind: "endpoint",
        label: "Standard Node",
        countryCode: "US",
        latitude: 37.7749,
        longitude: -122.4194,
        x: 100,
        y: 100,
        totalBytes: 1_000_000,
        totalFlows: 10,
        sampleEndpointIps: ["1.1.1.1"],
        endpointIps: ["1.1.1.1"],
        asns: [13335],
        freshness: "recent",
        deltaBytes: 0,
        memberCount: 1,
      },
      {
        id: "node-selected",
        entityId: "entity-host-8.8.8.8",
        geoCellId: "geocell-377_-1224",
        nodeKind: "endpoint",
        label: "Target Host Selected",
        countryCode: "US",
        latitude: 37.7750,
        longitude: -122.4195,
        x: 105,
        y: 105,
        totalBytes: 100,
        totalFlows: 1,
        sampleEndpointIps: ["8.8.8.8"],
        endpointIps: ["8.8.8.8"],
        asns: [15169],
        freshness: "stale",
        deltaBytes: 0,
        memberCount: 1,
      },
    ];

    const selectedEntity: SelectedEntity = {
      kind: "endpoint",
      entityId: makeHostEntityId("8.8.8.8"),
      ip: "8.8.8.8",
      host: {} as any,
    };

    const placements = computeLabelLayout(nodes, {
      maxLabels: 20,
      selectedEntity,
    });

    const selectedPlacement = placements.get("node-selected");
    expect(selectedPlacement).toBeDefined();
    expect(selectedPlacement!.visible).toBe(true);
    expect(selectedPlacement!.priority).toBeGreaterThanOrEqual(100_000);
  });

  it("strictly enforces hard maxLabels budget regardless of zoom scale", () => {
    // Generate 30 well-spaced nodes that wouldn't collide
    const nodes: GeoAggregateNode[] = Array.from({ length: 30 }, (_, i) => ({
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
      totalBytes: (30 - i) * 10_000,
      totalFlows: 5,
      sampleEndpointIps: [`10.0.0.${i}`],
      endpointIps: [`10.0.0.${i}`],
      asns: [13335],
      freshness: "active",
      deltaBytes: 1000,
      memberCount: 1,
    }));

    // With maxLabels = 10 and high zoom scale (e.g. 8.0)
    const placements = computeLabelLayout(nodes, {
      maxLabels: 10,
      zoomScale: 8.0,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    const visibleLabels = Array.from(placements.values()).filter((p) => p.visible);
    expect(visibleLabels.length).toBeLessThanOrEqual(10);
    expect(visibleLabels.length).toBe(10);
  });
});
