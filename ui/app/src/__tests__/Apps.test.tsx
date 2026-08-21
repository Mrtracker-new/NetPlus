import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Apps } from "../screens/Apps";
import { useAppsController } from "../hooks/useAppsController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
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
});
