import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { I18nextProvider } from "react-i18next";
import type { MonitorSnapshot } from "@netpulse/contract";
import i18n from "../i18n";
import * as ipc from "../ipc";
import { setMonitor, __resetForTest } from "../state/store";
import { Monitoring } from "../screens/Monitoring";
import { Dashboard } from "../screens/Dashboard";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { preferencesManager } from "../screens/Monitoring/MonitoringPreferences";

function MonitoringWrapper({ children }: { children?: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          {children ?? <Monitoring />}
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    </I18nextProvider>
  );
}

function DashboardWrapper({ children }: { children?: React.ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          {children ?? <Dashboard />}
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    </I18nextProvider>
  );
}

const activeMonitorSnapshot: MonitorSnapshot = {
  by_protocol: {
    dimension: "protocol",
    rows: [
      { label: "HTTP", bytes: 1048576, flows: 5, hostnames: [{ name: "api.example.com", source: "dns" }], evidence: [] },
      { label: "DNS", bytes: 65536, flows: 3, hostnames: [{ name: "8.8.8.8", source: "dns" }], evidence: [] },
      { label: "TLS", bytes: 2097152, flows: 8, hostnames: [{ name: "secure.example.com", source: "sni" }], evidence: [] },
    ],
  },
  by_host: {
    dimension: "host",
    rows: [
      { label: "api.example.com", bytes: 1048576, flows: 5, hostnames: [{ name: "api.example.com", source: "dns" }], evidence: [] },
      { label: "8.8.8.8", bytes: 65536, flows: 3, hostnames: [{ name: "8.8.8.8", source: "dns" }], evidence: [] },
      { label: "secure.example.com", bytes: 2097152, flows: 8, hostnames: [{ name: "secure.example.com", source: "sni" }], evidence: [] },
    ],
  },
  capture_stats: {
    buffer_capacity: 1000,
    buffer_frames: 150,
    shed_stage: "none",
    dropped: 0,
  },
  diagnoses: [
    {
      cause: "local_wifi",
      severity: "finding",
      explanation: "Nominal latency across sampled endpoints",
      confidence_percent: 90,
      evidence: [{ kind: "flow" as const, id: 101 }],
    },
  ],
  network_loss_indicators: 0,
  capture_drops: 0,
  throughput_history: [
    {
      timestamp_mono_nanos: 1_000_000,
      ingress_rate_bytes_sec: 131072, // 128 KB/s
      egress_rate_bytes_sec: 32768,   // 32 KB/s
    },
    {
      timestamp_mono_nanos: 2_000_000,
      ingress_rate_bytes_sec: 262144, // 256 KB/s
      egress_rate_bytes_sec: 65536,   // 64 KB/s
    },
  ],
  processes: [
    {
      pid: 1024,
      name: "curl.exe",
      exe_path: "C:\\Windows\\System32\\curl.exe",
      bytes: 1048576,
      cpu_percent: 1.5,
      memory_bytes: 33554432, // 32 MB
      packets: 120,
      flows: 5,
    },
    {
      pid: 2048,
      name: "dns.exe",
      exe_path: "C:\\Windows\\System32\\dns.exe",
      bytes: 65536,
      cpu_percent: 0.4,
      memory_bytes: 16777216, // 16 MB
      packets: 40,
      flows: 3,
    },
    {
      pid: 4096,
      name: "chrome.exe",
      exe_path: "C:\\Program Files\\Google\\Chrome\\chrome.exe",
      bytes: 2097152,
      cpu_percent: 5.2,
      memory_bytes: 134217728, // 128 MB
      packets: 300,
      flows: 8,
    },
  ],
  diagnostic_chain: {
    stages: [
      {
        stage: "device",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Device (Local Stack)",
        summary: "Local Capture Pipeline Operational",
        detail: "Zero memory overrun",
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
        detail: "Full packet fidelity",
        evidence: [],
        causes: [],
        affected_targets: [],
      },
      {
        stage: "router",
        status: "healthy",
        measurement_state: "observed",
        detection_state: "detected",
        label: "Router / Gateway",
        summary: "Gateway Reachable",
        detail: "Gateway RTT nominal",
        evidence: [],
        causes: [],
        affected_targets: ["192.168.1.1"],
      },
      {
        stage: "isp",
        status: "unknown",
        measurement_state: "not_measurable",
        detection_state: "not_detected",
        label: "Internet Service Provider",
        summary: "ISP Upstream Hop Not Sampled",
        detail: "Requires active probe",
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
        detail: "DNS queries resolved",
        evidence: [],
        causes: [],
        affected_targets: ["8.8.8.8"],
      },
      {
        stage: "cdn",
        status: "not_measurable",
        measurement_state: "not_measurable",
        detection_state: "not_detected",
        label: "CDN / Edge Distribution",
        summary: "No Edge Endpoints in Window",
        detail: "No edge nodes identified",
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
        latency_ms: 18.2,
        evidence: [],
        causes: [],
        affected_targets: ["api.example.com", "secure.example.com"],
      },
    ],
  },
  telemetry_state: "active",
};

describe("Full Slice Integration Verification", () => {
  beforeEach(() => {
    __resetForTest();
    preferencesManager.reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("verifies full slice trace: active capture ingestion -> visual presentation -> standby transition -> active stage probe", async () => {
    // 1. Ingest populated MonitorSnapshot into React state store
    setMonitor(activeMonitorSnapshot);

    // 2. Render Monitoring Screen: verify populated KPIs, Throughput Graphs, and Process Rows
    const { unmount: unmountMonitoring } = render(<MonitoringWrapper />);

    // Screen title & region verification
    expect(screen.getByRole("heading", { name: /Live Monitoring & System Health/i })).toBeInTheDocument();

    // Verify KPIs
    expect(screen.getByText("Traffic Seen")).toBeInTheDocument();
    expect(screen.getAllByText("3.1 MB").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Protocols")).toBeInTheDocument();
    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Active Flows")).toBeInTheDocument();
    expect(screen.getAllByText("16").length).toBeGreaterThanOrEqual(1);

    // Verify Throughput & Lineage card is populated
    expect(screen.getByText("Throughput & Lineage")).toBeInTheDocument();
    expect(screen.getByText("Process Attributes")).toBeInTheDocument();

    // Verify Process Rows rendered with process names, PIDs, and formatted metrics
    expect(screen.getByText("curl.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 1024")).toBeInTheDocument();
    expect(screen.getByText("dns.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 2048")).toBeInTheDocument();
    expect(screen.getByText("chrome.exe")).toBeInTheDocument();
    expect(screen.getByText("PID 4096")).toBeInTheDocument();

    // Verify Protocol breakdown in visual presentation
    expect(screen.getByText("HTTP")).toBeInTheDocument();
    expect(screen.getByText("DNS")).toBeInTheDocument();
    expect(screen.getByText("TLS")).toBeInTheDocument();

    unmountMonitoring();

    // 3. Stop Capture: telemetry_state immediately transitions to Standby
    const standbySnapshot: MonitorSnapshot = {
      ...activeMonitorSnapshot,
      telemetry_state: "standby",
      throughput_history: [],
    };
    setMonitor(standbySnapshot);

    // Render Dashboard to verify immediate standby visual state
    const { unmount: unmountDashboard } = render(<DashboardWrapper />);

    // Invariant: rates reflect Standby
    expect(screen.getByText(/▼ 0 B\/s \(Standby\)/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 0 B\/s \(Standby\)/)).toBeInTheDocument();

    // 4. Run Active Stage Probe: verify IPC result appears in stage inspection drawer
    const querySpy = vi.spyOn(ipc, "query").mockResolvedValueOnce({
      kind: "stageProbeResult",
      result: {
        stage: "router",
        probe_type: "GatewayProbe",
        target: "192.168.1.1",
        status: "success",
        latency_ms: 1.8,
        summary: "Default gateway 192.168.1.1 on interface Ethernet: Reachable",
        details: ["Source: GatewayProbe", "Ping RTT: 1.8ms", "Packet Loss: 0%"],
      },
    } as any);

    // Click on Router stage node to open stage inspection drawer
    const routerNode = screen.getByRole("button", { name: /Router \/ Gateway/i });
    await act(async () => {
      fireEvent.click(routerNode);
    });

    // Verify inspection drawer opened
    const drawer = document.getElementById("stage-inspector-drawer");
    expect(drawer).toBeInTheDocument();
    expect(screen.getByText(/Router \/ Gateway Stage Measurement/i)).toBeInTheDocument();

    // Click "Run Stage Probe" button
    const runProbeBtn = screen.getByTestId("run-stage-probe-btn");
    expect(runProbeBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(runProbeBtn);
    });

    // Verify IPC query was dispatched with stage and target
    expect(querySpy).toHaveBeenCalledWith({
      kind: "runStageProbe",
      stage: "router",
      target: "192.168.1.1",
    });

    // Verify IPC result rendered in the stage inspection drawer
    await waitFor(() => {
      const probeResultEl = screen.getByTestId("stage-probe-result");
      expect(probeResultEl).toBeInTheDocument();
      expect(screen.getByText("GatewayProbe")).toBeInTheDocument();
      expect(screen.getByText("1.8 ms")).toBeInTheDocument();
      expect(screen.getByText(/Default gateway 192.168.1.1 on interface Ethernet: Reachable/i)).toBeInTheDocument();
      expect(screen.getByText("Source: GatewayProbe")).toBeInTheDocument();
      expect(screen.getByText("Packet Loss: 0%")).toBeInTheDocument();
    });


    unmountDashboard();
  });
});
