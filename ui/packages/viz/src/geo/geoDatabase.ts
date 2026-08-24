import type { BreakdownRow } from "@netpulse/contract";
import type {
  AnycastClassification,
  AsnResolution,
  EnrichedHost,
  GeoConfidence,
  GeoResolution,
  IPv4Int,
  OriginResolution,
  TelemetryFreshness,
} from "./geoTypes";
import { classifyIpAddress, parseIpv4ToUint32, clearClassifierCache } from "./ipClassifier";
import { BoundedCache } from "./boundedCache";
import { IPV4_GEO_INTERVALS } from "./generatedGeoIntervals";
import { IPV4_ASN_INTERVALS } from "./generatedAsnIntervals";
import { ANYCAST_PREFIXES } from "./generatedAnycastPrefixes";
import { GEO_DATABASE_METADATA } from "./generatedDatabaseMetadata";

/**
 * GeoIP Dataset Metadata & Governance
 * ------------------------------------
 * Primary Dataset: DB-IP Lite City (https://db-ip.com)
 * License: Creative Commons Attribution 4.0 (CC BY 4.0)
 * Attribution: "IP Geolocation by DB-IP" -- see ATTRIBUTION.md
 * Format: Pre-compiled TypeScript interval table (generated from DB-IP Lite CSV)
 * Privacy Invariant: 100% Offline, zero egress, zero external network queries.
 *
 * Generated files (do not edit manually):
 *   generatedGeoIntervals.ts     -- IPv4 geo lookup table
 *   generatedAsnIntervals.ts     -- IPv4 ASN lookup table
 *   generatedAnycastPrefixes.ts  -- Curated anycast prefix dataset
 *   generatedDatabaseMetadata.ts -- Provenance and checksums
 *
 * To update: pnpm geoip:update && pnpm geoip:verify
 */

// --- Runtime defensive guard ---------------------------------------------------
// Primary validation authority is `pnpm geoip:verify` (build time).
// This guard catches the case where a generated file is absent or was committed
// without passing verification.
// A length > 0 check does not validate structure or payload correctness --
// that is the responsibility of verify-geoip-db.ts.
if (ANYCAST_PREFIXES.length === 0) {
  throw new Error(
    "[geoDatabase] ANYCAST_PREFIXES is empty. " +
    "Run `pnpm geoip:update && pnpm geoip:verify` to generate and validate " +
    "the required dataset. A missing anycast dataset must not silently " +
    "downgrade anycast addresses to ordinary GeoIP results."
  );
}

export const LOCAL_GEOIP_DB_VERSION = GEO_DATABASE_METADATA.geoDatabaseVersion;
export const LOCAL_ASN_DB_VERSION = GEO_DATABASE_METADATA.asnDatabaseVersion;

// --- Internal record shapes ----------------------------------------------------

export interface GeoRecord {
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
}

export interface AsnRecord {
  asn: number;
  asOrg: string;
  asName: string | null;
}

// --- Bounded LRU caches --------------------------------------------------------

const geoCache     = new BoundedCache<string, GeoResolution>(32768);
const asnCache     = new BoundedCache<string, AsnResolution>(32768);
const anycastCache = new BoundedCache<string, AnycastClassification>(32768);

// --- Interval types ------------------------------------------------------------

type Ipv4GeoInterval = [IPv4Int, IPv4Int, GeoRecord];
type Ipv4AsnInterval = [IPv4Int, IPv4Int, AsnRecord];

// --- Binary search helpers -----------------------------------------------------

function findIpv4GeoInterval(val: IPv4Int): GeoRecord | null {
  const arr = IPV4_GEO_INTERVALS as Ipv4GeoInterval[];
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [start, end, record] = arr[mid]!;
    if (val >= start && val <= end) return record;
    if (val < start) high = mid - 1;
    else low = mid + 1;
  }
  return null;
}

function findIpv4AsnInterval(val: IPv4Int): AsnRecord | null {
  const arr = IPV4_ASN_INTERVALS as Ipv4AsnInterval[];
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const [start, end, record] = arr[mid]!;
    if (val >= start && val <= end) return record;
    if (val < start) high = mid - 1;
    else low = mid + 1;
  }
  return null;
}

function findAnycastInterval(val: IPv4Int): typeof ANYCAST_PREFIXES[number] | null {
  let low = 0;
  let high = ANYCAST_PREFIXES.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const prefix = ANYCAST_PREFIXES[mid]!;
    if (val >= prefix.start && val <= prefix.end) return prefix;
    if (val < prefix.start) high = mid - 1;
    else low = mid + 1;
  }
  return null;
}

// --- CONFIDENCE_DERIVATION_RULES -----------------------------------------------
// Application-derived heuristic. NOT supplied by the database.
// Thresholds are application policy, not database truth.
// ---------------------------------------------------------------------------
// locationMeaning === "anyCastPoP"               -> null
// locationMeaning === "countryOnly"              -> "low"
// city + accuracyRadiusKm <= 50                  -> "high"
// city + accuracyRadiusKm <= 200                 -> "medium"
// city + accuracyRadiusKm > 200 || null          -> "low"

function deriveConfidence(
  locationMeaning: string,
  accuracyRadiusKm: number | null
): GeoConfidence {
  if (locationMeaning === "anyCastPoP") return null;
  if (locationMeaning === "countryOnly") return "low";
  // city-level
  if (accuracyRadiusKm !== null && accuracyRadiusKm <= 50) return "high";
  if (accuracyRadiusKm !== null && accuracyRadiusKm <= 200) return "medium";
  return "low";
}

// --- Public API ----------------------------------------------------------------

/**
 * Resolves anycast classification for an IP address.
 * Stage 4 of the resolution pipeline -- always called for public IPv4.
 * Strictly offline.
 */
export function resolveAnycast(ip: string): AnycastClassification {
  const cached = anycastCache.get(ip);
  if (cached) return cached;

  const v4Num = parseIpv4ToUint32(ip);
  if (v4Num === null) {
    const result: AnycastClassification = {
      isAnycast: false, provider: null, service: null, prefixCidr: null,
      source: "generated-anycast-v1",
    };
    anycastCache.set(ip, result);
    return result;
  }

  const prefix = findAnycastInterval(v4Num);
  const result: AnycastClassification = prefix
    ? {
        isAnycast: true,
        provider: prefix.provider,
        service: prefix.service,
        prefixCidr: prefix.cidr,
        source: "generated-anycast-v1",
      }
    : {
        isAnycast: false,
        provider: null,
        service: null,
        prefixCidr: null,
        source: "generated-anycast-v1",
      };

  anycastCache.set(ip, result);
  return result;
}

/**
 * Resolves geographic location for an IP address.
 *
 * Five-stage pipeline (strictly ordered):
 *
 *   Stage 1: Special-use classification via classifyIpAddress().
 *            Invariant: SPECIAL_USE_IP_MUST_NEVER_REACH_GEOIP_LOOKUP
 *            classifyIpAddress() runs first. If not (IPv4 AND public),
 *            returns unresolved immediately. No IPv4 conversion yet.
 *
 *   Stage 2: parseIpv4ToUint32() -- called ONLY after Stage 1 establishes
 *            protocol=IPv4 AND scope=public.
 *
 *   Stage 3: GeoIP lookup (binary search over IPV4_GEO_INTERVALS)
 *
 *   Stage 4: Anycast lookup (binary search over ANYCAST_PREFIXES)
 *
 *   Stage 5: Semantic classification -> final GeoResolution
 *            Anycast is an INPUT here. GeoResolution is not constructed
 *            until this point -- no intermediate object is mutated.
 *
 * Strictly offline. Zero external network egress.
 */
export function resolveGeo(ip: string): GeoResolution {
  const cached = geoCache.get(ip);
  if (cached) return cached;

  // Stage 1: Special-use classification -- always first.
  // No IPv4 parsing has occurred yet at this point.
  const classification = classifyIpAddress(ip);

  if (classification.version === 6 && classification.isPublic) {
    // Explicit v1 deferral -- public IPv6 is never assigned coordinates.
    // No IPv6 address is assigned coordinates derived from an IPv4 lookup.
    const result: GeoResolution = {
      status: "unresolved",
      reason: "ipv6_deferred",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
    };
    geoCache.set(ip, result);
    return result;
  }

  if (!classification.isPublic || classification.version !== 4) {
    // Special-use, private, loopback, multicast, etc. -- never reach GeoIP lookup.
    const result: GeoResolution = {
      status: "unresolved",
      reason: classification.category === "invalid" ? "invalid_address" : "no_match",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
    };
    geoCache.set(ip, result);
    return result;
  }

  // Stage 2: IPv4 conversion -- only reachable for public IPv4.
  // This is the single IPv4 conversion entry point in the geo layer.
  const v4Num = parseIpv4ToUint32(ip);
  if (v4Num === null) {
    const result: GeoResolution = {
      status: "unresolved",
      reason: "invalid_address",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "none",
      geoDatabaseVersion: null,
    };
    geoCache.set(ip, result);
    return result;
  }

  // Stage 3: GeoIP lookup
  const geoRecord = findIpv4GeoInterval(v4Num);

  // Stage 4: Anycast lookup
  const anycastPrefix = findAnycastInterval(v4Num);
  const isAnycast = anycastPrefix !== null;

  if (!geoRecord) {
    const result: GeoResolution = {
      status: "unresolved",
      reason: "no_match",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
    };
    geoCache.set(ip, result);
    return result;
  }

  // Stage 5: Semantic classification.
  // Anycast is an input -- GeoResolution is not constructed until this point.
  const hasCity = geoRecord.city !== null && geoRecord.city.length > 0;

  let locationMeaning: "geoIpLocation" | "anyCastPoP" | "countryOnly";
  let locationLevel: "city" | "country";
  let precisionDescription: "city-level estimate" | "country-level estimate" | "anycast reference location";

  if (isAnycast) {
    // When isAnycast === true, GeoIP coordinates are retained as the
    // dataset-associated reference location for the anycast prefix.
    // They are NOT the nearest responding PoP.
    // They are NOT a physical endpoint location.
    // The UI must communicate this distinction explicitly.
    locationMeaning = "anyCastPoP";
    locationLevel = hasCity ? "city" : "country";
    precisionDescription = "anycast reference location";
  } else if (hasCity) {
    locationMeaning = "geoIpLocation";
    locationLevel = "city";
    precisionDescription = "city-level estimate";
  } else {
    locationMeaning = "countryOnly";
    locationLevel = "country";
    precisionDescription = "country-level estimate";
  }

  // Stage 5b: Confidence derivation
  const confidence = deriveConfidence(locationMeaning, geoRecord.accuracyRadiusKm);

  const result: GeoResolution = {
    status: "resolved",
    country: geoRecord.country,
    countryCode: geoRecord.countryCode,
    city: hasCity ? geoRecord.city : null,
    latitude: geoRecord.latitude,
    longitude: geoRecord.longitude,
    accuracyRadiusKm: geoRecord.accuracyRadiusKm,
    confidence,
    locationMeaning,
    locationLevel,
    precisionDescription,
    source: "local_database",
    geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
  };
  geoCache.set(ip, result);
  return result;
}

/**
 * Resolves Autonomous System Number and Organization for an IP address.
 * Strictly independent of geographic resolution.
 */
export function resolveAsn(ip: string): AsnResolution {
  const cached = asnCache.get(ip);
  if (cached) return cached;

  const classification = classifyIpAddress(ip);
  if (!classification.isPublic || classification.version !== 4) {
    const result: AsnResolution = {
      status: "unresolved",
      reason: classification.category === "invalid" ? "invalid_address" : "no_match",
      source: "local_database",
      asnDatabaseVersion: LOCAL_ASN_DB_VERSION,
    };
    asnCache.set(ip, result);
    return result;
  }

  const v4Num = parseIpv4ToUint32(ip);
  if (v4Num === null) {
    const result: AsnResolution = {
      status: "unresolved",
      reason: "invalid_address",
      source: "none",
      asnDatabaseVersion: null,
    };
    asnCache.set(ip, result);
    return result;
  }

  const match = findIpv4AsnInterval(v4Num);
  if (match) {
    const result: AsnResolution = {
      status: "resolved",
      asn: match.asn,
      asOrg: match.asOrg,
      asName: match.asName,
      source: "local_database",
      asnDatabaseVersion: LOCAL_ASN_DB_VERSION,
    };
    asnCache.set(ip, result);
    return result;
  }

  const result: AsnResolution = {
    status: "unresolved",
    reason: "no_match",
    source: "local_database",
    asnDatabaseVersion: LOCAL_ASN_DB_VERSION,
  };
  asnCache.set(ip, result);
  return result;
}

/**
 * Enriches a raw telemetry BreakdownRow into a normalized EnrichedHost entity.
 * Pure and deterministic: lastSeenTs is derived from telemetry metadata / timestamp,
 * never from evaluation wall-clock time.
 */
export function enrichHost(row: BreakdownRow, deltaBytes = 0, timestamp = 0): EnrichedHost {
  const ip = row.label.trim();
  const classification = classifyIpAddress(ip);
  const geo = resolveGeo(ip);
  const asn = resolveAsn(ip);
  const anycast = resolveAnycast(ip);

  let freshness: TelemetryFreshness = "stale";
  if (deltaBytes > 0) freshness = "active";
  else if (row.bytes > 0 || row.flows > 0) freshness = "recent";

  return {
    ip,
    row,
    classification,
    geo,
    asn,
    anycast,
    hostnames: row.hostnames || [],
    bytes: row.bytes,
    deltaBytes,
    flows: row.flows,
    evidence: row.evidence || [],
    freshness,
    lastSeenTs: timestamp,
  };
}

/**
 * Returns default origin location state (honest unresolved origin fallback).
 */
export function getLocalOrigin(): OriginResolution {
  return {
    status: "unresolved",
    label: "LOCAL ORIGIN (Location unavailable)",
    source: "none",
  };
}

/**
 * Clears all lookup caches (useful for testing and memory resets).
 */
export function clearGeoCaches(): void {
  geoCache.clear();
  asnCache.clear();
  anycastCache.clear();
  clearClassifierCache();
}
