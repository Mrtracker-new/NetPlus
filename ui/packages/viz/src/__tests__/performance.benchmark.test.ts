import { describe, it, expect } from "vitest";
import { enrichHost, resolveGeo, resolveAsn, clearGeoCaches } from "../geo/geoDatabase";
import { buildSpatialClusters } from "../geo/spatialClustering";
import { computeLabelLayout } from "../geo/labelLayout";
import { calculateArcBezier } from "../geo/trafficArcs";
import { projectGeo } from "../geo/worldGeometry";
import type { BreakdownRow } from "@netpulse/contract";

function calculatePercentiles(latencies: number[]): { p50: number; p95: number; p99: number; max: number } {
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;
  return { p50, p95, p99, max };
}

describe("Performance & Scale Benchmark Suite", () => {
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

  it("benchmarks end-to-end visualization pipeline across 20, 100, 500, 1000, 5000, and 10000 hosts", () => {
    const densities = [20, 100, 500, 1000, 5000, 10000];
    const benchmarks: Record<number, { p50: number; p95: number; max: number; totalMs: number }> = {};

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
          evidence: [{ kind: "flow", id: i }],
        });
      }

      const runLatencies: number[] = [];
      const iterations = count <= 1000 ? 5 : 2;

      for (let iter = 0; iter < iterations; iter++) {
        const t0 = performance.now();

        // 1. Telemetry ingestion & offline GeoIP/ASN enrichment
        const enriched = mockRows.map((r) => enrichHost(r, 0));
        const resolved = enriched.filter((e) => e.geo.status === "resolved");

        // 2. Spatial proximity clustering
        const clusters = buildSpatialClusters(resolved, {
          zoomScale: 1.0,
          distanceThreshold: 26,
          maxNodes: 120,
        });

        // 3. Deterministic greedy collision-avoidance label layout
        const labelPlacements = computeLabelLayout(clusters, {
          maxLabels: 24,
          viewportWidth: 720,
          viewportHeight: 360,
        });

        // 4. Arc Bezier geometry calculation
        const [ox, oy] = projectGeo(37.7749, -122.4194);
        const arcs = clusters.slice(0, 48).map((n) => calculateArcBezier(ox, oy, n.x, n.y));

        const t1 = performance.now();
        runLatencies.push(t1 - t0);

        expect(clusters.length).toBeLessThanOrEqual(120);
        expect(labelPlacements.size).toBe(clusters.length);
        expect(arcs.length).toBeLessThanOrEqual(48);
      }

      const stats = calculatePercentiles(runLatencies);
      benchmarks[count] = {
        p50: stats.p50,
        p95: stats.p95,
        max: stats.max,
        totalMs: stats.p50,
      };

      // Performance budget assertions
      if (count === 1000) {
        expect(stats.p50).toBeLessThan(35.0); // 1,000 hosts in < 35ms
      }
      if (count === 10000) {
        expect(stats.p50).toBeLessThan(400.0); // 10,000 hosts in < 400ms
      }
    }
  });
});
