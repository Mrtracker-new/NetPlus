#!/usr/bin/env tsx
/**
 * GeoIP Database Compiler for NetPlus
 * ------------------------------------
 * Downloads DB-IP Lite City and ASN CSV files, compiles them into
 * pre-computed TypeScript interval tables, and emits generated source files.
 *
 * Usage: pnpm geoip:update
 *
 * Environment variables:
 *   DBIP_CITY_CSV      -- Path to local dbip-city-lite-YYYY-MM.csv.gz (skips download)
 *   DBIP_ASN_CSV       -- Path to local dbip-asn-lite-YYYY-MM.csv.gz  (skips download)
 *   GEOIP_MAX_AGE_DAYS -- Engineering freshness threshold (default: 30)
 *                         This is a project-defined data freshness policy.
 *                         It is NOT a legal grace period and must not be
 *                         interpreted as one. Licensing obligations are
 *                         determined independently of this value.
 *
 * License: DB-IP Lite data is CC BY 4.0.
 * Attribution required: "IP Geolocation by DB-IP" -- see ATTRIBUTION.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import * as readline from "node:readline";
import * as process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPILER_VERSION = "1.0.0";
const GENERATED_SCHEMA_VERSION = 1;
const LICENSE_NOTICE =
  "IP Geolocation by DB-IP (https://db-ip.com) -- " +
  "Creative Commons Attribution 4.0 International License (CC BY 4.0)";

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "ui", "packages", "viz", "src", "geo");
const SCRIPTS_DIR = path.join(ROOT, "scripts");
const ANYCAST_JSON = path.join(SCRIPTS_DIR, "anycast-known-prefixes.json");
const TMP_DIR = path.join(SCRIPTS_DIR, ".tmp");

const now = new Date();
const YEAR_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const CITY_URL = `https://download.db-ip.com/free/dbip-city-lite-${YEAR_MONTH}.csv.gz`;
const ASN_URL  = `https://download.db-ip.com/free/dbip-asn-lite-${YEAR_MONTH}.csv.gz`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeoRecord {
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
}

interface AsnRecord {
  asn: number;
  asOrg: string;
  asName: string | null;
}

interface AnycastPrefixRecord {
  start: number;
  end: number;
  provider: string;
  service: string | null;
  source: string;
  cidr: string;
}

interface AnycastSourceRecord {
  cidr: string;
  provider: string;
  service: string | null;
  source: string;
  sourceUrl: string;
  verifiedAt: string;
}

interface GeoInterval  { start: number; end: number; record: GeoRecord; }
interface AsnInterval  { start: number; end: number; record: AsnRecord; }

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    acc = (acc << 8) | num;
  }
  return acc >>> 0;
}

function cidrToRange(cidr: string): [number, number] | null {
  const [ipPart, prefixPart] = cidr.split("/");
  if (!ipPart || !prefixPart) return null;
  const base   = ipv4ToUint32(ipPart);
  const prefix = parseInt(prefixPart, 10);
  if (base === null || isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const mask  = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  const start = (base & mask) >>> 0;
  const end   = (start | (~mask >>> 0)) >>> 0;
  return [start, end];
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading ${url} ...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (res: http.IncomingMessage) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err: Error) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Invariant validation (C1-C13)
// ---------------------------------------------------------------------------

function validateIntervals<T>(
  intervals: Array<{ start: number; end: number; record: T }>,
  label: string
): void {
  for (let i = 0; i < intervals.length; i++) {
    const { start, end } = intervals[i]!;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      throw new Error(`${label}[${i}]: C13 -- not safe integers`);
    if (start < 0 || end > 0xFFFFFFFF)
      throw new Error(`${label}[${i}]: C3 -- out of uint32 range`);
    if (start > end)
      throw new Error(`${label}[${i}]: C1 -- start(${start}) > end(${end})`);
    if (i > 0) {
      const prev = intervals[i - 1]!;
      if (prev.end >= start)
        throw new Error(`${label}[${i}]: C2 -- overlap (prev.end=${prev.end} >= start=${start})`);
      if (prev.start > start)
        throw new Error(`${label}[${i}]: C6 -- not sorted`);
      if (prev.start === start && prev.end === end)
        throw new Error(`${label}[${i}]: C4 -- duplicate interval`);
      if (((prev.end + 1) >>> 0) === start &&
          JSON.stringify(prev.record) === JSON.stringify(intervals[i]!.record))
        throw new Error(`${label}[${i}]: C5 -- adjacent identical payloads not merged`);
    }
  }
}

function validateGeoPayloads(intervals: GeoInterval[]): void {
  for (let i = 0; i < intervals.length; i++) {
    const r = intervals[i]!.record;
    if (r.countryCode !== null && !/^[A-Z]{2}$/.test(r.countryCode))
      throw new Error(`geo[${i}]: C7 -- invalid countryCode "${r.countryCode}"`);
    if (r.latitude < -90 || r.latitude > 90)
      throw new Error(`geo[${i}]: C8 -- latitude ${r.latitude} out of range`);
    if (r.longitude < -180 || r.longitude > 180)
      throw new Error(`geo[${i}]: C9 -- longitude ${r.longitude} out of range`);
    if (r.accuracyRadiusKm !== null && r.accuracyRadiusKm < 0)
      throw new Error(`geo[${i}]: C10 -- accuracyRadiusKm < 0`);
  }
}

function validateAsnPayloads(intervals: AsnInterval[]): void {
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i]!.record.asn < 0)
      throw new Error(`asn[${i}]: C11 -- asn < 0`);
  }
}

function validateAnycastPayloads(prefixes: AnycastPrefixRecord[]): void {
  for (let i = 0; i < prefixes.length; i++) {
    const p = prefixes[i]!;
    if (!p.provider?.trim()) throw new Error(`anycast[${i}]: C12 -- empty provider`);
    if (!p.source?.trim())   throw new Error(`anycast[${i}]: C12 -- empty source`);
    if (!Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end))
      throw new Error(`anycast[${i}]: C13 -- not safe integers`);
    if (p.start < 0 || p.end > 0xFFFFFFFF)
      throw new Error(`anycast[${i}]: C3 -- out of uint32 range`);
    if (p.start > p.end) throw new Error(`anycast[${i}]: C1 -- start > end`);
    if (i > 0) {
      const prev = prefixes[i - 1]!;
      if (prev.end >= p.start) throw new Error(`anycast[${i}]: C2 -- overlap`);
      if (prev.start > p.start) throw new Error(`anycast[${i}]: C6 -- not sorted`);
    }
  }
}

// ---------------------------------------------------------------------------
// Merge adjacent identical intervals (C5)
// ---------------------------------------------------------------------------

function mergeGeoIntervals(intervals: GeoInterval[]): GeoInterval[] {
  if (intervals.length === 0) return [];
  const merged: GeoInterval[] = [{ ...intervals[0]! }];
  for (let i = 1; i < intervals.length; i++) {
    const cur  = intervals[i]!;
    const last = merged[merged.length - 1]!;
    if (((last.end + 1) >>> 0) === cur.start &&
        JSON.stringify(last.record) === JSON.stringify(cur.record)) {
      last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function mergeAsnIntervals(intervals: AsnInterval[]): AsnInterval[] {
  if (intervals.length === 0) return [];
  const merged: AsnInterval[] = [{ ...intervals[0]! }];
  for (let i = 1; i < intervals.length; i++) {
    const cur  = intervals[i]!;
    const last = merged[merged.length - 1]!;
    if (((last.end + 1) >>> 0) === cur.start &&
        last.record.asn   === cur.record.asn &&
        last.record.asOrg === cur.record.asOrg) {
      last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// CSV parsers
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ""; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

async function parseCityCSV(csvGzPath: string): Promise<GeoInterval[]> {
  // DB-IP City Lite CSV format (no header):
  // ip_start,ip_end,continent,country,stateprov,city,latitude,longitude
  const intervals: GeoInterval[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(csvGzPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 8) continue;
    const [ipStart, ipEnd, , countryCode, , city, latStr, lngStr] =
      fields as [string, string, string, string, string, string, string, string];
    const start = ipv4ToUint32(ipStart);
    const end   = ipv4ToUint32(ipEnd);
    if (start === null || end === null) continue; // IPv6 row
    if (start > end) continue;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || isNaN(lng)) continue;
    const cc = (countryCode ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const cityClean = city?.trim() || null;
    intervals.push({
      start,
      end,
      record: {
        country: cc,        // DB-IP Lite free does not provide full country name
        countryCode: cc,
        city: cityClean,
        latitude:  Math.round(lat * 10000) / 10000,
        longitude: Math.round(lng * 10000) / 10000,
        accuracyRadiusKm: null, // not provided in DB-IP Lite free tier
      },
    });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervals;
}

async function parseAsnCSV(csvGzPath: string): Promise<AsnInterval[]> {
  // DB-IP ASN Lite CSV format (no header):
  // ip_start,ip_end,asn,as_name
  const intervals: AsnInterval[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(csvGzPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    if (fields.length < 4) continue;
    const [ipStart, ipEnd, asnStr, asName] =
      fields as [string, string, string, string];
    const start  = ipv4ToUint32(ipStart);
    const end    = ipv4ToUint32(ipEnd);
    if (start === null || end === null) continue; // IPv6
    if (start > end) continue;
    const asnNum = parseInt((asnStr ?? "").replace(/^AS/i, ""), 10);
    if (isNaN(asnNum) || asnNum < 0) continue;
    const org = (asName ?? "").trim() || "Unknown";
    intervals.push({ start, end, record: { asn: asnNum, asOrg: org, asName: org } });
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervals;
}

// ---------------------------------------------------------------------------
// Anycast compiler
// ---------------------------------------------------------------------------

function compileAnycast(sourceRecords: AnycastSourceRecord[]): AnycastPrefixRecord[] {
  const prefixes: AnycastPrefixRecord[] = [];
  const STALE_DAYS = 180;
  for (const rec of sourceRecords) {
    // C12a: validate sourceUrl
    if (!isValidUrl(rec.sourceUrl))
      throw new Error(`C12a: invalid sourceUrl "${rec.sourceUrl}" for cidr ${rec.cidr}`);
    // C12b: validate verifiedAt
    if (!isValidIsoDate(rec.verifiedAt))
      throw new Error(`C12b: invalid verifiedAt "${rec.verifiedAt}" for cidr ${rec.cidr}`);
    const age = daysSince(rec.verifiedAt);
    if (age > STALE_DAYS)
      console.warn(`  WARNING: stale anycast record (${age}d): ${rec.cidr} -- ${rec.provider}`);
    const range = cidrToRange(rec.cidr);
    if (!range) { console.warn(`  WARNING: skipping invalid CIDR: ${rec.cidr}`); continue; }
    const [start, end] = range;
    if (!rec.provider?.trim()) throw new Error(`C12: empty provider for ${rec.cidr}`);
    if (!rec.source?.trim())   throw new Error(`C12: empty source for ${rec.cidr}`);
    prefixes.push({ start, end, provider: rec.provider, service: rec.service ?? null,
                    source: rec.source, cidr: rec.cidr });
  }
  prefixes.sort((a, b) => a.start - b.start);
  return prefixes;
}

// ---------------------------------------------------------------------------
// Code emitters
// ---------------------------------------------------------------------------

function emitGeoIntervals(intervals: GeoInterval[], buildDate: string): string {
  const header = [
    "// AUTO-GENERATED -- do not edit manually.",
    `// Run \`pnpm geoip:update\` to regenerate.`,
    `// Source: DB-IP Lite City CSV -- ${buildDate}`,
    `// License: ${LICENSE_NOTICE}`,
    `import type { IPv4Int } from "./geoTypes";`,
    ``,
    `export interface GeoIntervalRecord {`,
    `  country: string;`,
    `  countryCode: string;`,
    `  city: string | null;`,
    `  latitude: number;`,
    `  longitude: number;`,
    `  accuracyRadiusKm: number | null;`,
    `}`,
    ``,
    `/** [start, end, record] sorted ascending by start. Non-overlapping. */`,
    `export const IPV4_GEO_INTERVALS: [IPv4Int, IPv4Int, GeoIntervalRecord][] = [`,
  ].join("\n");
  const rows = intervals.map(({ start, end, record }) =>
    `  [${start >>> 0}, ${end >>> 0}, ${JSON.stringify(record)}]`
  ).join(",\n");
  return header + "\n" + rows + "\n];\n";
}

function emitAsnIntervals(intervals: AsnInterval[], buildDate: string): string {
  const header = [
    "// AUTO-GENERATED -- do not edit manually.",
    `// Run \`pnpm geoip:update\` to regenerate.`,
    `// Source: DB-IP Lite ASN CSV -- ${buildDate}`,
    `// License: ${LICENSE_NOTICE}`,
    `import type { IPv4Int } from "./geoTypes";`,
    ``,
    `export interface AsnIntervalRecord {`,
    `  asn: number;`,
    `  asOrg: string;`,
    `  asName: string | null;`,
    `}`,
    ``,
    `/** [start, end, record] sorted ascending by start. Non-overlapping. */`,
    `export const IPV4_ASN_INTERVALS: [IPv4Int, IPv4Int, AsnIntervalRecord][] = [`,
  ].join("\n");
  const rows = intervals.map(({ start, end, record }) =>
    `  [${start >>> 0}, ${end >>> 0}, ${JSON.stringify(record)}]`
  ).join(",\n");
  return header + "\n" + rows + "\n];\n";
}

function emitAnycastPrefixes(prefixes: AnycastPrefixRecord[]): string {
  const header = [
    "// AUTO-GENERATED -- do not edit manually.",
    `// Run \`pnpm geoip:update\` to regenerate.`,
    `// Source: scripts/anycast-known-prefixes.json`,
    `import type { IPv4Int } from "./geoTypes";`,
    ``,
    `export interface AnycastPrefixRecord {`,
    `  start: IPv4Int;`,
    `  end: IPv4Int;`,
    `  provider: string;`,
    `  service: string | null;`,
    `  source: string;`,
    `  cidr: string;`,
    `}`,
    ``,
    `/** Sorted ascending by start. Non-overlapping. */`,
    `export const ANYCAST_PREFIXES: AnycastPrefixRecord[] = [`,
  ].join("\n");
  const rows = prefixes.map(p => `  ${JSON.stringify(p)}`).join(",\n");
  return header + "\n" + rows + "\n];\n";
}

function emitMetadata(meta: object): string {
  const iface = [
    "// AUTO-GENERATED -- do not edit manually.",
    `// Run \`pnpm geoip:update\` to regenerate.`,
    `export interface GeoDatabaseMetadata {`,
    `  generatedSchemaVersion: number;`,
    `  provider: string;`,
    `  geoDataset: string;`,
    `  geoDatabaseVersion: string;`,
    `  geoBuildDate: string;`,
    `  asnDataset: string;`,
    `  asnDatabaseVersion: string;`,
    `  asnBuildDate: string;`,
    `  generatedAt: string;`,
    `  compilerVersion: string;`,
    `  sourceGeoChecksum: string;`,
    `  sourceAsnChecksum: string;`,
    `  licenseNotice: string;`,
    `  ipv4RangesRaw: number;`,
    `  ipv4RangesMerged: number;`,
    `  countriesCount: number;`,
    `  cityRecordsCount: number;`,
    `  anycastPrefixesCount: number;`,
    `  asnRangesCount: number;`,
    `}`,
    ``,
    `export const GEO_DATABASE_METADATA: GeoDatabaseMetadata = ${JSON.stringify(meta, null, 2)};`,
    ``,
  ].join("\n");
  return iface;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== NetPlus GeoIP Database Compiler ===");
  console.log(`Compiler: v${COMPILER_VERSION}  |  Output: ${OUTPUT_DIR}\n`);

  fs.mkdirSync(TMP_DIR, { recursive: true });

  const cityPath = process.env["DBIP_CITY_CSV"] ??
    path.join(TMP_DIR, `dbip-city-lite-${YEAR_MONTH}.csv.gz`);
  const asnPath  = process.env["DBIP_ASN_CSV"] ??
    path.join(TMP_DIR, `dbip-asn-lite-${YEAR_MONTH}.csv.gz`);

  if (!fs.existsSync(cityPath)) await downloadFile(CITY_URL, cityPath);
  else console.log(`  Using cached city CSV: ${cityPath}`);

  if (!fs.existsSync(asnPath)) await downloadFile(ASN_URL, asnPath);
  else console.log(`  Using cached ASN CSV: ${asnPath}`);

  // Step 2a: Compute checksums for audit (DB-IP free tier has no separate .sha256 file)
  console.log("\nComputing SHA-256 checksums...");
  const sourceGeoChecksum = sha256File(cityPath);
  const sourceAsnChecksum = sha256File(asnPath);
  console.log(`  City: ${sourceGeoChecksum}`);
  console.log(`  ASN:  ${sourceAsnChecksum}`);

  // Step 2b: Change detection against previous metadata
  const metaPath = path.join(OUTPUT_DIR, "generatedDatabaseMetadata.ts");
  if (fs.existsSync(metaPath) && !process.argv.includes("--force")) {
    const prev = fs.readFileSync(metaPath, "utf8");
    const prevGeo = prev.match(/"sourceGeoChecksum":\s*"([a-f0-9]+)"/)?.[1];
    const prevAsn = prev.match(/"sourceAsnChecksum":\s*"([a-f0-9]+)"/)?.[1];
    if (prevGeo === sourceGeoChecksum && prevAsn === sourceAsnChecksum) {
      console.log("\n  No change detected -- checksums match previous run.");
      console.log("  Skipping regeneration. Use --force to override.");
      process.exit(0);
    }
    console.log("\n  Change detected -- new database version will be compiled.");
  }

  // Step 3: Validate anycast source records (C12a, C12b)
  console.log("\nValidating anycast source records...");
  const anycastSource: AnycastSourceRecord[] =
    JSON.parse(fs.readFileSync(ANYCAST_JSON, "utf8"));
  const anycastPrefixes = compileAnycast(anycastSource);
  validateAnycastPayloads(anycastPrefixes);
  console.log(`  OK: ${anycastPrefixes.length} anycast prefixes`);

  // Step 4: Parse and compile intervals
  console.log("\nParsing City CSV...");
  const rawGeo = await parseCityCSV(cityPath);
  console.log(`  Raw geo intervals:    ${rawGeo.length.toLocaleString()}`);
  console.log("Merging (C5)...");
  const mergedGeo = mergeGeoIntervals(rawGeo);
  console.log(`  Merged geo intervals: ${mergedGeo.length.toLocaleString()}`);
  console.log("Validating geo (C1-C13)...");
  validateIntervals(mergedGeo, "geo");
  validateGeoPayloads(mergedGeo);
  console.log("  OK");

  console.log("\nParsing ASN CSV...");
  const rawAsn = await parseAsnCSV(asnPath);
  console.log(`  Raw ASN intervals:    ${rawAsn.length.toLocaleString()}`);
  console.log("Merging (C5)...");
  const mergedAsn = mergeAsnIntervals(rawAsn);
  console.log(`  Merged ASN intervals: ${mergedAsn.length.toLocaleString()}`);
  console.log("Validating ASN (C1-C13)...");
  validateIntervals(mergedAsn, "asn");
  validateAsnPayloads(mergedAsn);
  console.log("  OK");

  // Metadata
  const buildDate = `${YEAR_MONTH}-01`;
  const countryCodes = new Set(mergedGeo.map(g => g.record.countryCode));
  const cityRecords  = mergedGeo.filter(g => g.record.city !== null).length;

  const metadata = {
    generatedSchemaVersion: GENERATED_SCHEMA_VERSION,
    provider: "DB-IP",
    geoDataset: "DB-IP Lite City",
    geoDatabaseVersion: YEAR_MONTH,
    geoBuildDate: buildDate,
    asnDataset: "DB-IP Lite ASN",
    asnDatabaseVersion: YEAR_MONTH,
    asnBuildDate: buildDate,
    generatedAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
    sourceGeoChecksum,
    sourceAsnChecksum,
    licenseNotice: LICENSE_NOTICE,
    ipv4RangesRaw: rawGeo.length,
    ipv4RangesMerged: mergedGeo.length,
    countriesCount: countryCodes.size,
    cityRecordsCount: cityRecords,
    anycastPrefixesCount: anycastPrefixes.length,
    asnRangesCount: mergedAsn.length,
  };

  // Step 5: Emit
  console.log("\nEmitting generated TypeScript files...");
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "generatedGeoIntervals.ts"),
    emitGeoIntervals(mergedGeo, buildDate), "utf8");
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "generatedAsnIntervals.ts"),
    emitAsnIntervals(mergedAsn, buildDate), "utf8");
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "generatedAnycastPrefixes.ts"),
    emitAnycastPrefixes(anycastPrefixes), "utf8");
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "generatedDatabaseMetadata.ts"),
    emitMetadata(metadata), "utf8");
  console.log("  OK: generatedGeoIntervals.ts");
  console.log("  OK: generatedAsnIntervals.ts");
  console.log("  OK: generatedAnycastPrefixes.ts");
  console.log("  OK: generatedDatabaseMetadata.ts");

  // Freshness check
  const maxAgeDays = parseInt(process.env["GEOIP_MAX_AGE_DAYS"] ?? "30", 10);
  const ageDays    = daysSince(buildDate);
  const ageStatus  = ageDays <= maxAgeDays ? "PASS" : "FAIL";

  console.log(`
=== Statistics Report ===
DB-IP Lite City build:   ${YEAR_MONTH}
IPv4 ranges (raw):       ${rawGeo.length.toLocaleString()}
IPv4 ranges (merged):    ${mergedGeo.length.toLocaleString()}
Countries:               ${countryCodes.size}
City records:            ${cityRecords.toLocaleString()}
DB-IP Lite ASN build:    ${YEAR_MONTH}
ASN ranges:              ${mergedAsn.length.toLocaleString()}
Anycast prefixes:        ${anycastPrefixes.length}
Generated schema v:      ${GENERATED_SCHEMA_VERSION}
Age check:               ${ageStatus} (${ageDays}d old, threshold: ${maxAgeDays}d)
`);

  if (ageStatus === "FAIL") {
    console.error(`ERROR: Data is ${ageDays} days old (threshold: ${maxAgeDays}). Run pnpm geoip:update.`);
    process.exit(1);
  }

  console.log("OK: geoip:update complete.");
}

main().catch((err) => {
  console.error("\n[build-geoip-db] Fatal error:", err);
  process.exit(1);
});
