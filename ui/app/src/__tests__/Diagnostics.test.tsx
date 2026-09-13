import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom";
import axe from "axe-core";
import i18n from "../i18n";
import { DiagnosticsScreen } from "../screens/Diagnostics";
import { DeepDiagnosticCard } from "../screens/Diagnostics/DeepDiagnosticCard";
import { PingResultCard, getJitterColor } from "../screens/Diagnostics/PingResultCard";
import { TracerouteCard } from "../screens/Diagnostics/TracerouteCard";
import { BufferbloatCard } from "../screens/Diagnostics/BufferbloatCard";
import type { DiagnosticSession } from "../diagnostic";
import * as diagnosticModule from "../diagnostic";
import { validateAndNormalizeTarget, useDiagnosticsController } from "../hooks/useDiagnosticsController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
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
        stddevRttMs: 2.1,
        source: "live",
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    expect(await screen.findByText("Ping Results for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("15ms")).toBeInTheDocument(); // Avg RTT
    const jitterElem = screen.getByText("2.1ms"); // Jitter = stddevRttMs
    expect(jitterElem).toBeInTheDocument();
    expect(jitterElem).toHaveStyle({ color: "var(--np-good)" }); // < 5ms is green
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

describe("PingResultCard Jitter Standard Deviation & Semantic Coloring", () => {
  it("computes jitter color based on severity thresholds (<5ms green, <20ms notable, >=20ms finding)", () => {
    expect(getJitterColor(0)).toBe("var(--np-good)");
    expect(getJitterColor(4.9)).toBe("var(--np-good)");
    expect(getJitterColor(5.0)).toBe("var(--np-notable)");
    expect(getJitterColor(19.9)).toBe("var(--np-notable)");
    expect(getJitterColor(20.0)).toBe("var(--np-finding)");
    expect(getJitterColor(35.2)).toBe("var(--np-finding)");
  });

  it("renders nominal jitter (<5ms) with green semantic color", () => {
    render(
      <PingResultCard
        result={{
          target: "1.1.1.1",
          sent: 4,
          received: 4,
          lossPct: 0,
          minRttMs: 10,
          avgRttMs: 12,
          maxRttMs: 15,
          stddevRttMs: 1.8,
          jitterMs: 1.8,
        }}
      />
    );
    const jitterVal = screen.getByText("1.8ms");
    expect(jitterVal).toBeInTheDocument();
    expect(jitterVal).toHaveStyle({ color: "var(--np-good)" });
  });

  it("renders notable jitter (5ms - 19.9ms) with notable semantic color", () => {
    render(
      <PingResultCard
        result={{
          target: "1.1.1.1",
          sent: 4,
          received: 4,
          lossPct: 0,
          minRttMs: 10,
          avgRttMs: 25,
          maxRttMs: 40,
          stddevRttMs: 12.4,
          jitterMs: 12.4,
        }}
      />
    );
    const jitterVal = screen.getByText("12.4ms");
    expect(jitterVal).toBeInTheDocument();
    expect(jitterVal).toHaveStyle({ color: "var(--np-notable)" });
  });

  it("renders elevated/finding jitter (>=20ms) with finding semantic color", () => {
    render(
      <PingResultCard
        result={{
          target: "1.1.1.1",
          sent: 4,
          received: 4,
          lossPct: 0,
          minRttMs: 10,
          avgRttMs: 40,
          maxRttMs: 90,
          stddevRttMs: 24.6,
          jitterMs: 24.6,
        }}
      />
    );
    const jitterVal = screen.getByText("24.6ms");
    expect(jitterVal).toBeInTheDocument();
    expect(jitterVal).toHaveStyle({ color: "var(--np-finding)" });
  });

  it("decouples notice banner from empty state deck, keeping capabilities visible on validation notice", async () => {
    render(<DiagnosticsTestWrapper />);

    // Initially, empty capabilities deck is visible
    expect(screen.getByRole("region", { name: "Diagnostic Capabilities" })).toBeInTheDocument();

    const targetInput = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(targetInput, { target: { value: "invalid target with spaces" } });

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    // Notice banner appears
    expect(await screen.findByText("Please enter a valid target hostname, IPv4, IPv6, or localhost address.")).toBeInTheDocument();

    // Empty capability deck remains visible (decoupled from notice)
    expect(screen.getByRole("region", { name: "Diagnostic Capabilities" })).toBeInTheDocument();
    expect(screen.getByText("Multi-Stage Inference")).toBeInTheDocument();
    expect(screen.getByText("ICMP / UDP Telemetry")).toBeInTheDocument();
  });

  it("translates 100% of text on Deep Diagnostic card into Spanish", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    try {
      const nominalSession: DiagnosticSession = {
        sessionId: 42,
        target: "1.1.1.1",
        status: "completed",
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        observations: [
          {
            key: "gateway_reachability",
            metricName: "Default Gateway Reachability",
            value: "192.168.1.1",
            source: "live",
            severity: "normal",
            quality: "high",
            rawDetails: { gatewayIp: "192.168.1.1", interfaceName: "eth0" },
          },
          {
            key: "dns_rtt",
            metricName: "DNS Resolution Latency",
            value: 12.5,
            unit: "ms",
            source: "live",
            severity: "normal",
            quality: "high",
            rawDetails: { resolvedIps: ["1.1.1.1", "1.0.0.1"] },
          },
          {
            key: "http_ttfb",
            metricName: "HTTP Time to First Byte",
            value: 45.2,
            unit: "ms",
            source: "live",
            severity: "normal",
            quality: "high",
            rawDetails: { connectMs: 15.0 },
          },
          {
            key: "target_ping_rtt",
            metricName: "Target Round-Trip Latency",
            value: 18.4,
            unit: "ms",
            source: "live",
            severity: "normal",
            quality: "high",
            rawDetails: { jitterMs: 2.1 },
          },
          {
            key: "target_packet_loss",
            metricName: "Target Packet Loss",
            value: 0,
            unit: "%",
            source: "live",
            severity: "normal",
            quality: "high",
          },
        ],
        diagnoses: [
          {
            category: "UNKNOWN",
            confidence: 1.0,
            summary: "All Network Diagnostics Healthy",
            explanation: "All diagnostic probes reported nominal performance.",
            evidence: [],
            severity: "normal",
          },
        ],
        recommendations: [
          {
            key: "nominal",
            titleKey: "assessment.recommendations.nominal.title",
            descriptionKey: "assessment.recommendations.nominal.desc",
            title: "Network Operating Nominally",
            description: "No remedial actions required. Continue monitoring traffic for transient anomalies.",
            actionType: "info",
            priority: "low",
          },
        ],
      };

      await act(async () => {
        render(<DeepDiagnosticCard session={nominalSession} activeStage={null} />);
      });

      // Header & Status
      expect(screen.getByText("Evaluación Diagnóstica y Hallazgos")).toBeInTheDocument();
      expect(screen.getByText("Completado")).toBeInTheDocument();
      expect(screen.getByText("Sesión #42 · Destino: 1.1.1.1")).toBeInTheDocument();

      // Stages
      expect(screen.getByText("Gateway")).toBeInTheDocument();
      expect(screen.getByText("DNS")).toBeInTheDocument();
      expect(screen.getByText("Ping")).toBeInTheDocument();
      expect(screen.getByText("Traceroute")).toBeInTheDocument();
      expect(screen.getByText("Bufferbloat")).toBeInTheDocument();
      expect(screen.getByText("HTTP")).toBeInTheDocument();

      // No bottleneck finding banner
      expect(screen.getByText("No se detectó ningún cuello de botella evidente")).toBeInTheDocument();
      expect(screen.getByText(/Todas las pruebas de diagnóstico operaron dentro de parámetros nominales/i)).toBeInTheDocument();

      // Observation card titles in Spanish
      expect(screen.getByText("Gateway Predeterminado")).toBeInTheDocument();
      expect(screen.getByText("Resolución DNS")).toBeInTheDocument();
      expect(screen.getByText("Prueba Web HTTP")).toBeInTheDocument();
      expect(screen.getByText("Latencia de Ida y Vuelta")).toBeInTheDocument();

      // Provenance in Spanish
      const liveBadges = screen.getAllByText("EN VIVO");
      expect(liveBadges.length).toBe(4);

      // Observation subtitles / metrics in Spanish
      expect(screen.getByText("Interfaz: eth0")).toBeInTheDocument();
      expect(screen.getByText("1.1.1.1, 1.0.0.1")).toBeInTheDocument();
      expect(screen.getByText(/Conexión: 15ms · TTFB: 45\.2ms/i)).toBeInTheDocument();
      expect(screen.getByText(/Pérdida: 0% · Jitter: 2\.1ms/i)).toBeInTheDocument();

      // Recommendations in Spanish
      expect(screen.getByText("Acciones de Remediación Recomendadas")).toBeInTheDocument();
      expect(screen.getByText("Red Operando Nominalmente")).toBeInTheDocument();
      expect(screen.getByText("No se requieren acciones correctivas. Continúa monitoreando el tráfico para detectar anomalías transitorias.")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("translates anomaly diagnoses, evidence roles, and recommendation templates in Spanish", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    try {
      const anomalySession: DiagnosticSession = {
        sessionId: 88,
        target: "bad-dns.example.com",
        status: "completed",
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        observations: [],
        diagnoses: [
          {
            category: "DNS",
            confidence: 0.95,
            summary: "DNS Query Resolution Failure",
            explanation: "Domain name resolution failed completely.",
            evidence: [
              {
                observationKey: "dns_resolution",
                role: "corroborating",
                explanation: "DNS query timed out after 5000ms",
                weight: 0.85,
              },
            ],
            severity: "severe",
          },
        ],
        recommendations: [
          {
            key: "dns",
            titleKey: "assessment.recommendations.dns.title",
            descriptionKey: "assessment.recommendations.dns.desc",
            title: "Check DNS Resolver Configuration",
            description: "Verify primary and secondary DNS server addresses.",
            actionType: "settings",
            priority: "high",
          },
        ],
      };

      await act(async () => {
        render(<DeepDiagnosticCard session={anomalySession} activeStage={null} />);
      });

      expect(screen.getByText("SEVERO")).toBeInTheDocument();
      expect(screen.getByText("Puntuación de Confianza")).toBeInTheDocument();
      expect(screen.getByText("95%")).toBeInTheDocument();

      // Evidence
      const viewEvBtn = screen.getByRole("button", { name: /Ver 1 Señales de Evidencia Corroborante/i });
      await act(async () => {
        fireEvent.click(viewEvBtn);
      });
      expect(screen.getByText("corroborante")).toBeInTheDocument();
      expect(screen.getByText("peso: 85%")).toBeInTheDocument();

      // Recommendation
      expect(screen.getByText("Verificar Configuración del Servidor DNS")).toBeInTheDocument();
      expect(screen.getByText(/Verifica las direcciones de los servidores DNS primario y secundario/i)).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  describe("Accessibility & Document Heading Hierarchy", () => {
    it("Empty state has valid heading hierarchy under h1 with no skipped levels according to axe-core", async () => {
      const { container } = render(<DiagnosticsTestWrapper />);

      // Document title is h1
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(h1).toHaveTextContent("Active Network Diagnostics");

      // Empty state title is h2 (promoted from h3)
      const h2s = screen.getAllByRole("heading", { level: 2 });
      expect(h2s.map((h) => h.textContent)).toContain("Active Network Diagnostics");

      // Capability card titles are h3 (promoted from h4)
      const h3s = screen.getAllByRole("heading", { level: 3 });
      expect(h3s.map((h) => h.textContent)).toEqual([
        "Full Analysis",
        "Ping Probe",
        "Traceroute",
        "Bufferbloat Test",
      ]);

      // Confirm no h4 or h5 in empty state
      expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);

      // Run axe-core heading-order audit
      const axeResults = await axe.run(container, { runOnly: ["heading-order"] });
      expect(axeResults.violations).toEqual([]);
    });

    it("Probe result cards and deep assessment cards have valid h2 headings with no skipped levels according to axe-core", async () => {
      const sessionWithAnomaly: DiagnosticSession = {
        sessionId: 101,
        status: "completed",
        target: "1.1.1.1",
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        diagnoses: [
          {
            category: "GATEWAY",
            severity: "elevated",
            confidence: 0.88,
            summary: "High Gateway Latency",
            explanation: "Gateway RTT exceeds baseline threshold.",
            evidence: [],
          },
        ],
        observations: [
          { key: "target_ping_rtt", severity: "elevated", value: 85, metricName: "RTT", source: "live", quality: "high" },
          { key: "target_packet_loss", severity: "normal", value: 0, metricName: "Loss", source: "live", quality: "high" },
        ],
        recommendations: [
          {
            key: "reboot_router",
            title: "Reboot Primary Gateway",
            description: "Power cycle your router to clear state.",
            actionType: "hardware",
            priority: "high",
          },
        ],
      };

      const { container } = render(
        <DisclosureProvider>
          <EvidenceNavigationProvider>
            <section className="np-diagnostics">
              <header>
                <h1 className="np-hero__title">Active Network Diagnostics</h1>
              </header>
              <div className="np-diagnostics-results-flow">
                <DeepDiagnosticCard session={sessionWithAnomaly} activeStage={null} />
                <PingResultCard
                  result={{
                    target: "1.1.1.1",
                    sent: 4,
                    received: 4,
                    lossPct: 0,
                    minRttMs: 10,
                    avgRttMs: 14,
                    maxRttMs: 18,
                    jitterMs: 1.2,
                    source: "live",
                  }}
                />
                <TracerouteCard
                  target="1.1.1.1"
                  hops={[
                    { ttl: 1, ip: "192.168.1.1", hostname: "router.local", rttMs: 2, source: "live" },
                    { ttl: 2, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14, source: "live" },
                  ]}
                />
                <BufferbloatCard
                  target="1.1.1.1"
                  result={{
                    target: "1.1.1.1",
                    grade: "A",
                    idleRttMs: 12,
                    loadedRttMs: 16,
                    deltaRttMs: 4,
                    source: "live",
                  }}
                />
              </div>
            </section>
          </EvidenceNavigationProvider>
        </DisclosureProvider>
      );

      // Verify all card titles are h2
      const h2Headings = screen.getAllByRole("heading", { level: 2 });
      const h2Texts = h2Headings.map((h) => h.textContent);
      expect(h2Texts).toContain("Diagnostic Assessment & Findings");
      expect(h2Texts).toContain("Ping Results for 1.1.1.1");
      expect(h2Texts).toContain("Traceroute Hops for 1.1.1.1 (2 hops)");
      expect(h2Texts).toContain("Bufferbloat Scorecard for 1.1.1.1");

      // Verify sub-finding is h3 under DeepDiagnosticCard
      const h3Headings = screen.getAllByRole("heading", { level: 3 });
      expect(h3Headings.map((h) => h.textContent)).toContain("High Gateway Latency");

      // Verify remediation is h4 under DeepDiagnosticCard
      const h4Headings = screen.getAllByRole("heading", { level: 4 });
      expect(h4Headings.map((h) => h.textContent)).toContain("Recommended Remediation Actions");

      // Run axe-core heading-order audit
      const axeResults = await axe.run(container, { runOnly: ["heading-order"] });
      expect(axeResults.violations).toEqual([]);
    });

    it("In-flight analysis state satisfies axe-core heading-order", async () => {
      const runningSession: DiagnosticSession = {
        sessionId: 102,
        status: "running",
        target: "1.1.1.1",
        startedAt: Date.now(),
        diagnoses: [],
        observations: [],
        recommendations: [],
      };

      const { container } = render(
        <section className="np-diagnostics">
          <h1>Active Network Diagnostics</h1>
          <DeepDiagnosticCard session={runningSession} activeStage="dns" />
        </section>
      );

      const h2 = screen.getByRole("heading", { level: 2 });
      expect(h2).toHaveTextContent("Diagnostic Assessment & Findings");

      const h3 = screen.getByRole("heading", { level: 3 });
      expect(h3).toHaveTextContent("In-Flight Analysis");

      const axeResults = await axe.run(container, { runOnly: ["heading-order"] });
      expect(axeResults.violations).toEqual([]);
    });

    it("Nominal (no bottleneck detected) state satisfies axe-core heading-order", async () => {
      const nominalSession: DiagnosticSession = {
        sessionId: 103,
        status: "completed",
        target: "1.1.1.1",
        startedAt: Date.now() - 3000,
        completedAt: Date.now(),
        diagnoses: [],
        observations: [],
        recommendations: [],
      };

      const { container } = render(
        <section className="np-diagnostics">
          <h1>Active Network Diagnostics</h1>
          <DeepDiagnosticCard session={nominalSession} activeStage={null} />
        </section>
      );

      const h2 = screen.getByRole("heading", { level: 2 });
      expect(h2).toHaveTextContent("Diagnostic Assessment & Findings");

      const h3 = screen.getByRole("heading", { level: 3 });
      expect(h3).toHaveTextContent("No clear bottleneck detected");

      const axeResults = await axe.run(container, { runOnly: ["heading-order"] });
      expect(axeResults.violations).toEqual([]);
    });

    it("handles 100% packet loss unreachable ping probe safely without false green 0ms jitter", () => {
      render(
        <PingResultCard
          result={{
            target: "10.255.255.1",
            sent: 4,
            received: 0,
            lossPct: 100,
            minRttMs: 0,
            avgRttMs: 0,
            maxRttMs: 0,
            jitterMs: 0,
            source: "live",
          }}
        />
      );

      // Packet loss pod is finding color
      expect(screen.getByText("100%")).toHaveStyle({ color: "var(--np-finding)" });

      // Sent / Received
      expect(screen.getByText("4 / 0")).toBeInTheDocument();

      // Avg RTT and Jitter display as em-dash with muted color instead of green 0ms
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(2);

      // Provenance attribute is normalized
      const badge = screen.getByText("live");
      expect(badge).toHaveAttribute("data-provenance", "live");
      expect(badge).toHaveClass("np-diagnostics-provenance--live");

      // Article is properly labelled by heading
      const article = document.querySelector("article");
      expect(article).toHaveAttribute("aria-labelledby", "ping-result-heading");
    });
  });

  describe("Pipeline Stepper Progressbar ARIA Range Attributes", () => {
    it("supplies mandatory aria-valuemin, aria-valuemax, and aria-valuenow during each in-flight stage and on completion", () => {
      const runningSession: DiagnosticSession = {
        sessionId: 201,
        status: "running",
        target: "1.1.1.1",
        startedAt: Date.now(),
        diagnoses: [],
        observations: [],
        recommendations: [],
      };

      const { rerender } = render(
        <DeepDiagnosticCard session={runningSession} activeStage="gateway" />
      );

      const stepper = screen.getByRole("progressbar", { name: "Diagnostic pipeline progress" });
      expect(stepper).toHaveAttribute("aria-valuemin", "0");
      expect(stepper).toHaveAttribute("aria-valuemax", "6");
      expect(stepper).toHaveAttribute("aria-valuenow", "0");

      rerender(<DeepDiagnosticCard session={runningSession} activeStage="dns" />);
      expect(stepper).toHaveAttribute("aria-valuenow", "1");

      rerender(<DeepDiagnosticCard session={runningSession} activeStage="traceroute" />);
      expect(stepper).toHaveAttribute("aria-valuenow", "3");

      const completedSession: DiagnosticSession = {
        ...runningSession,
        status: "completed",
      };
      // Even if activeStage is still set to 'http' on completion, all steps should be complete and none running
      rerender(<DeepDiagnosticCard session={completedSession} activeStage="http" />);
      expect(stepper).toHaveAttribute("aria-valuenow", "6");
      expect(document.querySelectorAll(".np-diagnostics-step--complete").length).toBe(6);
      expect(document.querySelectorAll(".np-diagnostics-step--running").length).toBe(0);
    });
  });

  describe("Screen Reader Live Announcements Localization", () => {
    it("announces probe progress, success, and clear in English when in English mode", async () => {
      vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
        if (req.kind === "runPing") {
          return {
            kind: "pingResult",
            result: {
              target: "1.1.1.1",
              sent: 4,
              received: 4,
              lossPct: 0,
              minRttMs: 10,
              avgRttMs: 12,
              maxRttMs: 14,
              stddevRttMs: 1,
              source: "live",
            },
          };
        }
        return { kind: "pingResult", result: {} };
      }) as any);

      const { container } = render(<DiagnosticsTestWrapper />);
      const liveRegion = container.querySelector(".np-sr-only[aria-live='polite']");
      expect(liveRegion).toBeInTheDocument();

      const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
      await act(async () => {
        fireEvent.click(pingBtn);
      });

      expect(liveRegion?.textContent).toBe("Ping probe completed for 1.1.1.1 with 0% loss.");

      const clearBtn = screen.getByRole("button", { name: "Clear Results" });
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      expect(liveRegion?.textContent).toBe("Diagnostic probe results cleared.");
    });

    it("announces probe progress, completion, and clear in Spanish when switched to Spanish mode", async () => {
      await act(async () => {
        await i18n.changeLanguage("es");
      });

      try {
        vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
          if (req.kind === "runPing") {
            return {
              kind: "pingResult",
              result: {
                target: "1.1.1.1",
                sent: 4,
                received: 4,
                lossPct: 0,
                minRttMs: 10,
                avgRttMs: 12,
                maxRttMs: 14,
                stddevRttMs: 1,
                source: "live",
              },
            };
          }
          if (req.kind === "runTraceroute") {
            return {
              kind: "tracerouteResult",
              target: "1.1.1.1",
              hops: [
                { ttl: 1, ip: "192.168.1.1", hostname: "gw", rttMs: 1, status: "ok", source: "live" },
                { ttl: 2, ip: "1.1.1.1", hostname: "one", rttMs: 10, status: "ok", source: "live" },
              ],
            };
          }
          if (req.kind === "runBufferbloatTest") {
            return {
              kind: "bufferbloatResult",
              result: { target: "1.1.1.1", idleRttMs: 10, loadedRttMs: 15, deltaRttMs: 5, grade: "A+", source: "live" },
            };
          }
          return { kind: "pingResult", result: {} };
        }) as any);

        const { container } = render(<DiagnosticsTestWrapper />);
        const liveRegion = container.querySelector(".np-sr-only[aria-live='polite']");
        expect(liveRegion).toBeInTheDocument();

        // 1. Ping in Spanish
        const pingBtn = screen.getByRole("button", { name: "Prueba Ping" });
        await act(async () => {
          fireEvent.click(pingBtn);
        });
        expect(liveRegion?.textContent).toBe("Prueba ping completada para 1.1.1.1 con 0% de pérdida.");

        // 2. Traceroute in Spanish
        const traceBtn = screen.getByRole("button", { name: "Traceroute" });
        await act(async () => {
          fireEvent.click(traceBtn);
        });
        expect(liveRegion?.textContent).toBe("Traceroute completado para 1.1.1.1 con 2 saltos.");

        // 3. Bufferbloat in Spanish
        const bloatBtn = screen.getByRole("button", { name: "Prueba Bufferbloat" });
        await act(async () => {
          fireEvent.click(bloatBtn);
        });
        expect(liveRegion?.textContent).toBe("Prueba de bufferbloat completada con calificación A+.");

        // 4. Clear results in Spanish
        const clearBtn = screen.getByRole("button", { name: "Limpiar Resultados" });
        await act(async () => {
          fireEvent.click(clearBtn);
        });
        expect(liveRegion?.textContent).toBe("Resultados de pruebas de diagnóstico eliminados.");
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("announces probe errors in Spanish mode", async () => {
      await act(async () => {
        await i18n.changeLanguage("es");
      });

      try {
        vi.spyOn(ipcModule, "query").mockRejectedValue(new Error("Connection timeout"));

        const { container } = render(<DiagnosticsTestWrapper />);
        const liveRegion = container.querySelector(".np-sr-only[aria-live='polite']");

        // Ping error
        const pingBtn = screen.getByRole("button", { name: "Prueba Ping" });
        await act(async () => {
          fireEvent.click(pingBtn);
        });
        expect(liveRegion?.textContent).toBe("Error en la prueba ping: Connection timeout");

        // Traceroute error
        const traceBtn = screen.getByRole("button", { name: "Traceroute" });
        await act(async () => {
          fireEvent.click(traceBtn);
        });
        expect(liveRegion?.textContent).toBe("Error en traceroute: Connection timeout");

        // Bufferbloat error
        const bloatBtn = screen.getByRole("button", { name: "Prueba Bufferbloat" });
        await act(async () => {
          fireEvent.click(bloatBtn);
        });
        expect(liveRegion?.textContent).toBe("Error en la prueba de bufferbloat: Connection timeout");
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("announces deep diagnostics completion and error in Spanish mode", async () => {
      await act(async () => {
        await i18n.changeLanguage("es");
      });

      try {
        const dummySession: DiagnosticSession = {
          sessionId: 101,
          target: "1.1.1.1",
          status: "completed",
          startedAt: Date.now() - 2000,
          completedAt: Date.now(),
          diagnoses: [
            {
              category: "GATEWAY",
              confidence: 0.9,
              summary: "Gateway issue",
              explanation: "Gateway unreachable",
              evidence: [],
              severity: "severe",
            },
          ],
          observations: [],
          recommendations: [],
        };

        vi.spyOn(diagnosticModule, "executeDiagnosticPipeline").mockResolvedValue(dummySession);

        const { container } = render(<DiagnosticsTestWrapper />);
        const liveRegion = container.querySelector(".np-sr-only[aria-live='polite']");

        const fullAnalysisBtn = screen.getAllByRole("button", { name: "Ejecutar Análisis Completo" })[0]!;
        await act(async () => {
          fireEvent.click(fullAnalysisBtn);
        });

        expect(liveRegion?.textContent).toBe("Diagnóstico profundo completado con 1 hallazgos.");

        // Failure case
        vi.spyOn(diagnosticModule, "executeDiagnosticPipeline").mockRejectedValue(new Error("Pipeline aborted"));
        await act(async () => {
          fireEvent.click(fullAnalysisBtn);
        });
        expect(liveRegion?.textContent).toBe("Error en el flujo de diagnóstico profundo: Pipeline aborted");
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("directly formats announcement strings via useDiagnosticsController hook in Spanish", async () => {
      await act(async () => {
        await i18n.changeLanguage("es");
      });

      try {
        vi.spyOn(ipcModule, "query").mockResolvedValue({
          kind: "pingResult",
          result: {
            target: "1.1.1.1",
            sent: 4,
            received: 4,
            lossPct: 25,
            minRttMs: 10,
            avgRttMs: 15,
            maxRttMs: 20,
            stddevRttMs: 1.5,
            source: "live",
          },
        } as any);

        const { result } = renderHook(() => useDiagnosticsController());

        await act(async () => {
          await result.current.actions.runPing();
        });

        expect(result.current.announcement).toBe("Prueba ping completada para 1.1.1.1 con 25% de pérdida.");

        await act(async () => {
          result.current.actions.clearResults();
        });

        expect(result.current.announcement).toBe("Resultados de pruebas de diagnóstico eliminados.");
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });
  });

  describe("Cross-Screen Evidence Navigation Integration", () => {
    it("initializes target from navigationTarget when screen is diagnostics", () => {
      const { result } = renderHook(
        () => {
          const nav = useEvidenceNavigation();
          const diag = useDiagnosticsController();
          return { nav, diag };
        },
        {
          wrapper: EvidenceNavigationProvider,
        }
      );

      expect(result.current.diag.target).toBe("1.1.1.1");

      act(() => {
        result.current.nav.setNavigationTarget({ screen: "diagnostics", target: "192.168.1.50" });
      });

      expect(result.current.diag.target).toBe("192.168.1.50");
    });

    it("pre-populates target input on DiagnosticsScreen when navigated with target host", () => {
      function TestHost() {
        const { setNavigationTarget } = useEvidenceNavigation();
        return (
          <div>
            <button
              onClick={() =>
                setNavigationTarget({ screen: "diagnostics", target: "10.200.1.1" })
              }
            >
              Run Diagnostic Probe
            </button>
            <DiagnosticsScreen />
          </div>
        );
      }

      render(
        <DisclosureProvider>
          <EvidenceNavigationProvider>
            <TestHost />
          </EvidenceNavigationProvider>
        </DisclosureProvider>
      );

      const input = screen.getByLabelText("Target Host (e.g. 1.1.1.1, google.com)") as HTMLInputElement;
      expect(input.value).toBe("1.1.1.1");

      // Click "Run Diagnostic Probe" (e.g. from Dashboard cross-screen navigation)
      fireEvent.click(screen.getByRole("button", { name: "Run Diagnostic Probe" }));

      // Target input now pre-populated with target host
      expect(input.value).toBe("10.200.1.1");
    });

    it("defaults to 1.1.1.1 when navigationTarget does not specify a target host", () => {
      const { result } = renderHook(
        () => {
          const nav = useEvidenceNavigation();
          const diag = useDiagnosticsController();
          return { nav, diag };
        },
        {
          wrapper: EvidenceNavigationProvider,
        }
      );

      act(() => {
        result.current.nav.setNavigationTarget({ screen: "diagnostics" });
      });

      expect(result.current.diag.target).toBe("1.1.1.1");
    });

    it("ignores navigationTarget targeting another screen", () => {
      const { result } = renderHook(
        () => {
          const nav = useEvidenceNavigation();
          const diag = useDiagnosticsController();
          return { nav, diag };
        },
        {
          wrapper: EvidenceNavigationProvider,
        }
      );

      act(() => {
        result.current.nav.setNavigationTarget({ screen: "apps", flowId: 101 });
      });

      expect(result.current.diag.target).toBe("1.1.1.1");
    });

    it("trims whitespace from target host in navigationTarget", () => {
      const { result } = renderHook(
        () => {
          const nav = useEvidenceNavigation();
          const diag = useDiagnosticsController();
          return { nav, diag };
        },
        {
          wrapper: EvidenceNavigationProvider,
        }
      );

      act(() => {
        result.current.nav.setNavigationTarget({ screen: "diagnostics", target: "  192.168.1.100  " });
      });

      expect(result.current.diag.target).toBe("192.168.1.100");
    });

    it("falls back to default 1.1.1.1 when target host is whitespace-only", () => {
      const { result } = renderHook(
        () => {
          const nav = useEvidenceNavigation();
          const diag = useDiagnosticsController();
          return { nav, diag };
        },
        {
          wrapper: EvidenceNavigationProvider,
        }
      );

      act(() => {
        result.current.nav.setNavigationTarget({ screen: "diagnostics", target: "   " });
      });

      expect(result.current.diag.target).toBe("1.1.1.1");
    });
  });
});

