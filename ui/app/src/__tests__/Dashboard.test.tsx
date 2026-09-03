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
    expect(screen.getAllByText("Queries to 1.1.1.1 took over 150ms").length).toBeGreaterThanOrEqual(1);
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

    expect(screen.getByText(/Security \/ Protocol Finding — DNS tunneling anomaly detected/i)).toBeInTheDocument();
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
        rows: [{ label: "HTTPS", bytes: 3145728, flows: 3, hostnames: [], evidence: [] }],
      },
      by_host: {
        dimension: "host",
        rows: [{ label: "1.1.1.1", bytes: 3145728, flows: 3, hostnames: [], evidence: [] }],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
      telemetry_state: "active",
      throughput_history: [
        { timestamp_mono_nanos: 1, ingress_rate_bytes_sec: 1048576, egress_rate_bytes_sec: 524288 },
      ],
    });

    render(<DashboardTestWrapper />);

    expect(screen.getAllByText("3.0 MB").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1.0 MB\/s/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/512 KB\/s/).length).toBeGreaterThanOrEqual(1);
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
      subsystems: [
        { name: "Capture Driver", status: "healthy", detail: "Active" },
        { name: "Flow Engine", status: "degraded", detail: "Dropping" },
      ],
    });

    render(<DashboardTestWrapper />);

    const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
    expect(healthStrip).toBeInTheDocument();
    expect(within(healthStrip).getByText("Capture Driver:")).toBeInTheDocument();
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

    it("Invariant 2: subsystems map directly from backend authority and drops count renders honestly", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 12,
        subsystems: [
          { name: "Flow Engine", status: "healthy", detail: "Healthy" },
        ],
      });

      render(<DashboardTestWrapper />);
      const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
      expect(within(healthStrip).getByText("Flow Engine:")).toBeInTheDocument();
      expect(within(healthStrip).getByText("Healthy")).toBeInTheDocument();
      expect(within(healthStrip).queryByText("Dropping")).not.toBeInTheDocument();
      expect(within(healthStrip).getByText("12")).toBeInTheDocument();
    });

    it("Invariant 3: degraded subsystem status surfaces operational degradation state honestly", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 42,
        subsystems: [
          { name: "Flow Engine", status: "degraded", detail: "Dropping" },
        ],
      });

      render(<DashboardTestWrapper />);
      const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });
      expect(within(healthStrip).getByText(/Dropping/)).toBeInTheDocument();
    });

    it("Invariant 4: Standby telemetry state renders Standby rather than active throughput", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "standby",
      });

      render(<DashboardTestWrapper />);
      expect(screen.getAllByText(/0 B\/s \(Standby\)/).length).toBe(2);
    });

    it("Invariant 5: Missing or insufficient sparkline history renders honest NO HISTORY label", () => {
      render(<DashboardTestWrapper />);
      const noHistoryLabels = screen.getAllByText("NO HISTORY");
      expect(noHistoryLabels.length).toBeGreaterThanOrEqual(1);
    });

    it("Invariant 6: Stale telemetry state explicitly renders ▼ — /s (Stale) for both ingress and egress", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 5000, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 5000, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "stale",
        throughput_history: [{ timestamp_mono_nanos: 1, ingress_rate_bytes_sec: 50000, egress_rate_bytes_sec: 10000 }],
      });

      render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ — \/s \(Stale\)/)).toBeInTheDocument();
      expect(screen.getByText(/▲ — \/s \(Stale\)/)).toBeInTheDocument();
      expect(screen.getByText("Stale")).toBeInTheDocument();
    });

    it("Invariant 7: Primary diagnosis severity directly sets SituationSummary and Hero state without frontend thresholds", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [
          {
            cause: "slow_dns",
            severity: "finding",
            confidence_percent: 75,
            explanation: "DNS query latency exceeding 350ms across configured resolvers.",
            evidence: [{ kind: "flow", id: 404 }],
          },
        ],
        network_loss_indicators: 0,
        capture_drops: 0,
      });

      render(<DashboardTestWrapper />);
      expect(screen.getByText("Degradation Detected — Likely Slow DNS")).toBeInTheDocument();
      expect(screen.getByText("DNS query latency exceeding 350ms across configured resolvers.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Investigate Slow DNS hypothesis \(75% confidence\)/i })).toBeInTheDocument();
      expect(screen.getByText("● Attention")).toBeInTheDocument();
    });

    it("Invariant 8: Diagnostic Chain renders 7 tactile stages with full accessibility labels and unmeasured fallbacks", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        diagnostic_chain: {
          stages: [
            {
              stage: "dns",
              label: "DNS Resolver",
              status: "degraded",
              measurement_state: "inferred",
              detection_state: "detected",
              causes: ["slow_dns"],
              affected_targets: [],
              latency_ms: 324,
              summary: "High latency on primary upstream",
              evidence: [],
            },
            {
              stage: "router",
              label: "Gateway",
              status: "healthy",
              measurement_state: "observed",
              detection_state: "detected",
              causes: [],
              affected_targets: [],
              latency_ms: 2,
              summary: "Local gateway responsive",
              evidence: [],
            },
          ],
        },
      });

      render(<DashboardTestWrapper />);
      const chain = screen.getByRole("region", { name: "7-Stage Diagnostic Telemetry Chain" });
      expect(chain).toBeInTheDocument();

      // Configured stages
      expect(within(chain).getByRole("button", { name: /DNS Resolver — Status: Degraded — Latency: 324 ms/i })).toBeInTheDocument();
      expect(within(chain).getByRole("button", { name: /Gateway — Status: Healthy — Latency: 2 ms/i })).toBeInTheDocument();

      // Unmeasured fallback stages
      expect(within(chain).getByRole("button", { name: /Device — Status: Unmeasured/i })).toBeInTheDocument();
      expect(within(chain).getByRole("button", { name: /Destination — Status: Unmeasured/i })).toBeInTheDocument();
    });

    it("Invariant 9: Evidence navigation displays user feedback notice when evidence flow is outside active feed window", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [
          {
            cause: "local_wifi",
            severity: "finding",
            confidence_percent: 80,
            explanation: "Wi-Fi frame retry rate high",
            evidence: [{ kind: "flow", id: 99999 }],
          },
        ],
        network_loss_indicators: 0,
        capture_drops: 0,
      });
      setFeed([]);

      render(<DashboardTestWrapper />);
      const recBtn = screen.getByRole("button", { name: /Investigate Local Wi-Fi \/ Link hypothesis/i });
      fireEvent.click(recBtn);

      expect(screen.getByText(/Evidence flow #99999 is outside the active visible feed window/i)).toBeInTheDocument();
    });

    it("Invariant 10: Unavailable telemetry state explicitly renders ▼ — (Unavailable) and ▲ — (Unavailable)", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "unavailable",
      });

      render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ — \(Unavailable\)/)).toBeInTheDocument();
      expect(screen.getByText(/▲ — \(Unavailable\)/)).toBeInTheDocument();
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });

    it("Invariant 11: capture_drops is an independent observation that never overrides or reinterprets SubsystemStatus", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 1042,
        subsystems: [
          { name: "Capture Pipeline", status: "healthy", detail: "Active streaming" },
          { name: "Flow Engine", status: "healthy", detail: "Nominal" },
        ],
      });

      render(<DashboardTestWrapper />);
      const healthStrip = screen.getByRole("region", { name: "System Health Telemetry" });

      // Subsystem statuses remain strictly evaluated by backend (healthy), not degraded by drops
      expect(within(healthStrip).getByText("Active streaming")).toBeInTheDocument();
      expect(within(healthStrip).getByText("Nominal")).toBeInTheDocument();
      expect(within(healthStrip).queryByText("Dropping")).not.toBeInTheDocument();

      // Drops count is reported honestly as an independent metric
      expect(within(healthStrip).getByText("1042")).toBeInTheDocument();
    });

    it("Invariant 12: Diagnostic chain stage node opens measurement inspection drawer without navigating, and offers stage evidence action", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        diagnostic_chain: {
          stages: [
            {
              stage: "dns",
              label: "DNS Resolver",
              status: "degraded",
              measurement_state: "inferred",
              detection_state: "detected",
              causes: ["slow_dns"],
              affected_targets: [],
              latency_ms: 324,
              summary: "High latency on primary upstream",
              detail: "Upstream 1.1.1.1 intermittent timeouts",
              evidence: [{ kind: "flow", id: 404 }],
            },
          ],
        },
      });

      render(<DashboardTestWrapper />);

      const dnsNode = screen.getByRole("button", { name: /DNS Resolver — Status: Degraded — Latency: 324 ms/i });
      expect(dnsNode).toHaveAttribute("aria-expanded", "false");

      // Click stage node -> opens inspection drawer
      fireEvent.click(dnsNode);
      expect(dnsNode).toHaveAttribute("aria-expanded", "true");

      const drawer = screen.getByRole("region", { name: "Inspection details for DNS Resolver" });
      expect(drawer).toBeInTheDocument();
      expect(within(drawer).getByText(/Upstream 1.1.1.1 intermittent timeouts/i)).toBeInTheDocument();

      // Explicit stage evidence button is present inside drawer
      const evidenceBtn = within(drawer).getByRole("button", { name: /Inspect Stage Evidence \(flow #404\) →/i });
      expect(evidenceBtn).toBeInTheDocument();

      // Click evidence button -> triggers evidence navigation
      fireEvent.click(evidenceBtn);
      expect(screen.getByText(/Evidence flow #404 is outside the active visible feed window/i)).toBeInTheDocument();
    });

    it("Invariant 13: SummaryEngine respects the explicit precedence hierarchy", () => {
      // Scenario A: Feed notable event when no diagnosis exists -> overallHealth is 'notable'
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "standby",
      });
      setFeed([
        {
          at_mono_nanos: 1_000_000,
          severity: "notable",
          headline: "Sustained Upload Stream",
          summary: "Large data transfer detected to cloud destination.",
          lines: [],
          evidence: [{ kind: "flow", id: 10 }],
        },
      ]);

      const { unmount } = render(<DashboardTestWrapper />);
      expect(screen.getByText("Notable Activity — Sustained Upload Stream")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Action: Monitor Sustained Upload Stream/i })).toBeInTheDocument();
      unmount();

      // Scenario B: Diagnosis finding dominates over feed notable
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [
          {
            cause: "local_wifi",
            confidence_percent: 75,
            severity: "finding",
            evidence: [{ kind: "flow", id: 20 }],
            explanation: "High retransmit rate on local link.",
          },
        ],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "standby",
      });

      render(<DashboardTestWrapper />);
      expect(screen.getByText(/Degradation Detected — Likely Local Link \/ Wi-Fi/i)).toBeInTheDocument();
      expect(screen.getByText(/Investigate Local Wi-Fi \/ Link hypothesis/i)).toBeInTheDocument();
    });

    it("Invariant 14: CardExplainBox guarantees strict CTA exclusivity between card footer and quick peek drawer", () => {
      setFeed([
        {
          at_mono_nanos: 2_000_000,
          severity: "finding",
          headline: "Cleartext Protocol Detected",
          summary: "Unencrypted traffic observed on port 80.",
          lines: ["Observed GET request without TLS"],
          evidence: [{ kind: "flow", id: 42 }],
        },
      ]);

      render(<DashboardTestWrapper />);

      // Open Explain box
      const explainBtn = screen.getByRole("button", { name: /Explain Cleartext Protocol Detected/i });
      fireEvent.click(explainBtn);

      // When drawer is closed: exactly one CTA exists
      const initialCtas = screen.getAllByRole("button", { name: /Inspect Technical Evidence →/i });
      expect(initialCtas).toHaveLength(1);

      // Open drawer
      const quickPeekBtn = screen.getByRole("button", { name: /Quick Peek Drawer/i });
      fireEvent.click(quickPeekBtn);

      // When drawer is open: still exactly one CTA exists (inside the drawer)
      const openCtas = screen.getAllByRole("button", { name: /Inspect Technical Evidence →/i });
      expect(openCtas).toHaveLength(1);
      expect(screen.getByRole("region", { name: "Quick Peek Technical Evidence" })).toBeInTheDocument();

      // Close drawer
      const hideBtn = screen.getByRole("button", { name: /Hide Quick Peek Drawer/i });
      fireEvent.click(hideBtn);

      // Back to closed: still exactly one CTA exists
      const closedCtas = screen.getAllByRole("button", { name: /Inspect Technical Evidence →/i });
      expect(closedCtas).toHaveLength(1);
    });

    it("Invariant 15: Telemetry rates strictly honor the full 4-state contract (Active, Stale, Standby, Unavailable)", () => {
      // 1. Active: Displays measured numeric rate
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "active",
        throughput_history: [
          {
            timestamp_mono_nanos: 1_000_000,
            ingress_rate_bytes_sec: 1048576,
            egress_rate_bytes_sec: 524288,
          },
        ],
      });

      const { unmount: unmount1 } = render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ 1.0 MB\/s/)).toBeInTheDocument();
      expect(screen.getByText(/▲ 512 KB\/s/)).toBeInTheDocument();
      unmount1();

      // 2. Stale: Displays '— /s (Stale)' without claiming zero traffic
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "stale",
        throughput_history: [
          {
            timestamp_mono_nanos: 1_000_000,
            ingress_rate_bytes_sec: 1048576,
            egress_rate_bytes_sec: 524288,
          },
        ],
      });

      const { unmount: unmount2 } = render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ — \/s \(Stale\)/)).toBeInTheDocument();
      expect(screen.getByText(/▲ — \/s \(Stale\)/)).toBeInTheDocument();
      expect(screen.getByText("Stale")).toBeInTheDocument();
      unmount2();

      // 3. Standby: Displays measured baseline '0 B/s (Standby)'
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "standby",
        throughput_history: [],
      });

      const { unmount: unmount3 } = render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ 0 B\/s \(Standby\)/)).toBeInTheDocument();
      expect(screen.getByText(/▲ 0 B\/s \(Standby\)/)).toBeInTheDocument();
      expect(screen.getAllByText("Standby").length).toBeGreaterThanOrEqual(1);
      unmount3();

      // 4. Unavailable: Displays '— (Unavailable)'
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "unavailable",
      });

      const { unmount: unmount4 } = render(<DashboardTestWrapper />);
      expect(screen.getByText(/▼ — \(Unavailable\)/)).toBeInTheDocument();
      expect(screen.getByText(/▲ — \(Unavailable\)/)).toBeInTheDocument();
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      unmount4();
    });

    it("Invariant 16: KPI card tooltips render synchronized, truthful metrics with distinct labels without mislabeling total volume as average", () => {
      setMonitor({
        by_protocol: {
          dimension: "protocol",
          rows: [{ label: "HTTPS", bytes: 7300000, flows: 10, hostnames: [], evidence: [] }],
        },
        by_host: {
          dimension: "host",
          rows: [{ label: "1.1.1.1", bytes: 7300000, flows: 10, hostnames: [], evidence: [] }],
        },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "active",
        throughput_history: [
          {
            timestamp_mono_nanos: 1_000_000,
            ingress_rate_bytes_sec: 0,
            egress_rate_bytes_sec: 4096,
          },
        ],
      });

      render(<DashboardTestWrapper />);

      // Activity card rates
      expect(screen.getByText(/▼ 0 B\/s/)).toBeInTheDocument();
      expect(screen.getByText(/▲ 4 KB\/s/)).toBeInTheDocument();

      // Tooltip rows
      const tooltip = document.getElementById("kpi-tooltip-activity");
      expect(tooltip).toBeInTheDocument();
      expect(within(tooltip!).getByText("Inbound:")).toBeInTheDocument();
      expect(within(tooltip!).getByText("0 B/s")).toBeInTheDocument();
      expect(within(tooltip!).getByText("Outbound:")).toBeInTheDocument();
      expect(within(tooltip!).getAllByText("4 KB/s").length).toBeGreaterThanOrEqual(1);
      expect(within(tooltip!).getByText("Total Volume:")).toBeInTheDocument();
      expect(within(tooltip!).getByText("7.0 MB")).toBeInTheDocument();

      // Verify that "Avg: X total" is NOT in the tooltip
      expect(tooltip!.textContent).not.toMatch(/Avg:.*total/i);
    });
  });
});

