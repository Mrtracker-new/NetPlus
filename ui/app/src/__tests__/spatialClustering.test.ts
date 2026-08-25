import { describe, it, expect } from "vitest";
import { buildSpatialClusters, enrichHost, clearGeoCaches } from "@netpulse/viz";
import type { BreakdownRow } from "@netpulse/contract";

describe("Spatial Clustering Engine in @netpulse/app", () => {
  it("groups geographically adjacent endpoints into a cluster at world zoom", () => {
    clearGeoCaches();

    const hosts: BreakdownRow[] = [
      {
        label: "17.0.0.1",
        bytes: 1_000_000,
        flows: 10,
        hostnames: [{ name: "apple-cupertino-1", source: "dns" }],
        evidence: [],
      },
      {
        label: "17.0.0.2",
        bytes: 500_000,
        flows: 5,
        hostnames: [{ name: "apple-cupertino-2", source: "dns" }],
        evidence: [],
      },
      {
        label: "17.0.0.3",
        bytes: 200_000,
        flows: 2,
        hostnames: [{ name: "apple-cupertino-3", source: "dns" }],
        evidence: [],
      },
    ];

    const enriched = hosts.map((h) => enrichHost(h, 0));
    const clusters = buildSpatialClusters(enriched, { zoomScale: 1.0, distanceThreshold: 26 });

    expect(clusters.length).toBe(1);
    expect(clusters[0]!.memberCount).toBe(3);
    expect(clusters[0]!.totalBytes).toBe(1_700_000);
    expect(clusters[0]!.totalFlows).toBe(17);
    expect(clusters[0]!.endpointIps).toEqual(["17.0.0.1", "17.0.0.2", "17.0.0.3"]);
  });

  it("unpacks clusters into distinct individual endpoints when zooming in", () => {
    clearGeoCaches();

    const hosts: BreakdownRow[] = [
      {
        label: "17.0.0.1",
        bytes: 1_000_000,
        flows: 10,
        hostnames: [{ name: "apple-cupertino", source: "dns" }],
        evidence: [],
      },
      {
        label: "31.0.0.1",
        bytes: 500_000,
        flows: 5,
        hostnames: [{ name: "fra-node", source: "dns" }],
        evidence: [],
      },
    ];

    const enriched = hosts.map((h) => enrichHost(h, 0));
    const worldClusters = buildSpatialClusters(enriched, { zoomScale: 1.0 });
    expect(worldClusters.length).toBe(2);
    expect(worldClusters[0]!.nodeKind).toBe("endpoint");
    expect(worldClusters[1]!.nodeKind).toBe("endpoint");
  });
});
