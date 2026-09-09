import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { NarrativeCard } from "@netpulse/contract";
import "../i18n";
import { Timeline } from "../screens/Timeline";
import { useTimelineController } from "../hooks/useTimelineController";
import { formatTimelineAxis } from "../utils/timeline.utils";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { setFeed, pushCards, __resetForTest } from "../state/store";
import {
  TimelineInspector,
  formatRelativeTime,
  formatWallTimeClock,
  resolveCategory,
} from "../screens/Timeline/TimelineInspector";
import type { TimelineEvent } from "../utils/timeline.utils";

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
    expect(screen.getByText("Neutral Events")).toBeInTheDocument();

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
    const findingBadge = screen.getByText("finding");
    expect(findingBadge).toHaveAttribute("data-sev", "finding");
    expect(findingBadge).toHaveClass("np-timeline-inspector__badge--finding");
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

    // Clicking Neutral Events KPI tile filters to neutral events only
    const neutralKpi = screen.getByRole("button", { name: /Neutral Events: 1/i });
    fireEvent.click(neutralKpi);
    expect(screen.queryByRole("button", { name: /Finding 1/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Neutral 1/i })).toBeInTheDocument();

    // Clicking again resets filter to all
    fireEvent.click(neutralKpi);
    expect(screen.getByRole("button", { name: /Finding 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Neutral 1/i })).toBeInTheDocument();
  });

  it("handles copy diagnostic logs with visual feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

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
    expect(writeTextMock).toHaveBeenCalledWith("line 1 output\nline 2 output");
  });

  it("does not report 'Copied!' when clipboard copy fails or throws in handleCopyLogs", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"));
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

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

    await vi.waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
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

  it("sorts events chronologically (at_mono_nanos ascending) and ArrowRight advances toward newer events (NET-UX-002)", async () => {
    // Reverse-chronological feed input (newest first)
    const newestCard: NarrativeCard = {
      headline: "Newest Event",
      summary: "Happened at t=3000",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 3000000000,
    };
    const middleCard: NarrativeCard = {
      headline: "Middle Event",
      summary: "Happened at t=2000",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 2000000000,
    };
    const oldestCard: NarrativeCard = {
      headline: "Oldest Event",
      summary: "Happened at t=1000",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 1000000000,
    };

    // Feed in reverse chronological order
    setFeed([newestCard, middleCard, oldestCard]);

    // 1. Controller hook assertion: events are sorted chronologically
    const { result } = renderHook(() => useTimelineController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    expect(result.current.events[0]!.at <= result.current.events[result.current.events.length - 1]!.at).toBe(true);
    expect(result.current.events[0]!.at).toBe(1000000000);
    expect(result.current.events[0]!.headline).toBe("Oldest Event");
    expect(result.current.events[1]!.at).toBe(2000000000);
    expect(result.current.events[1]!.headline).toBe("Middle Event");
    expect(result.current.events[2]!.at).toBe(3000000000);
    expect(result.current.events[2]!.headline).toBe("Newest Event");

    // 2. Screen UI assertion: ArrowRight advances toward newer events
    render(<TimelineTestWrapper />);

    const markButtons = screen.getAllByRole("button", { name: /^Event \d+:/i });
    expect(markButtons.length).toBe(3);

    // Click oldest event mark (index 0)
    fireEvent.click(markButtons[0]!);
    expect(markButtons[0]!).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "Oldest Event" })).toBeInTheDocument();

    // ArrowRight advances to newer event (index 1)
    fireEvent.keyDown(markButtons[0]!, { key: "ArrowRight" });
    expect(markButtons[1]!).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "Middle Event" })).toBeInTheDocument();

    // ArrowRight advances to newest event (index 2)
    fireEvent.keyDown(markButtons[1]!, { key: "ArrowRight" });
    expect(markButtons[2]!).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "Newest Event" })).toBeInTheDocument();

    // Inspector stepper: Prev moves back toward earlier events
    const prevButton = screen.getByRole("button", { name: /Previous event/i });
    fireEvent.click(prevButton);
    expect(await screen.findByRole("heading", { name: "Middle Event" })).toBeInTheDocument();
  });

  it("synchronizes mark positions and time axis domain when severity filter is active (NET-DATA-003)", async () => {
    // Session events spanning from 1s to 31s
    const earlyNeutral: NarrativeCard = {
      headline: "Early Ping",
      summary: "Normal ping at 1s",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 1_000_000_000,
    };
    const firstFinding: NarrativeCard = {
      headline: "Port Scan Started",
      summary: "Port scan detected at 11s",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 11_000_000_000,
    };
    const midFinding: NarrativeCard = {
      headline: "Brute Force Burst",
      summary: "Brute force attempts at 16s",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 16_000_000_000,
    };
    const lastFinding: NarrativeCard = {
      headline: "Exfiltration Alert",
      summary: "High volume egress at 21s",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 21_000_000_000,
    };
    const lateNeutral: NarrativeCard = {
      headline: "Late Ping",
      summary: "Normal ping at 31s",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 31_000_000_000,
    };

    setFeed([earlyNeutral, firstFinding, midFinding, lastFinding, lateNeutral]);

    render(<TimelineTestWrapper />);

    // Activate Findings severity filter by clicking Findings KPI button
    const findingsKpi = screen.getByRole("button", { name: /Findings: 3/i });
    fireEvent.click(findingsKpi);

    // Filtered marks in ribbon
    const finding1Mark = screen.getByRole("button", { name: /Port Scan Started/i });
    const midMark = screen.getByRole("button", { name: /Brute Force Burst/i });
    const finding2Mark = screen.getByRole("button", { name: /Exfiltration Alert/i });

    // Mark positions must match the active timeDomain (11s to 21s, span = 10s)
    // 11s is min -> clamped to 2%
    // 16s is midpoint -> 50%
    // 21s is max -> clamped to 98%
    expect(finding1Mark.style.left).toBe("2%");
    expect(midMark.style.left).toBe("50%");
    expect(finding2Mark.style.left).toBe("98%");

    // Verify axis ticks match the active domain (11s to 21s = 10s span):
    // Start tick at 2% is -10s
    // Mid tick at 50% is -5s
    // End tick at 98% is now
    expect(screen.getByText("-10s")).toBeInTheDocument();
    expect(screen.getByText("-5s")).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("preserves stable entity-key selection across live feed delta updates (NET-UX-004)", async () => {
    const cardA: NarrativeCard = {
      headline: "Card A DNS Query",
      summary: "DNS query at 1000",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 1_000_000_000,
    };
    const cardB: NarrativeCard = {
      headline: "Card B SYN Flood",
      summary: "SYN flood at 2000",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 2_000_000_000,
    };

    setFeed([cardA, cardB]);

    // 1. Test controller hook stability
    const { result } = renderHook(() => useTimelineController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    // Explicitly select Card A (index 0, key: 1000000000-Card A DNS Query)
    act(() => {
      result.current.actions.selectEvent(result.current.events[0]!, 0);
    });

    expect(result.current.selectedEventKey).toBe("1000000000-Card A DNS Query");
    expect(result.current.selectedEventIndex).toBe(0);
    expect(result.current.selectedEvent?.headline).toBe("Card A DNS Query");

    // Live delta arrives with a new earlier event (prepending at index 0)
    const cardPrepend: NarrativeCard = {
      headline: "Card Prepend Earlier",
      summary: "Earlier event at 500",
      lines: [],
      severity: "notable",
      evidence: [],
      at_mono_nanos: 500_000_000,
    };

    act(() => {
      pushCards([cardPrepend]);
    });

    // Card A is now at index 1 in chronological filteredEvents, but selection must remain on Card A!
    expect(result.current.selectedEventKey).toBe("1000000000-Card A DNS Query");
    expect(result.current.selectedEventIndex).toBe(1);
    expect(result.current.selectedEvent?.headline).toBe("Card A DNS Query");

    // If Card A is removed or not found, defaults to highest-severity event (Card B, finding)
    act(() => {
      setFeed([cardPrepend, cardB]);
    });

    expect(result.current.selectedEventIndex).toBe(1); // Card B is at index 1
    expect(result.current.selectedEvent?.headline).toBe("Card B SYN Flood");
  });

  it("maintains selected event mark and inspector card across live updates in Timeline UI (NET-UX-004)", async () => {
    const cardA: NarrativeCard = {
      headline: "Session Handshake",
      summary: "TLS handshake at 1s",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 1_000_000_000,
    };
    const cardB: NarrativeCard = {
      headline: "Keepalive Ping",
      summary: "Periodic keepalive at 2s",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 2_000_000_000,
    };

    setFeed([cardA, cardB]);

    render(<TimelineTestWrapper />);

    // Click Card B mark
    const cardBMark = screen.getByRole("button", { name: /Keepalive Ping/i });
    fireEvent.click(cardBMark);

    expect(cardBMark).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "Keepalive Ping" })).toBeInTheDocument();

    // Ingest new live card with earlier timestamp
    const cardEarlier: NarrativeCard = {
      headline: "ARP Resolution",
      summary: "Initial ARP broadcast at 0.5s",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 500_000_000,
    };

    act(() => {
      pushCards([cardEarlier]);
    });

    // Card B mark must remain selected and inspector must still show Keepalive Ping
    const updatedCardBMark = screen.getByRole("button", { name: /Keepalive Ping/i });
    expect(updatedCardBMark).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Keepalive Ping" })).toBeInTheDocument();
    expect(screen.getByText("Periodic keepalive at 2s")).toBeInTheDocument();
  });

  it("announces filter result counts on search or severity change in useTimelineController hook without announcing on mount", () => {
    setFeed([
      {
        headline: "DNS Tunneling Detected",
        summary: "High volume TXT queries",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 1_000_000_000,
      },
      {
        headline: "Normal TLS Session",
        summary: "TLS 1.3 handshake",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 2_000_000_000,
      },
    ]);

    const { result } = renderHook(() => useTimelineController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    // Does not announce on initial mount
    expect(result.current.announcement).toBe("");

    // Search query change
    act(() => {
      result.current.actions.setSearchQuery("DNS");
    });
    expect(result.current.announcement).toBe("Showing 1 of 2 events.");

    // Search query with no match
    act(() => {
      result.current.actions.setSearchQuery("nonexistent query");
    });
    expect(result.current.announcement).toBe("Showing 0 of 2 events.");

    // Clearing search manually
    act(() => {
      result.current.actions.setSearchQuery("");
    });
    expect(result.current.announcement).toBe("Showing 2 of 2 events.");

    // Severity filter change
    act(() => {
      result.current.actions.setSeverityFilter("finding");
    });
    expect(result.current.announcement).toBe("Showing 1 of 2 events.");

    // Severity filter with no match
    act(() => {
      result.current.actions.setSeverityFilter("notable");
    });
    expect(result.current.announcement).toBe("Showing 0 of 2 events.");

    // Clear filters preserves "Filters cleared."
    act(() => {
      result.current.actions.clearFilters();
    });
    expect(result.current.announcement).toBe("Filters cleared.");
  });

  it("announces filter result counts in aria-live region on user search and severity selection in UI", async () => {
    setFeed([
      {
        headline: "TCP Port Scan",
        summary: "Sequential SYN probes",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 1_000_000_000,
      },
      {
        headline: "HTTP Keepalive",
        summary: "Idle keepalive",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 2_000_000_000,
      },
    ]);

    const { container } = render(<TimelineTestWrapper />);
    const liveRegion = container.querySelector(".np-sr-only[aria-live='polite']");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent("");

    // Type in search box
    const searchInput = screen.getByPlaceholderText("Search timeline events by headline, summary, packet ID...");
    fireEvent.change(searchInput, { target: { value: "TCP" } });

    expect(liveRegion).toHaveTextContent("Showing 1 of 2 events.");

    // Toggle severity via KPI button
    const findingsKpi = screen.getByRole("button", { name: /Findings: 1/i });
    fireEvent.click(findingsKpi);

    expect(liveRegion).toHaveTextContent("Showing 1 of 2 events.");

    // Clear filters via button
    const clearButton = screen.getAllByRole("button", { name: "Clear Timeline Filters" })[0]!;
    fireEvent.click(clearButton);

    expect(liveRegion).toHaveTextContent("Filters cleared.");
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

  it("parameterizes now label with custom string or options object", () => {
    const min = 1_000_000_000;
    const max = min + 45 * 1e9;

    // String parameter
    const stringTicks = formatTimelineAxis(min, max, "+45s");
    expect(stringTicks[stringTicks.length - 1]?.label).toBe("+45s");
    expect(stringTicks[stringTicks.length - 1]?.positionPercent).toBe(98);
    for (let i = 0; i < stringTicks.length - 1; i++) {
      expect(stringTicks[i]!.label).not.toBe(stringTicks[i + 1]!.label);
    }

    // Options object with nowLabel
    const nowLabelTicks = formatTimelineAxis(min, max, { nowLabel: "End" });
    expect(nowLabelTicks[nowLabelTicks.length - 1]?.label).toBe("End");

    // Options object with endLabel
    const endLabelTicks = formatTimelineAxis(min, max, { endLabel: "+10s" });
    expect(endLabelTicks[endLabelTicks.length - 1]?.label).toBe("+10s");

    // "0s" end label avoids collision with start label
    const zeroTicks = formatTimelineAxis(min, min, "0s");
    expect(zeroTicks[0]?.label).toBe("-0s");
    expect(zeroTicks[1]?.label).toBe("0s");
  });

  it("parameterizes historical captures with isHistorical option showing actual elapsed offsets", () => {
    const min = 1_000_000_000;

    // Zero elapsed span
    const zeroTicks = formatTimelineAxis(min, min, { isHistorical: true });
    expect(zeroTicks[zeroTicks.length - 1]?.label).toBe("0s");
    expect(zeroTicks[0]?.label).toBe("-0s");

    // Sub-second span (500ms)
    const subSecTicks = formatTimelineAxis(min, min + 500_000_000, { isHistorical: true });
    expect(subSecTicks[subSecTicks.length - 1]?.label).toBe("+0.5s");

    // 15 seconds elapsed
    const secTicks = formatTimelineAxis(min, min + 15 * 1e9, { isHistorical: true });
    expect(secTicks[secTicks.length - 1]?.label).toBe("+15s");

    // 75 seconds elapsed (1m 15s)
    const minTicks = formatTimelineAxis(min, min + 75 * 1e9, { isHistorical: true });
    expect(minTicks[minTicks.length - 1]?.label).toBe("+1m 15s");

    // Check adjacent deduplication across various spans in historical mode
    const spans = [0, 0.5, 1, 2, 10, 30, 60, 90, 180, 3600];
    for (const span of spans) {
      const ticks = formatTimelineAxis(min, min + span * 1e9, { isHistorical: true });
      for (let i = 0; i < ticks.length - 1; i++) {
        expect(ticks[i]!.label).not.toBe(ticks[i + 1]!.label);
      }
    }
  });

  it("useTimelineController forwards nowLabel and isHistorical options to axisTicks", () => {
    setFeed([
      {
        headline: "Start Event",
        summary: "First packet in capture",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1_000_000_000,
      },
      {
        headline: "End Event",
        summary: "Last packet in capture",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 16_000_000_000,
      },
    ]);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
    );

    // Custom nowLabel
    const { result: customResult } = renderHook(
      () => useTimelineController({ nowLabel: "+15s" }),
      { wrapper }
    );
    const customTicks = customResult.current.axisTicks;
    expect(customTicks[customTicks.length - 1]?.label).toBe("+15s");

    // Historical capture option
    const { result: historicalResult } = renderHook(
      () => useTimelineController({ isHistorical: true }),
      { wrapper }
    );
    const historicalTicks = historicalResult.current.axisTicks;
    expect(historicalTicks[historicalTicks.length - 1]?.label).toBe("+15s");
  });

  it("Timeline component renders custom nowLabel and historical elapsed offsets", () => {
    setFeed([
      {
        headline: "Event A",
        summary: "Summary A",
        lines: [],
        severity: "neutral",
        evidence: [],
        at_mono_nanos: 1_000_000_000,
      },
      {
        headline: "Event B",
        summary: "Summary B",
        lines: [],
        severity: "finding",
        evidence: [],
        at_mono_nanos: 16_000_000_000,
      },
    ]);

    // Historical mode renders +15s offset
    const { unmount } = render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <Timeline isHistorical />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    expect(screen.getByText("+15s")).toBeInTheDocument();
    unmount();

    // Explicit custom label renders custom label
    render(
      <DisclosureProvider>
        <EvidenceNavigationProvider>
          <Timeline nowLabel="Finished" />
        </EvidenceNavigationProvider>
      </DisclosureProvider>
    );

    expect(screen.getByText("Finished")).toBeInTheDocument();
  });
});

describe("TimelineInspector Metadata Header", () => {
  it("renders relative elapsed time (e.g. T +14.2s), category badge (Security), and protocol tag (TLS 1.3) above summary", () => {
    const event: TimelineEvent = {
      headline: "Suspicious TLS Handshake",
      summary: "Unusual cipher suite negotiated during connection setup",
      lines: ["Cipher: TLS_NULL_WITH_NULL_NULL"],
      severity: "finding",
      category: "security",
      protocol: "TLS 1.3",
      evidence: [{ kind: "flow", id: 501 }],
      at_mono_nanos: 14_200_000_000,
      at: 14_200_000_000,
      label: "Suspicious TLS Handshake",
      lane: "finding",
    };

    render(
      <TimelineInspector
        event={event}
        currentIndex={0}
        totalCount={1}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNavigateEvidence={vi.fn()}
      />
    );

    // Relative elapsed time formatted as T +14.2s
    expect(screen.getByText("T +14.2s")).toBeInTheDocument();

    // Category badge displaying Security
    expect(screen.getByText("Security")).toBeInTheDocument();

    // Protocol tag displaying TLS 1.3
    expect(screen.getByText("TLS 1.3")).toBeInTheDocument();

    // Summary narrative rendered below metadata header
    expect(
      screen.getByText("Unusual cipher suite negotiated during connection setup")
    ).toBeInTheDocument();
  });

  it("renders Category badges correctly for DNS and Network, and protocol tag for HTTP/2", () => {
    const dnsEvent: TimelineEvent = {
      headline: "DNS A Record Query",
      summary: "Query for api.internal.corp",
      lines: [],
      severity: "neutral",
      category: "dns",
      protocol: "UDP",
      evidence: [],
      at_mono_nanos: 1_500_000_000,
      at: 1_500_000_000,
      label: "DNS A Record Query",
      lane: "neutral",
    };

    const { unmount } = render(
      <TimelineInspector
        event={dnsEvent}
        currentIndex={0}
        totalCount={2}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNavigateEvidence={vi.fn()}
      />
    );

    expect(screen.getByText("T +1.5s")).toBeInTheDocument();
    expect(screen.getByText("DNS")).toBeInTheDocument();
    unmount();

    const networkEvent: TimelineEvent = {
      headline: "HTTP Stream Multiplexing",
      summary: "Multiplexed stream opened on connection #4",
      lines: [],
      severity: "notable",
      category: "network",
      protocol: "HTTP/2",
      evidence: [],
      at_mono_nanos: 25_000_000_000,
      at: 25_000_000_000,
      label: "HTTP Stream Multiplexing",
      lane: "notable",
    };

    render(
      <TimelineInspector
        event={networkEvent}
        currentIndex={1}
        totalCount={2}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNavigateEvidence={vi.fn()}
      />
    );

    expect(screen.getByText("T +25.0s")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("HTTP/2")).toBeInTheDocument();
  });

  it("omits protocol tag when protocol is not present", () => {
    const noProtoEvent: TimelineEvent = {
      headline: "Raw Gateway Activity",
      summary: "Gateway router ping without protocol tag",
      lines: [],
      severity: "neutral",
      category: "network",
      evidence: [],
      at_mono_nanos: 10_000_000_000,
      at: 10_000_000_000,
      label: "Raw Gateway Activity",
      lane: "neutral",
    };

    const { container } = render(
      <TimelineInspector
        event={noProtoEvent}
        currentIndex={0}
        totalCount={1}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNavigateEvidence={vi.fn()}
      />
    );

    expect(screen.getByText("T +10.0s")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(
      container.querySelector(".np-timeline-inspector__protocol-tag")
    ).not.toBeInTheDocument();
  });

  it("renders wall time clock and clock icon in the inspector metadata bar", () => {
    const eventWithWallTime: TimelineEvent = {
      headline: "Timestamped Event",
      summary: "Event with explicit wall time",
      lines: [],
      severity: "neutral",
      category: "general",
      evidence: [],
      at_mono_nanos: 14_200_000_000,
      at: 14_200_000_000,
      label: "Timestamped Event",
      lane: "neutral",
      ...({ wall_time: "14:32:05" } as any),
    };

    render(
      <TimelineInspector
        event={eventWithWallTime}
        currentIndex={0}
        totalCount={1}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onNavigateEvidence={vi.fn()}
      />
    );

    expect(screen.getByText("14:32:05")).toBeInTheDocument();
    expect(screen.getByText("T +14.2s")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("correctly calculates formatRelativeTime, formatWallTimeClock, and resolveCategory utilities", () => {
    const ev14s: TimelineEvent = {
      headline: "Test Event",
      summary: "Test",
      lines: [],
      severity: "neutral",
      evidence: [],
      at_mono_nanos: 14_200_000_000,
      at: 14_200_000_000,
      label: "Test",
      lane: "neutral",
    };
    expect(formatRelativeTime(ev14s)).toBe("T +14.2s");

    const ev0s: TimelineEvent = {
      ...ev14s,
      at_mono_nanos: 0,
      at: 0,
    };
    expect(formatRelativeTime(ev0s)).toBe("T +0.0s");

    // Float seconds support (e.g. 14.2 passed directly)
    const evFloat: TimelineEvent = {
      ...ev14s,
      at_mono_nanos: 14.2,
      at: 14.2,
    };
    expect(formatRelativeTime(evFloat)).toBe("T +14.2s");

    // resolveCategory checks
    expect(resolveCategory({ ...ev14s, category: "security" }).label).toBe("Security");
    expect(resolveCategory({ ...ev14s, category: "dns" }).label).toBe("DNS");
    expect(resolveCategory({ ...ev14s, category: "network" }).label).toBe("Network");
    expect(resolveCategory({ ...ev14s, category: "tls" }).label).toBe("TLS");
    expect(resolveCategory({ ...ev14s, category: "performance" }).label).toBe("Performance");

    // Fallback checks when category is absent
    expect(resolveCategory({ ...ev14s, category: undefined, severity: "finding" }).label).toBe("Security");
    expect(resolveCategory({ ...ev14s, category: undefined, headline: "DNS Lookup Failure" }).label).toBe("DNS");
    expect(resolveCategory({ ...ev14s, category: undefined, protocol: "TLS 1.3" }).label).toBe("TLS");

    // formatWallTimeClock explicit string
    expect(formatWallTimeClock({ ...ev14s, ...({ wall_time: "12:00:00" } as any) })).toBe("12:00:00");
  });

  it("renders stepper controls with np-timeline-inspector__btn-stepper class and correct accessibility", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onNavigateEvidence = vi.fn();
    const testEvent: TimelineEvent = {
      headline: "Sample Event",
      summary: "Sample Event Summary",
      lines: [],
      severity: "finding",
      evidence: [],
      at_mono_nanos: 1_000_000_000,
      lane: "finding",
      at: 1_000_000_000,
      label: "Sample Event",
    };

    const { rerender } = render(
      <TimelineInspector
        event={testEvent}
        currentIndex={1}
        totalCount={3}
        onPrev={onPrev}
        onNext={onNext}
        onNavigateEvidence={onNavigateEvidence}
      />
    );

    const prevBtn = screen.getByRole("button", { name: /Previous event \(1 of 3\)/i });
    const nextBtn = screen.getByRole("button", { name: /Next event \(3 of 3\)/i });

    expect(prevBtn).toHaveClass("np-timeline-inspector__btn-stepper");
    expect(nextBtn).toHaveClass("np-timeline-inspector__btn-stepper");
    expect(prevBtn).not.toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    fireEvent.click(prevBtn);
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(nextBtn);
    expect(onNext).toHaveBeenCalledTimes(1);

    // Test first boundary (index 0 disables prev)
    rerender(
      <TimelineInspector
        event={testEvent}
        currentIndex={0}
        totalCount={3}
        onPrev={onPrev}
        onNext={onNext}
        onNavigateEvidence={onNavigateEvidence}
      />
    );
    expect(screen.getByRole("button", { name: /Previous event/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next event/i })).not.toBeDisabled();

    // Test last boundary (index totalCount - 1 disables next)
    rerender(
      <TimelineInspector
        event={testEvent}
        currentIndex={2}
        totalCount={3}
        onPrev={onPrev}
        onNext={onNext}
        onNavigateEvidence={onNavigateEvidence}
      />
    );
    expect(screen.getByRole("button", { name: /Previous event/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Next event/i })).toBeDisabled();
  });
});

