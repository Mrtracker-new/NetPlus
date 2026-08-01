import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Journey } from "../screens/Journey";
import { useJourneyController } from "../hooks/useJourneyController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { setFeed, __resetForTest } from "../state/store";
import * as ipc from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function JourneyTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Journey />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

const mockJourneyResponse = {
  kind: "pageJourney" as const,
  journey: {
    session_id: 101,
    stages: [
      {
        kind: "dns_resolution" as const,
        title: "DNS Resolution",
        narration: "Resolved google.com to 142.250.190.46 in 24ms",
        detail: "Expert detail: DNS query type A",
        evidence: [{ kind: "flow" as const, id: 501 }],
      },
      {
        kind: "connection" as const,
        title: "TCP Connection",
        narration: "Established TCP 3-way handshake in 38ms",
        detail: "Expert detail: SYN/ACK confirmed",
        evidence: [{ kind: "session" as const, id: 101 }],
      },
    ],
    fanout: [
      {
        label: "static.cloudflare.com",
        flows: 4,
        bytes: 1048576,
        evidence: [{ kind: "flow" as const, id: 601 }],
      },
      {
        label: "fonts.gstatic.com",
        flows: 2,
        bytes: 524288,
        evidence: [{ kind: "flow" as const, id: 602 }],
      },
    ],
  },
};

describe("Journey Screen & useJourneyController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("controller hook extracts sessions from store feed evidence", () => {
    setFeed([
      {
        headline: "google.com session started",
        summary: "Navigated to google.com",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "session", id: 101 }],
        at_mono_nanos: 1000,
      },
    ]);

    const { result } = renderHook(() => useJourneyController(), {
      wrapper: ({ children }) => (
        <DisclosureProvider>
          <EvidenceNavigationProvider>{children}</EvidenceNavigationProvider>
        </DisclosureProvider>
      ),
    });

    expect(result.current.sessions.length).toBe(1);
    expect(result.current.sessions[0]?.id).toBe(101);
  });

  it("renders empty state when no journey has been captured yet", async () => {
    render(<JourneyTestWrapper />);

    await waitFor(() => {
      expect(
        screen.getByText("No journey has been captured yet. Run a capture to reconstruct the page-load timeline.")
      ).toBeInTheDocument();
    });
  });

  it("renders populated journey stages, summary metrics, and collapsible provider groups", async () => {
    vi.spyOn(ipc, "query").mockResolvedValue(mockJourneyResponse);

    setFeed([
      {
        headline: "google.com session",
        summary: "Loaded page",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "session", id: 101 }],
        at_mono_nanos: 1000,
      },
    ]);

    render(<JourneyTestWrapper />);

    // Check Summary Metrics
    expect(await screen.findByText("Journey Summary")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("TTFB")).toBeInTheDocument();

    // Check Stage Titles & Narration
    expect(screen.getAllByText("DNS Resolution").length).toBeGreaterThan(0);
    expect(screen.getByText("Resolved google.com to 142.250.190.46 in 24ms")).toBeInTheDocument();

    // Check Collapsible Fanout Provider Group
    const cloudflareGroup = screen.getByText(/cloudflare.com/i);
    expect(cloudflareGroup).toBeInTheDocument();

    // Expand Cloudflare group
    fireEvent.click(cloudflareGroup);
    expect(await screen.findByText("static.cloudflare.com")).toBeInTheDocument();
  });

  it("supports keyboard navigation (Enter/Space) to select journey stages", async () => {
    vi.spyOn(ipc, "query").mockResolvedValue(mockJourneyResponse);

    setFeed([
      {
        headline: "google.com session",
        summary: "Loaded page",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "session", id: 101 }],
        at_mono_nanos: 1000,
      },
    ]);

    render(<JourneyTestWrapper />);

    const stageTabs = await screen.findAllByRole("tab", { name: /Stage 1: DNS Resolution/i });
    const stageTab = stageTabs[0]!;
    expect(stageTab).toBeInTheDocument();
    expect(stageTab).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(stageTab, { key: "Enter" });
    expect(stageTab).toHaveAttribute("aria-selected", "true");
  });

  it("supports searching and selecting sessions from dropdown picker", async () => {
    vi.spyOn(ipc, "query").mockResolvedValue(mockJourneyResponse);

    setFeed([
      {
        headline: "google.com session",
        summary: "Loaded page",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "session", id: 101 }],
        at_mono_nanos: 1000,
      },
      {
        headline: "github.com session",
        summary: "Loaded page",
        lines: [],
        severity: "neutral",
        evidence: [{ kind: "session", id: 102 }],
        at_mono_nanos: 2000,
      },
    ]);

    render(<JourneyTestWrapper />);

    const searchInput = await screen.findByPlaceholderText("Search sessions by domain or ID...");
    fireEvent.change(searchInput, { target: { value: "github" } });

    const select = screen.getByRole("combobox", { name: "Select Session:" });
    fireEvent.change(select, { target: { value: "102" } });

    await waitFor(() => {
      expect(ipc.query).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "journeyStagesOfSession", session_id: 102 })
      );
    });
  });
});
