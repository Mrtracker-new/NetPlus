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

  it("renders empty state guide when no packet has been built", () => {
    render(<SandboxTestWrapper />);

    expect(
      screen.getByText("Build a custom packet or choose one of the preset protocol stacks to inspect packet layers and diagnostics.")
    ).toBeInTheDocument();
  });

  it("builds packet via IPC query and renders Wireshark-style hex viewer and RFC diagnostics", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "decodedPacketInspection",
      inspection: {
        rawHex: "450000548A22400040012AC0A8010101010101",
        layers: ["Ethernet", "IPv4", "TCP", "HTTP/1.1"],
        diagnostics: [
          {
            field: "IPv4.TTL",
            severity: "warning",
            rfcReference: "RFC 791",
            explanation: "TTL value 64 is standard for Linux/macOS headers.",
          },
        ],
      },
    } as any);

    render(<SandboxTestWrapper />);

    const buildBtn = screen.getByRole("button", { name: "Build & Inspect Packet" });
    fireEvent.click(buildBtn);

    expect(await screen.findByText("Wireshark-Style Hex Viewer")).toBeInTheDocument();
    expect(screen.getByText("RFC Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("IPv4.TTL")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
  });

  it("allows adding and removing custom layers in the layer builder", async () => {
    render(<SandboxTestWrapper />);

    expect(screen.getAllByText("HTTP/1.1").length).toBeGreaterThan(0);

    const addBtn = screen.getByRole("button", { name: "+ Add Layer" });
    fireEvent.click(addBtn);

    const removeBtns = screen.getAllByTitle("Remove");
    expect(removeBtns.length).toBeGreaterThan(0);
  });

  it("loads preset protocol stacks when preset buttons are clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "decodedPacketInspection",
      inspection: {
        rawHex: "0000",
        layers: ["Ethernet", "IPv4", "UDP", "DNS"],
        diagnostics: [],
      },
    } as any);

    render(<SandboxTestWrapper />);

    const dnsPreset = screen.getByRole("button", { name: "DNS Query Stack" });
    fireEvent.click(dnsPreset);

    expect(await screen.findByText("Wireshark-Style Hex Viewer")).toBeInTheDocument();
  });
});
