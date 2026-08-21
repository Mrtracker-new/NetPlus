import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Recordings } from "../screens/Recordings";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function RecordingsTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Recordings />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Recordings Screen & useRecordingsController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders empty state guide with primary Start Recording button when recordings list is empty", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "recordings",
      plugins: [],
    } as any);

    render(<RecordingsTestWrapper />);

    expect(await screen.findByText("No Session Recordings Yet")).toBeInTheDocument();
    expect(
      screen.getByText("Start a recording to capture packets for deterministic replay, teaching, diagnostics, or bug reports.")
    ).toBeInTheDocument();
  });

  it("renders saved recording cards with privacy badge and version pins", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "recordings",
      recordings: [
        {
          id: 101,
          from_mono_nanos: 0,
          to_mono_nanos: 5000000000,
          frame_count: 1250,
          incomplete: false,
          privacy: {
            level: "metadata_only",
            contains_payloads: false,
          },
          version_pins: {
            engine: "0.1.0",
            decode: "0.1.0",
            intel: "0.1.0",
            ai: "0.1.0",
            content: "0.1.0",
          },
        },
      ],
    } as any);

    render(<RecordingsTestWrapper />);

    expect(await screen.findByText("Recording #101")).toBeInTheDocument();
    expect(screen.getAllByText("Metadata Only")[0]).toBeInTheDocument();
    expect(screen.getByText("1250 frames")).toBeInTheDocument();
    expect(screen.getByText("No packet payloads — safe to share for teaching and bug reports.")).toBeInTheDocument();
  });

  it("executes startRecording command when Start Recording button is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "recordings",
      recordings: [],
    } as any);

    const cmdSpy = vi.spyOn(ipcModule, "command").mockResolvedValue(undefined);

    render(<RecordingsTestWrapper />);

    expect(await screen.findByText("No Session Recordings Yet")).toBeInTheDocument();

    const startBtn = screen.getAllByRole("button", { name: /Start Capture/i })[0];
    expect(startBtn).toBeDefined();
    fireEvent.click(startBtn!);

    expect(cmdSpy).toHaveBeenCalledWith({ kind: "startRecording" });
    expect(await screen.findByText("Recording Active...")).toBeInTheDocument();
  });
});
