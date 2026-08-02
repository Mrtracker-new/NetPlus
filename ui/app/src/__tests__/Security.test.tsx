import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Security } from "../screens/Security";
import { STORAGE_KEY } from "../hooks/useSecurityController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function SecurityTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Security />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Security Screen & useSecurityController", () => {
  beforeEach(() => {
    __resetForTest();
    localStorage.clear();
  });

  it("renders zero state guide when no security findings exist", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "findings",
      findings: [],
    } as any);

    render(<SecurityTestWrapper />);

    expect(
      await screen.findByText("No security anomalies detected in selected window. Network activity appears normal.")
    ).toBeInTheDocument();
  });

  it("renders security findings list, summary KPIs, confidence meters, and category filter chips", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "findings",
      findings: [
        {
          kind: "port_scan",
          category: "suspicious",
          title: "Horizontal Port Scan Detected",
          confidence_percent: 92,
          qualitative: "High",
          explanation: "Sequential connection attempts across 50 ports within 2 seconds.",
          technical: "SYN packets to 192.168.1.1:1-50",
          corroboration: ["connection_storm"],
          benign_explanations: ["Internal security scanner sweep"],
          suggested_action: "Verify source process and IP address",
          evidence: [{ id: "pkt-1", kind: "packet", label: "Packet #1" }],
        },
        {
          kind: "dns_anomaly",
          category: "anomaly",
          title: "High-Volume DNS Queries",
          confidence_percent: 65,
          qualitative: "Medium",
          explanation: "Burst of DNS queries to subdomains.",
          technical: "Query rate: 60/sec",
          corroboration: [],
          benign_explanations: ["CDN prefetching"],
          suggested_action: "Inspect DNS logs",
          evidence: [{ id: "flow-10", kind: "flow", label: "Flow #10" }],
        },
      ],
    } as any);

    render(<SecurityTestWrapper />);

    const portScanTitles = await screen.findAllByText("Horizontal Port Scan Detected");
    expect(portScanTitles[0]).toBeInTheDocument();

    const dnsTitles = await screen.findAllByText("High-Volume DNS Queries");
    expect(dnsTitles[0]).toBeInTheDocument();

    expect(screen.getByText("Port scanning")).toBeInTheDocument();
    expect(screen.getByText("DNS burst")).toBeInTheDocument();

    // Summary KPIs
    expect(screen.getByText("Total Findings")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("filters findings by category chip selection", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "findings",
      findings: [
        {
          kind: "port_scan",
          category: "suspicious",
          title: "Horizontal Port Scan",
          confidence_percent: 90,
          qualitative: "High",
          explanation: "Port scan detected.",
          corroboration: [],
          benign_explanations: [],
          suggested_action: "Inspect source",
          evidence: [],
        },
        {
          kind: "bandwidth_anomaly",
          category: "informational",
          title: "High Bandwidth Transfer",
          confidence_percent: 40,
          qualitative: "Low",
          explanation: "Large download.",
          corroboration: [],
          benign_explanations: [],
          suggested_action: "Check process",
          evidence: [],
        },
      ],
    } as any);

    render(<SecurityTestWrapper />);

    const portScanTitles = await screen.findAllByText("Horizontal Port Scan");
    expect(portScanTitles[0]).toBeInTheDocument();
    expect(screen.getAllByText("High Bandwidth Transfer")[0]).toBeInTheDocument();

    // Click "Suspicious" filter chip
    const suspiciousChip = screen.getByRole("button", { name: "Suspicious" });
    fireEvent.click(suspiciousChip);

    expect(screen.getAllByText("Horizontal Port Scan")[0]).toBeInTheDocument();
    expect(screen.queryByText("High Bandwidth Transfer")).not.toBeInTheDocument();
  });

  it("marks finding as expected and persists expected keys in localStorage under netpulse.security.expected.v1", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "findings",
      findings: [
        {
          kind: "dns_anomaly",
          category: "anomaly",
          title: "High-Volume DNS Queries",
          confidence_percent: 60,
          qualitative: "Medium",
          explanation: "Burst of DNS queries.",
          corroboration: [],
          benign_explanations: [],
          suggested_action: "Inspect DNS",
          evidence: [{ id: "flow-10", kind: "flow", label: "Flow #10" }],
        },
      ],
    } as any);

    render(<SecurityTestWrapper />);

    const dnsTitles = await screen.findAllByText("High-Volume DNS Queries");
    expect(dnsTitles[0]).toBeInTheDocument();

    const markBtn = screen.getByRole("button", { name: "Mark as expected" });
    fireEvent.click(markBtn);

    const showSuppressedBtn = screen.getByRole("button", { name: /Show Suppressed/i });
    fireEvent.click(showSuppressedBtn);

    expect(screen.getByRole("button", { name: "Marked expected" })).toBeInTheDocument();

    const storedRaw = localStorage.getItem(STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    expect(storedRaw).toContain("dns_anomaly:flow-10");
  });
});
