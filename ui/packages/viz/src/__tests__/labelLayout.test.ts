import { describe, it, expect } from "vitest";
import { computeLabelLayout } from "../geo/labelLayout";
import { makeHostEntityId, type GeoAggregateNode, type SelectedEntity } from "../geo/geoTypes";
import { deriveClusteredMapModel } from "../geo/mapViewModel";

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

  it("prioritizes selected node label using selectedEntityId directly even with lowest traffic under tight maxLabels budget", () => {
    // 10 nodes: first 9 have huge traffic (100MB+), last node has minimal traffic (100B)
    const nodes: GeoAggregateNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `node-${i}`,
      entityId: `entity-host-10.0.0.${i}`,
      geoCellId: `geocell-${i}`,
      nodeKind: "endpoint",
      label: `Node ${i}`,
      countryCode: "US",
      latitude: 20 + i * 3,
      longitude: -120 + i * 5,
      x: 50 + i * 50,
      y: 50 + i * 25,
      totalBytes: i === 9 ? 100 : (10 - i) * 10_000_000,
      totalFlows: i === 9 ? 1 : 100,
      sampleEndpointIps: [`10.0.0.${i}`],
      endpointIps: [`10.0.0.${i}`],
      asns: [13335],
      freshness: i === 9 ? "stale" : "active",
      deltaBytes: i === 9 ? 0 : 50_000,
      memberCount: 1,
    }));

    // With maxLabels = 3, node-9 would normally be hidden without selection
    const unselectedPlacements = computeLabelLayout(nodes, { maxLabels: 3 });
    expect(unselectedPlacements.get("node-9")?.visible).toBe(false);

    // With selectedEntityId = "entity-host-10.0.0.9", node-9 must receive top priority and be visible
    const selectedPlacements = computeLabelLayout(nodes, {
      maxLabels: 3,
      selectedEntityId: "entity-host-10.0.0.9",
    });
    const selectedPlacement = selectedPlacements.get("node-9");
    expect(selectedPlacement).toBeDefined();
    expect(selectedPlacement!.visible).toBe(true);
    expect(selectedPlacement!.priority).toBeGreaterThanOrEqual(100_000);
  });

  it("guarantees selected label priority through deriveClusteredMapModel pipeline", () => {
    const enrichedHosts = Array.from({ length: 20 }, (_, i) => ({
      ip: `198.51.100.${i + 1}`,
      bytes: i === 19 ? 50 : (20 - i) * 1_000_000,
      flows: 10,
      deltaBytes: i === 19 ? 0 : 1000,
      freshness: (i === 19 ? "stale" : "active") as "stale" | "active",
      firstSeen: 1000,
      lastSeen: 2000,
      lastSeenTs: 2000,
      hostnames: [],
      evidence: [],
      row: {
        label: `198.51.100.${i + 1}`,
        bytes: i === 19 ? 50 : (20 - i) * 1_000_000,
        flows: 10,
        hostnames: [],
        evidence: [],
      },
      geo: {
        status: "resolved" as const,
        countryCode: "US",
        country: "United States",
        region: "CA",
        city: `City-${i}`,
        latitude: 25 + i * 2,
        longitude: -120 + (i % 4) * 10,
        accuracyRadiusKm: 10,
        confidence: "high" as const,
        locationMeaning: "geoIpLocation" as const,
        locationLevel: "city" as const,
        precisionDescription: "city-level estimate" as const,
        source: "local_database" as const,
        geoDatabaseVersion: "1.0",
      },
      asn: {
        status: "resolved" as const,
        asn: 13335,
        asOrg: "Cloudflare",
        asName: "CLOUDFLARENET",
        source: "local_database" as const,
        asnDatabaseVersion: "1.0",
      },
      classification: {
        ip: `198.51.100.${i + 1}`,
        normalizedIp: `198.51.100.${i + 1}`,
        version: 4 as const,
        isPublic: true,
        isLocalLan: false,
        category: "public" as const,
        categoryLabel: "Public Internet",
        description: "Public IPv4",
      },
      anycast: {
        isAnycast: false,
        provider: null,
        service: null,
        prefixCidr: null,
        source: "none",
      },
    }));

    const snapshot = {
      captureSessionId: "sess-test",
      snapshotSequence: 1,
      snapshotTimestamp: 2000,
      enrichedHosts,
      hostsById: new Map(enrichedHosts.map((h) => [h.ip, h])),
      coverageStats: {} as any,
    };

    // Low traffic host is 198.51.100.20
    const targetIp = "198.51.100.20";
    const targetEntityId = makeHostEntityId(targetIp);

    const viewModel = deriveClusteredMapModel(snapshot, null, {
      maxVisibleNodes: 120,
      maxVisibleLabels: 3,
      selectedEntityId: targetEntityId,
    });

    expect(viewModel.activeSelection).toBeDefined();
    expect(viewModel.activeSelection?.entityId).toBe(targetEntityId);

    // Find the node containing targetIp
    const targetNode = viewModel.aggregateNodes.find((n) => n.endpointIps.includes(targetIp));
    expect(targetNode).toBeDefined();

    const targetLabelPlacement = viewModel.labelPlacements.get(targetNode!.id);
    expect(targetLabelPlacement).toBeDefined();
    expect(targetLabelPlacement!.visible).toBe(true);
    expect(targetLabelPlacement!.priority).toBeGreaterThanOrEqual(100_000);
  });
});
