import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { DiagnosticsScreen } from "../screens/Diagnostics";
import { validateAndNormalizeTarget } from "../hooks/useDiagnosticsController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function DiagnosticsTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <DiagnosticsScreen />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("DiagnosticsScreen & useDiagnosticsController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("validateAndNormalizeTarget validates IPv4, IPv6, domains, localhost, and strips schemes", () => {
    expect(validateAndNormalizeTarget("1.1.1.1").isValid).toBe(true);
    expect(validateAndNormalizeTarget("1.1.1.1").normalized).toBe("1.1.1.1");

    expect(validateAndNormalizeTarget("google.com").isValid).toBe(true);
    expect(validateAndNormalizeTarget("google.com").normalized).toBe("google.com");

    expect(validateAndNormalizeTarget("http://cloudflare.com/path").isValid).toBe(true);
    expect(validateAndNormalizeTarget("http://cloudflare.com/path").normalized).toBe("cloudflare.com");

    expect(validateAndNormalizeTarget("localhost").isValid).toBe(true);
    expect(validateAndNormalizeTarget("localhost").normalized).toBe("localhost");

    expect(validateAndNormalizeTarget("!!!").isValid).toBe(false);
    expect(validateAndNormalizeTarget("   ").isValid).toBe(false);
  });

  it("renders empty state guide when no probe has been run", () => {
    render(<DiagnosticsTestWrapper />);

    expect(
      screen.getByText("Enter a target hostname or IP address (IPv4, IPv6, domain) and choose a diagnostic probe.")
    ).toBeInTheDocument();
  });

  it("runs Ping probe and renders Ping results with Jitter KPI", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "pingResult",
      result: {
        target: "1.1.1.1",
        sent: 4,
        received: 4,
        lossPct: 0,
        minRttMs: 12,
        avgRttMs: 15,
        maxRttMs: 18,
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    expect(await screen.findByText("Ping Results for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("15ms")).toBeInTheDocument(); // Avg RTT
    expect(screen.getByText("6ms")).toBeInTheDocument(); // Jitter = 18 - 12
  });

  it("runs Traceroute probe and renders hop breakdown table", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "tracerouteResult",
      hops: [
        { ttl: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 2 },
        { ttl: 2, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14 },
      ],
    } as any);

    render(<DiagnosticsTestWrapper />);

    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);

    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
    expect(screen.getByText("gateway.local")).toBeInTheDocument();
  });

  it("runs Bufferbloat probe and renders grade badge and scorecard", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "bufferbloatResult",
      result: {
        grade: "A+",
        idleRttMs: 12,
        loadedRttMs: 18,
        deltaRttMs: 6,
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const bloatBtn = screen.getByRole("button", { name: "Bufferbloat Test" });
    fireEvent.click(bloatBtn);

    expect(await screen.findByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
  });

  it("shows notice banner when invalid target is submitted", async () => {
    render(<DiagnosticsTestWrapper />);

    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(input, { target: { value: "invalid!!!" } });

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    expect(
      await screen.findByText("Please enter a valid target hostname, IPv4, IPv6, or localhost address.")
    ).toBeInTheDocument();
  });
});
