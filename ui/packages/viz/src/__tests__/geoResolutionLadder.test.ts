import { describe, it, expect } from "vitest";
import {
  resolveGeo,
  resolveGeoCore,
  traceGeoResolution,
  generateEndpointResolutionAudit,
  enrichHost,
  deriveHostEnrichmentSnapshot,
  clearGeoCaches,
  type EnrichedHost,
  type BreakdownRow,
  type GeographicPrecision,
  type IdentityPrecision,
} from "../index";

describe("Public Endpoint Geographic Resolution Pipeline & Evidence Fusion", () => {
  it("resolves AWS cloud region prefix with facility scope and provider infrastructure identity", () => {
    // 52.95.120.44 is in AWS us-east-1 prefix
    const { resolution, geography, identity, infrastructure, trace } = resolveGeoCore("52.95.120.44");

    expect(geography.precision).toBe("facility");
    expect(geography.coordinates).not.toBeNull();
    expect(geography.coordinates?.scope).toBe("facility");
    expect(identity.precision).toBe("provider");
    expect(identity.provider).toBe("AWS");
    expect(infrastructure.type).toBe("cloud");
    expect(infrastructure.cloudRegion).toBe("us-east-1");
    expect(resolution.mapEligible).toBe(true);
    expect(geography.explanation).toContain("regional centroid, not physical server");
  });

  it("resolves municipal city GeoIP as city estimate and NEVER promotes generic GeoIP to exact", () => {
    // 8.8.8.8 resolves to Mountain View / US in GeoIP db
    const { resolution, geography, identity, infrastructure } = resolveGeoCore("8.8.8.8");

    expect(geography.precision).toBe("city");
    expect(geography.coordinates).not.toBeNull();
    expect(geography.coordinates?.scope).toBe("city");
    expect(geography.precision).not.toBe("exact"); // Anti-fabrication rule
    expect(identity.precision).toBe("asn");
    expect(identity.asn).toBe(15169);
    expect(identity.organization).toContain("Google");
    expect(resolution.mapEligible).toBe(true);
  });

  it("resolves uncorroborated anycast address to country/unknown with null coordinates (zero fabricated precision)", () => {
    // 1.1.1.1 is Anycast Cloudflare
    const { resolution, geography, identity, infrastructure } = resolveGeoCore("1.1.1.1");

    expect(geography.coordinates).toBeNull();
    expect(resolution.mapEligible).toBe(false);
    expect(infrastructure.type).toBe("anycast");
    expect(infrastructure.provider).toContain("Cloudflare");
    expect(identity.precision).toBe("asn");
    expect(identity.asn).toBe(13335);
  });

  it("promotes anycast address to observed serving PoP facility when corroborated by hostname hint", () => {
    const { resolution, geography, identity, infrastructure } = resolveGeoCore("1.1.1.1", ["lhr01.cloudflare.com"]);

    expect(geography.precision).toBe("facility");
    expect(geography.coordinates).not.toBeNull();
    expect(geography.coordinates?.scope).toBe("facility");
    expect(geography.city).toBe("London");
    expect(geography.countryCode).toBe("GB");
    expect(resolution.mapEligible).toBe(true);
  });

  it("handles conflict between GeoIP and uncorroborated hostname by controlled downgrade and disagreement limit", () => {
    // 8.8.8.8 is US. Hostname claims lhr (London, GB)
    const { resolution, geography } = resolveGeoCore("8.8.8.8", ["core.lhr.fake.net"]);

    expect(geography.limitation).toBe("geo_sources_disagree");
    expect(geography.explanation).toContain("disagrees");
  });

  it("strictly enforces that ASN HQ does NOT establish endpoint geography (ASN != geography)", () => {
    // A synthetic public IP that only has ASN record, no geo coordinates
    const { geography, identity } = resolveGeoCore("198.51.100.1");

    // Even if ASN organization is known, geography remains unknown / null coordinates
    expect(geography.coordinates).toBeNull();
    expect(geography.precision).toBe("unknown");
  });

  it("generates structured per-endpoint resolution audit report for all observed public destinations", () => {
    const rows: BreakdownRow[] = [
      {
        label: "8.8.8.8",
        bytes: 2000,
        flows: 10,
        hostnames: [{ name: "dns.google", source: "dns" }],
      },
      {
        label: "1.1.1.1",
        bytes: 1500,
        flows: 5,
        hostnames: [{ name: "one.one.one.one", source: "dns" }],
      },
      {
        label: "52.95.120.44",
        bytes: 5000,
        flows: 20,
      },
      {
        label: "192.168.1.1", // Private IP -> excluded from public audit
        bytes: 8000,
        flows: 40,
      },
    ];

    const audit = generateEndpointResolutionAudit(rows, 1724850000000);

    expect(audit).toHaveLength(3); // Only 3 public endpoints

    const googleRow = audit.find((r) => r.endpoint === "8.8.8.8")!;
    expect(googleRow.geographicPrecision).toBe("city");
    expect(googleRow.identityPrecision).toBe("asn");
    expect(googleRow.asn).toBe(15169);
    expect(googleRow.trafficBytes).toBe(2000);
    expect(googleRow.flows).toBe(10);
    expect(googleRow.observedAt).toBe(1724850000000);

    const cloudflareRow = audit.find((r) => r.endpoint === "1.1.1.1")!;
    expect(cloudflareRow.infrastructureType).toBe("anycast");
    expect(cloudflareRow.coordinates).toBeNull();
    expect(cloudflareRow.trafficBytes).toBe(1500);

    const awsRow = audit.find((r) => r.endpoint === "52.95.120.44")!;
    expect(awsRow.geographicPrecision).toBe("facility");
    expect(awsRow.coordinates?.scope).toBe("facility");
    expect(awsRow.trafficBytes).toBe(5000);
  });

  it("satisfies the 100% Traffic Accounting & Dual-Dimension Invariant: sum(geo) == total == sum(identity)", () => {
    const mockHosts: BreakdownRow[] = [
      { label: "8.8.8.8", bytes: 1000, flows: 2 },
      { label: "1.1.1.1", bytes: 2000, flows: 4 },
      { label: "52.95.120.44", bytes: 4000, flows: 8 },
      { label: "104.244.42.1", bytes: 500, flows: 1 }, // Routable public
      { label: "10.0.0.1", bytes: 10000, flows: 50 }, // Local LAN
    ];

    const snapshot = deriveHostEnrichmentSnapshot(
      {
        hosts: mockHosts,
        captureSessionId: "session-1",
        snapshotSequence: 1,
        snapshotTimestamp: 1000,
      },
      null
    );

    const stats = snapshot.coverageStats;

    // Public host count = 4
    expect(stats.publicHostsCount).toBe(4);

    // Sum of 7 geographic buckets == publicHostsCount
    const geoCountSum =
      stats.geographicBreakdown.exact +
      stats.geographicBreakdown.facility +
      stats.geographicBreakdown.city +
      stats.geographicBreakdown.region +
      stats.geographicBreakdown.country +
      stats.geographicBreakdown.continent +
      stats.geographicBreakdown.unknown;

    expect(geoCountSum).toBe(stats.publicHostsCount);

    // Sum of identity buckets == publicHostsCount
    const idCountSum =
      stats.identityBreakdown.prefix +
      stats.identityBreakdown.asn +
      stats.identityBreakdown.organization +
      stats.identityBreakdown.provider +
      stats.identityBreakdown.unknown;

    expect(idCountSum).toBe(stats.publicHostsCount);

    // Sum of geographic traffic == total public traffic
    const totalPublicBytes = stats.resolvedBytes + stats.unresolvedBytes;
    const geoBytesSum =
      stats.geographicBytesBreakdown.exact +
      stats.geographicBytesBreakdown.facility +
      stats.geographicBytesBreakdown.city +
      stats.geographicBytesBreakdown.region +
      stats.geographicBytesBreakdown.country +
      stats.geographicBytesBreakdown.continent +
      stats.geographicBytesBreakdown.unknown;

    expect(geoBytesSum).toBe(totalPublicBytes);

    // Sum of identity traffic == total public traffic
    const idBytesSum =
      stats.identityBytesBreakdown.prefix +
      stats.identityBytesBreakdown.asn +
      stats.identityBytesBreakdown.organization +
      stats.identityBytesBreakdown.provider +
      stats.identityBytesBreakdown.unknown;

    expect(idBytesSum).toBe(totalPublicBytes);
  });

  it("executes the Final 9-Question Semantic Acceptance Test for every observed public endpoint", () => {
    const publicSample = [
      { ip: "8.8.8.8", bytes: 1200, hostnames: ["dns.google"] },
      { ip: "1.1.1.1", bytes: 2400, hostnames: ["one.one.one.one"] },
      { ip: "52.95.120.44", bytes: 3600, hostnames: [] },
    ];

    for (const item of publicSample) {
      const enriched = enrichHost(
        { label: item.ip, bytes: item.bytes, flows: 1, hostnames: item.hostnames.map((n) => ({ name: n, source: "dns" })) },
        0,
        1000
      );

      // Question 1: Who owns/operates it?
      const owner = enriched.identity.organization || enriched.identity.provider || enriched.asn.asOrg;
      expect(owner).toBeDefined();

      // Question 2: What geographic level is defensibly established? (Most specific defensible semantic tier)
      expect(["exact", "facility", "city", "region", "country", "continent", "unknown"]).toContain(
        enriched.geographicPrecision
      );

      // Question 3: Are coordinates available?
      const hasCoords = enriched.geography.coordinates !== null;
      if (hasCoords) {
        // Question 4: If coordinates exist, what do they represent?
        expect(["endpoint", "facility", "city", "region"]).toContain(enriched.geography.coordinates?.scope);
      }

      // Question 5: What evidence supports the resolution?
      expect(enriched.geography.source).toBeDefined();

      // Question 6: What evidence was rejected or downgraded?
      // Captured in limitation / reason / explanation
      expect(enriched.geography.explanation).toBeDefined();

      // Question 7: Why was the final precision selected?
      expect(enriched.resolutionReason.length).toBeGreaterThan(0);

      // Question 8: How much observed traffic belongs to this endpoint?
      expect(enriched.bytes).toBe(item.bytes);

      // Question 9: Is that traffic included exactly once in accounting?
      // (Verified by the dual-dimension summation invariant test)
      expect(enriched.deltaBytes).toBe(0);
    }
  });
});
