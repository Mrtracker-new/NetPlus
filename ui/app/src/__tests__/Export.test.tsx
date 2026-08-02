import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

    expect(await screen.findByText("🔒 Local File Only — NetPulse does not automatically transmit exported files.")).toBeInTheDocument();
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

    expect(await screen.findByText("📍 NetPulse 0.1.0 · metadata-only")).toBeInTheDocument();

    const fullPayloadBtn = screen.getByRole("radio", { name: "Full Payload" });
    fireEvent.click(fullPayloadBtn);

    expect(await screen.findByText("📍 NetPulse 0.1.0 · full-payload")).toBeInTheDocument();
    expect(screen.getByText("full payload: packet payloads included")).toBeInTheDocument();
  });

  it("executes startExport command when Export to File button is clicked", async () => {
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

    const cmdSpy = vi.spyOn(ipcModule, "command").mockResolvedValue(undefined);

    render(<ExportTestWrapper />);

    expect(await screen.findByText("📥 Export to File")).toBeInTheDocument();

    const exportBtn = screen.getByRole("button", { name: "📥 Export to File" });
    fireEvent.click(exportBtn);

    expect(cmdSpy).toHaveBeenCalledWith({
      kind: "startExport",
      selection: { kind: "all" },
      format: "json",
      level: "metadata_only",
    });
  });
});
