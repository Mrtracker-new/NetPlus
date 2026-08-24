import { describe, it, expect } from "vitest";
import {
  classifyIpAddress,
  parseIpv4ToUint32,
  parseIpv6ToHextets,
  validateIpv6SpecialPrefixTable,
  IPV6_SPECIAL_PREFIX_TABLE,
  EXPECTED_IANA_CURRENT_PREFIXES,
  IPV6_IANA_REGISTRY_SNAPSHOT,
} from "@netpulse/viz";

describe("IP Classification Module (RFC 6890 / 1918 / 4193 / 4291 / 5952 / 3927 / 6598)", () => {
  describe("parseIpv4ToUint32", () => {
    it("correctly parses valid IPv4 strings to integers", () => {
      expect(parseIpv4ToUint32("0.0.0.0")).toBe(0);
      expect(parseIpv4ToUint32("127.0.0.1")).toBe(0x7f000001);
      expect(parseIpv4ToUint32("255.255.255.255")).toBe(0xffffffff);
      expect(parseIpv4ToUint32("192.168.1.1")).toBe(0xc0a80101);
    });

    it("rejects invalid IPv4 strings", () => {
      expect(parseIpv4ToUint32("")).toBeNull();
      expect(parseIpv4ToUint32("256.0.0.1")).toBeNull();
      expect(parseIpv4ToUint32("1.2.3")).toBeNull();
      expect(parseIpv4ToUint32("1.2.3.4.5")).toBeNull();
      expect(parseIpv4ToUint32("01.02.03.04")).toBeNull();
      expect(parseIpv4ToUint32("abc.def.ghi.jkl")).toBeNull();
    });
  });

  describe("parseIpv6ToHextets (RFC 4291 Strict IPv6 Parser)", () => {
    it("parses full 8-hextet strings without compression", () => {
      expect(parseIpv6ToHextets("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toEqual([
        0x2001, 0x0db8, 0x85a3, 0x0000, 0x0000, 0x8a2e, 0x0370, 0x7334,
      ]);
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("parses zero-compressed addresses with ::", () => {
      expect(parseIpv6ToHextets("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(parseIpv6ToHextets("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIpv6ToHextets("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
      expect(parseIpv6ToHextets("1::1")).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIpv6ToHextets("2001:db8::1")).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
      expect(parseIpv6ToHextets("1::2:3")).toEqual([1, 0, 0, 0, 0, 0, 2, 3]);
    });

    it("parses embedded IPv4 dotted-quad syntax", () => {
      expect(parseIpv6ToHextets("::ffff:192.168.1.1")).toEqual([
        0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101,
      ]);
      expect(parseIpv6ToHextets("64:ff9b::192.0.2.33")).toEqual([
        0x0064, 0xff9b, 0, 0, 0, 0, 0xc000, 0x0221,
      ]);
      expect(parseIpv6ToHextets("::192.168.1.1")).toEqual([
        0, 0, 0, 0, 0, 0, 0xc0a8, 0x0101,
      ]);
    });

    it("handles bracketed IPv6 notation and scoped zone identifiers (RFC 4007)", () => {
      expect(parseIpv6ToHextets("[2001:db8::1]")).toEqual([
        0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
      ]);
      expect(parseIpv6ToHextets("fe80::1%eth0")).toEqual([
        0xfe80, 0, 0, 0, 0, 0, 0, 1,
      ]);
    });
  });

  describe("Table Integrity Validation", () => {
    it("passes all integrity checks on the canonical IPV6_SPECIAL_PREFIX_TABLE", () => {
      const errors = validateIpv6SpecialPrefixTable();
      expect(errors).toEqual([]);
    });

    it(`verifies registry snapshot date ${IPV6_IANA_REGISTRY_SNAPSHOT}`, () => {
      expect(IPV6_IANA_REGISTRY_SNAPSHOT).toBe("2025-10-09");
    });

    it("verifies all expected current IANA prefixes exist in the table", () => {
      const tablePrefixes = new Set(IPV6_SPECIAL_PREFIX_TABLE.map((r: { prefix: string }) => r.prefix));
      for (const expected of EXPECTED_IANA_CURRENT_PREFIXES) {
        expect(tablePrefixes.has(expected)).toBe(true);
      }
    });
  });

  describe("Longest-Prefix Matching & Precedence Hierarchy", () => {
    it("resolves 2001:1::1 to /128 Port Control Protocol Anycast", () => {
      const c = classifyIpAddress("2001:1::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Port Control Protocol Anycast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:1::2 to /128 TURN Anycast", () => {
      const c = classifyIpAddress("2001:1::2");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("TURN Anycast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:1::3 to /128 DNS-SD SRP Anycast (RFC 9665)", () => {
      const c = classifyIpAddress("2001:1::3");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("DNS-SD SRP Anycast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(false);
    });

    it("resolves 100:0:0:1::1 to /64 Dummy IPv6 Prefix (RFC 9780) vs 100::1 to /64 Discard-Only", () => {
      const cDummy = classifyIpAddress("100:0:0:1::1");
      expect(cDummy.category).toBe("special");
      expect(cDummy.categoryLabel).toBe("Dummy IPv6 Prefix");
      expect(cDummy.isPublic).toBe(false);

      const cDiscard = classifyIpAddress("100::1");
      expect(cDiscard.category).toBe("special");
      expect(cDiscard.categoryLabel).toBe("Discard-Only Address Block");
      expect(cDiscard.isPublic).toBe(false);
    });

    it("resolves 2001:db8::1 to /32 Documentation", () => {
      const c = classifyIpAddress("2001:db8::1");
      expect(c.category).toBe("documentation");
      expect(c.categoryLabel).toBe("Documentation Address");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 3fff::1 to /20 Documentation (RFC 9637)", () => {
      const c = classifyIpAddress("3fff::1");
      expect(c.category).toBe("documentation");
      expect(c.categoryLabel).toBe("Documentation Address");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 5f00::1 to /16 SRv6 SID Block (RFC 9602)", () => {
      const c = classifyIpAddress("5f00::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("SRv6 SID Block");
      expect(c.isPublic).toBe(false);
    });

    it("classifies Google DNS 2001:4860:4860::8888 as Global Unicast (outside 2001::/23)", () => {
      const c = classifyIpAddress("2001:4860:4860::8888");
      expect(c.category).toBe("public");
      expect(c.isPublic).toBe(true);
      expect(c.isLocalLan).toBe(false);
    });
  });

  describe("Historical / Deprecated Prefixes and Delegated Embedded IPv4", () => {
    it("delegates ::ffff:192.168.1.1 (IPv4-Mapped) to embedded IPv4 classifier", () => {
      const cPrivate = classifyIpAddress("::ffff:192.168.1.1");
      expect(cPrivate.category).toBe("private");
      expect(cPrivate.isLocalLan).toBe(true);
      expect(cPrivate.isPublic).toBe(false);
      expect(cPrivate.version).toBe(6);
    });

    it("delegates ::ffff:8.8.8.8 (IPv4-Mapped) to embedded IPv4 classifier", () => {
      const cPublic = classifyIpAddress("::ffff:8.8.8.8");
      expect(cPublic.category).toBe("public");
      expect(cPublic.isPublic).toBe(true);
      expect(cPublic.isLocalLan).toBe(false);
      expect(cPublic.version).toBe(6);
    });

    it("correctly distinguishes ::/128 Unspecified, ::1/128 Loopback, and ::/96 Deprecated IPv4-Compatible", () => {
      const cUnspec = classifyIpAddress("::");
      expect(cUnspec.category).toBe("unspecified");

      const cLoop = classifyIpAddress("::1");
      expect(cLoop.category).toBe("loopback");

      const cCompat = classifyIpAddress("::192.168.1.1");
      expect(cCompat.category).toBe("private");
      expect(cCompat.isLocalLan).toBe(true);
      expect(cCompat.version).toBe(6);
    });
  });
});
