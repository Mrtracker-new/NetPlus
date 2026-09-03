import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { App } from "../App";
import * as ipc from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CaptureControl Component", () => {
  it("renders capture button and dropdown with default adapter", () => {
    render(<App />);

    const startBtn = screen.getByRole("button", { name: "Start capture" });
    expect(startBtn).toBeInTheDocument();
    expect(startBtn).toHaveAttribute("aria-pressed", "false");

    const select = screen.getByRole("combobox", { name: "Capture interface" });
    expect(select).toBeInTheDocument();
    expect(screen.getByText("Default adapter")).toBeInTheDocument();
  });

  it("toggles capture state and triggers command execution", async () => {
    const commandSpy = vi.spyOn(ipc, "command").mockResolvedValue(undefined);

    render(<App />);

    const startBtn = screen.getByRole("button", { name: "Start capture" });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(commandSpy).toHaveBeenCalledWith({ kind: "startCapture", iface_id: 0 });
    });

    const stopBtn = await screen.findByRole("button", { name: "Stop capture" });
    expect(stopBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(stopBtn);
    await waitFor(() => {
      expect(commandSpy).toHaveBeenCalledWith({ kind: "stopCapture", iface_id: 0 });
    });
  });

  it("fails honestly and stays idle when backend is unavailable (Mode C)", async () => {
    vi.spyOn(ipc, "command").mockRejectedValue(
      new ipc.IpcError("NetPulse backend unavailable at /api/command", "BACKEND_UNAVAILABLE")
    );

    render(<App />);

    const startBtn = screen.getByRole("button", { name: "Start capture" });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(
        screen.getByText("NetPulse backend unavailable at /api/command")
      ).toBeInTheDocument();
    });

    // Must never transition to Capturing / Stop capture
    expect(startBtn).toHaveTextContent("Start capture");
    expect(startBtn).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Stop capture" })).not.toBeInTheDocument();
  });

  it("prevents double execution on rapid consecutive clicks (in-flight guard)", async () => {
    let resolveCommand: () => void = () => {};
    const commandPromise = new Promise<void>((resolve) => {
      resolveCommand = resolve;
    });
    const commandSpy = vi.spyOn(ipc, "command").mockImplementation(async (c) => {
      if (c.kind === "startCapture") {
        return commandPromise;
      }
      return Promise.resolve();
    });

    render(<App />);

    const startBtn = screen.getByRole("button", { name: "Start capture" });
    fireEvent.click(startBtn);
    fireEvent.click(startBtn); // Second rapid click while busy

    const startCaptureCalls = commandSpy.mock.calls.filter(
      ([c]) => c.kind === "startCapture"
    );
    expect(startCaptureCalls).toHaveLength(1);

    resolveCommand();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop capture" })).toBeInTheDocument();
    });
  });
});
