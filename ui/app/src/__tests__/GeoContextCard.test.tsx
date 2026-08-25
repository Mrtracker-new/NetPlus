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
        sampleEndpointIps: ["193.0.0.1", "193.0.0.2", "193.0.0.3"],
        endpointIps: ["193.0.0.1", "193.0.0.2", "193.0.0.3"],
        asns: [3333],
        freshness: "active",
        deltaBytes: 5242880,
        memberCount: 3,
      },
      memberHosts: [],
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText(/Netherlands \(NL\)/i)).toBeInTheDocument();
    expect(screen.getByText("3 hosts")).toBeInTheDocument();
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("AS3333")).toBeInTheDocument();
  });

  it("renders sampled cluster inspector with exact 127 endpoints and bounded 50 member sample note", () => {
    const sampleHosts: EnrichedHost[] = [];
    for (let i = 0; i < 50; i++) {
      sampleHosts.push(
        enrichHost(
          {
            label: `198.51.100.${i + 1}`,
            bytes: (50 - i) * 1000,
            flows: 1,
            hostnames: [{ name: `sampled-host-${i}.net`, source: "dns" }],
            evidence: [],
          },
          0
        )
      );
    }

    const sampleIps = sampleHosts.map((h) => h.ip);

    const entity: SelectedEntity = {
      kind: "cluster",
      entityId: "entity-cluster-geocell-100_200",
      clusterId: "cluster-node-1",
      geoCellId: "geocell-100_200",
      label: "Spatial Cluster (127)",
      node: {
        id: "cluster-node-1",
        entityId: "entity-cluster-geocell-100_200",
        geoCellId: "geocell-100_200",
        nodeKind: "cluster",
        label: "Spatial Cluster (127)",
        countryCode: null,
        latitude: 10.0,
        longitude: 20.0,
        x: 200,
        y: 150,
        totalBytes: 500_000,
        totalFlows: 127,
        sampleEndpointIps: sampleIps,
        endpointIps: sampleIps,
        asns: [13335],
        freshness: "active",
        deltaBytes: 50_000,
        memberCount: 127,
      },
      memberHosts: sampleHosts,
      memberCount: 127,
      sampleEndpointIps: sampleIps,
      isSampled: true,
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText("127 hosts")).toBeInTheDocument();
    expect(screen.getByText("SAMPLE ENDPOINTS (50 OF 127):")).toBeInTheDocument();
    expect(screen.getByText("Showing a sample of 50 endpoints")).toBeInTheDocument();
    expect(
      screen.getByText("Displaying a representative sample of 50 out of 127 total endpoints.")
    ).toBeInTheDocument();
  });

  it("renders sampled cluster inspector with 127 total endpoints when memberHosts is missing records (48 of 127)", () => {
    const sampleHosts: EnrichedHost[] = [];
    for (let i = 0; i < 48; i++) {
      sampleHosts.push(
        enrichHost(
          {
            label: `198.51.100.${i + 1}`,
            bytes: (48 - i) * 1000,
            flows: 1,
            hostnames: [{ name: `sampled-host-${i}.net`, source: "dns" }],
            evidence: [],
          },
          0
        )
      );
    }

    const sampleIps = Array.from({ length: 50 }, (_, i) => `198.51.100.${i + 1}`);

    const entity: SelectedEntity = {
      kind: "cluster",
      entityId: "entity-cluster-geocell-100_200",
      clusterId: "cluster-node-1",
      geoCellId: "geocell-100_200",
      label: "Spatial Cluster (127)",
      node: {
        id: "cluster-node-1",
        entityId: "entity-cluster-geocell-100_200",
        geoCellId: "geocell-100_200",
        nodeKind: "cluster",
        label: "Spatial Cluster (127)",
        countryCode: null,
        latitude: 10.0,
        longitude: 20.0,
        x: 200,
        y: 150,
        totalBytes: 500_000,
        totalFlows: 127,
        sampleEndpointIps: sampleIps,
        endpointIps: sampleIps,
        asns: [13335],
        freshness: "active",
        deltaBytes: 50_000,
        memberCount: 127,
      },
      memberHosts: sampleHosts, // 48 enriched records
      memberCount: 127,
      sampleEndpointIps: sampleIps, // 50 sample IPs
      isSampled: true,
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText("127 hosts")).toBeInTheDocument();
    expect(screen.getByText("SAMPLE ENDPOINTS (48 OF 127):")).toBeInTheDocument();
    expect(screen.getByText("Showing a sample of 48 endpoints")).toBeInTheDocument();
    expect(
      screen.getByText("Displaying a representative sample of 48 out of 127 total endpoints.")
    ).toBeInTheDocument();
  });

  it("verifies count authority fallback hierarchy (node.memberCount -> entity.memberCount -> memberHosts.length)", () => {
    const sampleHosts: EnrichedHost[] = [];
    for (let i = 0; i < 50; i++) {
      sampleHosts.push(
        enrichHost(
          {
            label: `198.51.100.${i + 1}`,
            bytes: 1000,
            flows: 1,
            hostnames: [],
            evidence: [],
          },
          0
        )
      );
    }

    // 1. node.memberCount = 127 takes precedence
    const { unmount: unmount1 } = render(
      <GeoContextCard
        entity={{
          kind: "cluster",
          entityId: "entity-cluster-1",
          clusterId: "c-1",
          label: "Cluster A",
          node: {
            id: "c-1",
            entityId: "entity-cluster-1",
            geoCellId: "geo-1",
            nodeKind: "cluster",
            label: "Cluster A",
            countryCode: null,
            latitude: 0,
            longitude: 0,
            x: 0,
            y: 0,
            totalBytes: 1000,
            totalFlows: 1,
            sampleEndpointIps: sampleHosts.map((h) => h.ip),
            endpointIps: sampleHosts.map((h) => h.ip),
            asns: [],
            freshness: "active",
            deltaBytes: 0,
            memberCount: 127,
          },
          memberHosts: sampleHosts,
        }}
      />
    );
    expect(screen.getByText("127 hosts")).toBeInTheDocument();
    unmount1();

    // 2. entity.memberCount = 127 when node is undefined
    const { unmount: unmount2 } = render(
      <GeoContextCard
        entity={{
          kind: "cluster",
          entityId: "entity-cluster-2",
          clusterId: "c-2",
          label: "Cluster B",
          memberCount: 127,
          memberHosts: sampleHosts,
        }}
      />
    );
    expect(screen.getByText("127 hosts")).toBeInTheDocument();
    unmount2();

    // 3. Fallback to memberHosts.length = 50 when both memberCounts are undefined
    render(
      <GeoContextCard
        entity={{
          kind: "cluster",
          entityId: "entity-cluster-3",
          clusterId: "c-3",
          label: "Cluster C",
          memberHosts: sampleHosts,
        }}
      />
    );
    expect(screen.getByText("50 hosts")).toBeInTheDocument();
    expect(screen.getByText("CLUSTER ENDPOINTS (50):")).toBeInTheDocument();
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

  it("renders IPv6 deferred status clearly on endpoint card", () => {
    const host = enrichHost(
      {
        label: "2001:4860:4860::8888",
        bytes: 4096,
        flows: 2,
        hostnames: [{ name: "dns.google", source: "dns" }],
        evidence: [],
      },
      0
    );

    const entity: SelectedEntity = {
      kind: "endpoint",
      ip: host.ip,
      entityId: makeHostEntityId(host.ip),
      host,
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText("Unresolved (IPv6 GeoIP deferred)")).toBeInTheDocument();
  });

  it("renders IPv6 deferred details when unresolvedGroup contains public IPv6 hosts", () => {
    const ipv4Unresolved = enrichHost(
      {
        label: "93.184.216.34",
        bytes: 1000,
        flows: 1,
        hostnames: [{ name: "unresolved.example.com", source: "dns" }],
        evidence: [],
      },
      0
    );
    const ipv6Deferred = enrichHost(
      {
        label: "2607:f8b0:4005:805::200e",
        bytes: 2000,
        flows: 2,
        hostnames: [{ name: "ipv6.google.com", source: "dns" }],
        evidence: [],
      },
      0
    );

    const entity: SelectedEntity = {
      kind: "unresolvedGroup",
      title: "Unresolved Public Destinations",
      memberHosts: [ipv4Unresolved, ipv6Deferred],
    };

    render(<GeoContextCard entity={entity} />);
    expect(screen.getByText(/Includes 1 public IPv6 endpoint where GeoIP resolution is intentionally deferred/i)).toBeInTheDocument();
    expect(screen.getByText("IPv6 Deferred")).toBeInTheDocument();
    expect(screen.getByText("1 hosts")).toBeInTheDocument();
    expect(screen.getByText(/IPv6 deferred •/i)).toBeInTheDocument();
  });
});
