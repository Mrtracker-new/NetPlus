import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Dashboard } from "../screens/Dashboard";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { setFeed, setMonitor, setError, resetSession, __resetForTest } from "../state/store";
import { preferencesManager } from "../screens/Monitoring/MonitoringPreferences";
import * as ipc from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

function DashboardWithNavWatcher({
  loading = false,
  error = null,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  function NavWatcher() {
    const { screen: currentScreen, navigationTarget } = useEvidenceNavigation();
    return (
      <div data-testid="nav-debug">
        <span data-testid="nav-screen">{currentScreen}</span>
        <span data-testid="nav-target">{JSON.stringify(navigationTarget)}</span>
      </div>
    );
  }

  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <NavWatcher />
        <Dashboard loading={loading} error={error} onRetry={onRetry} />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Dashboard Screen", () => {
  beforeEach(() => {
    __resetForTest();
    preferencesManager.reset();
  });

  it("renders zero state KPIs when monitor snapshot is empty", () => {
    setMonitor({
      by_protocol: {
        dimension: "protocol",
        rows: [],
      },
      by_host: {
        dimension: "host",
        rows: [],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<DashboardTestWrapper />);

    expect(screen.getByText("Hosts Observed")).toBeInTheDocument();
    expect(screen.getByText("Active Flows")).toBeInTheDocument();
    expect(screen.getByText("Network Activity")).toBeInTheDocument();
    expect(screen.getByText("Narrative Cards")).toBeInTheDocument();

    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it("renders skeleton loading states across KPIs and visualizer when monitor is null and no error exists", () => {
    render(<DashboardTestWrapper />);

    expect(screen.getByRole("region", { name: "Loading statistics" })).toBeInTheDocument();
    expect(screen.queryByText("Hosts Observed")).not.toBeInTheDocument();
  });

  it("transitions from skeleton loading to populated state once monitor snapshot arrives", async () => {
    render(<DashboardTestWrapper />);

    expect(screen.getByRole("region", { name: "Loading statistics" })).toBeInTheDocument();
    expect(screen.queryByText("Hosts Observed")).not.toBeInTheDocument();

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

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Loading statistics" })).not.toBeInTheDocument();
      expect(screen.getByText("Hosts Observed")).toBeInTheDocument();
    });
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

  it("handleRetry passes active time range preference and shows busy spinner while querying", async () => {
    preferencesManager.setTimeRange("1h");

    let resolveFeed!: (value: any) => void;
    let resolveMonitor!: (value: any) => void;
    const feedPromise = new Promise((resolve) => {
      resolveFeed = resolve;
    });
    const monitorPromise = new Promise((resolve) => {
      resolveMonitor = resolve;
    });

    const querySpy = vi.spyOn(ipc, "query").mockImplementation(async (q): Promise<any> => {
      if (q.kind === "narrativeFeed") return feedPromise;
      if (q.kind === "monitorSnapshot") return monitorPromise;
      return null;
    });

    setError("Unable to communicate with the NetPulse engine daemon.");
    render(<DashboardTestWrapper />);

    const retryBtn = screen.getByRole("button", { name: "Retry Connection" });
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toHaveAttribute("aria-busy");
    expect(retryBtn).not.toBeDisabled();

    // Trigger retry
    fireEvent.click(retryBtn);

    // Verify busy state while queries are in-flight
    expect(retryBtn).toHaveAttribute("aria-busy", "true");
    expect(retryBtn).toBeDisabled();
    expect(within(retryBtn).getByRole("status")).toBeInTheDocument();
    expect(within(retryBtn).getByText("Loading…")).toBeInTheDocument();

    // Verify active time range "1h" was mapped to "one_hour" and passed to monitorSnapshot query
    expect(querySpy).toHaveBeenCalledWith({
      kind: "monitorSnapshot",
      time_range: "one_hour",
    });
    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "narrativeFeed",
    }));

    // Resolve queries
    await act(async () => {
      resolveFeed({ kind: "narrativeFeed", cards: [] });
      resolveMonitor({
        kind: "monitorSnapshot",
        snapshot: {
          by_protocol: { dimension: "protocol", rows: [] },
          by_host: { dimension: "host", rows: [] },
          diagnoses: [],
          network_loss_indicators: 0,
          capture_drops: 0,
        },
      });
    });

    // Verify error banner is dismissed after successful recovery
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Retry Connection/i })).not.toBeInTheDocument();
    });
  });

  it("handleRetry passes updated time range preferences (e.g. 24h, 15m)", async () => {
    preferencesManager.setTimeRange("24h");

    const querySpy = vi.spyOn(ipc, "query").mockImplementation(async (q): Promise<any> => {
      if (q.kind === "narrativeFeed") return { kind: "narrativeFeed", cards: [] };
      if (q.kind === "monitorSnapshot") {
        return {
          kind: "monitorSnapshot",
          snapshot: {
            by_protocol: { dimension: "protocol", rows: [] },
            by_host: { dimension: "host", rows: [] },
            diagnoses: [],
            network_loss_indicators: 0,
            capture_drops: 0,
          },
        };
      }
      return null;
    });

    setError("Unable to communicate with the NetPulse engine daemon.");
    render(<DashboardTestWrapper />);

    const retryBtn = screen.getByRole("button", { name: "Retry Connection" });
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(querySpy).toHaveBeenCalledWith({
      kind: "monitorSnapshot",
      time_range: "twenty_four_hours",
    });
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

  it("does not falsely classify card with IP containing 53 as DNS", () => {
    setFeed([
      {
        headline: "Connected to 192.168.1.53",
        summary: "Transferred 45 KB over port 8080",
        lines: ["Local port 52341"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 153 }],
        at_mono_nanos: 1000,
      },
    ]);

    render(<DashboardTestWrapper />);

    // Initially visible under All Activity
    expect(screen.getByText("Connected to 192.168.1.53")).toBeInTheDocument();

    // Switch to DNS Queries category tab
    const dnsTab = screen.getByRole("tab", { name: "DNS Queries" });
    fireEvent.click(dnsTab);

    // Card MUST NOT be falsely classified as DNS
    expect(screen.queryByText("Connected to 192.168.1.53")).not.toBeInTheDocument();

    // Switch to Network Flows category tab
    const networkTab = screen.getByRole("tab", { name: "Network Flows" });
    fireEvent.click(networkTab);

    // Card should appear under Network Flows
    expect(screen.getByText("Connected to 192.168.1.53")).toBeInTheDocument();

    // Open explain box and drawer to check protocol label
    const explainBtn = screen.getByRole("button", { name: "Explain Connected to 192.168.1.53" });
    fireEvent.click(explainBtn);

    const drawerBtn = screen.getByRole("button", { name: /Quick Peek Drawer/i });
    fireEvent.click(drawerBtn);

    // Protocol label MUST be TCP Stream, NOT DNS (Port 53)
    expect(screen.getByText("TCP Stream")).toBeInTheDocument();
    expect(screen.queryByText("DNS (Port 53)")).not.toBeInTheDocument();
  });

  it("authoritative category and protocol tags override substring ambiguity", () => {
    setFeed([
      {
        headline: "Application app.exe resolved internal host 10.0.0.53",
        summary: "DNS query succeeded",
        lines: ["Latency 8ms"],
        severity: "neutral",
        category: "dns",
        protocol: "DNS",
        evidence: [{ kind: "flow", id: 53 }],
        at_mono_nanos: 2000,
      },
      {
        headline: "Application updater downloaded payload from 10.0.0.80",
        summary: "TLS connection to secure host",
        lines: ["Encrypted 2 MB"],
        severity: "neutral",
        category: "tls",
        protocol: "TLS",
        evidence: [{ kind: "flow", id: 80 }],
        at_mono_nanos: 3000,
      },
    ]);

    render(<DashboardTestWrapper />);

    // Click DNS Queries tab
    const dnsTab = screen.getByRole("tab", { name: "DNS Queries" });
    fireEvent.click(dnsTab);
    expect(screen.getByText("Application app.exe resolved internal host 10.0.0.53")).toBeInTheDocument();
    expect(screen.queryByText("Application updater downloaded payload from 10.0.0.80")).not.toBeInTheDocument();

    // Click TLS & HTTPS tab
    const tlsTab = screen.getByRole("tab", { name: "TLS & HTTPS" });
    fireEvent.click(tlsTab);
    expect(screen.queryByText("Application app.exe resolved internal host 10.0.0.53")).not.toBeInTheDocument();
    expect(screen.getByText("Application updater downloaded payload from 10.0.0.80")).toBeInTheDocument();
  });

  it("does not falsely classify unencrypted or cleartext cards as TLS", () => {
    setFeed([
      {
        headline: "Cleartext HTTP stream to dev-server",
        summary: "Not encrypted · 120 KB",
        lines: ["Not encrypted", "Port 8000"],
        severity: "neutral",
        evidence: [{ kind: "flow", id: 1080 }],
        at_mono_nanos: 1500,
      },
      {
        headline: "Secure connection to api.service.com",
        summary: "Encrypted · 45 KB",
        lines: ["Encrypted"],
        severity: "neutral",
        category: "tls",
        protocol: "TLS",
        evidence: [{ kind: "flow", id: 1081 }],
        at_mono_nanos: 1600,
      },
    ]);

    render(<DashboardTestWrapper />);

    // Switch to TLS & HTTPS tab
    const tlsTab = screen.getByRole("tab", { name: "TLS & HTTPS" });
    fireEvent.click(tlsTab);

    // Secure connection MUST be visible
    expect(screen.getByText("Secure connection to api.service.com")).toBeInTheDocument();

    // Cleartext stream with 'Not encrypted' MUST NOT be classified as TLS
    expect(screen.queryByText("Cleartext HTTP stream to dev-server")).not.toBeInTheDocument();
  });

  it("renders custom protocol label in technical drawer without defaulting to TCP Stream", () => {
    setFeed([
      {
        headline: "Remote administrative session",
        summary: "Secure shell terminal access",
        lines: ["Authenticated"],
        severity: "neutral",
        protocol: "SSH",
        evidence: [{ kind: "flow", id: 222 }],
        at_mono_nanos: 4000,
      },
    ]);

    render(<DashboardTestWrapper />);

    const explainBtn = screen.getByRole("button", { name: "Explain Remote administrative session" });
    fireEvent.click(explainBtn);

    const drawerBtn = screen.getByRole("button", { name: /Quick Peek Drawer/i });
    fireEvent.click(drawerBtn);

    // Protocol context MUST show SSH, NOT TCP Stream
    expect(screen.getByText("SSH")).toBeInTheDocument();
    expect(screen.queryByText("TCP Stream")).not.toBeInTheDocument();
  });

  it("matches search query against card category and protocol tags", () => {
    setFeed([
      {
        headline: "Telemetry feed card without keywords in title",
        summary: "Transferred 10 KB",
        lines: ["Normal throughput"],
        severity: "neutral",
        category: "tls",
        protocol: "QUIC",
        evidence: [{ kind: "flow", id: 999 }],
        at_mono_nanos: 5000,
      },
    ]);

    render(<DashboardTestWrapper />);

    const searchInput = screen.getByLabelText("Search narrative feed");

    // Search by protocol 'QUIC' which is not in headline or summary
    fireEvent.change(searchInput, { target: { value: "quic" } });
    expect(screen.getByText("Telemetry feed card without keywords in title")).toBeInTheDocument();

    // Search by category 'tls' which is not in headline or summary
    fireEvent.change(searchInput, { target: { value: "tls" } });
    expect(screen.getByText("Telemetry feed card without keywords in title")).toBeInTheDocument();

    // Search by non-matching query
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    expect(screen.queryByText("Telemetry feed card without keywords in title")).not.toBeInTheDocument();
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

  it("handles recommendation click for notable event transitioning category to performance and preserving card visibility", () => {
    setFeed([
      {
        headline: "High latency RTT spike on WAN link",
        summary: "Average latency 320 ms observed to remote server",
        lines: ["Round trip delay 320 ms", "Packet loss detected"],
        severity: "notable",
        evidence: [{ kind: "flow", id: 88 }],
        at_mono_nanos: 1000,
      },
      {
        headline: "Normal HTTPS connection",
        summary: "Browsing netpulse.dev",
        lines: ["TLS 1.3"],
        severity: "neutral",
        evidence: [{ kind: "session", id: 200 }],
        at_mono_nanos: 2000,
      },
    ]);

    render(<DashboardTestWrapper />);

    // Switch to Security Findings category first to simulate notable card being filtered out
    const findingsTab = screen.getByRole("tab", { name: "Security Findings" });
    fireEvent.click(findingsTab);
    expect(screen.queryByText("High latency RTT spike on WAN link")).not.toBeInTheDocument();

    const recButton = screen.getByRole("button", { name: /Action: Monitor High latency RTT spike on WAN link/i });
    expect(recButton).toBeInTheDocument();

    fireEvent.click(recButton);

    // Target notable card must now be visible (not hidden by category conflict)
    expect(screen.getByText("High latency RTT spike on WAN link")).toBeInTheDocument();

    // Category transitions to Performance & Latency (or All Activity)
    const perfTab = screen.getByRole("tab", { name: "Performance & Latency" });
    expect(perfTab).toHaveAttribute("aria-selected", "true");
  });

  it("handles investigate recommendation when target card has notable severity without incorrectly filtering it out", () => {
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
      by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
      network_loss_indicators: 0,
      capture_drops: 0,
      diagnoses: [
        {
          cause: "distant_server",
          confidence_percent: 88,
          severity: "finding",
          explanation: "High RTT latency observed on distant hop",
          evidence: [{ kind: "flow", id: 77 }],
        },
      ],
    });
    setFeed([
      {
        headline: "High RTT latency to server",
        summary: "Round trip delay 250 ms observed",
        lines: ["delay 250 ms", "latency spike"],
        severity: "notable",
        evidence: [{ kind: "flow", id: 77 }],
        at_mono_nanos: 1000,
      },
    ]);

    render(<DashboardTestWrapper />);

    // Recommendation comes from primary diagnosis (investigate), but evidence belongs to a notable card
    const recButton = screen.getByRole("button", { name: /Recommendation: Investigate Distant Server hypothesis/i });
    expect(recButton).toBeInTheDocument();

    fireEvent.click(recButton);

    // Card must remain visible because controller does not force "findings" category on a non-finding card
    expect(screen.getByText("High RTT latency to server")).toBeInTheDocument();
    const findingsTab = screen.getByRole("tab", { name: "Security Findings" });
    expect(findingsTab).toHaveAttribute("aria-selected", "false");
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
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] }] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
      });

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
      const chain = screen.getByRole("navigation", { name: "7-Stage Diagnostic Telemetry Chain" });
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
      expect(screen.getByRole("button", { name: "View in Apps / Timeline →" })).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "View in Apps / Timeline →" })).toBeInTheDocument();
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

    it("Invariant 14b: CardExplainBox inline drawers render unique IDs and matching aria-controls on multi-card expansion", () => {
      setFeed([
        {
          at_mono_nanos: 10_000_000,
          severity: "finding",
          headline: "Cleartext Protocol Detected",
          summary: "Unencrypted traffic observed on port 80.",
          lines: ["Observed GET request without TLS"],
          evidence: [{ kind: "flow", id: 42 }],
        },
        {
          at_mono_nanos: 20_000_000,
          severity: "notable",
          headline: "DNS Latency Spike",
          summary: "DNS queries exceeding latency threshold.",
          lines: ["Observed slow response from resolver"],
          evidence: [{ kind: "flow", id: 43 }],
        },
      ]);

      render(<DashboardTestWrapper />);

      // Open Explain box on both cards
      const explainBtn1 = screen.getByRole("button", { name: /Explain Cleartext Protocol Detected/i });
      fireEvent.click(explainBtn1);
      const explainBtn2 = screen.getByRole("button", { name: /Explain DNS Latency Spike/i });
      fireEvent.click(explainBtn2);

      // Open Quick Peek drawer on both cards
      const quickPeekBtns = screen.getAllByRole("button", { name: /Quick Peek Drawer/i });
      expect(quickPeekBtns).toHaveLength(2);
      fireEvent.click(quickPeekBtns[0]!);
      fireEvent.click(quickPeekBtns[1]!);

      // Verify both drawers are open simultaneously
      const drawers = screen.getAllByRole("region", { name: "Quick Peek Technical Evidence" });
      expect(drawers).toHaveLength(2);

      // Verify each drawer has a unique ID matching card-inline-drawer-${card.at_mono_nanos}
      expect(drawers[0]!.id).toBe("card-inline-drawer-10000000");
      expect(drawers[1]!.id).toBe("card-inline-drawer-20000000");
      expect(drawers[0]!.id).not.toBe(drawers[1]!.id);

      // Verify the toggle buttons have matching aria-controls pointing to the unique drawer IDs
      const hideBtns = screen.getAllByRole("button", { name: /Hide Quick Peek Drawer/i });
      expect(hideBtns).toHaveLength(2);
      expect(hideBtns[0]!).toHaveAttribute("aria-controls", "card-inline-drawer-10000000");
      expect(hideBtns[1]!).toHaveAttribute("aria-controls", "card-inline-drawer-20000000");
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

    it("Invariant 17: When telemetry_state is standby, Hero card displays idle Standby and visualizer badge is quiet STANDBY without pulsing", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        telemetry_state: "standby",
        throughput_history: [],
      });

      render(<DashboardTestWrapper />);

      // Hero card assertions
      expect(screen.getByText("● Standby")).toBeInTheDocument();
      expect(screen.getByText("Passive Capture Standby")).toBeInTheDocument();
      expect(
        screen.getByText("Start packet capture in the header bar to observe network telemetry.")
      ).toBeInTheDocument();

      // Ensure false claim is not present
      expect(screen.queryByText("Network Operating Normally")).not.toBeInTheDocument();
      expect(screen.queryByText(/Passive telemetry active/i)).not.toBeInTheDocument();

      // Visualizer badge assertions
      const standbyBadge = screen.getByText("STANDBY");
      expect(standbyBadge).toBeInTheDocument();
      expect(screen.queryByText("LIVE TELEMETRY")).not.toBeInTheDocument();

      // Badge must be quiet without pulsing dot
      expect(document.querySelector(".np-telemetry-badge--standby")).toBeInTheDocument();
      expect(document.querySelector(".np-pulse-dot")).not.toBeInTheDocument();
    });

    it("Invariant 18: When telemetry_state is active, Hero card displays normal telemetry and visualizer badge displays pulsing LIVE TELEMETRY", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [{ label: "HTTPS", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
        by_host: { dimension: "host", rows: [{ label: "1.1.1.1", bytes: 1024, flows: 1, hostnames: [], evidence: [] }] },
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

      render(<DashboardTestWrapper />);

      // Hero card assertions
      expect(screen.getByText("● Nominal")).toBeInTheDocument();
      expect(screen.getByText("Network Operating Normally")).toBeInTheDocument();
      expect(screen.getByText(/1 host and 1 active flow observed across passive capture/i)).toBeInTheDocument();

      // Visualizer badge assertions
      expect(screen.getByText("LIVE TELEMETRY")).toBeInTheDocument();
      expect(document.querySelector(".np-pulse-dot")).toBeInTheDocument();
      expect(document.querySelector(".np-telemetry-badge--active")).toBeInTheDocument();
    });

    it("Invariant 19: When evidence card is outside visible feed window, fallback action button 'View in Apps / Timeline →' routes to target screen", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [
          {
            cause: "local_wifi",
            severity: "finding",
            confidence_percent: 85,
            explanation: "Frame drops on channel 6",
            evidence: [{ kind: "flow", id: 777 }],
          },
        ],
        network_loss_indicators: 0,
        capture_drops: 0,
      });
      setFeed([]);

      render(<DashboardWithNavWatcher />);

      expect(screen.getByTestId("nav-screen")).toHaveTextContent("dashboard");

      // 1. Trigger evidence navigation for flow 777 not in feed
      const recBtn = screen.getByRole("button", { name: /Investigate Local Wi-Fi \/ Link hypothesis/i });
      fireEvent.click(recBtn);

      // Notice with message and action button appears
      expect(screen.getByText(/Evidence flow #777 is outside the active visible feed window/i)).toBeInTheDocument();
      const viewBtn = screen.getByRole("button", { name: "View in Apps / Timeline →" });
      expect(viewBtn).toBeInTheDocument();

      // 2. Click fallback action button
      fireEvent.click(viewBtn);

      // Navigates to Apps screen with flowId 777
      expect(screen.getByTestId("nav-screen")).toHaveTextContent("apps");
      expect(screen.getByTestId("nav-target")).toHaveTextContent(JSON.stringify({ screen: "apps", flowId: 777 }));

      // Ephemeral notice is dismissed upon navigation
      expect(screen.queryByText(/Evidence flow #777 is outside the active visible feed window/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View in Apps / Timeline →" })).not.toBeInTheDocument();
    });

    it("Invariant 20: When evidence is a packet outside feed, fallback action routes to Timeline screen", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        diagnostic_chain: {
          stages: [
            {
              stage: "destination",
              label: "Destination Server",
              status: "degraded",
              measurement_state: "inferred",
              detection_state: "detected",
              causes: ["distant_server"],
              affected_targets: [],
              latency_ms: 120,
              summary: "TCP RST received",
              detail: "Packet reset sequence",
              evidence: [{ kind: "packet", id: 888 }],
            },
          ],
        },
      });
      setFeed([]);

      render(<DashboardWithNavWatcher />);

      expect(screen.getByTestId("nav-screen")).toHaveTextContent("dashboard");

      // Open diagnostic stage drawer
      const destNode = screen.getByRole("button", { name: /Destination Server — Status: Degraded/i });
      fireEvent.click(destNode);

      const inspectEvidenceBtn = screen.getByRole("button", { name: /Inspect Stage Evidence \(packet #888\) →/i });
      fireEvent.click(inspectEvidenceBtn);

      expect(screen.getByText(/Evidence packet #888 is outside the active visible feed window/i)).toBeInTheDocument();
      const viewBtn = screen.getByRole("button", { name: "View in Apps / Timeline →" });
      expect(viewBtn).toBeInTheDocument();

      // Click fallback action button
      fireEvent.click(viewBtn);

      // Navigates to Timeline screen with packetId 888
      expect(screen.getByTestId("nav-screen")).toHaveTextContent("timeline");
      expect(screen.getByTestId("nav-target")).toHaveTextContent(JSON.stringify({ screen: "timeline", packetId: 888 }));
    });

    it("Invariant 21: Dismissing the evidence notice clears it without navigating or altering screen state", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [
          {
            cause: "local_wifi",
            severity: "finding",
            confidence_percent: 75,
            explanation: "High noise floor",
            evidence: [{ kind: "flow", id: 505 }],
          },
        ],
        network_loss_indicators: 0,
        capture_drops: 0,
      });
      setFeed([]);

      render(<DashboardWithNavWatcher />);

      const recBtn = screen.getByRole("button", { name: /Investigate Local Wi-Fi \/ Link hypothesis/i });
      fireEvent.click(recBtn);

      expect(screen.getByText(/Evidence flow #505 is outside the active visible feed window/i)).toBeInTheDocument();
      const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
      expect(dismissBtn).toBeInTheDocument();

      fireEvent.click(dismissBtn);

      expect(screen.queryByText(/Evidence flow #505 is outside the active visible feed window/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View in Apps / Timeline →" })).not.toBeInTheDocument();
      expect(screen.getByTestId("nav-screen")).toHaveTextContent("dashboard");
      expect(screen.getByTestId("nav-target")).toHaveTextContent("null");
    });

    it("Invariant 22: When evidence is a session outside feed, fallback action routes to Journey screen", () => {
      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        diagnostic_chain: {
          stages: [
            {
              stage: "router",
              label: "Local Gateway",
              status: "degraded",
              measurement_state: "inferred",
              detection_state: "detected",
              causes: ["congestion"],
              affected_targets: [],
              latency_ms: 85,
              summary: "Bufferbloat under burst",
              detail: "Session buffer saturation",
              evidence: [{ kind: "session", id: 333 }],
            },
          ],
        },
      });
      setFeed([]);

      render(<DashboardWithNavWatcher />);

      const routerNode = screen.getByRole("button", { name: /Local Gateway — Status: Degraded/i });
      fireEvent.click(routerNode);

      const inspectEvidenceBtn = screen.getByRole("button", { name: /Inspect Stage Evidence \(session #333\) →/i });
      fireEvent.click(inspectEvidenceBtn);

      expect(screen.getByText(/Evidence session #333 is outside the active visible feed window/i)).toBeInTheDocument();
      const viewBtn = screen.getByRole("button", { name: "View in Apps / Timeline →" });
      expect(viewBtn).toBeInTheDocument();

      fireEvent.click(viewBtn);

      expect(screen.getByTestId("nav-screen")).toHaveTextContent("journey");
      expect(screen.getByTestId("nav-target")).toHaveTextContent(JSON.stringify({ screen: "journey", sessionId: 333 }));
    });

    it("displays measurement_state, affected_targets, and executes stage probe from Dashboard", async () => {
      const ipc = await import("../ipc");
      const querySpy = vi.spyOn(ipc, "query").mockResolvedValueOnce({
        kind: "stageProbeResult",
        result: {
          stage: "router",
          probe_type: "GatewayProbe",
          target: "192.168.1.1",
          status: "degraded",
          latency_ms: 24.5,
          summary: "Default gateway reachable with jitter (24.5ms RTT)",
          details: ["Gateway ping jitter observed", "Packet loss: 0%"],
        },
      } as any);

      setMonitor({
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        diagnostic_chain: {
          stages: [
            {
              stage: "router",
              label: "Local Gateway",
              status: "degraded",
              measurement_state: "inferred",
              detection_state: "detected",
              causes: ["congestion"],
              affected_targets: ["192.168.1.1"],
              latency_ms: 24.5,
              summary: "Bufferbloat under burst",
              detail: "Session buffer saturation",
              evidence: [],
            },
          ],
        },
      });

      render(<DashboardTestWrapper />);

      // Click on degraded stage node
      const routerNode = screen.getByRole("button", { name: /Local Gateway — Status: Degraded/i });
      fireEvent.click(routerNode);

      // Verify measurement_state badge and affected_targets
      expect(screen.getByTestId("stage-measurement-badge")).toHaveTextContent("Inferred");
      expect(screen.getByTestId("stage-affected-targets")).toHaveTextContent("192.168.1.1");

      // Click Run Stage Probe
      const probeBtn = screen.getByRole("button", { name: /Run Stage Probe/i });
      fireEvent.click(probeBtn);

      expect(querySpy).toHaveBeenCalledWith({
        kind: "runStageProbe",
        stage: "router",
        target: "192.168.1.1",
      });

      await waitFor(() => {
        expect(screen.getByTestId("stage-probe-result")).toBeInTheDocument();
        expect(screen.getByText(/GatewayProbe/i)).toBeInTheDocument();
        expect(screen.getByText(/24.5 ms/i)).toBeInTheDocument();
        expect(screen.getByText(/Default gateway reachable with jitter/i)).toBeInTheDocument();
      });
    });
  });
});


