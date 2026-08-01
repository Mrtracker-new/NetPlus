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
    expect(screen.getByText("Total Bytes Processed")).toBeInTheDocument();
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
});
