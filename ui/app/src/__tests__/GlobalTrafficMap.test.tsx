import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GlobalTrafficMap, classifyIpAddress, resolveGeo, resolveAsn, clearGeoCaches } from "@netpulse/viz";
import type { BreakdownRow } from "@netpulse/contract";

afterEach(() => {
  cleanup();
  clearGeoCaches();
});

const mockHosts: BreakdownRow[] = [
  {
    label: "1.1.1.1",
    bytes: 1048576,
    flows: 12,
    hostnames: [{ name: "one.one.one.one", source: "dns" }],
    evidence: [{ kind: "flow", id: 101 }],
  },
  {
    label: "31.0.0.1", // Frankfurt, Germany
    bytes: 524288,
    flows: 5,
    hostnames: [{ name: "fra.node.net", source: "dns" }],
    evidence: [{ kind: "session", id: 202 }],
  },
  {
    label: "192.168.1.1",
    bytes: 20480,
    flows: 2,
    hostnames: [{ name: "gateway.local", source: "hosts_file" }],
    evidence: [{ kind: "flow", id: 303 }],
  },
  {
    label: "239.255.255.250",
    bytes: 4096,
    flows: 1,
    hostnames: [],
    evidence: [{ kind: "flow", id: 404 }],
  },
  {
    label: "93.184.216.34", // Unmapped public IP
    bytes: 8192,
    flows: 1,
    hostnames: [{ name: "unresolved.example.com", source: "dns" }],
    evidence: [{ kind: "flow", id: 505 }],
  },
];

describe("GlobalTrafficMap Integration in @netpulse/app", () => {
  it("renders SVG with accessible label, unambiguous HUD metrics, and world map features", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const svg = screen.getByRole("img", { name: /Global Traffic Map:/i });
    expect(svg).toBeInTheDocument();

    expect(screen.getByText("RESOLVED COUNTRIES")).toBeInTheDocument();
    expect(screen.getByText("RESOLVED ENDPOINTS")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE ASNs")).toBeInTheDocument();
    expect(screen.getByText("TOTAL VOLUME")).toBeInTheDocument();
    expect(screen.getByText("GEOGRAPHIC COVERAGE")).toBeInTheDocument();
  });

  it("renders first-class coverage banner for unresolved public traffic and handles inspection", () => {
    const handleSelect = vi.fn();
    render(<GlobalTrafficMap hosts={mockHosts} onSelectEntity={handleSelect} />);

    expect(screen.getByText(/have no geographic resolution/i)).toBeInTheDocument();
    const inspectBtn = screen.getByRole("button", { name: /Inspect Unresolved/i });
    expect(inspectBtn).toBeInTheDocument();

    fireEvent.click(inspectBtn);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "unresolvedGroup",
        title: "Unresolved Public Destinations",
      })
    );
  });

  it("segregates private LAN and multicast traffic into the Local Network tray", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    expect(screen.getByText(/Local Network \(2 LAN \/ Multicast\)/i)).toBeInTheDocument();
    expect(screen.getByText(/192.168.1.1 • Private Network \(LAN\)/i)).toBeInTheDocument();
  });

  it("supports node selection via mouse click and triggers onSelectEntity callback", () => {
    const handleSelect = vi.fn();
    render(<GlobalTrafficMap hosts={mockHosts} onSelectEntity={handleSelect} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    expect(nodeBtn).toBeInTheDocument();

    fireEvent.click(nodeBtn);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "endpoint",
        ip: "1.1.1.1",
      })
    );
  });

  it("supports keyboard navigation (Enter / Space) to select a node", () => {
    const handleSelect = vi.fn();
    render(<GlobalTrafficMap hosts={mockHosts} onSelectEntity={handleSelect} />);

    const nodeBtn = screen.getByRole("button", { name: /fra.node.net/i });
    fireEvent.keyDown(nodeBtn, { key: "Enter" });

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "endpoint",
        ip: "31.0.0.1",
      })
    );
  });

  it("executes IP classification and GeoIP enrichment offline with zero network egress", () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as any;

    try {
      for (const host of mockHosts) {
        const c = classifyIpAddress(host.label);
        expect(c).toBeDefined();
        const g = resolveGeo(host.label);
        expect(g).toBeDefined();
        const a = resolveAsn(host.label);
        expect(a).toBeDefined();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
