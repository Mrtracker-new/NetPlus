import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { JourneyFlow } from "../JourneyFlow";
import type { FanoutNode, JourneyStage } from "@netpulse/contract";

afterEach(() => {
  cleanup();
});

const mockStages: JourneyStage[] = [
  {
    kind: "dns_resolution",
    title: "DNS Resolution",
    narration: "Resolved domain",
    detail: "Query took 12ms",
    evidence: [{ kind: "session", id: 1 }],
  },
  {
    kind: "connection",
    title: "TCP Connection",
    narration: "Connected to destination",
    detail: null,
    evidence: [],
  },
];

const mockFanout: FanoutNode[] = [
  {
    label: "Cloudflare",
    flows: 4,
    bytes: 1048576,
    evidence: [{ kind: "flow", id: 601 }],
  },
  {
    label: "api.bbc.co.uk",
    flows: 1,
    bytes: 2048,
    evidence: [{ kind: "flow", id: 602 }],
  },
  {
    label: "static.service.gov.au",
    flows: 3,
    bytes: 524288,
    evidence: [],
  },
];

describe("JourneyFlow Fan-out Streamlined Hierarchy", () => {
  it("renders authoritative fanout nodes directly without grouping or ccTLD splitting", () => {
    const { container } = render(
      <JourneyFlow stages={mockStages} fanout={mockFanout} />
    );

    // Hub shows the authoritative count of fanout nodes
    const hub = container.querySelector(".np-jflow__hub");
    expect(hub).toHaveTextContent("3");

    // All authoritative nodes are rendered directly at the top level
    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    expect(screen.getByText("api.bbc.co.uk")).toBeInTheDocument();
    expect(screen.getByText("static.service.gov.au")).toBeInTheDocument();

    // Verify ccTLD names were NOT split into "co.uk" or "gov.au" groups
    expect(screen.queryByText(/^co\.uk$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^gov\.au$/i)).not.toBeInTheDocument();

    // Verify single-level list structure
    const destItems = container.querySelectorAll(".np-jflow__dests > .np-jflow__dest");
    expect(destItems.length).toBe(3);

    // No accordion child containers
    expect(container.querySelector(".np-jflow__dest-children")).toBeNull();
  });

  it("displays clear flow counts and formatted bytes", () => {
    render(<JourneyFlow stages={mockStages} fanout={mockFanout} />);

    // Singular vs plural flow counts
    expect(screen.getByText("4 flows")).toBeInTheDocument();
    expect(screen.getByText("1 flow")).toBeInTheDocument();
    expect(screen.getByText("3 flows")).toBeInTheDocument();

    // Human-readable bytes
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("512 KB")).toBeInTheDocument();
  });

  it("renders interactive evidence chips and routes navigation with 'journey' source", () => {
    const handleNavigate = vi.fn();
    render(
      <JourneyFlow
        stages={mockStages}
        fanout={mockFanout}
        onNavigate={handleNavigate}
      />
    );

    const flowChip = screen.getByRole("button", { name: "Evidence: flow #601" });
    expect(flowChip).toBeInTheDocument();

    fireEvent.click(flowChip);
    expect(handleNavigate).toHaveBeenCalledWith({ kind: "flow", id: 601 }, "journey");
  });

  it("respects customized labels for fanout header and flow counts", () => {
    render(
      <JourneyFlow
        stages={mockStages}
        fanout={mockFanout}
        labels={{
          fanoutTitle: "Target Hosts & CDNs",
          fanoutAria: "Accessible Fanout Section",
          flowsCount: (c) => `${c} active stream${c === 1 ? "" : "s"}`,
        }}
      />
    );

    expect(screen.getByText("Target Hosts & CDNs")).toBeInTheDocument();
    expect(screen.getByLabelText("Accessible Fanout Section")).toBeInTheDocument();
    expect(screen.getByText("4 active streams")).toBeInTheDocument();
    expect(screen.getByText("1 active stream")).toBeInTheDocument();
  });

  it("renders nothing for fanout section when fanout list is empty", () => {
    const { container } = render(
      <JourneyFlow stages={mockStages} fanout={[]} />
    );

    expect(container.querySelector(".np-jflow__fanout")).toBeNull();
  });
});
