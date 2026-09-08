import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { NarrativeCard } from "@netpulse/contract";
import "../i18n";
import { Timeline } from "../screens/Timeline";
import { useTimelineController } from "../hooks/useTimelineController";
import { formatTimelineAxis } from "../utils/timeline.utils";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { setFeed, __resetForTest } from "../state/store";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function TimelineTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Timeline />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Timeline Screen & useTimelineController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("controller hook preserves full feed metadata (packetId, evidence, summary)", () => {
    setFeed([
      {
        headline: "Suspicious DNS Query",
        summary: "High volume DNS exfiltration attempt detected",
        lines: ["DNS query type TXT"],
        severity: "finding",
        evidence: [{ kind: "flow", id: 999 }],
        at_mono_nanos: 1000000000,
      },
    ]);

    const { result } = renderHook(() => useTimelineController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    expect(result.current.events.length).toBe(1);
    const event = result.current.events[0]!;
    expect(event.headline).toBe("Suspicious DNS Query");
    expect(event.summary).toBe("High volume DNS exfiltration attempt detected");
    expect(event.severity).toBe("finding");
    expect(event.evidence[0]?.id).toBe(999);
  });

  it("renders empty capture state when feed is empty without crashing or invalid selection", () => {
    setFeed([]);
    render(<TimelineTestWrapper />);

    expect(
      screen.getByText("No timeline events captured yet. Start a capture session to populate the timeline.")
    ).toBeInTheDocument();
  });

  it("renders summary KPIs, ribbon mark buttons, and event detail inspector when an event is clicked", async () => {
    setFeed([
      {
        headline: "TCP SYN Flood",
        summary: "SYN flood targeting port 80",
        lines: ["Handshake timeout"],
        severity: "finding",
        evidence: [{ kind: "flow", id: 101 }],
        at_mono_nanos: 1000000000,
      },
      {
        headline: "TLS Certificate Renewed",
        summary: "Let's Encrypt TLS cert renewed",
        lines: ["Valid until 2027"],
        severity: "neutral",
        evidence: [{ kind: "session", id: 202 }],
        at_mono_nanos: 2000000000,
      },
    ]);

    render(<TimelineTestWrapper />);

    // Check Summary KPIs
    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("Time Span")).toBeInTheDocument();

    // Check ribbon buttons
    const markButtons = screen.getAllByRole("button", { name: /^Event \d+:/i });
    expect(markButtons.length).toBe(2);

    // Verify mark button geometry contract: must NOT have inline transform style override
    expect(markButtons[0]?.style.transform).toBe("");

    // Select first event mark
    fireEvent.click(markButtons[0]!);

    // Inspector card appears
    expect(await screen.findByText("SYN flood targeting port 80")).toBeInTheDocument();
    expect(screen.getByText("flow #101")).toBeInTheDocument();
  });

  it("supports keyboard arrow navigation (ArrowRight / ArrowLeft / Home / End) across ribbon marks using aria-pressed", async () => {
    setFeed([
      {
        headline: "Event 1",
        summary: "Summary 1",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 1000,
      },
      {
        headline: "Event 2",
        summary: "Summary 2",
        lines: [],
        severity: "notable",
        evidence: [],
        at_mono_nanos: 2000,
      },
    ]);

    render(<TimelineTestWrapper />);

    const markButtons = screen.getAllByRole("button", { name: /^Event \d+:/i });
    const mark1 = markButtons[0]!;

    fireEvent.click(mark1);
    expect(mark1).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(mark1, { key: "ArrowRight" });
    expect(markButtons[1]!).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(markButtons[1]!, { key: "Home" });
    expect(mark1).toHaveAttribute("aria-pressed", "true");
  });

  it("filters events by search query and severity, rendering classified filter empty state when no match", async () => {
    setFeed([
      {
        headline: "DNS Exfiltration",
        summary: "High volume DNS TXT queries",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 1000,
      },
    ]);

    render(<TimelineTestWrapper />);

    const searchInput = screen.getByPlaceholderText("Search timeline events by headline, summary, packet ID...");
    fireEvent.change(searchInput, { target: { value: "nonexistent query" } });

    expect(
      await screen.findByText("No timeline events match the current search or severity filter.")
    ).toBeInTheDocument();

    const clearButton = screen.getAllByRole("button", { name: "Clear Timeline Filters" })[0]!;
    fireEvent.click(clearButton);

    const ribbonMark = await screen.findByRole("button", { name: /DNS Exfiltration/i });
    expect(ribbonMark).toBeInTheDocument();
    fireEvent.click(ribbonMark);
    expect(await screen.findByRole("heading", { name: "DNS Exfiltration" })).toBeInTheDocument();
  });

  it("deterministically auto-selects highest severity finding on initial load and disables Prev at index 0", async () => {
    setFeed([
      {
        headline: "Neutral Event",
        summary: "Normal ping",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1000,
      },
      {
        headline: "Critical Finding",
        summary: "Exfiltration detected",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 2000,
      },
    ]);

    render(<TimelineTestWrapper />);

    // Inspector automatically renders Critical Finding (index 1)
    expect(await screen.findByText("Exfiltration detected")).toBeInTheDocument();

    const prevButton = screen.getByRole("button", { name: /Previous event/i });
    fireEvent.click(prevButton);

    expect(await screen.findByText("Normal ping")).toBeInTheDocument();
    expect(prevButton).toBeDisabled();
  });

  it("supports deep searching inside event diagnostic lines", async () => {
    setFeed([
      {
        headline: "Encrypted Flow",
        summary: "Normal encrypted traffic",
        lines: ["Target host: secure.gateway.corp", "Port: 8443"],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1000,
      },
    ]);

    render(<TimelineTestWrapper />);

    const searchInput = screen.getByPlaceholderText("Search timeline events by headline, summary, packet ID...");
    fireEvent.change(searchInput, { target: { value: "secure.gateway.corp" } });

    expect(await screen.findByText("Encrypted Flow")).toBeInTheDocument();
  });

  it("toggles severity filter when clicking Summary KPI tiles", async () => {
    setFeed([
      {
        headline: "Finding 1",
        summary: "Suspicious packet",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 1000,
      },
      {
        headline: "Neutral 1",
        summary: "Normal packet",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 2000,
      },
    ]);

    render(<TimelineTestWrapper />);

    const findingsKpi = screen.getByRole("button", { name: /Findings: 1/i });
    fireEvent.click(findingsKpi);

    // Only Finding 1 should remain in ribbon
    expect(screen.getByRole("button", { name: /Finding 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Neutral 1/i })).not.toBeInTheDocument();

    // Clicking again resets filter to all
    fireEvent.click(findingsKpi);
    expect(screen.getByRole("button", { name: /Finding 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Neutral 1/i })).toBeInTheDocument();
  });

  it("handles copy diagnostic logs with visual feedback", async () => {
    setFeed([
      {
        headline: "Event with logs",
        summary: "Log details available",
        lines: ["line 1 output", "line 2 output"],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1000,
      },
    ]);

    render(<TimelineTestWrapper />);

    const copyButton = await screen.findByRole("button", { name: "Copy diagnostic logs" });
    fireEvent.click(copyButton);

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("navigates to target packet and highlights mark when dispatching { screen: 'timeline', packetId: 999 } with real NarrativeCard", async () => {
    const targetCard: NarrativeCard = {
      headline: "Suspicious DNS Tunnel Packet",
      summary: "Packet 999 triggered deep inspection alert",
      lines: ["Frame 999: 1420 bytes on wire", "DNS query length abnormal"],
      severity: "neutral",
      evidence: [{ kind: "packet", id: 999 }],
      at_mono_nanos: 2000000000,
    };
    const defaultFindingCard: NarrativeCard = {
      headline: "Critical Breach Detection",
      summary: "High severity finding without target packet",
      lines: ["Unauthorized exfiltration"],
      severity: "finding",
      evidence: [{ kind: "flow", id: 101 }],
      at_mono_nanos: 1000000000,
    };

    setFeed([defaultFindingCard, targetCard]);

    function NavigationDispatchHarness() {
      const { navigateToEvidence } = useEvidenceNavigation();
      return (
        <div>
          <button
            type="button"
            data-testid="dispatch-packet-target"
            onClick={() => navigateToEvidence({ kind: "packet", id: 999 })}
          >
            Dispatch Packet Target
          </button>
          <Timeline />
        </div>
      );
    }

    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <NavigationDispatchHarness />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    // Initial state before dispatch: finding card is auto-selected due to higher severity weight
    expect(screen.getByText("High severity finding without target packet")).toBeInTheDocument();

    // Dispatch { screen: "timeline", packetId: 999 }
    fireEvent.click(screen.getByTestId("dispatch-packet-target"));

    // Verify target mark in ribbon is highlighted
    const targetMark = await screen.findByRole("button", { name: /Suspicious DNS Tunnel Packet/i });
    expect(targetMark).toHaveAttribute("aria-pressed", "true");
    expect(targetMark).toHaveAttribute("data-highlighted", "true");
    expect(targetMark.className).toContain("np-ribbon__mark--highlighted");

    // Verify inspector displays target event
    expect(await screen.findByText("Packet 999 triggered deep inspection alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Suspicious DNS Tunnel Packet" })).toBeInTheDocument();
    expect(screen.getByText("packet #999")).toBeInTheDocument();
  });
});

describe("formatTimelineAxis Utility", () => {
  it("guarantees unique adjacent labels across 0s, 1s, 9s, 34s, 59s, 60s, 68s, 90s, 120s, and multi-minute spans", () => {
    const testSpansSec = [0, 1, 9, 34, 59, 60, 68, 90, 120, 300, 3600];

    for (const sec of testSpansSec) {
      const min = 1000000000;
      const max = min + sec * 1e9;
      const ticks = formatTimelineAxis(min, max);

      // Check right endpoint is 'now'
      expect(ticks[ticks.length - 1]?.label).toBe("now");

      // Check deduplication across all adjacent labels
      for (let i = 0; i < ticks.length - 1; i++) {
        expect(ticks[i]!.label).not.toBe(ticks[i + 1]!.label);
      }
    }
  });
});
