import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Export } from "../screens/Export";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ExportTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Export />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Export Screen & useExportController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders export format selector, payload level selector, and zero egress badge", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "exportPreview",
      preview: {
        format: "json",
        level: "metadata_only",
        flows: 15,
        sessions: 3,
        hosts: 5,
        contains_payloads: false,
        sanitized: ["metadata-only: no packet payloads leave", "IP coarsening: addresses reduced to network labels"],
        provenance: "NetPulse 0.1.0 · metadata-only",
      },
    } as any);

    render(<ExportTestWrapper />);

    expect(await screen.findByText(/Local File Only — NetPulse does not automatically transmit exported files/i)).toBeInTheDocument();
    expect(screen.getByText("pcapng")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(screen.getByText("Metadata Only")).toBeInTheDocument();
  });

  it("updates preview provenance and level-specific sanitization rules when level chip is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "exportPreview",
      preview: {
        format: "json",
        level: "metadata_only",
        flows: 354,
        sessions: 35,
        hosts: 65,
        contains_payloads: false,
        sanitized: ["metadata-only: no packet payloads leave", "IP coarsening: addresses reduced to network labels"],
        provenance: "NetPulse 0.1.0 · metadata-only",
      },
    } as any);

    render(<ExportTestWrapper />);

    expect(await screen.findByText(/NetPulse 0.1.0 · metadata-only/i)).toBeInTheDocument();

    const fullPayloadBtn = screen.getByRole("radio", { name: "Full Payload" });
    fireEvent.click(fullPayloadBtn);

    expect(await screen.findByText(/NetPulse 0.1.0 · full-payload/i)).toBeInTheDocument();
    expect(screen.getByText("full payload: packet payloads included")).toBeInTheDocument();
  });

  it("reports the written file path from the export command", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "exportPreview",
      preview: {
        format: "json",
        level: "metadata_only",
        flows: 10,
        sessions: 2,
        hosts: 2,
        contains_payloads: false,
        sanitized: [],
        provenance: "NetPulse 0.1.0 · metadata-only",
      },
    } as any);

    const artifact = {
      id: 7,
      path: "/tmp/netpulse/exports/netpulse-export-173.json",
      bytes: 2048,
      format: "json" as const,
      level: "metadata_only" as const,
    };
    const cmdSpy = vi
      .spyOn(ipcModule, "command")
      .mockResolvedValue({ kind: "artifactWritten", artifact } as any);

    render(<ExportTestWrapper />);

    expect(await screen.findByText(/Export to File/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export to File/i }));

    await waitFor(() => {
      expect(cmdSpy).toHaveBeenCalledWith({
        kind: "startExport",
        selection: { kind: "all" },
        format: "json",
        level: "metadata_only",
      });
    });

    // The notice and the artifact row both name the real file, not a generic message.
    expect(
      await screen.findByText(/Export written to \/tmp\/netpulse\/exports\/netpulse-export-173\.json/i)
    ).toBeInTheDocument();
    expect(screen.getByText(artifact.path)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();

    // Opening asks the shell to open exactly the artifact it reported.
    fireEvent.click(screen.getByRole("button", { name: /Open File/i }));
    await waitFor(() => {
      expect(cmdSpy).toHaveBeenCalledWith({ kind: "openExport", id: 7 });
    });
  });

  it("states that no path was reported when the command omits an artifact", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "exportPreview",
      preview: {
        format: "json",
        level: "metadata_only",
        flows: 4,
        sessions: 1,
        hosts: 1,
        contains_payloads: false,
        sanitized: [],
        provenance: "NetPulse 0.1.0 · metadata-only",
      },
    } as any);
    vi.spyOn(ipcModule, "command").mockResolvedValue({ kind: "completed" } as any);

    render(<ExportTestWrapper />);
    fireEvent.click(await screen.findByRole("button", { name: /Export to File/i }));

    expect(
      await screen.findByText(/no file path was reported/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open File/i })).not.toBeInTheDocument();
  });
});
