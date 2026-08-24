import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { App } from "../App";
import { setMonitor, __resetForTest } from "../state/store";
import { SCREEN_CONTEXTS } from "../components/RightRail/ScreenContextCard";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("RightRail Context Sidebar", () => {
  beforeEach(() => {
    __resetForTest();
    localStorage.clear();
    // Set desktop window innerWidth for desktop tests
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
  });

  it("renders 3 tabs (Context, Session, System) and defaults to Context tab", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: "Context" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Session" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "System" })).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Context" })).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Real-time observation of active network traffic, hosts, and protocol feeds.")
    ).toBeInTheDocument();
  });

  it("switches to Session tab and renders empty state labels and session counters", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Session" }));

    expect(screen.getByText("This session")).toBeInTheDocument();
    expect(screen.getByText("Top hosts")).toBeInTheDocument();
    expect(screen.getByText("Quiet — no hosts yet.")).toBeInTheDocument();
  });

  it("switches to System tab and renders View density and Capability Registry", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "System" }));

    expect(screen.getByText("View density")).toBeInTheDocument();
    expect(screen.getByText("Capability Registry & System")).toBeInTheDocument();
  });

  it("renders top hosts list in Session tab when telemetry arrives", () => {
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

    fireEvent.click(screen.getByRole("tab", { name: "Session" }));

    const hostElements = screen.getAllByText("one.one.one.one");
    expect(hostElements.length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.0 MB").length).toBeGreaterThan(0);
  });


  it("toggles collapse state on desktop and updates data-right-rail-collapsed attribute", () => {
    const { container } = render(<App />);

    const appContainer = container.querySelector(".np-app");
    expect(appContainer).toHaveAttribute("data-right-rail-collapsed", "false");

    const collapseBtn = screen.getByRole("button", { name: "Collapse side panel" });
    fireEvent.click(collapseBtn);

    expect(appContainer).toHaveAttribute("data-right-rail-collapsed", "true");
    expect(localStorage.getItem("netpulse.sidebar.collapsed.v1")).toBe("true");

    // Clicking header toggle button expands rail
    const expandBtn = screen.getByRole("button", { name: "Expand side panel" });
    fireEvent.click(expandBtn);

    expect(appContainer).toHaveAttribute("data-right-rail-collapsed", "false");
  });

  it("defensives localStorage loading against invalid JSON/string values", () => {
    localStorage.setItem("netpulse.sidebar.collapsed.v1", "corrupted-value");
    const { container } = render(<App />);

    const appContainer = container.querySelector(".np-app");
    expect(appContainer).toHaveAttribute("data-right-rail-collapsed", "false");
  });

  it("opens and closes mobile overlay drawer via header toggle, explicit close button, and Escape key", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);

    render(<App />);

    const toggleBtn = screen.getByRole("button", { name: "Expand side panel" });
    fireEvent.click(toggleBtn);

    const railElement = screen.getByRole("complementary", { name: "Context" });
    expect(railElement).toHaveClass("np-rail-right--mobile-open");

    // Close via explicit mobile close button
    const closeBtn = screen.getByRole("button", { name: "Close side panel" });
    fireEvent.click(closeBtn);
    expect(railElement).not.toHaveClass("np-rail-right--mobile-open");

    // Reopen and close via Escape key
    const reopenBtn = screen.getByRole("button", { name: "Expand side panel" });
    fireEvent.click(reopenBtn);
    expect(railElement).toHaveClass("np-rail-right--mobile-open");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(railElement).not.toHaveClass("np-rail-right--mobile-open");
  });

  it("ignores Ctrl+\\ keyboard shortcut when focus is inside an input element", () => {
    const { container } = render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "\\", ctrlKey: true });

    const appContainer = container.querySelector(".np-app");
    expect(appContainer).toHaveAttribute("data-right-rail-collapsed", "false");

    document.body.removeChild(input);
  });

  it("has descriptor entries for all 17 screens in SCREEN_CONTEXTS", () => {
    const screens = [
      "dashboard",
      "journey",
      "timeline",
      "monitoring",
      "apps",
      "security",
      "assistant",
      "learn",
      "explorer",
      "recordings",
      "replay",
      "export",
      "plugins",
      "diagnostics",
      "sandbox",
      "fleet",
      "compare",
    ] as const;

    for (const screenName of screens) {
      expect(SCREEN_CONTEXTS[screenName]).toBeDefined();
      expect(SCREEN_CONTEXTS[screenName].defaultTitle).toBeTruthy();
      expect(SCREEN_CONTEXTS[screenName].defaultSummary).toBeTruthy();
    }
  });
});
