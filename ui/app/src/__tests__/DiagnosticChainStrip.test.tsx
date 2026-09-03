import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DiagnosticChainStrip } from "../screens/Dashboard/DiagnosticChainStrip";
import type { DiagnosticChain } from "@netpulse/contract";
import * as ipc from "../ipc";

describe("DiagnosticChainStrip", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mockChain: DiagnosticChain = {
    stages: [
      {
        stage: "device",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "not_detected",
        label: "Device Stack",
        summary: "Local OS kernel and interface driver healthy",
        latency_ms: 0.2,
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "router",
        status: "degraded",
        measurement_state: "inferred",
        detection_state: "detected",
        label: "Gateway Hop",
        summary: "Gateway link jitter inferred from upstream latency",
        detail: "Occasional buffer bloat observed",
        latency_ms: 15.4,
        evidence: [{ kind: "flow", id: 101 }],
        causes: [],
        affected_targets: ["192.168.1.1"],
      },
      {
        stage: "dns",
        status: "investigate",
        measurement_state: "observed",
        detection_state: "detected",
        label: "DNS Resolver",
        summary: "High DNS resolution latency to external resolver",
        latency_ms: 85.0,
        evidence: [],
        causes: [],
        affected_targets: ["1.1.1.1", "8.8.8.8"],
      },
    ],
  };

  it("renders all 7 diagnostic stages in the track", () => {
    render(<DiagnosticChainStrip chain={mockChain} />);

    expect(screen.getByRole("region", { name: /7-Stage Diagnostic Telemetry Chain/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Device Stack/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gateway Hop/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DNS Resolver/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ISP/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CDN/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Destination/i })).toBeInTheDocument();
  });

  it("opens inspector drawer when a stage is clicked and displays measurement_state badge and sub-ms latency", () => {
    render(<DiagnosticChainStrip chain={mockChain} />);

    // Click on Device stage (observed, 0.2 ms)
    const deviceBtn = screen.getByRole("button", { name: /Device Stack/i });
    fireEvent.click(deviceBtn);

    const badge = screen.getByTestId("stage-measurement-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Observed");
    expect(badge.className).toContain("np-badge--healthy");
    expect(screen.getByText("(RTT: 0.2 ms)")).toBeInTheDocument();

    // Click on Router stage (inferred, 15.4 ms)
    const routerBtn = screen.getByRole("button", { name: /Gateway Hop/i });
    fireEvent.click(routerBtn);

    const routerBadge = screen.getByTestId("stage-measurement-badge");
    expect(routerBadge).toBeInTheDocument();
    expect(routerBadge).toHaveTextContent("Inferred");
    expect(routerBadge.className).toContain("np-badge--spike");
    expect(screen.getByText("(RTT: 15 ms)")).toBeInTheDocument();
  });

  it("displays affected_targets when present in the stage node and clicking chip updates target input", () => {
    render(<DiagnosticChainStrip chain={mockChain} />);

    // Open DNS stage which has ["1.1.1.1", "8.8.8.8"]
    const dnsBtn = screen.getByRole("button", { name: /DNS Resolver/i });
    fireEvent.click(dnsBtn);

    const targetsContainer = screen.getByTestId("stage-affected-targets");
    expect(targetsContainer).toBeInTheDocument();
    expect(targetsContainer).toHaveTextContent("Affected Targets:");

    const chip1 = screen.getByRole("button", { name: "1.1.1.1" });
    const chip2 = screen.getByRole("button", { name: "8.8.8.8" });
    expect(chip1).toBeInTheDocument();
    expect(chip2).toBeInTheDocument();

    const input = screen.getByTestId("stage-probe-target-input") as HTMLInputElement;
    expect(input.value).toBe("1.1.1.1");

    // Click second chip "8.8.8.8"
    fireEvent.click(chip2);
    expect(input.value).toBe("8.8.8.8");
  });

  it("does not render affected_targets section when affected_targets is empty", () => {
    render(<DiagnosticChainStrip chain={mockChain} />);

    const deviceBtn = screen.getByRole("button", { name: /Device Stack/i });
    fireEvent.click(deviceBtn);

    expect(screen.queryByTestId("stage-affected-targets")).toBeNull();
    // Device stack also omits target input as it is purely local
    expect(screen.queryByTestId("stage-probe-target-input")).toBeNull();
  });

  it("triggers query({ kind: 'runStageProbe', stage, target }) when clicking Run Stage Probe", async () => {
    const querySpy = vi.spyOn(ipc, "query").mockResolvedValueOnce({
      kind: "stageProbeResult",
      result: {
        stage: "router",
        probe_type: "GatewayProbe",
        target: "192.168.1.1",
        status: "success",
        latency_ms: 1.4,
        summary: "Default gateway 192.168.1.1 reachable (1.4ms RTT)",
        details: ["Gateway interface reachable", "No packet loss"],
      },
    } as any);

    render(<DiagnosticChainStrip chain={mockChain} />);

    // Click degraded router stage
    const routerBtn = screen.getByRole("button", { name: /Gateway Hop/i });
    fireEvent.click(routerBtn);

    const probeBtn = screen.getByTestId("run-stage-probe-btn");
    expect(probeBtn).toHaveTextContent("Run Stage Probe");

    await act(async () => {
      fireEvent.click(probeBtn);
    });

    expect(querySpy).toHaveBeenCalledWith({
      kind: "runStageProbe",
      stage: "router",
      target: "192.168.1.1",
    });

    await waitFor(() => {
      const probeResult = screen.getByTestId("stage-probe-result");
      expect(probeResult).toBeInTheDocument();
      expect(probeResult).toHaveTextContent("GatewayProbe");
      expect(probeResult).toHaveTextContent("SUCCESS");
      expect(probeResult).toHaveTextContent("1.4 ms");
      expect(probeResult).toHaveTextContent("Default gateway 192.168.1.1 reachable (1.4ms RTT)");
      expect(probeResult).toHaveTextContent("Gateway interface reachable");
    });
  });

  it("allows entering a custom target and probing with it", async () => {
    const querySpy = vi.spyOn(ipc, "query").mockResolvedValueOnce({
      kind: "stageProbeResult",
      result: {
        stage: "dns",
        probe_type: "DnsProbe",
        target: "9.9.9.9",
        status: "success",
        latency_ms: 12.1,
        summary: "Resolved via Quad9 (12.1ms)",
        details: ["Resolved: 9.9.9.9"],
      },
    } as any);

    render(<DiagnosticChainStrip chain={mockChain} />);

    const dnsBtn = screen.getByRole("button", { name: /DNS Resolver/i });
    fireEvent.click(dnsBtn);

    const input = screen.getByTestId("stage-probe-target-input");
    fireEvent.change(input, { target: { value: "9.9.9.9" } });

    const probeBtn = screen.getByTestId("run-stage-probe-btn");
    await act(async () => {
      fireEvent.click(probeBtn);
    });

    expect(querySpy).toHaveBeenCalledWith({
      kind: "runStageProbe",
      stage: "dns",
      target: "9.9.9.9",
    });

    await waitFor(() => {
      expect(screen.getByText("Resolved via Quad9 (12.1ms)")).toBeInTheDocument();
    });
  });

  it("handles and displays target_unavailable formatted status", async () => {
    vi.spyOn(ipc, "query").mockResolvedValueOnce({
      kind: "stageProbeResult",
      result: {
        stage: "cdn",
        probe_type: "HttpProbe",
        target: null,
        status: "target_unavailable",
        latency_ms: null,
        summary: "No valid CDN edge URL observed in current capture window",
        details: ["Provide a target or capture CDN traffic"],
      },
    } as any);

    render(<DiagnosticChainStrip chain={mockChain} />);

    const cdnBtn = screen.getByRole("button", { name: /CDN/i });
    fireEvent.click(cdnBtn);

    const probeBtn = screen.getByTestId("run-stage-probe-btn");
    await act(async () => {
      fireEvent.click(probeBtn);
    });

    await waitFor(() => {
      const probeResult = screen.getByTestId("stage-probe-result");
      expect(probeResult).toBeInTheDocument();
      expect(probeResult).toHaveTextContent("TARGET UNAVAILABLE");
      expect(probeResult).toHaveTextContent("No valid CDN edge URL observed in current capture window");
    });
  });

  it("handles and displays probe execution failure gracefully", async () => {
    vi.spyOn(ipc, "query").mockRejectedValueOnce(new Error("Socket timeout reached"));

    render(<DiagnosticChainStrip chain={mockChain} />);

    const routerBtn = screen.getByRole("button", { name: /Gateway Hop/i });
    fireEvent.click(routerBtn);

    const probeBtn = screen.getByTestId("run-stage-probe-btn");
    await act(async () => {
      fireEvent.click(probeBtn);
    });

    await waitFor(() => {
      const errorNotice = screen.getByTestId("stage-probe-error");
      expect(errorNotice).toBeInTheDocument();
      expect(errorNotice).toHaveTextContent("Probe error: Socket timeout reached");
    });
  });

  it("allows closing the inspector drawer", () => {
    render(<DiagnosticChainStrip chain={mockChain} />);

    const routerBtn = screen.getByRole("button", { name: /Gateway Hop/i });
    fireEvent.click(routerBtn);
    expect(screen.getByTestId("stage-measurement-badge")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /Close stage details/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("stage-measurement-badge")).toBeNull();
  });

  it("invokes onNavigateToEvidence when clicking inspect evidence button", () => {
    const onNavigateSpy = vi.fn();
    render(<DiagnosticChainStrip chain={mockChain} onNavigateToEvidence={onNavigateSpy} />);

    const routerBtn = screen.getByRole("button", { name: /Gateway Hop/i });
    fireEvent.click(routerBtn);

    const evidenceBtn = screen.getByRole("button", { name: /Inspect Stage Evidence/i });
    fireEvent.click(evidenceBtn);

    expect(onNavigateSpy).toHaveBeenCalledWith({ kind: "flow", id: 101 });
  });
});
