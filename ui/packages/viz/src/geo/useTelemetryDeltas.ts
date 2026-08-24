import { useEffect, useRef } from "react";
import type { BreakdownRow } from "@netpulse/contract";

/**
 * Stable, render-safe hook to calculate true positive interval byte deltas
 * between consecutive telemetry snapshots.
 *
 * Enforces:
 * 1. Snapshot Identity: Ignores duplicate or reordered snapshot iterations.
 * 2. Counter Reset Safety: Prevents massive bursts or negative deltas on capture restarts or counter decreases.
 * 3. Render Safety: Never mutates state during the render phase.
 */
export function useTelemetryDeltas(
  hosts: BreakdownRow[],
  snapshotIdentity?: string | number | null
): {
  getDelta: (label: string, currentBytes: number) => number;
  isNewSnapshot: boolean;
} {
  const previousMapRef = useRef<Map<string, number>>(new Map());
  const previousIdentityRef = useRef<string | number | BreakdownRow[] | null>(null);

  // Determine if this snapshot is new
  const identity = snapshotIdentity ?? hosts;
  const isDuplicateOrReordered =
    snapshotIdentity !== undefined &&
    snapshotIdentity !== null &&
    previousIdentityRef.current !== null &&
    snapshotIdentity === previousIdentityRef.current;

  // Capture current snapshot map synchronously for render pass calculations
  const currentMap = new Map<string, number>();
  const precalculatedDeltas = new Map<string, number>();

  for (const h of hosts) {
    const ip = h.label.trim();
    currentMap.set(ip, h.bytes);

    if (isDuplicateOrReordered || previousMapRef.current.size === 0) {
      precalculatedDeltas.set(ip, 0);
    } else {
      const prev = previousMapRef.current.get(ip);
      if (prev === undefined) {
        // FINDING-004 fix: New host appearing for the first time gets delta = 0 per Invariant 1.
        precalculatedDeltas.set(ip, 0);
      } else if (h.bytes < prev) {
        // Counter was reset or rolled over; do not create a fake burst
        precalculatedDeltas.set(ip, 0);
      } else {
        precalculatedDeltas.set(ip, h.bytes - prev);
      }
    }
  }

  // After render commit, commit current snapshot to previous
  useEffect(() => {
    previousMapRef.current = currentMap;
    previousIdentityRef.current = identity;
  }, [hosts, identity]);

  const getDelta = (label: string, currentBytes: number): number => {
    const ip = label.trim();
    if (precalculatedDeltas.has(ip)) {
      return precalculatedDeltas.get(ip)!;
    }
    if (isDuplicateOrReordered) {
      return 0;
    }
    const prev = previousMapRef.current.get(ip);
    if (prev === undefined || currentBytes < prev) {
      return 0;
    }
    return currentBytes - prev;
  };

  return { getDelta, isNewSnapshot: !isDuplicateOrReordered };
}

