import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CaptureHealthPanel } from "../screens/Monitoring/CaptureHealthPanel";
import { ProcessAttributesCard } from "../screens/Monitoring/ProcessAttributesCard";
import type { FormattedCaptureHealth } from "../hooks/useMonitoringController";
import type { ProcessMetricRow } from "../screens/Monitoring/monitoringTypes";

describe("CaptureHealthPanel and ProcessAttributesCard progressbars", () => {
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
  });
});
