import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveGeo,
  resolveAsn,
  resolveAnycast,
  enrichHost,
  clearGeoCaches,
} from "@netpulse/viz";
import type { BreakdownRow } from "@netpulse/contract";

/**
 * App-layer smoke tests for @netpulse/viz geo resolution exports.
 * These tests assert the public contract of the module as seen by consumers.
 * They do NOT re-test internal invariants (see viz package tests for C1-C13).
 */
describe("GeoIP & ASN Resolution -- @netpulse/app consumer contract", () => {
  beforeEach(() => clearGeoCaches());

  // -------------------------------------------------------------------------
  // Structural: unresolved states
  // -------------------------------------------------------------------------

  it("private LAN IPs always return unresolved geo -- never coordinates", () => {
    for (const ip of ["192.168.1.1", "10.0.0.1", "172.16.0.1", "127.0.0.1"]) {
      const res = resolveGeo(ip);
      expect(res.status, `${ip} must not resolve`).toBe("unresolved");
      expect((res as unknown as Record<string, unknown>)["latitude"]).toBeUndefined();
      expect((res as unknown as Record<string, unknown>)["longitude"]).toBeUndefined();
    }
  });

  it("public IPv6 returns ipv6_deferred reason (explicit v1 decision)", () => {
    const res = resolveGeo("2001:4860:4860::8888");
    expect(res.status).toBe("unresolved");
    if (res.status === "unresolved") {
      expect(res.reason).toBe("ipv6_deferred");
    }
  });

  it("invalid IP syntax returns invalid_address", () => {
    const res = resolveGeo("not-an-ip");
    expect(res.status).toBe("unresolved");
    if (res.status === "unresolved") {
      expect(res.reason).toBe("invalid_address");
    }
  });

  // -------------------------------------------------------------------------
  // Structural: resolved results (stub-safe assertions)
  // -------------------------------------------------------------------------

  it("resolved geo contains valid coordinate range and required fields", () => {
    // This test runs against the stub or real dataset -- assertions are structure-only
    const testIps = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
    for (const ip of testIps) {
      const res = resolveGeo(ip);
      if (res.status === "resolved") {
        expect(/^[A-Z]{2}$/.test(res.countryCode)).toBe(true);
        expect(res.latitude).toBeGreaterThanOrEqual(-90);
        expect(res.latitude).toBeLessThanOrEqual(90);
        expect(res.longitude).toBeGreaterThanOrEqual(-180);
        expect(res.longitude).toBeLessThanOrEqual(180);
        expect(["geoIpLocation", "anyCastPoP", "countryOnly"]).toContain(res.locationMeaning);
        expect(["city", "country"]).toContain(res.locationLevel);
        expect(["high", "medium", "low", null]).toContain(res.confidence);
        expect(res.source).toBe("local_database");
        expect(res.geoDatabaseVersion.length).toBeGreaterThan(0);
        // precisionDescription must never be freeform prose -- it is an enum value
        expect([
          "city-level estimate",
          "country-level estimate",
          "anycast reference location",
        ]).toContain(res.precisionDescription);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Anycast: 1.1.1.0/24 spot-check
  // -------------------------------------------------------------------------

  it("1.1.1.1 is classified as anycast with non-empty prefixCidr and provider", () => {
    const result = resolveAnycast("1.1.1.1");
    expect(result.isAnycast).toBe(true);
    // Structural assertions -- do not hardcode provider string
    expect(result.prefixCidr).toBeTruthy();
    expect(result.prefixCidr).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
    expect(result.provider).toBeTruthy();
    expect(result.provider!.trim().length).toBeGreaterThan(0);
    expect(result.source).toBeTruthy();
  });

  it("anycast IPs have anyCastPoP locationMeaning when geo is present", () => {
    const geoRes = resolveGeo("1.1.1.1");
    const anyRes = resolveAnycast("1.1.1.1");
    if (geoRes.status === "resolved" && anyRes.isAnycast) {
      expect(geoRes.locationMeaning).toBe("anyCastPoP");
      // Confidence must be null for anycast -- it is not a physical endpoint
      expect(geoRes.confidence).toBeNull();
      expect(geoRes.precisionDescription).toBe("anycast reference location");
    }
  });

  // -------------------------------------------------------------------------
  // ASN contract
  // -------------------------------------------------------------------------

  it("ASN resolution returns correct field names (not legacy databaseVersion)", () => {
    const res = resolveAsn("1.1.1.1");
    // The field is asnDatabaseVersion, not the legacy databaseVersion
    expect((res as Record<string, unknown>)["databaseVersion"]).toBeUndefined();
    if (res.status === "resolved") {
      expect(typeof res.asnDatabaseVersion).toBe("string");
    } else {
      expect(res.asnDatabaseVersion === null || typeof res.asnDatabaseVersion === "string")
        .toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // enrichHost: complete EnrichedHost shape
  // -------------------------------------------------------------------------

  it("enrichHost always populates the anycast field", () => {
    const row: BreakdownRow = {
      label: "1.1.1.1",
      bytes: 1048576,
      flows: 8,
      hostnames: [{ name: "one.one.one.one", source: "dns" }],
      evidence: [{ kind: "flow", id: 42 }],
    };
    const enriched = enrichHost(row, 1024);
    expect(enriched.ip).toBe("1.1.1.1");
    expect(enriched.classification.isPublic).toBe(true);
    // anycast must always be populated -- never absent from EnrichedHost
    expect(typeof enriched.anycast).toBe("object");
    expect(typeof enriched.anycast.isAnycast).toBe("boolean");
    expect(enriched.anycast.source).toBe("generated-anycast-v1");
    expect(enriched.freshness).toBe("active");
    expect(enriched.deltaBytes).toBe(1024);
    expect(enriched.evidence).toEqual([{ kind: "flow", id: 42 }]);
  });

  it("enrichHost for private IP: geo unresolved, anycast is non-anycast", () => {
    const row: BreakdownRow = {
      label: "192.168.1.100",
      bytes: 200,
      flows: 2,
      hostnames: [],
      evidence: [],
    };
    const enriched = enrichHost(row, 0);
    expect(enriched.geo.status).toBe("unresolved");
    expect(enriched.asn.status).toBe("unresolved");
    expect(enriched.anycast.isAnycast).toBe(false);
    expect(enriched.anycast.provider).toBeNull();
    expect(enriched.anycast.prefixCidr).toBeNull();
  });

  it("enrichHost freshness transitions are correct", () => {
    const row: BreakdownRow = { label: "8.8.8.8", bytes: 500, flows: 1, hostnames: [], evidence: [] };
    expect(enrichHost(row, 1).freshness).toBe("active");
    expect(enrichHost(row, 0).freshness).toBe("recent");
    const empty: BreakdownRow = { label: "8.8.8.8", bytes: 0, flows: 0, hostnames: [], evidence: [] };
    expect(enrichHost(empty, 0).freshness).toBe("stale");
  });

  it("enrichHost derives lastSeenTs strictly from telemetry metadata / timestamp, defaulting to 0", () => {
    const row: BreakdownRow = { label: "1.1.1.1", bytes: 1000, flows: 1, hostnames: [], evidence: [] };
    
    // Default timestamp is 0 (never evaluation wall-clock Date.now())
    const defaultEnriched = enrichHost(row, 0);
    expect(defaultEnriched.lastSeenTs).toBe(0);

    // Explicit telemetry metadata timestamp
    const explicitEnriched = enrichHost(row, 100, 1_700_000_000_123);
    expect(explicitEnriched.lastSeenTs).toBe(1_700_000_000_123);
  });

  it("enrichHost is purely deterministic across consecutive invocations without wall-clock drift", () => {
    const row: BreakdownRow = { label: "8.8.8.8", bytes: 5000, flows: 3, hostnames: [], evidence: [] };
    const first = enrichHost(row, 500, 1_700_000_000_000);

    for (let i = 0; i < 50; i++) {
      const reEval = enrichHost(row, 500, 1_700_000_000_000);
      expect(reEval).toEqual(first);
      expect(reEval.lastSeenTs).toBe(1_700_000_000_000);
    }
  });
});
