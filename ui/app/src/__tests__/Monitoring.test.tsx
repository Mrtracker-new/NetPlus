import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Monitoring } from "../screens/Monitoring";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { setMonitor, __resetForTest } from "../state/store";
import { AreaChart, protocolColor } from "@netpulse/viz";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function MonitoringTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Monitoring />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

const mockMonitorSnapshot = {
  by_protocol: {
    dimension: "protocol" as const,
    rows: [
      { label: "TCP", flows: 12, bytes: 1048576, hostnames: [], evidence: [] },
      { label: "UDP", flows: 4, bytes: 524288, hostnames: [], evidence: [] },
      { label: "DNS", flows: 2, bytes: 65536, hostnames: [], evidence: [] },
    ],
  },
  by_host: {
    dimension: "host" as const,
    rows: [
      {
        label: "142.250.190.46",
        flows: 10,
        bytes: 1048576,
        hostnames: [{ name: "google.com", source: "sni" as const }],
        evidence: [],
      },
    ],
  },
  capture_stats: {
    buffer_frames: 120,
    buffer_capacity: 1000,
    shed_stage: "none" as const,
    dropped: 0,
  },
  capture_drops: 0,
  network_loss_indicators: 0,
  diagnoses: [
    {
      cause: "packet_loss" as any,
      explanation: "Looks like high packet loss on edge gateway",
      confidence_percent: 85,
      confidence_word: "high",
      evidence: [{ kind: "flow" as const, id: 707 }],
    },
  ],
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

  it("renders idle state when monitor snapshot is null", () => {
    render(<MonitoringTestWrapper />);

    expect(
      screen.getByText("Idle — no traffic to measure. Start a capture to view live telemetry.")
    ).toBeInTheDocument();
  });

  it("renders populated snapshot KPIs, capture health, charts, and diagnostic cards", () => {
    setMonitor(mockMonitorSnapshot);

    render(<MonitoringTestWrapper />);

    // Check KPIs
    expect(screen.getByText("Traffic Seen")).toBeInTheDocument();
    expect(screen.getByText("Capture Health")).toBeInTheDocument();
    expect(screen.getByText("Full Fidelity")).toBeInTheDocument();

    // Check Diagnosis Card & Evidence Chips
    expect(screen.getByText("Looks like high packet loss on edge gateway")).toBeInTheDocument();
    expect(screen.getByText("flow #707")).toBeInTheDocument();
  });

  it("AreaChart generates unique fill gradient IDs using React useId()", () => {
    const { container } = render(
      <div>
        <AreaChart values={[10, 20, 30]} label="Chart 1" />
        <AreaChart values={[5, 15, 25]} label="Chart 2" />
      </div>
    );

    const linearGradients = container.querySelectorAll("linearGradient");
    expect(linearGradients.length).toBe(2);
    const id1 = linearGradients[0]?.getAttribute("id");
    const id2 = linearGradients[1]?.getAttribute("id");
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(id1).not.toBe(id2);
  });
});
