import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { SessionDiffScreen } from "../screens/SessionDiff";
import { parseSessionId, computeDirectionalDiff } from "../hooks/useCompareController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function CompareTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <SessionDiffScreen />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("SessionDiffScreen & useCompareController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("parseSessionId parses string input into positive integers", () => {
    expect(parseSessionId("5")).toBe(5);
    expect(parseSessionId("-2")).toBe(0);
    expect(parseSessionId("invalid")).toBe(0);
  });

  it("computeDirectionalDiff calculates correct directional deltas and reverses protocol shifts when swapped", () => {
    // Session 1 -> Session 2
    const forward = computeDirectionalDiff(1, 2, -38.4, -22.0, "HTTP/1.1 (TCP) → HTTP/3 (QUIC)");
    expect(forward.rttDeltaMs).toBe(-38.4);
    expect(forward.protocolShift).toBe("HTTP/1.1 (TCP) → HTTP/3 (QUIC)");
    expect(forward.semanticExplanation).toContain("Performance improved significantly in Session 2 compared to Session 1");
    expect(forward.semanticExplanation).toContain("decreased by 38.4 ms");

    // Session 2 -> Session 1 (Swapped!)
    const reverse = computeDirectionalDiff(2, 1, -38.4, -22.0, "HTTP/1.1 (TCP) → HTTP/3 (QUIC)");
    expect(reverse.rttDeltaMs).toBe(38.4);
    expect(reverse.protocolShift).toBe("HTTP/3 (QUIC) → HTTP/1.1 (TCP)");
    expect(reverse.semanticExplanation).toContain("Performance regressed in Session 1 compared to Session 2");
    expect(reverse.semanticExplanation).toContain("increased by 38.4 ms");
  });

  it("renders empty state guide when no comparison has been run", () => {
    render(<CompareTestWrapper />);

    expect(
      screen.getByText("Select two capture sessions to generate a diff report.")
    ).toBeInTheDocument();
  });

  it("runs cross-session comparison via IPC query and renders scorecards and evidence", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "sessionDiff",
      diff: {
        sessionIdA: 1,
        sessionIdB: 2,
        rttDeltaMs: -38.4,
        ttfbDeltaMs: -22.0,
        protocolShift: "HTTP/1.1 (TCP) → HTTP/3 (QUIC)",
        confidence: "High",
        semanticExplanation: "",
        evidence: ["Session #1 TLS Handshake: 12ms", "Session #2 TLS Handshake: 34ms"],
      },
    } as any);

    render(<CompareTestWrapper />);

    const compareBtn = screen.getByRole("button", { name: "Compare Sessions" });
    fireEvent.click(compareBtn);

    expect(await screen.findByText("Comparison Report (Session #1 vs #2)")).toBeInTheDocument();
    expect(screen.getByText("-38.4 ms")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("Performance improved significantly in Session 2 compared to Session 1. Round-trip latency decreased by 38.4 ms (HTTP/1.1 (TCP) → HTTP/3 (QUIC)).")).toBeInTheDocument();
  });

  it("swaps baseline and target session inputs when Swap button is clicked and updates directional report", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "sessionDiff",
      diff: {
        sessionIdA: 1,
        sessionIdB: 2,
        rttDeltaMs: -38.4,
        ttfbDeltaMs: -22.0,
        protocolShift: "HTTP/1.1 (TCP) → HTTP/3 (QUIC)",
        confidence: "High",
        semanticExplanation: "",
        evidence: [],
      },
    } as any);

    render(<CompareTestWrapper />);

    const compareBtn = screen.getByRole("button", { name: "Compare Sessions" });
    fireEvent.click(compareBtn);

    expect(await screen.findByText("Comparison Report (Session #1 vs #2)")).toBeInTheDocument();

    const swapBtn = screen.getByRole("button", { name: "⇄ Swap Sessions" });
    fireEvent.click(swapBtn);

    // After swap, Baseline = 2, Target = 1, Report should show regression
    expect(await screen.findByText("Comparison Report (Session #2 vs #1)")).toBeInTheDocument();
    expect(screen.getByText("+38.4 ms")).toBeInTheDocument();
    expect(screen.getByText("Performance regressed in Session 1 compared to Session 2. Round-trip latency increased by 38.4 ms (HTTP/3 (QUIC) → HTTP/1.1 (TCP)).")).toBeInTheDocument();
  });

  it("shows validation notice when identical session IDs are submitted", async () => {
    render(<CompareTestWrapper />);

    const targetInput = screen.getByPlaceholderText("Comparison Session ID (e.g. 2)");
    fireEvent.change(targetInput, { target: { value: "1" } });

    const compareBtn = screen.getByRole("button", { name: "Compare Sessions" });
    fireEvent.click(compareBtn);

    expect(
      await screen.findByText("Select two different session IDs to compare.")
    ).toBeInTheDocument();
  });
});
