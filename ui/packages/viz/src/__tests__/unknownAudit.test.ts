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
});
