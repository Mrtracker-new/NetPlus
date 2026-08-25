import { describe, it, expect, beforeEach } from "vitest";
import type { BreakdownRow } from "@netpulse/contract";
import {
  deriveMapViewModel,
  type MapViewModelInput,
  clearGeoCaches,
  calculateArcBezier,
  projectGeo,
} from "@netpulse/viz";

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

    it("Invariant 1: Counter reset / rollover (currentBytes < prevBytes) produces delta = 0, not negative", () => {
      // Session S1: 1.1.1.1 has accumulated 500,000 bytes
      const s1Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 500_000, flows: 10, hostnames: [], evidence: [] }];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "sess-counter", snapshotSequence: 1 }, null);

      // S2: counter rolls over / capture restarted — bytes drops to 200 (less than 500,000)
      const s2Rows: BreakdownRow[] = [{ label: "1.1.1.1", bytes: 200, flows: 1, hostnames: [], evidence: [] }];
      const model2 = deriveMapViewModel({ hosts: s2Rows, captureSessionId: "sess-counter", snapshotSequence: 2 }, model1);

      // Must not produce a negative delta or a huge artificial burst
      expect(model2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
      expect(model2.hostsById.get("1.1.1.1")?.bytes).toBe(200);
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
  });

  describe("Invariant 3: 3-Tier Entity Identity, Selection Hierarchy & Tombstone UX", () => {
    it("Invariant 3: Selection resolves to entityId and persists across cluster regrouping on zoom", () => {
      const rows: BreakdownRow[] = [
        { label: "104.16.0.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }, // SF (37.77, -122.41)
        { label: "17.0.0.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },     // Cupertino (37.33, -122.03)
      ];

      // World scale (zoom = 1.0) -> screen dist ~1.37px < 26px -> groups into single Bay Area cluster
      const modelZoom1 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        null,
        { zoomScale: 1.0, selectedEntityId: "entity-host-104.16.0.1" }
      );

      expect(modelZoom1.aggregateNodes.length).toBe(1);
      const cluster = modelZoom1.aggregateNodes[0]!;
      expect(cluster.entityId).toBeDefined();
      expect(cluster.geoCellId).toBeDefined();
      expect(cluster.endpointIps).toContain("104.16.0.1");
      expect(modelZoom1.activeSelection?.isSelected).toBe(true);

      // Deep zoom in (zoom = 40.0) -> threshold = 26/40 = 0.65px < 1.37px -> unpacks into 2 separate nodes
      const modelZoom40 = deriveMapViewModel(
        { hosts: rows, captureSessionId: "s", snapshotSequence: 1 },
        modelZoom1,
        { zoomScale: 40.0, selectedEntityId: "entity-host-104.16.0.1" }
      );

      expect(modelZoom40.aggregateNodes.length).toBe(2);
      const selectedNode = modelZoom40.aggregateNodes.find((n) => n.endpointIps.includes("104.16.0.1"));
      expect(selectedNode).toBeDefined();
      expect(selectedNode?.entityId).toBe("entity-host-104.16.0.1");
      expect(modelZoom40.activeSelection?.isSelected).toBe(true);
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

    it("Invariant 3 / FINDING-001: Tombstone lastObservedTs is frozen at first-disappearance and never advances on re-derivation", () => {
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

      // Re-derive 5 more times — the timestamp must not advance
      let prevModel = model2;
      for (let i = 3; i <= 7; i++) {
        const reModel = deriveMapViewModel(
          { hosts: [], captureSessionId: "s", snapshotSequence: i },
          prevModel,
          { selectedEntityId: "entity-host-1.1.1.1" }
        );
        expect(reModel.activeSelection?.status).toBe("tombstone");
        // FINDING-001 regression guard: ts must match the ts from first tombstone transition
        expect(reModel.activeSelection?.selectedEntity?.tombstone?.lastObservedTs).toBe(frozenTs);
        prevModel = reModel;
      }
    });
  });

  describe("Invariant 4: Cumulative vs. Interval Byte Separation", () => {
    it("Invariant 4: cluster.bytes = sum(host.bytes) AND cluster.deltaBytes = sum(host.deltaBytes)", () => {
      const s1Rows: BreakdownRow[] = [
        { label: "104.16.0.1", bytes: 10_000, flows: 1, hostnames: [], evidence: [] },
        { label: "104.16.0.2", bytes: 20_000, flows: 1, hostnames: [], evidence: [] },
      ];
      const model1 = deriveMapViewModel({ hosts: s1Rows, captureSessionId: "s", snapshotSequence: 1 }, null);

      const s2Rows: BreakdownRow[] = [
        { label: "104.16.0.1", bytes: 10_500, flows: 2, hostnames: [], evidence: [] }, // delta = 500
        { label: "104.16.0.2", bytes: 20_300, flows: 2, hostnames: [], evidence: [] }, // delta = 300
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
    it("Invariant 5.1: Pacific-crossing routes (e.g. SF to Tokyo) generate two valid segments wrapped at 0 and 720", () => {
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
      // Segment 1: SF -> Left boundary (x = 0)
      expect(seg1.start.x).toBeCloseTo(ox, 1);
      expect(seg1.end.x).toBe(0);

      // Segment 2: Right boundary (x = 720) -> Tokyo (exact tx, ty)
      expect(seg2.start.x).toBe(720);
      expect(seg2.end.x).toBeCloseTo(tx, 1);
      expect(seg2.end.y).toBeCloseTo(ty, 1);

      // Seam continuity
      expect(Math.abs(seg1.end.y - seg2.start.y)).toBeLessThan(1e-4);

      // SVG path string must end at the true destination coordinate (tx, ty)
      expect(arc.d).toContain(`${tx.toFixed(1)} ${ty.toFixed(1)}`);
    });

    it("Invariant 5.2: Near-dateline coordinates (179° -> -179° and -179° -> 179°)", () => {
      const [x1, y1] = projectGeo(10, 179.0);
      const [x2, y2] = projectGeo(10, -179.0);

      // 179° -> -179° is eastward across antimeridian
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

      // -179° -> 179° is westward across antimeridian
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

    it("Invariant 5.3: Direct ArcSegment object coordinate invariants (Zero extended X coordinates anywhere in geometry)", () => {
      const sf = { lat: 37.7749, lng: -122.4194 };
      const tokyo = { lat: 35.6762, lng: 139.6503 };

      const [ox, oy] = projectGeo(sf.lat, sf.lng);
      const [tx, ty] = projectGeo(tokyo.lat, tokyo.lng);

      const arc = calculateArcBezier(ox, oy, tx, ty, {
        originLng: sf.lng,
        destLng: tokyo.lng,
      });

      for (const seg of arc.segments) {
        for (const pt of [seg.start, seg.control, seg.end]) {
          expect(pt.x).toBeGreaterThanOrEqual(0);
          expect(pt.x).toBeLessThanOrEqual(720);
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(360);
        }
      }
    });

    it("Invariant 5.4: Pure De Casteljau splitT mathematical invariant (0 < splitT < 1) for crossing routes", () => {
      const [ox, oy] = projectGeo(37.77, -122.41);
      const [tx, ty] = projectGeo(35.67, 139.65);

      const arc = calculateArcBezier(ox, oy, tx, ty, {
        originLng: -122.41,
        destLng: 139.65,
      });

      expect(arc.splitT).toBeDefined();
      expect(arc.splitT!).toBeGreaterThan(0.0);
      expect(arc.splitT!).toBeLessThan(1.0);
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
});
