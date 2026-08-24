import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveGeo,
  resolveAsn,
  resolveAnycast,
  enrichHost,
  clearGeoCaches,
  LOCAL_GEOIP_DB_VERSION,
  LOCAL_ASN_DB_VERSION,
} from "../geo/geoDatabase";
import { ANYCAST_PREFIXES } from "../geo/generatedAnycastPrefixes";
import { IPV4_GEO_INTERVALS } from "../geo/generatedGeoIntervals";
import { IPV4_ASN_INTERVALS } from "../geo/generatedAsnIntervals";
import type { BreakdownRow } from "@netpulse/contract";

// ---------------------------------------------------------------------------
// Group A: Special-use address guardrail
// Invariant: SPECIAL_USE_IP_MUST_NEVER_REACH_GEOIP_LOOKUP
// ---------------------------------------------------------------------------
describe("Group A -- Special-use address guardrail", () => {
  beforeEach(() => clearGeoCaches());

  const specialUse = [
    { ip: "192.168.1.1",  label: "RFC 1918 private" },
    { ip: "10.0.0.1",     label: "RFC 1918 private" },
    { ip: "172.16.0.1",   label: "RFC 1918 private" },
    { ip: "127.0.0.1",    label: "loopback" },
    { ip: "0.0.0.0",      label: "unspecified" },
    { ip: "255.255.255.255", label: "broadcast" },
    { ip: "169.254.0.1",  label: "link-local" },
    { ip: "224.0.0.1",    label: "multicast" },
    { ip: "240.0.0.1",    label: "reserved" },
    { ip: "100.64.0.1",   label: "CGNAT (RFC 6598)" },
    { ip: "192.0.2.1",    label: "documentation (TEST-NET-1)" },
    { ip: "198.51.100.1", label: "documentation (TEST-NET-2)" },
    { ip: "203.0.113.1",  label: "documentation (TEST-NET-3)" },
    { ip: "198.18.0.1",   label: "benchmarking" },
  ];

  for (const { ip, label } of specialUse) {
    it(`returns unresolved for ${label}: ${ip}`, () => {
      const res = resolveGeo(ip);
      expect(res.status, `${ip} must never resolve to coordinates`).toBe("unresolved");
      expect(res.locationMeaning).toBe("unresolved");
      expect(res.locationLevel).toBe("unresolved");
      expect(res.precisionDescription).toBe("unresolved");
      // No coordinates on unresolved results
      expect((res as Record<string, unknown>)["latitude"]).toBeUndefined();
      expect((res as Record<string, unknown>)["longitude"]).toBeUndefined();
    });
  }

  it("returns invalid_address for syntactically invalid IP", () => {
    for (const bad of ["not-an-ip", "999.0.0.1", "", "1.2.3"]) {
      const res = resolveGeo(bad);
      expect(res.status).toBe("unresolved");
      if (res.status === "unresolved") {
        expect(res.reason, `Expected invalid_address for "${bad}"`).toBe("invalid_address");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group B: IPv6 deferral (explicit v1 decision)
// ---------------------------------------------------------------------------
describe("Group B -- IPv6 explicit v1 deferral", () => {
  beforeEach(() => clearGeoCaches());

  const v6Public = ["2001:4860:4860::8888", "2606:4700:4700::1111", "2001:500:2::c"];

  for (const ip of v6Public) {
    it(`returns ipv6_deferred for public IPv6: ${ip}`, () => {
      const res = resolveGeo(ip);
      expect(res.status).toBe("unresolved");
      if (res.status === "unresolved") {
        expect(res.reason).toBe("ipv6_deferred");
      }
    });
  }

  it("does not return coordinates for any IPv6 address", () => {
    for (const ip of v6Public) {
      const res = resolveGeo(ip);
      expect((res as Record<string, unknown>)["latitude"]).toBeUndefined();
      expect((res as Record<string, unknown>)["longitude"]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Group C: Resolved result contract
// ---------------------------------------------------------------------------
describe("Group C -- Resolved result contract (structural assertions)", () => {
  beforeEach(() => clearGeoCaches());

  it("resolved result contains all required fields with correct types", () => {
    // Use 1.1.1.1 which is in our stub anycast dataset and therefore always anycast
    const res = resolveGeo("1.1.1.1");
    // 1.1.1.1 maps to stub anycast entry (1.1.1.0/24)
    // If geo stub is empty, this will be unresolved -- both outcomes are valid here
    if (res.status === "resolved") {
      expect(typeof res.country).toBe("string");
      expect(typeof res.countryCode).toBe("string");
      expect(/^[A-Z]{2}$/.test(res.countryCode)).toBe(true);
      expect(res.latitude).toBeGreaterThanOrEqual(-90);
      expect(res.latitude).toBeLessThanOrEqual(90);
      expect(res.longitude).toBeGreaterThanOrEqual(-180);
      expect(res.longitude).toBeLessThanOrEqual(180);
      expect(res.accuracyRadiusKm === null || typeof res.accuracyRadiusKm === "number").toBe(true);
      expect(["high", "medium", "low", null]).toContain(res.confidence);
      expect(["geoIpLocation", "anyCastPoP", "countryOnly"]).toContain(res.locationMeaning);
      expect(["city", "country"]).toContain(res.locationLevel);
      expect(["city-level estimate", "country-level estimate", "anycast reference location"])
        .toContain(res.precisionDescription);
      expect(res.source).toBe("local_database");
      expect(typeof res.geoDatabaseVersion).toBe("string");
      expect(res.geoDatabaseVersion.length).toBeGreaterThan(0);
    }
  });

  it("locationMeaning=anyCastPoP implies confidence=null", () => {
    // 1.1.1.1 is in stub anycast dataset so resolveAnycast returns isAnycast:true
    // If geo intervals are also populated, resolveGeo should produce anyCastPoP + null confidence
    const res = resolveGeo("1.1.1.1");
    if (res.status === "resolved" && res.locationMeaning === "anyCastPoP") {
      expect(res.confidence).toBeNull();
    }
  });

  it("locationMeaning=countryOnly implies confidence=low", () => {
    // Use resolveGeo on any non-anycast IP that has no city -- structural test
    // We verify the derivation rule holds by checking all resolved results
    const testIps = ["8.8.8.8", "9.9.9.9"];
    for (const ip of testIps) {
      const res = resolveGeo(ip);
      if (res.status === "resolved" && res.locationMeaning === "countryOnly") {
        expect(res.confidence).toBe("low");
      }
    }
  });

  it("anyCastPoP locationMeaning: coordinates are reference, not physical endpoint", () => {
    // Document the semantic contract -- UI must not present anyCastPoP as a physical location
    const res = resolveGeo("1.1.1.1");
    if (res.status === "resolved") {
      if (res.locationMeaning === "anyCastPoP") {
        expect(res.precisionDescription).toBe("anycast reference location");
        expect(res.confidence).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group D: Anycast classification (semantic correctness)
// ---------------------------------------------------------------------------
describe("Group D -- Anycast semantic classification", () => {
  beforeEach(() => clearGeoCaches());

  it("1.1.1.1 is classified as anycast with non-empty provider and source", () => {
    const result = resolveAnycast("1.1.1.1");
    expect(result.isAnycast).toBe(true);
    expect(result.provider).toBeTruthy();
    expect(result.provider!.trim().length).toBeGreaterThan(0);
    expect(result.source).toBeTruthy();
    // Structural assertions -- do not hardcode internal provider name format
    expect(result.prefixCidr).toBeTruthy(); // e.g. "1.1.1.0/24"
    expect(result.prefixCidr).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
  });

  it("private LAN IPs are not classified as anycast", () => {
    for (const ip of ["192.168.1.1", "10.0.0.1", "172.16.0.1"]) {
      const result = resolveAnycast(ip);
      // resolveAnycast calls parseIpv4ToUint32 -- private IPs parse fine
      // but ANYCAST_PREFIXES contains only public prefixes, so no match
      expect(result.source).toBe("generated-anycast-v1");
      // provider must be null if not anycast
      if (!result.isAnycast) {
        expect(result.provider).toBeNull();
        expect(result.prefixCidr).toBeNull();
      }
    }
  });

  it("anycast resolution is independent of geo resolution", () => {
    // resolveAnycast result must be consistent with the anycast field set by enrichHost
    const ip = "1.1.1.1";
    const anycastDirect = resolveAnycast(ip);
    const row: BreakdownRow = {
      label: ip, bytes: 100, flows: 1, hostnames: [], evidence: [],
    };
    const enriched = enrichHost(row, 0);
    expect(enriched.anycast.isAnycast).toBe(anycastDirect.isAnycast);
    expect(enriched.anycast.provider).toBe(anycastDirect.provider);
    expect(enriched.anycast.prefixCidr).toBe(anycastDirect.prefixCidr);
  });

  it("resolveGeo for anycast IP uses anyCastPoP locationMeaning when geo record present", () => {
    // Only applies when geo intervals are populated (full geoip:update)
    const geoRes = resolveGeo("1.1.1.1");
    const anyRes = resolveAnycast("1.1.1.1");
    if (geoRes.status === "resolved" && anyRes.isAnycast) {
      expect(geoRes.locationMeaning).toBe("anyCastPoP");
    }
  });
});

// ---------------------------------------------------------------------------
// Group E: Generated data integrity (C1-C13)
// ---------------------------------------------------------------------------
describe("Group E -- Generated data integrity (C1-C13)", () => {
  // Binary search helper -- mirrors runtime implementation
  function lookup(
    val: number,
    arr: [number, number, unknown][]
  ): [number, number, unknown] | null {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const [start, end] = arr[mid]!;
      if (val >= start && val <= end) return arr[mid]!;
      if (val < start) high = mid - 1;
      else low = mid + 1;
    }
    return null;
  }

  it("C1: start <= end for all intervals", () => {
    for (const [start, end] of IPV4_GEO_INTERVALS) {
      expect(start, `geo: start(${start}) > end(${end})`).toBeLessThanOrEqual(end);
    }
    for (const [start, end] of IPV4_ASN_INTERVALS) {
      expect(start, `asn: start(${start}) > end(${end})`).toBeLessThanOrEqual(end);
    }
    for (const p of ANYCAST_PREFIXES) {
      expect(p.start, `anycast: start(${p.start}) > end(${p.end})`).toBeLessThanOrEqual(p.end);
    }
  });

  it("C2: no overlapping intervals", () => {
    for (let i = 1; i < IPV4_GEO_INTERVALS.length; i++) {
      const [, prevEnd] = IPV4_GEO_INTERVALS[i - 1]!;
      const [curStart] = IPV4_GEO_INTERVALS[i]!;
      expect(prevEnd, `geo[${i}]: overlap`).toBeLessThan(curStart);
    }
    for (let i = 1; i < IPV4_ASN_INTERVALS.length; i++) {
      const [, prevEnd] = IPV4_ASN_INTERVALS[i - 1]!;
      const [curStart] = IPV4_ASN_INTERVALS[i]!;
      expect(prevEnd, `asn[${i}]: overlap`).toBeLessThan(curStart);
    }
  });

  it("C3: all values in uint32 range [0, 0xFFFFFFFF]", () => {
    for (const [s, e] of IPV4_GEO_INTERVALS) {
      expect(s >= 0 && e <= 0xFFFFFFFF).toBe(true);
    }
  });

  it("C6: intervals sorted ascending by start", () => {
    for (let i = 1; i < IPV4_GEO_INTERVALS.length; i++) {
      expect(IPV4_GEO_INTERVALS[i]![0]).toBeGreaterThan(IPV4_GEO_INTERVALS[i - 1]![0]);
    }
    for (let i = 1; i < IPV4_ASN_INTERVALS.length; i++) {
      expect(IPV4_ASN_INTERVALS[i]![0]).toBeGreaterThan(IPV4_ASN_INTERVALS[i - 1]![0]);
    }
  });

  it("C13: all start/end values are safe integers within uint32", () => {
    for (const [s, e] of IPV4_GEO_INTERVALS) {
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(Number.isSafeInteger(e)).toBe(true);
      expect(s >= 0 && s <= 0xFFFFFFFF).toBe(true);
      expect(e >= 0 && e <= 0xFFFFFFFF).toBe(true);
    }
    for (const p of ANYCAST_PREFIXES) {
      expect(Number.isSafeInteger(p.start)).toBe(true);
      expect(Number.isSafeInteger(p.end)).toBe(true);
      expect(p.start >= 0 && p.start <= 0xFFFFFFFF).toBe(true);
      expect(p.end >= 0 && p.end <= 0xFFFFFFFF).toBe(true);
    }
  });

  it("C12: every ANYCAST_PREFIXES entry has non-empty provider and source", () => {
    for (let i = 0; i < ANYCAST_PREFIXES.length; i++) {
      const p = ANYCAST_PREFIXES[i]!;
      expect(p.provider.trim().length, `anycast[${i}] empty provider`).toBeGreaterThan(0);
      expect(p.source.trim().length,   `anycast[${i}] empty source`).toBeGreaterThan(0);
    }
  });

  it("ANYCAST_PREFIXES is non-empty (runtime guard pre-condition)", () => {
    expect(ANYCAST_PREFIXES.length).toBeGreaterThan(0);
  });

  it("[i].end is in interval[i] and [i+1].start is in interval[i+1] for adjacent pairs", () => {
    // Only tests address-space adjacent pairs: interval[i].end + 1 === interval[i+1].start
    for (let i = 0; i + 1 < IPV4_GEO_INTERVALS.length; i++) {
      const [, curEnd] = IPV4_GEO_INTERVALS[i]!;
      const [nextStart] = IPV4_GEO_INTERVALS[i + 1]!;
      // Only enter assertion for truly adjacent pairs
      if (((curEnd + 1) >>> 0) !== nextStart) continue;
      // curEnd must binary-search to interval[i]
      const foundCur = lookup(curEnd, IPV4_GEO_INTERVALS as [number, number, unknown][]);
      expect(foundCur).toBe(IPV4_GEO_INTERVALS[i]);
      // nextStart must binary-search to interval[i+1]
      const foundNext = lookup(nextStart, IPV4_GEO_INTERVALS as [number, number, unknown][]);
      expect(foundNext).toBe(IPV4_GEO_INTERVALS[i + 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Group F: AsnResolution contract
// ---------------------------------------------------------------------------
describe("Group F -- AsnResolution contract", () => {
  beforeEach(() => clearGeoCaches());

  it("resolved ASN has non-negative asn and non-empty asOrg", () => {
    // With stub intervals this will likely be unresolved -- test the type contract
    const res = resolveAsn("1.1.1.1");
    if (res.status === "resolved") {
      expect(res.asn).toBeGreaterThanOrEqual(0);
      expect(res.asOrg.trim().length).toBeGreaterThan(0);
      expect(res.source).toBe("local_database");
      expect(typeof res.asnDatabaseVersion).toBe("string");
    }
    if (res.status === "unresolved") {
      expect(["no_database", "no_match", "invalid_address"]).toContain(res.reason);
    }
  });

  it("special-use IPs return unresolved ASN with no_match reason", () => {
    const res = resolveAsn("192.168.1.1");
    expect(res.status).toBe("unresolved");
    if (res.status === "unresolved") {
      expect(res.reason).toBe("no_match");
    }
  });

  it("invalid IP returns invalid_address reason from resolveAsn", () => {
    const res = resolveAsn("not-valid");
    expect(res.status).toBe("unresolved");
    if (res.status === "unresolved") {
      expect(res.reason).toBe("invalid_address");
    }
  });
});

// ---------------------------------------------------------------------------
// Group G: enrichHost contract
// ---------------------------------------------------------------------------
describe("Group G -- enrichHost produces complete EnrichedHost", () => {
  beforeEach(() => clearGeoCaches());

  it("enrichHost sets all required fields on the result", () => {
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
    expect(enriched.classification.version).toBe(4);
    expect(enriched.geo.status === "resolved" || enriched.geo.status === "unresolved").toBe(true);
    expect(enriched.asn.status === "resolved" || enriched.asn.status === "unresolved").toBe(true);
    // anycast must always be populated
    expect(typeof enriched.anycast.isAnycast).toBe("boolean");
    expect(enriched.anycast.source).toBe("generated-anycast-v1");
    expect(enriched.freshness).toBe("active");
    expect(enriched.deltaBytes).toBe(1024);
    expect(enriched.evidence).toEqual([{ kind: "flow", id: 42 }]);
    expect(enriched.bytes).toBe(1048576);
    expect(enriched.flows).toBe(8);
  });

  it("enrichHost freshness: active when deltaBytes > 0", () => {
    const row: BreakdownRow = { label: "8.8.8.8", bytes: 500, flows: 1, hostnames: [], evidence: [] };
    expect(enrichHost(row, 1).freshness).toBe("active");
  });

  it("enrichHost freshness: recent when bytes > 0 and deltaBytes === 0", () => {
    const row: BreakdownRow = { label: "8.8.8.8", bytes: 500, flows: 1, hostnames: [], evidence: [] };
    expect(enrichHost(row, 0).freshness).toBe("recent");
  });

  it("enrichHost freshness: stale when bytes === 0 and deltaBytes === 0", () => {
    const row: BreakdownRow = { label: "8.8.8.8", bytes: 0, flows: 0, hostnames: [], evidence: [] };
    expect(enrichHost(row, 0).freshness).toBe("stale");
  });

  it("enrichHost for private IP: geo and asn are unresolved, anycast is not-anycast", () => {
    const row: BreakdownRow = { label: "192.168.0.1", bytes: 100, flows: 1, hostnames: [], evidence: [] };
    const enriched = enrichHost(row, 0);
    expect(enriched.geo.status).toBe("unresolved");
    expect(enriched.asn.status).toBe("unresolved");
    expect(enriched.anycast.isAnycast).toBe(false);
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

