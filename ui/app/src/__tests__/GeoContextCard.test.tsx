import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { GeoContextCard } from "../components/RightRail/GeoContextCard";
import { enrichHost, makeHostEntityId, type SelectedEntity, type EnrichedHost } from "@netpulse/viz";

afterEach(() => {
  cleanup();
});

describe("GeoContextCard Polymorphic Inspector", () => {
  it("renders endpoint details with IP, location, ASN, and telemetry metrics", () => {
    const host = enrichHost(
      {
        label: "1.1.1.1",
        bytes: 1048576,
        flows: 14,
        hostnames: [{ name: "one.one.one.one", source: "dns" }],
        evidence: [{ kind: "flow", id: 99 }],
      },
      0
    );

    const entity: SelectedEntity = {
      kind: "endpoint",
      entityId: makeHostEntityId("1.1.1.1"),
      ip: "1.1.1.1",
      host,
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText("one.one.one.one")).toBeInTheDocument();
    expect(screen.getByText("1.1.1.1")).toBeInTheDocument();
    expect(screen.getByText(/San Jose, US|United States/i)).toBeInTheDocument();
    expect(screen.getByText("AS13335")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare, Inc.")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
  });

  it("renders country cluster details with member endpoints count and total volume", () => {
    const entity: SelectedEntity = {
      kind: "countryAggregate",
      entityId: "entity-country-nl",
      countryCode: "NL",
      countryName: "Netherlands",
      node: {
        id: "country-NL",
        entityId: "entity-country-nl",
        geoCellId: "geocell-523_49",
        nodeKind: "countryAggregate",
        label: "Netherlands (3)",
        countryCode: "NL",
        latitude: 52.37,
        longitude: 4.9,
        x: 369.8,
        y: 75.26,
        totalBytes: 5242880,
        totalFlows: 22,
        endpointIps: ["193.0.0.1", "193.0.0.2"],
        asns: [3333],
        freshness: "active",
        deltaBytes: 5242880,
      },
      memberHosts: [],
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText(/Netherlands \(NL\)/i)).toBeInTheDocument();
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("AS3333")).toBeInTheDocument();
  });

  it("renders unresolved public group information with honesty notice", () => {
    const host = enrichHost(
      {
        label: "93.184.216.34",
        bytes: 4096,
        flows: 1,
        hostnames: [{ name: "example.com", source: "dns" }],
        evidence: [],
      },
      0
    );

    const entity: SelectedEntity = {
      kind: "unresolvedGroup",
      title: "Unresolved Public Destinations",
      memberHosts: [host],
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText("Unresolved Public Destinations")).toBeInTheDocument();
    expect(screen.getByText(/Physical locations are omitted to maintain accuracy/i)).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("renders Other Resolved Traffic aggregate card with metrics, explanation, search filtering, and selection dispatch", () => {
    const handleSelect = vi.fn();
    const handleClear = vi.fn();

    const hosts: EnrichedHost[] = [];
    for (let i = 0; i < 120; i++) {
      hosts.push(
        enrichHost(
          {
            label: `198.51.100.${(i % 250) + 1}`,
            bytes: (120 - i) * 1000,
            flows: (i % 5) + 1,
            hostnames: [{ name: `alpha-host-${i}.net`, source: "dns" }],
            evidence: [],
          },
          0
        )
      );
    }

    const entity: SelectedEntity = {
      kind: "otherResolvedGroup",
      title: "Other Resolved Traffic (120)",
      memberHosts: hosts,
    };

    render(
      <GeoContextCard
        entity={entity}
        onClearSelection={handleClear}
        onSelectEntity={handleSelect}
      />
    );

    // 1. Header and Explanation
    expect(screen.getByText("Aggregate Traffic")).toBeInTheDocument();
    expect(screen.getByText("Other Resolved Traffic (120)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Resolved destinations aggregated to respect the rendering budget while preserving 100% of telemetry volume."
      )
    ).toBeInTheDocument();

    // 2. Metrics
    expect(screen.getByText("120 hosts")).toBeInTheDocument();
    expect(screen.getByText("MEMBER ENDPOINTS (120):")).toBeInTheDocument();
    expect(screen.getByText("Showing top 100")).toBeInTheDocument();

    // 3. First member is the highest traffic endpoint ("alpha-host-0.net")
    expect(screen.getByText("alpha-host-0.net")).toBeInTheDocument();

    // 4. Search Filter (operating across the FULL member set)
    const searchInput = screen.getByRole("searchbox", { name: /Filter aggregate member endpoints/i });
    fireEvent.change(searchInput, { target: { value: "alpha-host-115" } });

    expect(screen.getByText("alpha-host-115.net")).toBeInTheDocument();
    expect(screen.queryByText("alpha-host-0.net")).not.toBeInTheDocument();

    // 5. Drill-down selection click
    const memberBtn = screen.getByRole("button", { name: /alpha-host-115\.net/i });
    fireEvent.click(memberBtn);

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "endpoint",
        ip: hosts[115]!.ip,
        host: hosts[115],
      })
    );
  });
});
