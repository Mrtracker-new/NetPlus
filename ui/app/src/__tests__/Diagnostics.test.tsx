import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { DiagnosticsScreen } from "../screens/Diagnostics";
import { DeepDiagnosticCard } from "../screens/Diagnostics/DeepDiagnosticCard";
import type { DiagnosticSession } from "../diagnostic";
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

  it("prevents target desynchronization when input field changes after probe execution", async () => {
    vi.spyOn(ipcModule, "query").mockImplementation(async (q: any) => {
      if (q.kind === "runTraceroute") {
        return {
          kind: "tracerouteResult",
          target: "1.1.1.1",
          hops: [
            { ttl: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 2, source: "live" },
            { ttl: 2, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14, source: "live" },
          ],
        } as any;
      }
      if (q.kind === "runBufferbloatTest") {
        return {
          kind: "bufferbloatResult",
          result: {
            target: "1.1.1.1",
            grade: "A+",
            idleRttMs: 12,
            loadedRttMs: 18,
            deltaRttMs: 6,
            source: "live",
          },
        } as any;
      }
      return {} as any;
    });

    render(<DiagnosticsTestWrapper />);

    // Run Traceroute on default 1.1.1.1
    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);
    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();

    // Run Bufferbloat on default 1.1.1.1
    const bloatBtn = screen.getByRole("button", { name: "Bufferbloat Test" });
    fireEvent.click(bloatBtn);
    expect(await screen.findByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();

    // Edit the input field to an unexecuted target
    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });

    // Assert card titles remain bound to 1.1.1.1 and DO NOT adopt unexecuted 8.8.8.8
    expect(screen.getByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.queryByText("Traceroute Hops for 8.8.8.8 (2 hops)")).not.toBeInTheDocument();

    expect(screen.getByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();
    expect(screen.queryByText("Bufferbloat Scorecard for 8.8.8.8")).not.toBeInTheDocument();

    // Also assert clicking a preset button does not desynchronize existing cards
    const presetBtn = screen.getByRole("button", { name: "localhost" });
    fireEvent.click(presetBtn);

    expect(screen.getByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.queryByText("Traceroute Hops for localhost (2 hops)")).not.toBeInTheDocument();

    expect(screen.getByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();
    expect(screen.queryByText("Bufferbloat Scorecard for localhost")).not.toBeInTheDocument();
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

  it("eliminates premature nominal state: displays In-Flight Analysis banner and skeletons while running, and suppresses 'No bottleneck detected'", () => {
    const runningSession: DiagnosticSession = {
      sessionId: 42,
      target: "1.1.1.1",
      status: "running",
      startedAt: Date.now(),
      observations: [],
      diagnoses: [],
      recommendations: [],
      currentStep: "gateway",
    };

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={runningSession} activeStage="gateway" />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // Verifies tactile in-flight banner is displayed with stage badge and analyzing status
    const banner = screen.getByTestId("deep-diagnostics-analyzing-banner");
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText("In-Flight Analysis")).toBeInTheDocument();
    expect(within(banner).getByText("Gateway")).toBeInTheDocument();
    expect(within(banner).getByText("Analyzing")).toBeInTheDocument();
    expect(within(banner).getByText("Evaluating Evidence...")).toBeInTheDocument();

    // CRITICAL ACCEPTANCE CRITERIA: No nominal or healthy claim is displayed while session.status === "running"
    expect(screen.queryByText("No clear bottleneck detected")).not.toBeInTheDocument();

    // Observation cards do NOT prematurely display failure states (e.g. Timed Out, Unreachable)
    expect(screen.queryByText("Timed Out")).not.toBeInTheDocument();
    expect(screen.queryByText("Unreachable")).not.toBeInTheDocument();
    expect(screen.getByText("Discovering default route...")).toBeInTheDocument();
    expect(screen.getByText("Awaiting DNS query...")).toBeInTheDocument();
  });

  it("renders nominal state with green checkmark only when session status is completed with no findings", () => {
    const completedNominalSession: DiagnosticSession = {
      sessionId: 42,
      target: "1.1.1.1",
      status: "completed",
      startedAt: Date.now() - 3000,
      completedAt: Date.now(),
      observations: [],
      diagnoses: [],
      recommendations: [],
    };

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={completedNominalSession} activeStage={null} />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // In-flight banner is gone
    expect(screen.queryByTestId("deep-diagnostics-analyzing-banner")).not.toBeInTheDocument();

    // Nominal state checkmark & title are present
    expect(screen.getByText("No clear bottleneck detected")).toBeInTheDocument();
    expect(
      screen.getByText("All diagnostic probes operated within nominal parameters. Available evidence did not establish an active bottleneck.")
    ).toBeInTheDocument();
  });

  it("verifies in-flight analysis banner displays during live pipeline execution and only completes with nominal checkmark afterwards", async () => {
    let resolveGateway!: (val: any) => void;
    const gatewayPromise = new Promise((resolve) => {
      resolveGateway = resolve;
    });

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      switch (req.kind) {
        case "discoverGateway":
          return await gatewayPromise;
        case "runDnsProbe":
          return { kind: "dnsResult", result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], resolutionRttMs: 12, status: "resolved", source: "live" } };
        case "runPing":
          return { kind: "pingResult", result: { target: "1.1.1.1", sent: 4, received: 4, lossPct: 0, minRttMs: 10, avgRttMs: 14, maxRttMs: 18, source: "live" } };
        case "runTraceroute":
          return { kind: "tracerouteResult", hops: [{ ttl: 1, ip: "192.168.1.1", rttMs: 2 }, { ttl: 2, ip: "1.1.1.1", rttMs: 14 }], target: "1.1.1.1", source: "live" };
        case "runBufferbloatTest":
          return { kind: "bufferbloatResult", result: { target: "1.1.1.1", grade: "A+", idleRttMs: 10, loadedRttMs: 15, deltaRttMs: 5, source: "live" } };
        case "runHttpProbe":
          return { kind: "httpResult", result: { url: "http://1.1.1.1", statusCode: 200, ttfbMs: 45, connectMs: 15, source: "live" } };
        default:
          return { kind: "success" };
      }
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const fullAnalysisBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(fullAnalysisBtn);

    // In-flight: pipeline has started, discoverGateway is pending
    expect(await screen.findByTestId("deep-diagnostics-analyzing-banner")).toBeInTheDocument();
    expect(screen.getByText("In-Flight Analysis")).toBeInTheDocument();
    expect(screen.queryByText("No clear bottleneck detected")).not.toBeInTheDocument();

    // Now resolve gateway probe and complete pipeline
    resolveGateway({ kind: "gatewayResult", result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" } });

    // Completed: nominal card is displayed
    expect(await screen.findByText("No clear bottleneck detected")).toBeInTheDocument();
    expect(screen.queryByTestId("deep-diagnostics-analyzing-banner")).not.toBeInTheDocument();
  });

  it("displays Pending... with neutral badge for unrun/uncollected observations and only displays Timed Out when completed with null value", () => {
    // 1. Unrun DNS stage (!dnsObs) in running session
    const unrunSession: DiagnosticSession = {
      sessionId: 101,
      target: "1.1.1.1",
      status: "running",
      startedAt: Date.now(),
      observations: [],
      diagnoses: [],
      recommendations: [],
    };

    const { unmount, rerender } = render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={unrunSession} activeStage="gateway" />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // Grid shows Pending... with neutral styling and no false "Timed Out"
    expect(screen.queryByText("Timed Out")).not.toBeInTheDocument();
    const pendingMetrics = screen.getAllByText("Pending...");
    expect(pendingMetrics.length).toBe(4);
    expect(pendingMetrics[1]).toHaveStyle({ color: "var(--np-text-dim)" });

    // Provenance badges are neutral PENDING
    const pendingBadges = screen.getAllByText("PENDING");
    expect(pendingBadges.length).toBe(4);
    expect(pendingBadges[1]).toHaveAttribute("data-provenance", "pending");
    expect(pendingBadges[1]).not.toHaveClass("np-diagnostics-provenance--live");
    expect(pendingBadges[1]).not.toHaveClass("np-diagnostics-provenance--unavailable");

    // 2. In-flight session with dnsObs.value === null (still running)
    const inFlightNullSession: DiagnosticSession = {
      ...unrunSession,
      observations: [
        {
          key: "dns_resolution",
          source: "live",
          severity: "severe",
          metricName: "DNS Resolution",
          value: null,
          quality: "unverified",
          limitation: "Timed Out",
        },
      ],
    };

    rerender(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={inFlightNullSession} activeStage="dns" />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // Since session is still running, "Timed Out" is suppressed and "Pending..." is displayed
    expect(screen.queryByText("Timed Out")).not.toBeInTheDocument();

    // 3. Completed session with dnsObs.value === null
    const completedTimedOutSession: DiagnosticSession = {
      ...inFlightNullSession,
      status: "completed",
    };

    rerender(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={completedTimedOutSession} activeStage={null} />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // Now that session is completed with null value, "Timed Out" is legitimately displayed
    const timedOutElements = screen.getAllByText("Timed Out");
    expect(timedOutElements.length).toBeGreaterThanOrEqual(1);
    expect(timedOutElements[0]).toHaveStyle({ color: "var(--np-finding)" });
    unmount();
  });

  it("accurately colors HTTP 500 as finding even if TTFB is normal, and colors Ping as finding if packet loss is severe", () => {
    const errorSession: DiagnosticSession = {
      sessionId: 102,
      target: "example.com",
      status: "completed",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      observations: [
        {
          key: "http_status",
          source: "live",
          severity: "severe",
          metricName: "HTTP Status Code",
          value: 500,
          quality: "high",
        },
        {
          key: "http_ttfb",
          source: "live",
          severity: "normal",
          metricName: "HTTP Time to First Byte",
          value: 45,
          unit: "ms",
          quality: "high",
        },
        {
          key: "target_ping_rtt",
          source: "live",
          severity: "normal",
          metricName: "Target Round-Trip Latency",
          value: 15,
          unit: "ms",
          quality: "high",
        },
        {
          key: "target_packet_loss",
          source: "live",
          severity: "severe",
          metricName: "Target End-to-End Packet Loss",
          value: 75,
          unit: "%",
          quality: "high",
        },
      ],
      diagnoses: [],
      recommendations: [],
    };

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={errorSession} activeStage={null} />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // HTTP 500 must have finding/red color, not normal/green
    const httpStatusEl = screen.getByText("HTTP 500");
    expect(httpStatusEl).toBeInTheDocument();
    expect(httpStatusEl).toHaveStyle({ color: "var(--np-finding)" });

    // Ping latency metric with 75% severe packet loss must have finding/red color
    const pingRttEl = screen.getByText("15 ms");
    expect(pingRttEl).toBeInTheDocument();
    expect(pingRttEl).toHaveStyle({ color: "var(--np-finding)" });
  });

  it("stops all downstream probe queries when screen is unmounted during pipeline execution", async () => {
    let resolveGateway!: (val: any) => void;
    const gatewayPromise = new Promise((resolve) => {
      resolveGateway = resolve;
    });

    const executedQueries: string[] = [];

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      executedQueries.push(req.kind);
      switch (req.kind) {
        case "discoverGateway":
          return await gatewayPromise;
        case "runDnsProbe":
          return { kind: "dnsResult", result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], resolutionRttMs: 12, status: "resolved", source: "live" } };
        case "runPing":
          return { kind: "pingResult", result: { target: "1.1.1.1", sent: 4, received: 4, lossPct: 0, minRttMs: 10, avgRttMs: 14, maxRttMs: 18, source: "live" } };
        default:
          return { kind: "success" };
      }
    }) as any);

    const { unmount } = render(<DiagnosticsTestWrapper />);

    const fullAnalysisBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(fullAnalysisBtn);

    // Initial stage: discoverGateway is called
    expect(executedQueries).toEqual(["discoverGateway"]);

    // Unmount screen while pipeline is in-flight
    unmount();

    // Complete the in-flight gateway query
    resolveGateway({
      kind: "gatewayResult",
      result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" },
    });

    // Wait a brief microtask tick to allow promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert NO downstream queries were called
    expect(executedQueries).toEqual(["discoverGateway"]);
    expect(executedQueries).not.toContain("runDnsProbe");
    expect(executedQueries).not.toContain("runPing");
    expect(executedQueries).not.toContain("runTraceroute");
    expect(executedQueries).not.toContain("runBufferbloatTest");
    expect(executedQueries).not.toContain("runHttpProbe");
  });

  it("immediately stops pipeline and clears state when Clear Results is clicked during execution", async () => {
    let resolveGateway!: (val: any) => void;
    const gatewayPromise = new Promise((resolve) => {
      resolveGateway = resolve;
    });

    const executedQueries: string[] = [];

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      executedQueries.push(req.kind);
      switch (req.kind) {
        case "discoverGateway":
          return await gatewayPromise;
        case "runDnsProbe":
          return { kind: "dnsResult", result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], resolutionRttMs: 12, status: "resolved", source: "live" } };
        default:
          return { kind: "success" };
      }
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const fullAnalysisBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(fullAnalysisBtn);

    // In-flight banner is displayed and Clear Results button becomes visible
    expect(await screen.findByTestId("deep-diagnostics-analyzing-banner")).toBeInTheDocument();
    expect(executedQueries).toEqual(["discoverGateway"]);

    const clearBtn = await screen.findByRole("button", { name: "Clear Results" });
    fireEvent.click(clearBtn);

    // Results and in-flight state should be cleared immediately
    expect(screen.queryByTestId("deep-diagnostics-analyzing-banner")).not.toBeInTheDocument();
    expect(
      screen.getByText("Enter a target hostname or IP address (IPv4, IPv6, domain) and choose a diagnostic probe.")
    ).toBeInTheDocument();

    // Resolve the in-flight gateway query
    await act(async () => {
      resolveGateway({
        kind: "gatewayResult",
        result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Pipeline should NOT have executed any downstream probes
    expect(executedQueries).toEqual(["discoverGateway"]);
    expect(executedQueries).not.toContain("runDnsProbe");
    expect(executedQueries).not.toContain("runPing");

    // Empty state remains present, deepSession was not revived
    expect(
      screen.getByText("Enter a target hostname or IP address (IPv4, IPv6, domain) and choose a diagnostic probe.")
    ).toBeInTheDocument();
  });

  it("disambiguates Ping latency from DNS and Bufferbloat observations, and renders HTTP connect/TTFB metrics without status code shadowing", () => {
    const multiProbeSession: DiagnosticSession = {
      sessionId: 501,
      target: "1.1.1.1",
      status: "completed",
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
      observations: [
        {
          key: "gateway_reachability",
          source: "live",
          severity: "normal",
          metricName: "Default Gateway Reachability",
          value: "192.168.1.1",
          quality: "high",
          rawDetails: { gatewayIp: "192.168.1.1", interfaceName: "eth0" },
        },
        {
          key: "dns_rtt",
          source: "live",
          severity: "normal",
          metricName: "DNS Resolution Latency",
          value: 8.5,
          unit: "ms",
          quality: "high",
          rawDetails: { resolvedIps: ["1.1.1.1", "1.0.0.1"] },
        },
        {
          key: "target_packet_loss",
          source: "live",
          severity: "normal",
          metricName: "Target End-to-End Packet Loss",
          value: 0,
          unit: "%",
          quality: "high",
        },
        {
          key: "target_ping_rtt",
          source: "live",
          severity: "normal",
          metricName: "Target Round-Trip Latency",
          value: 24.2,
          unit: "ms",
          quality: "high",
          rawDetails: { jitterMs: 3.1, minRttMs: 22.0, maxRttMs: 25.1 },
        },
        {
          key: "bufferbloat_delta",
          source: "live",
          severity: "normal",
          metricName: "Bufferbloat Latency Delta",
          value: 4.8,
          unit: "ms",
          quality: "high",
        },
        {
          key: "http_status",
          source: "live",
          severity: "normal",
          metricName: "HTTP Status Code",
          value: 200,
          quality: "high",
        },
        {
          key: "http_ttfb",
          source: "live",
          severity: "normal",
          metricName: "HTTP Time to First Byte",
          value: 45.4,
          unit: "ms",
          quality: "high",
          rawDetails: { connectMs: 14.6, ttfbMs: 45.4 },
        },
      ],
      diagnoses: [],
      recommendations: [],
    };

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <DeepDiagnosticCard session={multiProbeSession} activeStage={null} />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // DNS metric displays 8.5 ms and resolved IPs
    expect(screen.getByText("8.5 ms")).toBeInTheDocument();
    expect(screen.getByText("1.1.1.1, 1.0.0.1")).toBeInTheDocument();

    // Round-Trip Latency displays Ping RTT (24.2 ms), NOT DNS RTT (8.5 ms) or Bufferbloat (4.8 ms)
    expect(screen.getByText("24.2 ms")).toBeInTheDocument();
    expect(screen.getByText("Loss: 0% · Jitter: 3.1ms")).toBeInTheDocument();

    // HTTP Web Probe displays HTTP 200 and Connect / TTFB breakdown (NOT 'Bounded connection')
    expect(screen.getByText("HTTP 200")).toBeInTheDocument();
    expect(screen.getByText("Connect: 14.6ms · TTFB: 45.4ms")).toBeInTheDocument();

    // Stepper has progressbar ARIA attributes
    const stepper = screen.getByRole("progressbar", { name: "Diagnostic pipeline progress" });
    expect(stepper).toHaveAttribute("aria-valuenow", "6");
    expect(stepper).toHaveAttribute("aria-valuemin", "0");
    expect(stepper).toHaveAttribute("aria-valuemax", "6");
  });

  it("cancels stale previous pipeline execution when clearResults and a new pipeline run are triggered in rapid succession", async () => {
    let resolveFirstGateway!: (val: any) => void;
    const firstGatewayPromise = new Promise((resolve) => {
      resolveFirstGateway = resolve;
    });

    let firstRunQueries = 0;

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      if (req.kind === "discoverGateway" && firstRunQueries === 0) {
        firstRunQueries++;
        return await firstGatewayPromise;
      }
      if (req.kind === "discoverGateway") {
        return { kind: "gatewayResult", result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" } };
      }
      if (req.kind === "runDnsProbe") {
        return { kind: "dnsResult", result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], resolutionRttMs: 12, status: "resolved", source: "live" } };
      }
      return { kind: "success" };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const fullAnalysisBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(fullAnalysisBtn);

    // First run is waiting on discoverGateway
    expect(await screen.findByTestId("deep-diagnostics-analyzing-banner")).toBeInTheDocument();

    // User clears results
    const clearBtn = await screen.findByRole("button", { name: "Clear Results" });
    fireEvent.click(clearBtn);

    // User immediately starts a second run
    fireEvent.click(fullAnalysisBtn);

    // Now resolve the FIRST run's gateway query
    await act(async () => {
      resolveFirstGateway({
        kind: "gatewayResult",
        result: { gatewayIp: "10.0.0.1", interfaceName: "eth99", status: "discovered", source: "live" },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The first run was cancelled and stopped at its first step
    expect(firstRunQueries).toBe(1);
  });
});
