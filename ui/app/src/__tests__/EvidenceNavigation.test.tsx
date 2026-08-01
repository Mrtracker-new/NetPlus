import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EvidenceNavigationProvider, useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { EvidenceChips } from "@netpulse/components";
import type { EvidenceRef } from "@netpulse/contract";

afterEach(() => {
  cleanup();
});

describe("EvidenceNavigationContext", () => {
  it("updates navigation target cleanly as a single discriminated union", () => {
    const { result } = renderHook(() => useEvidenceNavigation(), {
      wrapper: EvidenceNavigationProvider,
    });

    expect(result.current.screen).toBe("dashboard");
    expect(result.current.navigationTarget).toBeNull();

    // Navigate to flow
    act(() => {
      result.current.navigateToEvidence({ kind: "flow", id: 101 });
    });
    expect(result.current.screen).toBe("apps");
    expect(result.current.navigationTarget).toEqual({ screen: "apps", flowId: 101 });

    // Navigate to session (replaces flow, no co-existing targets)
    act(() => {
      result.current.navigateToEvidence({ kind: "session", id: 202 });
    });
    expect(result.current.screen).toBe("journey");
    expect(result.current.navigationTarget).toEqual({ screen: "journey", sessionId: 202 });

    // Navigate to packet
    act(() => {
      result.current.navigateToEvidence({ kind: "packet", id: 303 });
    });
    expect(result.current.screen).toBe("timeline");
    expect(result.current.navigationTarget).toEqual({ screen: "timeline", packetId: 303 });

    // Clear navigation target
    act(() => {
      result.current.clearNavigationTarget();
    });
    expect(result.current.navigationTarget).toBeNull();
  });
});

function TestHarness() {
  const { screen: activeScreen, navigationTarget, navigateToEvidence, clearNavigationTarget } =
    useEvidenceNavigation();

  const sampleEvidence: EvidenceRef[] = [
    { kind: "flow", id: 55 },
    { kind: "session", id: 77 },
    { kind: "packet", id: 99 },
  ];

  return (
    <div>
      <div data-testid="current-screen">{activeScreen}</div>
      <div data-testid="target-json">{JSON.stringify(navigationTarget)}</div>

      <EvidenceChips evidence={sampleEvidence} onNavigate={navigateToEvidence} />

      {activeScreen === "apps" && navigationTarget?.screen === "apps" && (
        <div>
          <span>Filtered to flow #{navigationTarget.flowId}</span>
          <button onClick={clearNavigationTarget}>Show all flows</button>
        </div>
      )}
    </div>
  );
}

describe("EvidenceNavigation Component Integration", () => {
  it("switches screens and passes target state when evidence chips are clicked", () => {
    render(
      <EvidenceNavigationProvider>
        <TestHarness />
      </EvidenceNavigationProvider>
    );

    expect(screen.getByTestId("current-screen")).toHaveTextContent("dashboard");

    // 1. Click flow chip
    const flowChip = screen.getByRole("button", { name: /flow #55/i });
    fireEvent.click(flowChip);

    expect(screen.getByTestId("current-screen")).toHaveTextContent("apps");
    expect(screen.getByTestId("target-json")).toHaveTextContent(
      JSON.stringify({ screen: "apps", flowId: 55 })
    );
    expect(screen.getByText("Filtered to flow #55")).toBeInTheDocument();

    // Reset filter
    const clearBtn = screen.getByRole("button", { name: /show all flows/i });
    fireEvent.click(clearBtn);
    expect(screen.getByTestId("target-json")).toHaveTextContent("null");

    // 2. Click session chip
    const sessionChip = screen.getByRole("button", { name: /session #77/i });
    fireEvent.click(sessionChip);

    expect(screen.getByTestId("current-screen")).toHaveTextContent("journey");
    expect(screen.getByTestId("target-json")).toHaveTextContent(
      JSON.stringify({ screen: "journey", sessionId: 77 })
    );

    // 3. Click packet chip
    const packetChip = screen.getByRole("button", { name: /packet #99/i });
    fireEvent.click(packetChip);

    expect(screen.getByTestId("current-screen")).toHaveTextContent("timeline");
    expect(screen.getByTestId("target-json")).toHaveTextContent(
      JSON.stringify({ screen: "timeline", packetId: 99 })
    );
  });
});
