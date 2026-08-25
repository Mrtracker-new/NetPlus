import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GlobalTrafficMap } from "../GlobalTrafficMap";
import type { BreakdownRow } from "@netpulse/contract";

afterEach(() => {
  cleanup();
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
    label: "31.0.0.1", // Frankfurt, Germany (distinct geographic region)
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

describe("GlobalTrafficMap Component", () => {
  it("renders SVG with accessible label, unambiguous HUD metrics, and world map features", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    // SVG with accessible role and label
    const svg = screen.getByRole("img", { name: /Global Traffic Map:/i });
    expect(svg).toBeInTheDocument();

    // Unambiguous Production HUD items
    expect(screen.getByText("RESOLVED COUNTRIES")).toBeInTheDocument();
    expect(screen.getByText("RESOLVED ENDPOINTS")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE ASNs")).toBeInTheDocument();
    expect(screen.getByText("TOTAL VOLUME")).toBeInTheDocument();
    expect(screen.getByText("GEOGRAPHIC COVERAGE")).toBeInTheDocument();
    expect(screen.getByText("LOCAL ORIGIN")).toBeInTheDocument();
  });

  it("renders first-class coverage banner for unresolved public traffic and supports inspect click", () => {
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

  it("provides interactive zoom controls and pan/zoom gestures", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const zoomInBtn = screen.getByRole("button", { name: /Zoom in/i });
    const zoomOutBtn = screen.getByRole("button", { name: /Zoom out/i });
    const resetBtn = screen.getByRole("button", { name: /Reset to world view/i });

    expect(zoomInBtn).toBeInTheDocument();
    expect(zoomOutBtn).toBeInTheDocument();
    expect(resetBtn).toBeInTheDocument();

    fireEvent.click(zoomInBtn);
    expect(resetBtn).not.toBeDisabled();

    fireEvent.click(resetBtn);
    expect(resetBtn).toBeDisabled();
  });

  it("renders empty state cleanly without crashing when hosts array is empty", () => {
    render(<GlobalTrafficMap hosts={[]} />);

    const svg = screen.getByRole("img", { name: /Global Traffic Map: 0 active countries/i });
    expect(svg).toBeInTheDocument();
    expect(screen.getByText("Location unavailable")).toBeInTheDocument();
  });

  it("maintains selection, active highlighting, and places label for selectedEntity", () => {
    render(
      <GlobalTrafficMap
        hosts={mockHosts}
        selectedEntity={{
          kind: "endpoint",
          ip: "1.1.1.1",
          entityId: "entity-host-1.1.1.1",
          host: {} as any,
        }}
      />
    );

    const selectedGroup = document.querySelector(".np-geomap__node-group--selected");
    expect(selectedGroup).toBeInTheDocument();

    // Verify label text inside selected group is rendered visible
    const labelText = selectedGroup?.querySelector("text");
    expect(labelText).toBeInTheDocument();
    expect(labelText?.textContent).toBe("one.one.one.one");
  });

  it("renders Other Resolved Traffic aggregate node when clusters exceed budget and dispatches otherResolvedGroup on click", () => {
    const handleSelect = vi.fn();
    // 4 verified resolved locations: US (San Jose), Germany (Frankfurt), Switzerland (Zurich), Japan (Tokyo)
    const denseHosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 100000, flows: 10, hostnames: [{ name: "us-host", source: "dns" }], evidence: [] },
      { label: "31.0.0.1", bytes: 60000, flows: 6, hostnames: [{ name: "de-host", source: "dns" }], evidence: [] },
      { label: "9.9.9.9", bytes: 40000, flows: 4, hostnames: [{ name: "ch-host", source: "dns" }], evidence: [] },
      { label: "142.250.30.1", bytes: 20000, flows: 2, hostnames: [{ name: "jp-host", source: "dns" }], evidence: [] },
    ];

    render(
      <GlobalTrafficMap
        hosts={denseHosts}
        renderPolicy={{ maxVisibleNodes: 2 }}
        onSelectEntity={handleSelect}
      />
    );

    // Look for the Other Resolved Traffic aggregate node
    const aggNode = screen.getByRole("button", { name: /Other Resolved Traffic/i });
    expect(aggNode).toBeInTheDocument();

    // Click the aggregate node
    fireEvent.click(aggNode);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "otherResolvedAggregate",
        title: expect.stringMatching(/Other Resolved Traffic/i),
        memberHosts: expect.any(Array),
      })
    );
  });

  it("clarifies that public IPv6 is deferred in the coverage banner and HUD", () => {
    const mixedHosts: BreakdownRow[] = [
      { label: "1.1.1.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] },
      { label: "2607:f8b0:4005:805::200e", bytes: 3000, flows: 4, hostnames: [], evidence: [] }, // Public IPv6
    ];

    render(<GlobalTrafficMap hosts={mixedHosts} />);

    // Coverage banner indicates IPv6 deferred
    expect(screen.getByText(/including 1 IPv6 deferred/i)).toBeInTheDocument();

    // HUD has Geographic Coverage label
    const hudItem = screen.getByText("GEOGRAPHIC COVERAGE").closest(".np-geomap-hud__item");
    expect(hudItem).toHaveAttribute(
      "title",
      expect.stringContaining("Public IPv6 GeoIP resolution is intentionally deferred")
    );
  });
});
