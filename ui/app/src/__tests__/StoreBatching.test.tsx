import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NarrativeCard, MonitorSnapshot } from "@netpulse/contract";
import {
  setSnapshotBatch,
  setFeed,
  setMonitor,
  setError,
  subscribe,
  useStore,
  pushCards,
  getState,
  __resetForTest,
} from "../state/store";
import * as ipc from "../ipc";
import { triggerLiveRefresh, useLiveData } from "../state/useLiveData";
import { DisclosureProvider } from "../modes/DisclosureContext";

const mockCards: NarrativeCard[] = [
  {
    at_mono_nanos: 1000,
    headline: "DNS Latency Spike",
    severity: "notable",
    category: "dns",
    summary: "High DNS query latency observed",
    lines: ["High query latency on port 53"],
    evidence: [{ kind: "flow", id: 101 }],
  },
];

const mockMonitorSnapshot: MonitorSnapshot = {
  by_protocol: {
    dimension: "protocol",
    rows: [
      { label: "TCP", bytes: 1048576, flows: 10, hostnames: [], evidence: [] },
      { label: "UDP", bytes: 524288, flows: 5, hostnames: [], evidence: [] },
    ],
  },
  by_host: {
    dimension: "host",
    rows: [
      { label: "192.168.1.1", bytes: 1000000, flows: 12, hostnames: [], evidence: [] },
    ],
  },
  capture_stats: {
    buffer_capacity: 1000,
    buffer_frames: 200,
    shed_stage: "none",
    dropped: 0,
  },
  diagnoses: [],
  network_loss_indicators: 0,
  capture_drops: 0,
  diagnostic_chain: {
    stages: [],
  },
  telemetry_state: "active",
};

describe("Store Batching Performance & Atomicity (setSnapshotBatch)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetForTest();
  });

  it("updates both cards and monitor snapshot with a single store emission", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    // Call setSnapshotBatch with both cards and monitor snapshot
    setSnapshotBatch(mockCards, mockMonitorSnapshot);

    // Exactly 1 store emission must occur
    expect(listener).toHaveBeenCalledTimes(1);

    // In contrast, separate setFeed and setMonitor calls produce 2 separate emissions
    setFeed(mockCards);
    setMonitor(mockMonitorSnapshot);
    expect(listener).toHaveBeenCalledTimes(3); // 1 + 2 = 3

    unsubscribe();
  });

  it("prevents double-render cascades in React components consuming useStore", () => {
    let renderCount = 0;
    function TestConsumer() {
      const state = useStore();
      renderCount++;
      return (
        <div>
          <span data-testid="feed-count">{state.feed.length}</span>
          <span data-testid="seq">{state.snapshotSequence}</span>
        </div>
      );
    }

    render(<TestConsumer />);
    expect(renderCount).toBe(1);

    // Execute setSnapshotBatch with both cards and monitor
    act(() => {
      setSnapshotBatch(mockCards, mockMonitorSnapshot);
    });

    // Exactly 1 re-render pass should have occurred (from 1 to 2)
    expect(renderCount).toBe(2);

    // In contrast, sequential updates executed across async boundaries trigger 2 separate render passes
    act(() => {
      setFeed(mockCards);
    });
    expect(renderCount).toBe(3);

    act(() => {
      setMonitor(mockMonitorSnapshot);
    });
    expect(renderCount).toBe(4);
  });

  it("handles partial updates without emitting redundant notifications when no changes occur", () => {
    let renderCount = 0;
    function TestConsumer() {
      useStore();
      renderCount++;
      return null;
    }

    render(<TestConsumer />);
    expect(renderCount).toBe(1);

    // Passing null/null has no effect and must NOT emit
    act(() => {
      setSnapshotBatch(null, null);
    });
    expect(renderCount).toBe(1);

    // Passing only cards updates feed and emits once
    act(() => {
      setSnapshotBatch(mockCards, null);
    });
    expect(renderCount).toBe(2);

    // Passing only monitor updates monitor and emits once
    act(() => {
      setSnapshotBatch(null, mockMonitorSnapshot);
    });
    expect(renderCount).toBe(3);
  });

  it("clears error in the exact same batch without triggering an extra render pass", () => {
    setError("Connection lost");

    let renderCount = 0;
    function TestConsumer() {
      const { error } = useStore();
      renderCount++;
      return <span data-testid="error">{error ?? "none"}</span>;
    }

    const { getByTestId } = render(<TestConsumer />);
    expect(renderCount).toBe(1);
    expect(getByTestId("error").textContent).toBe("Connection lost");

    // Atomically recover: update feed, monitor, and clear error to null
    act(() => {
      setSnapshotBatch(mockCards, mockMonitorSnapshot, null);
    });

    // Must re-render exactly ONCE for the recovery
    expect(renderCount).toBe(2);
    expect(getByTestId("error").textContent).toBe("none");
  });

  it("ensures polling refresh executes queries and batches updates into a single notification", async () => {
    const querySpy = vi.spyOn(ipc, "query").mockImplementation(async (q) => {
      if (q.kind === "narrativeFeed") {
        return { kind: "narrativeFeed", cards: mockCards };
      }
      if (q.kind === "monitorSnapshot") {
        return { kind: "monitorSnapshot", snapshot: mockMonitorSnapshot };
      }
      throw new Error(`Unexpected query: ${JSON.stringify(q)}`);
    });

    let renderCount = 0;
    function PollingConsumer() {
      const state = useStore();
      useLiveData();
      renderCount++;
      return (
        <div>
          <span data-testid="feed-len">{state.feed.length}</span>
          <span data-testid="seq-num">{state.snapshotSequence}</span>
        </div>
      );
    }

    await act(async () => {
      render(
        <DisclosureProvider>
          <PollingConsumer />
        </DisclosureProvider>
      );
    });

    // Initial mount render (1) + async batch update from initial polling refresh (1) = 2
    expect(renderCount).toBe(2);

    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ kind: "narrativeFeed" }));
    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ kind: "monitorSnapshot" }));

    // Manually trigger a refresh cycle
    await act(async () => {
      triggerLiveRefresh();
    });

    // Should increment render count by exactly 1 (total: 3)
    expect(renderCount).toBe(3);
  });

  it("queues and executes pending refresh if a refresh is requested while one is already in flight", async () => {
    const resolvers: Array<() => void> = [];
    let queryCallCount = 0;

    vi.spyOn(ipc, "query").mockImplementation((q) => {
      queryCallCount++;
      if (queryCallCount <= 2) {
        return new Promise((resolve) => {
          resolvers.push(() => {
            if (q.kind === "narrativeFeed") resolve({ kind: "narrativeFeed", cards: mockCards });
            if (q.kind === "monitorSnapshot") resolve({ kind: "monitorSnapshot", snapshot: mockMonitorSnapshot });
          });
        });
      }
      if (q.kind === "narrativeFeed") return Promise.resolve({ kind: "narrativeFeed", cards: mockCards });
      if (q.kind === "monitorSnapshot") return Promise.resolve({ kind: "monitorSnapshot", snapshot: mockMonitorSnapshot });
      return Promise.reject(new Error("Unknown query"));
    });

    // Initial trigger: launches first 2 queries
    triggerLiveRefresh();
    expect(queryCallCount).toBe(2);

    // Trigger second refresh while first is in-flight: sets pendingRefresh = true
    triggerLiveRefresh();
    expect(queryCallCount).toBe(2);

    // Resolve the first 2 in-flight queries
    await act(async () => {
      for (const r of resolvers) r();
    });

    // The queued refresh should have executed, adding 2 more queries (total 4)
    expect(queryCallCount).toBe(4);
  });

  it("preserves lines and summary in pushCards when incoming delta has empty detail (prevents diagnostic flickering)", () => {
    // Prime feed with rich detail (lines and summary)
    setSnapshotBatch([
      {
        at_mono_nanos: 4_200_000_000,
        headline: "Connected to notify.bugsnag.com",
        summary: "15 KB from 1 server",
        lines: ["15 KB from 1 server"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 14 }],
      },
    ]);

    // Incoming delta arrives from a shallower projection with empty lines & summary
    act(() => {
      const deltaCard: NarrativeCard = {
        at_mono_nanos: 4_200_000_000,
        headline: "Connected to notify.bugsnag.com",
        summary: "",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 14 }],
      };
      pushCards([deltaCard]);
      const current = getState().feed[0];
      expect(current).toBeDefined();
      expect(current!.lines).toEqual(["15 KB from 1 server"]);
      expect(current!.summary).toBe("15 KB from 1 server");
    });
  });
});
