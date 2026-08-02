import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Plugins } from "../screens/Plugins";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function PluginsTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Plugins />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Plugins Screen & usePluginsController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders empty state guide when no plugins are registered", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "plugins",
      plugins: [],
    } as any);

    render(<PluginsTestWrapper />);

    expect(await screen.findByText("🔌 No Plugins Available")).toBeInTheDocument();
  });

  it("renders plugin cards with trust badges, contract versions, and capability tags", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "plugins",
      plugins: [
        {
          name: "HTTP/3 Dissector",
          plugin_type: "dissector",
          trust: "first_party",
          capabilities: ["TCP", "QUIC", "HTTP3"],
          target_contract: "0.1.0",
          compatible: true,
          enabled: true,
          source: "built-in",
        },
      ],
    } as any);

    render(<PluginsTestWrapper />);

    expect(await screen.findByText("🔌 HTTP/3 Dissector")).toBeInTheDocument();
    expect(screen.getByText("🟢 First Party")).toBeInTheDocument();
    expect(screen.getByText("✓ Compatible")).toBeInTheDocument();
    expect(screen.getByText("QUIC")).toBeInTheDocument();
  });

  it("executes togglePlugin command when Enable/Disable button is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "plugins",
      plugins: [
        {
          name: "JA3 Fingerprinter",
          plugin_type: "enrichment",
          trust: "reviewed",
          capabilities: ["TLS"],
          target_contract: "0.1.0",
          compatible: true,
          enabled: false,
          source: "community",
        },
      ],
    } as any);

    const cmdSpy = vi.spyOn(ipcModule, "command").mockResolvedValue(undefined);

    render(<PluginsTestWrapper />);

    expect(await screen.findByText("🔌 JA3 Fingerprinter")).toBeInTheDocument();

    const enableBtn = screen.getByRole("button", { name: "Enable" });
    fireEvent.click(enableBtn);

    expect(cmdSpy).toHaveBeenCalledWith({ kind: "enablePlugin", name: "JA3 Fingerprinter" });
  });
});
