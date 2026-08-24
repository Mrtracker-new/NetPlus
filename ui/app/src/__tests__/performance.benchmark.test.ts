import { describe, it, expect } from "vitest";
import { resolveGeo, resolveAsn, clearGeoCaches } from "@netpulse/viz";
import {
  normalizeCoordinates,
  computeGeoCellId,
  buildSpatialClusters,
  angularDistanceLng,
  toroidalDistanceX,
  type EnrichedHost,
} from "@netpulse/viz";
import { deriveMapViewModel, type MapViewModelInput, type MapViewModel } from "@netpulse/viz";
import type { BreakdownRow } from "@netpulse/contract";

function calculatePercentiles(latencies: number[]): { p50: number; p95: number; p99: number; max: number } {
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;
  return { p50, p95, p99, max };
}

describe("Performance, Scale & Adversarial Benchmark Suite", () => {
  it("measures GeoIP / ASN resolution latency (cache miss & cache hit)", () => {
    clearGeoCaches();

    const sampleIps = [
      "1.1.1.1", "8.8.8.8", "9.9.9.9", "13.107.4.50", "17.253.144.10",
      "20.190.159.0", "31.13.72.36", "46.137.0.1", "52.95.110.1", "104.16.123.96",
      "142.250.190.46", "151.101.1.69", "173.223.162.139", "185.199.108.153", "193.0.0.1"
    ];

    // 1. Cache miss measurements
    const missLatencies: number[] = [];
    for (const ip of sampleIps) {
      const t0 = performance.now();
      resolveGeo(ip);
      resolveAsn(ip);
      const t1 = performance.now();
      missLatencies.push(t1 - t0);
    }
    const missStats = calculatePercentiles(missLatencies);
    expect(missStats.p95).toBeLessThan(25.0);

    // 2. Cache hit measurements (10,000 warm iterations)
    const hitLatencies: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const ip = sampleIps[i % sampleIps.length]!;
      const t0 = performance.now();
      resolveGeo(ip);
      resolveAsn(ip);
      const t1 = performance.now();
      hitLatencies.push(t1 - t0);
    }
    const hitStats = calculatePercentiles(hitLatencies);
    expect(hitStats.p99).toBeLessThan(0.1);
  });

  it("benchmarks end-to-end visualization pipeline across 1k, 5k, 10k, 25k, and 50k endpoints", () => {
    const densities = [1000, 5000, 10000, 25000, 50000];

    for (const count of densities) {
      const mockRows: BreakdownRow[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i % 200) + 1;
        const b = (i % 250);
        const c = ((i * 3) % 250);
        const d = (i % 254) + 1;
        mockRows.push({
          label: `${a}.${b}.${c}.${d}`,
          bytes: 1024 * (i + 1),
          flows: (i % 10) + 1,
          hostnames: i % 3 === 0 ? [{ name: `host-${i}.net`, source: "dns" }] : [],
          evidence: [],
        });
      }

      const t0 = performance.now();

      // Ingestion & pure view-model derivation
      const model = deriveMapViewModel(
        { hosts: mockRows, captureSessionId: "bench-session", snapshotSequence: 1 },
        null,
        { zoomScale: 1.0, maxVisibleNodes: 120, maxVisibleArcs: 48, maxVisibleLabels: 24 }
      );

      const t1 = performance.now();
      const elapsed = t1 - t0;

      expect(model.aggregateNodes.length).toBeLessThanOrEqual(120);
      expect(model.arcModels.length).toBeLessThanOrEqual(48);

      if (count === 1000) expect(elapsed).toBeLessThan(50.0);
      if (count === 10000) expect(elapsed).toBeLessThan(300.0);
      if (count === 50000) expect(elapsed).toBeLessThan(2000.0);
    }
  });

  describe("Pathological Spatial Distributions", () => {
    it("Single Cell Singularity: 10,000 endpoints at identical coordinate", () => {
      const rows: BreakdownRow[] = [];
      for (let i = 0; i < 10000; i++) {
        rows.push({
          label: `104.16.${Math.floor(i / 250)}.${(i % 250) + 1}`, // All in 104.16.0.0/12 (San Francisco)
          bytes: 1000,
          flows: 1,
          hostnames: [],
          evidence: [],
        });
      }

      const t0 = performance.now();
      const model = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { zoomScale: 1.0 }
      );
      const elapsed = performance.now() - t0;

      expect(model.aggregateNodes.length).toBe(1);
      expect(model.aggregateNodes[0]?.memberCount).toBe(10000);
      expect(elapsed).toBeLessThan(3500.0);
    });

    it("Dense Metro Clusters: 5,000 in Frankfurt, 5,000 in Tokyo", () => {
      const rows: BreakdownRow[] = [];
      // 5,000 Frankfurt (31.0.0.0/8)
      for (let i = 0; i < 5000; i++) {
        rows.push({
          label: `31.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
          bytes: 1000,
          flows: 1,
          hostnames: [],
          evidence: [],
        });
      }
      // 5,000 Amsterdam (46.0.0.0/8)
      for (let i = 0; i < 5000; i++) {
        rows.push({
          label: `46.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
          bytes: 1000,
          flows: 1,
          hostnames: [],
          evidence: [],
        });
      }

      const model = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { zoomScale: 1.0 }
      );
      expect(model.aggregateNodes.length).toBeGreaterThanOrEqual(1);
      expect(model.aggregateNodes.length).toBeLessThanOrEqual(120);
    });

    it("Antimeridian Seam Boundary: 5,000 endpoints at +179.9° and 5,000 endpoints at -179.9°", () => {
      const eastHosts: EnrichedHost[] = [];
      for (let i = 0; i < 5000; i++) {
        const ip = `192.0.2.${(i % 250) + 1}`;
        eastHosts.push({
          ip,
          row: { label: ip, bytes: 1000, flows: 1, hostnames: [], evidence: [] },
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
            latitude: -16.0,
            longitude: 179.9,
            country: "Fiji",
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
          bytes: 1000,
          deltaBytes: 0,
          flows: 1,
          evidence: [],
          freshness: "active",
          lastSeenTs: 1_700_000_000_000,
        });
      }

      const westHosts: EnrichedHost[] = [];
      for (let i = 0; i < 5000; i++) {
        const ip = `198.51.100.${(i % 250) + 1}`;
        westHosts.push({
          ip,
          row: { label: ip, bytes: 1000, flows: 1, hostnames: [], evidence: [] },
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
            latitude: -16.0,
            longitude: -179.9,
            country: "Fiji",
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
          bytes: 1000,
          deltaBytes: 0,
          flows: 1,
          evidence: [],
          freshness: "active",
          lastSeenTs: 1_700_000_000_000,
        });
      }

      // Control host at Greenwich (0.0° longitude)
      const greenwichIp = "203.0.113.1";
      const greenwichHost: EnrichedHost = {
        ip: greenwichIp,
        row: { label: greenwichIp, bytes: 2000, flows: 1, hostnames: [], evidence: [] },
        classification: {
          ip: greenwichIp,
          normalizedIp: greenwichIp,
          version: 4,
          category: "public",
          isPublic: true,
          isLocalLan: false,
          categoryLabel: "Public IPv4",
          description: "Public Internet address",
        },
        geo: {
          status: "resolved",
          latitude: 51.5,
          longitude: 0.0,
          country: "United Kingdom",
          countryCode: "GB",
          city: "London",
          accuracyRadiusKm: null,
          confidence: "medium",
          locationMeaning: "geoIpLocation",
          locationLevel: "city",
          precisionDescription: "city-level estimate",
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
        bytes: 2000,
        deltaBytes: 0,
        flows: 1,
        evidence: [],
        freshness: "active",
        lastSeenTs: 1_700_000_000_000,
      };

      const allHosts = [...eastHosts, ...westHosts, greenwichHost];

      const t0 = performance.now();
      const clusters = buildSpatialClusters(allHosts, {
        zoomScale: 1.0,
        distanceThreshold: 26,
        maxNodes: 120,
      });
      const elapsed = performance.now() - t0;

      // 1. Correctness: 10,000 seam endpoints merge into 1 cluster, Greenwich remains 1 endpoint -> exactly 2 nodes
      expect(clusters.length).toBe(2);

      const seamCluster = clusters.find((c) => c.memberCount === 10000);
      const controlNode = clusters.find((c) => c.memberCount === 1);

      expect(seamCluster).toBeDefined();
      expect(controlNode).toBeDefined();
      expect(seamCluster!.memberCount).toBe(10000);
      expect(controlNode!.memberCount).toBe(1);

      // Invariant: Total member count is conserved across all clusters
      const totalMembers = clusters.reduce((sum, c) => sum + (c.memberCount ?? 0), 0);
      expect(totalMembers).toBe(10001);

      expect(seamCluster!.nodeKind).toBe("countryAggregate");
      expect(controlNode!.nodeKind).toBe("endpoint");

      // 2. Seam Centroid Accuracy: within epsilon of ±180° (-180 canonical) and finite
      expect(Number.isFinite(seamCluster!.longitude)).toBe(true);
      expect(Number.isFinite(seamCluster!.latitude)).toBe(true);
      expect(Number.isFinite(seamCluster!.x)).toBe(true);
      expect(Number.isFinite(seamCluster!.y)).toBe(true);

      expect(angularDistanceLng(seamCluster!.longitude, 180)).toBeLessThanOrEqual(1e-4);
      expect(seamCluster!.longitude).toBeGreaterThanOrEqual(-180);
      expect(seamCluster!.longitude).toBeLessThan(180);
      expect(seamCluster!.latitude).toBeCloseTo(-16.0, 4);
      expect(toroidalDistanceX(seamCluster!.x, 0)).toBeLessThanOrEqual(1e-3);

      // 3. Control Isolation (no over-merging into Greenwich)
      expect(controlNode!.longitude).toBeCloseTo(0.0, 4);

      // 4. Performance: 10,001 hosts clustered within bounded real-time budget
      expect(elapsed).toBeLessThan(1000.0);
    });

    it("Invalid / Extreme Coordinates: NaNs, Infinities, and boundary clamps", () => {
      expect(normalizeCoordinates(NaN, 10)).toBeNull();
      expect(normalizeCoordinates(10, Infinity)).toBeNull();
      expect(normalizeCoordinates(100, 0)).toBeNull(); // Lat > 90
      expect(normalizeCoordinates(-100, 0)).toBeNull(); // Lat < -90

      // Canonical longitude normalization
      const norm1 = normalizeCoordinates(35, 180);
      expect(norm1?.lng).toBe(-180); // Canonical [-180, 180) interval

      const norm2 = normalizeCoordinates(35, 181);
      expect(norm2?.lng).toBeCloseTo(-179, 4);

      const cellKey = computeGeoCellId(35, 180);
      expect(cellKey).toBe("geocell-350_-1800");
    });
  });

  describe("Sustained Streaming & Allocation Stability", () => {
    it("simulates sustained streaming over 100 sequential telemetry snapshots without delta drift", () => {
      let previousModel: MapViewModel | null = null;

      const baseHosts: BreakdownRow[] = [];
      for (let i = 0; i < 500; i++) {
        baseHosts.push({
          label: `104.16.${Math.floor(i / 250)}.${(i % 250) + 1}`,
          bytes: 10000,
          flows: 5,
          hostnames: [],
          evidence: [],
        });
      }

      // Stream 100 snapshots
      for (let seq = 1; seq <= 100; seq++) {
        const currentRows: BreakdownRow[] = baseHosts.map((h, idx) => ({
          ...h,
          bytes: h.bytes + seq * (idx + 1) * 100,
          flows: h.flows + 1,
        }));

        const input: MapViewModelInput = {
          hosts: currentRows,
          captureSessionId: "stream-session-1",
          snapshotSequence: seq,
        };

        const model = deriveMapViewModel(input, previousModel, {
          selectedEntityId: "entity-host-104.16.0.1",
        });

        if (seq > 1) {
          // Verify positive, stable delta bytes
          const host1 = model.hostsById.get("104.16.0.1");
          expect(host1?.deltaBytes).toBe(100);
          expect(model.activeSelection?.isSelected).toBe(true);
        }

        previousModel = model;
      }
    });
  });
});
