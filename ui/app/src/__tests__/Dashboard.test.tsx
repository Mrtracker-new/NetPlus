import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Dashboard } from "../screens/Dashboard";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { setFeed, setMonitor, resetSession, __resetForTest } from "../state/store";

afterEach(() => {
  cleanup();
});

function DashboardTestWrapper({
  loading = false,
  error = null,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Dashboard loading={loading} error={error} onRetry={onRetry} />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Dashboard Screen", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders zero state KPIs when monitor snapshot is empty", () => {
    render(<DashboardTestWrapper />);

    expect(screen.getByText("Hosts Observed")).toBeInTheDocument();
    expect(screen.getByText("Active Flows")).toBeInTheDocument();
    expect(screen.getByText("Network Activity")).toBeInTheDocument();
    expect(screen.getByText("Narrative Cards")).toBeInTheDocument();

    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it("renders populated KPI metrics when monitor snapshot is populated", () => {
    setMonitor({
      by_protocol: {
        dimension: "protocol",
        rows: [{ label: "HTTPS", bytes: 1048576, flows: 4, hostnames: [], evidence: [] }],
      },
      by_host: {
        dimension: "host",
        rows: [
          { label: "1.1.1.1", bytes: 524288, flows: 2, hostnames: [], evidence: [] },
          { label: "8.8.8.8", bytes: 524288, flows: 2, hostnames: [], evidence: [] },
        ],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<DashboardTestWrapper />);

    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("4").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.0 MB").length).toBeGreaterThanOrEqual(1);
  });

  it("renders exact-fit Skeleton loading components when loading=true", () => {
    render(<DashboardTestWrapper loading={true} />);

    expect(screen.getByRole("region", { name: "Loading statistics" })).toBeInTheDocument();
  });

  it("renders classified error banner and handles recovery click", () => {
    const handleRetry = vi.fn();
    render(
      <DashboardTestWrapper
        error="Unable to communicate with the NetPulse engine daemon."
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText(/Backend Disconnected/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry Connection" });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("renders narrative cards and evidence navigation chips", () => {
    setFeed([
      {
        headline: "High DNS latency observed",
        summary: "Queries to 1.1.1.1 took over 150ms",
        lines: ["Expert detail line 1"],
        severity: "notable",
        evidence: [{ kind: "flow", id: 42 }],
        at_mono_nanos: 1000,
      },
    ]);

    render(<DashboardTestWrapper />);

    expect(screen.getByText("High DNS latency observed")).toBeInTheDocument();
    expect(screen.getByText("Queries to 1.1.1.1 took over 150ms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Evidence: flow #42" })).toBeInTheDocument();
  });

  it("exposes accessible landmarks with aria-labelledby", () => {
    render(<DashboardTestWrapper />);

    expect(screen.getByRole("region", { name: /Global Traffic Map|Live Traffic Stream/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What's happening" })).toBeInTheDocument();
  });


  it("filters narrative cards when Network Flows category tab is clicked", () => {
    setFeed([
      {
        headline: "TCP flow established on port 443",
        summary: "Active connection to 1.1.1.1",
        lines: ["Local port 52341"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 101 }],
        at_mono_nanos: 1000,
      },
      {
        headline: "Unusual application launched",
        summary: "Process spotify.exe active",
        lines: ["PID 4502"],
        severity: "neutral",
        evidence: [{ kind: "session", id: 202 }],
        at_mono_nanos: 2000,
      },
    ]);

    render(<DashboardTestWrapper />);

    expect(screen.getByText("TCP flow established on port 443")).toBeInTheDocument();
    expect(screen.getByText("Unusual application launched")).toBeInTheDocument();

    const networkTab = screen.getByRole("tab", { name: "Network Flows" });
    fireEvent.click(networkTab);

    expect(screen.getByText("TCP flow established on port 443")).toBeInTheDocument();
    expect(screen.queryByText("Unusual application launched")).not.toBeInTheDocument();
  });

  it("renders technical explain drawer with protocol context and evidence", () => {
    setFeed([
      {
        headline: "DNS query to cloudflare-dns.com",
        summary: "Resolved in 14ms",
        lines: ["Answer: 1.1.1.1"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 55 }],
        at_mono_nanos: 5000,
      },
    ]);

    render(<DashboardTestWrapper />);

    const explainBtn = screen.getByRole("button", { name: "Explain DNS query to cloudflare-dns.com" });
    fireEvent.click(explainBtn);

    expect(screen.getByText("Why is this happening?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quick Peek Drawer/i })).toBeInTheDocument();

    const drawerBtn = screen.getByRole("button", { name: /Quick Peek Drawer/i });
    fireEvent.click(drawerBtn);

    expect(screen.getByText("Quick Peek Technical Evidence")).toBeInTheDocument();
    expect(screen.getByText("DNS (Port 53)")).toBeInTheDocument();
    expect(screen.getByText("Metadata-Only Capture (Payload bytes omitted by design for zero-leak privacy)")).toBeInTheDocument();
  });

  it("resets category and search filters when Reset Filters button is clicked in empty state", () => {
    setFeed([
      {
        headline: "DNS lookup for google.com",
        summary: "Latency 12ms",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1000,
      },
    ]);

    render(<DashboardTestWrapper />);

    const searchInput = screen.getByLabelText("Search narrative feed");
    fireEvent.change(searchInput, { target: { value: "nonexistentquery123" } });

    expect(screen.getByText("No narrative items match your search or filter criteria.")).toBeInTheDocument();
    const resetBtn = screen.getByRole("button", { name: "Reset Filters" });
    expect(resetBtn).toBeInTheDocument();

    fireEvent.click(resetBtn);

    expect(screen.getByText("DNS lookup for google.com")).toBeInTheDocument();
  });

  it("handles recommendation click in SituationSummary to filter findings", () => {
    setFeed([
      {
        headline: "DNS tunneling anomaly detected",
        summary: "High volume TXT queries to c2.example.org",
        lines: ["Entropy 4.8 bits/byte"],
        severity: "finding",
        evidence: [{ kind: "flow", id: 99 }],
        at_mono_nanos: 1000,
      },
      {
        headline: "Normal HTTPS connection",
        summary: "Browsing github.com",
        lines: ["TLS 1.3"],
        severity: "neutral",
        evidence: [{ kind: "session", id: 100 }],
        at_mono_nanos: 2000,
      },
    ]);

    render(<DashboardTestWrapper />);

    expect(screen.getByText(/Attention Needed/i)).toBeInTheDocument();
    const recButton = screen.getByRole("button", { name: /Recommendation: Investigate DNS tunneling anomaly detected/i });
    expect(recButton).toBeInTheDocument();

    fireEvent.click(recButton);

    expect(screen.getByText("DNS tunneling anomaly detected")).toBeInTheDocument();
    expect(screen.queryByText("Normal HTTPS connection")).not.toBeInTheDocument();
  });

  it("calculates throughput sparkline and rates with single and multiple delta updates", () => {
    setMonitor({
      by_protocol: {
        dimension: "protocol",
        rows: [{ label: "HTTPS", bytes: 2097152, flows: 3, hostnames: [], evidence: [] }],
      },
      by_host: {
        dimension: "host",
        rows: [{ label: "1.1.1.1", bytes: 2097152, flows: 3, hostnames: [], evidence: [] }],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    // Push a second snapshot to establish a positive throughput rate delta (1MB delta)
    setMonitor({
      by_protocol: {
        dimension: "protocol",
        rows: [{ label: "HTTPS", bytes: 3145728, flows: 3, hostnames: [], evidence: [] }],
      },
      by_host: {
        dimension: "host",
        rows: [{ label: "1.1.1.1", bytes: 3145728, flows: 3, hostnames: [], evidence: [] }],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<DashboardTestWrapper />);

    expect(screen.getAllByText("3.0 MB").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1.0 MB\/s/).length).toBeGreaterThanOrEqual(1);
  });

  it("supports keyboard navigation (ArrowRight, ArrowLeft, Home, End) across narrative category tabs", () => {
    render(<DashboardTestWrapper />);

    const allTab = screen.getByRole("tab", { name: "All Activity" });
    const securityTab = screen.getByRole("tab", { name: "Security Findings" });

    expect(allTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(securityTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(securityTab, { key: "End" });
    const networkTab = screen.getByRole("tab", { name: "Network Flows" });
    expect(networkTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(networkTab, { key: "Home" });
    expect(screen.getByRole("tab", { name: "All Activity" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders system health telemetry strip with honest status", () => {
    setMonitor({
      by_protocol: {
        dimension: "protocol",
        rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }],
      },
      by_host: {
        dimension: "host",
        rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 5,
      capture_stats: { buffer_frames: 100, buffer_capacity: 1000, shed_stage: "drop_packets", dropped: 5 },
    });

    render(<DashboardTestWrapper />);

    const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
    expect(healthStrip).toBeInTheDocument();
    expect(within(healthStrip).getByText("Capture:")).toBeInTheDocument();
    expect(within(healthStrip).getByText("Active")).toBeInTheDocument();
    expect(within(healthStrip).getByText("Flow Engine:")).toBeInTheDocument();
    expect(within(healthStrip).getByText(/Dropping/)).toBeInTheDocument();
    expect(within(healthStrip).getByText("5")).toBeInTheDocument();
  });


  it("handles full lifecycle state progression: loading -> populated -> filtered-empty -> error -> recovered", async () => {
    // 1. Loading State
    const { unmount } = render(<DashboardTestWrapper loading={true} />);
    expect(screen.getByRole("region", { name: "Loading statistics" })).toBeInTheDocument();
    unmount();

    // 2. Populated State
    setFeed([
      {
        headline: "TLS session established with github.com",
        summary: "Transferred 50 KB over port 443",
        lines: ["ALPN: h2", "Cipher: TLS_AES_128_GCM_SHA256"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 501 }],
        at_mono_nanos: 1000,
      },
    ]);

    const { rerender } = render(<DashboardTestWrapper />);
    expect(screen.getByText("TLS session established with github.com")).toBeInTheDocument();

    // 3. Filtered-empty State (Search with no matches)
    const searchInput = screen.getByLabelText(/Search narrative feed/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent_query_xyz" } });
    expect(screen.getByText("No Matching Narratives")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Filters" })).toBeInTheDocument();

    // Reset filters
    fireEvent.click(screen.getByRole("button", { name: "Reset Filters" }));
    expect(screen.getByText("TLS session established with github.com")).toBeInTheDocument();

    // 4. Error State
    rerender(<DashboardTestWrapper error="Simulated IPC failure" />);
    expect(screen.getByText(/Backend Disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/Simulated IPC failure/i)).toBeInTheDocument();

    // 5. Recovered State
    rerender(<DashboardTestWrapper loading={false} error={null} />);
    expect(screen.queryByText(/Backend Disconnected/i)).not.toBeInTheDocument();
    expect(screen.getByText("TLS session established with github.com")).toBeInTheDocument();
  });

  it("handles Reconnect lifecycle: resetSession resets snapshotSequence to 0 and establishes fresh session lineage", () => {
    // 1. Initial active session with sequence 1 and 2
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
      by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1500, flows: 1, hostnames: [], evidence: [] }] },
      by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1500, flows: 1, hostnames: [], evidence: [] }] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    // 2. Reconnect event triggers resetSession
    resetSession("session-reconnect-999");

    // 3. Post-reconnect telemetry arrives and starts sequence at 1
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 500, flows: 1, hostnames: [], evidence: [] }] },
      by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 500, flows: 1, hostnames: [], evidence: [] }] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<DashboardTestWrapper />);
    expect(screen.getByText("Network Operating Normally")).toBeInTheDocument();
    expect(screen.getByText(/Total volume transferred is 500 B/i)).toBeInTheDocument();
  });

  describe("Semantic Regression Invariants", () => {
    it("Invariant 1: High byte volume alone never produces ATTENTION, FAILURE, or SPIKE on Hero card", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 500_000_000, flows: 10, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 500_000_000, flows: 10, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
      });
      setFeed([]);

      render(<DashboardTestWrapper />);
      // Hero headline must remain nominal
      expect(screen.getByText("Network Operating Normally")).toBeInTheDocument();
      expect(screen.getByText("● Nominal")).toBeInTheDocument();
      expect(screen.queryByText(/High Network Activity/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Attention Required/i)).not.toBeInTheDocument();
    });

    it("Invariant 2: drops > 0 without actionable shed_stage remains honest telemetry and does not become FAILURE", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 12,
        capture_stats: { buffer_frames: 50, buffer_capacity: 1000, shed_stage: "none", dropped: 12 },
      });

      render(<DashboardTestWrapper />);
      const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
      // Flow engine must report healthy when shed_stage is none
      expect(within(healthStrip).getByText("Healthy")).toBeInTheDocument();
      expect(within(healthStrip).queryByText("Dropping")).not.toBeInTheDocument();
      // Drops count must be rendered honestly
      expect(within(healthStrip).getByText("12")).toBeInTheDocument();
    });

    it("Invariant 3: shed_stage === 'drop_packets' surfaces operational degradation/failure state", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 42,
        capture_stats: { buffer_frames: 1000, buffer_capacity: 1000, shed_stage: "drop_packets", dropped: 42 },
      });

      render(<DashboardTestWrapper />);
      const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
      expect(within(healthStrip).getByText(/Dropping/)).toBeInTheDocument();
    });

    it("Invariant 4: 0 B/s throughput is rendered as Idle rather than active throughput", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
      });

      render(<DashboardTestWrapper />);
      expect(screen.getByText(/0 B\/s \(Idle\)/)).toBeInTheDocument();
    });

    it("Invariant 5: Missing or insufficient sparkline history renders honest NO HISTORY label", () => {
      render(<DashboardTestWrapper />);
      const noHistoryLabels = screen.getAllByText("NO HISTORY");
      expect(noHistoryLabels.length).toBeGreaterThanOrEqual(1);
    });
  });
});
