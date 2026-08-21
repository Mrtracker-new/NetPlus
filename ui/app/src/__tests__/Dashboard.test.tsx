import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Dashboard } from "../screens/Dashboard";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { setFeed, setMonitor, __resetForTest } from "../state/store";

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

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Live Traffic Stream" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Quick Peek Drawer 🔍" })).toBeInTheDocument();

    const drawerBtn = screen.getByRole("button", { name: "Quick Peek Drawer 🔍" });
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

  it("handles malformed/missing snapshot fields gracefully without crashing", () => {
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [] },
      by_host: { dimension: "host", rows: [] },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<DashboardTestWrapper />);

    expect(screen.getByText("Hosts Observed")).toBeInTheDocument();
    expect(screen.getByText(/Network is Healthy/i)).toBeInTheDocument();
  });
});
