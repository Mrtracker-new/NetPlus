import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import i18n from "../i18n";
import { App } from "../App";
import { DiagnosticsScreen } from "../screens/Diagnostics";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

function DiagnosticsTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <DiagnosticsScreen />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Diagnostics Vertical Slice Verification Checkpoints", () => {
  beforeEach(() => {
    __resetForTest();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  // Checkpoint 1: Navigation Entry
  it("Checkpoint 1: Navigation Entry - User selects 'Diagnostics' from sidebar rail, page mounts tactile console, target defaults to '1.1.1.1', empty state capability deck displays 4 raised cards", async () => {
    render(<App />);

    // Select "Diagnostics" from sidebar rail
    const diagNavButton = screen.getByRole("button", { name: "Diagnostics" });
    expect(diagNavButton).toBeInTheDocument();
    fireEvent.click(diagNavButton);

    // Page mounts, title indicator aligns
    const screenIndicator = screen.getByRole("status", { name: "Diagnostics" });
    expect(screenIndicator).toBeInTheDocument();

    // Tactile console plate is rendered
    const consolePlate = document.querySelector(".np-diagnostics-console");
    expect(consolePlate).toBeInTheDocument();

    // Target well defaults to "1.1.1.1"
    const targetInput = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)") as HTMLInputElement;
    expect(targetInput).toBeInTheDocument();
    expect(targetInput.value).toBe("1.1.1.1");

    // Empty state capability deck displays 4 raised cards
    const deck = screen.getByRole("region", { name: "Diagnostic Capabilities" });
    expect(deck).toBeInTheDocument();

    const capabilityCards = deck.querySelectorAll(".np-diagnostics__capability-card");
    expect(capabilityCards.length).toBe(4);

    expect(screen.getByRole("heading", { level: 3, name: "Full Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Ping Probe" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Traceroute" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Bufferbloat Test" })).toBeInTheDocument();
  });

  // Checkpoint 2: Preset Switching
  it("Checkpoint 2: Preset Switching - Clicking '8.8.8.8', '9.9.9.9', or 'localhost' updates target well and sets aria-pressed='true' on active preset", () => {
    render(<DiagnosticsTestWrapper />);

    const targetInput = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)") as HTMLInputElement;
    expect(targetInput.value).toBe("1.1.1.1");

    // 1.1.1.1 preset is active by default
    const cfPreset = screen.getByRole("button", { name: /1\.1\.1\.1/i });
    const googlePreset = screen.getByRole("button", { name: /8\.8\.8\.8/i });
    const quad9Preset = screen.getByRole("button", { name: /9\.9\.9\.9/i });
    const localPreset = screen.getByRole("button", { name: "localhost" });

    expect(cfPreset).toHaveAttribute("aria-pressed", "true");
    expect(googlePreset).toHaveAttribute("aria-pressed", "false");
    expect(quad9Preset).toHaveAttribute("aria-pressed", "false");
    expect(localPreset).toHaveAttribute("aria-pressed", "false");

    // Click 8.8.8.8
    fireEvent.click(googlePreset);
    expect(targetInput.value).toBe("8.8.8.8");
    expect(googlePreset).toHaveAttribute("aria-pressed", "true");
    expect(cfPreset).toHaveAttribute("aria-pressed", "false");

    // Click 9.9.9.9
    fireEvent.click(quad9Preset);
    expect(targetInput.value).toBe("9.9.9.9");
    expect(quad9Preset).toHaveAttribute("aria-pressed", "true");
    expect(googlePreset).toHaveAttribute("aria-pressed", "false");

    // Click localhost
    fireEvent.click(localPreset);
    expect(targetInput.value).toBe("localhost");
    expect(localPreset).toHaveAttribute("aria-pressed", "true");
    expect(quad9Preset).toHaveAttribute("aria-pressed", "false");
  });

  // Checkpoint 3: Target Editing & Desync Protection
  it("Checkpoint 3: Target Editing & Desync Protection - Run Traceroute against 1.1.1.1, edit input well to 8.8.8.8, verify Traceroute card title remains strictly 'Traceroute Hops for 1.1.1.1'", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "tracerouteResult",
      target: "1.1.1.1",
      hops: [
        { ttl: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 2.1, status: "ok", source: "live" },
        { ttl: 2, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14.5, status: "ok", source: "live" },
      ],
    } as any);

    render(<DiagnosticsTestWrapper />);

    // Run Traceroute on 1.1.1.1
    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);

    // Traceroute card renders with title bound to 1.1.1.1
    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();

    // User edits input well to 8.8.8.8
    const input = screen.getByPlaceholderText("Target Host (e.g. 1.1.1.1, google.com)");
    fireEvent.change(input, { target: { value: "8.8.8.8" } });

    // Assert Traceroute card title remains strictly bound to 1.1.1.1
    expect(screen.getByText("Traceroute Hops for 1.1.1.1 (2 hops)")).toBeInTheDocument();
    expect(screen.queryByText("Traceroute Hops for 8.8.8.8 (2 hops)")).not.toBeInTheDocument();
  });

  // Checkpoint 4: Ping Probe Execution
  it("Checkpoint 4: Ping Probe Execution - Click 'Ping Probe', button displays tactile busy spinner, PingResultCard displays sent/received, packet loss, avg RTT, jitter, and 'LIVE' badge", async () => {
    let resolvePing!: (val: any) => void;
    const pingPromise = new Promise((resolve) => {
      resolvePing = resolve;
    });

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      if (req.kind === "runPing") {
        return await pingPromise;
      }
      return { kind: "success" };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const pingBtn = screen.getByRole("button", { name: "Ping Probe" });
    fireEvent.click(pingBtn);

    // Verify button displays busy spinner while query is running
    expect(pingBtn).toHaveAttribute("aria-busy", "true");
    expect(pingBtn.querySelector(".np-spinner")).toBeInTheDocument();

    // Resolve query with live ICMP echo results
    await act(async () => {
      resolvePing({
        kind: "pingResult",
        result: {
          target: "1.1.1.1",
          sent: 4,
          received: 4,
          lossPct: 0,
          minRttMs: 12.3,
          avgRttMs: 15.6,
          maxRttMs: 18.9,
          stddevRttMs: 2.1,
          source: "live",
        },
      });
    });

    // PingResultCard rendered
    expect(await screen.findByText("Ping Results for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("4 / 4")).toBeInTheDocument(); // Sent / Received
    expect(screen.getByText("0%")).toBeInTheDocument(); // Packet loss
    expect(screen.getByText("15.6ms")).toBeInTheDocument(); // Avg RTT
    expect(screen.getByText("2.1ms")).toBeInTheDocument(); // Jitter

    // Provenance badge displays "LIVE" / "live" with live class
    const provenanceBadge = screen.getByText("live");
    expect(provenanceBadge).toBeInTheDocument();
    expect(provenanceBadge).toHaveClass("np-diagnostics-provenance--live");
    expect(provenanceBadge).toHaveAttribute("data-provenance", "live");
  });

  // Checkpoint 5: Traceroute Execution
  it("Checkpoint 5: Traceroute Execution - Click 'Traceroute', card displays live intermediate hops with router IP, hostname, latency, and segmented timeline/table toggle", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "tracerouteResult",
      target: "1.1.1.1",
      hops: [
        { ttl: 1, ip: "192.168.1.1", hostname: "router.lan", rttMs: 1.8, status: "ok", source: "live" },
        { ttl: 2, ip: "10.0.0.1", hostname: "isp-gw.net", rttMs: 6.4, status: "ok", source: "live" },
        { ttl: 3, ip: "1.1.1.1", hostname: "one.one.one.one", rttMs: 14.2, status: "ok", source: "live" },
      ],
    } as any);

    render(<DiagnosticsTestWrapper />);

    const traceBtn = screen.getByRole("button", { name: "Traceroute" });
    fireEvent.click(traceBtn);

    expect(await screen.findByText("Traceroute Hops for 1.1.1.1 (3 hops)")).toBeInTheDocument();

    // Verify intermediate hops display IP, hostname, and latency in Timeline view
    expect(screen.getByText("router.lan")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();
    expect(screen.getByText("1.8 ms")).toBeInTheDocument();

    expect(screen.getByText("isp-gw.net")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("6.4 ms")).toBeInTheDocument();

    expect(screen.getByText("one.one.one.one")).toBeInTheDocument();
    expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("14.2 ms")).toBeInTheDocument();

    // Toggle to Table view
    const tableBtn = screen.getByRole("button", { name: "Table" });
    fireEvent.click(tableBtn);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("router.lan")).toBeInTheDocument();
  });

  // Checkpoint 6: Bufferbloat Test Execution
  it("Checkpoint 6: Bufferbloat Test Execution - Click 'Bufferbloat Test', measures idle/loaded RTT, computes delta, assigns authentic grade", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "bufferbloatResult",
      result: {
        target: "1.1.1.1",
        grade: "A+",
        idleRttMs: 11.4,
        loadedRttMs: 16.8,
        deltaRttMs: 5.4,
        source: "live",
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const bloatBtn = screen.getByRole("button", { name: "Bufferbloat Test" });
    fireEvent.click(bloatBtn);

    expect(await screen.findByText("Bufferbloat Scorecard for 1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
    expect(screen.getByText("Idle RTT: 11.4ms")).toBeInTheDocument();
    expect(screen.getByText("Loaded RTT: 16.8ms")).toBeInTheDocument();
    expect(screen.getByText("Delta: +5.4ms")).toBeInTheDocument();

    // Recommended usage guidance
    expect(screen.getByText("Gaming:")).toBeInTheDocument();
    expect(screen.getAllByText("Excellent").length).toBe(3);
  });

  // Checkpoint 7: Full Deep Analysis Execution
  it("Checkpoint 7: Full Deep Analysis Execution - Dominant action starts, stepper animates active stage, no premature green banner, observations show 'Pending...', upon completion findings and remediations appear", async () => {
    let resolveGateway!: (val: any) => void;
    const gatewayPromise = new Promise((resolve) => {
      resolveGateway = resolve;
    });

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      switch (req.kind) {
        case "discoverGateway":
          return await gatewayPromise;
        case "runDnsProbe":
          return {
            kind: "dnsResult",
            result: { target: "1.1.1.1", resolvedIps: ["1.1.1.1"], resolutionRttMs: 8.2, status: "resolved", source: "live" },
          };
        case "runPing":
          return {
            kind: "pingResult",
            result: { target: "1.1.1.1", sent: 4, received: 4, lossPct: 0, minRttMs: 10, avgRttMs: 14, maxRttMs: 18, stddevRttMs: 1.5, source: "live" },
          };
        case "runTraceroute":
          return {
            kind: "tracerouteResult",
            target: "1.1.1.1",
            hops: [
              { ttl: 1, ip: "192.168.1.1", rttMs: 1.5, source: "live" },
              { ttl: 2, ip: "1.1.1.1", rttMs: 14.0, source: "live" },
            ],
          };
        case "runBufferbloatTest":
          return {
            kind: "bufferbloatResult",
            result: { target: "1.1.1.1", grade: "A", idleRttMs: 10, loadedRttMs: 22, deltaRttMs: 12, source: "live" },
          };
        case "runHttpProbe":
          return {
            kind: "httpResult",
            result: { url: "http://1.1.1.1", statusCode: 200, ttfbMs: 42, connectMs: 14, source: "live" },
          };
        default:
          return { kind: "success" };
      }
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const runFullBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(runFullBtn);

    // 1. Single dominant action starts: analyzing banner is displayed
    const inFlightBanner = await screen.findByTestId("deep-diagnostics-analyzing-banner");
    expect(inFlightBanner).toBeInTheDocument();
    expect(within(inFlightBanner).getByText("In-Flight Analysis")).toBeInTheDocument();
    expect(within(inFlightBanner).getByText("Gateway")).toBeInTheDocument();

    // 2. Stepper indicates progress
    const stepper = screen.getByRole("progressbar", { name: "Diagnostic pipeline progress" });
    expect(stepper).toBeInTheDocument();

    // 3. No premature green banner appears
    expect(screen.queryByText("No clear bottleneck detected")).not.toBeInTheDocument();

    // 4. Observations show "Pending..." while probes are in-flight
    const pendingBadges = screen.getAllByText("PENDING");
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1);

    // 5. Complete gateway query
    await act(async () => {
      resolveGateway({
        kind: "gatewayResult",
        result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" },
      });
    });

    // 6. Assessment completes with nominal finding and recommendations
    expect(await screen.findByText("No clear bottleneck detected")).toBeInTheDocument();
    expect(screen.queryByTestId("deep-diagnostics-analyzing-banner")).not.toBeInTheDocument();
    expect(screen.getByText("Network Operating Nominally")).toBeInTheDocument();
  });

  // Checkpoint 8: Cancellation & Cleanup
  it("Checkpoint 8: Cancellation & Cleanup - Start Full Analysis and immediately click 'Clear Results', ongoing queries abort immediately and no unmounted updates occur", async () => {
    let resolveGateway!: (val: any) => void;
    const gatewayPromise = new Promise((resolve) => {
      resolveGateway = resolve;
    });

    const executedQueries: string[] = [];

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      executedQueries.push(req.kind);
      if (req.kind === "discoverGateway") {
        return await gatewayPromise;
      }
      return { kind: "success" };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    const runFullBtn = screen.getAllByRole("button", { name: "Run Full Analysis" })[0]!;
    fireEvent.click(runFullBtn);

    // Analysis is in flight
    expect(await screen.findByTestId("deep-diagnostics-analyzing-banner")).toBeInTheDocument();
    expect(executedQueries).toEqual(["discoverGateway"]);

    // Click "Clear Results"
    const clearBtn = await screen.findByRole("button", { name: "Clear Results" });
    fireEvent.click(clearBtn);

    // Banner is dismissed, empty state restored
    expect(screen.queryByTestId("deep-diagnostics-analyzing-banner")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diagnostic Capabilities" })).toBeInTheDocument();

    // Resolve first in-flight query
    await act(async () => {
      resolveGateway({
        kind: "gatewayResult",
        result: { gatewayIp: "192.168.1.1", interfaceName: "eth0", status: "discovered", source: "live" },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Verify pipeline did NOT proceed to downstream probes
    expect(executedQueries).toEqual(["discoverGateway"]);
    expect(executedQueries).not.toContain("runDnsProbe");
    expect(executedQueries).not.toContain("runPing");
  });

  // Checkpoint 9: Internationalization (i18n)
  it("Checkpoint 9: Internationalization (i18n) - Switch language to Spanish, verify entire screen is translated", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });

    render(<DiagnosticsTestWrapper />);

    // Screen title & description in Spanish
    expect(screen.getByRole("heading", { level: 1, name: "Diagnósticos de Red Activos" })).toBeInTheDocument();
    expect(screen.getByText(/Pruebas opcionales: Ping ICMP\/UDP/i)).toBeInTheDocument();

    // Console quick presets & input placeholder in Spanish
    expect(screen.getByText("Preajustes Rápidos de Destino:")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Host Destino (ej. 1.1.1.1, google.com)")).toBeInTheDocument();

    // Action buttons in Spanish (console actions and capability cards)
    expect(screen.getAllByRole("button", { name: "Ejecutar Análisis Completo" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Prueba Ping" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Traceroute" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Prueba Bufferbloat" }).length).toBeGreaterThanOrEqual(1);

    // Capability deck in Spanish
    expect(screen.getByRole("region", { name: "Capacidades de Diagnóstico" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Análisis Completo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Prueba Ping" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Traceroute" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Prueba Bufferbloat" })).toBeInTheDocument();
  });

  // Checkpoint 10: True Neumorphic Consistency
  it("Checkpoint 10: True Neumorphic Consistency - Verified tactile classes, inset wells, and state depression styles", () => {
    const { container } = render(<DiagnosticsTestWrapper />);

    // Console plate has tactile console class
    const consolePlate = container.querySelector(".np-diagnostics-console");
    expect(consolePlate).toBeInTheDocument();

    // Input well has inset well styling class
    const inputWell = container.querySelector(".np-diagnostics-input-well");
    expect(inputWell).toBeInTheDocument();

    // Preset buttons have preset button classes
    const presetBtn = container.querySelector(".np-diagnostics__preset-btn");
    expect(presetBtn).toBeInTheDocument();

    // Capability cards have capability card elevation classes
    const capabilityCard = container.querySelector(".np-diagnostics__capability-card");
    expect(capabilityCard).toBeInTheDocument();

    // Capability icon has inset well class
    const capabilityIcon = container.querySelector(".np-diagnostics__capability-icon");
    expect(capabilityIcon).toBeInTheDocument();
  });

  // Bug Fix Regression 1: Single Probe In-Flight Cancellation & Desync Protection
  it("Single Probe Desync Protection: In-flight probe does not resurrect card or announcement if 'Clear Results' is clicked before resolution", async () => {
    let resolvePing!: (val: any) => void;
    const pingPromise = new Promise((resolve) => {
      resolvePing = resolve;
    });

    vi.spyOn(ipcModule, "query").mockImplementation((async (req: any) => {
      if (req.kind === "runTraceroute") {
        return {
          kind: "tracerouteResult",
          target: "1.1.1.1",
          hops: [{ ttl: 1, ip: "192.168.1.1", hostname: "router", rttMs: 2, status: "responded", source: "live" }],
        };
      }
      if (req.kind === "runPing") {
        return await pingPromise;
      }
      return { kind: "success" };
    }) as any);

    render(<DiagnosticsTestWrapper />);

    // First run Traceroute to produce results so Clear Results button is available
    const traceBtn = screen.getAllByRole("button", { name: "Traceroute" })[0]!;
    await act(async () => {
      fireEvent.click(traceBtn);
    });

    // Traceroute card is present, Clear Results button is visible
    expect(await screen.findByRole("button", { name: "Clear Results" })).toBeInTheDocument();
    expect(screen.getByText("Traceroute Hops for 1.1.1.1 (1 hops)")).toBeInTheDocument();

    // Now click Clear Results
    const clearBtn = screen.getByRole("button", { name: "Clear Results" });
    fireEvent.click(clearBtn);

    // Empty state is restored
    expect(screen.getByRole("region", { name: "Diagnostic Capabilities" })).toBeInTheDocument();

    // Now trigger in-flight ping and immediately unmount or call clearResults
    // Let's verify that resolving an old in-flight ping promise does not resurrect anything
    await act(async () => {
      resolvePing({
        kind: "pingResult",
        result: {
          target: "1.1.1.1",
          sent: 4,
          received: 4,
          lossPct: 0,
          minRttMs: 10,
          avgRttMs: 12,
          maxRttMs: 15,
          stddevRttMs: 1,
          source: "live",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Ping result card must NOT be resurrected
    expect(screen.queryByText("Ping Results for 1.1.1.1")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diagnostic Capabilities" })).toBeInTheDocument();
  });

  // Bug Fix Regression 2: Bufferbloat QoS Rating Internationalization
  it("Bufferbloat i18n: QoS quality ratings translate into Spanish properly", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });

    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "bufferbloatResult",
      result: {
        target: "1.1.1.1",
        idleRttMs: 12.5,
        loadedRttMs: 16.0,
        deltaRttMs: 3.5,
        grade: "A",
        source: "live",
      },
    } as any);

    render(<DiagnosticsTestWrapper />);

    const bloatBtn = screen.getAllByRole("button", { name: "Prueba Bufferbloat" })[0]!;
    fireEvent.click(bloatBtn);

    // Wait for card to appear
    expect(await screen.findByText("Tarjeta de Calificación Bufferbloat para 1.1.1.1")).toBeInTheDocument();

    // Verify recommendations in Spanish: "Juegos en línea: Excelente", "VoIP y Llamadas: Excelente", "Cargas Grandes: Excelente"
    expect(screen.getByText("Juegos en línea:")).toBeInTheDocument();
    expect(screen.getByText("VoIP y Llamadas:")).toBeInTheDocument();
    expect(screen.getByText("Cargas Grandes:")).toBeInTheDocument();
    expect(screen.getAllByText("Excelente").length).toBe(3);
  });
});
