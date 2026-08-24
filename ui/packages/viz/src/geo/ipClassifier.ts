import type { IpCategory, IpClassification } from "./geoTypes";

/**
 * Parses an IPv4 dotted-decimal string into an unsigned 32-bit integer.
 * Returns null if the format is invalid.
 */
export function parseIpv4ToUint32(ip: string): number | null {
  const trimmed = ip.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4) return null;

  let acc = 0;
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (part.length === 0 || part.length > 3) return null;
    // Disallow leading zeros unless the octet is exactly "0"
    if (part.length > 1 && part.startsWith("0")) return null;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    acc = (acc << 8) | num;
  }
  return acc >>> 0;
}

/**
 * Checks whether an IPv4 uint32 falls within a given CIDR network.
 */
function inIpv4Range(val: number, base: number, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (val & mask) === (base & mask);
}

/**
 * Extracts and classifies IPv4 addresses according to RFC 6890 / RFC 1918 / RFC 6598 / RFC 5737 / RFC 2544.
 */
function classifyIpv4(ip: string, val: number): IpClassification {
  // 0.0.0.0/8 — "This network" (RFC 791 / RFC 6890)
  if (inIpv4Range(val, 0x00000000, 8)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "unspecified",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Unspecified Address",
      description: "0.0.0.0/8 source-only network address",
    };
  }

  // 10.0.0.0/8 — Private-Use (RFC 1918)
  if (inIpv4Range(val, 0x0a000000, 8)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "private",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Private Network (LAN)",
      description: "10.0.0.0/8 local intranet address",
    };
  }

  // 100.64.0.0/10 — Shared Address Space / Carrier-Grade NAT (RFC 6598)
  if (inIpv4Range(val, 0x64400000, 10)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "shared",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Shared Space (CGNAT)",
      description: "100.64.0.0/10 carrier-grade NAT address space",
    };
  }

  // 127.0.0.0/8 — Loopback (RFC 1122)
  if (inIpv4Range(val, 0x7f000000, 8)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "loopback",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Loopback Interface",
      description: "127.0.0.0/8 local host loopback interface",
    };
  }

  // 169.254.0.0/16 — Link-Local (RFC 3927)
  if (inIpv4Range(val, 0xa9fe0000, 16)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "link_local",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Link-Local Address",
      description: "169.254.0.0/16 auto-configured link-local subnet",
    };
  }

  // 172.16.0.0/12 — Private-Use (RFC 1918)
  if (inIpv4Range(val, 0xac100000, 12)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "private",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Private Network (LAN)",
      description: "172.16.0.0/12 local intranet address",
    };
  }

  // 192.0.0.0/24 — IETF Protocol Assignments (RFC 6890)
  if (inIpv4Range(val, 0xc0000000, 24)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "special",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "IETF Protocol Reserved",
      description: "192.0.0.0/24 protocol assignment block",
    };
  }

  // 192.0.2.0/24 — Documentation (TEST-NET-1, RFC 5737)
  if (inIpv4Range(val, 0xc0000200, 24)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "documentation",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Documentation Address",
      description: "192.0.2.0/24 documentation / test network",
    };
  }

  // 192.88.99.0/24 — 6to4 Relay Anycast (RFC 7526)
  if (inIpv4Range(val, 0xc0586300, 24)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "special",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "6to4 Relay Anycast",
      description: "192.88.99.0/24 deprecated 6to4 relay anycast",
    };
  }

  // 192.168.0.0/16 — Private-Use (RFC 1918)
  if (inIpv4Range(val, 0xc0a80000, 16)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "private",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Private Network (LAN)",
      description: "192.168.0.0/16 local intranet subnet",
    };
  }

  // 198.18.0.0/15 — Benchmarking (RFC 2544)
  if (inIpv4Range(val, 0xc6120000, 15)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "benchmarking",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Benchmarking Network",
      description: "198.18.0.0/15 network performance benchmark subnet",
    };
  }

  // 198.51.100.0/24 — Documentation (TEST-NET-2, RFC 5737)
  if (inIpv4Range(val, 0xc6336400, 24)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "documentation",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Documentation Address",
      description: "198.51.100.0/24 documentation / test network",
    };
  }

  // 203.0.113.0/24 — Documentation (TEST-NET-3, RFC 5737)
  if (inIpv4Range(val, 0xcb007100, 24)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "documentation",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Documentation Address",
      description: "203.0.113.0/24 documentation / test network",
    };
  }

  // 224.0.0.0/4 — Multicast (RFC 5771)
  if (inIpv4Range(val, 0xe0000000, 4)) {
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "multicast",
      isPublic: false,
      isLocalLan: true,
      categoryLabel: "Multicast Discovery",
      description: "224.0.0.0/4 local & inter-domain multicast group",
    };
  }

  // 240.0.0.0/4 — Reserved (RFC 1112)
  if (inIpv4Range(val, 0xf0000000, 4)) {
    // 255.255.255.255 — Limited Broadcast (RFC 919)
    if (val === 0xffffffff) {
      return {
        ip,
        normalizedIp: ip,
        version: 4,
        category: "broadcast",
        isPublic: false,
        isLocalLan: true,
        categoryLabel: "Local Broadcast",
        description: "255.255.255.255 limited local broadcast",
      };
    }
    return {
      ip,
      normalizedIp: ip,
      version: 4,
      category: "reserved",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Reserved Space (Class E)",
      description: "240.0.0.0/4 reserved for future use",
    };
  }

  // Otherwise, public globally-routable IPv4 unicast
  return {
    ip,
    normalizedIp: ip,
    version: 4,
    category: "public",
    isPublic: true,
    isLocalLan: false,
    categoryLabel: "Public Internet Address",
    description: "Public routable global IPv4 unicast address",
  };
}

/**
 * 8-element tuple representing a 128-bit IPv6 address as 16-bit unsigned hextets.
 */
export type Ipv6Hextets = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Checks whether an IPv6 hextet array falls within a given IPv6 CIDR network.
 * Invariant: Bitwise masking is performed per 16-bit word, avoiding JS 32-bit overflow.
 */
export function inIpv6Range(
  hextets: readonly number[],
  base: readonly number[],
  maskBits: number
): boolean {
  if (maskBits < 0 || maskBits > 128) return false;
  if (hextets.length !== 8 || base.length !== 8) return false;

  const fullWords = Math.floor(maskBits / 16);
  const remainingBits = maskBits % 16;

  for (let i = 0; i < fullWords; i++) {
    if (hextets[i] !== base[i]) return false;
  }

  if (remainingBits > 0) {
    const mask = (0xffff << (16 - remainingBits)) & 0xffff;
    if ((hextets[fullWords]! & mask) !== (base[fullWords]! & mask)) {
      return false;
    }
  }

  return true;
}

/**
 * Parses an IPv6 string into exactly 8 16-bit hextets according to RFC 4291 / RFC 5952.
 *
 * Accepted notation:
 *  - Standard colon-hex (e.g. "2001:db8:0:0:0:0:0:1")
 *  - Zero-compression with "::" (e.g. "2001:db8::1", "::1", "::")
 *  - Embedded IPv4 dotted-quad suffix (e.g. "::ffff:192.0.2.1", "64:ff9b::192.0.2.33")
 *  - Optionally bracketed (e.g. "[2001:db8::1]")
 *  - Optionally scoped with a raw zone identifier (e.g. "fe80::1%eth0" per RFC 4007)
 *    (Note: RFC 6874 URI percent-encoded zone IDs are out of scope; raw identifiers are parsed and stripped)
 *
 * Returns null if the syntax is malformed or invalid.
 */
export function parseIpv6ToHextets(ip: string): Ipv6Hextets | null {
  if (!ip || typeof ip !== "string") return null;

  let clean = ip.trim();
  if (clean.length === 0) return null;

  // Handle bracketed notation e.g. "[2001:db8::1]"
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1).trim();
  }

  // Reject unclosed or nested brackets
  if (clean.includes("[") || clean.includes("]")) {
    return null;
  }

  // Handle RFC 4007 zone identifier e.g. "%eth0" or "%1"
  // Zone identifiers provide contextual scope and never affect the 128-bit address representation.
  const percentIdx = clean.indexOf("%");
  if (percentIdx !== -1) {
    const zone = clean.slice(percentIdx + 1);
    // Zone ID must be non-empty and not contain whitespace or invalid chars
    if (zone.length === 0 || /\s/.test(zone)) return null;
    clean = clean.slice(0, percentIdx);
  }

  // Check for embedded IPv4 dotted-quad suffix (e.g. "::ffff:192.0.2.1" or "2001:db8::192.0.2.1")
  if (clean.includes(".")) {
    const lastColon = clean.lastIndexOf(":");
    if (lastColon === -1) return null;

    const v4Str = clean.slice(lastColon + 1);
    const v4Val = parseIpv4ToUint32(v4Str);
    if (v4Val === null) return null;

    const hA = ((v4Val >>> 16) & 0xffff).toString(16);
    const hB = (v4Val & 0xffff).toString(16);
    clean = `${clean.slice(0, lastColon + 1)}${hA}:${hB}`;
  }

  // Only hexadecimal characters and colons are allowed
  if (!/^[0-9a-fA-F:]+$/.test(clean)) return null;

  // Triple or more colons are invalid
  if (clean.includes(":::")) return null;

  const doubleColonCount = (clean.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  if (doubleColonCount === 1) {
    // Zero-compressed format (contains exactly one "::")
    const parts = clean.split("::");
    if (parts.length !== 2) return null;

    const [leftStr, rightStr] = parts as [string, string];
    const leftHextets = leftStr === "" ? [] : leftStr.split(":");
    const rightHextets = rightStr === "" ? [] : rightStr.split(":");

    // Disallow empty segments (e.g. ":1::" or "1:::2") or segments > 4 hex digits
    for (const seg of leftHextets) {
      if (seg.length === 0 || seg.length > 4 || !/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
    }
    for (const seg of rightHextets) {
      if (seg.length === 0 || seg.length > 4 || !/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
    }

    const explicitCount = leftHextets.length + rightHextets.length;
    // Invariant: "::" must compress at least 1 hextet. Explicit hextet count must be < 8.
    if (explicitCount >= 8) return null;

    const zeroCount = 8 - explicitCount;
    const result: number[] = [];

    for (const seg of leftHextets) {
      result.push(parseInt(seg, 16));
    }
    for (let i = 0; i < zeroCount; i++) {
      result.push(0);
    }
    for (const seg of rightHextets) {
      result.push(parseInt(seg, 16));
    }

    return result as unknown as Ipv6Hextets;
  }

  // Non-compressed format: must have exactly 8 colon-separated segments
  const segments = clean.split(":");
  if (segments.length !== 8) return null;

  const result: number[] = [];
  for (const seg of segments) {
    if (seg.length === 0 || seg.length > 4 || !/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
    result.push(parseInt(seg, 16));
  }

  return result as unknown as Ipv6Hextets;
}

/**
 * Formats 8 hextets into RFC 5952 canonical IPv6 string representation:
 *  - Lowercase hexadecimal
 *  - No leading zeroes in hextets
 *  - Longest run of consecutive zero hextets (run length >= 2) compressed with "::"
 *  - If there are multiple runs of equal maximal length (>= 2), compress the leftmost run
 *  - Single zero hextets are never compressed
 *  - Operates purely on the 8 hextets
 */
export function formatIpv6Canonical(hextets: readonly number[]): string {
  if (hextets.length !== 8) return "";

  // Find longest run of consecutive 0s (length >= 2)
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (hextets[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen > bestLen && curLen >= 2) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen >= 2) {
    const left = hextets.slice(0, bestStart).map((h) => h.toString(16)).join(":");
    const right = hextets.slice(bestStart + bestLen).map((h) => h.toString(16)).join(":");
    return `${left}::${right}`;
  }

  return hextets.map((h) => h.toString(16)).join(":");
}

export const IPV6_IANA_REGISTRY_SNAPSHOT = "2025-10-09";

export type Ipv6PrefixStatus = "iana-current" | "deprecated" | "historical";
export type Ipv6PrefixHandling = "direct" | "embedded-ipv4";

export interface Ipv6SpecialPrefixRule {
  prefix: string;
  base: Ipv6Hextets;
  prefixLength: number;

  category: IpCategory;

  label: string;
  categoryLabel?: string;
  description: string;

  rfc: readonly string[];

  // RFC 6890 Authoritative Registry Semantics
  source: boolean;
  destination: boolean;
  forwardable: boolean;
  globallyReachable: boolean;
  reservedByProtocol: boolean;

  status: Ipv6PrefixStatus;
  handling: Ipv6PrefixHandling;
}

/**
 * Snapshot of mandatory current IANA Special-Purpose prefixes as of 2025-10-09.
 */
export const EXPECTED_IANA_CURRENT_PREFIXES: readonly string[] = [
  "::1/128",
  "::/128",
  "::ffff:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "100:0:0:1::/64",
  "2001::/23",
  "2001::/32",
  "2001:1::1/128",
  "2001:1::2/128",
  "2001:1::3/128",
  "2001:2::/48",
  "2001:3::/32",
  "2001:4:112::/48",
  "2001:5::/32",
  "2001:20::/28",
  "2001:30::/28",
  "2001:db8::/32",
  "2002::/16",
  "2620:4f:8000::/48",
  "3fff::/20",
  "5f00::/16",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
];

/**
 * Authoritative Canonical Table of Special-Purpose IPv6 Prefixes.
 * Ordered strictly in non-increasing prefixLength order (128 -> 7) to guarantee
 * that the first matching entry in a sequential scan is the longest prefix match.
 */
export const IPV6_SPECIAL_PREFIX_TABLE: readonly Ipv6SpecialPrefixRule[] = [
  // --- Prefix Length 128 ---
  {
    prefix: "::1/128",
    base: [0, 0, 0, 0, 0, 0, 0, 1],
    prefixLength: 128,
    category: "loopback",
    label: "Loopback Interface",
    description: "::1/128 IPv6 loopback interface",
    rfc: ["RFC4291", "RFC6890"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "::/128",
    base: [0, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 128,
    category: "unspecified",
    label: "Unspecified Address",
    description: "::/128 IPv6 unspecified address",
    rfc: ["RFC4291", "RFC6890"],
    source: true,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:1::1/128",
    base: [0x2001, 0x0001, 0, 0, 0, 0, 0, 1],
    prefixLength: 128,
    category: "special",
    label: "Port Control Protocol Anycast",
    description: "2001:1::1/128 Port Control Protocol anycast",
    rfc: ["RFC7723"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:1::2/128",
    base: [0x2001, 0x0001, 0, 0, 0, 0, 0, 2],
    prefixLength: 128,
    category: "special",
    label: "TURN Anycast",
    description: "2001:1::2/128 Traversal Using Relays around NAT anycast",
    rfc: ["RFC8155"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:1::3/128",
    base: [0x2001, 0x0001, 0, 0, 0, 0, 0, 3],
    prefixLength: 128,
    category: "special",
    label: "DNS-SD SRP Anycast",
    description: "2001:1::3/128 DNS-SD Service Registration Protocol anycast",
    rfc: ["RFC9665"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 96 ---
  {
    prefix: "::ffff:0:0/96",
    base: [0, 0, 0, 0, 0, 0xffff, 0, 0],
    prefixLength: 96,
    category: "special",
    label: "IPv4-Mapped Address",
    description: "::ffff:0:0/96 IPv4-mapped IPv6 address",
    rfc: ["RFC4291", "RFC6890"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "iana-current",
    handling: "embedded-ipv4",
  },
  {
    prefix: "::/96",
    base: [0, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 96,
    category: "special",
    label: "IPv4-Compatible Address",
    description: "::/96 deprecated IPv4-compatible address",
    rfc: ["RFC4291"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "deprecated",
    handling: "embedded-ipv4",
  },
  {
    prefix: "64:ff9b::/96",
    base: [0x0064, 0xff9b, 0, 0, 0, 0, 0, 0],
    prefixLength: 96,
    category: "special",
    label: "IPv4/IPv6 Translation",
    description: "64:ff9b::/96 Well-Known IPv4/IPv6 translation prefix",
    rfc: ["RFC6052", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 64 ---
  {
    prefix: "100:0:0:1::/64",
    base: [0x0100, 0, 0, 1, 0, 0, 0, 0],
    prefixLength: 64,
    category: "special",
    label: "Dummy IPv6 Prefix",
    description: "100:0:0:1::/64 Dummy IPv6 prefix",
    rfc: ["RFC9780"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "100::/64",
    base: [0x0100, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 64,
    category: "special",
    label: "Discard-Only Address Block",
    description: "100::/64 discard-only address block",
    rfc: ["RFC6666", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 48 ---
  {
    prefix: "64:ff9b:1::/48",
    base: [0x0064, 0xff9b, 0x0001, 0, 0, 0, 0, 0],
    prefixLength: 48,
    category: "special",
    label: "Local-Use IPv4/IPv6 Translation",
    description: "64:ff9b:1::/48 Local-Use IPv4/IPv6 translation prefix",
    rfc: ["RFC8215"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:2::/48",
    base: [0x2001, 0x0002, 0, 0, 0, 0, 0, 0],
    prefixLength: 48,
    category: "benchmarking",
    label: "Benchmarking Network",
    description: "2001:2::/48 network performance benchmark subnet",
    rfc: ["RFC5180", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:4:112::/48",
    base: [0x2001, 0x0004, 0x0112, 0, 0, 0, 0, 0],
    prefixLength: 48,
    category: "special",
    label: "AS112-v6 DNS Service",
    description: "2001:4:112::/48 AS112-v6 DNS service prefix",
    rfc: ["RFC7535"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2620:4f:8000::/48",
    base: [0x2620, 0x004f, 0x8000, 0, 0, 0, 0, 0],
    prefixLength: 48,
    category: "special",
    label: "Direct Delegation AS112 Service",
    description: "2620:4f:8000::/48 AS112 DNS service prefix",
    rfc: ["RFC7535"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 32 ---
  {
    prefix: "2001:db8::/32",
    base: [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0],
    prefixLength: 32,
    category: "documentation",
    label: "Documentation Address",
    description: "2001:db8::/32 IPv6 documentation network",
    rfc: ["RFC3849", "RFC6890"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:3::/32",
    base: [0x2001, 0x0003, 0, 0, 0, 0, 0, 0],
    prefixLength: 32,
    category: "special",
    label: "Automatic Multicast Tunneling",
    description: "2001:3::/32 Automatic Multicast Tunneling prefix",
    rfc: ["RFC7450"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: true,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:5::/32",
    base: [0x2001, 0x0005, 0, 0, 0, 0, 0, 0],
    prefixLength: 32,
    category: "special",
    label: "LISP EID Block",
    description: "2001:5::/32 LISP Locator/ID Separation Protocol EID block",
    rfc: ["RFC7954"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001::/32",
    base: [0x2001, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 32,
    category: "special",
    label: "TEREDO Tunneling",
    description: "2001::/32 TEREDO IPv6 over IPv4 tunneling prefix",
    rfc: ["RFC4380", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 28 ---
  {
    prefix: "2001:20::/28",
    base: [0x2001, 0x0020, 0, 0, 0, 0, 0, 0],
    prefixLength: 28,
    category: "special",
    label: "ORCHIDv2 Overlay",
    description: "2001:20::/28 Overlay Routable Cryptographic Hash Identifiers v2",
    rfc: ["RFC7343", "RFC8190"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:30::/28",
    base: [0x2001, 0x0030, 0, 0, 0, 0, 0, 0],
    prefixLength: 28,
    category: "special",
    label: "Drone Remote ID Protocol",
    description: "2001:30::/28 Drone Remote ID Protocol Entity Tags",
    rfc: ["RFC9374"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "2001:10::/28",
    base: [0x2001, 0x0010, 0, 0, 0, 0, 0, 0],
    prefixLength: 28,
    category: "special",
    label: "Deprecated ORCHID",
    description: "2001:10::/28 Deprecated ORCHID prefix",
    rfc: ["RFC4843", "RFC7343"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "deprecated",
    handling: "direct",
  },

  // --- Prefix Length 23 ---
  {
    prefix: "2001::/23",
    base: [0x2001, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 23,
    category: "special",
    label: "IETF Protocol Assignments",
    description: "2001::/23 IETF protocol assignments block",
    rfc: ["RFC2928", "RFC6890"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 20 ---
  {
    prefix: "3fff::/20",
    base: [0x3fff, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 20,
    category: "documentation",
    label: "Documentation Address",
    description: "3fff::/20 IPv6 documentation network",
    rfc: ["RFC9637"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 16 ---
  {
    prefix: "2002::/16",
    base: [0x2002, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 16,
    category: "special",
    label: "6to4 Transition Prefix",
    description: "2002::/16 6to4 gateway transition address",
    rfc: ["RFC3056", "RFC7526", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "5f00::/16",
    base: [0x5f00, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 16,
    category: "special",
    label: "SRv6 SID Block",
    description: "5f00::/16 Segment Routing over IPv6 SIDs block",
    rfc: ["RFC9602"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 10 ---
  {
    prefix: "fe80::/10",
    base: [0xfe80, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 10,
    category: "link_local",
    label: "Link-Local Address",
    description: "fe80::/10 IPv6 link-local autoconfigured address",
    rfc: ["RFC4291", "RFC6890"],
    source: true,
    destination: true,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "fec0::/10",
    base: [0xfec0, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 10,
    category: "reserved",
    label: "Deprecated Site-Local",
    description: "fec0::/10 deprecated IPv6 site-local address",
    rfc: ["RFC3879", "RFC4291"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "deprecated",
    handling: "direct",
  },

  // --- Prefix Length 8 ---
  {
    prefix: "ff00::/8",
    base: [0xff00, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 8,
    category: "multicast",
    label: "Multicast Group",
    description: "ff00::/8 IPv6 multicast discovery group",
    rfc: ["RFC4291", "RFC6890"],
    source: false,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: true,
    status: "iana-current",
    handling: "direct",
  },

  // --- Prefix Length 7 ---
  {
    prefix: "fc00::/7",
    base: [0xfc00, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 7,
    category: "private",
    label: "Unique Local Address (ULA)",
    description: "fc00::/7 IPv6 local intranet address",
    rfc: ["RFC4193", "RFC6890"],
    source: true,
    destination: true,
    forwardable: true,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "iana-current",
    handling: "direct",
  },
  {
    prefix: "0200::/7",
    base: [0x0200, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 7,
    category: "reserved",
    label: "Reserved / NSAP Mapping",
    description: "0200::/7 deprecated OSI NSAP-mapped prefix",
    rfc: ["RFC4048"],
    source: false,
    destination: false,
    forwardable: false,
    globallyReachable: false,
    reservedByProtocol: false,
    status: "historical",
    handling: "direct",
  },
];

export interface TableValidationError {
  prefix: string;
  reason: string;
}

/**
 * Validates the structural, mathematical, and ordering integrity of the IPv6 special prefix table.
 */
export function validateIpv6SpecialPrefixTable(
  table: readonly Ipv6SpecialPrefixRule[] = IPV6_SPECIAL_PREFIX_TABLE
): TableValidationError[] {
  const errors: TableValidationError[] = [];
  const seenPrefixes = new Set<string>();
  const seenBases = new Map<string, number>();

  for (let i = 0; i < table.length; i++) {
    const rule = table[i]!;

    // 1. Prefix length range
    if (rule.prefixLength < 0 || rule.prefixLength > 128) {
      errors.push({ prefix: rule.prefix, reason: `Invalid prefixLength: ${rule.prefixLength}` });
    }

    // 2. Base array structure and canonical zero host bits
    if (!rule.base || rule.base.length !== 8) {
      errors.push({ prefix: rule.prefix, reason: "Base must be an 8-element hextet array" });
    } else {
      const fullWords = Math.floor(rule.prefixLength / 16);
      const remainingBits = rule.prefixLength % 16;
      let hostBitsClean = true;

      if (remainingBits > 0 && fullWords < 8) {
        const hostMask = 0xffff >>> remainingBits;
        if ((rule.base[fullWords]! & hostMask) !== 0) {
          hostBitsClean = false;
        }
      }
      for (let w = fullWords + (remainingBits > 0 ? 1 : 0); w < 8; w++) {
        if (rule.base[w] !== 0) {
          hostBitsClean = false;
          break;
        }
      }

      if (!hostBitsClean) {
        errors.push({
          prefix: rule.prefix,
          reason: "Base contains non-zero host bits beyond prefixLength",
        });
      }
    }

    // 3. Non-increasing prefix length order
    if (i > 0) {
      const prev = table[i - 1]!;
      if (prev.prefixLength < rule.prefixLength) {
        errors.push({
          prefix: rule.prefix,
          reason: `Out of order: prefixLength ${rule.prefixLength} after ${prev.prefixLength} (${prev.prefix})`,
        });
      }
    }

    // 4. Duplicate prefix string
    if (seenPrefixes.has(rule.prefix)) {
      errors.push({ prefix: rule.prefix, reason: `Duplicate prefix string: ${rule.prefix}` });
    }
    seenPrefixes.add(rule.prefix);

    // 5. Overlapping rules of equal prefix length
    const baseKey = rule.base.join(":");
    if (seenBases.has(baseKey)) {
      const prevLen = seenBases.get(baseKey)!;
      if (prevLen === rule.prefixLength) {
        errors.push({
          prefix: rule.prefix,
          reason: `Duplicate base and prefixLength (${rule.prefixLength}) for ${baseKey}`,
        });
      }
    }
    seenBases.set(baseKey, rule.prefixLength);
  }

  // 6. Check that all mandatory current IANA entries are present
  for (const expected of EXPECTED_IANA_CURRENT_PREFIXES) {
    if (!seenPrefixes.has(expected)) {
      errors.push({
        prefix: expected,
        reason: `Mandatory current IANA prefix missing from table (registry snapshot ${IPV6_IANA_REGISTRY_SNAPSHOT})`,
      });
    }
  }

  return errors;
}

/**
 * Matches an IPv6 address against an ordered table of special-purpose prefix rules.
 * Because the table is sorted in non-increasing prefixLength order, the first match
 * is guaranteed to be the longest prefix match.
 */
export function findLongestIpv6PrefixMatch(
  hextets: Ipv6Hextets,
  table: readonly Ipv6SpecialPrefixRule[] = IPV6_SPECIAL_PREFIX_TABLE
): Ipv6SpecialPrefixRule | null {
  for (let i = 0; i < table.length; i++) {
    const rule = table[i]!;
    if (inIpv6Range(hextets, rule.base, rule.prefixLength)) {
      return rule;
    }
  }
  return null;
}

/**
 * Derives NetPulse application properties (isPublic, isLocalLan) and handles embedded IPv4 dispatch.
 */
function deriveNetPlusClassification(
  rule: Ipv6SpecialPrefixRule,
  ip: string,
  canonical: string,
  hextets: Ipv6Hextets
): IpClassification {
  if (rule.handling === "embedded-ipv4") {
    const v4Val = (((hextets[6]! << 16) | hextets[7]!) >>> 0);
    const v4Ip = `${(v4Val >>> 24) & 0xff}.${(v4Val >>> 16) & 0xff}.${(v4Val >>> 8) & 0xff}.${v4Val & 0xff}`;
    const v4Class = classifyIpv4(v4Ip, v4Val);
    return {
      ...v4Class,
      ip,
      normalizedIp: canonical,
      version: 6,
    };
  }

  let isLocalLan = false;
  if (
    rule.category === "private" ||
    rule.category === "loopback" ||
    rule.category === "link_local" ||
    rule.category === "multicast" ||
    rule.prefix === "64:ff9b:1::/48" ||
    rule.prefix === "2001:1::1/128" ||
    rule.prefix === "2001:1::2/128" ||
    rule.prefix === "2001:1::3/128" ||
    rule.prefix === "fec0::/10"
  ) {
    isLocalLan = true;
  }

  return {
    ip,
    normalizedIp: canonical,
    version: 6,
    category: rule.category,
    isPublic: rule.globallyReachable,
    isLocalLan,
    categoryLabel: rule.label,
    description: rule.description,
  };
}

/** Base for RFC 4291 2000::/3 Global Unicast Space */
const IPV6_GLOBAL_UNICAST_BASE: Ipv6Hextets = [0x2000, 0, 0, 0, 0, 0, 0, 0];

/**
 * Parses and classifies IPv6 addresses according to the IANA IPv6 Special-Purpose Address Registry
 * and RFC 4291 / RFC 6890 address architecture.
 *
 * 3-Layer Evaluation Pipeline:
 *  1. IANA Special-Purpose Longest-Prefix Match (from authoritative IPV6_SPECIAL_PREFIX_TABLE)
 *     - If match found: dispatches according to rule.handling ("direct" or "embedded-ipv4")
 *  2. 2000::/3 Global Unicast Check
 *     - If address ∈ 2000::/3 and not in special table: classified as public global unicast
 *  3. Unallocated / Reserved Fallback
 *     - All other unallocated or protocol-reserved IPv6 address space
 */
export function classifyIpv6(
  ip: string,
  hextets: Ipv6Hextets,
  table: readonly Ipv6SpecialPrefixRule[] = IPV6_SPECIAL_PREFIX_TABLE
): IpClassification {
  const canonical = formatIpv6Canonical(hextets);

  // Layer 1: IANA Special-Purpose Longest-Prefix Match
  const specialMatch = findLongestIpv6PrefixMatch(hextets, table);
  if (specialMatch !== null) {
    return deriveNetPlusClassification(specialMatch, ip, canonical, hextets);
  }

  // Layer 2: General Global Unicast (2000::/3)
  if (inIpv6Range(hextets, IPV6_GLOBAL_UNICAST_BASE, 3)) {
    return {
      ip,
      normalizedIp: canonical,
      version: 6,
      category: "public",
      isPublic: true,
      isLocalLan: false,
      categoryLabel: "Public IPv6 Address",
      description: "Global routable IPv6 unicast address (RFC 4291)",
    };
  }

  // Layer 3: Unallocated / Reserved Fallback
  return {
    ip,
    normalizedIp: canonical,
    version: 6,
    category: "reserved",
    isPublic: false,
    isLocalLan: false,
    categoryLabel: "Reserved Space",
    description: "Unallocated or reserved IPv6 address block (RFC 4291)",
  };
}

const CLASSIFY_CACHE = new Map<string, IpClassification>();
const MAX_CLASSIFY_CACHE = 32768;

/**
 * Parses and classifies an arbitrary IP string (IPv4 or IPv6).
 */
export function classifyIpAddress(ip: string): IpClassification {
  if (!ip || typeof ip !== "string") {
    return {
      ip: String(ip),
      normalizedIp: String(ip),
      version: null,
      category: "invalid",
      isPublic: false,
      isLocalLan: false,
      categoryLabel: "Invalid Address",
      description: "Empty or non-string address input",
    };
  }

  const trimmed = ip.trim();
  const cached = CLASSIFY_CACHE.get(trimmed);
  if (cached) return cached;

  let result: IpClassification;

  // 1. Strict IPv4 parse
  const v4Val = parseIpv4ToUint32(trimmed);
  if (v4Val !== null) {
    result = classifyIpv4(trimmed, v4Val);
  } else {
    // 2. Strict IPv6 parse (expands to exactly 8 16-bit hextets)
    const v6Hextets = parseIpv6ToHextets(trimmed);
    if (v6Hextets !== null) {
      result = classifyIpv6(trimmed, v6Hextets);
    } else {
      result = {
        ip: trimmed,
        normalizedIp: trimmed,
        version: null,
        category: "invalid",
        isPublic: false,
        isLocalLan: false,
        categoryLabel: "Invalid Address",
        description: "Malformed IP address syntax",
      };
    }
  }

  if (CLASSIFY_CACHE.size >= MAX_CLASSIFY_CACHE) {
    CLASSIFY_CACHE.clear();
  }
  CLASSIFY_CACHE.set(trimmed, result);
  return result;
}
