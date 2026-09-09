import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DiagnosticChainCard } from "../screens/Monitoring/DiagnosticChainCard";
import type { DiagnosticChain } from "@netpulse/contract";

describe("DiagnosticChainCard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockChainWithTargets: DiagnosticChain = {
    stages: [
      {
        stage: "router",
        status: "degraded",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Gateway Hop",
        summary: "High gateway latency",
        latency_ms: 24.5,
        evidence: [],
        causes: [],
        affected_targets: ["192.168.1.1"],
      },
      {
        stage: "device",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "not_detected",
        label: "Device Stack",
        summary: "Local kernel healthy",
        latency_ms: 0.1,
        evidence: [],
        causes: [],
        affected_targets: [],
      },
    ],
  };

  const mockChainWithoutTargets: DiagnosticChain = {
    stages: [
      {
        stage: "router",
        status: "degraded",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Gateway Hop",
        summary: "Gateway hop without resolved targets",
        latency_ms: 12.0,
        evidence: [],
        causes: [],
        affected_targets: [],
      },
    ],
  };

  it("fires probe with affected_targets[0] when present", () => {
    const onRunProbe = vi.fn();
    render(<DiagnosticChainCard chain={mockChainWithTargets} onRunProbe={onRunProbe} />);

    // Click on the stage node to open inspection drawer
    const stageBtn = screen.getByRole("tab", { name: /Gateway Hop/i });
    fireEvent.click(stageBtn);

    // Click "Run Active Probe" (Quick Probe button)
    const quickProbeBtn = screen.getByRole("button", { name: /Run Active Probe/i });
    fireEvent.click(quickProbeBtn);

    expect(onRunProbe).toHaveBeenCalledTimes(1);
    expect(onRunProbe).toHaveBeenCalledWith("router", "192.168.1.1");
    expect(screen.queryByText("Please specify a probe target address")).not.toBeInTheDocument();
  });

  it("focuses customTarget input and sets error when affected_targets[0] is empty", () => {
    const onRunProbe = vi.fn();
    render(<DiagnosticChainCard chain={mockChainWithoutTargets} onRunProbe={onRunProbe} />);

    // Click on the stage node to open inspection drawer
    const stageBtn = screen.getByRole("tab", { name: /Gateway Hop/i });
    fireEvent.click(stageBtn);

    const input = screen.getByTestId("stage-probe-target-input");
    expect(document.activeElement).not.toBe(input);

    // Click "Run Active Probe" when affected_targets is empty
    const quickProbeBtn = screen.getByRole("button", { name: /Run Active Probe/i });
    fireEvent.click(quickProbeBtn);

    // Should NOT have fired onRunProbe
    expect(onRunProbe).not.toHaveBeenCalled();

    // Should display exact error message
    expect(screen.getByText("Please specify a probe target address")).toBeInTheDocument();

    // Should focus customTarget input
    expect(document.activeElement).toBe(input);
  });

  it("handles whitespace-only or empty string targets as empty", () => {
    const onRunProbe = vi.fn();
    const chainWithEmptyString: DiagnosticChain = {
      stages: [
        {
          stage: "destination",
          status: "degraded",
          measurement_state: "observed",
          detection_state: "detected",
          label: "Destination",
          summary: "Destination with empty target string",
          evidence: [],
          causes: [],
          affected_targets: ["   "],
        },
      ],
    };

    render(<DiagnosticChainCard chain={chainWithEmptyString} onRunProbe={onRunProbe} />);

    // Open drawer
    const stageBtn = screen.getByRole("tab", { name: /Destination/i });
    fireEvent.click(stageBtn);

    const input = screen.getByTestId("stage-probe-target-input");
    const quickProbeBtn = screen.getByRole("button", { name: /Run Active Probe/i });
    fireEvent.click(quickProbeBtn);

    expect(onRunProbe).not.toHaveBeenCalled();
    expect(screen.getByText("Please specify a probe target address")).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it("does not render 'Run Active Probe' on non-probeable stages like device", () => {
    const onRunProbe = vi.fn();
    render(<DiagnosticChainCard chain={mockChainWithTargets} onRunProbe={onRunProbe} />);

    // Click on Device Stack
    const deviceBtn = screen.getByRole("tab", { name: /Device Stack/i });
    fireEvent.click(deviceBtn);

    // Header probe button should not be rendered
    expect(screen.queryByRole("button", { name: /Run Active Probe/i })).not.toBeInTheDocument();
  });

  it("disables 'Run Active Probe' button while probe is in flight", () => {
    const onRunProbe = vi.fn();
    render(
      <DiagnosticChainCard
        chain={mockChainWithTargets}
        onRunProbe={onRunProbe}
        probeState={{ running: true, result: null }}
      />
    );

    const stageBtn = screen.getByRole("tab", { name: /Gateway Hop/i });
    fireEvent.click(stageBtn);

    const probingBtns = screen.getAllByRole("button", { name: /Probing\.\.\./i });
    expect(probingBtns).toHaveLength(2);
    probingBtns.forEach((btn) => expect(btn).toBeDisabled());

    fireEvent.click(probingBtns[0]!);
    expect(onRunProbe).not.toHaveBeenCalled();
  });

  it("dynamically reflects updated telemetry in the drawer when chain props change", () => {
    const { rerender } = render(<DiagnosticChainCard chain={mockChainWithTargets} />);

    // Open Gateway Hop drawer
    const stageBtn = screen.getByRole("tab", { name: /Gateway Hop/i });
    fireEvent.click(stageBtn);

    expect(screen.getByText("24.5 ms")).toBeInTheDocument();

    // Telemetry updates with new latency
    const updatedChain: DiagnosticChain = {
      stages: [
        {
          stage: "router",
          status: "degraded",
          measurement_state: "observed",
          detection_state: "detected",
          label: "Gateway Hop",
          summary: "High gateway latency",
          latency_ms: 78.2,
          evidence: [],
          causes: [],
          affected_targets: ["192.168.1.1"],
        },
      ],
    };

    rerender(<DiagnosticChainCard chain={updatedChain} />);

    // Drawer should immediately show updated latency without losing open state
    expect(screen.getByText("78.2 ms")).toBeInTheDocument();
  });

  it("rejects invalid IPv4 octets in custom probe target input", () => {
    render(<DiagnosticChainCard chain={mockChainWithoutTargets} onRunProbe={vi.fn()} />);

    const stageBtn = screen.getByRole("tab", { name: /Gateway Hop/i });
    fireEvent.click(stageBtn);

    const input = screen.getByTestId("stage-probe-target-input");
    fireEvent.change(input, { target: { value: "999.999.999.999" } });

    expect(
      screen.getByText("IPv4 octets must be numbers between 0 and 255 with no leading zeros")
    ).toBeInTheDocument();
  });
});
