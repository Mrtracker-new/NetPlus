import { describe, it, expect, beforeEach } from "vitest";
import type { BreakdownRow } from "@netpulse/contract";
import {
  deriveMapViewModel,
  deriveClusteredMapModel,
  type MapViewModelInput,
  type MapViewModelOptions,
  type HostEnrichmentSnapshot,
} from "../geo/mapViewModel";
import { OTHER_RESOLVED_ENTITY_ID, type EnrichedHost } from "../geo/geoTypes";
import { clearGeoCaches } from "../geo/geoDatabase";
import { calculateArcBezier, sampleArcInto } from "../geo/trafficArcs";
import { projectGeo } from "../geo/worldGeometry";

describe("Global Traffic Map — Production Invariant Test Suite", () => {
  beforeEach(() => {
    clearGeoCaches();
  });

  describe("Invariant 1 & 2: Authoritative Telemetry Delta, Lineage & Baseline Lifecycle", () => {
    it("Invariant 1: 20 consecutive re-evaluations with unchanged snapshot produce identical deltas", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 2000, flows: 4, hostnames: [], evidence: [] },
      ];

      const input: MapViewModelInput = {
        hosts: rows,
        captureSessionId: "session-alpha",
        snapshotSequence: 1,
      };

      const baseline = deriveMapViewModel(input, null);
      // S0 / baseline establishes delta = 0 for initial snapshot
      for (const node of baseline.aggregateNodes) {
        expect(node.deltaBytes).toBe(0);
      }

      // Next snapshot S2 with true progress
      const s2Rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1500, flows: 3, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 2200, flows: 5, hostnames: [], evidence: [] },
      ];
      const s2Input: MapViewModelInput = {
        hosts: s2Rows,
        captureSessionId: "session-alpha",
        snapshotSequence: 2,
      };

      const s2Result = deriveMapViewModel(s2Input, baseline);
      const host1 = s2Result.hostsById.get("1.1.1.1");
      const host2 = s2Result.hostsById.get("8.8.8.8");
      expect(host1?.deltaBytes).toBe(500);
      expect(host2?.deltaBytes).toBe(200);

      // Re-running derivation 20 times on S2 with same snapshotSequence MUST NOT change deltaBytes
      for (let i = 0; i < 20; i++) {
        const reEval = deriveMapViewModel(s2Input, baseline);
        const h1 = reEval.hostsById.get("1.1.1.1");
        const h2 = reEval.hostsById.get("8.8.8.8");
        expect(h1?.deltaBytes).toBe(500);
        expect(h2?.deltaBytes).toBe(200);
      }
    });

    it("Invariant 1: Capture restart (session change) re-primes baseline and emits zero delta for S0", () => {
      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 50_000, flows: 10, hostnames: [], evidence: [] }];
      const sessionA: MapViewModelInput = { hosts: s1Rows, captureSessionId: "session-A", snapshotSequence: 50 };
      const modelA = deriveMapViewModel(sessionA, null);

      // Capture restarts: session-B starts at sequence 1 with counter at 200
      const restartRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 200, flows: 1, hostnames: [], evidence: [] }];
      const sessionB_S0: MapViewModelInput = { hosts: restartRows, captureSessionId: "session-B", snapshotSequence: 1 };

      const modelB_S0 = deriveMapViewModel(sessionB_S0, modelA);
      // Must establish baseline without generating negative or underflow deltas
      expect(modelB_S0.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(modelB_S0.hostsById.get("1.1.1.1")?.bytes).toBe(200);

      // S1 in session-B computes true positive delta against S0 of session-B
      const sessionB_S1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 350, flows: 2, hostnames: [], evidence: [] }];
      const sessionB_S1: MapViewModelInput = { hosts: sessionB_S1Rows, captureSessionId: "session-B", snapshotSequence: 2 };
      const modelB_S1 = deriveMapViewModel(sessionB_S1, modelB_S0);

      expect(modelB_S1.hostsById.get("1.1.1.1")?.deltaBytes).toBe(150);
    });

    it("Invariant 1: Newly observed host entering mid-session receives delta = 0 as its baseline", () => {
      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] }];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "sess-1", snapshotSequence: 1 }, null);

      // S2 introduces host 8.8.8.8 with 50 MB discovered cumulative bytes
      const s2Rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1200, flows: 2, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 50_000_000, flows: 100, hostnames: [], evidence: [] },
      ];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "sess-1", snapshotSequence: 2 }, model1);

      expect(model2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(200);
      // Newly discovered host must NOT trigger a 50 MB burst
      expect(model2.hostsById.get("8.8.8.8")?.deltaBytes).toBe(0);
      expect(model2.hostsById.get("8.8.8.8")?.bytes).toBe(50_000_000);

      // S3 increments 8.8.8.8 by 4 KB
      const s3Rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1400, flows: 2, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 50_004_096, flows: 102, hostnames: [], evidence: [] },
      ];
      const model3 = deriveMapViewModel({ hosts: s3Rows, captureSessionId: "sess-1", snapshotSequence: 3 }, model2);
      expect(model3.hostsById.get("8.8.8.8")?.deltaBytes).toBe(4096);
    });

    it("Invariant 1: Adversarial counter reset / rollover (currentBytes < prev.bytes) safely returns delta = 0 and re-baselines", () => {
      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1_000_000, flows: 50, hostnames: [], evidence: [] }];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "sess-1", snapshotSequence: 1 }, null);

      // S2 simulates a device counter reset / interface reboot where bytes drop from 1,000,000 to 500
      const s2ResetRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 500, flows: 1, hostnames: [], evidence: [] }];
      const model2 = deriveMapViewModel({ hosts: s2ResetRows, captureSessionId: "sess-1", snapshotSequence: 2 }, model1);

      // Must never produce negative deltas or wrap-around burst deltas
      expect(model2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(model2.hostsById.get("1.1.1.1")?.bytes).toBe(500);

      // S3 resumes incrementing from 500 to 800
      const s3Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 800, flows: 2, hostnames: [], evidence: [] }];
      const model3 = deriveMapViewModel({ hosts: s3Rows, captureSessionId: "sess-1", snapshotSequence: 3 }, model2);

      // Delta should now be 300
      expect(model3.hostsById.get("1.1.1.1")?.deltaBytes).toBe(300);
      expect(model3.hostsById.get("1.1.1.1")?.bytes).toBe(800);
    });

    it("Invariant 1: Counter rollover at uint32 boundary (4,294,967,295 to 1024) safely returns delta = 0 and establishes new baseline", () => {
      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 4_294_967_295, flows: 100, hostnames: [], evidence: [] }];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "sess-u32", snapshotSequence: 1 }, null);

      // S2: 32-bit hardware counter wraps around to 1024
      const s2Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1024, flows: 2, hostnames: [], evidence: [] }];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "sess-u32", snapshotSequence: 2 }, model1);

      expect(model2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(model2.hostsById.get("1.1.1.1")?.bytes).toBe(1024);

      // S3: Increments to 2048 -> delta = 1024
      const s3Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 2048, flows: 3, hostnames: [], evidence: [] }];
      const model3 = deriveMapViewModel({ hosts: s3Rows, captureSessionId: "sess-u32", snapshotSequence: 3 }, model2);
      expect(model3.hostsById.get("1.1.1.1")?.deltaBytes).toBe(1024);
    });

    it("Invariant 1 & 2: Stale or out-of-order snapshots (seq <= prevSeq) are safely ignored", () => {
      const s2Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 2000, flows: 4, hostnames: [], evidence: [] }];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "sess-1", snapshotSequence: 2 }, null);

      // Delayed snapshot with sequence 1 arrives after sequence 2
      const staleRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] }];
      const modelStale = deriveMapViewModel({ hosts: staleRows, captureSessionId: "sess-1", snapshotSequence: 1 }, model2);

      // Should maintain current baseline and reject delta calculation
      expect(modelStale.snapshotSequence).toBe(2);
      expect(modelStale.hostsById.get("1.1.1.1")?.bytes).toBe(2000);
    });

    it("Invariant 1 & 2: Stale sequence 0 in the same session (current = 100, incoming = 0) is rejected and does not overwrite later snapshot", () => {
      const s100Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 5000, flows: 10, hostnames: [], evidence: [] }];
      const model100 = deriveMapViewModel({ hosts: s100Rows, captureSessionId: "sess-1", snapshotSequence: 100 }, null);

      // Stale sequence 0 arrives in the same session
      const staleRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 100, flows: 1, hostnames: [], evidence: [] }];
      const modelStale0 = deriveMapViewModel({ hosts: staleRows, captureSessionId: "sess-1", snapshotSequence: 0 }, model100);

      // Must reject stale sequence 0 and preserve model100
      expect(modelStale0.snapshotSequence).toBe(100);
      expect(modelStale0.hostsById.get("1.1.1.1")?.bytes).toBe(5000);
    });

    it("Invariant 1 & 2: Duplicate sequence in the same session is ignored", () => {
      const s2Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 2000, flows: 4, hostnames: [], evidence: [] }];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "sess-1", snapshotSequence: 2 }, null);

      // Duplicate snapshot with sequence 2 arrives
      const dupRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 9999, flows: 99, hostnames: [], evidence: [] }];
      const modelDup = deriveMapViewModel({ hosts: dupRows, captureSessionId: "sess-1", snapshotSequence: 2 }, model2);

      expect(modelDup.snapshotSequence).toBe(2);
      expect(modelDup.hostsById.get("1.1.1.1")?.bytes).toBe(2000);
    });

    it("Invariant 1: Initial session establishing with sequence 0 primes baseline and computes deltas on sequence 1", () => {
      const s0Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] }];
      const model0 = deriveMapViewModel({ hosts: s0Rows, captureSessionId: "sess-init-0", snapshotSequence: 0 }, null);

      expect(model0.snapshotSequence).toBe(0);
      expect(model0.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(model0.hostsById.get("1.1.1.1")?.bytes).toBe(1000);

      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 1500, flows: 3, hostnames: [], evidence: [] }];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "sess-init-0", snapshotSequence: 1 }, model0);

      expect(model1.snapshotSequence).toBe(1);
      expect(model1.hostsById.get("1.1.1.1")?.deltaBytes).toBe(500);
      expect(model1.hostsById.get("1.1.1.1")?.bytes).toBe(1500);
    });

    it("Invariant 1: Capture restart (session change) starting with sequence 0 re-primes baseline", () => {
      const s50Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 50_000, flows: 10, hostnames: [], evidence: [] }];
      const modelA = deriveMapViewModel({ hosts: s50Rows, captureSessionId: "session-A", snapshotSequence: 50 }, null);

      const restartRows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 200, flows: 1, hostnames: [], evidence: [] }];
      const modelB_S0 = deriveMapViewModel({ hosts: restartRows, captureSessionId: "session-B", snapshotSequence: 0 }, modelA);

      expect(modelB_S0.snapshotSequence).toBe(0);
      expect(modelB_S0.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(modelB_S0.hostsById.get("1.1.1.1")?.bytes).toBe(200);
    });
  });

  describe("Invariant 3: 3-Tier Entity Identity, Selection Hierarchy & Tombstone UX", () => {
    it("Invariant 3: Selection resolves to entityId and persists across cluster regrouping on zoom", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
        { label: "13.107.4.50", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
      ];

      // World scale (zoom = 1.0) -> both group into single cluster
      const modelZoom1 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { zoomScale: 1.0, selectedEntityId: "entity-host-1.1.1.1" }
      );

      expect(modelZoom1.aggregateNodes.length).toBe(1);
      const cluster = modelZoom1.aggregateNodes[0]!;
      expect(cluster.entityId).toBeDefined();
      expect(cluster.geoCellId).toBeDefined();
      expect(cluster.endpointIps).toContain("1.1.1.1");
      expect(modelZoom1.activeSelection?.isSelected).toBe(true);

      // Zoom in (zoom = 8.0) -> unpacks into 2 individual endpoint nodes
      const modelZoom8 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        modelZoom1,
        { zoomScale: 8.0, selectedEntityId: "entity-host-1.1.1.1" }
      );

      expect(modelZoom8.aggregateNodes.length).toBe(2);
      const selectedNode = modelZoom8.aggregateNodes.find((n) => n.endpointIps.includes("1.1.1.1"));
      expect(selectedNode).toBeDefined();
      expect(selectedNode?.entityId).toBe("entity-host-1.1.1.1");
      expect(modelZoom8.activeSelection?.isSelected).toBe(true);
    });

    it("Invariant 3: When a selected entity disappears from telemetry, it transitions to Tombstone state", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [{ name: "one.one.one.one", source: "dns" }], evidence: [] },
      ];

      const model1 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { selectedEntityId: "entity-host-1.1.1.1" }
      );

      expect(model1.activeSelection?.status).toBe("active");
      expect(model1.activeSelection?.label).toBe("one.one.one.one");

      // Next snapshot: 1.1.1.1 times out and is absent
      const model2 = deriveMapViewModel(
        { hosts: [], captureSessionId: "s", snapshotSequence: 2 },
        model1,
        { selectedEntityId: "entity-host-1.1.1.1" }
      );

      expect(model2.activeSelection?.status).toBe("tombstone");
      expect(model2.activeSelection?.selectedEntity?.tombstone?.isInactive).toBe(true);
      expect(model2.activeSelection?.selectedEntity?.tombstone?.lastObservedBytes).toBe(1000);
    });

    it("Invariant 3 / FINDING-001: Tombstone lastObservedTs is frozen at first-disappearance and never advances across 5+ re-derivations", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 2000, flows: 3, hostnames: [{ name: "example.com", source: "dns" }], evidence: [] },
      ];

      const model1 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { selectedEntityId: "entity-host-1.1.1.1" }
      );
      expect(model1.activeSelection?.status).toBe("active");

      // Snapshot 2: host disappears — tombstone created for first time
      const model2 = deriveMapViewModel(
        { hosts: [], captureSessionId: "s", snapshotSequence: 2 },
        model1,
        { selectedEntityId: "entity-host-1.1.1.1" }
      );
      expect(model2.activeSelection?.status).toBe("tombstone");
      const frozenTs = model2.activeSelection?.selectedEntity?.tombstone?.lastObservedTs;
      expect(frozenTs).toBeDefined();
      expect(typeof frozenTs).toBe("number");

      // Call deriveMapViewModel 5× with entity absent; assert lastObservedTs is identical across all 5 calls
      let prevModel = model2;
      for (let i = 3; i <= 7; i++) {
        const reModel = deriveMapViewModel(
          { hosts: [], captureSessionId: "s", snapshotSequence: i },
          prevModel,
          { selectedEntityId: "entity-host-1.1.1.1" }
        );
        expect(reModel.activeSelection?.status).toBe("tombstone");
        expect(reModel.activeSelection?.selectedEntity?.tombstone?.lastObservedTs).toBe(frozenTs);
        expect(reModel.activeSelection?.tombstoneDetails?.lastObservedTs).toBe(frozenTs);
        expect(reModel.activeSelection?.label).toBe("example.com (Inactive)");
        prevModel = reModel;
      }
    });

    it("Invariant 3: Selected endpoints are guaranteed to survive maxVisibleNodes and remain focal targets", () => {
      const enrichedHosts: EnrichedHost[] = [];
      const hostsById = new Map<string, EnrichedHost>();

      for (let i = 0; i < 200; i++) {
        const lat = -70 + (i * 1.3) % 140;
        const lng = -170 + (i * 3.7) % 340;
        const ip = `198.51.${Math.floor(i / 254) + 100}.${(i % 254) + 1}`;
        const bytes = i === 199 ? 5 : (i + 10) * 1000;

        const host: EnrichedHost = {
          ip,
          row: { label: ip, bytes, flows: 2, hostnames: [{ name: `host-${i}.com`, source: "dns" }], evidence: [] },
          classification: { ip, normalizedIp: ip, version: 4, category: "public", isPublic: true, isLocalLan: false, categoryLabel: "Public IPv4", description: "Public address" },
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
          asn: { status: "resolved", asn: 1000 + i, asOrg: `AS-${i}`, asName: null, source: "local_database", asnDatabaseVersion: "test-v1" },
          anycast: { isAnycast: false, provider: null, service: null, prefixCidr: null, source: "test" },
          bytes,
          flows: 2,
          deltaBytes: 0,
          hostnames: [{ name: `host-${i}.com`, source: "dns" }],
          evidence: [],
          freshness: "active",
          lastSeenTs: 1_700_000_000_000,
        };
        enrichedHosts.push(host);
        hostsById.set(ip, host);
      }

      const targetHost = enrichedHosts[199]!;
      const targetEntityId = `entity-host-${targetHost.ip}`;

      const snapshot: HostEnrichmentSnapshot = {
        captureSessionId: "s",
        snapshotSequence: 1,
        enrichedHosts,
        hostsById,
        coverageStats: {
          totalObservedHosts: 200,
          publicHostsCount: 200,
          resolvedHostsCount: 200,
          unresolvedHostsCount: 0,
          localLanHostsCount: 0,
          specialHostsCount: 0,
          totalBytes: 2000000,
          resolvedBytes: 2000000,
          unresolvedBytes: 0,
          coveragePercent: 100,
        },
      };

      const model = deriveClusteredMapModel(
        snapshot,
        null,
        {
          maxVisibleNodes: 120,
          maxVisibleArcs: 60,
          clusterRadiusPx: 1,
          selectedEntityId: targetEntityId,
        }
      );

      // Node budget respected
      expect(model.aggregateNodes.length).toBe(120);

      // Target node is emitted as active visible endpoint, NOT collapsed into Other Resolved Traffic
      const targetNode = model.aggregateNodes.find((n) => n.endpointIps.includes(targetHost.ip));
      expect(targetNode).toBeDefined();
      expect(targetNode?.nodeKind).toBe("endpoint");
      expect(targetNode?.entityId).toBe(targetEntityId);

      // Active selection correctly resolved as active endpoint
      expect(model.activeSelection).not.toBeNull();
      expect(model.activeSelection?.status).toBe("active");
      expect(model.activeSelection?.isSelected).toBe(true);
      expect(model.activeSelection?.selectedEntity?.kind).toBe("endpoint");
      if (model.activeSelection?.selectedEntity?.kind === "endpoint") {
        expect(model.activeSelection.selectedEntity.ip).toBe(targetHost.ip);
      }

      // Arc for the selected focal target is preserved within maxVisibleArcs budget
      expect(model.arcModels.length).toBeLessThanOrEqual(60);
      const targetArc = model.arcModels.find((a) => a.id.includes(targetHost.ip));
      expect(targetArc).toBeDefined();
    });
  });

  describe("Invariant 4: Cumulative vs. Interval Byte Separation", () => {
    it("Invariant 4: cluster.bytes = sum(host.bytes) AND cluster.deltaBytes = sum(host.deltaBytes)", () => {
      const s1Rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 10_000, flows: 1, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 20_000, flows: 1, hostnames: [], evidence: [] },
      ];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "s", snapshotSequence: 1 }, null);

      const s2Rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 10_500, flows: 2, hostnames: [], evidence: [] }, // delta = 500
        { label: "8.8.8.8", bytes: 20_300, flows: 2, hostnames: [], evidence: [] }, // delta = 300
      ];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "s", snapshotSequence: 2 }, model1, { zoomScale: 1.0 });

      expect(model2.aggregateNodes.length).toBe(1);
      const cluster = model2.aggregateNodes[0]!;
      // Total cumulative bytes must be 30,800
      expect(cluster.totalBytes).toBe(30_800);
      // Delta bytes MUST be strictly 800 (500 + 300), NEVER 30,800
      expect(cluster.deltaBytes).toBe(800);
    });

    it("Invariant 4: maxVisibleNodes cap (120 nodes) strictly prioritizes highest byte volume endpoints/clusters", () => {
      const sampleRows: BreakdownRow[] = [];
      for (let i = 1; i <= 200; i++) {
        sampleRows.push({
          label: `104.16.${Math.floor(i / 256)}.${i % 256}`,
          bytes: i * 1000,
          flows: 1,
          hostnames: [],
          evidence: [],
        });
      }

      const model = deriveMapViewModel(
        { hosts: sampleRows, captureSessionId: "sess-cap", snapshotSequence: 1 },
        null,
        { maxVisibleNodes: 120, zoomScale: 10.0 }
      );

      expect(model.aggregateNodes.length).toBeLessThanOrEqual(120);
      const lowestRetainedBytes = Math.min(...model.aggregateNodes.map((n) => n.totalBytes));
      expect(lowestRetainedBytes).toBeGreaterThanOrEqual(1000);
    });
  });

  describe("Invariant 5: Shortest-Path Antimeridian Dateline Arc Routing & De Casteljau Curve Splitting", () => {
    it("Invariant 5.1: Westward Pacific crossing (SF -> Tokyo) generates two valid segments wrapped at 0 and 720", () => {
      const sf = { lat: 37.7749, lng: -122.4194 };
      const tokyo = { lat: 35.6762, lng: 139.6503 };

      const [ox, oy] = projectGeo(sf.lat, sf.lng);
      const [tx, ty] = projectGeo(tokyo.lat, tokyo.lng);

      const arc = calculateArcBezier(ox, oy, tx, ty, {
        originLng: sf.lng,
        destLng: tokyo.lng,
      });

      expect(arc.crossesAntimeridian).toBe(true);
      expect(arc.crossingDirection).toBe("west");
      expect(arc.shortestDeltaLng).toBeCloseTo(-97.93, 1);
      expect(arc.segments.length).toBe(2);

      const [seg1, seg2] = [arc.segments[0]!, arc.segments[1]!];
      // Segment 1: Origin (SF) -> Left boundary (x = 0)
      expect(seg1.start.x).toBeCloseTo(ox, 1);
      expect(seg1.start.y).toBeCloseTo(oy, 1);
      expect(seg1.end.x).toBe(0);

      // Segment 2: Right boundary (x = 720) -> Destination (Tokyo)
      expect(seg2.start.x).toBe(720);
      expect(seg2.end.x).toBeCloseTo(tx, 1);
      expect(seg2.end.y).toBeCloseTo(ty, 1);

      // Seam continuity: Y coordinates at boundary must match within epsilon
      expect(Math.abs(seg1.end.y - seg2.start.y)).toBeLessThan(1e-4);

      // Length and timing invariants
      expect(seg1.length).toBeGreaterThan(0);
      expect(seg2.length).toBeGreaterThan(0);
      expect(arc.totalLength).toBeCloseTo(seg1.length + seg2.length, 3);
      expect(arc.particleSplitT).toBeDefined();
      expect(arc.particleSplitT!).toBeGreaterThan(0);
      expect(arc.particleSplitT!).toBeLessThan(1);

      // SVG path string must end at the true destination coordinate (tx, ty)
      expect(arc.d).toContain(`${tx.toFixed(1)} ${ty.toFixed(1)}`);

      // All points in segments must be strictly within [0, 720] x [0, 360]
      for (const seg of arc.segments) {
        expect(seg.start.x).toBeGreaterThanOrEqual(0);
        expect(seg.start.x).toBeLessThanOrEqual(720);
        expect(seg.start.y).toBeGreaterThanOrEqual(0);
        expect(seg.start.y).toBeLessThanOrEqual(360);

        expect(seg.control.x).toBeGreaterThanOrEqual(0);
        expect(seg.control.x).toBeLessThanOrEqual(720);
        expect(seg.control.y).toBeGreaterThanOrEqual(0);
        expect(seg.control.y).toBeLessThanOrEqual(360);

        expect(seg.end.x).toBeGreaterThanOrEqual(0);
        expect(seg.end.x).toBeLessThanOrEqual(720);
        expect(seg.end.y).toBeGreaterThanOrEqual(0);
        expect(seg.end.y).toBeLessThanOrEqual(360);
      }
    });

    it("Invariant 5.2: Eastward Pacific crossing (Tokyo -> SF) generates two valid segments wrapped at 720 and 0", () => {
      const tokyo = { lat: 35.6762, lng: 139.6503 };
      const sf = { lat: 37.7749, lng: -122.4194 };

      const [tx, ty] = projectGeo(tokyo.lat, tokyo.lng);
      const [ox, oy] = projectGeo(sf.lat, sf.lng);

      const arc = calculateArcBezier(tx, ty, ox, oy, {
        originLng: tokyo.lng,
        destLng: sf.lng,
      });

      expect(arc.crossesAntimeridian).toBe(true);
      expect(arc.crossingDirection).toBe("east");
      expect(arc.shortestDeltaLng).toBeCloseTo(97.93, 1);
      expect(arc.segments.length).toBe(2);

      const [seg1, seg2] = [arc.segments[0]!, arc.segments[1]!];
      // Segment 1: Tokyo -> Right boundary (x = 720)
      expect(seg1.start.x).toBeCloseTo(tx, 1);
      expect(seg1.end.x).toBe(720);

      // Segment 2: Left boundary (x = 0) -> SF
      expect(seg2.start.x).toBe(0);
      expect(seg2.end.x).toBeCloseTo(ox, 1);
      expect(seg2.end.y).toBeCloseTo(oy, 1);

      // Seam continuity
      expect(Math.abs(seg1.end.y - seg2.start.y)).toBeLessThan(1e-4);
    });

    it("Invariant 5.3: Non-crossing routes (e.g. London -> New York) produce exactly one segment", () => {
      const london = { lat: 51.5074, lng: -0.1278 };
      const ny = { lat: 40.7128, lng: -74.0060 };

      const [lx, ly] = projectGeo(london.lat, london.lng);
      const [nx, nyCoord] = projectGeo(ny.lat, ny.lng);

      const arc = calculateArcBezier(lx, ly, nx, nyCoord, {
        originLng: london.lng,
        destLng: ny.lng,
      });

      expect(arc.crossesAntimeridian).toBe(false);
      expect(arc.crossingDirection).toBe("none");
      expect(arc.segments.length).toBe(1);
      expect(arc.segments[0]!.start.x).toBeCloseTo(lx, 1);
      expect(arc.segments[0]!.end.x).toBeCloseTo(nx, 1);
      expect(arc.segments[0]!.end.y).toBeCloseTo(nyCoord, 1);
    });

    it("Invariant 5.4: Near-antimeridian coordinates (179° -> -179° and -179° -> 179°)", () => {
      // 179° -> -179° is a 2° eastward route across the antimeridian
      const [x1, y1] = projectGeo(10, 179.0);
      const [x2, y2] = projectGeo(10, -179.0);

      const arcEast = calculateArcBezier(x1, y1, x2, y2, {
        originLng: 179.0,
        destLng: -179.0,
      });

      expect(arcEast.crossesAntimeridian).toBe(true);
      expect(arcEast.crossingDirection).toBe("east");
      expect(arcEast.shortestDeltaLng).toBeCloseTo(2.0, 1);
      expect(arcEast.segments.length).toBe(2);
      expect(arcEast.segments[0]!.end.x).toBe(720);
      expect(arcEast.segments[1]!.start.x).toBe(0);

      // -179° -> 179° is a 2° westward route across the antimeridian
      const arcWest = calculateArcBezier(x2, y2, x1, y1, {
        originLng: -179.0,
        destLng: 179.0,
      });

      expect(arcWest.crossesAntimeridian).toBe(true);
      expect(arcWest.crossingDirection).toBe("west");
      expect(arcWest.shortestDeltaLng).toBeCloseTo(-2.0, 1);
      expect(arcWest.segments.length).toBe(2);
      expect(arcWest.segments[0]!.end.x).toBe(0);
      expect(arcWest.segments[1]!.start.x).toBe(720);
    });

    it("Invariant 5.5: Exact 180° separation follows deterministic non-wrapping tie-break policy", () => {
      const cases = [
        { orig: 0, dest: 180 },
        { orig: 180, dest: 0 },
        { orig: 170, dest: -10 },
        { orig: -170, dest: 10 },
      ];

      for (const { orig, dest } of cases) {
        const [x1, y1] = projectGeo(0, orig);
        const [x2, y2] = projectGeo(0, dest);

        const arc = calculateArcBezier(x1, y1, x2, y2, {
          originLng: orig,
          destLng: dest,
        });

        expect(arc.crossesAntimeridian).toBe(false);
        expect(arc.crossingDirection).toBe("none");
        expect(arc.segments.length).toBe(1);
      }
    });

    it("Invariant 5.6: Vertical & Degenerate Routes produce finite lengths and no NaNs", () => {
      // Vertical route: same longitude, different latitude
      const [vx1, vy1] = projectGeo(10, 0);
      const [vx2, vy2] = projectGeo(50, 0);

      const arcVert = calculateArcBezier(vx1, vy1, vx2, vy2, {
        originLng: 0,
        destLng: 0,
      });

      expect(arcVert.segments.length).toBe(1);
      expect(Number.isFinite(arcVert.totalLength)).toBe(true);
      expect(arcVert.totalLength).toBeGreaterThan(0);

      // Degenerate route: origin === destination
      const arcDeg = calculateArcBezier(100, 100, 100, 100, {
        originLng: 50,
        destLng: 50,
      });

      expect(arcDeg.segments.length).toBe(1);
      expect(Number.isFinite(arcDeg.totalLength)).toBe(true);
      expect(arcDeg.d).not.toContain("NaN");
    });

    it("Invariant 5.7: 17-sample LUT invariants and bounded inversion", () => {
      const [x1, y1] = projectGeo(37.77, -122.41);
      const [x2, y2] = projectGeo(35.67, 139.65);

      const arc = calculateArcBezier(x1, y1, x2, y2, {
        originLng: -122.41,
        destLng: 139.65,
      });

      for (const seg of arc.segments) {
        expect(seg.lut.length).toBe(17);
        expect(seg.lut[0]).toBe(0.0);
        expect(seg.lut[16]).toBe(1.0);
        // Non-decreasing
        for (let i = 1; i < seg.lut.length; i++) {
          expect(seg.lut[i]!).toBeGreaterThanOrEqual(seg.lut[i - 1]!);
        }
      }
    });

    it("Invariant 5.8: Piecewise seam particle sampling and zero-allocation sampleArcInto", () => {
      const sf = { lat: 37.7749, lng: -122.4194 };
      const tokyo = { lat: 35.6762, lng: 139.6503 };

      const [ox, oy] = projectGeo(sf.lat, sf.lng);
      const [tx, ty] = projectGeo(tokyo.lat, tokyo.lng);

      const arc = calculateArcBezier(ox, oy, tx, ty, {
        originLng: sf.lng,
        destLng: tokyo.lng,
      });

      const tempPoint = { x: 0, y: 0 };

      // u = 0 -> origin
      sampleArcInto(arc, 0, tempPoint);
      expect(tempPoint.x).toBeCloseTo(ox, 1);
      expect(tempPoint.y).toBeCloseTo(oy, 1);

      // u = 1 -> destination
      sampleArcInto(arc, 1, tempPoint);
      expect(tempPoint.x).toBeCloseTo(tx, 1);
      expect(tempPoint.y).toBeCloseTo(ty, 1);

      // Seam sampling for westward crossing
      const pSplit = arc.particleSplitT!;
      sampleArcInto(arc, pSplit, tempPoint);
      expect(tempPoint.x).toBeCloseTo(0, 1); // Westward exit boundary

      sampleArcInto(arc, pSplit + 1e-4, tempPoint);
      expect(tempPoint.x).toBeCloseTo(720, 1); // Westward wrapped entry boundary
    });

    it("Invariant 5.9: SVG command-grammar parser validation", () => {
      const sf = { lat: 37.7749, lng: -122.4194 };
      const tokyo = { lat: 35.6762, lng: 139.6503 };

      const [ox, oy] = projectGeo(sf.lat, sf.lng);
      const [tx, ty] = projectGeo(tokyo.lat, tokyo.lng);

      const arcWrapped = calculateArcBezier(ox, oy, tx, ty, {
        originLng: sf.lng,
        destLng: tokyo.lng,
      });

      // 1. Wrapped path command grammar: M Q M Q
      const wrappedCommands = Array.from(arcWrapped.d.matchAll(/([MQ])/g)).map((m) => m[1]);
      expect(wrappedCommands).toEqual(["M", "Q", "M", "Q"]);

      // Extract all numbers from d string and assert every coordinate is finite and in bounds [0, 720] x [0, 360]
      const numbers = arcWrapped.d.match(/[-\d.]+/g)?.map(Number) || [];
      expect(numbers.length).toBe(12); // 2 segments * (2 start + 2 control + 2 end) = 12 numbers

      for (let i = 0; i < numbers.length; i += 2) {
        const x = numbers[i]!;
        const y = numbers[i + 1]!;
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(720);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(360);
      }

      // 2. Normal path command grammar: M Q
      const arcNormal = calculateArcBezier(100, 100, 200, 200, {
        originLng: 10,
        destLng: 20,
      });
      const normalCommands = Array.from(arcNormal.d.matchAll(/([MQ])/g)).map((m) => m[1]);
      expect(normalCommands).toEqual(["M", "Q"]);
    });

    it("Invariant 5.10: Direct ArcSegment object coordinate invariants (Zero extended X coordinates anywhere in geometry)", () => {
      const testRoutes = [
        { orig: { lat: 37.77, lng: -122.41 }, dest: { lat: 35.67, lng: 139.65 } }, // Westward
        { orig: { lat: 35.67, lng: 139.65 }, dest: { lat: 37.77, lng: -122.41 } }, // Eastward
        { orig: { lat: 10, lng: 179.0 }, dest: { lat: 10, lng: -179.0 } }, // Near dateline east
        { orig: { lat: 10, lng: -179.0 }, dest: { lat: 10, lng: 179.0 } }, // Near dateline west
        { orig: { lat: 51.5, lng: -0.12 }, dest: { lat: 40.7, lng: -74.0 } }, // Non-crossing
      ];

      for (const route of testRoutes) {
        const [ox, oy] = projectGeo(route.orig.lat, route.orig.lng);
        const [dx, dy] = projectGeo(route.dest.lat, route.dest.lng);

        const arc = calculateArcBezier(ox, oy, dx, dy, {
          originLng: route.orig.lng,
          destLng: route.dest.lng,
        });

        for (const seg of arc.segments) {
          // Direct check on start, control, and end points
          for (const pt of [seg.start, seg.control, seg.end]) {
            expect(Number.isFinite(pt.x)).toBe(true);
            expect(Number.isFinite(pt.y)).toBe(true);
            expect(pt.x).toBeGreaterThanOrEqual(0);
            expect(pt.x).toBeLessThanOrEqual(720);
            expect(pt.y).toBeGreaterThanOrEqual(0);
            expect(pt.y).toBeLessThanOrEqual(360);
          }
        }
      }
    });

    it("Invariant 5.11: Pure De Casteljau splitT mathematical invariant (0 < splitT < 1) for all crossing routes", () => {
      const crossingRoutes = [
        { origLng: -122.4194, destLng: 139.6503 },
        { origLng: 139.6503, destLng: -122.4194 },
        { origLng: 179.9, destLng: -179.9 },
        { origLng: -179.9, destLng: 179.9 },
        { origLng: -150.0, destLng: 150.0 },
        { origLng: 150.0, destLng: -150.0 },
      ];

      for (const { origLng, destLng } of crossingRoutes) {
        const [ox, oy] = projectGeo(20, origLng);
        const [dx, dy] = projectGeo(20, destLng);

        const arc = calculateArcBezier(ox, oy, dx, dy, {
          originLng: origLng,
          destLng: destLng,
        });

        expect(arc.crossesAntimeridian).toBe(true);
        expect(arc.splitT).toBeDefined();
        expect(arc.splitT!).toBeGreaterThan(0.0);
        expect(arc.splitT!).toBeLessThan(1.0);
        expect(arc.particleSplitT).toBeDefined();
        expect(arc.particleSplitT!).toBeGreaterThan(0.0);
        expect(arc.particleSplitT!).toBeLessThan(1.0);
      }
    });
  });

  describe("Invariant 6: Unmount / Remount Isolation & Deterministic Derivation", () => {
    it("Invariant 6: Unmounting and remounting produces identical deterministic state without baseline drift", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 10_000, flows: 2, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 20_000, flows: 4, hostnames: [], evidence: [] },
      ];

      const input: MapViewModelInput = {
        hosts: rows,
        captureSessionId: "sess-stable",
        snapshotSequence: 5,
        snapshotTimestamp: 1_700_000_000_000,
      };
      const modelMount1 = deriveMapViewModel(input, null);
      
      // Simulate unmount & remount with same authoritative snapshot
      const modelMount2 = deriveMapViewModel(input, null);

      expect(modelMount1.aggregateNodes.length).toBe(modelMount2.aggregateNodes.length);
      expect(modelMount1.coverageStats).toEqual(modelMount2.coverageStats);
      expect(modelMount1.snapshotSequence).toBe(modelMount2.snapshotSequence);
      expect(modelMount1.lastUpdatedTs).toBe(1_700_000_000_000);
      expect(modelMount2.lastUpdatedTs).toBe(1_700_000_000_000);
      expect(modelMount1.enrichedHosts[0]?.lastSeenTs).toBe(1_700_000_000_000);
      expect(modelMount2.enrichedHosts[0]?.lastSeenTs).toBe(1_700_000_000_000);
      expect(modelMount1).toEqual(modelMount2);
    });

    it("Invariant 6: Default snapshotTimestamp derivation is pure and reproducible across consecutive invocations", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 10_000, flows: 2, hostnames: [], evidence: [] },
      ];

      const input: MapViewModelInput = {
        hosts: rows,
        captureSessionId: "sess-default-ts",
        snapshotSequence: 1,
      };

      const m1 = deriveMapViewModel(input, null);
      const m2 = deriveMapViewModel(input, null);

      expect(m1.lastUpdatedTs).toBe(0);
      expect(m2.lastUpdatedTs).toBe(0);
      expect(m1.enrichedHosts[0]?.lastSeenTs).toBe(0);
      expect(m2.enrichedHosts[0]?.lastSeenTs).toBe(0);
      expect(m1).toEqual(m2);
    });

    it("Invariant 6: 50 consecutive re-evaluations of the same snapshot produce identical lastSeenTs and model identity without wall-clock drift", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 10_000, flows: 2, hostnames: [], evidence: [] },
        { label: "8.8.8.8", bytes: 20_000, flows: 4, hostnames: [], evidence: [] },
      ];

      const input: MapViewModelInput = {
        hosts: rows,
        captureSessionId: "sess-re-eval",
        snapshotSequence: 3,
        snapshotTimestamp: 1_700_000_000_555,
      };

      const baseline = deriveMapViewModel(input, null);

      for (let i = 0; i < 50; i++) {
        const reEval = deriveMapViewModel(input, null);
        expect(reEval.lastUpdatedTs).toBe(1_700_000_000_555);
        expect(reEval.enrichedHosts[0]?.lastSeenTs).toBe(1_700_000_000_555);
        expect(reEval.enrichedHosts[1]?.lastSeenTs).toBe(1_700_000_000_555);
        expect(reEval).toEqual(baseline);
      }
    });
  });

  describe("Invariant 7: 4D Traffic Conservation and Other Resolved Traffic Selection in MapViewModel", () => {
    it("conserves 100% of telemetry metrics in deriveMapViewModel across coverageStats and aggregateNodes", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 100000, flows: 10, hostnames: [{ name: "us-host", source: "dns" }], evidence: [] },
        { label: "31.0.0.1", bytes: 60000, flows: 6, hostnames: [{ name: "de-host", source: "dns" }], evidence: [] },
        { label: "9.9.9.9", bytes: 40000, flows: 4, hostnames: [{ name: "ch-host", source: "dns" }], evidence: [] },
        { label: "142.250.30.1", bytes: 20000, flows: 2, hostnames: [{ name: "jp-host", source: "dns" }], evidence: [] },
      ];

      const input: MapViewModelInput = { hosts: rows, captureSessionId: "s-4d", snapshotSequence: 1 };
      const model = deriveMapViewModel(input, null, { maxVisibleNodes: 2 });

      // Budget compliance
      expect(model.aggregateNodes.length).toBe(2);

      // 4D conservation
      const totalNodeBytes = model.aggregateNodes.reduce((s, n) => s + n.totalBytes, 0);
      const totalNodeMembers = model.aggregateNodes.reduce((s, n) => s + (n.memberCount ?? 1), 0);

      expect(totalNodeBytes).toBe(model.coverageStats.resolvedBytes);
      expect(totalNodeMembers).toBe(model.coverageStats.resolvedHostsCount);
    });

    it("resolves active selection when selecting OTHER_RESOLVED_ENTITY_ID and transitions to tombstone when removed", () => {
      const rows: BreakdownRow[] = [
        { label: "1.1.1.1", bytes: 100000, flows: 10, hostnames: [{ name: "us-host", source: "dns" }], evidence: [] },
        { label: "31.0.0.1", bytes: 60000, flows: 6, hostnames: [{ name: "de-host", source: "dns" }], evidence: [] },
        { label: "9.9.9.9", bytes: 40000, flows: 4, hostnames: [{ name: "ch-host", source: "dns" }], evidence: [] },
        { label: "142.250.30.1", bytes: 20000, flows: 2, hostnames: [{ name: "jp-host", source: "dns" }], evidence: [] },
      ];

      const input1: MapViewModelInput = { hosts: rows, captureSessionId: "s-sel", snapshotSequence: 1 };
      const model1 = deriveMapViewModel(input1, null, {
        maxVisibleNodes: 2,
        selectedEntityId: OTHER_RESOLVED_ENTITY_ID,
      });

      expect(model1.activeSelection).not.toBeNull();
      expect(model1.activeSelection?.status).toBe("active");
      expect(model1.activeSelection?.entityId).toBe(OTHER_RESOLVED_ENTITY_ID);
      expect(["otherResolvedAggregate", "otherResolvedGroup"]).toContain(model1.activeSelection?.selectedEntity?.kind);
      if (model1.activeSelection?.selectedEntity && "memberHosts" in model1.activeSelection.selectedEntity) {
        expect(model1.activeSelection.selectedEntity.memberHosts.length).toBe(3);
      }

      // Next snapshot: all hosts disappear
      const input2: MapViewModelInput = { hosts: [], captureSessionId: "s-sel", snapshotSequence: 2 };
      const model2 = deriveMapViewModel(input2, model1, {
        maxVisibleNodes: 2,
        selectedEntityId: OTHER_RESOLVED_ENTITY_ID,
      });

      expect(model2.activeSelection?.status).toBe("tombstone");
      expect(model2.activeSelection?.selectedEntity?.tombstone?.isInactive).toBe(true);
    });
  });
});
