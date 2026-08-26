import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Constellation } from "../Constellation";
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
    label: "8.8.8.8",
    bytes: 524288,
    flows: 5,
    hostnames: [{ name: "dns.google", source: "dns" }],
    evidence: [{ kind: "session", id: 202 }],
  },
];

describe("Constellation Component", () => {
  it("renders SVG with accessible label and hosts", () => {
    render(<Constellation hosts={mockHosts} />);

    const svg = screen.getByRole("img", { name: /Network constellation: 2 observed hosts/i });
    expect(svg).toBeInTheDocument();
  });

  it("supports pinning a host node via mouse click and rendering interactive evidence chips", () => {
    const handleNavigate = vi.fn();
    render(<Constellation hosts={mockHosts} onNavigate={handleNavigate} />);

    const nodeBtn = screen.getByRole("button", { name: /Host one.one.one.one/i });
    expect(nodeBtn).toBeInTheDocument();

    fireEvent.click(nodeBtn);

    // Pinned host panel should appear
    expect(screen.getAllByText("one.one.one.one").length).toBeGreaterThan(0);
    const evidenceChip = screen.getByRole("button", { name: "Evidence: flow #101" });
    expect(evidenceChip).toBeInTheDocument();

    fireEvent.click(evidenceChip);
    expect(handleNavigate).toHaveBeenCalledWith({ kind: "flow", id: 101 }, "constellation");
  });

  it("supports keyboard navigation (Enter / Space key) to pin host node", () => {
    render(<Constellation hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /Host dns.google/i });
    fireEvent.keyDown(nodeBtn, { key: "Enter" });

    expect(screen.getAllByText("dns.google").length).toBeGreaterThan(0);
  });

  it("renders collision-safe hover tooltip with traffic, flows, and protocol info", () => {
    render(<Constellation hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /Host one.one.one.one/i });
    fireEvent.mouseEnter(nodeBtn);

    // Tooltip should be rendered with details
    const trafficLabel = screen.getByText("Traffic");
    expect(trafficLabel).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
    expect(screen.getByText("Flows")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    fireEvent.mouseLeave(nodeBtn);
    expect(screen.queryByText("Flows")).not.toBeInTheDocument();
  });

  it("generates unique SVG defs IDs using React useId across multiple instances", () => {
    const { container } = render(
      <div>
        <Constellation hosts={mockHosts} />
        <Constellation hosts={mockHosts} />
      </div>
    );

    const svgElements = container.querySelectorAll("svg");
    expect(svgElements.length).toBe(2);

    const gridPatterns = container.querySelectorAll("pattern");
    expect(gridPatterns.length).toBe(2);
    expect(gridPatterns[0]?.id).not.toEqual(gridPatterns[1]?.id);
  });
});
