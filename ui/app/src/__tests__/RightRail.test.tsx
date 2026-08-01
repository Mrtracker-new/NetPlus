import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "../App";
import { setMonitor, __resetForTest } from "../state/store";

afterEach(() => {
  cleanup();
});

describe("RightRail Context Sidebar", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders empty state labels and session counters", () => {
    render(<App />);

    expect(screen.getByText("This session")).toBeInTheDocument();
    expect(screen.getByText("Top hosts")).toBeInTheDocument();
    expect(screen.getByText("Quiet — no hosts yet.")).toBeInTheDocument();
    expect(screen.getByText("View density")).toBeInTheDocument();
    expect(screen.getByText("Capability Registry & System")).toBeInTheDocument();
  });

  it("renders top hosts list when telemetry arrives", () => {
    setMonitor({
      by_protocol: { dimension: "protocol", rows: [] },
      by_host: {
        dimension: "host",
        rows: [
          {
            label: "1.1.1.1",
            bytes: 2048576,
            flows: 10,
            hostnames: [{ name: "one.one.one.one", source: "dns" }],
            evidence: [],
          },
        ],
      },
      diagnoses: [],
      network_loss_indicators: 0,
      capture_drops: 0,
    });

    render(<App />);

    const hostElements = screen.getAllByText("one.one.one.one");
    expect(hostElements.length).toBeGreaterThan(0);
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
  });
});
