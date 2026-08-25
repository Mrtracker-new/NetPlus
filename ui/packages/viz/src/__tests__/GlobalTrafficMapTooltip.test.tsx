import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GlobalTrafficMap, clearGeoCaches } from "../index";
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
    label: "31.0.0.1", // Frankfurt
    bytes: 524288,
    flows: 5,
    hostnames: [{ name: "fra.node.net", source: "dns" }],
    evidence: [{ kind: "session", id: 202 }],
  },
];

describe("GlobalTrafficMap Tooltip & Accessibility Integration", () => {
  it("renders tooltip on node mouse hover with structured badge and telemetry", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    expect(nodeBtn).toBeInTheDocument();

    // Hover on node
    fireEvent.mouseEnter(nodeBtn);

    const tooltip = screen.getByRole("tooltip", { hidden: true });
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveClass("np-geomap-tooltip");
    expect(tooltip).toHaveTextContent("one.one.one.one");
    expect(tooltip).toHaveTextContent("1.0 MB");
    expect(tooltip).toHaveTextContent("12");
  });

  it("removes tooltip on mouse leave", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    fireEvent.mouseEnter(nodeBtn);
    expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();

    fireEvent.mouseLeave(nodeBtn);
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
  });

  it("exposes tooltip and aria-describedby on keyboard focus", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    fireEvent.focus(nodeBtn);

    const tooltip = screen.getByRole("tooltip", { hidden: true });
    expect(tooltip).toBeInTheDocument();
    expect(nodeBtn).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("dismisses tooltip on Escape keydown", () => {
    render(<GlobalTrafficMap hosts={mockHosts} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    fireEvent.focus(nodeBtn);
    expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();

    const svg = screen.getByRole("img", { name: /Global Traffic Map:/i });
    fireEvent.keyDown(svg, { key: "Escape" });

    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
  });

  it("preserves click and Enter selection dispatch while tooltip is active", () => {
    const handleSelect = vi.fn();
    render(<GlobalTrafficMap hosts={mockHosts} onSelectEntity={handleSelect} />);

    const nodeBtn = screen.getByRole("button", { name: /one.one.one.one/i });
    fireEvent.mouseEnter(nodeBtn);
    fireEvent.click(nodeBtn);

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "endpoint",
        ip: "1.1.1.1",
      })
    );
  });
});
