import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Explorer } from "../screens/Explorer";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

import { clearExplorerCache } from "../hooks/useExplorerController";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ExplorerTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Explorer />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Explorer Screen & useExplorerController", () => {
  beforeEach(() => {
    __resetForTest();
    clearExplorerCache();
  });

  it("renders protocol reference entries when browsing", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "explorerEntries",
      entries: [
        {
          key: "tls_handshake",
          title: "TLS Handshake",
          beginner: "Establishes an encrypted connection with a server.",
          intermediate: "Performs key exchange and authenticates server certificate.",
          expert: "Executes TLS 1.3 ClientHello / ServerHello 1-RTT handshake.",
          examples_available: true,
          related: ["tcp_syn", "dns_lookup"],
        },
      ],
    } as any);

    render(<ExplorerTestWrapper />);

    expect(await screen.findByText("TLS Handshake")).toBeInTheDocument();
    expect(screen.getByText("tls_handshake")).toBeInTheDocument();
    expect(screen.getByText(/You have an example/i)).toBeInTheDocument();
    expect(screen.getByText("Establishes an encrypted connection with a server.")).toBeInTheDocument();
  });

  it("filters entries by debounced search term input", async () => {
    const spy = vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "explorerEntries",
      entries: [
        {
          key: "tcp_rst",
          title: "TCP Reset (RST)",
          beginner: "Connection refused by server.",
          intermediate: "RST flag sent in TCP header.",
          expert: "Abrupt connection termination.",
          examples_available: false,
          related: [],
        },
      ],
    } as any);

    render(<ExplorerTestWrapper />);

    const searchInput = screen.getByPlaceholderText("Search: padlock, RST, NXDOMAIN, 404... (Press '/' to focus)");
    fireEvent.change(searchInput, { target: { value: "RST" } });

    await waitFor(
      () => {
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: "explorerSearch", term: "rst" }));
      },
      { timeout: 500 }
    );

    expect(await screen.findByText("TCP Reset (RST)")).toBeInTheDocument();
  });

  it("navigates to related topic when related chip is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "explorerEntries",
      entries: [
        {
          key: "http3_quic",
          title: "HTTP/3 Protocol",
          beginner: "Next-gen HTTP running over QUIC UDP.",
          intermediate: "0-RTT connection establishment.",
          expert: "Stream multiplexing over UDP without head-of-line blocking.",
          examples_available: true,
          related: ["quic_handshake"],
        },
      ],
    } as any);

    render(<ExplorerTestWrapper />);

    expect(await screen.findByText("HTTP/3 Protocol")).toBeInTheDocument();

    const relatedBtn = screen.getByRole("button", { name: "quic_handshake" });
    fireEvent.click(relatedBtn);

    const searchInput = screen.getByPlaceholderText(
      "Search: padlock, RST, NXDOMAIN, 404... (Press '/' to focus)"
    ) as HTMLInputElement;

    expect(searchInput.value).toBe("quic_handshake");
  });
});
