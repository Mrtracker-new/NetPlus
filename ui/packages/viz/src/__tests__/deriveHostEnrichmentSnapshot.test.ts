import { describe, it, expect, beforeEach } from "vitest";
import type { BreakdownRow } from "@netpulse/contract";
import {
  deriveHostEnrichmentSnapshot,
  type MapViewModelInput,
  type HostEnrichmentSnapshot,
} from "../geo/mapViewModel";
import { clearGeoCaches } from "../geo/geoDatabase";

describe("deriveHostEnrichmentSnapshot — Authoritative Delta Engine Test Suite", () => {
  beforeEach(() => {
    clearGeoCaches();
  });

  it("1. Initial session baseline: first snapshot S0 establishes baseline with zero deltas", () => {
    const s0Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 10_000_000, flows: 20, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 50_000_000, flows: 50, hostnames: [], evidence: [] },
    ];

    const input: MapViewModelInput = {
      hosts: s0Rows,
      captureSessionId: "session-1",
      snapshotSequence: 1,
      snapshotTimestamp: 1_700_000_000_000,
    };

    const snapshot = deriveHostEnrichmentSnapshot(input, null);

    expect(snapshot.captureSessionId).toBe("session-1");
    expect(snapshot.snapshotSequence).toBe(1);
    expect(snapshot.snapshotTimestamp).toBe(1_700_000_000_000);

    // Baseline Invariant: S0 must never emit historical bytes as interval traffic
    const host1 = snapshot.hostsById.get("1.1.1.1");
    const host2 = snapshot.hostsById.get("8.8.8.8");

    expect(host1).toBeDefined();
    expect(host1?.bytes).toBe(10_000_000);
    expect(host1?.deltaBytes).toBe(0);

    expect(host2).toBeDefined();
    expect(host2?.bytes).toBe(50_000_000);
    expect(host2?.deltaBytes).toBe(0);

    // Total volume tracks cumulative bytes accurately
    expect(snapshot.coverageStats.totalBytes).toBe(60_000_000);
  });

  it("2. Normal delta: current - previous is emitted exactly once per snapshot progression", () => {
    const s1Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 2000, flows: 2, hostnames: [], evidence: [] },
    ];
    const s1 = deriveHostEnrichmentSnapshot(
      { hosts: s1Rows, captureSessionId: "sess-delta", snapshotSequence: 1 },
      null
    );

    const s2Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1600, flows: 2, hostnames: [], evidence: [] }, // +600
      { label: "8.8.8.8", bytes: 2250, flows: 3, hostnames: [], evidence: [] }, // +250
    ];
    const s2 = deriveHostEnrichmentSnapshot(
      { hosts: s2Rows, captureSessionId: "sess-delta", snapshotSequence: 2 },
      s1
    );

    expect(s2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(600);
    expect(s2.hostsById.get("8.8.8.8")?.deltaBytes).toBe(250);
    expect(s2.hostsById.get("1.1.1.1")?.bytes).toBe(1600);
    expect(s2.hostsById.get("8.8.8.8")?.bytes).toBe(2250);

    // Progression to S3 with partial activity
    const s3Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1600, flows: 2, hostnames: [], evidence: [] }, // +0
      { label: "8.8.8.8", bytes: 3000, flows: 5, hostnames: [], evidence: [] }, // +750
    ];
    const s3 = deriveHostEnrichmentSnapshot(
      { hosts: s3Rows, captureSessionId: "sess-delta", snapshotSequence: 3 },
      s2
    );

    expect(s3.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
    expect(s3.hostsById.get("8.8.8.8")?.deltaBytes).toBe(750);
  });

  it("3. Duplicate / Stale sequence: same or older sequence is rejected and returns previous snapshot reference", () => {
    const s2Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 2000, flows: 4, hostnames: [], evidence: [] },
    ];
    const s2 = deriveHostEnrichmentSnapshot(
      { hosts: s2Rows, captureSessionId: "sess-seq", snapshotSequence: 2 },
      null
    );

    // Duplicate sequence: sequence 2 arrives again with different payload
    const s2DuplicateRows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 999_999, flows: 99, hostnames: [], evidence: [] },
    ];
    const s2DupResult = deriveHostEnrichmentSnapshot(
      { hosts: s2DuplicateRows, captureSessionId: "sess-seq", snapshotSequence: 2 },
      s2
    );

    // Must return exact previous snapshot reference (identity equality)
    expect(s2DupResult).toBe(s2);
    expect(s2DupResult.hostsById.get("1.1.1.1")?.bytes).toBe(2000);

    // Stale sequence: sequence 1 arrives after sequence 2
    const s1StaleRows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 500, flows: 1, hostnames: [], evidence: [] },
    ];
    const s1StaleResult = deriveHostEnrichmentSnapshot(
      { hosts: s1StaleRows, captureSessionId: "sess-seq", snapshotSequence: 1 },
      s2
    );

    expect(s1StaleResult).toBe(s2);
    expect(s1StaleResult.snapshotSequence).toBe(2);
  });

  it("4. Counter rollover: current < previous safely produces delta = 0 and establishes new baseline", () => {
    // S1: Host has 1,000,000 bytes
    const s1Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1_000_000, flows: 50, hostnames: [], evidence: [] },
    ];
    const s1 = deriveHostEnrichmentSnapshot(
      { hosts: s1Rows, captureSessionId: "sess-rollover", snapshotSequence: 1 },
      null
    );

    // S2: Interface reboot / rollover drops counter from 1,000,000 to 400
    const s2Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 400, flows: 1, hostnames: [], evidence: [] },
    ];
    const s2 = deriveHostEnrichmentSnapshot(
      { hosts: s2Rows, captureSessionId: "sess-rollover", snapshotSequence: 2 },
      s1
    );

    // Invariant: never emit negative deltas or giant uint32 wraparound bursts
    expect(s2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
    expect(s2.hostsById.get("1.1.1.1")?.bytes).toBe(400);

    // S3: Increments from 400 to 950 -> delta = 550
    const s3Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 950, flows: 2, hostnames: [], evidence: [] },
    ];
    const s3 = deriveHostEnrichmentSnapshot(
      { hosts: s3Rows, captureSessionId: "sess-rollover", snapshotSequence: 3 },
      s2
    );

    expect(s3.hostsById.get("1.1.1.1")?.deltaBytes).toBe(550);
    expect(s3.hostsById.get("1.1.1.1")?.bytes).toBe(950);
  });

  it("5. Mid-session host arrival: host appearing after S0 receives delta = 0 as baseline", () => {
    const s1Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
    ];
    const s1 = deriveHostEnrichmentSnapshot(
      { hosts: s1Rows, captureSessionId: "sess-midsession", snapshotSequence: 1 },
      null
    );

    // S2: 8.8.8.8 appears for the first time mid-session with 80 MB accumulated bytes
    const s2Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1200, flows: 2, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 80_000_000, flows: 200, hostnames: [], evidence: [] },
    ];
    const s2 = deriveHostEnrichmentSnapshot(
      { hosts: s2Rows, captureSessionId: "sess-midsession", snapshotSequence: 2 },
      s1
    );

    expect(s2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(200);
    // Newly observed host must NOT emit its 80 MB counter as a spike
    expect(s2.hostsById.get("8.8.8.8")?.deltaBytes).toBe(0);
    expect(s2.hostsById.get("8.8.8.8")?.bytes).toBe(80_000_000);

    // S3: 8.8.8.8 adds 4096 bytes
    const s3Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1300, flows: 2, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 80_004_096, flows: 201, hostnames: [], evidence: [] },
    ];
    const s3 = deriveHostEnrichmentSnapshot(
      { hosts: s3Rows, captureSessionId: "sess-midsession", snapshotSequence: 3 },
      s2
    );

    expect(s3.hostsById.get("8.8.8.8")?.deltaBytes).toBe(4096);
  });

  it("6. Session restart: new session ID resets baselines and does not leak previous session state", () => {
    const s50Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 50_000_000, flows: 500, hostnames: [], evidence: [] },
    ];
    const s50SessionA = deriveHostEnrichmentSnapshot(
      { hosts: s50Rows, captureSessionId: "session-alpha", snapshotSequence: 50 },
      null
    );

    // Capture restarted: session-beta starts with sequence 1 and 300 bytes
    const restartRows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 300, flows: 1, hostnames: [], evidence: [] },
    ];
    const s1SessionB = deriveHostEnrichmentSnapshot(
      { hosts: restartRows, captureSessionId: "session-beta", snapshotSequence: 1 },
      s50SessionA
    );

    // Must reset baseline to session-beta S0 without underflow/rollover corruption
    expect(s1SessionB.captureSessionId).toBe("session-beta");
    expect(s1SessionB.snapshotSequence).toBe(1);
    expect(s1SessionB.hostsById.get("1.1.1.1")?.deltaBytes).toBe(0);
    expect(s1SessionB.hostsById.get("1.1.1.1")?.bytes).toBe(300);

    // S2 of session-beta calculates true delta against S1 of session-beta
    const s2SessionBRows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 450, flows: 2, hostnames: [], evidence: [] },
    ];
    const s2SessionB = deriveHostEnrichmentSnapshot(
      { hosts: s2SessionBRows, captureSessionId: "session-beta", snapshotSequence: 2 },
      s1SessionB
    );

    expect(s2SessionB.hostsById.get("1.1.1.1")?.deltaBytes).toBe(150);
  });

  it("7. Multiple hosts: per-host baselines remain strictly isolated", () => {
    const s1Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }, // Normal
      { label: "2.2.2.2", bytes: 5000, flows: 5, hostnames: [], evidence: [] }, // Will reset
      { label: "3.3.3.3", bytes: 3000, flows: 3, hostnames: [], evidence: [] }, // Stagnant
    ];
    const s1 = deriveHostEnrichmentSnapshot(
      { hosts: s1Rows, captureSessionId: "sess-multi", snapshotSequence: 1 },
      null
    );

    const s2Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1800, flows: 2, hostnames: [], evidence: [] }, // +800
      { label: "2.2.2.2", bytes: 200, flows: 1, hostnames: [], evidence: [] },  // Rollover -> 0
      { label: "3.3.3.3", bytes: 3000, flows: 3, hostnames: [], evidence: [] }, // Stagnant -> 0
      { label: "4.4.4.4", bytes: 9000, flows: 9, hostnames: [], evidence: [] }, // New arrival -> 0
    ];
    const s2 = deriveHostEnrichmentSnapshot(
      { hosts: s2Rows, captureSessionId: "sess-multi", snapshotSequence: 2 },
      s1
    );

    expect(s2.hostsById.get("1.1.1.1")?.deltaBytes).toBe(800);
    expect(s2.hostsById.get("2.2.2.2")?.deltaBytes).toBe(0);
    expect(s2.hostsById.get("3.3.3.3")?.deltaBytes).toBe(0);
    expect(s2.hostsById.get("4.4.4.4")?.deltaBytes).toBe(0);

    // Total bytes correctly sums all 4 hosts
    expect(s2.coverageStats.totalBytes).toBe(1800 + 200 + 3000 + 9000);
  });

  it("8. Repeated derivation / Consumer independence: pure transition function behavior without state leakage", () => {
    const s1Rows: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
    ];
    const s1 = deriveHostEnrichmentSnapshot(
      { hosts: s1Rows, captureSessionId: "sess-pure", snapshotSequence: 1 },
      null
    );

    const s2Input: MapViewModelInput = {
      hosts: [{ label: "1.1.1.1", bytes: 1500, flows: 2, hostnames: [], evidence: [] }],
      captureSessionId: "sess-pure",
      snapshotSequence: 2,
    };

    // Calling deriveHostEnrichmentSnapshot 10 times on the same (input, previous) produces identical results
    const results = Array.from({ length: 10 }, () =>
      deriveHostEnrichmentSnapshot(s2Input, s1)
    );

    for (const res of results) {
      expect(res.hostsById.get("1.1.1.1")?.deltaBytes).toBe(500);
      expect(res.hostsById.get("1.1.1.1")?.bytes).toBe(1500);
      expect(res.snapshotSequence).toBe(2);
    }

    // Two independent consumers maintaining their own snapshot histories
    const consumerA_S1 = deriveHostEnrichmentSnapshot(
      { hosts: [{ label: "10.0.0.1", bytes: 100, flows: 1, hostnames: [], evidence: [] }], captureSessionId: "chain-A", snapshotSequence: 1 },
      null
    );
    const consumerB_S1 = deriveHostEnrichmentSnapshot(
      { hosts: [{ label: "10.0.0.1", bytes: 500, flows: 5, hostnames: [], evidence: [] }], captureSessionId: "chain-B", snapshotSequence: 1 },
      null
    );

    const consumerA_S2 = deriveHostEnrichmentSnapshot(
      { hosts: [{ label: "10.0.0.1", bytes: 160, flows: 2, hostnames: [], evidence: [] }], captureSessionId: "chain-A", snapshotSequence: 2 },
      consumerA_S1
    );
    const consumerB_S2 = deriveHostEnrichmentSnapshot(
      { hosts: [{ label: "10.0.0.1", bytes: 700, flows: 7, hostnames: [], evidence: [] }], captureSessionId: "chain-B", snapshotSequence: 2 },
      consumerB_S1
    );

    expect(consumerA_S2.hostsById.get("10.0.0.1")?.deltaBytes).toBe(60);
    expect(consumerB_S2.hostsById.get("10.0.0.1")?.deltaBytes).toBe(200);
  });

  it("9. Coverage telemetry: correctly calculates endpoint-count coverage and resolvedBytesPercent exclusively from public traffic", () => {
    // 19 resolved public endpoints carrying 100 bytes each (1,900 bytes total)
    const resolvedRows: BreakdownRow[] = Array.from({ length: 19 }, (_, i) => ({
      label: `1.1.1.${i + 1}`,
      bytes: 100,
      flows: 1,
      hostnames: [],
      evidence: [],
    }));

    // 1 unmapped/unresolved public endpoint carrying 17,100 bytes (90% of public traffic)
    const unresolvedPublicRow: BreakdownRow = {
      label: "93.184.216.34",
      bytes: 17_100,
      flows: 10,
      hostnames: [],
      evidence: [],
    };

    // Private LAN & Special endpoints (must not skew public coverage metrics)
    const privateRow: BreakdownRow = {
      label: "192.168.1.1",
      bytes: 50_000,
      flows: 5,
      hostnames: [],
      evidence: [],
    };
    const multicastRow: BreakdownRow = {
      label: "239.255.255.250",
      bytes: 25_000,
      flows: 2,
      hostnames: [],
      evidence: [],
    };
    const docSpecialRow: BreakdownRow = {
      label: "192.0.2.1",
      bytes: 10_000,
      flows: 1,
      hostnames: [],
      evidence: [],
    };

    const snapshot = deriveHostEnrichmentSnapshot(
      {
        hosts: [...resolvedRows, unresolvedPublicRow, privateRow, multicastRow, docSpecialRow],
        captureSessionId: "coverage-test",
        snapshotSequence: 1,
      },
      null
    );

    const stats = snapshot.coverageStats;

    // Total observed hosts includes public + LAN + special
    expect(stats.totalObservedHosts).toBe(23);
    expect(stats.publicHostsCount).toBe(20);
    expect(stats.resolvedHostsCount).toBe(19);
    expect(stats.unresolvedHostsCount).toBe(1);
    expect(stats.localLanHostsCount).toBe(2);
    expect(stats.specialHostsCount).toBe(1);

    // Total traffic vs public traffic segregation
    expect(stats.totalBytes).toBe(1900 + 17_100 + 50_000 + 25_000 + 10_000);
    expect(stats.resolvedBytes).toBe(1900);
    expect(stats.unresolvedBytes).toBe(17_100);

    // Endpoint-count coverage: 19 / 20 = 95%
    expect(stats.coveragePercent).toBe(95);

    // Byte-weighted coverage: 1,900 / (1,900 + 17,100) = 1,900 / 19,000 = 10%
    // Operationally highlighting that 90% of public traffic is unmapped despite 95% endpoint coverage
    expect(stats.resolvedBytesPercent).toBe(10);
  });
});
