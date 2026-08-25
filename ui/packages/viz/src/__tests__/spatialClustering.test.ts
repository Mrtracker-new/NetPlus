import { describe, it, expect } from "vitest";
import {
  buildSpatialClusters,
  normalizeCoordinates,
  normalizeLongitude,
  normalizeWorldX,
  toroidalDistanceX,
  angularDistanceLng,
  unwrapLongitudeAroundReference,
  computeGeoCellId,
  SpatialGridIndex,
  MAX_CLUSTER_SAMPLE_IPS,
  type ClusterAccumulator,
} from "../geo/spatialClustering";
import {
  OTHER_RESOLVED_ENTITY_ID,
  OTHER_RESOLVED_GEOCELL_ID,
  OTHER_RESOLVED_NODE_ID,
  makeCanonicalCityKey,
  makeHostEntityId,
  makeCityAggregateEntityId,
  makeCountryAggregateEntityId,
  makeClusterEntityId,
  makeEndpointRenderNodeId,
  makeAggregateRenderNodeId,
  makeOtherResolvedRenderNodeId,
  getCanonicalCountryName,
  isNodeSelected,
  type EnrichedHost,
  type GeoResolution,
  type SelectedEntity,
} from "../geo/geoTypes";
import { deriveMapViewModel, deriveClusteredMapModel, type HostEnrichmentSnapshot } from "../geo/mapViewModel";
import { enrichHost, clearGeoCaches } from "../geo/geoDatabase";
import { projectGeo, MAP_WIDTH } from "../geo/worldGeometry";
import type { BreakdownRow } from "@netpulse/contract";

const asSnapshot = (snap: unknown): HostEnrichmentSnapshot => snap as HostEnrichmentSnapshot;

describe("Spatial Clustering Engine & Toroidal Grid Index", () => {
  describe("Toroidal Geometry & Normalization Helpers", () => {
    it("canonicalizes world X coordinates into [0, worldWidth) and satisfies 0 <= normalizeWorldX(x) < worldWidth", () => {
      const representativeXs = [-1440, -720, -0.1, 0, 719.9, 720, 720.1, 1440.1];
      for (const x of representativeXs) {
        const norm = normalizeWorldX(x);
        expect(norm).toBeGreaterThanOrEqual(0);
        expect(norm).toBeLessThan(720);
      }

      expect(normalizeWorldX(0)).toBe(0);
      expect(normalizeWorldX(720)).toBe(0);
      expect(normalizeWorldX(-0.1)).toBeCloseTo(719.9, 4);
      expect(normalizeWorldX(720.5)).toBeCloseTo(0.5, 4);
      expect(normalizeWorldX(-720)).toBe(0);
      expect(normalizeWorldX(360)).toBe(360);
    });

    it("verifies normalizeWorldX and normalizeLongitude idempotence", () => {
      const testXs = [-720, -0.1, 0, 180, 360, 719.9, 720, 720.1, 1440.1];
      for (const x of testXs) {
        expect(normalizeWorldX(normalizeWorldX(x))).toBe(normalizeWorldX(x));
      }

      const testLngs = [-360, -180.1, -180, -179.9, 0, 179.9, 180, 180.1, 540];
      for (const lng of testLngs) {
        expect(normalizeLongitude(normalizeLongitude(lng))).toBe(normalizeLongitude(lng));
        expect(normalizeLongitude(lng)).toBeGreaterThanOrEqual(-180);
        expect(normalizeLongitude(lng)).toBeLessThan(180);
      }
    });

    it("canonicalizes exact seam values (+180 -> -180, 720 -> 0)", () => {
      expect(normalizeLongitude(180)).toBe(-180);
      expect(normalizeLongitude(-180)).toBe(-180);
      expect(normalizeWorldX(720)).toBe(0);
      expect(normalizeWorldX(0)).toBe(0);
    });

    it("unwraps candidate longitude around reference to shortest angular displacement", () => {
      // Reference at +179.9°, candidate at -179.9° -> unwraps to +180.1°
      expect(unwrapLongitudeAroundReference(-179.9, 179.9)).toBeCloseTo(180.1, 4);

      // Reference at -179.9°, candidate at +179.9° -> unwraps to -180.1°
      expect(unwrapLongitudeAroundReference(179.9, -179.9)).toBeCloseTo(-180.1, 4);

      // Reference at 10°, candidate at 15° -> unwraps to 15°
      expect(unwrapLongitudeAroundReference(15, 10)).toBeCloseTo(15, 4);

      // Reference at 0°, candidate at 180° -> unwraps to -180° (canonical interval)
      expect(unwrapLongitudeAroundReference(180, 0)).toBeCloseTo(-180, 4);
    });

    it("computes exact periodic toroidal distance along the X axis", () => {
      expect(toroidalDistanceX(719.9, 0.1)).toBeCloseTo(0.2, 4);
      expect(toroidalDistanceX(0.1, 719.9)).toBeCloseTo(0.2, 4);
      expect(toroidalDistanceX(0, 720)).toBe(0);
      expect(toroidalDistanceX(360, 350)).toBe(10);
      expect(toroidalDistanceX(10, 710)).toBe(20);
      expect(toroidalDistanceX(100, 600)).toBe(220);
    });

    it("computes shortest angular distance between longitudes in degrees", () => {
      expect(angularDistanceLng(179.9, -179.9)).toBeCloseTo(0.2, 4);
      expect(angularDistanceLng(-179.9, 179.9)).toBeCloseTo(0.2, 4);
      expect(angularDistanceLng(180, -180)).toBe(0);
      expect(angularDistanceLng(0, 180)).toBe(180);
      expect(angularDistanceLng(-170, 170)).toBe(20);
    });
  });

  describe("Direct SpatialGridIndex Invariants", () => {
    function createMockAccumulator(id: string, x: number, y: number, lng: number, lat: number): ClusterAccumulator {
      const mockHost: EnrichedHost = {
        ip: id,
        row: { label: id, bytes: 1000, flows: 1, hostnames: [], evidence: [] },
        classification: {
          ip: id,
          normalizedIp: id,
          version: 4,
          category: "public",
          isPublic: true,
          isLocalLan: false,
          categoryLabel: "Public IPv4",
          description: "Public Internet address",
        },
        geo: {
          status: "resolved",
          precision: "city",
          distribution: "unicast",
          mapEligible: true,
          latitude: lat,
          longitude: lng,
          country: "Test",
          countryCode: "TT",
          city: "Test City",
          accuracyRadiusKm: null,
          confidence: "medium",
          locationMeaning: "geoIpLocation",
          locationLevel: "city",
          precisionDescription: "city-level estimate",
          source: "local_database",
          geoDatabaseVersion: "test-v1",
          explanation: "Resolved test host",
        },
        asn: {
          status: "unresolved",
          reason: "no_match",
          source: "local_database",
          asnDatabaseVersion: "test-v1",
        },
        anycast: {
          isAnycast: false,
          provider: null,
          service: null,
          prefixCidr: null,
          source: "test",
        },
        bytes: 1000,
        flows: 1,
        deltaBytes: 0,
        hostnames: [],
        evidence: [],
        freshness: "active",
        lastSeenTs: 1_700_000_000_000,
      };

      return {
        geoCellId: `cell-${id}`,
        count: 1,
        latSum: lat,
        unwrappedLngSum: lng,
        refLng: lng,
        avgLat: lat,
        avgLng: lng,
        avgX: x,
        avgY: y,
        firstHost: mockHost,
        endpointIps: [id],
        asns: new Set(),
        totalBytes: 1000,
        totalFlows: 1,
        deltaBytes: 0,
        hasSelected: false,
        anyActive: true,
        anyRecent: false,
        canonicalCityKeys: new Set(),
        normalizedCountryCodes: new Set(),
        allCityLevel: false,
        allCountryLevel: false,
        firstResolvedCityName: null,
        firstResolvedCountryName: null,
      };
    }

    it("finds cluster across the antimeridian seam (query near 0 finds cluster near worldWidth)", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      // Cluster near right edge (x = 719.8, lng = +179.9)
      const clusterA = createMockAccumulator("cluster-A", 719.8, 100, 179.9, 10);
      grid.insert(clusterA, 719.8, 100);

      // Query near left edge (hx = 0.2, lng = -179.9) with threshold = 26
      const { targetCluster, closestDistSq } = grid.findNearest(0.2, 100, 26);

      expect(targetCluster).toBe(clusterA);
      expect(Math.sqrt(closestDistSq)).toBeCloseTo(0.4, 3);
    });

    it("finds cluster across the antimeridian seam (query near worldWidth finds cluster near 0)", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      // Cluster near left edge (x = 0.2, lng = -179.9)
      const clusterB = createMockAccumulator("cluster-B", 0.2, 100, -179.9, 10);
      grid.insert(clusterB, 0.2, 100);

      // Query near right edge (hx = 719.8, lng = +179.9) with threshold = 26
      const { targetCluster, closestDistSq } = grid.findNearest(719.8, 100, 26);

      expect(targetCluster).toBe(clusterB);
      expect(Math.sqrt(closestDistSq)).toBeCloseTo(0.4, 3);
    });

    it("handles search radius larger than cellSize (multi-column and multi-row inspection)", () => {
      // Cell size = 15, search threshold = 45 -> inspects 3 columns/rows in each direction
      const grid = new SpatialGridIndex(15, 720, 360);
      const cluster = createMockAccumulator("cluster-C", 710, 100, 175, 10);
      grid.insert(cluster, 710, 100);

      // Query point at hx = 20 (toroidal distance = 10 + 20 = 30px <= 45px)
      const { targetCluster, closestDistSq } = grid.findNearest(20, 100, 45);

      expect(targetCluster).toBe(cluster);
      expect(Math.sqrt(closestDistSq)).toBeCloseTo(30, 3);
    });

    it("enforces non-periodic Y boundary (never wraps latitude/Y axis)", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      // Cluster at top edge (y = 2)
      const clusterTop = createMockAccumulator("cluster-top", 360, 2, 0, 89);
      grid.insert(clusterTop, 360, 2);

      // Query at bottom edge (y = 358) with threshold = 26
      const { targetCluster } = grid.findNearest(360, 358, 26);

      // Must NOT wrap around poles
      expect(targetCluster).toBeNull();
    });

    it("relocates cluster across cell boundary from old bucket to new bucket exactly once", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      const cluster = createMockAccumulator("cluster-reloc", 10, 10, -175, 10);
      grid.insert(cluster, 10, 10);

      // Initially in cell gx=0, gy=0 -> bucket "0_0"
      expect(grid.getClusterBucketKey(cluster)).toBe("0_0");

      // Move centroid to x=35, y=10 (crosses into gx=1, gy=0 -> bucket "1_0")
      cluster.avgX = 35;
      cluster.avgY = 10;
      grid.updatePosition(cluster, 35, 10);

      expect(grid.getClusterBucketKey(cluster)).toBe("1_0");

      // Query at old location (x=10, y=10) with small threshold=5 should no longer find the cluster
      const oldQuery = grid.findNearest(10, 10, 5);
      expect(oldQuery.targetCluster).toBeNull();

      // Query at new location (x=35, y=10) with threshold=5 must find the cluster
      const newQuery = grid.findNearest(35, 10, 5);
      expect(newQuery.targetCluster).toBe(cluster);
    });

    it("relocates cluster across the antimeridian seam in both directions (N-1 -> 0 and 0 -> N-1)", () => {
      const grid = new SpatialGridIndex(26, 720, 360); // 28 cols: 0..27
      const cluster = createMockAccumulator("cluster-seam", 715, 100, 177.5, 10);
      grid.insert(cluster, 715, 100);

      // Initial bucket in Col 27 (N-1)
      expect(grid.getClusterBucketKey(cluster)).toBe("27_3");

      // Shift across antimeridian into Col 0 (x=5)
      cluster.avgX = 5;
      cluster.avgY = 100;
      grid.updatePosition(cluster, 5, 100);
      expect(grid.getClusterBucketKey(cluster)).toBe("0_3");

      // Shift back across antimeridian from Col 0 into Col 27 (x=715)
      cluster.avgX = 715;
      cluster.avgY = 100;
      grid.updatePosition(cluster, 715, 100);
      expect(grid.getClusterBucketKey(cluster)).toBe("27_3");
    });

    it("guarantees candidate completeness after centroid relocation when query does not inspect old cell", () => {
      // Cell size = 10, threshold = 10, cellRadius = 1
      const grid = new SpatialGridIndex(10, 720, 360);
      const cluster = createMockAccumulator("cluster-candidate", 9, 100, -175.5, 10);
      grid.insert(cluster, 9, 100); // Cell 0: [0, 10)
      expect(grid.getClusterBucketKey(cluster)).toBe("0_10");

      // Centroid moves to x=13.5 (Cell 1: [10, 20))
      cluster.avgX = 13.5;
      cluster.avgY = 100;
      grid.updatePosition(cluster, 13.5, 100);
      expect(grid.getClusterBucketKey(cluster)).toBe("1_10");

      // Query host at x=23 (Cell 2: [20, 30)) with threshold = 10
      // Distance from x=23 to centroid x=13.5 is 9.5 <= 10.
      // Query cell (gx=2) inspects cols 1, 2, 3 (covering [10, 40)), and DOES NOT inspect col 0.
      // Because cluster was relocated to col 1, it MUST be found.
      const query = grid.findNearest(23, 100, 10);
      expect(query.targetCluster).toBe(cluster);
      expect(Math.sqrt(query.closestDistSq)).toBeCloseTo(9.5, 3);
    });

    it("treats repeated same-cell updatePosition as an efficient no-op", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      const cluster = createMockAccumulator("cluster-noop", 10, 10, -175, 10);
      grid.insert(cluster, 10, 10);
      expect(grid.getClusterBucketKey(cluster)).toBe("0_0");

      // Update to (12, 11) - same cell "0_0"
      grid.updatePosition(cluster, 12, 11);
      expect(grid.getClusterBucketKey(cluster)).toBe("0_0");

      // Update to (15, 14) - still same cell "0_0"
      grid.updatePosition(cluster, 15, 14);
      expect(grid.getClusterBucketKey(cluster)).toBe("0_0");

      // Query finds the cluster exactly once
      const query = grid.findNearest(10, 10, 26);
      expect(query.targetCluster).toBe(cluster);
    });

    it("removes cluster and deletes empty bucket to enforce memory boundedness", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      const cluster = createMockAccumulator("cluster-rm", 10, 10, -175, 10);
      grid.insert(cluster, 10, 10);
      expect(grid.getClusterBucketKey(cluster)).toBe("0_0");
      expect(grid.size()).toBe(1);
      expect(grid.bucketCount()).toBe(1);

      grid.remove(cluster);
      expect(grid.getClusterBucketKey(cluster)).toBeUndefined();
      expect(grid.size()).toBe(0);
      expect(grid.bucketCount()).toBe(0);

      const query = grid.findNearest(10, 10, 26);
      expect(query.targetCluster).toBeNull();
    });

    it("clears all clusters and buckets via clear()", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      const c1 = createMockAccumulator("cluster-1", 10, 10, -175, 10);
      const c2 = createMockAccumulator("cluster-2", 50, 50, -155, 30);
      grid.insert(c1, 10, 10);
      grid.insert(c2, 50, 50);

      expect(grid.size()).toBe(2);
      expect(grid.bucketCount()).toBe(2);

      grid.clear();
      expect(grid.size()).toBe(0);
      expect(grid.bucketCount()).toBe(0);
      expect(grid.findNearest(10, 10, 26).targetCluster).toBeNull();
    });

    it("handles non-finite and invalid search queries gracefully", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      const cluster = createMockAccumulator("cluster-safe", 10, 10, -175, 10);
      grid.insert(cluster, 10, 10);

      expect(grid.findNearest(NaN, 10, 26).targetCluster).toBeNull();
      expect(grid.findNearest(10, Infinity, 26).targetCluster).toBeNull();
      expect(grid.findNearest(10, 10, -5).targetCluster).toBeNull();
      expect(grid.findNearest(10, 10, 0).targetCluster).toBeNull();
      expect(grid.findNearest(10, 10, NaN).targetCluster).toBeNull();
    });

    it("breaks exact distance ties deterministically (higher totalBytes wins)", () => {
      const grid = new SpatialGridIndex(26, 720, 360);
      // Two clusters positioned symmetrically equidistant from query point (50, 50)
      // Cluster A at (40, 50) [dist = 10], TotalBytes = 5,000
      // Cluster B at (60, 50) [dist = 10], TotalBytes = 20,000
      const clusterA = createMockAccumulator("cluster-A", 40, 50, -160, 10);
      clusterA.totalBytes = 5_000;
      clusterA.geoCellId = "geocell-1";

      const clusterB = createMockAccumulator("cluster-B", 60, 50, -150, 10);
      clusterB.totalBytes = 20_000;
      clusterB.geoCellId = "geocell-2";

      grid.insert(clusterA, 40, 50);
      grid.insert(clusterB, 60, 50);

      const query = grid.findNearest(50, 50, 15);
      expect(query.targetCluster).toBe(clusterB); // Higher totalBytes wins tie
      expect(Math.sqrt(query.closestDistSq)).toBeCloseTo(10, 4);
    });
  });

  describe("End-to-End Spatial Clustering with Antimeridian Resolution", () => {
    function createMockHost(ip: string, lat: number, lng: number, bytes = 1000): EnrichedHost {
      return {
        ip,
        row: { label: ip, bytes, flows: 1, hostnames: [], evidence: [] },
        classification: {
          ip,
          normalizedIp: ip,
          version: 4,
          category: "public",
          isPublic: true,
          isLocalLan: false,
          categoryLabel: "Public IPv4",
          description: "Public Internet address",
        },
        geo: {
          status: "resolved",
          precision: "country",
          distribution: "unicast",
          mapEligible: true,
          latitude: lat,
          longitude: lng,
          country: "Pacific Island",
          countryCode: "FJ",
          city: null,
          accuracyRadiusKm: null,
          confidence: "medium",
          locationMeaning: "countryOnly",
          locationLevel: "country",
          precisionDescription: "country-level estimate",
          source: "local_database",
          geoDatabaseVersion: "test-v1",
          explanation: "Test mock host",
        } as unknown as GeoResolution,
        asn: {
          status: "resolved",
          asn: 13335,
          asOrg: "Cloudflare",
          asName: "CLOUDFLARENET",
          source: "local_database",
          asnDatabaseVersion: "test-v1",
        },
        anycast: {
          isAnycast: false,
          provider: null,
          service: null,
          prefixCidr: null,
          source: "test",
        },
        hostnames: [],
        bytes,
        deltaBytes: 0,
        flows: 1,
        evidence: [],
        freshness: "active",
        lastSeenTs: 1_700_000_000_000,
      };
    }

    it("clusters endpoints at +179.9° and -179.9° into 1 cluster with centroid on antimeridian seam", () => {
      const hostEast = createMockHost("192.0.2.1", -16.0, 179.9, 100_000);
      const hostWest = createMockHost("192.0.2.2", -16.0, -179.9, 50_000);

      const clusters = buildSpatialClusters([hostEast, hostWest], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const cluster = clusters[0]!;
      expect(cluster.nodeKind).toBe("countryAggregate");
      expect(cluster.entityId).toBe("entity-country-fj");
      expect(cluster.memberCount).toBe(2);
      expect(cluster.totalBytes).toBe(150_000);

      // Verify geographic centroid is mathematically within numerical tolerance of ±180° (-180 canonical)
      expect(angularDistanceLng(cluster.longitude, 180)).toBeLessThanOrEqual(1e-4);
      expect(cluster.longitude).toBeGreaterThanOrEqual(-180);
      expect(cluster.longitude).toBeLessThan(180);
      expect(cluster.latitude).toBeCloseTo(-16.0, 4);

      // Verify projected X coordinate is within numerical tolerance of the seam (0 in canonical representation)
      const seamDist = toroidalDistanceX(cluster.x, 0);
      expect(seamDist).toBeLessThanOrEqual(1e-3);
    });

    it("unclusters antimeridian pair when zoom causes toroidalDistance to exceed effective threshold", () => {
      // Points separated by 0.2° longitude (~0.4 px in 720-width map)
      const hostEast = createMockHost("192.0.2.1", -16.0, 179.9, 100_000);
      const hostWest = createMockHost("192.0.2.2", -16.0, -179.9, 50_000);

      const [x1] = projectGeo(-16.0, 179.9);
      const [x2] = projectGeo(-16.0, -179.9);
      const pointDist = toroidalDistanceX(x1, x2);
      expect(pointDist).toBeCloseTo(0.4, 2);

      // At zoom = 1.0: threshold = 26 > 0.4 -> clusters into countryAggregate
      const z1Clusters = buildSpatialClusters([hostEast, hostWest], { zoomScale: 1.0, distanceThreshold: 26 });
      expect(z1Clusters.length).toBe(1);
      expect(z1Clusters[0]!.nodeKind).toBe("countryAggregate");

      // At zoom = 100.0: effective threshold = 26 / 100 = 0.26 < 0.4 -> unclusters
      const z100Clusters = buildSpatialClusters([hostEast, hostWest], { zoomScale: 100.0, distanceThreshold: 26 });
      expect(z100Clusters.length).toBe(2);
      expect(z100Clusters[0]!.nodeKind).toBe("endpoint");
      expect(z100Clusters[1]!.nodeKind).toBe("endpoint");
    });

    it("maintains non-seam clustering correctness and explicitly verifies angular threshold separation", () => {
      // 1. Same side seam cluster (+179.9 and +179.7 -> dist = 0.2° = 0.4px <= 26px)
      const host1 = createMockHost("10.0.0.1", 10.0, 179.9);
      const host2 = createMockHost("10.0.0.2", 10.0, 179.7);
      const c1 = buildSpatialClusters([host1, host2], { zoomScale: 1.0, distanceThreshold: 26 });
      expect(c1.length).toBe(1);
      expect(c1[0]!.memberCount).toBe(2);

      // 2. Far apart points (+170.0 and -170.0 -> angular distance = 20°, screen distance = 40px)
      // At zoomScale = 1.0 and distanceThreshold = 26px: 40px > 26px (20° > 13° threshold) -> do NOT cluster
      const angularSep = angularDistanceLng(170.0, -170.0);
      expect(angularSep).toBe(20);

      const hostFarA = createMockHost("10.0.0.3", 10.0, 170.0);
      const hostFarB = createMockHost("10.0.0.4", 10.0, -170.0);
      const c2 = buildSpatialClusters([hostFarA, hostFarB], { zoomScale: 1.0, distanceThreshold: 26 });
      expect(c2.length).toBe(2);
      expect(c2[0]!.nodeKind).toBe("endpoint");
      expect(c2[1]!.nodeKind).toBe("endpoint");
    });

    it("prevents over-merging: seam cluster and Prime Meridian control point remain distinct", () => {
      const hostEast = createMockHost("192.0.2.1", 51.5, 179.9, 100_000);
      const hostWest = createMockHost("192.0.2.2", 51.5, -179.9, 50_000);
      // Greenwich, London at 0° longitude
      const hostGreenwich = createMockHost("192.0.2.3", 51.5, 0.0, 20_000);

      const clusters = buildSpatialClusters([hostEast, hostWest, hostGreenwich], {
        zoomScale: 1.0,
        distanceThreshold: 26,
      });

      // Must produce exactly 2 nodes: 1 seam cluster (2 hosts) and 1 Greenwich endpoint (1 host)
      expect(clusters.length).toBe(2);

      const seamCluster = clusters.find((c) => c.memberCount === 2);
      const greenwichNode = clusters.find((c) => c.memberCount === 1);

      expect(seamCluster).toBeDefined();
      expect(greenwichNode).toBeDefined();

      expect(angularDistanceLng(seamCluster!.longitude, 180)).toBeLessThanOrEqual(1e-4);
      expect(greenwichNode!.longitude).toBeCloseTo(0.0, 4);
    });

    it("groups geographically adjacent California endpoints into a cluster at world zoom", () => {
      clearGeoCaches();

      const hosts: BreakdownRow[] = [
        { label: "17.0.0.1", bytes: 1_000_000, flows: 10, hostnames: [{ name: "apple-cupertino-1", source: "dns" }], evidence: [] },
        { label: "17.0.0.2", bytes: 500_000, flows: 5, hostnames: [{ name: "apple-cupertino-2", source: "dns" }], evidence: [] },
        { label: "17.0.0.3", bytes: 200_000, flows: 2, hostnames: [{ name: "apple-cupertino-3", source: "dns" }], evidence: [] },
      ];

      const enriched = hosts.map((h) => enrichHost(h, 0));
      const clusters = buildSpatialClusters(enriched, { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      expect(clusters[0]!.memberCount).toBe(3);
      expect(clusters[0]!.totalBytes).toBe(1_700_000);
      expect(clusters[0]!.totalFlows).toBe(17);
      expect(clusters[0]!.endpointIps).toEqual(["17.0.0.1", "17.0.0.2", "17.0.0.3"]);
    });

    it("guarantees candidate completeness across a 10+ host centroid migration chain", () => {
      // Create 11 hosts positioned along latitude 0.0 with coordinates such that each host
      // is within worldDistThreshold (26px) of the evolving cluster centroid, but later hosts
      // are far outside the initial seed host's grid bucket.
      //
      // Screen X progression (worldWidth = 720):
      // Host 1 (seed, highest bytes): x = 5 (Cell 0: [0, 26))
      // Host 2: x = 30 -> dist to 5 is 25 <= 26 -> centroid moves to 17.5 (Cell 0)
      // Host 3: x = 43 -> dist to 17.5 is 25.5 <= 26 -> centroid moves to 26.0 (Cell 1)
      // Host 4: x = 51 -> dist to 26.0 is 25.0 <= 26 -> centroid moves to 32.25 (Cell 1)
      // Host 5: x = 58 -> dist to 32.25 is 25.75 <= 26 -> centroid moves to 37.4 (Cell 1)
      // Host 6: x = 63 -> dist to 37.4 is 25.6 <= 26 -> centroid moves to 41.67 (Cell 1)
      // Host 7: x = 67 -> dist to 41.67 is 25.33 <= 26 -> centroid moves to 45.29 (Cell 1)
      // Host 8: x = 71 -> dist to 45.29 is 25.71 <= 26 -> centroid moves to 48.5 (Cell 1)
      // Host 9: x = 74 -> dist to 48.5 is 25.5 <= 26 -> centroid moves to 51.33 (Cell 1)
      // Host 10: x = 77 -> dist to 51.33 is 25.67 <= 26 -> centroid moves to 53.9 (Cell 2: [52, 78))
      // Host 11: x = 79 -> dist to 53.9 is 25.1 <= 26 -> Cell 3: [78, 104)
      //
      // Note: Distance from Host 11 (x=79) to initial seed Host 1 (x=5) is 74px >> 26px.
      // Without dynamic re-indexing, the cluster would remain in Cell 0, which is NOT inspected
      // by Host 11 in Cell 3 (search neighborhood: Cells 2, 3, 4).
      // With dynamic re-indexing, all 11 hosts MUST collapse into 1 single cluster.

      const xs = [5, 30, 43, 51, 58, 63, 67, 71, 74, 77, 79];
      const hosts: EnrichedHost[] = xs.map((x, idx) => {
        // Invert projectGeo: x = (lng + 180) * 2 => lng = x / 2 - 180
        const lng = x / 2 - 180;
        const bytes = 100_000 - idx * 1_000; // Descending byte order ensures Host 1 is seed
        return createMockHost(`192.0.2.${idx + 1}`, 0.0, lng, bytes);
      });

      const clusters = buildSpatialClusters(hosts, { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      expect(clusters[0]!.memberCount).toBe(11);
      expect(clusters[0]!.totalBytes).toBe(hosts.reduce((acc, h) => acc + h.bytes, 0));
    });

    it("handles high density of 1,000 endpoints within render budget and execution time", () => {
      clearGeoCaches();

      const hosts: BreakdownRow[] = [];
      for (let i = 0; i < 1000; i++) {
        const prefixes = ["1.1.1.1", "8.8.8.8", "13.107.4.50", "20.190.159.0", "31.13.72.36", "52.95.110.1", "142.250.190.46"];
        const baseIp = prefixes[i % prefixes.length]!;
        hosts.push({
          label: baseIp,
          bytes: (i + 1) * 1000,
          flows: (i % 5) + 1,
          hostnames: [],
          evidence: [],
        });
      }

      const enriched = hosts.map((h) => enrichHost(h, 0));
      const t0 = performance.now();
      const clusters = buildSpatialClusters(enriched, { maxNodes: 120 });
      const t1 = performance.now();

      expect(clusters.length).toBeLessThanOrEqual(120);
      expect(t1 - t0).toBeLessThan(300.0);
    });
  });

  describe("4D Traffic Conservation & Other Resolved Traffic Invariants (Invariants 1-18)", () => {
    function generateIsolatedHosts(count: number): EnrichedHost[] {
      const hosts: EnrichedHost[] = [];
      for (let i = 0; i < count; i++) {
        // Distribute coordinates far apart across the globe
        const lat = -70 + (i * 1.3) % 140;
        const lng = -170 + (i * 3.7) % 340;
        const ip = `198.51.${Math.floor(i / 254) + 100}.${(i % 254) + 1}`;
        const bytes = (i + 1) * 5000;
        const flows = (i % 7) + 1;
        const deltaBytes = i % 2 === 0 ? 500 : -200; // mixed positive & negative deltaBytes

        hosts.push({
          ip,
          row: { label: ip, bytes, flows, hostnames: [{ name: `host-${i}.com`, source: "dns" }], evidence: [] },
          classification: {
            ip,
            normalizedIp: ip,
            version: 4,
            category: "public",
            isPublic: true,
            isLocalLan: false,
            categoryLabel: "Public IPv4",
            description: "Public address",
          },
          geo: {
            status: "resolved",
            precision: "city",
            distribution: "unicast",
            mapEligible: true,
            latitude: lat,
            longitude: lng,
            country: `Country ${i % 30}`,
            countryCode: `C${i % 30}`,
            city: `City ${i}`,
            accuracyRadiusKm: 25,
            confidence: "high",
            locationMeaning: "geoIpLocation",
            locationLevel: "city",
            precisionDescription: "city-level estimate",
            source: "local_database",
            geoDatabaseVersion: "test-v1",
            explanation: "Test isolated host",
          },
          asn: {
            status: "resolved",
            asn: 1000 + (i % 50),
            asOrg: `AS-Org-${i % 50}`,
            asName: null,
            source: "local_database",
            asnDatabaseVersion: "test-v1",
          },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes,
          flows,
          deltaBytes,
          hostnames: [{ name: `host-${i}.com`, source: "dns" }],
          evidence: [],
          freshness: i % 3 === 0 ? "active" : i % 3 === 1 ? "recent" : "stale",
          lastSeenTs: 1_700_000_000_000,
        });
      }
      return hosts;
    }

    it("Invariant 1-9: strictly conserves totalBytes, totalFlows, deltaBytes, memberCount, and endpoint cardinality", () => {
      const hosts = generateIsolatedHosts(200);
      const expectedTotalBytes = hosts.reduce((s, h) => s + h.bytes, 0);
      const expectedTotalFlows = hosts.reduce((s, h) => s + h.flows, 0);
      const expectedDeltaBytes = hosts.reduce((s, h) => s + h.deltaBytes, 0);
      const expectedMemberCount = hosts.length;
      const expectedUniqueIps = new Set(hosts.map((h) => h.ip));

      const nodes = buildSpatialClusters(hosts, { maxNodes: 120, distanceThreshold: 1 });

      // Invariant 1 & 2: Budget compliance
      expect(nodes.length).toBe(120);

      // Invariant 3: Exactly one node has nodeKind === "otherResolvedAggregate"
      const aggregateNodes = nodes.filter((n) => n.nodeKind === "otherResolvedAggregate");
      expect(aggregateNodes.length).toBe(1);
      const agg = aggregateNodes[0]!;

      expect(agg.entityId).toBe(OTHER_RESOLVED_ENTITY_ID);
      expect(agg.geoCellId).toBe(OTHER_RESOLVED_GEOCELL_ID);
      expect(agg.locationLevel).toBe("multiLocation");

      // Invariant 4 & 5: No cluster belongs to both visible and aggregate; every cluster belongs to exactly 1 node
      const visibleNodes = nodes.filter((n) => n.nodeKind !== "otherResolvedAggregate");
      expect(visibleNodes.length).toBe(119);

      const visibleIps = new Set(visibleNodes.flatMap((n) => n.endpointIps));
      const aggregateIps = new Set(agg.endpointIps);

      for (const ip of aggregateIps) {
        expect(visibleIps.has(ip)).toBe(false);
      }

      // Invariant 6: 100% totalBytes conservation
      const actualTotalBytes = nodes.reduce((s, n) => s + n.totalBytes, 0);
      expect(actualTotalBytes).toBe(expectedTotalBytes);

      // Invariant 7: 100% totalFlows conservation
      const actualTotalFlows = nodes.reduce((s, n) => s + n.totalFlows, 0);
      expect(actualTotalFlows).toBe(expectedTotalFlows);

      // Invariant 8: 100% deltaBytes conservation (including mixed signs)
      const actualDeltaBytes = nodes.reduce((s, n) => s + n.deltaBytes, 0);
      expect(actualDeltaBytes).toBe(expectedDeltaBytes);

      // Invariant 9: 100% memberCount conservation
      const actualMemberCount = nodes.reduce((s, n) => s + (n.memberCount ?? 1), 0);
      expect(actualMemberCount).toBe(expectedMemberCount);

      // Invariant 10: Deduplicated sample endpoint IPs bounded to MAX_CLUSTER_SAMPLE_IPS on aggregate
      expect(agg.memberCount).toBe(81);
      expect(agg.sampleEndpointIps.length).toBe(Math.min(81, MAX_CLUSTER_SAMPLE_IPS));
      expect(agg.endpointIps.length).toBe(Math.min(81, MAX_CLUSTER_SAMPLE_IPS));

      const allEmittedIps = new Set(nodes.flatMap((n) => n.endpointIps));
      expect(allEmittedIps.size).toBe(visibleNodes.length + agg.sampleEndpointIps.length);
      for (const ip of allEmittedIps) {
        expect(expectedUniqueIps.has(ip)).toBe(true);
      }
    });

    it("Invariant 10: preserves strict determinism regardless of input host array shuffling", () => {
      const hosts = generateIsolatedHosts(150);

      const shuffled1 = [...hosts].sort(() => Math.sin(1));
      const shuffled2 = [...hosts].reverse();
      const shuffled3 = [...hosts].sort((a, b) => a.ip.localeCompare(b.ip));

      const res1 = buildSpatialClusters(shuffled1, { maxNodes: 80, distanceThreshold: 1 });
      const res2 = buildSpatialClusters(shuffled2, { maxNodes: 80, distanceThreshold: 1 });
      const res3 = buildSpatialClusters(shuffled3, { maxNodes: 80, distanceThreshold: 1 });

      expect(res1.length).toBe(80);
      expect(res2.length).toBe(80);
      expect(res3.length).toBe(80);

      // Verify every node is identical in ID, position, and metrics across all shuffled orders
      for (let i = 0; i < 80; i++) {
        expect(res1[i]!.id).toBe(res2[i]!.id);
        expect(res1[i]!.id).toBe(res3[i]!.id);
        expect(res1[i]!.totalBytes).toBe(res2[i]!.totalBytes);
        expect(res1[i]!.totalBytes).toBe(res3[i]!.totalBytes);
        expect(res1[i]!.latitude).toBeCloseTo(res2[i]!.latitude, 5);
        expect(res1[i]!.longitude).toBeCloseTo(res2[i]!.longitude, 5);
        expect(res1[i]!.endpointIps).toEqual(res2[i]!.endpointIps);
      }
    });

    it("enforces deterministic tie-breaking for clusters with identical totalBytes", () => {
      // 4 hosts with identical totalBytes
      const hosts: EnrichedHost[] = [
        {
          ip: "10.0.0.1",
          row: { label: "10.0.0.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
          classification: { ip: "10.0.0.1", normalizedIp: "10.0.0.1", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
          geo: { status: "resolved", precision: "city", distribution: "unicast", mapEligible: true, latitude: 50.0, longitude: 10.0, country: "DE", countryCode: "DE", city: "Frankfurt", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1", explanation: "Test" },
          asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
        },
        {
          ip: "10.0.0.2",
          row: { label: "10.0.0.2", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
          classification: { ip: "10.0.0.2", normalizedIp: "10.0.0.2", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
          geo: { status: "resolved", precision: "city", distribution: "unicast", mapEligible: true, latitude: 48.0, longitude: 11.0, country: "DE", countryCode: "DE", city: "Munich", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1", explanation: "Test" },
          asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
        },
        {
          ip: "10.0.0.3",
          row: { label: "10.0.0.3", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
          classification: { ip: "10.0.0.3", normalizedIp: "10.0.0.3", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
          geo: { status: "resolved", precision: "city", distribution: "unicast", mapEligible: true, latitude: 35.0, longitude: 139.0, country: "JP", countryCode: "JP", city: "Tokyo", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1", explanation: "Test" },
          asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
        },
      ];

      const nodes1 = buildSpatialClusters(hosts, { maxNodes: 2, distanceThreshold: 1 });
      const nodes2 = buildSpatialClusters([...hosts].reverse(), { maxNodes: 2, distanceThreshold: 1 });

      expect(nodes1.length).toBe(2);
      expect(nodes2.length).toBe(2);
      expect(nodes1[0]!.id).toBe(nodes2[0]!.id);
      expect(nodes1[1]!.id).toBe(nodes2[1]!.id);
    });

    it("enforces explicit maxNodes contract: 0 returns empty array, invalid values normalize to default 120", () => {
      const hosts = generateIsolatedHosts(5);

      // maxNodes = 0: Valid "render zero nodes"
      const nodesZero = buildSpatialClusters(hosts, { maxNodes: 0 });
      expect(nodesZero).toEqual([]);

      // Invalid values: negative, NaN, Infinity normalize to default (120) and render safely without throwing
      const nodesNegative = buildSpatialClusters(hosts, { maxNodes: -10, distanceThreshold: 1 });
      expect(nodesNegative.length).toBe(5);

      const nodesNaN = buildSpatialClusters(hosts, { maxNodes: NaN, distanceThreshold: 1 });
      expect(nodesNaN.length).toBe(5);

      const nodesInf = buildSpatialClusters(hosts, { maxNodes: Infinity, distanceThreshold: 1 });
      expect(nodesInf.length).toBe(5);
    });

    it("handles boundary edge cases: maxNodes = 1, maxNodes = 2, maxNodes = exact count", () => {
      const hosts = generateIsolatedHosts(10);
      const totalBytes = hosts.reduce((s, h) => s + h.bytes, 0);

      // maxNodes = 1: All 10 clusters roll up into 1 aggregate node holding 100% of volume
      const nodesMax1 = buildSpatialClusters(hosts, { maxNodes: 1, distanceThreshold: 1 });
      expect(nodesMax1.length).toBe(1);
      expect(nodesMax1[0]!.nodeKind).toBe("otherResolvedAggregate");
      expect(nodesMax1[0]!.totalBytes).toBe(totalBytes);
      expect(nodesMax1[0]!.memberCount).toBe(10);

      // maxNodes = 2: 1 top visible node + 1 aggregate node holding remaining 9 clusters
      const nodesMax2 = buildSpatialClusters(hosts, { maxNodes: 2, distanceThreshold: 1 });
      expect(nodesMax2.length).toBe(2);
      expect(nodesMax2[0]!.nodeKind).toBe("endpoint");
      expect(nodesMax2[1]!.nodeKind).toBe("otherResolvedAggregate");
      expect(nodesMax2[0]!.totalBytes + nodesMax2[1]!.totalBytes).toBe(totalBytes);
      expect(nodesMax2[1]!.memberCount).toBe(9);

      // maxNodes = 10 (exact count): All 10 clusters visible, 0 aggregate nodes
      const nodesMax10 = buildSpatialClusters(hosts, { maxNodes: 10, distanceThreshold: 1 });
      expect(nodesMax10.length).toBe(10);
      expect(nodesMax10.some((n) => n.nodeKind === "otherResolvedAggregate")).toBe(false);

      // maxNodes = 11 (more than count): All 10 clusters visible, 0 aggregate nodes
      const nodesMax11 = buildSpatialClusters(hosts, { maxNodes: 11, distanceThreshold: 1 });
      expect(nodesMax11.length).toBe(10);
    });

    it("calculates antimeridian-safe weighted centroid across the Pacific seam", () => {
      const hostEast: EnrichedHost = {
        ip: "100.0.0.1",
        row: { label: "100.0.0.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
        classification: { ip: "100.0.0.1", normalizedIp: "100.0.0.1", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
        geo: { status: "resolved", precision: "city", distribution: "unicast", mapEligible: true, latitude: 10.0, longitude: 179.5, country: "Fiji", countryCode: "FJ", city: "Suva", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1", explanation: "Test" },
        asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
        anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
        bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
      };
      const hostWest: EnrichedHost = {
        ip: "100.0.0.2",
        row: { label: "100.0.0.2", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
        classification: { ip: "100.0.0.2", normalizedIp: "100.0.0.2", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
        geo: { status: "resolved", precision: "city", distribution: "unicast", mapEligible: true, latitude: 10.0, longitude: -179.5, country: "Samoa", countryCode: "WS", city: "Apia", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1", explanation: "Test" },
        asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
        anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
        bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
      };

      // Both roll up into 1 aggregate when maxNodes = 1
      const nodes = buildSpatialClusters([hostEast, hostWest], { maxNodes: 1, distanceThreshold: 1 });
      expect(nodes.length).toBe(1);
      const agg = nodes[0]!;

      // Centroid longitude must be near ±180° (-180 canonical), NOT near 0° Prime Meridian
      expect(angularDistanceLng(agg.longitude, 180)).toBeLessThanOrEqual(1e-4);
      expect(agg.latitude).toBeCloseTo(10.0, 4);
    });

    it("triggers zero-weight fallback gracefully when all overflow clusters have 0 bytes", () => {
      const hosts = generateIsolatedHosts(5).map((h) => ({ ...h, bytes: 0 }));

      const nodes = buildSpatialClusters(hosts, { maxNodes: 1, distanceThreshold: 1 });
      expect(nodes.length).toBe(1);
      const agg = nodes[0]!;

      expect(Number.isFinite(agg.latitude)).toBe(true);
      expect(Number.isFinite(agg.longitude)).toBe(true);
      expect(Number.isFinite(agg.x)).toBe(true);
      expect(Number.isFinite(agg.y)).toBe(true);
      expect(agg.totalBytes).toBe(0);
      expect(agg.memberCount).toBe(5);
    });

    it("guarantees selected low-traffic endpoint survives maxNodes budget and is never subsumed by Other Resolved Traffic", () => {
      const hosts = generateIsolatedHosts(200);
      // Give the selected host the lowest traffic (1 byte) so it would normally be ranked last (index 199)
      const selectedHost = hosts[199]!;
      selectedHost.bytes = 1;
      selectedHost.row.bytes = 1;

      const expectedTotalBytes = hosts.reduce((s, h) => s + h.bytes, 0);
      const expectedTotalFlows = hosts.reduce((s, h) => s + h.flows, 0);
      const expectedDeltaBytes = hosts.reduce((s, h) => s + h.deltaBytes, 0);
      const expectedMemberCount = hosts.length;

      const nodes = buildSpatialClusters(hosts, {
        maxNodes: 120,
        distanceThreshold: 1,
        selectedIp: selectedHost.ip,
      });

      // Strict budget compliance: 120 total nodes
      expect(nodes.length).toBe(120);

      // Exactly 1 Other Resolved Traffic aggregate
      const aggNodes = nodes.filter((n) => n.nodeKind === "otherResolvedAggregate");
      expect(aggNodes.length).toBe(1);
      const agg = aggNodes[0]!;

      // The selected endpoint MUST be emitted as a visible individual endpoint node
      const visibleNodes = nodes.filter((n) => n.nodeKind !== "otherResolvedAggregate");
      expect(visibleNodes.length).toBe(119);

      const targetNode = visibleNodes.find((n) => n.endpointIps.includes(selectedHost.ip));
      expect(targetNode).toBeDefined();
      expect(targetNode?.nodeKind).toBe("endpoint");
      expect(targetNode?.entityId).toBe(`entity-host-${selectedHost.ip}`);
      expect(targetNode?.totalBytes).toBe(1);

      // Selected IP must NOT be inside the aggregate node
      expect(agg.endpointIps).not.toContain(selectedHost.ip);

      // Conservation invariants
      const actualTotalBytes = nodes.reduce((s, n) => s + n.totalBytes, 0);
      expect(actualTotalBytes).toBe(expectedTotalBytes);

      const actualTotalFlows = nodes.reduce((s, n) => s + n.totalFlows, 0);
      expect(actualTotalFlows).toBe(expectedTotalFlows);

      const actualDeltaBytes = nodes.reduce((s, n) => s + n.deltaBytes, 0);
      expect(actualDeltaBytes).toBe(expectedDeltaBytes);

      const actualMemberCount = nodes.reduce((s, n) => s + (n.memberCount ?? 1), 0);
      expect(actualMemberCount).toBe(expectedMemberCount);

      expect(agg.memberCount).toBe(81);
      expect(agg.sampleEndpointIps.length).toBe(Math.min(81, MAX_CLUSTER_SAMPLE_IPS));

      const allEmittedIps = new Set(nodes.flatMap((n) => n.endpointIps));
      expect(allEmittedIps.size).toBe(visibleNodes.length + agg.sampleEndpointIps.length);
    });

    it("guarantees selected cluster survives maxNodes budget when selectedEntityId is provided", () => {
      const hosts = generateIsolatedHosts(150);
      const selectedHost = hosts[149]!;
      selectedHost.bytes = 1;

      const nodes = buildSpatialClusters(hosts, {
        maxNodes: 50,
        distanceThreshold: 1,
        selectedEntityId: `entity-host-${selectedHost.ip}`,
      });

      expect(nodes.length).toBe(50);
      const visibleNodes = nodes.filter((n) => n.nodeKind !== "otherResolvedAggregate");
      const targetNode = visibleNodes.find((n) => n.endpointIps.includes(selectedHost.ip));
      expect(targetNode).toBeDefined();
      expect(targetNode?.entityId).toBe(`entity-host-${selectedHost.ip}`);
    });

    it("preserves selection under boundary budget maxNodes = 2 (1 selected visible node + 1 aggregate node)", () => {
      const hosts = generateIsolatedHosts(10);
      const selectedHost = hosts[9]!;
      selectedHost.bytes = 5;

      const totalBytes = hosts.reduce((s, h) => s + h.bytes, 0);

      const nodes = buildSpatialClusters(hosts, {
        maxNodes: 2,
        distanceThreshold: 1,
        selectedIp: selectedHost.ip,
      });

      expect(nodes.length).toBe(2);
      expect(nodes[0]!.nodeKind).toBe("endpoint");
      expect(nodes[0]!.endpointIps).toContain(selectedHost.ip);
      expect(nodes[0]!.totalBytes).toBe(5);

      expect(nodes[1]!.nodeKind).toBe("otherResolvedAggregate");
      expect(nodes[1]!.totalBytes).toBe(totalBytes - 5);
      expect(nodes[1]!.memberCount).toBe(9);
      expect(nodes[1]!.endpointIps).not.toContain(selectedHost.ip);
    });

    it("preserves strict determinism when host list with active selection is shuffled", () => {
      const hosts = generateIsolatedHosts(150);
      const selectedHost = hosts[145]!;
      selectedHost.bytes = 2;

      const shuffled1 = [...hosts].sort(() => Math.cos(2));
      const shuffled2 = [...hosts].reverse();

      const res1 = buildSpatialClusters(shuffled1, {
        maxNodes: 80,
        distanceThreshold: 1,
        selectedIp: selectedHost.ip,
      });
      const res2 = buildSpatialClusters(shuffled2, {
        maxNodes: 80,
        distanceThreshold: 1,
        selectedIp: selectedHost.ip,
      });

      expect(res1.length).toBe(80);
      expect(res2.length).toBe(80);

      for (let i = 0; i < 80; i++) {
        expect(res1[i]!.id).toBe(res2[i]!.id);
        expect(res1[i]!.totalBytes).toBe(res2[i]!.totalBytes);
        expect(res1[i]!.endpointIps).toEqual(res2[i]!.endpointIps);
      }
    });
  });

  describe("Semantic Identity & Resolution Classification Partition (Adversarial Suite)", () => {
    function createCustomHost(
      ip: string,
      lat: number,
      lng: number,
      bytes = 1000,
      flows = 1,
      geoProps: Record<string, any> = {}
    ): EnrichedHost {
      return {
        ip,
        classification: {
          ip,
          normalizedIp: ip,
          version: 4,
          isPublic: true,
          isLocalLan: false,
          category: "public",
          categoryLabel: "Public IPv4",
          description: "Public IPv4 address",
        },
        geo: {
          status: "resolved",
          precision: "city",
          distribution: "unicast",
          mapEligible: true,
          source: "local_database",
          country: "Germany",
          countryCode: "DE",
          city: "Frankfurt",
          latitude: lat,
          longitude: lng,
          accuracyRadiusKm: 10,
          confidence: "high",
          locationMeaning: "geoIpLocation",
          locationLevel: "city",
          precisionDescription: "city-level estimate",
          geoDatabaseVersion: "test-v1",
          explanation: "Resolved test host",
          ...geoProps,
        } as GeoResolution,
        asn: {
          status: "resolved",
          asn: 13335,
          asOrg: "Cloudflare",
          asName: "CLOUDFLARENET",
          source: "local_database",
          asnDatabaseVersion: "test-v1",
        },
        anycast: {
          isAnycast: false,
          provider: null,
          service: null,
          prefixCidr: null,
          source: "test",
        },
        hostnames: [],
        row: {
          label: ip,
          bytes,
          flows,
          hostnames: [],
          evidence: [],
        },
        bytes,
        deltaBytes: 0,
        flows,
        evidence: [],
        freshness: "active",
        lastSeenTs: 1_700_000_000_000,
      };
    }

    it("1. City Aggregate: 3 hosts in same city with authoritative city resolution -> cityAggregate", () => {
      const h1 = createCustomHost("1.1.1.1", 50.1109, 8.6821, 1000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.1115, 8.6825, 2000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h3 = createCustomHost("1.1.1.3", 50.1102, 8.6818, 3000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1, h2, h3], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cityAggregate");
      expect(c.entityId).toBe("entity-city-de-frankfurt");
      expect(c.memberCount).toBe(3);
      expect(c.totalBytes).toBe(6000);
      expect(c.id).toBe(makeAggregateRenderNodeId(c.geoCellId, 10));
    });

    it("2. City Diacritic & Whitespace Slug Normalization: München variants collapse to munchen", () => {
      const h1 = createCustomHost("1.1.1.1", 48.1351, 11.5820, 1000, 1, { city: "  München  ", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 48.1355, 11.5825, 2000, 1, { city: "---MÜNCHEN---", countryCode: "DE", locationLevel: "city" });

      expect(makeCanonicalCityKey("  São   Paulo  ")).toBe("sao-paulo");
      expect(makeCanonicalCityKey("---München---")).toBe("munchen");

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cityAggregate");
      expect(c.entityId).toBe("entity-city-de-munchen");
    });

    it("3. Country Code Casing Normalization: DE and de collapse to DE", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 1000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.12, 8.67, 1000, 1, { city: "Frankfurt", countryCode: "de", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cityAggregate");
      expect(c.entityId).toBe("entity-city-de-frankfurt");
      expect(c.countryCode).toBe("DE");
    });

    it("4. Mixed City/Country Resolution: Frankfurt city + DE country -> cluster (spatial aggregate)", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 1000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.12, 8.67, 1000, 1, { city: null, country: "Germany", countryCode: "DE", locationLevel: "country" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cluster");
      expect(c.entityId).toBe(makeClusterEntityId(c.geoCellId));
    });

    it("5. Same City Name, Different Countries: US Springfield + CA Springfield -> cluster", () => {
      const h1 = createCustomHost("1.1.1.1", 44.05, -123.01, 1000, 1, { city: "Springfield", countryCode: "US", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 44.06, -123.02, 1000, 1, { city: "Springfield", countryCode: "CA", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cluster");
      expect(c.entityId).toBe(makeClusterEntityId(c.geoCellId));
    });

    it("6. Same Country, Different Cities: Frankfurt + Offenbach -> cluster", () => {
      const h1 = createCustomHost("1.1.1.1", 50.1109, 8.6821, 1000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.1000, 8.7600, 1000, 1, { city: "Offenbach", countryCode: "DE", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cluster");
      expect(c.entityId).toBe(makeClusterEntityId(c.geoCellId));
    });

    it("7. Country Aggregate: 2 hosts with authoritative country-level resolution -> countryAggregate", () => {
      const h1 = createCustomHost("1.1.1.1", -16.0, 179.9, 1000, 1, { country: "Fiji", countryCode: "FJ", city: null, locationLevel: "country" });
      const h2 = createCustomHost("1.1.1.2", -16.0, -179.9, 1000, 1, { country: "Fiji", countryCode: "FJ", city: null, locationLevel: "country" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("countryAggregate");
      expect(c.entityId).toBe("entity-country-fj");
      expect(c.countryCode).toBe("FJ");
    });

    it("8. Mixed Country + City: FJ country + FJ Suva city -> cluster", () => {
      const h1 = createCustomHost("1.1.1.1", -18.14, 178.44, 1000, 1, { country: "Fiji", countryCode: "FJ", city: null, locationLevel: "country" });
      const h2 = createCustomHost("1.1.1.2", -18.14, 178.43, 1000, 1, { country: "Fiji", countryCode: "FJ", city: "Suva", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1, h2], { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("cluster");
      expect(c.entityId).toBe(makeClusterEntityId(c.geoCellId));
    });

    it("9. Single Endpoint: 1 host with city resolution -> endpoint nodeKind and entityId", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 5000, 1, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });

      const clusters = buildSpatialClusters([h1], { zoomScale: 1.0 });

      expect(clusters.length).toBe(1);
      const c = clusters[0]!;
      expect(c.nodeKind).toBe("endpoint");
      expect(c.entityId).toBe(makeHostEntityId(h1.ip));
      expect(c.id).toBe(makeEndpointRenderNodeId(h1.ip));
    });

    it("10. Host Selection while Clustered: Selected host inside cluster node remains kind: endpoint", () => {
      const rows: BreakdownRow[] = [
        {
          label: "1.1.1.1",
          bytes: 1000,
          flows: 1,
          hostnames: [{ name: "host-one", source: "dns" }],
          evidence: [],
        },
        {
          label: "8.8.8.8",
          bytes: 2000,
          flows: 2,
          hostnames: [{ name: "host-two", source: "dns" }],
          evidence: [],
        },
      ];

      const viewModel = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s1", snapshotSequence: 1 },
        null,
        { selectedEntityId: "entity-host-1.1.1.1", clusterRadiusPx: 50, zoomScale: 1.0 }
      );

      expect(viewModel.activeSelection).not.toBeNull();
      expect(viewModel.activeSelection?.status).toBe("active");
      expect(viewModel.activeSelection?.entityId).toBe("entity-host-1.1.1.1");
      expect(viewModel.activeSelection?.selectedEntity.kind).toBe("endpoint");
      if (viewModel.activeSelection?.selectedEntity.kind === "endpoint") {
        expect(viewModel.activeSelection.selectedEntity.ip).toBe("1.1.1.1");
        expect(viewModel.activeSelection.selectedEntity.host).toBeDefined();
      }
    });

    it("11. Aggregate Selection Across Zoom: Semantic identity survives zoom changes", () => {
      const rows: BreakdownRow[] = [
        {
          label: "1.1.1.1",
          bytes: 1000,
          flows: 1,
          hostnames: [{ name: "host-one", source: "dns" }],
          evidence: [],
        },
        {
          label: "8.8.8.8",
          bytes: 2000,
          flows: 2,
          hostnames: [{ name: "host-two", source: "dns" }],
          evidence: [],
        },
      ];

      // Step 1: Initial view at zoom = 1.0
      const vm1 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s1", snapshotSequence: 1 },
        null,
        { selectedEntityId: "entity-host-1.1.1.1", zoomScale: 1.0 }
      );
      expect(vm1.activeSelection?.entityId).toBe("entity-host-1.1.1.1");

      // Step 2: Zoom in to 100.0 (unpacked)
      const vm2 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s1", snapshotSequence: 1 },
        vm1,
        { selectedEntityId: "entity-host-1.1.1.1", zoomScale: 100.0 }
      );
      expect(vm2.activeSelection?.entityId).toBe("entity-host-1.1.1.1");
      expect(vm2.activeSelection?.selectedEntity.kind).toBe("endpoint");

      // Step 3: Zoom back out to 1.0 (repacked)
      const vm3 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s1", snapshotSequence: 1 },
        vm2,
        { selectedEntityId: "entity-host-1.1.1.1", zoomScale: 1.0 }
      );
      expect(vm3.activeSelection?.entityId).toBe("entity-host-1.1.1.1");
      expect(vm3.activeSelection?.selectedEntity.kind).toBe("endpoint");
    });

    it("12. Aggregate Tombstone Transition: Selected cityAggregate transitions to cityAggregate tombstone when hosts disappear", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 5000, 5, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.12, 8.67, 4000, 4, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });

      const snapshot1 = {
        captureSessionId: "s1",
        snapshotSequence: 1,
        enrichedHosts: [h1, h2],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 9000,
          resolvedBytes: 9000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      // Derive initial view with active cityAggregate selection
      const vm1 = deriveClusteredMapModel(asSnapshot(snapshot1), null, {
        selectedEntityId: "entity-city-de-frankfurt",
      });

      expect(vm1.activeSelection?.status).toBe("active");
      expect(vm1.activeSelection?.selectedEntity.kind).toBe("cityAggregate");

      // Transition to empty snapshot
      const snapshot2 = {
        captureSessionId: "s1",
        snapshotSequence: 2,
        enrichedHosts: [],
        hostsById: new Map(),
        coverageStats: {
          totalObservedHosts: 0,
          publicHostsCount: 0,
          resolvedHostsCount: 0,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 0,
          resolvedBytes: 0,
          unresolvedBytes: 0,
          coveragePercent: 0,
          resolvedBytesPercent: 0,
        },
      };

      const vm2 = deriveClusteredMapModel(asSnapshot(snapshot2), vm1, {
        selectedEntityId: "entity-city-de-frankfurt",
      });

      expect(vm2.activeSelection?.status).toBe("tombstone");
      expect(vm2.activeSelection?.entityId).toBe("entity-city-de-frankfurt");
      expect(vm2.activeSelection?.selectedEntity.kind).toBe("cityAggregate");
      if (vm2.activeSelection?.selectedEntity.kind === "cityAggregate") {
        expect(vm2.activeSelection.selectedEntity.tombstone?.isInactive).toBe(true);
        expect(vm2.activeSelection.selectedEntity.cityName).toBe("Frankfurt");
      }
    });

    it("12b. Aggregate Tombstone Persistence: switching between multiple dead aggregates and endpoints across frames without dropping tombstone state", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 5000, 5, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.12, 8.67, 4000, 4, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h3 = createCustomHost("2.2.2.1", 35.67, 139.65, 7000, 7, { city: "Tokyo", countryCode: "JP", locationLevel: "city" });

      const snapshot1 = {
        captureSessionId: "s-multi-agg",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
        enrichedHosts: [h1, h2, h3],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2], ["2.2.2.1", h3]]),
        coverageStats: {
          totalObservedHosts: 3,
          publicHostsCount: 3,
          resolvedHostsCount: 3,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 16000,
          resolvedBytes: 16000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      const vm1 = deriveClusteredMapModel(asSnapshot(snapshot1), null, {
        selectedEntityId: "entity-city-de-frankfurt",
      });
      expect(vm1.activeSelection?.status).toBe("active");

      // Snapshot 2: all hosts disappear
      const snapshot2 = {
        captureSessionId: "s-multi-agg",
        snapshotSequence: 2,
        snapshotTimestamp: 2000,
        enrichedHosts: [],
        hostsById: new Map(),
        coverageStats: {
          totalObservedHosts: 0,
          publicHostsCount: 0,
          resolvedHostsCount: 0,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 0,
          resolvedBytes: 0,
          unresolvedBytes: 0,
          coveragePercent: 0,
          resolvedBytesPercent: 0,
        },
      };

      // Select Frankfurt tombstone
      const vm2 = deriveClusteredMapModel(asSnapshot(snapshot2), vm1, {
        selectedEntityId: "entity-city-de-frankfurt",
      });
      expect(vm2.activeSelection?.status).toBe("tombstone");
      expect(vm2.activeSelection?.entityId).toBe("entity-city-de-frankfurt");
      expect(vm2.activeSelection?.tombstoneDetails?.lastObservedBytes).toBe(9000);

      // Select Tokyo host 2.2.2.1 tombstone
      const vm3 = deriveClusteredMapModel(asSnapshot(snapshot2), vm2, {
        selectedEntityId: "entity-host-2.2.2.1",
      });
      expect(vm3.activeSelection?.status).toBe("tombstone");
      expect(vm3.activeSelection?.entityId).toBe("entity-host-2.2.2.1");
      expect(vm3.activeSelection?.tombstoneDetails?.lastObservedBytes).toBe(7000);

      // Select Frankfurt tombstone again
      const vm4 = deriveClusteredMapModel(asSnapshot(snapshot2), vm3, {
        selectedEntityId: "entity-city-de-frankfurt",
      });
      expect(vm4.activeSelection?.status).toBe("tombstone");
      expect(vm4.activeSelection?.entityId).toBe("entity-city-de-frankfurt");
      expect(vm4.activeSelection?.tombstoneDetails?.lastObservedBytes).toBe(9000);
      expect(vm4.activeSelection?.tombstoneDetails?.lastObservedTs).toBe(1000);
    });

    it("12c. Cluster Aggregate Tombstone Transition: Selected spatial cluster transitions to cluster tombstone with preserved geoCellId and label", () => {
      // Create hosts in generic spatial cluster (different cities in same cell)
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 3000, 3, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 50.12, 8.67, 2000, 2, { city: "Offenbach", countryCode: "DE", locationLevel: "city" });

      const snapshot1 = {
        captureSessionId: "s-cluster",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
        enrichedHosts: [h1, h2],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 5000,
          resolvedBytes: 5000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      const vm1 = deriveClusteredMapModel(asSnapshot(snapshot1), null);
      const clusterNode = vm1.aggregateNodes[0]!;
      expect(clusterNode.nodeKind).toBe("cluster");
      const clusterEntityId = clusterNode.entityId;

      // Select cluster while live
      const vm1Sel = deriveClusteredMapModel(asSnapshot(snapshot1), null, {
        selectedEntityId: clusterEntityId,
      });
      expect(vm1Sel.activeSelection?.status).toBe("active");
      expect(vm1Sel.activeSelection?.selectedEntity.kind).toBe("cluster");

      // Transition to empty snapshot
      const snapshot2 = {
        captureSessionId: "s-cluster",
        snapshotSequence: 2,
        snapshotTimestamp: 2000,
        enrichedHosts: [],
        hostsById: new Map(),
        coverageStats: {
          totalObservedHosts: 0,
          publicHostsCount: 0,
          resolvedHostsCount: 0,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 0,
          resolvedBytes: 0,
          unresolvedBytes: 0,
          coveragePercent: 0,
          resolvedBytesPercent: 0,
        },
      };

      const vm2 = deriveClusteredMapModel(asSnapshot(snapshot2), vm1Sel, {
        selectedEntityId: clusterEntityId,
      });
      expect(vm2.activeSelection?.status).toBe("tombstone");
      expect(vm2.activeSelection?.entityId).toBe(clusterEntityId);
      expect(vm2.activeSelection?.selectedEntity.kind).toBe("cluster");
      if (vm2.activeSelection?.selectedEntity.kind === "cluster") {
        expect(vm2.activeSelection.selectedEntity.tombstone?.isInactive).toBe(true);
        expect(vm2.activeSelection.selectedEntity.tombstone?.lastObservedBytes).toBe(5000);
        expect(vm2.activeSelection.selectedEntity.tombstone?.lastObservedTs).toBe(1000);
      }
    });

    it("12d. Cluster-Radius and Merge Decoupling: Spatial cluster merging under distance threshold changes does NOT create tombstone", () => {
      const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 3000, 3, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 48.13, 11.58, 2000, 2, { city: "Munich", countryCode: "DE", locationLevel: "city" });

      const snapshot1 = {
        captureSessionId: "s-radius",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
        enrichedHosts: [h1, h2],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 5000,
          resolvedBytes: 5000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      // Small cluster radius: 2 discrete nodes
      const vm1 = deriveClusteredMapModel(asSnapshot(snapshot1), null, {
        clusterRadiusPx: 2,
      });
      expect(vm1.aggregateNodes.length).toBe(2);

      // Large cluster radius: merged into 1 cluster
      const vm2 = deriveClusteredMapModel(asSnapshot(snapshot1), vm1, {
        clusterRadiusPx: 100,
      });
      expect(vm2.aggregateNodes.length).toBe(1);

      // Must NOT create tombstones for the previous discrete nodes because hosts are still live
      expect(vm2.tombstones.size).toBe(0);
    });

    it("12e. Selection Recovery of Live Aggregate when Render Node is Compressed or Merged", () => {
      const h1 = createCustomHost("1.1.1.1", 51.51, -0.12, 5000, 5, { city: "London", countryCode: "GB", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 51.52, -0.11, 4000, 4, { city: "London", countryCode: "GB", locationLevel: "city" });

      const snapshot1 = {
        captureSessionId: "s-recov",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
        enrichedHosts: [h1, h2],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 9000,
          resolvedBytes: 9000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      // Frame 1: London rendered as cityAggregate
      const vm1 = deriveClusteredMapModel(asSnapshot(snapshot1), null, {
        selectedEntityId: "entity-city-gb-london",
      });
      expect(vm1.activeSelection?.status).toBe("active");
      expect(vm1.activeSelection?.selectedEntity.kind).toBe("cityAggregate");

      // Frame 2: Budget restricted to 1 node -> rolled into Other Resolved
      const vm2 = deriveClusteredMapModel(asSnapshot(snapshot1), vm1, {
        maxVisibleNodes: 1,
        selectedEntityId: "entity-city-gb-london",
      });

      // Selection must remain ACTIVE with full London metadata, not (Inactive)
      expect(vm2.activeSelection?.status).toBe("active");
      expect(vm2.activeSelection?.entityId).toBe("entity-city-gb-london");
      expect(vm2.activeSelection?.selectedEntity.kind).toBe("cityAggregate");
      if (vm2.activeSelection?.selectedEntity.kind === "cityAggregate") {
        expect(vm2.activeSelection.selectedEntity.cityName).toBe("London");
        expect(vm2.activeSelection.selectedEntity.memberCount).toBe(2);
      }
      expect(vm2.tombstones.has("entity-city-gb-london")).toBe(false);
    });

    it("12f. Genuine Cessation and Resurrection for Aggregates: Tombstone is created only upon true telemetry cessation and removed upon resurrection", () => {
      const h1 = createCustomHost("1.1.1.1", 51.51, -0.12, 5000, 5, { city: "London", countryCode: "GB", locationLevel: "city" });
      const h2 = createCustomHost("1.1.1.2", 51.52, -0.11, 4000, 4, { city: "London", countryCode: "GB", locationLevel: "city" });

      const snapshotLive = {
        captureSessionId: "s-res-agg",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
        enrichedHosts: [h1, h2],
        hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 9000,
          resolvedBytes: 9000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      const vm1 = deriveClusteredMapModel(asSnapshot(snapshotLive), null, {
        selectedEntityId: "entity-city-gb-london",
      });
      expect(vm1.activeSelection?.status).toBe("active");
      expect(vm1.activeSelection?.selectedEntity.kind).toBe("cityAggregate");

      // Snapshot 2: Host ceases telemetry
      const snapshotDead = {
        captureSessionId: "s-res-agg",
        snapshotSequence: 2,
        snapshotTimestamp: 2000,
        enrichedHosts: [],
        hostsById: new Map(),
        coverageStats: {
          totalObservedHosts: 0,
          publicHostsCount: 0,
          resolvedHostsCount: 0,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 0,
          resolvedBytes: 0,
          unresolvedBytes: 0,
          coveragePercent: 0,
          resolvedBytesPercent: 0,
        },
      };

      const vm2 = deriveClusteredMapModel(asSnapshot(snapshotDead), vm1, {
        selectedEntityId: "entity-city-gb-london",
      });
      expect(vm2.activeSelection?.status).toBe("tombstone");
      expect(vm2.tombstones.has("entity-city-gb-london")).toBe(true);

      // Snapshot 3: Host resurrects with new telemetry
      const h1Resurrected = createCustomHost("1.1.1.1", 51.51, -0.12, 12000, 12, { city: "London", countryCode: "GB", locationLevel: "city" });
      const h2Resurrected = createCustomHost("1.1.1.2", 51.52, -0.11, 8000, 8, { city: "London", countryCode: "GB", locationLevel: "city" });
      const snapshotResurrected = {
        captureSessionId: "s-res-agg",
        snapshotSequence: 3,
        snapshotTimestamp: 3000,
        enrichedHosts: [h1Resurrected, h2Resurrected],
        hostsById: new Map([["1.1.1.1", h1Resurrected], ["1.1.1.2", h2Resurrected]]),
        coverageStats: {
          totalObservedHosts: 2,
          publicHostsCount: 2,
          resolvedHostsCount: 2,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 20000,
          resolvedBytes: 20000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      const vm3 = deriveClusteredMapModel(asSnapshot(snapshotResurrected), vm2, {
        selectedEntityId: "entity-city-gb-london",
      });
      expect(vm3.activeSelection?.status).toBe("active");
      expect(vm3.tombstones.has("entity-city-gb-london")).toBe(false);
    });

    it("13. Four-Point 4D Traffic and Membership Conservation Validation", () => {
      // Create 40 distinct hosts across different cities and countries with randomized multi-dimensional metrics
      const hosts: EnrichedHost[] = [];
      let totalInputBytes = 0;
      let totalInputFlows = 0;
      let totalInputDeltaBytes = 0;
      const distinctInputIps = new Set<string>();

      for (let i = 0; i < 40; i++) {
        const ip = `198.51.100.${i + 1}`;
        const bytes = (i + 1) * 2500;
        const flows = (i % 5) + 1;
        const deltaBytes = (i % 3) * 500;
        const lat = -60 + (i * 3) % 120;
        const lng = -170 + (i * 9) % 340;
        const isCity = i % 2 === 0;

        totalInputBytes += bytes;
        totalInputFlows += flows;
        totalInputDeltaBytes += deltaBytes;
        distinctInputIps.add(ip);

        const customHost = createCustomHost(ip, lat, lng, bytes, flows, {
          country: i % 3 === 0 ? "United States" : "Germany",
          countryCode: i % 3 === 0 ? "US" : "DE",
          city: isCity ? (i % 3 === 0 ? "Dallas" : "Frankfurt") : null,
          locationLevel: isCity ? "city" : "country",
        });
        customHost.deltaBytes = deltaBytes;
        hosts.push(customHost);
      }

      // Constrain budget to maxNodes = 8 (triggers visible budget + overflow aggregate)
      const nodes = buildSpatialClusters(hosts, {
        maxNodes: 8,
        distanceThreshold: 10,
        zoomScale: 1.0,
      });

      expect(nodes.length).toBeLessThanOrEqual(8);

      // Point 1: 4D Multi-dimensional vector conservation (independent verification of each dimension)
      // Dimension 1: Bytes (100% conserved)
      const totalNodeBytes = nodes.reduce((sum, n) => sum + n.totalBytes, 0);
      expect(totalNodeBytes).toBe(totalInputBytes);

      // Dimension 2: Flows (100% conserved)
      const totalNodeFlows = nodes.reduce((sum, n) => sum + n.totalFlows, 0);
      expect(totalNodeFlows).toBe(totalInputFlows);

      // Dimension 3: Delta Bytes (100% conserved)
      const totalNodeDeltaBytes = nodes.reduce((sum, n) => sum + n.deltaBytes, 0);
      expect(totalNodeDeltaBytes).toBe(totalInputDeltaBytes);

      // Dimension 4: Endpoints / Member Cardinality (100% conserved)
      const totalNodeMembers = nodes.reduce((sum, n) => sum + (n.memberCount ?? 1), 0);
      expect(totalNodeMembers).toBe(distinctInputIps.size);

      // Point 2: Exact Set Equality for Endpoint Union & Zero Duplicates
      const visibleAndOverflowIps = nodes.flatMap((n) => n.endpointIps);
      const unionSet = new Set(visibleAndOverflowIps);

      // Distinct input IP set exactly matches the union of all visible & overflow endpoint IPs
      expect(unionSet).toEqual(distinctInputIps);

      // Zero cross-node duplicate IPs
      expect(visibleAndOverflowIps.length).toBe(distinctInputIps.size);

      // Zero intra-node duplicate IPs for every individual node
      for (const node of nodes) {
        expect(node.endpointIps.length).toBe(new Set(node.endpointIps).size);
        expect(node.endpointIps.length).toBe(node.memberCount);
      }

      // Point 3: Invariant F Dynamic Snapshot Member Set Exact Match
      const snapshot = {
        captureSessionId: "s-conservation",
        snapshotSequence: 1,
        enrichedHosts: hosts,
        hostsById: new Map(hosts.map((h) => [h.ip, h])),
        coverageStats: {
          totalObservedHosts: hosts.length,
          publicHostsCount: hosts.length,
          resolvedHostsCount: hosts.length,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: totalInputBytes,
          resolvedBytes: totalInputBytes,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      for (const node of nodes) {
        if (node.nodeKind !== "endpoint") {
          const vm = deriveClusteredMapModel(asSnapshot(snapshot), null, {
            selectedEntityId: node.entityId,
            maxVisibleNodes: 8,
          });
          if (
            vm.activeSelection &&
            vm.activeSelection.selectedEntity &&
            "memberHosts" in vm.activeSelection.selectedEntity &&
            "node" in vm.activeSelection.selectedEntity &&
            vm.activeSelection.selectedEntity.node
          ) {
            const memberIps = new Set(vm.activeSelection.selectedEntity.memberHosts.map((h) => h.ip));
            const renderedNodeIps = new Set(vm.activeSelection.selectedEntity.node.endpointIps);
            expect(memberIps).toEqual(renderedNodeIps);
            expect(vm.activeSelection.selectedEntity.node.endpointIps.length).toBe(renderedNodeIps.size);
          }
        }
      }

      // Point 4: Zero traffic silently discarded
      const otherResolvedNode = nodes.find((n) => n.nodeKind === "otherResolvedAggregate");
      expect(otherResolvedNode).toBeDefined();
      expect(otherResolvedNode?.entityId).toBe(OTHER_RESOLVED_ENTITY_ID);
    });

    function createResolvedHosts(
      count: number,
      lat: number,
      lng: number,
      countryCode: string,
      cityName: string,
      ipPrefix = "192.0.2"
    ): EnrichedHost[] {
      const hosts: EnrichedHost[] = [];
      for (let i = 0; i < count; i++) {
        const ip = `${ipPrefix}.${Math.floor(i / 250)}.${(i % 250) + 1}`;
        const row: BreakdownRow = {
          label: ip,
          bytes: (count - i) * 1000,
          flows: 2,
          hostnames: [{ name: `host-${i}.net`, source: "dns" }],
          evidence: [],
        };
        hosts.push({
          ip,
          row,
          classification: {
            ip,
            normalizedIp: ip,
            version: 4,
            category: "public",
            isPublic: true,
            isLocalLan: false,
            categoryLabel: "Public IPv4",
            description: "Public address",
          },
          geo: {
            status: "resolved",
            precision: "city",
            distribution: "unicast",
            mapEligible: true,
            latitude: lat,
            longitude: lng,
            country: countryCode,
            countryCode,
            city: cityName,
            accuracyRadiusKm: 25,
            confidence: "high",
            locationMeaning: "geoIpLocation",
            locationLevel: "city",
            precisionDescription: "city-level estimate",
            source: "local_database",
            geoDatabaseVersion: "test-v1",
            explanation: "Resolved test host",
          } as GeoResolution,
          asn: {
            status: "resolved",
            asn: 13335,
            asOrg: "Cloudflare",
            asName: null,
            source: "local_database",
            asnDatabaseVersion: "test-v1",
          },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: (count - i) * 1000,
          flows: 2,
          deltaBytes: 50,
          hostnames: [{ name: `host-${i}.net`, source: "dns" }],
          evidence: [],
          freshness: "active",
          lastSeenTs: 1_700_000_000_000,
        });
      }
      return hosts;
    }

    it("bounds sampleEndpointIps to 50 for large clusters (127 endpoints) while maintaining exact memberCount", () => {
      // 127 endpoints at identical coordinate
      const hosts = createResolvedHosts(127, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");

      const nodes = buildSpatialClusters(hosts, { distanceThreshold: 26, maxNodes: 120 });
      expect(nodes.length).toBe(1);

      const node = nodes[0]!;
      expect(node.memberCount).toBe(127);
      expect(node.sampleEndpointIps.length).toBe(50);
      expect(node.endpointIps.length).toBe(50);
      expect(node.endpointIps).toEqual(node.sampleEndpointIps);
      expect(new Set(node.sampleEndpointIps).size).toBe(50);

      // Verify selection view model derivation
      const snapshot = {
        captureSessionId: "s-127",
        snapshotSequence: 1,
        enrichedHosts: hosts,
        hostsById: new Map(hosts.map((h) => [h.ip, h])),
        coverageStats: {
          totalObservedHosts: 127,
          publicHostsCount: 127,
          resolvedHostsCount: 127,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 500_000,
          resolvedBytes: 500_000,
          unresolvedBytes: 0,
          coveragePercent: 100,
          resolvedBytesPercent: 100,
        },
      };

      const vm = deriveClusteredMapModel(asSnapshot(snapshot), null, {
        selectedEntityId: node.entityId,
      });

      expect(vm.activeSelection).toBeDefined();
      const sel = vm.activeSelection!.selectedEntity;
      expect("memberCount" in sel && sel.memberCount).toBe(127);
      expect("memberHosts" in sel && sel.memberHosts.length).toBe(50);
      expect("isSampled" in sel && sel.isSampled).toBe(true);
      expect("sampleEndpointIps" in sel && sel.sampleEndpointIps?.length).toBe(50);
    });

    it("verifies exact sample boundaries (49, 50, 51, 127) for memberCount, sampleEndpointIps, and isSampled", () => {
      // 1. 49 endpoints -> memberCount = 49, sampleEndpointIps = 49, isSampled = false
      const hosts49 = createResolvedHosts(49, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const nodes49 = buildSpatialClusters(hosts49, { maxNodes: 120 });
      expect(nodes49.length).toBe(1);
      expect(nodes49[0]!.memberCount).toBe(49);
      expect(nodes49[0]!.sampleEndpointIps.length).toBe(49);

      const snap49 = {
        captureSessionId: "s-49",
        snapshotSequence: 1,
        enrichedHosts: hosts49,
        hostsById: new Map(hosts49.map((h) => [h.ip, h])),
        coverageStats: {} as any,
      };
      const vm49 = deriveClusteredMapModel(snap49, null, { selectedEntityId: nodes49[0]!.entityId });
      const sel49 = vm49.activeSelection!.selectedEntity;
      expect("memberCount" in sel49 && sel49.memberCount).toBe(49);
      expect("memberHosts" in sel49 && sel49.memberHosts.length).toBe(49);
      expect("isSampled" in sel49 && sel49.isSampled).toBe(false);

      // 2. 50 endpoints -> memberCount = 50, sampleEndpointIps = 50, isSampled = false
      const hosts50 = createResolvedHosts(50, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const nodes50 = buildSpatialClusters(hosts50, { maxNodes: 120 });
      expect(nodes50.length).toBe(1);
      expect(nodes50[0]!.memberCount).toBe(50);
      expect(nodes50[0]!.sampleEndpointIps.length).toBe(50);

      const snap50 = {
        captureSessionId: "s-50",
        snapshotSequence: 1,
        enrichedHosts: hosts50,
        hostsById: new Map(hosts50.map((h) => [h.ip, h])),
        coverageStats: {} as any,
      };
      const vm50 = deriveClusteredMapModel(snap50, null, { selectedEntityId: nodes50[0]!.entityId });
      const sel50 = vm50.activeSelection!.selectedEntity;
      expect("memberCount" in sel50 && sel50.memberCount).toBe(50);
      expect("memberHosts" in sel50 && sel50.memberHosts.length).toBe(50);
      expect("isSampled" in sel50 && sel50.isSampled).toBe(false);

      // 3. 51 endpoints -> memberCount = 51, sampleEndpointIps = 50, isSampled = true
      const hosts51 = createResolvedHosts(51, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const nodes51 = buildSpatialClusters(hosts51, { maxNodes: 120 });
      expect(nodes51.length).toBe(1);
      expect(nodes51[0]!.memberCount).toBe(51);
      expect(nodes51[0]!.sampleEndpointIps.length).toBe(50);

      const snap51 = {
        captureSessionId: "s-51",
        snapshotSequence: 1,
        enrichedHosts: hosts51,
        hostsById: new Map(hosts51.map((h) => [h.ip, h])),
        coverageStats: {} as any,
      };
      const vm51 = deriveClusteredMapModel(snap51, null, { selectedEntityId: nodes51[0]!.entityId });
      const sel51 = vm51.activeSelection!.selectedEntity;
      expect("memberCount" in sel51 && sel51.memberCount).toBe(51);
      expect("memberHosts" in sel51 && sel51.memberHosts.length).toBe(50);
      expect("isSampled" in sel51 && sel51.isSampled).toBe(true);

      // 4. 127 endpoints -> memberCount = 127, sampleEndpointIps = 50, isSampled = true
      const hosts127 = createResolvedHosts(127, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const nodes127 = buildSpatialClusters(hosts127, { maxNodes: 120 });
      expect(nodes127.length).toBe(1);
      expect(nodes127[0]!.memberCount).toBe(127);
      expect(nodes127[0]!.sampleEndpointIps.length).toBe(50);

      const snap127 = {
        captureSessionId: "s-127",
        snapshotSequence: 1,
        enrichedHosts: hosts127,
        hostsById: new Map(hosts127.map((h) => [h.ip, h])),
        coverageStats: {} as any,
      };
      const vm127 = deriveClusteredMapModel(snap127, null, { selectedEntityId: nodes127[0]!.entityId });
      const sel127 = vm127.activeSelection!.selectedEntity;
      expect("memberCount" in sel127 && sel127.memberCount).toBe(127);
      expect("memberHosts" in sel127 && sel127.memberHosts.length).toBe(50);
      expect("isSampled" in sel127 && sel127.isSampled).toBe(true);
    });

    it("correctly derives isSampled = true when host-enrichment records are missing from hostsById", () => {
      // Node has 50 memberCount and 50 sampleEndpointIps, but only 47 resolve in hostsById
      const hosts50 = createResolvedHosts(50, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const nodes50 = buildSpatialClusters(hosts50, { maxNodes: 120 });
      expect(nodes50.length).toBe(1);
      expect(nodes50[0]!.memberCount).toBe(50);
      expect(nodes50[0]!.sampleEndpointIps.length).toBe(50);

      // Only 47 hosts present in the lookup map (3 missing)
      const incompleteHostsMap = new Map(hosts50.slice(0, 47).map((h) => [h.ip, h]));
      const snapshot = {
        captureSessionId: "s-missing-enrichment",
        snapshotSequence: 1,
        enrichedHosts: hosts50,
        hostsById: incompleteHostsMap,
        coverageStats: {} as any,
      };

      const vm = deriveClusteredMapModel(snapshot, null, { selectedEntityId: nodes50[0]!.entityId });
      expect(vm.activeSelection).toBeDefined();
      const sel = vm.activeSelection!.selectedEntity;
      expect("memberCount" in sel && sel.memberCount).toBe(50);
      expect("memberHosts" in sel && sel.memberHosts.length).toBe(47);
      // Invariant: isSampled === memberHosts.length < memberCount
      expect("isSampled" in sel && sel.isSampled).toBe(true);
    });

    it("deduplicates sampleEndpointIps while maintaining exact merged count when duplicate host IPs occur", () => {
      // 10 distinct hosts + 5 duplicate records of host-0
      const baseHosts = createResolvedHosts(10, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");
      const dupHosts = [
        ...baseHosts,
        { ...baseHosts[0]!, bytes: 500 },
        { ...baseHosts[0]!, bytes: 300 },
        { ...baseHosts[0]!, bytes: 200 },
      ];

      const nodes = buildSpatialClusters(dupHosts, { maxNodes: 120 });
      expect(nodes.length).toBe(1);
      const node = nodes[0]!;

      // memberCount tracks total merged host records (13)
      expect(node.memberCount).toBe(13);
      // sampleEndpointIps deduplicates unique IPs (10)
      expect(node.sampleEndpointIps.length).toBe(10);
      expect(new Set(node.sampleEndpointIps).size).toBe(10);
    });

    it("strictly conserves memberCount during secondary rollup into Other Resolved Aggregate without sample truncation drift", () => {
      // Cluster A: 127 endpoints in San Francisco (lat 37.77, lng -122.41)
      const hostsA = createResolvedHosts(127, 37.7749, -122.4194, "US", "San Francisco", "192.0.2");

      // Cluster B: 73 endpoints in Amsterdam (lat 52.37, lng 4.90)
      const hostsB = createResolvedHosts(73, 52.37, 4.9, "NL", "Amsterdam", "198.51.100");

      const allHosts = [...hostsA, ...hostsB];

      // Force secondary aggregation with maxNodes = 1
      const rolledUpNodes = buildSpatialClusters(allHosts, { maxNodes: 1 });
      expect(rolledUpNodes.length).toBe(1);

      const otherResolved = rolledUpNodes[0]!;
      expect(otherResolved.nodeKind).toBe("otherResolvedAggregate");
      expect(otherResolved.entityId).toBe(OTHER_RESOLVED_ENTITY_ID);

      // Invariant: Authoritative memberCount is 127 + 73 = 200, never 50 or 100
      expect(otherResolved.memberCount).toBe(200);

      // Invariant: Bounded sample is capped at 50 with all distinct IPs
      expect(otherResolved.sampleEndpointIps.length).toBe(50);
      expect(otherResolved.endpointIps.length).toBe(50);
      expect(new Set(otherResolved.sampleEndpointIps).size).toBe(50);
    });

    describe("Cluster Tombstones Decoupling & Semantic Hierarchy Audit Suite", () => {
      it("Zoom tier changes change render ID (e.g. cluster-geocell-z10 vs z50) without producing tombstones", () => {
        const h1 = createCustomHost("1.1.1.1", 37.77, -122.41, 10000, 10, { city: "San Francisco", countryCode: "US", locationLevel: "city" });
        const h2 = createCustomHost("1.1.1.2", 37.78, -122.42, 5000, 5, { city: "San Francisco", countryCode: "US", locationLevel: "city" });
        const snapshot = {
          captureSessionId: "s-zoom-audit",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [h1, h2],
          hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
          coverageStats: {} as any,
        };

        const vm1 = deriveClusteredMapModel(snapshot, null, { zoomScale: 1.0 });
        expect(vm1.aggregateNodes.length).toBe(1);
        const node1 = vm1.aggregateNodes[0]!;
        expect(node1.id).toBe(`cluster-${node1.geoCellId}-z10`);

        const vm2 = deriveClusteredMapModel(snapshot, vm1, { zoomScale: 5.0 });
        expect(vm2.aggregateNodes.length).toBe(1);
        const node2 = vm2.aggregateNodes[0]!;
        expect(node2.id).toBe(`cluster-${node2.geoCellId}-z50`);

        // No tombstones produced
        expect(vm2.tombstones.size).toBe(0);

        // Selection by previous render ID recovers active live selection
        const vmSelected = deriveClusteredMapModel(snapshot, vm2, {
          zoomScale: 5.0,
          selectedEntityId: node1.id,
        });
        expect(vmSelected.activeSelection?.status).toBe("active");
      });

      it("Threshold/radius changes merging or splitting clusters do not produce tombstones", () => {
        // Frankfurt (50.11, 8.68) and Munich (48.13, 11.58)
        const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 10000, 10, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
        const h2 = createCustomHost("1.1.1.2", 48.13, 11.58, 8000, 8, { city: "Munich", countryCode: "DE", locationLevel: "city" });
        const snapshot = {
          captureSessionId: "s-thresh-audit",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [h1, h2],
          hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
          coverageStats: {} as any,
        };

        const vmSplit = deriveClusteredMapModel(snapshot, null, { clusterRadiusPx: 2 });
        expect(vmSplit.aggregateNodes.length).toBe(2);

        const vmMerged = deriveClusteredMapModel(snapshot, vmSplit, { clusterRadiusPx: 100 });
        expect(vmMerged.aggregateNodes.length).toBe(1);
        expect(vmMerged.tombstones.size).toBe(0);

        const vmSplitAgain = deriveClusteredMapModel(snapshot, vmMerged, { clusterRadiusPx: 2 });
        expect(vmSplitAgain.aggregateNodes.length).toBe(2);
        expect(vmSplitAgain.tombstones.size).toBe(0);
      });

      it("Budget changes pushing nodes into Other Resolved aggregate do not produce tombstones and allow active selection recovery", () => {
        const h1 = createCustomHost("1.1.1.1", 37.77, -122.41, 10000, 10, { city: "SF", countryCode: "US", locationLevel: "city" });
        const h2 = createCustomHost("1.1.1.2", 51.50, -0.12, 8000, 8, { city: "London", countryCode: "GB", locationLevel: "city" });
        const h3 = createCustomHost("1.1.1.3", 51.51, -0.11, 7000, 7, { city: "London", countryCode: "GB", locationLevel: "city" });
        const snapshot = {
          captureSessionId: "s-budget-audit",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [h1, h2, h3],
          hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2], ["1.1.1.3", h3]]),
          coverageStats: {} as any,
        };

        const vmOpen = deriveClusteredMapModel(snapshot, null, { maxVisibleNodes: 10 });
        expect(vmOpen.aggregateNodes.length).toBe(2);

        const londonNode = vmOpen.aggregateNodes.find((n) => n.nodeKind === "cityAggregate")!;
        expect(londonNode).toBeDefined();

        const vmConstrained = deriveClusteredMapModel(snapshot, vmOpen, {
          maxVisibleNodes: 1,
          selectedEntityId: londonNode.entityId,
        });
        expect(vmConstrained.tombstones.size).toBe(0);
        expect(vmConstrained.activeSelection?.status).toBe("active");
        expect(vmConstrained.activeSelection?.selectedEntity.kind).toBe("cityAggregate");
      });

      it("Neighboring membership and cluster seed shift does not produce tombstones for previous seed geoCellId", () => {
        const hA = createCustomHost("1.1.1.1", 37.77, -122.41, 5000, 5, { city: "SF", countryCode: "US", locationLevel: "city" });
        const hB = createCustomHost("1.1.1.2", 37.78, -122.42, 3000, 3, { city: "SF", countryCode: "US", locationLevel: "city" });

        // Frame 1: hA has more bytes -> seed
        const snap1 = {
          captureSessionId: "s-seed-audit",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [hA, hB],
          hostsById: new Map([["1.1.1.1", hA], ["1.1.1.2", hB]]),
          coverageStats: {} as any,
        };
        const vm1 = deriveClusteredMapModel(snap1, null);
        const geoCellA = vm1.aggregateNodes[0]!.geoCellId;

        // Frame 2: hB traffic spikes to 20000 -> hB becomes seed
        const hBSpike = { ...hB, bytes: 20000 };
        const snap2 = {
          captureSessionId: "s-seed-audit",
          snapshotSequence: 2,
          snapshotTimestamp: 2000,
          enrichedHosts: [hA, hBSpike],
          hostsById: new Map([["1.1.1.1", hA], ["1.1.1.2", hBSpike]]),
          coverageStats: {} as any,
        };
        const vm2 = deriveClusteredMapModel(snap2, vm1);
        expect(vm2.tombstones.has(`entity-cluster-${geoCellA}`)).toBe(false);
        expect(vm2.tombstones.size).toBe(0);
      });

      it("Authoritative liveness: True cessation of all member hosts creates tombstone, and resurrection removes it", () => {
        const h1 = createCustomHost("10.0.0.1", 20.0, 30.0, 4000, 4);
        const snapLive = {
          captureSessionId: "s-cessation",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [h1],
          hostsById: new Map([["10.0.0.1", h1]]),
          coverageStats: {} as any,
        };

        const vmLive = deriveClusteredMapModel(snapLive, null);
        const clusterId = vmLive.aggregateNodes[0]!.entityId;

        // Telemetry stops
        const snapDead = {
          captureSessionId: "s-cessation",
          snapshotSequence: 2,
          snapshotTimestamp: 2000,
          enrichedHosts: [],
          hostsById: new Map(),
          coverageStats: {} as any,
        };
        const vmDead = deriveClusteredMapModel(snapDead, vmLive, { selectedEntityId: clusterId });
        expect(vmDead.tombstones.has(clusterId)).toBe(true);
        expect(vmDead.activeSelection?.status).toBe("tombstone");

        // Telemetry resumes
        const snapResurrected = {
          captureSessionId: "s-cessation",
          snapshotSequence: 3,
          snapshotTimestamp: 3000,
          enrichedHosts: [h1],
          hostsById: new Map([["10.0.0.1", h1]]),
          coverageStats: {} as any,
        };
        const vmRes = deriveClusteredMapModel(snapResurrected, vmDead, { selectedEntityId: clusterId });
        expect(vmRes.tombstones.has(clusterId)).toBe(false);
        expect(vmRes.activeSelection?.status).toBe("active");
      });

      it("Entity-ID completeness: resolves selection via entity-cluster-*, geocell-*, cluster-*, and aggregate-* aliases", () => {
        const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 5000, 5, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
        const h2 = createCustomHost("1.1.1.2", 50.10, 8.76, 3000, 3, { city: "Offenbach", countryCode: "DE", locationLevel: "city" });
        const snap = {
          captureSessionId: "s-aliases",
          snapshotSequence: 1,
          snapshotTimestamp: 1000,
          enrichedHosts: [h1, h2],
          hostsById: new Map([["1.1.1.1", h1], ["1.1.1.2", h2]]),
          coverageStats: {} as any,
        };
        const vm = deriveClusteredMapModel(snap, null);
        const node = vm.aggregateNodes[0]!;
        expect(node.nodeKind).toBe("cluster");
        const geoCell = node.geoCellId;

        const aliases = [
          `entity-cluster-${geoCell}`,
          geoCell,
          `cluster-${geoCell}`,
          `cluster-${geoCell}-z10`,
          `aggregate-${geoCell}-10`,
          node.id,
        ];

        for (const alias of aliases) {
          const vmSel = deriveClusteredMapModel(snap, null, { selectedEntityId: alias });
          expect(vmSel.activeSelection?.status).toBe("active");
          expect(vmSel.activeSelection?.selectedEntity.kind).toBe("cluster");
          if (vmSel.activeSelection?.selectedEntity.kind === "cluster") {
            expect(vmSel.activeSelection.selectedEntity.geoCellId).toBe(geoCell);
          }
        }
      });

      it("Regression Test: Selected endpoint ranked > 50 in dense cluster highlights via selectedMemberEntityId while preserving sample bounds", () => {
        // Construct 60 hosts in Frankfurt with descending bytes (rank 1 to 60)
        const hosts: EnrichedHost[] = [];
        for (let i = 1; i <= 60; i++) {
          const ip = `10.200.0.${i}`;
          // Byte volume strictly descending: host 1 has highest bytes, host 60 has lowest bytes
          const bytes = 100_000 - i * 100;
          hosts.push(
            createCustomHost(ip, 50.1109, 8.6821, bytes, 1, {
              city: "Frankfurt",
              countryCode: "DE",
              locationLevel: "city",
            })
          );
        }

        const lowestRankHost = hosts[59]!; // 60th host (bytes = 94,000)
        expect(lowestRankHost.ip).toBe("10.200.0.60");

        // Build spatial clusters with the 60th host selected
        const clusters = buildSpatialClusters(hosts, {
          selectedIp: lowestRankHost.ip,
          distanceThreshold: 50,
        });

        expect(clusters.length).toBe(1);
        const clusterNode = clusters[0]!;

        // Invariant 1: memberCount is exact (60)
        expect(clusterNode.memberCount).toBe(60);

        // Invariant 2: sampleEndpointIps is strictly bounded to 50
        expect(clusterNode.sampleEndpointIps.length).toBe(50);
        expect(clusterNode.sampleEndpointIps.length).toBeLessThanOrEqual(50);

        // Invariant 3: 60th host is NOT in sampleEndpointIps (because it was ranked #60)
        expect(clusterNode.sampleEndpointIps.includes(lowestRankHost.ip)).toBe(false);

        // Invariant 4: clusterNode carries selectedMemberEntityId for the selected endpoint
        expect(clusterNode.selectedMemberEntityId).toBe(`entity-host-${lowestRankHost.ip}`);

        // Invariant 5: isNodeSelected evaluates to TRUE for the containing cluster
        const selectedEntity: SelectedEntity = {
          kind: "endpoint",
          ip: lowestRankHost.ip,
          entityId: `entity-host-${lowestRankHost.ip}`,
          host: lowestRankHost,
        };
        expect(isNodeSelected(clusterNode, selectedEntity)).toBe(true);
        expect(isNodeSelected(clusterNode, null, `entity-host-${lowestRankHost.ip}`)).toBe(true);
        expect(isNodeSelected(clusterNode, null, lowestRankHost.ip)).toBe(true);

        // Selecting a non-member host returns false
        expect(isNodeSelected(clusterNode, { kind: "endpoint", ip: "192.168.1.99", entityId: "entity-host-192.168.1.99", host: lowestRankHost })).toBe(false);
      });

      it("Regression Test: Selection metadata follows the rendered aggregate (OtherResolved vs Visible Clusters)", () => {
        // Create 5 distinct clusters in different cities
        const h1 = createCustomHost("1.1.1.1", 50.11, 8.68, 50000, 5, { city: "Frankfurt", countryCode: "DE", locationLevel: "city" });
        const h2 = createCustomHost("2.2.2.2", 48.85, 2.35, 40000, 4, { city: "Paris", countryCode: "FR", locationLevel: "city" });
        const h3 = createCustomHost("3.3.3.3", 51.50, -0.12, 30000, 3, { city: "London", countryCode: "GB", locationLevel: "city" });
        const h4 = createCustomHost("4.4.4.4", 40.71, -74.00, 20000, 2, { city: "New York", countryCode: "US", locationLevel: "city" });
        const h5 = createCustomHost("5.5.5.5", 35.67, 139.65, 10000, 1, { city: "Tokyo", countryCode: "JP", locationLevel: "city" });

        // Case A: Selected host is in a high-traffic VISIBLE cluster (Frankfurt) with maxVisibleNodes = 2
        // Budget = 2 -> 1 visible slot for Frankfurt (highest bytes), 1 slot for Other Resolved (Paris, London, NY, Tokyo)
        const clustersA = buildSpatialClusters([h1, h2, h3, h4, h5], {
          maxNodes: 2,
          selectedIp: "1.1.1.1",
          distanceThreshold: 1,
        });

        expect(clustersA.length).toBe(2);
        const visibleNodeA = clustersA.find((n) => n.nodeKind !== "otherResolvedAggregate")!;
        const otherResolvedNodeA = clustersA.find((n) => n.nodeKind === "otherResolvedAggregate")!;

        // Frankfurt (visible) has selectedMemberEntityId
        expect(visibleNodeA.selectedMemberEntityId).toBe("entity-host-1.1.1.1");
        expect(isNodeSelected(visibleNodeA, { kind: "endpoint", ip: "1.1.1.1", entityId: "entity-host-1.1.1.1", host: h1 })).toBe(true);

        // OtherResolved does NOT inherit selectedMemberEntityId because 1.1.1.1 is in visibleNodeA
        expect(otherResolvedNodeA.selectedMemberEntityId).toBeUndefined();
        expect(isNodeSelected(otherResolvedNodeA, { kind: "endpoint", ip: "1.1.1.1", entityId: "entity-host-1.1.1.1", host: h1 })).toBe(false);

        // Case B: Selected host is in an OVERFLOW cluster (Tokyo) with maxVisibleNodes = 2
        // Budget = 2 (1 visible reserved for selected Tokyo, or if Tokyo overflows)
        const clustersB = buildSpatialClusters([h1, h2, h3, h4, h5], {
          maxNodes: 1, // maxNodes = 1: All clusters roll into Other Resolved
          selectedIp: "5.5.5.5",
          distanceThreshold: 1,
        });

        expect(clustersB.length).toBe(1);
        const otherResolvedNodeB = clustersB[0]!;
        expect(otherResolvedNodeB.nodeKind).toBe("otherResolvedAggregate");
        expect(otherResolvedNodeB.selectedMemberEntityId).toBe("entity-host-5.5.5.5");
        expect(isNodeSelected(otherResolvedNodeB, { kind: "endpoint", ip: "5.5.5.5", entityId: "entity-host-5.5.5.5", host: h5 })).toBe(true);
      });
    });
  });
});


