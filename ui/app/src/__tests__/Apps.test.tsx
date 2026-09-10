import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import type { MonitorSnapshot } from "@netpulse/contract";
import { Apps } from "../screens/Apps";
import { useAppsController } from "../hooks/useAppsController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { setMonitor, setFeed, resetSession, __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function AppsTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Apps />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

const mockBaseSnapshot: MonitorSnapshot = {
  by_protocol: { dimension: "protocol", rows: [] },
  by_host: { dimension: "host", rows: [] },
  diagnoses: [],
  network_loss_indicators: 0,
  capture_drops: 0,
  processes: [],
  lineage: [],
};

describe("Apps Screen & useAppsController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders skeleton loading state when monitor has not arrived yet", () => {
    render(<AppsTestWrapper />);
    expect(screen.getByLabelText("Applications loading")).toBeInTheDocument();
  });

  it("renders empty state when monitor contains no processes", async () => {
    setMonitor(mockBaseSnapshot);
    render(<AppsTestWrapper />);

    expect(
      await screen.findByText("No attributed applications captured yet. Start a capture session to populate process lineage.")
    ).toBeInTheDocument();
  });

  it("renders applications during active capture with zero narrative cards (NET-DATA-001 acceptance criteria)", async () => {
    setFeed([]); // Zero narrative cards in feed
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          pid: 4092,
          name: "chrome.exe",
          flows: 3,
          bytes: 1024,
          packets: 10,
        },
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("Attributed Apps")).toBeInTheDocument();
    expect(screen.getByText("chrome.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 4092")).toBeInTheDocument();
    expect(screen.getByText("3 flows")).toBeInTheDocument();
    expect(screen.queryByText("No attributed applications captured yet.")).not.toBeInTheDocument();
  });

  it("controller hook groups by process directly from authoritative monitor.processes", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "chrome.exe",
          pid: 4092,
          flows: 1,
          flowIds: [101],
          bytes: 1024,
          packets: 10,
        } as any,
      ],
    });

    const { result } = renderHook(() => useAppsController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.groupedProcesses.length).toBe(1);
    const group = result.current.groupedProcesses[0]!;
    expect(group.processName).toBe("chrome.exe");
    expect(group.pid).toBe(4092);
    expect(group.confidence).toBe("high");
    expect(group.flowIds).toEqual([101]);
  });

  it("renders summary KPIs, process table, and allows row expansion to inspect flows", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "slack.exe",
          pid: 8192,
          flows: 1,
          flowIds: [202],
          confidence: "high",
          bytes: 2000,
          packets: 20,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("Attributed Apps")).toBeInTheDocument();
    expect(screen.getByText("slack.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 8192")).toBeInTheDocument();

    const expandButton = screen.getByRole("button", { name: /Expand slack.exe/i });
    fireEvent.click(expandButton);

    expect(await screen.findByText("Flow #202")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inspect Flow/i })).toBeInTheDocument();
  });

  it("filters process groups by search query and confidence level buttons", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "curl.exe",
          pid: 1234,
          flows: 1,
          flowIds: [303],
          confidence: "low",
          bytes: 3000,
          packets: 30,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("curl.exe")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search applications by process name, PID, or flow ID...");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    expect(
      await screen.findByText("No applications match the current search query or confidence filter.")
    ).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: "Clear Filter" });
    fireEvent.click(clearButton);

    expect(await screen.findByText("curl.exe")).toBeInTheDocument();
  });

  it("supports interactive KPI tiles to filter by confidence and reset to all", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "trusted.exe",
          pid: 100,
          flows: 1,
          flowIds: [401],
          confidence: "high",
          bytes: 4000,
          packets: 40,
        } as any,
        {
          name: "unknown owner",
          pid: null,
          flows: 1,
          flowIds: [402],
          confidence: "unknown",
          bytes: 4001,
          packets: 41,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("trusted.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();

    // Click High Confidence KPI tile to filter
    const highKpi = screen.getByRole("button", { name: /High Confidence: 1/i });
    fireEvent.click(highKpi);

    expect(screen.getByText("trusted.exe")).toBeInTheDocument();
    expect(screen.queryByText("unknown owner")).not.toBeInTheDocument();

    // Re-clicking High Confidence KPI tile toggles back to All
    fireEvent.click(highKpi);
    expect(screen.getByText("trusted.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();

    // Click Unattributed KPI tile to filter to unknown
    const unknownKpi = screen.getByRole("button", { name: /Unattributed: 1/i });
    fireEvent.click(unknownKpi);
    expect(screen.queryByText("trusted.exe")).not.toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();

    // Click Total Apps KPI tile to reset filter to All
    const totalAppsKpi = screen.getByRole("button", { name: /Attributed Apps: 2/i });
    fireEvent.click(totalAppsKpi);
    expect(screen.getByText("trusted.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();

    // Click High Confidence filter pill button in the filter bar
    const highPill = screen.getByRole("button", { name: "Filter by High Confidence" });
    fireEvent.click(highPill);
    expect(screen.getByText("trusted.exe")).toBeInTheDocument();
    expect(screen.queryByText("unknown owner")).not.toBeInTheDocument();

    // Re-clicking High Confidence filter pill toggles back to All
    fireEvent.click(highPill);
    expect(screen.getByText("trusted.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();
  });

  it("supports search clear button and Escape key without resetting confidence filter", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "alpha.exe",
          pid: 5001,
          flows: 1,
          flowIds: [501],
          confidence: "high",
          bytes: 5000,
          packets: 50,
        } as any,
        {
          name: "beta.exe",
          pid: 5002,
          flows: 1,
          flowIds: [502],
          confidence: "high",
          bytes: 5001,
          packets: 51,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("alpha.exe")).toBeInTheDocument();
    expect(screen.getByText("beta.exe")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search applications by process name, PID, or flow ID...");
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    expect(screen.getByText("alpha.exe")).toBeInTheDocument();
    expect(screen.queryByText("beta.exe")).not.toBeInTheDocument();

    // Clear search using integrated clear button
    const clearBtn = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(clearBtn);

    expect(screen.getByText("alpha.exe")).toBeInTheDocument();
    expect(screen.getByText("beta.exe")).toBeInTheDocument();

    // Test Escape key clearing
    fireEvent.change(searchInput, { target: { value: "beta" } });
    expect(screen.queryByText("alpha.exe")).not.toBeInTheDocument();
    expect(screen.getByText("beta.exe")).toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: "Escape", code: "Escape" });
    expect(screen.getByText("alpha.exe")).toBeInTheDocument();
    expect(screen.getByText("beta.exe")).toBeInTheDocument();
  });

  it("supports independent multi-row expansion and collapse", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "proc1.exe",
          pid: 6010,
          flows: 1,
          flowIds: [601],
          confidence: "high",
          bytes: 6000,
          packets: 60,
        } as any,
        {
          name: "proc2.exe",
          pid: 6020,
          flows: 1,
          flowIds: [602],
          confidence: "high",
          bytes: 6001,
          packets: 61,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("proc1.exe")).toBeInTheDocument();
    expect(screen.getByText("proc2.exe")).toBeInTheDocument();

    const expand1 = screen.getByRole("button", { name: /Expand proc1.exe/i });
    const expand2 = screen.getByRole("button", { name: /Expand proc2.exe/i });

    // Expand proc1
    fireEvent.click(expand1);
    expect(await screen.findByText("Flow #601")).toBeInTheDocument();

    // Expand proc2 (both remain expanded simultaneously)
    fireEvent.click(expand2);
    expect(await screen.findByText("Flow #602")).toBeInTheDocument();
    expect(screen.getByText("Flow #601")).toBeInTheDocument();

    // Collapse proc1; proc2 remains expanded
    const collapse1 = screen.getByRole("button", { name: /Collapse proc1.exe/i });
    fireEvent.click(collapse1);
    expect(screen.queryByText("Flow #601")).not.toBeInTheDocument();
    expect(screen.getByText("Flow #602")).toBeInTheDocument();
  });

  it("navigates to flow evidence when inspect button is clicked without collapsing the row", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "inspectable.exe",
          pid: 7010,
          flows: 1,
          flowIds: [701],
          confidence: "high",
          bytes: 7000,
          packets: 70,
        } as any,
      ],
    });

    let capturedEvidence: any = null;
    function CustomWrapper() {
      const nav = useEvidenceNavigation();
      return (
        <div>
          <button
            type="button"
            data-testid="check-nav"
            onClick={() => {
              capturedEvidence = nav.navigationTarget;
            }}
          >
            Check
          </button>
          <Apps />
        </div>
      );
    }

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <CustomWrapper />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    expect(await screen.findByText("inspectable.exe")).toBeInTheDocument();

    const expandBtn = screen.getByRole("button", { name: /Expand inspectable.exe/i });
    fireEvent.click(expandBtn);

    expect(await screen.findByText("Flow #701")).toBeInTheDocument();

    const inspectBtn = screen.getByRole("button", { name: /Inspect Flow #701/i });
    fireEvent.click(inspectBtn);

    // Row should still be expanded and navigation target should be set
    expect(screen.getByText("Flow #701")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("check-nav"));
    expect(capturedEvidence).toEqual({ screen: "apps", flowId: 701 });
  });

  it("derives fallback group from monitor.lineage when processes array is empty", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [],
      lineage: [
        {
          source: "192.168.1.5",
          destination: "1.1.1.1",
          protocol: "UDP",
          bytes: 500,
          packets: 5,
          direction: "outbound",
          flow_count: 2,
          classification: "ExternalWan" as any,
        },
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("Unattributed Flows")).toBeInTheDocument();
    expect(screen.getByText("2 flows")).toBeInTheDocument();
  });

  it("never executes attributionOfFlow or any IPC query on page render (NET-PERF-002)", async () => {
    const ipcSpy = vi.spyOn(ipcModule, "query");

    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "chrome.exe",
          pid: 4092,
          flows: 2,
          flowIds: [101, 102],
          bytes: 1024,
          packets: 10,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("chrome.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 4092")).toBeInTheDocument();

    // Confirm zero IPC queries on page render
    expect(ipcSpy).not.toHaveBeenCalled();
  });

  it("never triggers attributionOfFlow IPC queries when navigating with target flow evidence (NET-PERF-002)", async () => {
    const ipcSpy = vi.spyOn(ipcModule, "query");

    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "firefox.exe",
          pid: 5012,
          flows: 1,
          flowIds: [888],
          bytes: 2048,
          packets: 15,
        } as any,
      ],
    });

    function TargetNavTestWrapper() {
      const nav = useEvidenceNavigation();
      return (
        <div>
          <button
            type="button"
            data-testid="trigger-target-nav"
            onClick={() => nav.navigateToEvidence({ kind: "flow", id: 888 }, "apps")}
          >
            Go to flow 888
          </button>
          <Apps />
        </div>
      );
    }

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <TargetNavTestWrapper />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    expect(await screen.findByText("firefox.exe")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("trigger-target-nav"));

    expect(screen.getByText("firefox.exe")).toBeInTheDocument();
    // Verify zero attributionOfFlow calls
    const attributionCalls = ipcSpy.mock.calls.filter(
      ([req]) => (req as any)?.kind === "attributionOfFlow"
    );
    expect(attributionCalls).toHaveLength(0);
    expect(ipcSpy).not.toHaveBeenCalled();
  });

  it("sanitizes whitespace in aria-controls and row id for processes with spaces in their name", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "Google Chrome",
          pid: 9001,
          flows: 1,
          flowIds: [901],
          bytes: 1000,
          packets: 10,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("Google Chrome")).toBeInTheDocument();

    const expandBtn = screen.getByRole("button", { name: /Expand Google Chrome/i });
    const ariaControls = expandBtn.getAttribute("aria-controls");
    expect(ariaControls).toBeDefined();
    // HTML id must not contain whitespace
    expect(ariaControls).not.toMatch(/\s/);
    expect(ariaControls).toBe("flow-lineage-Google-Chrome:9001");

    fireEvent.click(expandBtn);
    const expandedRow = document.getElementById(ariaControls!);
    expect(expandedRow).toBeInTheDocument();
  });

  it("deduplicates flowIds when raw telemetry contains duplicate IDs", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "dup.exe",
          pid: 8888,
          flows: 1,
          flowIds: [777, 777, 777],
          bytes: 1000,
          packets: 10,
        } as any,
      ],
    });

    const { result } = renderHook(() => useAppsController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.groupedProcesses.length).toBe(1);
    expect(result.current.groupedProcesses[0]!.flowIds).toEqual([777]);
    expect(result.current.groupedProcesses[0]!.flowsCount).toBe(1);
  });

  it("invalidates in-memory attribution and flushes cached rows on capture session reset (NET-DATA-003)", async () => {
    // Session A: populate with chrome.exe owning flow #1
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "chrome.exe",
          pid: 1001,
          flows: 1,
          flowIds: [1],
          bytes: 1000,
          packets: 10,
        } as any,
      ],
    });

    const { result } = renderHook(() => useAppsController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.groupedProcesses.length).toBe(1);
    expect(result.current.groupedProcesses[0]?.processName).toBe("chrome.exe");
    expect(result.current.rows.length).toBe(1);
    expect(result.current.rows[0]?.flowId).toBe(1);
    expect(result.current.rows[0]?.attr.process_name).toBe("chrome.exe");

    // Expand row in Session A
    act(() => {
      result.current.toggleExpandGroup("chrome.exe:1001");
    });
    expect(result.current.expandedKeys.has("chrome.exe:1001")).toBe(true);

    // Reset session via resetSession(); verify all previous attributions and expansions are cleared
    act(() => {
      resetSession("session-B");
    });

    expect(result.current.groupedProcesses.length).toBe(0);
    expect(result.current.rows.length).toBe(0);
    expect(result.current.loaded).toBe(false);
    expect(result.current.expandedKeys.size).toBe(0);

    // Session B: telemetry arrives where flow #1 is reused by firefox.exe
    act(() => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "firefox.exe",
            pid: 2002,
            flows: 1,
            flowIds: [1],
            bytes: 2000,
            packets: 20,
          } as any,
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    // Old attributions never display in new sessions; flow #1 in session B reflects session B's process
    expect(result.current.groupedProcesses.length).toBe(1);
    expect(result.current.groupedProcesses[0]?.processName).toBe("firefox.exe");
    expect(result.current.groupedProcesses[0]?.pid).toBe(2002);
    expect(result.current.rows.length).toBe(1);
    expect(result.current.rows[0]?.flowId).toBe(1);
    expect(result.current.rows[0]?.attr.process_name).toBe("firefox.exe");
    expect(result.current.rows[0]?.attr.pid).toBe(2002);
  });

  it("ensures Apps screen never displays stale attributions across capture restarts (NET-DATA-003 component verification)", async () => {
    // Session A active capture
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "curl.exe",
          pid: 5555,
          flows: 1,
          flowIds: [42],
          bytes: 500,
          packets: 5,
        } as any,
      ],
    });

    const { rerender } = render(<AppsTestWrapper />);

    expect(await screen.findByText("curl.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 5555")).toBeInTheDocument();

    // Reset session
    act(() => {
      resetSession("session-restarted");
    });

    rerender(<AppsTestWrapper />);

    // Old attributions immediately cleared, shows loading skeleton for fresh session
    expect(screen.queryByText("curl.exe")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Applications loading")).toBeInTheDocument();

    // Post-restart telemetry arrives
    act(() => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "wget.exe",
            pid: 6666,
            flows: 1,
            flowIds: [42],
            bytes: 600,
            packets: 6,
          } as any,
        ],
      });
    });

    rerender(<AppsTestWrapper />);

    expect(await screen.findByText("wget.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 6666")).toBeInTheDocument();
    expect(screen.queryByText("curl.exe")).not.toBeInTheDocument();
  });

  it("filters processes using multi-term space-separated search queries", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "chrome.exe",
          pid: 4092,
          flows: 1,
          flowIds: [101],
          bytes: 1000,
          packets: 10,
        } as any,
        {
          name: "firefox.exe",
          pid: 5012,
          flows: 1,
          flowIds: [102],
          bytes: 2000,
          packets: 20,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("chrome.exe")).toBeInTheDocument();
    expect(screen.getByText("firefox.exe")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search applications by process name, PID, or flow ID...");
    // Search with multi-term: name and pid
    fireEvent.change(searchInput, { target: { value: "chrome 4092" } });

    expect(screen.getByText("chrome.exe")).toBeInTheDocument();
    expect(screen.queryByText("firefox.exe")).not.toBeInTheDocument();

    // Search with multi-term: name and flow id
    fireEvent.change(searchInput, { target: { value: "firefox 102" } });
    expect(screen.queryByText("chrome.exe")).not.toBeInTheDocument();
    expect(screen.getByText("firefox.exe")).toBeInTheDocument();
  });

  it("clears stale evidence navigation target when capture session resets", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "app.exe",
          pid: 1111,
          flows: 1,
          flowIds: [99],
          bytes: 100,
          packets: 1,
        } as any,
      ],
    });

    let navContextRef: any = null;
    function TargetWatcherWrapper() {
      const nav = useEvidenceNavigation();
      navContextRef = nav;
      return <Apps />;
    }

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <TargetWatcherWrapper />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    expect(await screen.findByText("app.exe")).toBeInTheDocument();

    // Navigate to flow 99
    act(() => {
      navContextRef.navigateToEvidence({ kind: "flow", id: 99 }, "apps");
    });

    expect(navContextRef.navigationTarget).toEqual({ screen: "apps", flowId: 99 });
    expect(screen.getByText("Filtered to target flow #99")).toBeInTheDocument();

    // Session reset occurs
    act(() => {
      resetSession("session-fresh");
    });

    // Stale target flow should be cleared so new session isn't stuck on flow #99
    expect(navContextRef.navigationTarget).toBeNull();
  });
});
