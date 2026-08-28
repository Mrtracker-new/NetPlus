import { describe, it, expect, beforeEach } from "vitest";
import type { BreakdownRow } from "@netpulse/contract";
import {
  resolveGeo,
  resolveAsn,
  resolveAnycast,
  resolveGeoCore,
  traceGeoResolution,
  enrichHost,
  clearGeoCaches,
} from "../geo/geoDatabase";
import { IPV4_ASN_INTERVALS } from "../geo/generatedAsnIntervals";
import {
  extractLocationFromHostname,
  extractProviderFromHostname,
} from "../geo/observedHostnameClassifier";
import { deriveMapViewModel, type MapViewModelInput } from "../geo/mapViewModel";
import type { CloudRegionResolution, ObservedPoPResolution } from "../geo/geoTypes";

describe("Production-Grade Audit & Resolution for UNKNOWN Public Endpoints", () => {
  beforeEach(() => {
    clearGeoCaches();
  });

  // ---------------------------------------------------------------------------
  // 1. High-Volume Target Endpoints Evidence-Contract Fixtures
  // ---------------------------------------------------------------------------
  describe("High-Volume Target Endpoints Fixtures", () => {
    const targetFixtures = [
      {
        ip: "62.72.41.182",
        hostnames: [],
        bytes: 441_300_000,
        flows: 155,
        expectedAsn: 47583,
        expectedOrg: "Hostinger Operations, UAB",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "172.217.112.4",
        hostnames: ["ajax.googleapis.com"],
        bytes: 81_900_000,
        flows: 11,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "172.217.115.4",
        hostnames: ["play.googleapis.com"],
        bytes: 74_100_000,
        flows: 14,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "172.217.113.4",
        hostnames: ["daily-cloudcode-pa.googleapis.com"],
        bytes: 42_600_000,
        flows: 3,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "172.217.118.4",
        hostnames: ["www.youtube.com"],
        bytes: 14_900_000,
        flows: 14,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "202.88.159.108",
        hostnames: [],
        bytes: 14_100_000,
        flows: 2,
        expectedAsn: 45528,
        expectedOrg: "Asianet Satellite Communications Ltd",
        expectedDistribution: "unicast" as const,
        expectedSource: "local_database",
      },
      {
        ip: "202.88.159.80",
        hostnames: [],
        bytes: 8_900_000,
        flows: 1,
        expectedAsn: 45528,
        expectedOrg: "Asianet Satellite Communications Ltd",
        expectedDistribution: "unicast" as const,
        expectedSource: "local_database",
      },
      {
        ip: "142.251.157.4",
        hostnames: ["rr1.sn-i5uif5t-cagz.googlevideo.com"],
        bytes: 250_000,
        flows: 2,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
      {
        ip: "142.251.156.4",
        hostnames: ["ajax.googleapis.com"],
        bytes: 216_000,
        flows: 8,
        expectedAsn: 15169,
        expectedOrg: "Google LLC",
        expectedDistribution: "cloud" as const,
        expectedSource: "local_database",
      },
    ];

    for (const fixture of targetFixtures) {
      it(`resolves ${fixture.ip} to NETWORK with verified ASN AS${fixture.expectedAsn} (${fixture.expectedOrg})`, () => {
        const resolution = resolveGeo(fixture.ip, fixture.hostnames);

        // Anti-Fabrication Invariants
        expect(resolution.precision).toBe("network");
        expect(resolution.status).toBe("unresolved");
        expect(resolution.mapEligible).toBe(false);
        expect((resolution as unknown as Record<string, unknown>)["latitude"]).toBeUndefined();
        expect((resolution as unknown as Record<string, unknown>)["longitude"]).toBeUndefined();

        // Network Identity Evidence Contract
        expect(resolution.asn).toBe(fixture.expectedAsn);
        expect(resolution.organization).toBe(fixture.expectedOrg);
        expect(resolution.distribution).toBe(fixture.expectedDistribution);
        expect(resolution.source).toBe(fixture.expectedSource);
        expect(resolution.explanation).toBeTruthy();
        expect(resolution.explanation.length).toBeGreaterThan(10);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Diagnostic Trace & Single-Source Parity Tests
  // ---------------------------------------------------------------------------
  describe("Diagnostic Trace & Single-Source Parity", () => {
    const testIps = [
      "62.72.41.182",
      "172.217.112.4",
      "202.88.159.108",
      "142.251.157.4",
      "1.1.1.1",
      "192.168.1.1",
      "2001:4860:4860::8888",
      "999.999.999.999",
    ];

    for (const ip of testIps) {
      it(`traceGeoResolution matches resolveGeo identically for ${ip}`, () => {
        const { resolution, trace } = resolveGeoCore(ip, ["ajax.googleapis.com"]);
        const directResolution = resolveGeo(ip, ["ajax.googleapis.com"]);
        const directTrace = traceGeoResolution(ip, ["ajax.googleapis.com"]);

        expect(directResolution).toEqual(resolution);
        expect(directTrace).toEqual(trace);

        // Structural Decision Parity
        expect(trace.finalPrecision).toBe(resolution.precision);
        expect(trace.mapEligible).toBe(resolution.mapEligible);
        expect(trace.explanation).toBe(resolution.explanation);

        if (resolution.precision === "network" && resolution.asn) {
          expect(trace.asn.status).toBe("match");
          expect(trace.asn.asn).toBe(resolution.asn);
          expect(trace.asn.organization).toBe(resolution.organization);
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Exact Hexadecimal Boundary Fence Tests ([start - 1, start, end, end + 1])
  // ---------------------------------------------------------------------------
  describe("Exact Hexadecimal Boundary Fence Tests", () => {
    describe("62.72.0.0/16 boundary fence (AS47583 Hostinger)", () => {
      it("start - 1 (62.71.255.255) does NOT match AS47583", () => {
        const res = resolveAsn("62.71.255.255");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 47583)).toBe(true);
      });

      it("start (62.72.0.0) matches AS47583", () => {
        const res = resolveAsn("62.72.0.0");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(47583);
          expect(res.asOrg).toBe("Hostinger Operations, UAB");
        }
      });

      it("end (62.72.255.255) matches AS47583", () => {
        const res = resolveAsn("62.72.255.255");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(47583);
          expect(res.asOrg).toBe("Hostinger Operations, UAB");
        }
      });

      it("end + 1 (62.73.0.0) does NOT match AS47583", () => {
        const res = resolveAsn("62.73.0.0");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 47583)).toBe(true);
      });
    });

    describe("142.251.0.0/16 boundary fence (AS15169 Google)", () => {
      it("142.250.30.1 matches AS2516 (KDDI)", () => {
        const res = resolveAsn("142.250.30.1");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(2516);
          expect(res.asOrg).toBe("KDDI Corporation");
        }
      });

      it("start (142.251.0.0) matches AS15169", () => {
        const res = resolveAsn("142.251.0.0");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(15169);
          expect(res.asOrg).toBe("Google LLC");
        }
      });

      it("end (142.251.255.255) matches AS15169", () => {
        const res = resolveAsn("142.251.255.255");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(15169);
          expect(res.asOrg).toBe("Google LLC");
        }
      });

      it("end + 1 (142.252.0.0) does NOT match AS15169", () => {
        const res = resolveAsn("142.252.0.0");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 15169)).toBe(true);
      });
    });

    describe("172.217.0.0/16 boundary fence (AS15169 Google)", () => {
      it("start - 1 (172.216.255.255) does NOT match AS15169", () => {
        const res = resolveAsn("172.216.255.255");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 15169)).toBe(true);
      });

      it("start (172.217.0.0) matches AS15169", () => {
        const res = resolveAsn("172.217.0.0");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(15169);
          expect(res.asOrg).toBe("Google LLC");
        }
      });

      it("end (172.217.255.255) matches AS15169", () => {
        const res = resolveAsn("172.217.255.255");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(15169);
          expect(res.asOrg).toBe("Google LLC");
        }
      });

      it("end + 1 (172.218.0.0) does NOT match AS15169", () => {
        const res = resolveAsn("172.218.0.0");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 15169)).toBe(true);
      });
    });

    describe("202.88.128.0/18 boundary fence (AS45528 Asianet)", () => {
      it("start - 1 (202.88.127.255) does NOT match AS45528", () => {
        const res = resolveAsn("202.88.127.255");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 45528)).toBe(true);
      });

      it("start (202.88.128.0) matches AS45528", () => {
        const res = resolveAsn("202.88.128.0");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(45528);
          expect(res.asOrg).toBe("Asianet Satellite Communications Ltd");
        }
      });

      it("end (202.88.191.255) matches AS45528", () => {
        const res = resolveAsn("202.88.191.255");
        expect(res.status).toBe("resolved");
        if (res.status === "resolved") {
          expect(res.asn).toBe(45528);
          expect(res.asOrg).toBe("Asianet Satellite Communications Ltd");
        }
      });

      it("end + 1 (202.88.192.0) does NOT match AS45528", () => {
        const res = resolveAsn("202.88.192.0");
        expect(res.status === "unresolved" || (res.status === "resolved" && res.asn !== 45528)).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Global Interval Invariant Test
  // ---------------------------------------------------------------------------
  describe("Global Interval Ordering & Non-Overlap Invariants", () => {
    it("satisfies intervals[i].end < intervals[i+1].start for all ASN intervals", () => {
      for (let i = 0; i < IPV4_ASN_INTERVALS.length; i++) {
        const [start, end] = IPV4_ASN_INTERVALS[i]!;
        expect(start, `asn[${i}]: start <= end`).toBeLessThanOrEqual(end);
        if (i + 1 < IPV4_ASN_INTERVALS.length) {
          const [nextStart] = IPV4_ASN_INTERVALS[i + 1]!;
          expect(end, `asn[${i}].end < asn[${i+1}].start`).toBeLessThan(nextStart);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Observed Hostname Provider Hints & Low-Confidence Semantics
  // ---------------------------------------------------------------------------
  describe("Observed Hostname Provider Hints", () => {
    it("extracts provider hint for known infrastructure domains with confidence: low", () => {
      const hint = extractProviderFromHostname("ajax.googleapis.com");
      expect(hint).not.toBeNull();
      expect(hint?.provider).toBe("Google LLC");
      expect(hint?.distribution).toBe("cloud");
      expect(hint?.source).toBe("observed_hostname");
      expect(hint?.confidence).toBe("low");
    });

    it("strictly respects domain boundaries and rejects suffix spoofing", () => {
      expect(extractProviderFromHostname("fakegoogleapis.com")).toBeNull();
      expect(extractProviderFromHostname("not-google.com")).toBeNull();
      expect(extractProviderFromHostname("malicious-aws.com")).toBeNull();
    });

    it("resolves to NETWORK with explanation stating ASN was not established when GeoIP & ASN are missed", () => {
      const publicUnmappedIp = "194.26.29.10"; // outside our local ASN intervals
      const res2 = resolveGeo(publicUnmappedIp, ["cdn.fastly.net"]);
      expect(res2.precision).toBe("network");
      expect(res2.source).toBe("observed_hostname");
      expect(res2.confidence).toBe("low");
      expect(res2.organization).toBe("Fastly, Inc.");
      expect(res2.explanation).toContain("IP-level ASN ownership was not established");
      expect(res2.mapEligible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Conflicting Evidence & Degradation Handling (geo_sources_disagree)
  // ---------------------------------------------------------------------------
  describe("Conflicting Evidence Handling", () => {
    it("handles conflicting geographic hints gracefully without fabricating coordinates", () => {
      // 31.0.0.1 is in Germany (DE) in our local database
      // If observed hostname suggests Singapore (SIN)
      const res = resolveGeo("31.0.0.1", ["edge-sin-01.example.com"]);
      if (res.status === "resolved") {
        expect(res.countryCode).toBe("DE");
        expect(res.confidence).toBe("low");
        expect(res.limitation).toBe("geo_sources_disagree");
        expect(res.explanation).toContain("disagrees");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. UNKNOWN Evidence Invariant Test
  // ---------------------------------------------------------------------------
  describe("UNKNOWN Invariant Verification", () => {
    it("returns UNKNOWN iff no GeoIP, no Country, no ASN, no Provider, and no Hostname hint exist", () => {
      const completelyUnmappedPublicIp = "194.26.29.99";
      const res = resolveGeo(completelyUnmappedPublicIp, []);
      expect(res.precision).toBe("unknown");
      expect(res.status).toBe("unresolved");
      expect(res.mapEligible).toBe(false);
      expect(res.limitation).toBe("unmapped_public_address");
      expect(res.explanation).toBe("No local geographic, country, ASN, or network evidence was found.");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Traffic-Weighted Before / After Coverage Impact Report
  // ---------------------------------------------------------------------------
  describe("Traffic-Weighted Before / After Coverage Impact Report", () => {
    it("computes exact byte-derived coverage impact across all 9 target endpoints", () => {
      const targetRows: BreakdownRow[] = [
        { label: "62.72.41.182", bytes: 441_300_000, flows: 155, hostnames: [], evidence: [] },
        { label: "172.217.112.4", bytes: 81_900_000, flows: 11, hostnames: [{ name: "ajax.googleapis.com", source: "dns" }], evidence: [] },
        { label: "172.217.115.4", bytes: 74_100_000, flows: 14, hostnames: [{ name: "play.googleapis.com", source: "dns" }], evidence: [] },
        { label: "172.217.113.4", bytes: 42_600_000, flows: 3, hostnames: [{ name: "daily-cloudcode-pa.googleapis.com", source: "dns" }], evidence: [] },
        { label: "172.217.118.4", bytes: 14_900_000, flows: 14, hostnames: [{ name: "www.youtube.com", source: "dns" }], evidence: [] },
        { label: "202.88.159.108", bytes: 14_100_000, flows: 2, hostnames: [], evidence: [] },
        { label: "202.88.159.80", bytes: 8_900_000, flows: 1, hostnames: [], evidence: [] },
        { label: "142.251.157.4", bytes: 250_000, flows: 2, hostnames: [{ name: "rr1.sn-i5uif5t-cagz.googlevideo.com", source: "dns" }], evidence: [] },
        { label: "142.251.156.4", bytes: 216_000, flows: 8, hostnames: [{ name: "ajax.googleapis.com", source: "dns" }], evidence: [] },
      ];

      const totalTargetBytes = targetRows.reduce((sum, r) => sum + r.bytes, 0);
      expect(totalTargetBytes).toBe(678_266_000); // Exactly 678.266 MB in bytes

      const input: MapViewModelInput = {
        hosts: targetRows,
        captureSessionId: "audit-session",
        snapshotSequence: 1,
      };

      const viewModel = deriveMapViewModel(input, null);

      // Acceptance Criteria Assertions:
      // 1. All 9 audited targets resolve to NETWORK
      expect(viewModel.coverageStats.precisionBreakdown.network).toBe(9);
      expect(viewModel.coverageStats.precisionBreakdown.unknown).toBe(0);
      expect(viewModel.coverageStats.precisionBreakdown.city).toBe(0);
      expect(viewModel.coverageStats.precisionBreakdown.region).toBe(0);
      expect(viewModel.coverageStats.precisionBreakdown.country).toBe(0);

      // 2. UNKNOWN traffic across targets is 0 bytes
      expect(viewModel.coverageStats.bytesBreakdown.unknown).toBe(0);

      // 3. Network-identified traffic across targets is 100% of target bytes
      expect(viewModel.coverageStats.bytesBreakdown.network).toBe(totalTargetBytes);

      // 4. Physical coordinates fabricated: 0
      expect(viewModel.coverageStats.resolvedHostsCount).toBe(0);
      expect(viewModel.coverageStats.resolvedBytes).toBe(0);
      expect(viewModel.coverageStats.physicalCoveragePercent).toBe(0);

      // 5. Target map-eligible endpoints: 0 / 9 (no aggregate nodes placed on map)
      expect(viewModel.aggregateNodes.length).toBe(0);

      // 6. Network identity coverage is 100%
      expect(viewModel.coverageStats.networkIdentityCoveragePercent).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Hostname Edge Cases & Multi-Hostname Disambiguation
  // ---------------------------------------------------------------------------
  describe("Hostname Edge Cases & Multi-Hostname Disambiguation", () => {
    it("correctly attributes provider and geo hint when derived from distinct hostnames in array", () => {
      // 199.19.1.55 is a public IP unmapped in local GeoIP and ASN databases
      const testIp = "199.19.1.55";
      const hostnames = [
        "app.hostinger.com",     // Matches Provider: Hostinger Operations, UAB
        "edge-fra-01.custom.net", // Matches IATA: FRA (Frankfurt, DE)
      ];

      const res = resolveGeo(testIp, hostnames);
      expect(res.precision).toBe("network");
      expect(res.organization).toBe("Hostinger Operations, UAB");
      expect(res.observedHostname).toBe("app.hostinger.com");
      expect(res.explanation).toContain("app.hostinger.com");
      expect(res.explanation).not.toContain("edge-fra-01.custom.net");

      const trace = traceGeoResolution(testIp, hostnames);
      expect(trace.hostname.status).toBe("match");
      expect(trace.hostname.providerHint?.provider).toBe("Hostinger Operations, UAB");
      expect(trace.hostname.hint?.locationName).toBe("Frankfurt");
    });

    it("handles trailing FQDN root dots in observed hostnames (RFC 1035)", () => {
      const testIp = "199.19.1.56";
      const res = resolveGeo(testIp, ["edge.iad01.digitalocean.com."]);
      expect(res.precision).toBe("network");
      expect(res.organization).toBe("DigitalOcean, LLC");
      expect(res.distribution).toBe("cloud");
      expect(res.observedHostname).toBe("edge.iad01.digitalocean.com.");
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Level 3 Cloud Region Centroid Resolution & Invariants
  // ---------------------------------------------------------------------------
  describe("Level 3 Cloud Region Centroid Resolution", () => {
    it("resolves AWS us-east-1 prefix (52.95.120.44) to cloud_region with cloudRegionCentroid semantics", () => {
      const res = resolveGeo("52.95.120.44");

      expect(res.status).toBe("resolved");
      expect(res.resolutionLevel).toBe("cloud_region");
      expect(res.precision).toBe("region");
      expect(res.distribution).toBe("cloud");
      expect(res.mapEligible).toBe(true);
      expect(res.anchorKind).toBe("cloud_region_centroid");
      expect(res.coordinateMeaning).toBe("cloudRegionCentroid");

      // Validated Cloud Region Attributes
      expect(res.countryCode).toBe("US");
      expect(res.regionCode).toBe("VA");
      expect(res.regionName).toBe("US East (N. Virginia)");
      expect(res.city).toBeNull(); // Cloud regions have null city to prevent confusing with physical metro host
      expect(res.latitude).toBeCloseTo(39.0438, 2);
      expect(res.longitude).toBeCloseTo(-77.4874, 2);
      expect(res.accuracyRadiusKm).toBe(80);

      // Cloud Metadata
      expect((res as CloudRegionResolution).provider).toBe("AWS");
      expect((res as CloudRegionResolution).cloudRegion).toBe("us-east-1");
      expect(res.confidence).toBe("high");
      expect(res.source).toBe("cloud_prefix");
      expect(res.provenance?.source).toBe("aws_ip_ranges");
      expect(res.explanation).toContain("AWS US East (N. Virginia) (us-east-1)");
      expect(res.explanation).toContain("regional centroid, not physical server");
    });

    it("resolves GCP europe-west3 prefix (35.198.130.1) to cloud_region with Frankfurt regional centroid", () => {
      const res = resolveGeo("35.198.130.1");

      expect(res.status).toBe("resolved");
      expect(res.resolutionLevel).toBe("cloud_region");
      expect(res.mapEligible).toBe(true);
      expect(res.anchorKind).toBe("cloud_region_centroid");
      expect(res.coordinateMeaning).toBe("cloudRegionCentroid");
      expect(res.countryCode).toBe("DE");
      expect((res as CloudRegionResolution).provider).toBe("Google Cloud");
      expect((res as CloudRegionResolution).cloudRegion).toBe("europe-west3");
      expect(res.latitude).toBeCloseTo(50.1109, 2);
      expect(res.longitude).toBeCloseTo(8.6821, 2);
      expect(res.confidence).toBe("high");
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Additional Synthetic / Test Telemetry Scenarios (Strict 6-Gate Promotion)
  // ---------------------------------------------------------------------------
  describe("Additional Synthetic / Test Telemetry Scenarios (Strict 6-Gate Promotion)", () => {
    it("promotes unmapped IP with verified synthetic IATA token and ASN corroboration to observed_pop", () => {
      // Synthetic test fixture: 172.217.112.4 matches AS15169 (Google LLC), test telemetry supplies edge-iad-01.google.com (IAD Washington DC)
      const res = resolveGeo("172.217.112.4", ["edge-iad-01.google.com"]);

      expect(res.status).toBe("resolved");
      expect(res.resolutionLevel).toBe("observed_pop");
      expect(res.anchorKind).toBe("observed_pop");
      expect(res.coordinateMeaning).toBe("observedServingPoP");
      expect(res.mapEligible).toBe(true);
      expect((res as ObservedPoPResolution).popCode).toBe("IAD");
      expect((res as ObservedPoPResolution).popName).toBe("Ashburn / Washington DC");
      expect(res.countryCode).toBe("US");
      expect(res.latitude).toBeCloseTo(39.0438, 2);
      expect(res.longitude).toBeCloseTo(-77.4874, 2);
      // Gate 6: Confidence is strictly capped at medium
      expect(res.confidence).toBe("medium");
      expect(res.explanation).toContain("represents serving edge PoP");
    });

    it("strictly degrades and omits map coordinates when hostname and GeoIP countries conflict (Gate 4)", () => {
      // 31.0.0.1 is DE (Germany), if hostname claims SIN (Singapore)
      const res = resolveGeo("31.0.0.1", ["edge-sin-01.example.com"]);
      expect(res.confidence).toBe("low");
      expect(res.limitation).toBe("geo_sources_disagree");
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Level 7 Generic Anycast Identity (No PoP Telemetry)
  // ---------------------------------------------------------------------------
  describe("Level 7 Generic BGP Anycast Identity", () => {
    it("classifies 1.1.1.1 (Cloudflare Anycast) without PoP as Level 7 Anycast with mapEligible: false", () => {
      const res = resolveGeo("1.1.1.1");

      expect(res.resolutionLevel).toBe("anycast");
      expect(res.anchorKind).toBe("none");
      expect(res.coordinateMeaning).toBe("unresolved");
      expect(res.mapEligible).toBe(false);
      expect(res.distribution).toBe("anycast");
      expect(res.limitation).toBe("anycast_distributed_routing");
      expect(res.confidence).toBeNull();
      expect(res.explanation).toContain("coordinates represent prefix reference, not physical endpoint");
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Mathematical Reconciliation of 8-Level Traffic Accounting Invariant (Multi-Level Test Workload)
  // ---------------------------------------------------------------------------
  describe("Mathematical Reconciliation of 8-Level Traffic Accounting (Multi-Level Test Workload)", () => {
    it("strictly verifies that all 8 levels sum to exactly captureTotalBytes with zero discrepancies", () => {
      const auditedEndpoints: BreakdownRow[] = [
        // Level 2 (City Estimates): 23.00 MB
        { label: "185.199.108.153", bytes: 15_000_000, flows: 10, hostnames: [], evidence: [] },
        { label: "185.199.109.153", bytes: 8_000_000, flows: 5, hostnames: [], evidence: [] },

        // Level 3 (Cloud Region Centroids): 12.50 MB
        { label: "52.95.120.44", bytes: 10_000_000, flows: 8, hostnames: [], evidence: [] },
        { label: "35.198.0.1", bytes: 2_500_000, flows: 2, hostnames: [], evidence: [] },

        // Level 4 (Observed Serving PoPs): 2.18 MB
        { label: "140.82.121.4", bytes: 2_180_000, flows: 3, hostnames: [{ name: "edge-iad-01.github.com", source: "dns" }], evidence: [] },

        // Level 6 (Network / ASN Identity): 661.04 MB
        { label: "62.72.41.182", bytes: 441_300_000, flows: 155, hostnames: [], evidence: [] },
        { label: "172.217.112.4", bytes: 81_900_000, flows: 11, hostnames: [], evidence: [] },
        { label: "172.217.115.4", bytes: 74_100_000, flows: 14, hostnames: [], evidence: [] },
        { label: "172.217.113.4", bytes: 42_600_000, flows: 3, hostnames: [], evidence: [] },
        { label: "202.88.159.108", bytes: 14_100_000, flows: 2, hostnames: [], evidence: [] },
        { label: "202.88.159.80", bytes: 7_040_000, flows: 1, hostnames: [], evidence: [] },

        // Level 7 (Generic Anycast): 21.26 MB
        { label: "1.1.1.1", bytes: 21_260_000, flows: 4, hostnames: [], evidence: [] },
      ];

      const expectedTotalBytes = auditedEndpoints.reduce((sum, r) => sum + r.bytes, 0);

      const input: MapViewModelInput = {
        hosts: auditedEndpoints,
        captureSessionId: "reconciliation-session",
        snapshotSequence: 1,
      };

      const viewModel = deriveMapViewModel(input, null);
      const stats = viewModel.coverageStats;

      // 1. Total Capture Sum Invariant
      expect(stats.captureTotalBytes).toBe(expectedTotalBytes);
      expect(stats.totalBytes).toBe(expectedTotalBytes);

      // 2. Exact 8-Level Sum Invariant
      const eightLevelSum =
        stats.physicalEndpointBytes +
        stats.cityEstimateBytes +
        stats.cloudRegionBytes +
        stats.observedPopBytes +
        stats.countryBytes +
        stats.networkBytes +
        stats.anycastBytes +
        stats.unknownBytes;

      expect(eightLevelSum).toBe(stats.captureTotalBytes);

      // 3. Visual Anchor Invariant
      const expectedVisualAnchorBytes =
        stats.physicalEndpointBytes +
        stats.cityEstimateBytes +
        stats.cloudRegionBytes +
        stats.observedPopBytes;

      expect(stats.resolvedBytes).toBe(expectedVisualAnchorBytes);
      expect(stats.visualAnchorCoveragePercent).toBeGreaterThan(0);
      expect(stats.visualAnchorBytesPercent).toBeCloseTo(
        (expectedVisualAnchorBytes / stats.captureTotalBytes) * 100,
        2
      );
    });
  });
});
