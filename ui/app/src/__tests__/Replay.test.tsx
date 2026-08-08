import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Replay } from "../screens/Replay";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";
import { formatDuration } from "../hooks/useReplayController";

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function ReplayTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Replay />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Replay Screen & useReplayController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("formats nanoseconds into MM:SS.ms duration correctly", () => {
    expect(formatDuration(0)).toBe("00:00.000");
    expect(formatDuration(17452000000)).toBe("00:17.452");
    expect(formatDuration(133905000000)).toBe("02:13.905");
  });

  it("renders empty state when no recording is active", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "replayState",
      state: {
        total_nanos: 0,
        position_nanos: 0,
        frame_index: 0,
        playing: false,
        speed_percent: 100,
        incomplete: false,
      },
    } as any);

    render(<ReplayTestWrapper />);

    expect(await screen.findByText("📼 No Active Recording Loaded")).toBeInTheDocument();
  });

  it("renders active replay transport controls and summary scorecards when recording is loaded", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "replayState",
      state: {
        total_nanos: 10000000000,
        position_nanos: 2500000000,
        frame_index: 42,
        playing: false,
        speed_percent: 100,
        incomplete: false,
      },
    } as any);

    render(<ReplayTestWrapper />);

    expect(await screen.findByText("#42")).toBeInTheDocument();
    expect(screen.getByText("00:02.500")).toBeInTheDocument();
    expect(screen.getByText("00:10.000")).toBeInTheDocument();
    expect(screen.getByText("⏸️ Paused")).toBeInTheDocument();
  });

  it("executes play command when Play button is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "replayState",
      state: {
        total_nanos: 10000000000,
        position_nanos: 0,
        frame_index: 0,
        playing: false,
        speed_percent: 100,
        incomplete: false,
      },
    } as any);

    const cmdSpy = vi.spyOn(ipcModule, "command").mockResolvedValue(undefined);

    render(<ReplayTestWrapper />);

    expect(await screen.findByText("#0")).toBeInTheDocument();

    const playBtn = screen.getByRole("button", { name: "▶️ Play" });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(cmdSpy).toHaveBeenCalledWith({ kind: "replayPlay" });
      expect(screen.getByRole("button", { name: "▶️ Play" })).not.toBeDisabled();
    });
  });
});
