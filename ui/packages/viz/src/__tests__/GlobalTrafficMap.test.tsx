import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GlobalTrafficMap } from "../GlobalTrafficMap";
import type { BreakdownRow } from "@netpulse/contract";

afterEach(() => {
  cleanup();
});

const mockHosts: BreakdownRow[] = [
  {
    label: "17.0.0.1",
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

    expect(screen.getByText(/without physical coordinate resolution/i)).toBeInTheDocument();
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
        ip: "17.0.0.1",
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

  it("enforces cooperative gestures: wheel without Ctrl/Cmd shows scroll hint and preserves page scroll", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const svg = screen.getByRole("img", { name: /Global Traffic Map/i });
    const resetBtn = screen.getByRole("button", { name: /Reset to world view/i });

    // Normal wheel scroll (without modifier) -> does not zoom, page scrolls naturally
    const normalWheelEvent = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      svg.dispatchEvent(normalWheelEvent);
    });

    expect(resetBtn).toBeDisabled(); // Map did not zoom
    expect(screen.getByText(/scroll to zoom map/i)).toBeInTheDocument();

    // Intentional zoom with Ctrl modifier -> zooms map and prevents document scroll
    const ctrlWheelEvent = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      svg.dispatchEvent(ctrlWheelEvent);
    });

    expect(resetBtn).not.toBeDisabled(); // Map zoomed
    expect(ctrlWheelEvent.defaultPrevented).toBe(true); // Document scroll prevented
  });

  it("supports keyboard pan and zoom shortcuts (+, -, 0, Arrow keys, Escape) on SVG focus", () => {
    const handleSelect = vi.fn();
    render(<GlobalTrafficMap hosts={mockHosts} onSelectEntity={handleSelect} />);

    const svg = screen.getByRole("img", { name: /Global Traffic Map/i });
    const resetBtn = screen.getByRole("button", { name: /Reset to world view/i });

    // Press '+' to zoom in
    fireEvent.keyDown(svg, { key: "+" });
    expect(resetBtn).not.toBeDisabled();

    // Pan with arrow keys
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });

    // Press '0' to reset zoom
    fireEvent.keyDown(svg, { key: "0" });
    expect(resetBtn).toBeDisabled();

    // Press '-' to zoom out
    fireEvent.keyDown(svg, { key: "-" });
  });

  it("supports double-click to zoom in on map point", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const svg = screen.getByRole("img", { name: /Global Traffic Map/i });
    const resetBtn = screen.getByRole("button", { name: /Reset to world view/i });

    fireEvent.doubleClick(svg, { clientX: 200, clientY: 150 });
    expect(resetBtn).not.toBeDisabled();
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
          ip: "17.0.0.1",
          entityId: "entity-host-17.0.0.1",
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

  it("renders Other Resolved Traffic aggregate node when clusters exceed budget and dispatches otherResolvedAggregate on click", () => {
    const handleSelect = vi.fn();
    // 4 verified resolved locations: US (San Jose), Germany (Frankfurt), Switzerland (Zurich), Japan (Tokyo)
    const denseHosts: BreakdownRow[] = [
      { label: "17.0.0.1", bytes: 100000, flows: 10, hostnames: [{ name: "us-host", source: "dns" }], evidence: [] },
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
      { label: "17.0.0.1", bytes: 1000, flows: 2, hostnames: [], evidence: [] },
      { label: "2607:f8b0:4005:805::200e", bytes: 3000, flows: 4, hostnames: [], evidence: [] }, // Public IPv6
    ];

    render(<GlobalTrafficMap hosts={mixedHosts} />);

    // Coverage banner indicates IPv6 deferred
    expect(screen.getByText(/1 IPv6 deferred/i)).toBeInTheDocument();

    // HUD has Geographic Coverage label
    const hudItem = screen.getByText("GEOGRAPHIC COVERAGE").closest(".np-geomap-hud__item");
    expect(hudItem).toHaveAttribute(
      "title",
      expect.stringContaining("Geographic Traffic Coverage")
    );
  });

  it("Regression Test: Standalone GlobalTrafficMap updates continuously without snapshotSequence prop (A -> B -> C -> D)", () => {
    const hostA: BreakdownRow[] = [
      { label: "17.0.0.1", bytes: 1000, flows: 1, hostnames: [{ name: "alpha.host", source: "dns" }], evidence: [] },
    ];
    const hostB: BreakdownRow[] = [
      { label: "31.0.0.1", bytes: 2000, flows: 2, hostnames: [{ name: "beta.host", source: "dns" }], evidence: [] },
    ];
    const hostC: BreakdownRow[] = [
      { label: "9.9.9.9", bytes: 3000, flows: 3, hostnames: [{ name: "gamma.host", source: "dns" }], evidence: [] },
    ];
    const hostD: BreakdownRow[] = [
      { label: "142.250.30.1", bytes: 4000, flows: 4, hostnames: [{ name: "delta.host", source: "dns" }], evidence: [] },
    ];

    // Initial render: Host A
    const { rerender } = render(<GlobalTrafficMap hosts={hostA} />);
    expect(screen.getByText("alpha.host")).toBeInTheDocument();

    // Prop update: Host B (sequence omitted)
    rerender(<GlobalTrafficMap hosts={hostB} />);
    expect(screen.getByText("beta.host")).toBeInTheDocument();

    // Prop update: Host C (sequence omitted)
    rerender(<GlobalTrafficMap hosts={hostC} />);
    expect(screen.getByText("gamma.host")).toBeInTheDocument();

    // Prop update: Host D (sequence omitted)
    rerender(<GlobalTrafficMap hosts={hostD} />);
    expect(screen.getByText("delta.host")).toBeInTheDocument();
  });

  it("Regression Test: Mode switching between implicit and explicit sequencing (implicit A -> B -> C -> explicit 100 -> 101 -> 99)", () => {
    const hostA: BreakdownRow[] = [
      { label: "17.0.0.1", bytes: 1000, flows: 1, hostnames: [{ name: "host-a.com", source: "dns" }], evidence: [] },
    ];
    const hostB: BreakdownRow[] = [
      { label: "31.0.0.1", bytes: 2000, flows: 2, hostnames: [{ name: "host-b.com", source: "dns" }], evidence: [] },
    ];
    const hostC: BreakdownRow[] = [
      { label: "9.9.9.9", bytes: 3000, flows: 3, hostnames: [{ name: "host-c.com", source: "dns" }], evidence: [] },
    ];
    const host100: BreakdownRow[] = [
      { label: "142.250.30.1", bytes: 4000, flows: 4, hostnames: [{ name: "host-100.com", source: "dns" }], evidence: [] },
    ];
    const host101: BreakdownRow[] = [
      { label: "17.0.0.1", bytes: 5000, flows: 5, hostnames: [{ name: "host-101.com", source: "dns" }], evidence: [] },
    ];
    const host99Stale: BreakdownRow[] = [
      { label: "31.0.0.1", bytes: 6000, flows: 6, hostnames: [{ name: "host-99-stale.com", source: "dns" }], evidence: [] },
    ];

    // 1. Implicit A
    const { rerender } = render(<GlobalTrafficMap hosts={hostA} />);
    expect(screen.getByText("host-a.com")).toBeInTheDocument();

    // 2. Implicit B
    rerender(<GlobalTrafficMap hosts={hostB} />);
    expect(screen.getByText("host-b.com")).toBeInTheDocument();

    // 3. Implicit C
    rerender(<GlobalTrafficMap hosts={hostC} />);
    expect(screen.getByText("host-c.com")).toBeInTheDocument();

    // 4. Switch to Explicit Sequence 100 (accepted)
    rerender(<GlobalTrafficMap hosts={host100} snapshotSequence={100} />);
    expect(screen.getByText("host-100.com")).toBeInTheDocument();

    // 5. Explicit Sequence 101 (accepted)
    rerender(<GlobalTrafficMap hosts={host101} snapshotSequence={101} />);
    expect(screen.getByText("host-101.com")).toBeInTheDocument();

    // 6. Explicit Sequence 99 (stale -> ignored, retains host-101)
    rerender(<GlobalTrafficMap hosts={host99Stale} snapshotSequence={99} />);
    expect(screen.queryByText("host-99-stale.com")).not.toBeInTheDocument();
    expect(screen.getByText("host-101.com")).toBeInTheDocument();
  });

  it("Regression Test: renderPolicy.maxVisibleNodes = 0 renders zero visual nodes safely while preserving HUD metrics", () => {
    render(<GlobalTrafficMap hosts={mockHosts} renderPolicy={{ maxVisibleNodes: 0 }} />);

    // SVG renders safely
    const svg = screen.getByRole("img", { name: /Global Traffic Map:/i });
    expect(svg).toBeInTheDocument();

    // No visual endpoint or aggregate node buttons rendered
    expect(screen.queryByRole("button", { name: /one.one.one.one/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Other Resolved Traffic/i })).not.toBeInTheDocument();

    // Domain HUD metrics are preserved
    expect(screen.getByText("RESOLVED COUNTRIES")).toBeInTheDocument();
    expect(screen.getByText("RESOLVED ENDPOINTS")).toBeInTheDocument();
  });
});
