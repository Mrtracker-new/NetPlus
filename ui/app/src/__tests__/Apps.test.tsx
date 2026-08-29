import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Apps } from "../screens/Apps";
import { useAppsController } from "../hooks/useAppsController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { setFeed, __resetForTest } from "../state/store";
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

describe("Apps Screen & useAppsController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders empty state when feed contains no flows", async () => {
    render(<AppsTestWrapper />);

    expect(
      await screen.findByText("No attributed applications captured yet. Start a capture session to populate process lineage.")
    ).toBeInTheDocument();
  });

  it("controller hook caches IPC attribution results by flow ID and groups by process", async () => {
    setFeed([
      {
        headline: "TLS Flow 101",
        summary: "Chrome connection",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 101 }],
        at_mono_nanos: 1000,
      },
    ]);

    const querySpy = vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "attribution",
      attribution: {
        process_name: "chrome.exe",
        pid: 4092,
        confidence: "high",
      },
    } as any);

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

    querySpy.mockRestore();
  });

  it("renders summary KPIs, process table, and allows row expansion to inspect flows", async () => {
    setFeed([
      {
        headline: "Flow 202",
        summary: "Slack API call",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 202 }],
        at_mono_nanos: 2000,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "attribution",
      attribution: {
        process_name: "slack.exe",
        pid: 8192,
        confidence: "high",
      },
    } as any);

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
    setFeed([
      {
        headline: "Flow 303",
        summary: "Curl request",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 303 }],
        at_mono_nanos: 3000,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "attribution",
      attribution: {
        process_name: "curl.exe",
        pid: 1234,
        confidence: "low",
      },
    } as any);

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
    setFeed([
      {
        headline: "Flow 401",
        summary: "High confidence app",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 401 }],
        at_mono_nanos: 4000,
      },
      {
        headline: "Flow 402",
        summary: "Unknown owner app",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 402 }],
        at_mono_nanos: 4001,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockImplementation(async (req: any) => {
      if (req.flow_id === 401) {
        return {
          kind: "attribution",
          attribution: { process_name: "trusted.exe", pid: 100, confidence: "high" },
        } as any;
      }
      return {
        kind: "attribution",
        attribution: { process_name: "unknown owner", pid: null, confidence: "unknown" },
      } as any;
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
    setFeed([
      {
        headline: "Flow 501",
        summary: "Process Alpha",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 501 }],
        at_mono_nanos: 5000,
      },
      {
        headline: "Flow 502",
        summary: "Process Beta",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 502 }],
        at_mono_nanos: 5001,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockImplementation(async (req: any) => {
      if (req.flow_id === 501) {
        return {
          kind: "attribution",
          attribution: { process_name: "alpha.exe", pid: 5001, confidence: "high" },
        } as any;
      }
      return {
        kind: "attribution",
        attribution: { process_name: "beta.exe", pid: 5002, confidence: "high" },
      } as any;
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
    setFeed([
      {
        headline: "Flow 601",
        summary: "Process One",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 601 }],
        at_mono_nanos: 6000,
      },
      {
        headline: "Flow 602",
        summary: "Process Two",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 602 }],
        at_mono_nanos: 6001,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockImplementation(async (req: any) => {
      if (req.flow_id === 601) {
        return {
          kind: "attribution",
          attribution: { process_name: "proc1.exe", pid: 6010, confidence: "high" },
        } as any;
      }
      return {
        kind: "attribution",
        attribution: { process_name: "proc2.exe", pid: 6020, confidence: "high" },
      } as any;
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
    setFeed([
      {
        headline: "Flow 701",
        summary: "Inspect flow app",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 701 }],
        at_mono_nanos: 7000,
      },
    ]);

    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "attribution",
      attribution: { process_name: "inspectable.exe", pid: 7010, confidence: "high" },
    } as any);

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
});

