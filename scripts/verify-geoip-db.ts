#!/usr/bin/env tsx
/**
 * GeoIP Database Verifier for NetPlus
 * ------------------------------------
 * Validates all generated interval files against invariants C1-C13.
 * This is the PRIMARY authority for generated-data validity.
 * The runtime length guard in geoDatabase.ts is a secondary defensive check only.
 *
 * Usage:
 *   pnpm geoip:verify             -- validate structure
 *   pnpm geoip:verify --check-age -- also enforce GEOIP_MAX_AGE_DAYS threshold
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT       = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "ui", "packages", "viz", "src", "geo");

interface Interval { start: number; end: number; }

interface AnycastRecord {
  start: number;
  end: number;
  provider: string;
  service: string | null;
  source: string;
  cidr: string;
}

function checkIntervals(intervals: Interval[], label: string): void {
  let errors = 0;
  for (let i = 0; i < intervals.length; i++) {
    const { start, end } = intervals[i]!;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      console.error(`  C13 FAIL: ${label}[${i}] -- not safe integers`); errors++;
    }
    if (start < 0 || end > 0xFFFFFFFF) {
      console.error(`  C3 FAIL: ${label}[${i}] -- out of uint32 range`); errors++;
    }
    if (start > end) {
      console.error(`  C1 FAIL: ${label}[${i}] -- start(${start}) > end(${end})`); errors++;
    }
    if (i > 0) {
      const prev = intervals[i - 1]!;
      if (prev.end >= start) {
        console.error(`  C2 FAIL: ${label}[${i}] -- overlap with [${i-1}]`); errors++;
      }
      if (prev.start > start) {
        console.error(`  C6 FAIL: ${label}[${i}] -- not sorted`); errors++;
      }
      if (prev.start === start && prev.end === end) {
        console.error(`  C4 FAIL: ${label}[${i}] -- duplicate interval`); errors++;
      }
    }
  }
  if (errors > 0) throw new Error(`${label}: ${errors} invariant violation(s) -- see above`);
  console.log(`  OK: ${label} -- ${intervals.length.toLocaleString()} intervals (C1-C4,C6,C13)`);
}

function checkAnycastPayloads(
  prefixes: Array<{ start: number; end: number; provider: string; source: string }>
): void {
  for (let i = 0; i < prefixes.length; i++) {
    const p = prefixes[i]!;
    if (!p.provider?.trim()) throw new Error(`C12 FAIL: anycast[${i}] -- empty provider`);
    if (!p.source?.trim())   throw new Error(`C12 FAIL: anycast[${i}] -- empty source`);
  }
  console.log(`  OK: anycast payload (C12) -- ${prefixes.length} prefixes`);
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

async function loadExport<T>(filename: string, exportName: string): Promise<T> {
  const filePath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filePath))
    throw new Error(`Missing generated file: ${filePath}\nRun \`pnpm geoip:update\` first.`);
  const fileUrl = pathToFileURL(filePath).href;
  const mod = (await import(fileUrl)) as Record<string, unknown>;
  if (!(exportName in mod))
    throw new Error(`Export '${exportName}' not found in ${filename}`);
  return mod[exportName] as T;
}

async function main(): Promise<void> {
  console.log("\n=== NetPlus GeoIP Database Verifier ===\n");
  let allOk = true;

  try {
    // Geo intervals
    const geoIntervals = await loadExport<[number, number, object][]>(
      "generatedGeoIntervals.ts", "IPV4_GEO_INTERVALS");
    checkIntervals(geoIntervals.map(([s, e]) => ({ start: s, end: e })), "geo");

    // ASN intervals
    const asnIntervals = await loadExport<[number, number, object][]>(
      "generatedAsnIntervals.ts", "IPV4_ASN_INTERVALS");
    checkIntervals(asnIntervals.map(([s, e]) => ({ start: s, end: e })), "asn");

    // Anycast prefixes
    const anycast = await loadExport<AnycastRecord[]>(
      "generatedAnycastPrefixes.ts", "ANYCAST_PREFIXES");
    if (anycast.length === 0)
      throw new Error("ANYCAST_PREFIXES is empty -- this is a hard build error");
    checkIntervals(anycast, "anycast");
    checkAnycastPayloads(anycast);

    // Metadata
    const meta = await loadExport<{
      geoDatabaseVersion: string;
      generatedSchemaVersion: number;
      licenseNotice: string;
      geoBuildDate: string;
      provider: string;
    }>("generatedDatabaseMetadata.ts", "GEO_DATABASE_METADATA");

    if (!meta.geoDatabaseVersion)
      throw new Error("Missing geoDatabaseVersion in metadata");
    if (!meta.licenseNotice)
      throw new Error("Missing licenseNotice in metadata");
    if (meta.generatedSchemaVersion !== 1)
      console.warn(`  WARNING: generatedSchemaVersion is ${meta.generatedSchemaVersion} (expected 1)`);

    console.log(`  OK: metadata -- provider=${meta.provider}, db=${meta.geoDatabaseVersion}, schema=v${meta.generatedSchemaVersion}`);

    // Age check (optional)
    if (process.argv.includes("--check-age")) {
      const maxAge = parseInt(process.env["GEOIP_MAX_AGE_DAYS"] ?? "30", 10);
      const age    = daysSince(meta.geoBuildDate);
      if (age > maxAge) {
        console.error(`  Age check FAIL: data is ${age} days old (threshold: ${maxAge})`);
        console.error(`  Run \`pnpm geoip:update\` to refresh.`);
        allOk = false;
      } else {
        console.log(`  OK: age check -- ${age}d old (threshold: ${maxAge}d)`);
      }
    }

    // Spot-checks: structural and semantic assertions
    console.log("\nRunning spot-checks...");

    // Spot-check A: 1.1.1.0/24 must be anycast
    const cloudflareStart = 0x01010100; // 1.1.1.0
    const cloudflareEnd   = 0x010101ff; // 1.1.1.255
    const cfPrefix = anycast.find(p => p.start <= cloudflareStart && p.end >= cloudflareEnd);
    if (!cfPrefix) {
      console.error("  Spot-check A FAIL: 1.1.1.0/24 not found in anycast prefixes");
      allOk = false;
    } else {
      if (!cfPrefix.provider || cfPrefix.provider.trim() === "")
        throw new Error("Spot-check A: anycast entry for 1.1.1.0/24 has empty provider");
      if (!cfPrefix.source || cfPrefix.source.trim() === "")
        throw new Error("Spot-check A: anycast entry for 1.1.1.0/24 has empty source");
      console.log(`  OK: spot-check A -- 1.1.1.0/24 is anycast, cidr=${cfPrefix.cidr}, provider="${cfPrefix.provider}"`);
    }

    // Spot-check B: Interval count must be non-trivial for a full DB-IP dataset
    if (geoIntervals.length > 0 && geoIntervals.length < 10000) {
      console.warn(`  WARNING: geo interval count (${geoIntervals.length}) seems low for a full DB-IP Lite dataset`);
    } else if (geoIntervals.length === 0) {
      console.log("  NOTE: geo intervals are empty (stub file) -- run geoip:update to populate");
    } else {
      console.log(`  OK: spot-check B -- geo interval count is ${geoIntervals.length.toLocaleString()}`);
    }

  } catch (err) {
    console.error("\n[verify-geoip-db] Error:", err);
    allOk = false;
  }

  console.log(allOk ? "\nOK: All invariants passed.\n" : "\nFAIL: Verification failed.\n");
  if (!allOk) process.exit(1);
}

main();
