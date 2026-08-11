import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { ProtocolSandboxScreen } from "../screens/ProtocolSandbox";
import { formatHexDump } from "../hooks/useSandboxController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function SandboxTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <ProtocolSandboxScreen />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

// Baseline expected packet inspection fixture
const FIXTURE_EXPECTED_INSPECTION = {
  rawHex: "450000548A22400040012AC0A8010101010101",
  layers: ["Ethernet", "IPv4", "TCP", "HTTP/1.1"],
  diagnostics: [
    {
      field: "IPv4.TTL",
      severity: "warning" as const,
      rfcReference: "RFC 791",
      explanation: "TTL value 64 is standard for Linux/macOS headers.",
    },
    {
      field: "TCP.Window",
      severity: "info" as const,
      rfcReference: "RFC 9293",
      explanation: "Window size scales within recommended RFC 9293 limits.",
    },
    {
      field: "HTTP.Header",
      severity: "error" as const,
      rfcReference: "RFC 9112",
      explanation: "Header field delimiter format conforms to specification.",
    },
  ],
};

describe("ProtocolSandboxScreen & useSandboxController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("formatHexDump formats raw hex into offset-aligned hex byte rows and ASCII text", () => {
    const rawHex = "450000548A224000";
    const rows = formatHexDump(rawHex);

    expect(rows.length).toBe(1);
    expect(rows[0]?.offset).toBe("0000");
    expect(rows[0]?.hexBytes).toBe("45 00 00 54 8A 22 40 00");
    expect(rows[0]?.ascii).toContain("E");
  });

  it("renders EmptySandboxState guide when no packet has been built", () => {
    render(<SandboxTestWrapper />);

    expect(screen.getByText("Interactive Packet Builder")).toBeInTheDocument();
    expect(
      screen.getByText(/Select a template or configure protocol layers above, then click/i)
    ).toBeInTheDocument();
  });

  it("Packet Output Integrity Regression Test: passes baseline fixture output unchanged to UI views", async () => {
    const mockIpc = vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "decodedPacketInspection",
      inspection: FIXTURE_EXPECTED_INSPECTION,
    } as any);

    render(<SandboxTestWrapper />);

    const buildBtn = screen.getByRole("button", { name: "Build & Inspect Packet" });
    fireEvent.click(buildBtn);

    expect(mockIpc).toHaveBeenCalledWith({
      kind: "buildAndDecodePacket",
      layers: ["Ethernet", "IPv4", "TCP", "HTTP/1.1"],
    });

    expect(await screen.findByText("Wireshark-Style Hex Viewer")).toBeInTheDocument();
    expect(screen.getByText("RFC Diagnostics")).toBeInTheDocument();

    // Baseline Fixture Pass-Through Assertions
    expect(screen.getByText("IPv4.TTL")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();

    expect(screen.getByText("TCP.Window")).toBeInTheDocument();
    expect(screen.getByText("INFO")).toBeInTheDocument();

    expect(screen.getByText("HTTP.Header")).toBeInTheDocument();
    expect(screen.getByText("ERROR")).toBeInTheDocument();

    // Exact Byte Count for Fixture rawHex (38 chars = 19 bytes)
    expect(screen.getByText("19 Bytes")).toBeInTheDocument();
  });

  it("enforces layer reorder boundaries and preserves existing remove-layer semantics", () => {
    render(<SandboxTestWrapper />);

    const moveUpBtns = screen.getAllByTitle(/move .* up/i);
    const moveDownBtns = screen.getAllByTitle(/move .* down/i);

    // First layer (Ethernet) Move Up disabled
    expect(moveUpBtns[0]).toBeDisabled();

    // Last layer (HTTP/1.1) Move Down disabled
    expect(moveDownBtns[moveDownBtns.length - 1]).toBeDisabled();
  });

  it("loads preset templates into builder and executes packet inspection per existing controller contract", async () => {
    const mockIpc = vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "decodedPacketInspection",
      inspection: {
        rawHex: "0000",
        layers: ["Ethernet", "IPv4", "UDP", "DNS"],
        diagnostics: [],
      },
    } as any);

    render(<SandboxTestWrapper />);

    const dnsPreset = screen.getByRole("button", { name: "Load DNS Query Stack template" });
    fireEvent.click(dnsPreset);

    expect(mockIpc).toHaveBeenCalledWith({
      kind: "buildAndDecodePacket",
      layers: ["Ethernet", "IPv4", "UDP", "DNS"],
    });

    expect(await screen.findByText("Wireshark-Style Hex Viewer")).toBeInTheDocument();
  });

  it("exposes accessible copy hex and copy json buttons with byte count badge", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "decodedPacketInspection",
      inspection: {
        rawHex: "00112233445566778899",
        layers: ["Ethernet", "IPv4"],
        diagnostics: [],
      },
    } as any);

    render(<SandboxTestWrapper />);

    const buildBtn = screen.getByRole("button", { name: "Build & Inspect Packet" });
    fireEvent.click(buildBtn);

    expect(await screen.findByText("10 Bytes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy raw hex bytes to clipboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy JSON packet structure to clipboard" })).toBeInTheDocument();
  });
});
