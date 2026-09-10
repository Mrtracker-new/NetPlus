import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import type { MonitorSnapshot } from "@netpulse/contract";
import { Apps } from "../screens/Apps";
import { AppsSummary } from "../screens/Apps/AppsSummary";
import { resolveFlowDetails } from "../screens/Apps/ProcessRow";
import {
  useAppsController,
  resolveConservativeConfidence,
  aggregateConfidences,
} from "../hooks/useAppsController";
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

  it("computes lowConfidenceCount and renders interactive Tentative KPI tile with amber tier", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "secure.exe",
          pid: 101,
          flows: 2,
          flowIds: [1001, 1002],
          confidence: "high",
          bytes: 2000,
          packets: 20,
        } as any,
        {
          name: "tentative.exe",
          pid: 8990,
          flows: 1,
          flowIds: [1003],
          confidence: "low",
          bytes: 1000,
          packets: 10,
        } as any,
        {
          name: "unknown owner",
          pid: null,
          flows: 1,
          flowIds: [1004],
          confidence: "unknown",
          bytes: 500,
          packets: 5,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("secure.exe")).toBeInTheDocument();
    expect(screen.getByText("tentative.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();

    // Verify Tentative KPI tile exists, shows lowConfidenceCount = 1, and has data-tier="low"
    const tentativeKpi = screen.getByRole("button", { name: /Tentative: 1/i });
    expect(tentativeKpi).toBeInTheDocument();
    expect(tentativeKpi).toHaveAttribute("data-tier", "low");
    expect(tentativeKpi).toHaveAttribute("data-has-count", "true");
    expect(tentativeKpi).toHaveAttribute("data-active", "false");
    expect(tentativeKpi).toHaveAttribute("aria-pressed", "false");

    // Click Tentative KPI tile to filter
    fireEvent.click(tentativeKpi);

    expect(tentativeKpi).toHaveAttribute("data-active", "true");
    expect(tentativeKpi).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("tentative.exe")).toBeInTheDocument();
    expect(screen.queryByText("secure.exe")).not.toBeInTheDocument();
    expect(screen.queryByText("unknown owner")).not.toBeInTheDocument();

    // Click Tentative tile again to toggle back to All
    fireEvent.click(tentativeKpi);

    expect(tentativeKpi).toHaveAttribute("data-active", "false");
    expect(tentativeKpi).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("secure.exe")).toBeInTheDocument();
    expect(screen.getByText("tentative.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown owner")).toBeInTheDocument();
  });

  it("computes summaryMetrics breakdown accurately including lowConfidenceCount", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        { name: "high1.exe", pid: 1, flows: 2, flowIds: [1, 2], confidence: "high", bytes: 100, packets: 1 } as any,
        { name: "high2.exe", pid: 2, flows: 1, flowIds: [3], confidence: "high", bytes: 100, packets: 1 } as any,
        { name: "low1.exe", pid: 3, flows: 1, flowIds: [4], confidence: "low", bytes: 100, packets: 1 } as any,
        { name: "low2.exe", pid: 4, flows: 3, flowIds: [5, 6, 7], confidence: "low", bytes: 100, packets: 1 } as any,
        { name: "unknown owner", pid: null, flows: 1, flowIds: [8], confidence: "unknown", bytes: 100, packets: 1 } as any,
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

    expect(result.current.summaryMetrics).toEqual({
      totalApps: 5,
      totalFlows: 8,
      highConfidenceCount: 2,
      lowConfidenceCount: 2,
      unattributedCount: 1,
    });
  });

  it("toggles sort by flow count on Active Flows KPI tile click without resetting confidence filter", async () => {
    setMonitor({
      ...mockBaseSnapshot,
      processes: [
        {
          name: "high-few-flows.exe",
          pid: 101,
          flows: 2,
          flowIds: [1001, 1002],
          confidence: "high",
          bytes: 2000,
          packets: 20,
        } as any,
        {
          name: "low-many-flows.exe",
          pid: 102,
          flows: 15,
          flowIds: [2001, 2002],
          confidence: "low",
          bytes: 15000,
          packets: 150,
        } as any,
        {
          name: "unknown-top-flows",
          pid: null,
          flows: 30,
          flowIds: [3001],
          confidence: "unknown",
          bytes: 30000,
          packets: 300,
        } as any,
      ],
    });

    render(<AppsTestWrapper />);

    expect(await screen.findByText("high-few-flows.exe")).toBeInTheDocument();
    expect(screen.getByText("low-many-flows.exe")).toBeInTheDocument();
    expect(screen.getByText("unknown-top-flows")).toBeInTheDocument();

    // Default multi-tier sorting: High confidence first -> Low -> Unknown
    const rowsInitial = screen.getAllByRole("row");
    expect(rowsInitial[1]).toHaveTextContent("high-few-flows.exe");
    expect(rowsInitial[2]).toHaveTextContent("low-many-flows.exe");
    expect(rowsInitial[3]).toHaveTextContent("unknown-top-flows");

    // Locate Active Flows KPI tile
    const activeFlowsKpi = screen.getByRole("button", { name: /Active Flows: 47/i });
    expect(activeFlowsKpi).toBeInTheDocument();
    expect(activeFlowsKpi).toHaveAttribute("data-tier", "flows");
    expect(activeFlowsKpi).toHaveAttribute("data-active", "false");
    expect(activeFlowsKpi).toHaveAttribute("aria-pressed", "false");
    expect(activeFlowsKpi).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Click to toggle sort by flow count.")
    );

    // Filter to tentative (low) confidence first to verify confidence is NOT reset
    const tentativeKpi = screen.getByRole("button", { name: /Tentative: 1/i });
    fireEvent.click(tentativeKpi);
    expect(screen.getByText("low-many-flows.exe")).toBeInTheDocument();
    expect(screen.queryByText("high-few-flows.exe")).not.toBeInTheDocument();
    expect(screen.queryByText("unknown-top-flows")).not.toBeInTheDocument();

    // Click Active Flows KPI tile: must NOT reset confidence filter to 'all'
    fireEvent.click(activeFlowsKpi);

    expect(activeFlowsKpi).toHaveAttribute("data-active", "true");
    expect(activeFlowsKpi).toHaveAttribute("aria-pressed", "true");
    // Confidence filter is still 'low'!
    expect(screen.getByText("low-many-flows.exe")).toBeInTheDocument();
    expect(screen.queryByText("high-few-flows.exe")).not.toBeInTheDocument();
    expect(screen.queryByText("unknown-top-flows")).not.toBeInTheDocument();

    // Clear confidence filter to 'all'
    const totalAppsKpi = screen.getByRole("button", { name: /Attributed Apps: 3/i });
    fireEvent.click(totalAppsKpi);

    // When all processes visible and sortByFlows is true:
    // Process with most flows ranks first: unknown-top-flows (30) -> low-many-flows (15) -> high-few-flows (2)
    const rowsSorted = screen.getAllByRole("row");
    expect(rowsSorted[1]).toHaveTextContent("unknown-top-flows");
    expect(rowsSorted[2]).toHaveTextContent("low-many-flows.exe");
    expect(rowsSorted[3]).toHaveTextContent("high-few-flows.exe");

    // Click Active Flows tile again to toggle sort by flows off
    fireEvent.click(activeFlowsKpi);
    expect(activeFlowsKpi).toHaveAttribute("data-active", "false");
    expect(activeFlowsKpi).toHaveAttribute("aria-pressed", "false");

    // Restores default multi-tier confidence-first ordering
    const rowsDefaultAgain = screen.getAllByRole("row");
    expect(rowsDefaultAgain[1]).toHaveTextContent("high-few-flows.exe");
    expect(rowsDefaultAgain[2]).toHaveTextContent("low-many-flows.exe");
    expect(rowsDefaultAgain[3]).toHaveTextContent("unknown-top-flows");
  });

  it("AppsSummary component delegates Active Flows click to onToggleSortByFlows and displays active state", () => {
    const onToggleSortByFlows = vi.fn();
    const onSelectConfidence = vi.fn();
    const metrics = {
      totalApps: 3,
      totalFlows: 42,
      highConfidenceCount: 1,
      lowConfidenceCount: 1,
      unattributedCount: 1,
    };

    const { rerender } = render(
      <AppsSummary
        metrics={metrics}
        activeConfidence="all"
        onSelectConfidence={onSelectConfidence}
        sortByFlows={false}
        onToggleSortByFlows={onToggleSortByFlows}
      />
    );

    const flowsBtn = screen.getByRole("button", { name: /Active Flows: 42/i });
    expect(flowsBtn).toHaveAttribute("data-active", "false");
    expect(flowsBtn).toHaveAttribute("aria-pressed", "false");
    expect(flowsBtn).toHaveAttribute(
      "aria-label",
      "Active Flows: 42. Click to toggle sort by flow count."
    );

    fireEvent.click(flowsBtn);
    expect(onToggleSortByFlows).toHaveBeenCalledTimes(1);
    expect(onSelectConfidence).not.toHaveBeenCalled();

    // Rerender with sortByFlows={true}
    rerender(
      <AppsSummary
        metrics={metrics}
        activeConfidence="all"
        onSelectConfidence={onSelectConfidence}
        sortByFlows={true}
        onToggleSortByFlows={onToggleSortByFlows}
      />
    );

    expect(flowsBtn).toHaveAttribute("data-active", "true");
    expect(flowsBtn).toHaveAttribute("aria-pressed", "true");
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

  it("opens detailed inspection plate when inspect button is clicked without circular navigation loop", async () => {
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
      lineage: [
        {
          source: "192.168.1.45:51234",
          destination: "api.inspectable.com:443",
          protocol: "HTTPS",
          bytes: 7000,
          packets: 70,
          direction: "outbound",
          flow_count: 1,
          classification: "external_wan",
          pid: 7010,
          flow_id: 701,
          rtt_ms: 18.5,
          state: "ESTABLISHED",
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

    // Row should still be expanded and navigation target should NOT be set (no circular loop)
    expect(screen.getByText("Flow #701")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("check-nav"));
    expect(capturedEvidence).toBeNull();

    // Verify detailed inspection plate is open
    const plate = screen.getByTestId("flow-inspection-plate");
    expect(plate).toBeInTheDocument();
    expect(within(plate).getByText(/Flow #701 Inspection Plate/i)).toBeInTheDocument();

    // Acceptance Criteria: User can see full socket addresses, ports, and metrics
    expect(screen.getByTestId("flow-5tuple")).toHaveTextContent(
      "192.168.1.45:51234 → api.inspectable.com:443 (HTTPS)"
    );
    expect(screen.getByTestId("flow-source-socket")).toHaveTextContent("192.168.1.45:51234");
    expect(screen.getByTestId("flow-destination-socket")).toHaveTextContent("api.inspectable.com:443");
    expect(screen.getByTestId("flow-state")).toHaveTextContent("ESTABLISHED");
    expect(screen.getByTestId("flow-bytes")).toHaveTextContent(/7 KB/);
    expect(screen.getByTestId("flow-packets")).toHaveTextContent("70");
    expect(screen.getByTestId("flow-rtt")).toHaveTextContent("18.5 ms");

    // Close button dismisses inspection plate
    const closeBtn = within(plate).getByRole("button", { name: /Close flow inspection/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("flow-inspection-plate")).not.toBeInTheDocument();
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

  describe("Socket Lineage in Expanded Row Tray", () => {
    it("displays communicating endpoint hostnames/IPs, protocol badges, direction badges, bandwidth, and classification", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "curl.exe",
            pid: 4321,
            flows: 1,
            flowIds: [301],
            bytes: 65536,
            packets: 40,
          } as any,
        ],
        lineage: [
          {
            source: "192.168.1.50",
            destination: "api.github.com",
            protocol: "HTTPS",
            bytes: 65536,
            packets: 40,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
          },
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const expandBtn = screen.getByRole("button", { name: /Expand curl.exe/i });
      fireEvent.click(expandBtn);

      // Acceptance Criteria 1: Expanded tray displays communicating endpoint hostnames/IPs
      expect(screen.getByText("api.github.com")).toBeInTheDocument();
      expect(screen.getByText("from 192.168.1.50")).toBeInTheDocument();

      // Acceptance Criteria 2: Protocol and direction badges rendered for each lineage conduit
      expect(screen.getByLabelText("Protocol: HTTPS")).toHaveTextContent("HTTPS");
      expect(screen.getByLabelText("Direction: Outbound")).toHaveTextContent("Outbound");

      // Required Change: display endpoint pairs (Destination, Protocol, Bandwidth, Classification)
      expect(screen.getByLabelText("Classification: External WAN")).toHaveTextContent("External WAN");
      expect(screen.getByLabelText("Bandwidth: 64 KB")).toHaveTextContent("64 KB");

      // Active flow ID inspection preserved
      expect(screen.getByText("Flow #301")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Inspect Flow #301/i })).toBeInTheDocument();
    });

    it("correlates lineage conduits to specific processes in multi-process snapshots", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "chrome.exe",
            pid: 1001,
            flows: 1,
            flowIds: [10],
            bytes: 1048576,
            packets: 500,
          } as any,
          {
            name: "spotify.exe",
            pid: 2002,
            flows: 1,
            flowIds: [20],
            bytes: 2097152,
            packets: 1000,
          } as any,
          {
            name: "slack.exe",
            pid: 3003,
            flows: 1,
            flowIds: [30],
            bytes: 5000,
            packets: 10,
          } as any,
        ],
        lineage: [
          {
            source: "192.168.1.100",
            destination: "google.com",
            protocol: "HTTPS",
            bytes: 1048576,
            packets: 500,
            direction: "outbound",
            flow_count: 1,
            classification: "cdn_edge",
            process_name: "chrome.exe",
            pid: 1001,
          } as any,
          {
            source: "192.168.1.100",
            destination: "audio-ak.spotify.com",
            protocol: "TCP",
            bytes: 2097152,
            packets: 1000,
            direction: "outbound",
            flow_count: 1,
            classification: "cdn_edge",
            process_name: "spotify.exe",
            pid: 2002,
          } as any,
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("chrome.exe")).toBeInTheDocument();
      expect(screen.getByText("spotify.exe")).toBeInTheDocument();
      expect(screen.getByText("slack.exe")).toBeInTheDocument();

      // Expand chrome.exe
      const expandChrome = screen.getByRole("button", { name: /Expand chrome.exe/i });
      fireEvent.click(expandChrome);

      expect(screen.getByText("google.com")).toBeInTheDocument();
      expect(screen.queryByText("audio-ak.spotify.com")).not.toBeInTheDocument();

      // Expand spotify.exe
      const expandSpotify = screen.getByRole("button", { name: /Expand spotify.exe/i });
      fireEvent.click(expandSpotify);

      expect(screen.getByText("audio-ak.spotify.com")).toBeInTheDocument();

      // Expand slack.exe (has flow #30, but no socket lineage in rawLineage)
      const expandSlack = screen.getByRole("button", { name: /Expand slack.exe/i });
      fireEvent.click(expandSlack);

      // Must display its own flow #30 and NEVER leak other processes' lineage
      expect(screen.getByText("Flow #30")).toBeInTheDocument();
      expect(screen.queryByText("slack.exe communicates with google.com")).not.toBeInTheDocument();
    });

    it("surfaces lineage for Unattributed Flows when processes array is empty", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [],
        lineage: [
          {
            source: "192.168.1.15",
            destination: "1.1.1.1",
            protocol: "DNS",
            bytes: 512,
            packets: 2,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
          },
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("Unattributed Flows")).toBeInTheDocument();

      const expandBtn = screen.getByRole("button", { name: /Expand Unattributed Flows/i });
      fireEvent.click(expandBtn);

      expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
      expect(screen.getByLabelText("Protocol: DNS")).toHaveTextContent("DNS");
      expect(screen.getByLabelText("Direction: Outbound")).toHaveTextContent("Outbound");
      expect(screen.getByLabelText("Classification: External WAN")).toHaveTextContent("External WAN");
      expect(screen.getByLabelText("Bandwidth: 512 B")).toHaveTextContent("512 B");
    });

    it("allows searching processes by communicating endpoint destination and protocol", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "browser.exe",
            pid: 1111,
            flows: 1,
            flowIds: [1],
            bytes: 1000,
            packets: 10,
          } as any,
          {
            name: "downloader.exe",
            pid: 2222,
            flows: 1,
            flowIds: [2],
            bytes: 2000,
            packets: 20,
          } as any,
        ],
        lineage: [
          {
            source: "10.0.0.1",
            destination: "cdn.cloudflare.net",
            protocol: "HTTPS",
            bytes: 1000,
            packets: 10,
            direction: "outbound",
            flow_count: 1,
            classification: "cdn_edge",
            pid: 1111,
          } as any,
          {
            source: "10.0.0.1",
            destination: "ftp.debian.org",
            protocol: "FTP",
            bytes: 2000,
            packets: 20,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
            pid: 2222,
          } as any,
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("browser.exe")).toBeInTheDocument();
      expect(screen.getByText("downloader.exe")).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText("Search applications by process name, PID, or flow ID...");
      
      // Search by endpoint hostname
      fireEvent.change(searchInput, { target: { value: "cloudflare" } });
      expect(screen.getByText("browser.exe")).toBeInTheDocument();
      expect(screen.queryByText("downloader.exe")).not.toBeInTheDocument();

      // Search by protocol
      fireEvent.change(searchInput, { target: { value: "FTP" } });
      expect(screen.queryByText("browser.exe")).not.toBeInTheDocument();
      expect(screen.getByText("downloader.exe")).toBeInTheDocument();
    });

    it("isolates untagged lineage to unattributed flows and prevents bleed into named processes in multi-process snapshots", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "isolated.exe",
            pid: 9999,
            flows: 1,
            flowIds: [999],
            bytes: 50000,
            packets: 25,
          } as any,
          {
            name: "Unattributed Flows",
            pid: null,
            flows: 2,
            bytes: 1000,
            packets: 10,
          } as any,
        ],
        // Raw lineage has zero process or flow tags
        lineage: [
          {
            source: "192.168.1.5",
            destination: "untagged-conduit.internal",
            protocol: "DNS",
            bytes: 1000,
            packets: 10,
            direction: "outbound",
            flow_count: 2,
            classification: "local_subnet",
          },
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("isolated.exe")).toBeInTheDocument();
      expect(screen.getByText("Unattributed Flows")).toBeInTheDocument();

      // Expand isolated.exe: should NOT show untagged-conduit.internal
      const expandIsolated = screen.getByRole("button", { name: /Expand isolated.exe/i });
      fireEvent.click(expandIsolated);

      expect(screen.getByText("Flow #999")).toBeInTheDocument();
      expect(screen.queryByText("untagged-conduit.internal")).not.toBeInTheDocument();

      // Expand Unattributed Flows: MUST show untagged-conduit.internal
      const expandUnattr = screen.getByRole("button", { name: /Expand Unattributed Flows/i });
      fireEvent.click(expandUnattr);

      expect(screen.getByText("untagged-conduit.internal")).toBeInTheDocument();
      expect(screen.getByLabelText("Protocol: DNS")).toBeInTheDocument();
    });

    it("discovers and exposes flow IDs embedded within lineage conduits for inspection", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "service.exe",
            pid: 7777,
            flows: 1,
            // process itself does not have flowIds array
            bytes: 2048,
            packets: 15,
          } as any,
        ],
        lineage: [
          {
            source: "192.168.1.20",
            destination: "service-api.domain.com",
            protocol: "HTTPS",
            bytes: 2048,
            packets: 15,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
            pid: 7777,
            flow_id: 888, // Discovered from conduit
          } as any,
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("service.exe")).toBeInTheDocument();

      const expandBtn = screen.getByRole("button", { name: /Expand service.exe/i });
      fireEvent.click(expandBtn);

      // Lineage endpoint
      expect(screen.getByText("service-api.domain.com")).toBeInTheDocument();

      // Discovered active flow ID from conduit
      expect(screen.getByText("Flow #888")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Inspect Flow #888/i })).toBeInTheDocument();
    });

    it("gracefully falls back when protocol is empty and formats bandwidth tooltip accurately", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "raw.exe",
            pid: 5555,
            flows: 1,
            flowIds: [555],
            bytes: 1024,
            packets: 2,
          } as any,
        ],
        lineage: [
          {
            source: "10.0.0.5",
            destination: "raw-packet.net",
            protocol: "", // empty protocol
            bytes: 1024,
            packets: 2,
            direction: "local",
            flow_count: 1,
            classification: "local_subnet",
            pid: 5555,
          } as any,
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("raw.exe")).toBeInTheDocument();

      const expandBtn = screen.getByRole("button", { name: /Expand raw.exe/i });
      fireEvent.click(expandBtn);

      expect(screen.getByText("raw-packet.net")).toBeInTheDocument();
      expect(screen.getByLabelText("Protocol: OTHER")).toHaveTextContent("OTHER");
      expect(screen.getByLabelText("Direction: Local")).toHaveTextContent("Local");
      expect(screen.getByTitle("Bandwidth: 1 KB (1024 bytes)")).toBeInTheDocument();
    });
  });

  describe("Inline Flow Inspection Drawer", () => {
    it("opens detailed inspection plate when inspect flow is clicked in active flow IDs list", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "service.exe",
            pid: 7777,
            flows: 1,
            bytes: 2048,
            packets: 15,
          } as any,
        ],
        lineage: [
          {
            source: "192.168.1.20:49210",
            destination: "service-api.domain.com:443",
            protocol: "HTTPS",
            bytes: 2048,
            packets: 15,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
            pid: 7777,
            flow_id: 888,
            rtt_ms: 24.6,
            state: "ESTABLISHED",
          } as any,
        ],
      });

      render(<AppsTestWrapper />);

      expect(await screen.findByText("service.exe")).toBeInTheDocument();

      const expandBtn = screen.getByRole("button", { name: /Expand service.exe/i });
      fireEvent.click(expandBtn);

      const inspectBtn = screen.getByRole("button", { name: /Inspect Flow #888/i });
      expect(inspectBtn).toBeInTheDocument();
      fireEvent.click(inspectBtn);

      // Acceptance criteria 1: Inspect Flow opens a detailed inspection plate.
      const plate = screen.getByTestId("flow-inspection-plate");
      expect(plate).toBeInTheDocument();
      expect(within(plate).getByText(/Flow #888 Inspection Plate/i)).toBeInTheDocument();

      // Acceptance criteria 2: User can see full socket addresses, ports, and metrics.
      expect(screen.getByTestId("flow-5tuple")).toHaveTextContent(
        "192.168.1.20:49210 → service-api.domain.com:443 (HTTPS)"
      );
      expect(screen.getByTestId("flow-source-socket")).toHaveTextContent("192.168.1.20:49210");
      expect(screen.getByTestId("flow-destination-socket")).toHaveTextContent("service-api.domain.com:443");
      expect(screen.getByTestId("flow-state")).toHaveTextContent("ESTABLISHED");
      expect(screen.getByTestId("flow-bytes")).toHaveTextContent(/2 KB/);
      expect(screen.getByTestId("flow-packets")).toHaveTextContent("15");
      expect(screen.getByTestId("flow-rtt")).toHaveTextContent("24.6 ms");

      // Toggling close button in plate
      const closeBtn = within(plate).getByRole("button", { name: /Close flow inspection/i });
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("flow-inspection-plate")).not.toBeInTheDocument();

      // Toggling inspect button again opens it back
      fireEvent.click(inspectBtn);
      expect(screen.getByTestId("flow-inspection-plate")).toBeInTheDocument();

      // Clicking inspect button when open closes it
      fireEvent.click(screen.getByRole("button", { name: /Inspect Flow #888/i }));
      expect(screen.queryByTestId("flow-inspection-plate")).not.toBeInTheDocument();
    });

    it("auto-expands and displays inspection plate when navigated with targetFlowId", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "service.exe",
            pid: 7777,
            flows: 1,
            bytes: 2048,
            packets: 15,
          } as any,
        ],
        lineage: [
          {
            source: "10.0.0.12:55000",
            destination: "db.internal.net:5432",
            protocol: "TCP",
            bytes: 512,
            packets: 4,
            direction: "local",
            flow_count: 1,
            classification: "local_subnet",
            pid: 7777,
            flow_id: 999,
          } as any,
        ],
      });

      function NavWrapper() {
        const nav = useEvidenceNavigation();
        return (
          <div>
            <button
              type="button"
              data-testid="deep-link-trigger"
              onClick={() => nav.navigateToEvidence({ kind: "flow", id: 999 }, "apps")}
            >
              Deep link to 999
            </button>
            <Apps />
          </div>
        );
      }

      render(
        <DisclosureProvider>
          <EvidenceNavigationProvider>
            <NavWrapper />
          </EvidenceNavigationProvider>
        </DisclosureProvider>
      );

      expect(await screen.findByText("service.exe")).toBeInTheDocument();

      // Click deep link button to simulate navigation into apps with targetFlowId
      fireEvent.click(screen.getByTestId("deep-link-trigger"));

      // The process should auto-expand and the inspection plate for Flow #999 should be visible
      const plate = await screen.findByTestId("flow-inspection-plate");
      expect(plate).toBeInTheDocument();
      expect(within(plate).getByText(/Flow #999 Inspection Plate/i)).toBeInTheDocument();
      expect(screen.getByTestId("flow-source-socket")).toHaveTextContent("10.0.0.12:55000");
      expect(screen.getByTestId("flow-destination-socket")).toHaveTextContent("db.internal.net:5432");

      // Closing the inspection plate keeps the parent process row expanded
      const closePlateBtn = within(plate).getByRole("button", { name: /Close flow inspection/i });
      fireEvent.click(closePlateBtn);
      expect(screen.queryByTestId("flow-inspection-plate")).not.toBeInTheDocument();
      expect(screen.getByTestId("expanded-lineage-tray")).toBeInTheDocument();

      // Clicking collapse on the process row collapses the tray cleanly in a single click
      const collapseBtn = screen.getByRole("button", { name: /Collapse service\.exe/i });
      fireEvent.click(collapseBtn);
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
    });

    it("ensures flow card at index >= 24 remains visible and inspectable when selected", async () => {
      // 30 flows for single process
      const manyFlowIds = Array.from({ length: 30 }, (_, i) => 1000 + i);
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "batch-worker.exe",
            pid: 5050,
            flows: 30,
            flow_ids: manyFlowIds,
          } as any,
        ],
        lineage: [],
      });

      function NavWrapper() {
        const nav = useEvidenceNavigation();
        return (
          <div>
            <button
              type="button"
              data-testid="deep-link-28"
              onClick={() => nav.navigateToEvidence({ kind: "flow", id: 1028 }, "apps")}
            >
              Inspect Flow 1028
            </button>
            <Apps />
          </div>
        );
      }

      render(
        <DisclosureProvider>
          <EvidenceNavigationProvider>
            <NavWrapper />
          </EvidenceNavigationProvider>
        </DisclosureProvider>
      );

      expect(await screen.findByText("batch-worker.exe")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("deep-link-28"));

      // Flow #1028 (at index 28) should be rendered and inspected
      const plate = await screen.findByTestId("flow-inspection-plate");
      expect(plate).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /#1028/i })).toBeInTheDocument();
    });

    it("resolveFlowDetails properly derives full socket addresses and ports from raw endpoints", () => {
      const mockGroup: any = {
        key: "test:1",
        processName: "test.exe",
        pid: 1,
        confidence: "high",
        flowIds: [100],
        flowsCount: 1,
        normalizedSearch: "",
        lineage: [
          {
            source: "192.168.1.10",
            destination: "example.org",
            protocol: "HTTPS",
            bytes: 1000,
            packets: 10,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
            pid: 1,
          },
        ],
      };

      const details = resolveFlowDetails(100, mockGroup);
      expect(details.sourceAddress).toBe("192.168.1.10");
      expect(details.sourcePort).toBeGreaterThan(0);
      expect(details.destinationAddress).toBe("example.org");
      expect(details.destinationPort).toBe(443);
      expect(details.fiveTuple).toContain("192.168.1.10:");
      expect(details.fiveTuple).toContain("example.org:443 (HTTPS)");
      expect(details.state).toBe("ESTABLISHED");
      expect(details.rttEstimate).toBe("28.4 ms");
    });

    it("resolveFlowDetails handles edge cases: string ports, unbracketed IPv6, and casing", () => {
      const mockGroup: any = {
        key: "edge:2",
        processName: "edge.exe",
        pid: 2,
        confidence: "high",
        flowIds: [200],
        flowsCount: 1,
        normalizedSearch: "",
        lineage: [
          {
            source: "2001:db8::1",
            destination: "[2001:db8::2]:8443",
            src_port: "51234",
            protocol: "tcp",
            state: "established",
            classification: "gateway",
            pid: 2,
            flow_id: 200,
          },
        ],
      };

      const details = resolveFlowDetails(200, mockGroup);
      expect(details.sourceSocket).toBe("[2001:db8::1]:51234");
      expect(details.sourcePort).toBe(51234);
      expect(details.destinationSocket).toBe("[2001:db8::2]:8443");
      expect(details.destinationPort).toBe(8443);
      expect(details.state).toBe("ESTABLISHED");
      expect(details.rttEstimate).toBe("2.4 ms");
    });
  });

  describe("Deterministic Confidence Aggregation & Ranking", () => {
    it("resolveConservativeConfidence resolves conservatively (unknown overrides low & high, low overrides high)", () => {
      expect(resolveConservativeConfidence("high", "high")).toBe("high");
      expect(resolveConservativeConfidence("high", "low")).toBe("low");
      expect(resolveConservativeConfidence("low", "high")).toBe("low");
      expect(resolveConservativeConfidence("low", "low")).toBe("low");
      expect(resolveConservativeConfidence("high", "unknown")).toBe("unknown");
      expect(resolveConservativeConfidence("unknown", "high")).toBe("unknown");
      expect(resolveConservativeConfidence("low", "unknown")).toBe("unknown");
      expect(resolveConservativeConfidence("unknown", "low")).toBe("unknown");
      expect(resolveConservativeConfidence("unknown", "unknown")).toBe("unknown");
    });

    it("aggregateConfidences resolves conservatively across arbitrary sets of confidences", () => {
      expect(aggregateConfidences([])).toBe("unknown");
      expect(aggregateConfidences(["high", "high", "high"])).toBe("high");
      expect(aggregateConfidences(["high", "low", "high"])).toBe("low");
      expect(aggregateConfidences(["high", "unknown", "high"])).toBe("unknown");
      expect(aggregateConfidences(["low", "unknown"])).toBe("unknown");
      expect(aggregateConfidences(["unknown"])).toBe("unknown");
    });

    it("ensures group confidence is order-invariant regardless of process array order", async () => {
      const procHigh = {
        name: "chrome.exe",
        pid: 4092,
        flows: 1,
        flowIds: [101],
        confidence: "high",
        bytes: 1000,
        packets: 10,
      } as any;

      const procUnknown = {
        name: "chrome.exe",
        pid: 4092,
        flows: 1,
        flowIds: [102],
        confidence: "unknown",
        bytes: 2000,
        packets: 20,
      } as any;

      // Order A: [High, Unknown]
      setMonitor({
        ...mockBaseSnapshot,
        processes: [procHigh, procUnknown],
      });

      const { result: resultA } = renderHook(() => useAppsController(), {
        wrapper: ({ children }) => (
          <DisclosureProvider>
            <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
          </DisclosureProvider>
        ),
      });

      await waitFor(() => {
        expect(resultA.current.loaded).toBe(true);
      });

      expect(resultA.current.groupedProcesses.length).toBe(1);
      const groupA = resultA.current.groupedProcesses[0]!;
      expect(groupA.confidence).toBe("unknown");
      expect(groupA.confidenceBreakdown).toEqual({ high: 1, low: 0, unknown: 1 });
      expect(groupA.flowIds).toEqual([101, 102]);

      // Order B: [Unknown, High]
      act(() => {
        setMonitor({
          ...mockBaseSnapshot,
          processes: [procUnknown, procHigh],
        });
      });

      const { result: resultB } = renderHook(() => useAppsController(), {
        wrapper: ({ children }) => (
          <DisclosureProvider>
            <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
          </DisclosureProvider>
        ),
      });

      await waitFor(() => {
        expect(resultB.current.loaded).toBe(true);
      });

      expect(resultB.current.groupedProcesses.length).toBe(1);
      const groupB = resultB.current.groupedProcesses[0]!;
      expect(groupB.confidence).toBe("unknown");
      expect(groupB.confidenceBreakdown).toEqual({ high: 1, low: 0, unknown: 1 });
      expect(groupB.flowIds).toEqual([101, 102]);
    });

    it("ensures group confidence ranking is strictly deterministic across all permutations", async () => {
      const procTrusted = {
        name: "trusted.exe",
        pid: 100,
        flows: 1,
        flowIds: [1],
        confidence: "high",
        bytes: 100,
        packets: 1,
      } as any;

      const procLow = {
        name: "pidapp.exe",
        pid: 200,
        flows: 1,
        flowIds: [2],
        confidence: "low",
        bytes: 200,
        packets: 2,
      } as any;

      const procMixedA = {
        name: "mixed.exe",
        pid: 300,
        flows: 1,
        flowIds: [3],
        confidence: "high",
        bytes: 300,
        packets: 3,
      } as any;

      const procMixedB = {
        name: "mixed.exe",
        pid: 300,
        flows: 1,
        flowIds: [4],
        confidence: "unknown",
        bytes: 400,
        packets: 4,
      } as any;

      // Generate different permutations of input processes
      const permutation1 = [procTrusted, procLow, procMixedA, procMixedB];
      const permutation2 = [procMixedB, procLow, procMixedA, procTrusted];
      const permutation3 = [procMixedA, procMixedB, procLow, procTrusted];

      for (const perm of [permutation1, permutation2, permutation3]) {
        act(() => {
          setMonitor({
            ...mockBaseSnapshot,
            processes: perm,
          });
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

        expect(result.current.groupedProcesses.length).toBe(3);
        // Tier 0: High confidence first
        expect(result.current.groupedProcesses[0]!.processName).toBe("trusted.exe");
        expect(result.current.groupedProcesses[0]!.confidence).toBe("high");
        // Tier 1: Low confidence second
        expect(result.current.groupedProcesses[1]!.processName).toBe("pidapp.exe");
        expect(result.current.groupedProcesses[1]!.confidence).toBe("low");
        // Tier 2: Unknown confidence third (mixed resolved conservatively to unknown)
        expect(result.current.groupedProcesses[2]!.processName).toBe("mixed.exe");
        expect(result.current.groupedProcesses[2]!.confidence).toBe("unknown");
        expect(result.current.groupedProcesses[2]!.confidenceBreakdown).toEqual({
          high: 1,
          low: 0,
          unknown: 1,
        });
      }
    });

    it("resolves flow-level confidence breakdown from explicit flowConfidences map", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "daemon.exe",
            pid: 500,
            flows: 3,
            flowIds: [10, 20, 30],
            confidence: "high",
            flowConfidences: {
              10: "high",
              20: "low",
              30: "high",
            },
            bytes: 5000,
            packets: 50,
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
      // Because flow 20 is "low", group conservatively resolves to "low"
      expect(group.confidence).toBe("low");
      expect(group.confidenceBreakdown).toEqual({
        high: 2,
        low: 1,
        unknown: 0,
      });

      // Individual flow rows reflect their respective flow confidences
      expect(result.current.rows.length).toBe(3);
      const row10 = result.current.rows.find((r) => r.flowId === 10);
      const row20 = result.current.rows.find((r) => r.flowId === 20);
      expect(row10?.attr.confidence).toBe("high");
      expect(row20?.attr.confidence).toBe("low");
    });

    it("resolves flow-level confidence from flows object array", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "agent.exe",
            pid: 600,
            flows: [
              { id: 91, confidence: "high" },
              { id: 92, confidence: "unknown" },
            ],
            flowIds: [91, 92],
            confidence: "high",
            bytes: 2000,
            packets: 20,
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
      expect(group.confidence).toBe("unknown");
      expect(group.confidenceBreakdown).toEqual({
        high: 1,
        low: 0,
        unknown: 1,
      });
    });

    it("resolves overlapping flow attributions conservatively in cache", async () => {
      // Flow #77 appears in procA as high, but also in procB as unknown
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "app1.exe",
            pid: 701,
            flows: 1,
            flowIds: [77],
            confidence: "high",
            bytes: 100,
            packets: 1,
          } as any,
          {
            name: "app2.exe",
            pid: 702,
            flows: 1,
            flowIds: [77],
            confidence: "unknown",
            bytes: 200,
            packets: 2,
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

      // Flow 77's cached attribution resolves conservatively to "unknown"
      const flow77Rows = result.current.rows.filter((r) => r.flowId === 77);
      expect(flow77Rows.length).toBeGreaterThan(0);
      expect(flow77Rows[0]!.attr.confidence).toBe("unknown");
    });

    it("ensures flowsCount is deduplicated when multiple records for the same process share flow IDs", async () => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "service.exe",
            pid: 900,
            flows: 1,
            flowIds: [100],
            confidence: "high",
            bytes: 100,
            packets: 1,
          } as any,
          {
            name: "service.exe",
            pid: 900,
            flows: 1,
            flowIds: [100], // Duplicate flow
            confidence: "high",
            bytes: 200,
            packets: 2,
          } as any,
          {
            name: "service.exe",
            pid: 900,
            flows: 1,
            flowIds: [101], // Distinct flow
            confidence: "high",
            bytes: 300,
            packets: 3,
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
      expect(group.flowIds).toEqual([100, 101]);
      // Should be 2 distinct flows, not 3
      expect(group.flowsCount).toBe(2);
    });

    it("deterministically preserves known process name and PID over fallback unattributed entries", async () => {
      // Order A: Known process arrives first, generic fallback arrives second
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "worker.exe",
            pid: 950,
            flows: 1,
            flowIds: [888],
            confidence: "high",
            bytes: 500,
            packets: 5,
          } as any,
          {
            name: "unknown owner",
            pid: null,
            flows: 1,
            flowIds: [888],
            confidence: "unknown",
            bytes: 500,
            packets: 5,
          } as any,
        ],
      });

      const { result: resultA } = renderHook(() => useAppsController(), {
        wrapper: ({ children }) => (
          <DisclosureProvider>
            <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
          </DisclosureProvider>
        ),
      });

      await waitFor(() => {
        expect(resultA.current.loaded).toBe(true);
      });

      const rowA = resultA.current.rows.find((r) => r.flowId === 888);
      expect(rowA?.attr.process_name).toBe("worker.exe");
      expect(rowA?.attr.pid).toBe(950);
      expect(rowA?.attr.confidence).toBe("unknown"); // Conservative confidence

      // Order B: Generic fallback arrives first, known process arrives second
      act(() => {
        resetSession("session-order-b");
        setMonitor({
          ...mockBaseSnapshot,
          processes: [
            {
              name: "unknown owner",
              pid: null,
              flows: 1,
              flowIds: [888],
              confidence: "unknown",
              bytes: 500,
              packets: 5,
            } as any,
            {
              name: "worker.exe",
              pid: 950,
              flows: 1,
              flowIds: [888],
              confidence: "high",
              bytes: 500,
              packets: 5,
            } as any,
          ],
        });
      });

      const { result: resultB } = renderHook(() => useAppsController(), {
        wrapper: ({ children }) => (
          <DisclosureProvider>
            <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
          </DisclosureProvider>
        ),
      });

      await waitFor(() => {
        expect(resultB.current.loaded).toBe(true);
      });

      const rowB = resultB.current.rows.find((r) => r.flowId === 888);
      expect(rowB?.attr.process_name).toBe("worker.exe");
      expect(rowB?.attr.pid).toBe(950);
      expect(rowB?.attr.confidence).toBe("unknown");
    });
  });

  describe("Keyboard Accessibility on Expandable Process Rows", () => {
    beforeEach(() => {
      setMonitor({
        ...mockBaseSnapshot,
        processes: [
          {
            name: "curl.exe",
            pid: 4321,
            flows: 1,
            flowIds: [301],
            bytes: 65536,
            packets: 40,
          } as any,
        ],
        lineage: [
          {
            source: "192.168.1.50",
            destination: "api.github.com",
            protocol: "HTTPS",
            bytes: 65536,
            packets: 40,
            direction: "outbound",
            flow_count: 1,
            classification: "external_wan",
            pid: 4321,
            flow_id: 301,
          } as any,
        ],
      });
    });

    it("assigns tabIndex={0} and aria-expanded to the process row", async () => {
      const { container } = render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const row = container.querySelector(".np-apps-row");
      expect(row).toBeInTheDocument();
      expect(row).toHaveAttribute("tabindex", "0");
      expect(row).toHaveAttribute("aria-expanded", "false");
      expect(row).toHaveAttribute("data-expanded", "false");
    });

    it("expands and collapses process row when pressing Enter on the row", async () => {
      const { container } = render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const row = container.querySelector(".np-apps-row")!;
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();

      // Press Enter on the row to expand
      fireEvent.keyDown(row, { key: "Enter" });
      expect(await screen.findByTestId("expanded-lineage-tray")).toBeInTheDocument();
      expect(row).toHaveAttribute("aria-expanded", "true");
      expect(row).toHaveAttribute("data-expanded", "true");

      // Press Enter on the row again to collapse
      fireEvent.keyDown(row, { key: "Enter" });
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
      expect(row).toHaveAttribute("aria-expanded", "false");
      expect(row).toHaveAttribute("data-expanded", "false");
    });

    it("expands and collapses process row when pressing Space on the row", async () => {
      const { container } = render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const row = container.querySelector(".np-apps-row")!;
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();

      // Press Space on the row to expand
      fireEvent.keyDown(row, { key: " " });
      expect(await screen.findByTestId("expanded-lineage-tray")).toBeInTheDocument();
      expect(row).toHaveAttribute("aria-expanded", "true");

      // Press Space on the row again to collapse
      fireEvent.keyDown(row, { key: " " });
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
      expect(row).toHaveAttribute("aria-expanded", "false");
    });

    it("does not toggle expansion when pressing unrelated keys on the row", async () => {
      const { container } = render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const row = container.querySelector(".np-apps-row")!;
      fireEvent.keyDown(row, { key: "Tab" });
      fireEvent.keyDown(row, { key: "ArrowDown" });
      fireEvent.keyDown(row, { key: "Escape" });

      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
      expect(row).toHaveAttribute("aria-expanded", "false");
    });

    it("delegates mouse click on the row cleanly to toggle expansion", async () => {
      const { container } = render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const row = container.querySelector(".np-apps-row")!;
      // Click row outside button
      fireEvent.click(row);
      expect(await screen.findByTestId("expanded-lineage-tray")).toBeInTheDocument();

      fireEvent.click(row);
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
    });

    it("supports keyboard navigation on the toggle button directly (Space & Enter)", async () => {
      render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const toggleBtn = screen.getByRole("button", { name: /expand curl\.exe/i });
      expect(toggleBtn).toBeInTheDocument();

      // Press Enter directly on the button
      fireEvent.keyDown(toggleBtn, { key: "Enter" });
      expect(await screen.findByTestId("expanded-lineage-tray")).toBeInTheDocument();

      // Button label switches to Collapse
      const collapseBtn = screen.getByRole("button", { name: /collapse curl\.exe/i });
      expect(collapseBtn).toBeInTheDocument();

      // Press Space directly on the button to collapse
      fireEvent.keyDown(collapseBtn, { key: " " });
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
    });

    it("prevents double-toggling when child buttons inside the row are clicked or activated", async () => {
      render(<AppsTestWrapper />);
      expect(await screen.findByText("curl.exe")).toBeInTheDocument();

      const toggleBtn = screen.getByRole("button", { name: /expand curl\.exe/i });
      fireEvent.click(toggleBtn);

      // Should be expanded (single toggle)
      expect(await screen.findByTestId("expanded-lineage-tray")).toBeInTheDocument();

      // Clicking child button again collapses (single toggle)
      const collapseBtn = screen.getByRole("button", { name: /collapse curl\.exe/i });
      fireEvent.click(collapseBtn);
      expect(screen.queryByTestId("expanded-lineage-tray")).not.toBeInTheDocument();
    });
  });
});

