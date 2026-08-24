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
  type EnrichedHost,
  type GeoResolution,
} from "../geo/geoTypes";
import { deriveMapViewModel, deriveClusteredMapModel } from "../geo/mapViewModel";
import { enrichHost, clearGeoCaches } from "../geo/geoDatabase";
import { projectGeo, MAP_WIDTH } from "../geo/worldGeometry";
import type { BreakdownRow } from "@netpulse/contract";

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
        },
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
        { label: "1.1.1.1", bytes: 1_000_000, flows: 10, hostnames: [{ name: "cloudflare-dns", source: "dns" }], evidence: [] },
        { label: "8.8.8.8", bytes: 500_000, flows: 5, hostnames: [{ name: "google-dns", source: "dns" }], evidence: [] },
        { label: "8.8.4.4", bytes: 200_000, flows: 2, hostnames: [{ name: "google-dns-secondary", source: "dns" }], evidence: [] },
      ];

      const enriched = hosts.map((h) => enrichHost(h, 0));
      const clusters = buildSpatialClusters(enriched, { zoomScale: 1.0, distanceThreshold: 26 });

      expect(clusters.length).toBe(1);
      expect(clusters[0]!.nodeKind).toBe("cluster");
      expect(clusters[0]!.memberCount).toBe(3);
      expect(clusters[0]!.totalBytes).toBe(1_700_000);
      expect(clusters[0]!.totalFlows).toBe(17);
      expect(clusters[0]!.endpointIps).toEqual(["1.1.1.1", "8.8.8.8", "8.8.4.4"]);
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
      expect(t1 - t0).toBeLessThan(75.0);
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

      // Invariant 10: Complete deduplicated union of endpoint IPs
      const allEmittedIps = new Set(nodes.flatMap((n) => n.endpointIps));
      expect(allEmittedIps.size).toBe(expectedUniqueIps.size);
      for (const ip of expectedUniqueIps) {
        expect(allEmittedIps.has(ip)).toBe(true);
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
          geo: { status: "resolved", latitude: 50.0, longitude: 10.0, country: "DE", countryCode: "DE", city: "Frankfurt", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1" },
          asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
        },
        {
          ip: "10.0.0.2",
          row: { label: "10.0.0.2", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
          classification: { ip: "10.0.0.2", normalizedIp: "10.0.0.2", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
          geo: { status: "resolved", latitude: -30.0, longitude: 20.0, country: "ZA", countryCode: "ZA", city: "Cape Town", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1" },
          asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
        },
        {
          ip: "10.0.0.3",
          row: { label: "10.0.0.3", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
          classification: { ip: "10.0.0.3", normalizedIp: "10.0.0.3", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
          geo: { status: "resolved", latitude: 35.0, longitude: 139.0, country: "JP", countryCode: "JP", city: "Tokyo", accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "city", precisionDescription: "city-level estimate", source: "local_database", geoDatabaseVersion: "v1" },
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

    it("throws RangeError for invalid maxNodes (< 1 or non-finite)", () => {
      const hosts = generateIsolatedHosts(5);

      expect(() => buildSpatialClusters(hosts, { maxNodes: 0 })).toThrow(RangeError);
      expect(() => buildSpatialClusters(hosts, { maxNodes: -10 })).toThrow(RangeError);
      expect(() => buildSpatialClusters(hosts, { maxNodes: NaN })).toThrow(RangeError);
      expect(() => buildSpatialClusters(hosts, { maxNodes: Infinity })).toThrow(RangeError);
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
        geo: { status: "resolved", latitude: 10.0, longitude: 179.5, country: "Fiji", countryCode: "FJ", city: null, accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "country", precisionDescription: "country-level estimate", source: "local_database", geoDatabaseVersion: "v1" },
        asn: { status: "unresolved", reason: "no_match", source: "none", asnDatabaseVersion: "v1" },
        anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
        bytes: 1000, flows: 1, deltaBytes: 0, hostnames: [], evidence: [], freshness: "active", lastSeenTs: 1_700_000_000_000,
      };
      const hostWest: EnrichedHost = {
        ip: "100.0.0.2",
        row: { label: "100.0.0.2", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
        classification: { ip: "100.0.0.2", normalizedIp: "100.0.0.2", version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public", description: "" },
        geo: { status: "resolved", latitude: 10.0, longitude: -179.5, country: "Samoa", countryCode: "WS", city: null, accuracyRadiusKm: null, confidence: "high", locationMeaning: "geoIpLocation", locationLevel: "country", precisionDescription: "country-level estimate", source: "local_database", geoDatabaseVersion: "v1" },
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

      const allEmittedIps = new Set(nodes.flatMap((n) => n.endpointIps));
      expect(allEmittedIps.size).toBe(hosts.length);
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
      geoProps: Partial<EnrichedHost["geo"]> = {}
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
      const vm1 = deriveClusteredMapModel(snapshot1, null, {
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

      const vm2 = deriveClusteredMapModel(snapshot2, vm1, {
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
          const vm = deriveClusteredMapModel(snapshot, null, {
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
  });
});


