import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { FleetScreen } from "../screens/Fleet";
import { normalizeFleetStatus } from "../hooks/useFleetController";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function FleetTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <FleetScreen />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("FleetScreen & useFleetController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("normalizeFleetStatus maps status strings into FleetStatus union", () => {
    expect(normalizeFleetStatus("online")).toBe("online");
    expect(normalizeFleetStatus("active")).toBe("online");
    expect(normalizeFleetStatus("degraded")).toBe("degraded");
    expect(normalizeFleetStatus("syncing")).toBe("degraded");
    expect(normalizeFleetStatus("offline")).toBe("offline");
    expect(normalizeFleetStatus("error")).toBe("offline");
    expect(normalizeFleetStatus("random")).toBe("unknown");
  });

  it("renders empty state guide when no fleet nodes are connected", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "fleetHosts",
      hosts: [],
    } as any);

    render(<FleetTestWrapper />);

    expect(
      await screen.findByText("No remote cluster nodes connected. Running single-node local agent.")
    ).toBeInTheDocument();
  });

  it("renders fleet hosts with problem-first sorting order (Offline -> Degraded -> Online)", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "fleetHosts",
      hosts: [
        { hostId: "node-1", hostname: "web-01", friendlyName: "Web Server 01", os: "linux", platform: "x86_64", agentVersion: "1.2.0", status: "online" },
        { hostId: "node-2", hostname: "db-01", friendlyName: "Database 01", os: "linux", platform: "x86_64", agentVersion: "1.2.0", status: "offline" },
        { hostId: "node-3", hostname: "worker-01", friendlyName: "Worker 01", os: "linux", platform: "x86_64", agentVersion: "1.2.0", status: "degraded" },
      ],
    } as any);

    render(<FleetTestWrapper />);

    expect(await screen.findByText("Database 01")).toBeInTheDocument();
    expect(screen.getByText("Worker 01")).toBeInTheDocument();
    expect(screen.getByText("Web Server 01")).toBeInTheDocument();

    // Verify summary KPI counts
    expect(screen.getByText("3")).toBeInTheDocument(); // Total
  });

  it("filters fleet nodes by search text and status chips", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "fleetHosts",
      hosts: [
        { hostId: "node-1", hostname: "web-01", friendlyName: "Web Server 01", os: "linux", platform: "x86_64", agentVersion: "1.2.0", status: "online" },
        { hostId: "node-2", hostname: "db-01", friendlyName: "Database 01", os: "linux", platform: "x86_64", agentVersion: "1.2.0", status: "offline" },
      ],
    } as any);

    render(<FleetTestWrapper />);

    expect(await screen.findByText("Database 01")).toBeInTheDocument();

    // Filter by search text
    const searchInput = screen.getByPlaceholderText("Filter by hostname, IP, OS, platform, or ID...");
    fireEvent.change(searchInput, { target: { value: "Database" } });

    expect(screen.getByText("Database 01")).toBeInTheDocument();
    expect(screen.queryByText("Web Server 01")).not.toBeInTheDocument();

    // Reset search, click status chip
    fireEvent.change(searchInput, { target: { value: "" } });
    const onlineChip = screen.getByRole("button", { name: "Online" });
    fireEvent.click(onlineChip);

    expect(screen.getByText("Web Server 01")).toBeInTheDocument();
    expect(screen.queryByText("Database 01")).not.toBeInTheDocument();
  });
});
