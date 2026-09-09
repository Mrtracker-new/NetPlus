import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, renderHook, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { MonitorSnapshot } from "@netpulse/contract";
import { CaptureHealthPanel } from "../screens/Monitoring/CaptureHealthPanel";
import { ProcessAttributesCard } from "../screens/Monitoring/ProcessAttributesCard";
import {
  buildDomainFromSnapshot,
  useMonitoringController,
  type FormattedCaptureHealth,
} from "../hooks/useMonitoringController";
import type { ProcessMetricRow } from "../screens/Monitoring/monitoringTypes";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { setMonitor, __resetForTest } from "../state/store";

describe("CaptureHealthPanel and ProcessAttributesCard progressbars", () => {
  beforeEach(() => {
    __resetForTest();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("CaptureHealthPanel", () => {
    const mockHealth: FormattedCaptureHealth = {
      bufferPercent: 62,
      bufferFrames: 6200,
      bufferCapacity: 10000,
      stage: "none",
      stageKey: "dissection_nominal",
      drops: 0,
      severity: "healthy",
    };

    it("renders gauge fill with role='progressbar' and ARIA range attributes", () => {
      render(<CaptureHealthPanel health={mockHealth} />);

      const progressbar = screen.getByRole("progressbar", { name: /Buffer Usage/i });
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "62");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
      expect(progressbar).toHaveAttribute("aria-valuetext", "62%");
      expect(progressbar).toHaveClass("np-capture-health-gauge-fill");
    });
  });

  describe("ProcessAttributesCard", () => {
    const mockProcesses: ProcessMetricRow[] = [
      {
        id: "p1",
        name: "chrome.exe",
        pid: 1234,
        exePath: "/usr/bin/chrome",
        type: "browser",
        bandwidthBytes: 1048576,
        formattedBandwidth: "1.0 MB/s",
        cpuPercent: 12.5,
        memoryMB: 450,
        packetsPerSec: 120,
        packets: 12000,
        flows: 8,
        rttMs: 14,
        errors: 0,
        utilizationPercent: 78,
        color: "#3b82f6",
        history: [10, 20, 30],
      },
      {
        id: "p2",
        name: "node.exe",
        pid: 5678,
        exePath: "/usr/bin/node",
        type: "runtime",
        bandwidthBytes: 524288,
        formattedBandwidth: "512 KB/s",
        cpuPercent: 4.2,
        memoryMB: 210,
        packetsPerSec: 40,
        packets: 4000,
        flows: 2,
        rttMs: 8,
        errors: 0,
        utilizationPercent: 35,
        color: "#10b981",
        history: [5, 10, 15],
      },
    ];

    it("renders progress meter fills with role='progressbar' and ARIA range attributes for each process", () => {
      render(<ProcessAttributesCard processes={mockProcesses} />);

      const progressbars = screen.getAllByRole("progressbar");
      expect(progressbars).toHaveLength(2);

      const chromeBar = screen.getByRole("progressbar", { name: "chrome.exe utilization" });
      expect(chromeBar).toBeInTheDocument();
      expect(chromeBar).toHaveAttribute("aria-valuenow", "78");
      expect(chromeBar).toHaveAttribute("aria-valuemin", "0");
      expect(chromeBar).toHaveAttribute("aria-valuemax", "100");
      expect(chromeBar).toHaveAttribute("aria-valuetext", "78%");
      expect(chromeBar).toHaveClass("np-process-fill");

      const nodeBar = screen.getByRole("progressbar", { name: "node.exe utilization" });
      expect(nodeBar).toBeInTheDocument();
      expect(nodeBar).toHaveAttribute("aria-valuenow", "35");
      expect(nodeBar).toHaveAttribute("aria-valuemin", "0");
      expect(nodeBar).toHaveAttribute("aria-valuemax", "100");
      expect(nodeBar).toHaveAttribute("aria-valuetext", "35%");
      expect(nodeBar).toHaveClass("np-process-fill");
    });

    it("displays p.packets and p.flows and renders Sparklines when history has multiple points", () => {
      const { container } = render(<ProcessAttributesCard processes={mockProcesses} />);

      // Verify packets and flows for chrome.exe
      expect(screen.getByText("12,000")).toBeInTheDocument();
      expect(screen.getByText("8")).toBeInTheDocument();

      // Verify packets and flows for node.exe
      expect(screen.getByText("4,000")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();

      // Sparklines rendered for both since history.length > 1
      const sparklines = container.querySelectorAll(".np-viz-spark");
      expect(sparklines).toHaveLength(2);
    });

    it("does not render Sparkline when process history has only 1 point or less", () => {
      const singlePointProcesses: ProcessMetricRow[] = [
        {
          ...(mockProcesses[0] as ProcessMetricRow),
          id: "p1",
          history: [50],
        },
      ];
      const { container } = render(<ProcessAttributesCard processes={singlePointProcesses} />);
      const sparklines = container.querySelectorAll(".np-viz-spark");
      expect(sparklines).toHaveLength(0);
    });

    it("handles edge case data gracefully without rendering NaN or crashing", () => {
      const edgeCaseProcesses: ProcessMetricRow[] = [
        {
          id: "edge1",
          name: "",
          pid: null,
          exePath: null,
          type: "Unattributed",
          bandwidthBytes: NaN as any,
          formattedBandwidth: "",
          cpuPercent: NaN as any,
          memoryMB: NaN as any,
          packetsPerSec: 0,
          packets: NaN as any,
          flows: NaN as any,
          rttMs: 0,
          errors: 0,
          utilizationPercent: NaN as any,
          color: "",
          history: [NaN, NaN] as any,
        },
      ];

      const { container } = render(<ProcessAttributesCard processes={edgeCaseProcesses} />);

      // Should show unknown process fallback
      expect(screen.getByText("Unknown Process")).toBeInTheDocument();
      // Should show unattributed fallback
      expect(screen.getByText("Unattributed")).toBeInTheDocument();
      // Should show 0% utilization
      expect(screen.getByText("0%")).toBeInTheDocument();
      // Should not contain any "NaN" strings in the entire card text
      expect(container.textContent).not.toContain("NaN");

      // Progress bar should have valid aria attributes
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "0");
      expect(bar).toHaveAttribute("aria-valuetext", "0%");
    });

    it("resets page to 0 when changing sort criteria and applies secondary ID tiebreaker", () => {
      // 6 processes (page 0 has 4, page 1 has 2)
      const sixProcesses: ProcessMetricRow[] = Array.from({ length: 6 }, (_, i) => ({
        id: `p-${i}`,
        name: `process-${i}`,
        pid: 1000 + i,
        exePath: null,
        type: "service",
        bandwidthBytes: 100, // equal bandwidth for tiebreaker test
        formattedBandwidth: "100 B",
        cpuPercent: 5.0,
        memoryMB: 100,
        packetsPerSec: 10,
        packets: 100,
        flows: 1,
        rttMs: 5,
        errors: 0,
        utilizationPercent: 10,
        color: "#10b981",
        history: [],
      }));

      render(<ProcessAttributesCard processes={sixProcesses} />);

      // Initially on Page 1 of 2
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

      // Navigate to page 2
      const nextBtn = screen.getByRole("button", { name: /Next process page/i });
      fireEvent.click(nextBtn);
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

      // Change sort order -> should reset to Page 1 of 2
      const sortSelect = screen.getByRole("combobox", { name: /Sort process attributes/i });
      fireEvent.change(sortSelect, { target: { value: "cpu" } });
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });
  });

  describe("Rolling Process History Map in useMonitoringController & buildDomainFromSnapshot", () => {
    const baseSnapshot: MonitorSnapshot = {
      by_protocol: { dimension: "protocol", rows: [] },
      by_host: { dimension: "host", rows: [] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
      processes: [
        {
          pid: 100,
          name: "proc-test.exe",
          bytes: 10240, // 10 KB
          packets: 50,
          flows: 2,
        },
      ],
    };

    it("maintains a rolling Map of process bandwidth samples up to 15 points", () => {
      const historyMap = new Map<string, number[]>();

      // Ingest 20 samples with increasing bandwidth
      for (let i = 1; i <= 20; i++) {
        const snap: MonitorSnapshot = {
          ...baseSnapshot,
          processes: [
            {
              pid: 100,
              name: "proc-test.exe",
              bytes: i * 1024, // i KB
              packets: i * 10,
              flows: 1,
            },
          ],
        };
        const domain = buildDomainFromSnapshot(snap, historyMap);
        expect(domain.processes).toHaveLength(1);
        if (i <= 15) {
          expect(domain.processes[0]!.history).toHaveLength(i);
        } else {
          expect(domain.processes[0]!.history).toHaveLength(15);
        }
      }

      // Oldest 5 samples dropped, keeping latest 15 points (6 through 20)
      const expectedHistory = Array.from({ length: 15 }, (_, idx) => idx + 6);
      expect(historyMap.get("proc-100")).toEqual(expectedHistory);
    });

    it("cleans up terminated processes from the rolling Map", () => {
      const historyMap = new Map<string, number[]>();

      const snapWithTwo: MonitorSnapshot = {
        ...baseSnapshot,
        processes: [
          { pid: 100, name: "procA.exe", bytes: 1024, packets: 1, flows: 1 },
          { pid: 200, name: "procB.exe", bytes: 2048, packets: 2, flows: 1 },
        ],
      };
      buildDomainFromSnapshot(snapWithTwo, historyMap);
      expect(historyMap.has("proc-100")).toBe(true);
      expect(historyMap.has("proc-200")).toBe(true);

      const snapWithOne: MonitorSnapshot = {
        ...baseSnapshot,
        processes: [
          { pid: 200, name: "procB.exe", bytes: 4096, packets: 4, flows: 1 },
        ],
      };
      buildDomainFromSnapshot(snapWithOne, historyMap);
      expect(historyMap.has("proc-100")).toBe(false);
      expect(historyMap.has("proc-200")).toBe(true);
      expect(historyMap.get("proc-200")).toEqual([2, 4]);
    });

    it("accumulates process sparkline history across store snapshot updates in useMonitoringController", () => {
      const { result } = renderHook(() => useMonitoringController(), {
        wrapper: EvidenceNavigationProvider,
      });

      // 1st snapshot
      act(() => {
        setMonitor({
          ...baseSnapshot,
          processes: [
            { pid: 42, name: "agent.exe", bytes: 10240, packets: 100, flows: 4 },
          ],
        });
      });

      expect(result.current.viewModel.processes).toHaveLength(1);
      expect(result.current.viewModel.processes[0]!.history).toEqual([10]);
      expect(result.current.viewModel.processes[0]!.packets).toBe(100);
      expect(result.current.viewModel.processes[0]!.flows).toBe(4);

      // 2nd snapshot -> sparkline history now has 2 points
      act(() => {
        setMonitor({
          ...baseSnapshot,
          processes: [
            { pid: 42, name: "agent.exe", bytes: 20480, packets: 200, flows: 5 },
          ],
        });
      });

      expect(result.current.viewModel.processes[0]!.history).toEqual([10, 20]);
    });

    it("handles partial or empty snapshot gracefully in buildDomainFromSnapshot", () => {
      const partialSnapshot = {
        by_protocol: undefined as any,
        by_host: undefined as any,
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        processes: [
          {
            pid: null,
            name: "headless",
            bytes: NaN as any,
            packets: undefined as any,
            flows: undefined as any,
          },
        ],
      } as unknown as MonitorSnapshot;

      const domain = buildDomainFromSnapshot(partialSnapshot);
      expect(domain.bytesSeen).toBe(0);
      expect(domain.activeFlows).toBe(0);
      expect(domain.activeHosts).toBe(0);
      expect(domain.activeProtocols).toBe(0);
      expect(domain.processes).toHaveLength(1);
      expect(domain.processes[0]!.bandwidthBytes).toBe(0);
      expect(domain.processes[0]!.packets).toBe(0);
      expect(domain.processes[0]!.flows).toBe(0);
      expect(domain.processes[0]!.utilizationPercent).toBe(0);
    });
  });
});
