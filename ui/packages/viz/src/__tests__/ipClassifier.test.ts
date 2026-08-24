import { describe, it, expect } from "vitest";
import {
  classifyIpAddress,
  classifyIpv6,
  formatIpv6Canonical,
  inIpv6Range,
  parseIpv4ToUint32,
  parseIpv6ToHextets,
  findLongestIpv6PrefixMatch,
  validateIpv6SpecialPrefixTable,
  IPV6_SPECIAL_PREFIX_TABLE,
  EXPECTED_IANA_CURRENT_PREFIXES,
  IPV6_IANA_REGISTRY_SNAPSHOT,
  type Ipv6Hextets,
} from "../geo/ipClassifier";

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
      expect(parseIpv4ToUint32("01.02.03.04")).toBeNull(); // leading zero disallowed
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
      expect(parseIpv6ToHextets("::ffff:0.0.0.0")).toEqual([
        0, 0, 0, 0, 0, 0xffff, 0, 0,
      ]);
      expect(parseIpv6ToHextets("::ffff:255.255.255.255")).toEqual([
        0, 0, 0, 0, 0, 0xffff, 0xffff, 0xffff,
      ]);
      expect(parseIpv6ToHextets("::255.255.255.255")).toEqual([
        0, 0, 0, 0, 0, 0, 0xffff, 0xffff,
      ]);
      expect(parseIpv6ToHextets("2001:db8::192.0.2.1")).toEqual([
        0x2001, 0x0db8, 0, 0, 0, 0, 0xc000, 0x0201,
      ]);
      expect(parseIpv6ToHextets("1:2:3:4:5:6:192.168.1.1")).toEqual([
        1, 2, 3, 4, 5, 6, 0xc0a8, 0x0101,
      ]);
    });

    it("handles bracketed IPv6 notation and scoped zone identifiers (RFC 4007)", () => {
      expect(parseIpv6ToHextets("[2001:db8::1]")).toEqual([
        0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
      ]);
      expect(parseIpv6ToHextets("fe80::1%eth0")).toEqual([
        0xfe80, 0, 0, 0, 0, 0, 0, 1,
      ]);
      expect(parseIpv6ToHextets("fe80::1%1")).toEqual([
        0xfe80, 0, 0, 0, 0, 0, 0, 1,
      ]);
      expect(parseIpv6ToHextets("[fe80::1%eth0]")).toEqual([
        0xfe80, 0, 0, 0, 0, 0, 0, 1,
      ]);
    });

    it("rejects historical shape-recognition bug vectors and malformed addresses", () => {
      // Historical bug cases: short strings with colons must never pass
      expect(parseIpv6ToHextets("1:2:3")).toBeNull();
      expect(parseIpv6ToHextets("12:34:56")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7:8:9")).toBeNull();

      // Colon syntax errors
      expect(parseIpv6ToHextets(":")).toBeNull();
      expect(parseIpv6ToHextets(":::")).toBeNull();
      expect(parseIpv6ToHextets(":::1")).toBeNull();
      expect(parseIpv6ToHextets("1:::")).toBeNull();
      expect(parseIpv6ToHextets("::::")).toBeNull();
      expect(parseIpv6ToHextets("1:2::3::4")).toBeNull();
      expect(parseIpv6ToHextets(":1:2:3:4:5:6:7:8")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7:8:")).toBeNull();
      expect(parseIpv6ToHextets(":1::2")).toBeNull();
      expect(parseIpv6ToHextets("1::2:")).toBeNull();

      // Invariant: :: must compress at least one hextet (< 8 explicit)
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7:8::")).toBeNull();
      expect(parseIpv6ToHextets("::1:2:3:4:5:6:7:8")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7::8")).toBeNull();

      // Hex digit errors
      expect(parseIpv6ToHextets("00000::1")).toBeNull();
      expect(parseIpv6ToHextets("gggg::1")).toBeNull();
      expect(parseIpv6ToHextets("1:gggg:2::3")).toBeNull();

      // Bracket errors
      expect(parseIpv6ToHextets("[2001:db8::1")).toBeNull();
      expect(parseIpv6ToHextets("2001:db8::1]")).toBeNull();
      expect(parseIpv6ToHextets("2001:db8:[::1]")).toBeNull();

      // Invalid embedded IPv4
      expect(parseIpv6ToHextets("::ffff:256.1.1.1")).toBeNull();
      expect(parseIpv6ToHextets("::ffff:1.2.3")).toBeNull();
      expect(parseIpv6ToHextets("::ffff:1.2.3.4.5")).toBeNull();
      expect(parseIpv6ToHextets("::ffff:01.2.3.4")).toBeNull();
      expect(parseIpv6ToHextets("::ffff:1.2.3.999")).toBeNull();
      expect(parseIpv6ToHextets("::ffff:abc.def.ghi.jkl")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:6:7:192.168.1.1")).toBeNull();
      expect(parseIpv6ToHextets("1:2:3:4:5:192.168.1.1")).toBeNull();

      // Zone ID errors
      expect(parseIpv6ToHextets("fe80::1%")).toBeNull();
      expect(parseIpv6ToHextets("fe80::1%eth 0")).toBeNull();
    });
  });

  describe("formatIpv6Canonical (RFC 5952 Canonical Formatter)", () => {
    it("formats all-zeros to ::", () => {
      expect(formatIpv6Canonical([0, 0, 0, 0, 0, 0, 0, 0])).toBe("::");
    });

    it("formats loopback to ::1", () => {
      expect(formatIpv6Canonical([0, 0, 0, 0, 0, 0, 0, 1])).toBe("::1");
    });

    it("removes leading zeroes in hextets and compresses longest zero run", () => {
      expect(
        formatIpv6Canonical([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])
      ).toBe("2001:db8::1");
    });

    it("compresses leftmost zero run when runs have equal length (RFC 5952 §4.2.3)", () => {
      expect(
        formatIpv6Canonical([0x2001, 0x0db8, 0, 0, 1, 0, 0, 1])
      ).toBe("2001:db8::1:0:0:1");
    });

    it("compresses longest zero run even when not leftmost", () => {
      expect(
        formatIpv6Canonical([0x2001, 0x0db8, 0, 1, 0, 0, 2, 3])
      ).toBe("2001:db8:0:1::2:3");
    });

    it("never compresses a single zero hextet (RFC 5952 §4.2.2)", () => {
      expect(
        formatIpv6Canonical([0x2001, 0x0db8, 0, 1, 1, 1, 1, 1])
      ).toBe("2001:db8:0:1:1:1:1:1");
    });

    it("operates purely on 8-hextet values for IPv4-mapped representation", () => {
      expect(
        formatIpv6Canonical([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101])
      ).toBe("::ffff:c0a8:101");
    });
  });

  describe("Table Integrity Validation (validateIpv6SpecialPrefixTable)", () => {
    it("passes all integrity checks on the canonical IPV6_SPECIAL_PREFIX_TABLE", () => {
      const errors = validateIpv6SpecialPrefixTable();
      expect(errors).toEqual([]);
    });

    it(`verifies registry snapshot date ${IPV6_IANA_REGISTRY_SNAPSHOT}`, () => {
      expect(IPV6_IANA_REGISTRY_SNAPSHOT).toBe("2025-10-09");
    });

    it("verifies all expected current IANA prefixes exist in the table", () => {
      const tablePrefixes = new Set(IPV6_SPECIAL_PREFIX_TABLE.map((r) => r.prefix));
      for (const expected of EXPECTED_IANA_CURRENT_PREFIXES) {
        expect(tablePrefixes.has(expected)).toBe(true);
      }
    });

    it("flags non-canonical bases with non-zero host bits", () => {
      const dirtyRule = {
        prefix: "2001:db8:1234::/32",
        base: [0x2001, 0x0db8, 0x1234, 0, 0, 0, 0, 0] as unknown as Ipv6Hextets,
        prefixLength: 32,
        category: "documentation" as const,
        label: "Dirty Documentation",
        description: "Test dirty rule",
        rfc: ["RFC3849"],
        source: false,
        destination: false,
        forwardable: false,
        globallyReachable: false,
        reservedByProtocol: false,
        status: "iana-current" as const,
        handling: "direct" as const,
      };

      const errors = validateIpv6SpecialPrefixTable([dirtyRule]);
      expect(errors.some((e) => e.reason.includes("non-zero host bits"))).toBe(true);
    });

    it("flags prefix length ordering violations", () => {
      const reversedTable = [...IPV6_SPECIAL_PREFIX_TABLE].reverse();
      const errors = validateIpv6SpecialPrefixTable(reversedTable);
      expect(errors.some((e) => e.reason.includes("Out of order"))).toBe(true);
    });
  });

  describe("Data-Driven Coverage: Every Rule in IPV6_SPECIAL_PREFIX_TABLE", () => {
    for (const rule of IPV6_SPECIAL_PREFIX_TABLE) {
      it(`matches and classifies representative address for rule ${rule.prefix} (${rule.label})`, () => {
        // For parent prefixes whose base address (host bits = 0) is allocated to a more specific
        // child prefix (e.g. :: for ::/96 which contains ::/128, or 2001:: for 2001::/23 which contains 2001::/32),
        // we use a representative address within the prefix that is not shadowed by a child rule.
        let testHextets: Ipv6Hextets = rule.base;
        if (rule.prefix === "::/96") {
          testHextets = [0, 0, 0, 0, 0, 0, 0xc0a8, 0x0101]; // ::192.168.1.1
        } else if (rule.prefix === "2001::/23") {
          testHextets = [0x2001, 0x0100, 0, 0, 0, 0, 0, 1]; // 2001:100::1
        }

        const match = findLongestIpv6PrefixMatch(testHextets);
        expect(match).not.toBeNull();
        expect(match!.prefix).toBe(rule.prefix);
        expect(match!.status).toBe(rule.status);
        expect(match!.handling).toBe(rule.handling);

        const canonical = formatIpv6Canonical(testHextets);
        const classification = classifyIpAddress(canonical);
        expect(classification.version).toBe(6);

        if (rule.handling === "direct") {
          expect(classification.category).toBe(rule.category);
          expect(classification.isPublic).toBe(rule.globallyReachable);
        }
      });
    }
  });

  describe("Longest-Prefix Matching & Precedence Hierarchy", () => {
    it("resolves 2001:1::1 to /128 Port Control Protocol Anycast over /32 and /23", () => {
      const c = classifyIpAddress("2001:1::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Port Control Protocol Anycast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:1::2 to /128 TURN Anycast over /32 and /23", () => {
      const c = classifyIpAddress("2001:1::2");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("TURN Anycast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:1::3 to /128 DNS-SD SRP Anycast (RFC 9665) over /32 and /23", () => {
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

    it("resolves 2001:db8::1 to /32 Documentation over /23 and /3", () => {
      const c = classifyIpAddress("2001:db8::1");
      expect(c.category).toBe("documentation");
      expect(c.categoryLabel).toBe("Documentation Address");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 2001:30::1 to /28 Drone Remote ID Protocol (RFC 9374) over /23", () => {
      const c = classifyIpAddress("2001:30::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Drone Remote ID Protocol");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 2001:2::1 to /48 Benchmarking over /23 and /3", () => {
      const c = classifyIpAddress("2001:2::1");
      expect(c.category).toBe("benchmarking");
      expect(c.categoryLabel).toBe("Benchmarking Network");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 2001:3::1 to /32 Automatic Multicast Tunneling (RFC 7450) over /23", () => {
      const c = classifyIpAddress("2001:3::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Automatic Multicast Tunneling");
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:5::1 to /32 LISP EID Block (RFC 7954) over /23", () => {
      const c = classifyIpAddress("2001:5::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("LISP EID Block");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 2001:4:112::1 to /48 AS112-v6 (RFC 7535) over /23", () => {
      const c = classifyIpAddress("2001:4:112::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("AS112-v6 DNS Service");
      expect(c.isPublic).toBe(true);
    });

    it("resolves 2001:20::1 to /28 ORCHIDv2 (RFC 7343) over /23", () => {
      const c = classifyIpAddress("2001:20::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("ORCHIDv2 Overlay");
      expect(c.isPublic).toBe(false);
    });

    it("resolves 2001:100::1 to /23 IETF Protocol Assignments (RFC 2928)", () => {
      const c = classifyIpAddress("2001:100::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("IETF Protocol Assignments");
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

    it("resolves 2620:4f:8000::1 to /48 Direct Delegation AS112 Service (RFC 7535)", () => {
      const c = classifyIpAddress("2620:4f:8000::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Direct Delegation AS112 Service");
      expect(c.isPublic).toBe(true);
    });
  });

  describe("General Address Space & 2000::/3 Global Unicast Boundaries", () => {
    it("classifies Google DNS 2001:4860:4860::8888 as Global Unicast (outside 2001::/23)", () => {
      const c = classifyIpAddress("2001:4860:4860::8888");
      expect(c.category).toBe("public");
      expect(c.isPublic).toBe(true);
      expect(c.isLocalLan).toBe(false);
      expect(c.categoryLabel).toBe("Public IPv6 Address");
    });

    it("classifies Cloudflare DNS 2606:4700:4700::1111 as Global Unicast", () => {
      const c = classifyIpAddress("2606:4700:4700::1111");
      expect(c.category).toBe("public");
      expect(c.isPublic).toBe(true);
    });

    it("verifies 2000::/3 boundaries", () => {
      // Exactly at start of 2000::/3
      const cStart = classifyIpAddress("2000::1");
      expect(cStart.category).toBe("public");
      expect(cStart.isPublic).toBe(true);

      // Mid-range 3000::1 (inside 2000::/3)
      const cMid = classifyIpAddress("3000::1");
      expect(cMid.category).toBe("public");
      expect(cMid.isPublic).toBe(true);

      // Immediately before 2000::/3 (1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
      const cBefore = classifyIpAddress("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
      expect(cBefore.category).toBe("reserved");
      expect(cBefore.isPublic).toBe(false);

      // Immediately after 2000::/3 (4000::1)
      const cAfter = classifyIpAddress("4000::1");
      expect(cAfter.category).toBe("reserved");
      expect(cAfter.isPublic).toBe(false);
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
      // :: matches ::/128 (Unspecified) first, NOT ::/96
      const cUnspec = classifyIpAddress("::");
      expect(cUnspec.category).toBe("unspecified");
      expect(cUnspec.categoryLabel).toBe("Unspecified Address");

      // ::1 matches ::1/128 (Loopback) first, NOT ::/96
      const cLoop = classifyIpAddress("::1");
      expect(cLoop.category).toBe("loopback");
      expect(cLoop.categoryLabel).toBe("Loopback Interface");

      // ::192.168.1.1 matches ::/96 (IPv4-compatible)
      const cCompat = classifyIpAddress("::192.168.1.1");
      expect(cCompat.category).toBe("private");
      expect(cCompat.isLocalLan).toBe(true);
      expect(cCompat.version).toBe(6);
    });

    it("identifies deprecated site-local fec0::/10", () => {
      const c = classifyIpAddress("fec0::1");
      expect(c.category).toBe("reserved");
      expect(c.categoryLabel).toBe("Deprecated Site-Local");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(false);
    });

    it("identifies deprecated NSAP 0200::/7", () => {
      const c = classifyIpAddress("0200::1");
      expect(c.category).toBe("reserved");
      expect(c.categoryLabel).toBe("Reserved / NSAP Mapping");
      expect(c.isPublic).toBe(false);
    });

    it("identifies deprecated ORCHID 2001:10::/28", () => {
      const c = classifyIpAddress("2001:10::1");
      expect(c.category).toBe("special");
      expect(c.categoryLabel).toBe("Deprecated ORCHID");
      expect(c.isPublic).toBe(false);
    });
  });

  describe("IPv4 Range Classification", () => {
    it("identifies private RFC 1918 addresses", () => {
      const c1 = classifyIpAddress("10.0.0.1");
      expect(c1.category).toBe("private");
      expect(c1.isLocalLan).toBe(true);
      expect(c1.isPublic).toBe(false);

      const c2 = classifyIpAddress("172.16.5.10");
      expect(c2.category).toBe("private");
      expect(c2.isLocalLan).toBe(true);

      const c3 = classifyIpAddress("192.168.1.254");
      expect(c3.category).toBe("private");
      expect(c3.isLocalLan).toBe(true);
    });

    it("identifies loopback addresses (127.0.0.0/8)", () => {
      const c = classifyIpAddress("127.0.0.1");
      expect(c.category).toBe("loopback");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(false);
    });

    it("identifies link-local addresses (169.254.0.0/16)", () => {
      const c = classifyIpAddress("169.254.12.34");
      expect(c.category).toBe("link_local");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(false);
    });

    it("identifies multicast addresses (224.0.0.0/4)", () => {
      const c = classifyIpAddress("239.255.255.250");
      expect(c.category).toBe("multicast");
      expect(c.isLocalLan).toBe(true);
      expect(c.isPublic).toBe(false);
    });

    it("identifies shared space / CGNAT (100.64.0.0/10)", () => {
      const c = classifyIpAddress("100.64.1.1");
      expect(c.category).toBe("shared");
      expect(c.isLocalLan).toBe(false);
      expect(c.isPublic).toBe(false);
    });

    it("identifies documentation subnets (RFC 5737)", () => {
      expect(classifyIpAddress("192.0.2.1").category).toBe("documentation");
      expect(classifyIpAddress("198.51.100.50").category).toBe("documentation");
      expect(classifyIpAddress("203.0.113.99").category).toBe("documentation");
    });

    it("identifies benchmarking subnet (198.18.0.0/15)", () => {
      expect(classifyIpAddress("198.18.0.1").category).toBe("benchmarking");
    });

    it("identifies broadcast (255.255.255.255)", () => {
      expect(classifyIpAddress("255.255.255.255").category).toBe("broadcast");
    });

    it("identifies public routable internet addresses", () => {
      const c1 = classifyIpAddress("1.1.1.1");
      expect(c1.category).toBe("public");
      expect(c1.isPublic).toBe(true);
      expect(c1.isLocalLan).toBe(false);

      const c2 = classifyIpAddress("8.8.8.8");
      expect(c2.category).toBe("public");
      expect(c2.isPublic).toBe(true);

      const c3 = classifyIpAddress("142.250.190.46");
      expect(c3.category).toBe("public");
      expect(c3.isPublic).toBe(true);
    });
  });

  describe("Regression: Malformed strings are NEVER classified as public IPv6", () => {
    it("rejects non-IPv6 strings and shape-recognition bug cases", () => {
      const invalidVectors = [
        "",
        "not-an-ip",
        "1:2:3",
        "12:34:56",
        "1:2:3:4:5:6:7",
        "1:2:3:4:5:6:7:8:9",
        "999.999.999.999",
        "fe80:::1",
        ":1:2:3:4:5:6:7:8",
        "1:2:3:4:5:6:7:8:",
        "1:2:3:4:5:6:7:8::",
        "::1:2:3:4:5:6:7:8",
        "gggg::1",
        "[2001:db8::1",
        "2001:db8::1]",
      ];

      for (const vec of invalidVectors) {
        const c = classifyIpAddress(vec);
        expect(c.category).toBe("invalid");
        expect(c.isPublic).toBe(false);
        expect(c.version).toBeNull();
      }
    });
  });

  describe("Round-Trip & Property Verification", () => {
    it("preserves 8-hextet identity under parse -> canonical format -> parse", () => {
      const testVectors = [
        "::",
        "::1",
        "1::",
        "1::1",
        "2001:db8::1",
        "2001:db8:85a3::8a2e:370:7334",
        "fe80::1ff:fe00:3a60",
        "fd00:abcd:1234::1",
        "2606:4700:4700::1111",
        "::ffff:192.168.1.1",
        "::ffff:8.8.8.8",
      ];

      for (const vec of testVectors) {
        const parsed1 = parseIpv6ToHextets(vec);
        expect(parsed1).not.toBeNull();
        const formatted = formatIpv6Canonical(parsed1!);
        const parsed2 = parseIpv6ToHextets(formatted);
        expect(parsed2).toEqual(parsed1);
      }
    });

    it("verifies canonicalization equivalence for different representations of the same address", () => {
      const c1 = classifyIpAddress("2001:0DB8:0000:0000:0000:0000:0000:0001");
      const c2 = classifyIpAddress("2001:db8::1");
      const c3 = classifyIpAddress("[2001:db8::1]");
      expect(c1.category).toBe(c2.category);
      expect(c1.normalizedIp).toBe(c2.normalizedIp);
      expect(c2.normalizedIp).toBe(c3.normalizedIp);
    });

    it("verifies canonical round-trip across 1,000 pseudo-random 8-hextet vectors", () => {
      let seed = 0x12345678;
      function nextRand(): number {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed;
      }

      for (let i = 0; i < 1000; i++) {
        const hextets: number[] = [];
        const zeroRunStart = nextRand() % 8;
        const zeroRunLen = (nextRand() % 6) + 2;

        for (let h = 0; h < 8; h++) {
          if (h >= zeroRunStart && h < zeroRunStart + zeroRunLen) {
            hextets.push(0);
          } else {
            hextets.push(nextRand() & 0xffff);
          }
        }

        const canonical = formatIpv6Canonical(hextets);
        const reparsed = parseIpv6ToHextets(canonical);
        expect(reparsed).toEqual(hextets);
      }
    });
  });
});
