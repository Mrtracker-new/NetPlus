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
        source: "live",
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    expect(await screen.findByText("Ping Results for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("15ms")).toBeInTheDocument(); // Avg RTT
    expect(screen.getByText("6ms")).toBeInTheDocument(); // Jitter = 18 - 12
    expect(screen.getByText("live")).toBeInTheDocument(); // Provenance
  });

  it("runs Traceroute probe and renders hop breakdown table", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "tracerouteResult",
      hops: [
        { ttl: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 2, source: "live" },
        { ttl: 2, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14, source: "live" },
      ],
    } as any);

    render(<DiagnosticsTestWrapper />);

    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);

    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
    expect(screen.getAllByText("gateway.local")[0]).toBeInTheDocument();
  });

  it("runs Bufferbloat probe and renders grade badge and scorecard", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "bufferbloatResult",
      result: {
        grade: "A+",
        idleRttMs: 12,
        loadedRttMs: 18,
        deltaRttMs: 6,
        source: "live",
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

  it("triggers Ping probe when Enter key is pressed in target input", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "pingResult",
      result: {
        target: "8.8.8.8",
        sent: 4,
        received: 4,
        lossPct: 0,
        minRttMs: 10,
        avgRttMs: 12,
        maxRttMs: 14,
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Ping Results for 8.8.8.8")).toBeInTheDocument();
  });

  it("updates target input when quick target preset is clicked and verifies aria-pressed", () => {
    render(<DiagnosticsTestWrapper />);

    const googlePresetBtn = screen.getAllByRole("button", { name: /8\.8\.8\.8/i })[0]!;
    expect(googlePresetBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(googlePresetBtn);

    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)") as HTMLInputElement;
    expect(input.value).toBe("8.8.8.8");
    expect(googlePresetBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders Traceroute timeout hop nodes in vertical timeline", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "tracerouteResult",
      hops: [
        { ttl: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 2, source: "live" },
        { ttl: 2, ip: "*", hostname: null, rttMs: 0, status: "timeout" },
      ],
    } as any);

    render(<DiagnosticsTestWrapper />);

    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);

    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.getAllByText("timeout")[0]).toBeInTheDocument();
  });

  it("capability cards in empty state trigger contextual probe execution", async () => {
    const querySpy = vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "pingResult",
      result: {
        target: "1.1.1.1",
        sent: 4,
        received: 4,
        lossPct: 0,
        minRttMs: 8,
        avgRttMs: 10,
        maxRttMs: 12,
        source: "live",
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const capabilityRunPingBtn = screen.getByRole("button", { name: "Run Ping" });
    expect(capabilityRunPingBtn).toBeInTheDocument();

    fireEvent.click(capabilityRunPingBtn);

    expect(querySpy).toHaveBeenCalledWith(expect.objectContaining({ kind: "runPing", target: "1.1.1.1" }));
    expect(await screen.findByText("Ping Results for 1.1.1.1")).toBeInTheDocument();
  });

  it("verifies absence of full-container aria-live on the results tree", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "pingResult",
      result: {
        target: "1.1.1.1",
        sent: 4,
        received: 4,
        lossPct: 0,
        minRttMs: 10,
        avgRttMs: 12,
        maxRttMs: 14,
      },
    } as any);

    const { container } = render(<DiagnosticsTestWrapper />);

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    await screen.findByText("Ping Results for 1.1.1.1");

    // The results flow container must NOT have aria-live (isolated announcement region only)
    const resultsFlow = container.querySelector(".np-diagnostics-results-flow");
    expect(resultsFlow).not.toHaveAttribute("aria-live");

    const srOnlyLive = container.querySelector(".np-sr-only");
    expect(srOnlyLive).toHaveAttribute("aria-live", "polite");
  });

  it("verifies displayed confidence, severity, diagnosis category, grade, provenance, delta, and recommendations directly reflect domain data", async () => {
    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      if (req.kind === "runBufferbloatTest") {
        return {
          kind: "bufferbloatResult",
          result: {
            target: "1.1.1.1",
            grade: "B",
            idleRttMs: 15.2,
            loadedRttMs: 45.8,
            deltaRttMs: 30.6,
            source: "simulated",
          },
        };
      }
      return { kind: "pingResult", result: {} };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const bloatBtn = screen.getByRole("button", { name: "Bufferbloat Test" });
    fireEvent.click(bloatBtn);

    expect(await screen.findByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument(); // Domain grade
    expect(screen.getByText("Delta: +30.6ms")).toBeInTheDocument(); // Domain delta
    expect(screen.getByText("simulated")).toBeInTheDocument(); // Domain provenance
  });

  it("runs Full Analysis deep diagnostics and renders multi-stage assessment findings and stages", async () => {
    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      switch (req.kind) {
        case "discoverGateway":
          return { kind: "gatewayResult", result: { gatewayIp: "192.168.1.1", interfaceName: "eth0" } };
        case "runDnsProbe":
          return { kind: "dnsResult", result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], rttMs: 12 } };
        case "runPing":
          return { kind: "pingResult", result: { target: "1.1.1.1", sent: 4, received: 4, lossPct: 0, minRttMs: 10, avgRttMs: 14, maxRttMs: 18 } };
        case "runTraceroute":
          return { kind: "tracerouteResult", hops: [{ ttl: 1, ip: "192.168.1.1", rttMs: 2 }, { ttl: 2, ip: "1.1.1.1", rttMs: 14 }] };
        case "runBufferbloatTest":
          return { kind: "bufferbloatResult", result: { grade: "A", idleRttMs: 10, loadedRttMs: 15, deltaRttMs: 5 } };
        case "runHttpProbe":
          return { kind: "httpResult", result: { url: "http://1.1.1.1", statusCode: 200, ttfbMs: 45, connectMs: 15 } };
        default:
          return { kind: "success" };
      }
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const fullAnalysisBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(fullAnalysisBtn);

    expect(await screen.findByText("Diagnostic Assessment & Findings")).toBeInTheDocument();
    expect(screen.getByText("Default Gateway")).toBeInTheDocument();
    expect(screen.getByText("DNS Resolution")).toBeInTheDocument();
    expect(screen.getByText("HTTP Web Probe")).toBeInTheDocument();
    expect(screen.getByText("Round-Trip Latency")).toBeInTheDocument();
  });

  it("handles IPv6 targets and preserves them without port stripping corruption", async () => {
    let capturedTarget = "";
    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      if (req.kind === "runPing") {
        capturedTarget = req.target;
        return {
          kind: "pingResult",
          result: { target: req.target, sent: 4, received: 4, lossPct: 0, minRttMs: 10, avgRttMs: 12, maxRttMs: 14 },
        };
      }
      return { kind: "success" };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(input, { target: { value: "2001:4860:4860::8888" } });

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    expect(await screen.findByText("Ping Results for 2001:4860:4860::8888")).toBeInTheDocument();
    expect(capturedTarget).toBe("2001:4860:4860::8888");
  });
});
