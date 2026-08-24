import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useTelemetryDeltas } from "../geo/useTelemetryDeltas";
import type { BreakdownRow } from "@netpulse/contract";

describe("useTelemetryDeltas hook", () => {
  it("Invariant 1: newly observed host entering mid-session receives delta = 0 as its baseline", () => {
    const s1Hosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] },
    ];

    const { result, rerender } = renderHook(
      ({ hosts, seq }: { hosts: BreakdownRow[]; seq: number }) =>
        useTelemetryDeltas(hosts, seq),
      { initialProps: { hosts: s1Hosts, seq: 1 } }
    );

    // Initial render / baseline
    expect(result.current.getDelta("1.1.1.1", 1000)).toBe(0);

    // Next snapshot adds 8.8.8.8 with 50 MB
    const s2Hosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1500, flows: 2, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 50_000_000, flows: 10, hostnames: [], evidence: [] },
    ];
    rerender({ hosts: s2Hosts, seq: 2 });

    expect(result.current.getDelta("1.1.1.1", 1500)).toBe(500);
    // Newly observed host must NOT emit full cumulative bytes as a burst
    expect(result.current.getDelta("8.8.8.8", 50_000_000)).toBe(0);

    // Snapshot 3 increments 8.8.8.8 by 4 KB
    const s3Hosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1600, flows: 2, hostnames: [], evidence: [] },
      { label: "8.8.8.8", bytes: 50_004_096, flows: 11, hostnames: [], evidence: [] },
    ];
    rerender({ hosts: s3Hosts, seq: 3 });

    expect(result.current.getDelta("1.1.1.1", 1600)).toBe(100);
    expect(result.current.getDelta("8.8.8.8", 50_004_096)).toBe(4096);
  });

  it("handles counter reset / rollover safely returning 0 delta", () => {
    const s1Hosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 500_000, flows: 10, hostnames: [], evidence: [] },
    ];

    const { result, rerender } = renderHook(
      ({ hosts, seq }: { hosts: BreakdownRow[]; seq: number }) =>
        useTelemetryDeltas(hosts, seq),
      { initialProps: { hosts: s1Hosts, seq: 1 } }
    );

    // Reset drops byte counter from 500,000 to 200
    const s2Hosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 200, flows: 1, hostnames: [], evidence: [] },
    ];
    rerender({ hosts: s2Hosts, seq: 2 });

    expect(result.current.getDelta("1.1.1.1", 200)).toBe(0);
  });
});
