import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom";
import { I18nextProvider } from "react-i18next";
import { protocolColor } from "@netpulse/viz";
import type { MonitorSnapshot } from "@netpulse/contract";
import i18n from "../i18n";
import { setMonitor, __resetForTest } from "../state/store";
import { Monitoring } from "../screens/Monitoring";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { DisclosureProvider } from "../modes/DisclosureContext";

function MonitoringTestWrapper() {
  return (
    <I18nextProvider i18n={i18n}>
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <Monitoring />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    </I18nextProvider>
  );
}

const mockMonitorSnapshot: MonitorSnapshot = {
  by_protocol: {
    dimension: "protocol",
    rows: [
      { label: "TCP", bytes: 1048576, flows: 10, hostnames: [], evidence: [] },
      { label: "UDP", bytes: 524288, flows: 5, hostnames: [], evidence: [] },
      { label: "DNS", bytes: 65536, flows: 2, hostnames: [], evidence: [] },
    ],
  },
  by_host: {
    dimension: "host",
    rows: [
      { label: "192.168.1.1", bytes: 1000000, flows: 12, hostnames: [], evidence: [] },
      { label: "10.0.0.5", bytes: 500000, flows: 8, hostnames: [], evidence: [] },
    ],
  },
  capture_stats: {
    buffer_capacity: 1000,
    buffer_frames: 200,
    shed_stage: "none",
    dropped: 0,
  },
  diagnoses: [
    {
      cause: "local_wifi",
      explanation: "Loss and jitter affecting several servers at once",
      confidence_percent: 85,
      evidence: [{ kind: "flow" as const, id: 707 }],
    },
  ],
  network_loss_indicators: 0,
  capture_drops: 0,
  diagnostic_chain: {
    stages: [
      {
        stage: "device",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Device (Local Stack)",
        summary: "Local Capture Pipeline Operational",
        detail: "Buffer nominal, zero memory overrun",
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "interface",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Network Interface",
        summary: "Adapter Link Healthy",
        detail: "Full packet capture fidelity with zero drops",
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "router",
        status: "investigate",
        measurement_state: "inferred",
        detection_state: "detected",
        label: "Router / Gateway",
        summary: "Gateway Link Jitter / Loss Inferred",
        detail: "Loss & jitter across multiple destinations",
        evidence: [{ kind: "flow" as const, id: 707 }],
        causes: ["local_wifi"],
        affected_targets: [],
      },
      {
        stage: "isp",
        status: "unknown",
        measurement_state: "not_measurable",
        detection_state: "not_detected",
        label: "Internet Service Provider",
        summary: "ISP Upstream Hop Not Sampled",
        detail: "Passive capture does not sample ISP hops without active probe",
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "dns",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "DNS Resolver",
        summary: "DNS Resolution Nominal",
        detail: "2 DNS query flows observed in window",
        evidence: [{ kind: "flow" as const, id: 101 }],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "cdn",
        status: "not_measurable",
        measurement_state: "not_measurable",
        detection_state: "not_detected",
        label: "CDN / Edge Distribution",
        summary: "No Edge Endpoints in Window",
        detail: "No edge nodes identified in active flows",
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "destination",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Destination Server",
        summary: "Destination Endpoints Healthy",
        detail: "Active flows to remote servers",
        latency_ms: 22.5,
        evidence: [{ kind: "flow" as const, id: 202 }],
        causes: [],
        affected_targets: ["192.168.1.1"],
      },
    ],
  },
};

describe("Monitoring Screen & useMonitoringController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("protocolColor returns stable colors for TCP, UDP, and DNS", () => {
    expect(protocolColor("TCP", 0)).toBe("#3E8FE0");
    expect(protocolColor("UDP", 1)).toBe("#B47B24");
    expect(protocolColor("DNS", 2)).toBe("#7C83F7");
  });

  it("renders simulation telemetry dashboard when monitor snapshot is null", () => {
    render(<MonitoringTestWrapper />);

    expect(screen.getByRole("heading", { name: /Live Monitoring & System Health/i })).toBeTruthy();
    expect(screen.getByText("Throughput & Lineage")).toBeTruthy();
    expect(screen.getByText("Applications & Lineage")).toBeTruthy();
    expect(screen.getByText("Process Attributes")).toBeTruthy();
    expect(screen.getByText("System Subsystem Health")).toBeTruthy();
  });

  it("renders populated snapshot KPIs, capture health, charts, and diagnostic cards", () => {
    setMonitor(mockMonitorSnapshot);

    render(<MonitoringTestWrapper />);

    // Check KPIs with i18n provider
    expect(screen.getByText("Traffic Seen")).toBeTruthy();
    expect(screen.getByText("Protocols")).toBeTruthy();

    // Check Diagnostics
    expect(screen.getByText("Diagnostic Hypotheses")).toBeTruthy();
    expect(
      screen.getByText("Loss and jitter affecting several servers at once")
    ).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
  });

  it("handles empty snapshot gracefully", () => {
    const emptySnapshot: MonitorSnapshot = {
      by_protocol: { dimension: "protocol", rows: [] },
      by_host: { dimension: "host", rows: [] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    };
    setMonitor(emptySnapshot);

    render(<MonitoringTestWrapper />);

    expect(screen.getByRole("heading", { name: /Live Monitoring & System Health/i })).toBeTruthy();
  });

  it("updates chart timestamps and preferences when time-range toggle buttons are clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitoringTestWrapper />);

    const btn5m = screen.getByRole("button", { name: "Set time range to 5m" });
    expect(btn5m).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(btn5m);
    expect(btn5m).toHaveAttribute("aria-pressed", "true");

    // Timestamps for 5m range appear cleanly across charts without minus-sign clipping
    expect(screen.getAllByText("5m ago").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1m ago").length).toBeGreaterThan(0);
  });

  it("preserves unrelated UI state (e.g. topology rules selection) when time range is toggled", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitoringTestWrapper />);

    // Open topology rules dropdown and select "External WAN"
    const rulesBtn = screen.getByRole("button", { name: "Filter lineage topology rules" });
    fireEvent.click(rulesBtn);

    const wanRule = screen.getByRole("button", { name: "External WAN" });
    fireEvent.click(wanRule);

    expect(screen.getByRole("button", { name: "Filter lineage topology rules" })).toHaveTextContent(
      "External WAN ▾"
    );

    // Toggle time range to 15m
    const btn15m = screen.getByRole("button", { name: "Set time range to 15m" });
    fireEvent.click(btn15m);

    // Verify time range changed while active topology rule state was preserved
    expect(btn15m).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Filter lineage topology rules" })).toHaveTextContent(
      "External WAN ▾"
    );
  });

  it("renders the 7 diagnostic chain stages from the Rust backend and opens stage inspection drawer on click", async () => {
    const { fireEvent } = await import("@testing-library/react");
    setMonitor(mockMonitorSnapshot);

    render(<MonitoringTestWrapper />);

    // Verify the Diagnostic Chain card and 7 stages are rendered
    expect(screen.getByLabelText("Diagnostic Chain")).toBeTruthy();
    expect(screen.getByText("Device (Local Stack)")).toBeTruthy();
    expect(screen.getByText("Network Interface")).toBeTruthy();
    expect(screen.getByText("Router / Gateway")).toBeTruthy();
    expect(screen.getByText("Internet Service Provider")).toBeTruthy();
    expect(screen.getByText("DNS Resolver")).toBeTruthy();
    expect(screen.getByText("CDN / Edge Distribution")).toBeTruthy();
    expect(screen.getByText("Destination Server")).toBeTruthy();

    // Click on "Router / Gateway" stage node to open inspection drawer
    const routerNode = screen.getByRole("tab", { name: /Router \/ Gateway/i });
    fireEvent.click(routerNode);

    // Verify inspection drawer content
    expect(screen.getByLabelText("Router / Gateway Inspection")).toBeTruthy();
    expect(screen.getByText("Gateway Link Jitter / Loss Inferred")).toBeTruthy();
    expect(screen.getByText("Loss & jitter across multiple destinations")).toBeTruthy();
    expect(screen.getByText("1 flow sample")).toBeTruthy();

    // Verify Drill Down action button exists
    expect(screen.getByRole("button", { name: "Drill Down" })).toBeTruthy();
  });

  it("renders authentic OS process attribution and null fallbacks without fabrication", () => {
    const snapshotWithProcesses: MonitorSnapshot = {
      ...mockMonitorSnapshot,
      processes: [
        {
          pid: 4321,
          name: "curl.exe",
          exe_path: "C:\\Windows\\System32\\curl.exe",
          bytes: 800000,
          packets: 600,
          flows: 2,
          cpu_percent: 3.5,
          memory_bytes: 16 * 1024 * 1024,
        },
        {
          pid: null,
          name: "Unattributed Flows",
          exe_path: null,
          bytes: 200000,
          packets: 150,
          flows: 1,
          cpu_percent: null,
          memory_bytes: null,
        },
      ],
    };
    setMonitor(snapshotWithProcesses);
    render(<MonitoringTestWrapper />);

    // Verify authenticated process
    expect(screen.getByText("curl.exe")).toBeTruthy();
    expect(screen.getByText("PID 4321")).toBeTruthy();
    expect(screen.getByText("3.5%")).toBeTruthy();
    expect(screen.getByText("16 MB")).toBeTruthy();

    // Verify unattributed process renders honest dashes without fabricated numbers
    expect(screen.getByText("Unattributed Flows")).toBeTruthy();
    expect(screen.getByText("Unattributed")).toBeTruthy();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2); // CPU and RAM both dash
  });

  it("renders authentic backend subsystem health statuses and never fabricates mock statuses", () => {
    const snapshotWithSubsystems: MonitorSnapshot = {
      ...mockMonitorSnapshot,
      subsystems: [
        {
          name: "Capture Pipeline Buffer",
          status: "healthy",
          detail: "20.0% buffer utilization, 0 dropped frames",
        },
        {
          name: "Process Attribution Correlator",
          status: "healthy",
          detail: "Active table query via netpulse-platform sockets",
        },
      ],
    };
    setMonitor(snapshotWithSubsystems);
    render(<MonitoringTestWrapper />);

    // Authentic backend subsystems are rendered
    expect(screen.getByText("Capture Pipeline Buffer")).toBeTruthy();
    expect(screen.getByText("20.0% buffer utilization, 0 dropped frames")).toBeTruthy();
    expect(screen.getByText("Process Attribution Correlator")).toBeTruthy();

    // Fabricated mock strings must NEVER appear
    expect(screen.queryByText("eBPF active")).toBeNull();
    expect(screen.queryByText("12.4 GB free")).toBeNull();
    expect(screen.queryByText("240 MB RSS")).toBeNull();
  });

  it("dispatches on-demand stage probe and renders live probe result in inspection drawer", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const ipc = await import("../ipc");
    const querySpy = vi.spyOn(ipc, "query").mockResolvedValueOnce({
      kind: "stageProbeResult",
      result: {
        stage: "router",
        probe_type: "GatewayProbe",
        target: "192.168.1.1",
        status: "success",
        latency_ms: 1.8,
        summary: "Default gateway 192.168.1.1 reachable (1.8ms RTT)",
        details: ["Gateway interface reachable"],
      },
    } as any);

    setMonitor({
      ...mockMonitorSnapshot,
      diagnostic_chain: {
        stages: [
          {
            stage: "router",
            status: "investigate",
            measurement_state: "inferred",
            detection_state: "detected",
            label: "Router / Gateway",
            summary: "Gateway Link Jitter / Loss Inferred",
            detail: "Loss & jitter across multiple destinations",
            evidence: [],
            causes: ["local_wifi"],
            affected_targets: ["192.168.1.1"],
          },
        ],
      },
    });

    render(<MonitoringTestWrapper />);

    // Open router stage drawer
    const routerNode = screen.getByRole("tab", { name: /Router \/ Gateway/i });
    fireEvent.click(routerNode);

    // Click "Run Stage Probe"
    const probeBtn = screen.getByRole("button", { name: /Run Stage Probe/i });
    fireEvent.click(probeBtn);

    expect(querySpy).toHaveBeenCalledWith({
      kind: "runStageProbe",
      stage: "router",
      target: "192.168.1.1",
    });

    // Wait for live probe results to appear in drawer
    await waitFor(() => {
      expect(screen.getByText(/GatewayProbe \(SUCCESS\)/i)).toBeTruthy();
      expect(screen.getByText("1.8 ms")).toBeTruthy();
      expect(screen.getByText("Default gateway 192.168.1.1 reachable (1.8ms RTT)")).toBeTruthy();
    });
  });
});
