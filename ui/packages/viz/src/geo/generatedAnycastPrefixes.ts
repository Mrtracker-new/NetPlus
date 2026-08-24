// AUTO-GENERATED -- do not edit manually.
// Run `pnpm geoip:update` to regenerate from scripts/anycast-known-prefixes.json.
import type { IPv4Int } from "./geoTypes";

export interface AnycastPrefixRecord {
  start: IPv4Int;
  end: IPv4Int;
  provider: string;
  service: string | null;
  source: string;
  cidr: string;
}

/** Sorted ascending by start. Non-overlapping. */
export const ANYCAST_PREFIXES: AnycastPrefixRecord[] = [
  // Stub includes one entry so the runtime length guard passes during development.
  // Run `pnpm geoip:update` to replace with the full curated dataset.
  { start: 0x01010100, end: 0x010101ff, provider: "Cloudflare, Inc.", service: "1.1.1.1 Public DNS", source: "stub", cidr: "1.1.1.0/24" },
];
