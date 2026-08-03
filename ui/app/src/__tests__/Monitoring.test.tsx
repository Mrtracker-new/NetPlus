import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
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

    expect(screen.getByText("Live Monitoring & System Health")).toBeTruthy();
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

    expect(screen.getByText("Live Monitoring & System Health")).toBeTruthy();
  });
});
