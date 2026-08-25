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
  NetworkDistribution,
  ResolutionLimitation,
} from "./geoTypes";
import { classifyIpAddress, parseIpv4ToUint32, clearClassifierCache } from "./ipClassifier";
import { extractLocationFromHostname, type GeoHint } from "./observedHostnameClassifier";
import { BoundedCache } from "./boundedCache";
import { IPV4_GEO_INTERVALS } from "./generatedGeoIntervals";
import { IPV4_ASN_INTERVALS } from "./generatedAsnIntervals";
import { ANYCAST_PREFIXES } from "./generatedAnycastPrefixes";
import { GEO_DATABASE_METADATA } from "./generatedDatabaseMetadata";
import { defaultSecondaryGeoService } from "./secondaryGeoProvider";

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

function classifyDistribution(isAnycast: boolean, asOrg?: string): NetworkDistribution {
  if (isAnycast) return "anycast";
  if (asOrg) {
    const orgLower = asOrg.toLowerCase();
    if (
      orgLower.includes("amazon") ||
      orgLower.includes("aws") ||
      orgLower.includes("google") ||
      orgLower.includes("microsoft") ||
      orgLower.includes("azure") ||
      orgLower.includes("digitalocean") ||
      orgLower.includes("oracle") ||
      orgLower.includes("hetzner") ||
      orgLower.includes("ovh") ||
      orgLower.includes("linode") ||
      orgLower.includes("fastly") ||
      orgLower.includes("akamai") ||
      orgLower.includes("cloudflare")
    ) {
      return "cloud";
    }
  }
  return "unicast";
}

// --- Public API ----------------------------------------------------------------

/**
 * Resolves anycast classification for an IP address.
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
 * Resolves geographic location, network metadata, and progressive precision for an IP address.
 *
 * Progressive Precision Hierarchy:
 *   CITY (validated coordinates) -> REGION -> COUNTRY -> NETWORK (ASN) -> UNKNOWN
 *
 * Structurally Discriminated Invariants:
 *   - `mapEligible: true` ONLY for Unicast with verified physical coordinates (CITY or REGION).
 *   - `mapEligible: false` for Anycast reference locations, COUNTRY, NETWORK, and UNKNOWN.
 *   - Coordinates (`latitude`/`longitude`) are strictly forbidden on COUNTRY, NETWORK, UNKNOWN.
 *   - ASN information enriches COUNTRY results without downgrading precision.
 *   - 100% offline; zero network egress.
 */
export function resolveGeo(ip: string, observedHostnames?: string[]): GeoResolution {
  const normalizedIp = ip.trim();
  const cacheKey = observedHostnames && observedHostnames.length > 0
    ? `${normalizedIp}|${observedHostnames.join(",")}`
    : normalizedIp;

  const cached = geoCache.get(cacheKey);
  if (cached) return cached;

  // Stage 1: Special-use classification -- always first.
  const classification = classifyIpAddress(normalizedIp);

  if (classification.category === "invalid") {
    const result: GeoResolution = {
      status: "unresolved",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      source: "none",
      geoDatabaseVersion: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      limitation: "invalid_address_syntax",
      reason: "invalid_address",
      explanation: "Invalid IP address syntax",
    };
    geoCache.set(cacheKey, result);
    return result;
  }

  if (classification.version === 6 && classification.isPublic) {
    // Explicit IPv6 handling: currently local IPv6 intervals are unavailable
    const result: GeoResolution = {
      status: "unresolved",
      precision: "unknown",
      distribution: "unicast",
      mapEligible: false,
      source: "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      limitation: "ipv6_database_unavailable",
      reason: "ipv6_deferred",
      explanation: "IPv6 geographic coordinate resolution unavailable in local database",
    };
    geoCache.set(cacheKey, result);
    return result;
  }

  if (!classification.isPublic || classification.version !== 4) {
    // Special-use, private, loopback, multicast, etc.
    const result: GeoResolution = {
      status: "unresolved",
      precision: "unknown",
      distribution: classification.category === "multicast" ? "multicast" : "unknown",
      mapEligible: false,
      source: "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      limitation: "private_or_special_address",
      reason: "no_match",
      explanation: `${classification.categoryLabel} address space (physical location omitted)`,
    };
    geoCache.set(cacheKey, result);
    return result;
  }

  // Stage 2: IPv4 conversion
  const v4Num = parseIpv4ToUint32(normalizedIp);
  if (v4Num === null) {
    const result: GeoResolution = {
      status: "unresolved",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      source: "none",
      geoDatabaseVersion: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      limitation: "invalid_address_syntax",
      reason: "invalid_address",
      explanation: "Invalid IPv4 address format",
    };
    geoCache.set(cacheKey, result);
    return result;
  }

  // Stage 3: GeoIP lookup
  const geoRecord = findIpv4GeoInterval(v4Num);

  // Stage 4: Anycast lookup
  const anycastPrefix = findAnycastInterval(v4Num);
  const isAnycast = anycastPrefix !== null;

  // Stage 5: ASN lookup
  const asnRecord = findIpv4AsnInterval(v4Num);

  // Stage 6: Observed Hostname analysis (conservative token-boundary matching)
  let geoHint: GeoHint | null = null;
  let matchedHostnameStr: string | undefined;
  if (observedHostnames && observedHostnames.length > 0) {
    for (const h of observedHostnames) {
      const hint = extractLocationFromHostname(h);
      if (hint) {
        geoHint = hint;
        matchedHostnameStr = h;
        break;
      }
    }
  }

  // Stage 7: Progressive resolution synthesis
  let result: GeoResolution;
  const distribution = classifyDistribution(isAnycast, asnRecord?.asOrg);

  if (geoRecord && geoRecord.city !== null && geoRecord.city.length > 0) {
    // City-level record in GeoIP database
    if (isAnycast) {
      result = {
        status: "resolved",
        precision: "city",
        distribution: "anycast",
        mapEligible: false, // Invariant: Anycast reference coordinates must never be rendered as a single physical endpoint
        country: geoRecord.country,
        countryCode: geoRecord.countryCode,
        city: geoRecord.city,
        latitude: geoRecord.latitude,
        longitude: geoRecord.longitude,
        accuracyRadiusKm: geoRecord.accuracyRadiusKm,
        confidence: null,
        locationMeaning: "anyCastPoP",
        locationLevel: "city",
        precisionDescription: "anycast reference location",
        source: "local_database",
        geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
        asn: asnRecord?.asn,
        organization: asnRecord?.asOrg || anycastPrefix.provider,
        observedHostname: matchedHostnameStr,
        limitation: "anycast_distributed_routing",
        reason: "anycast",
        explanation: "Anycast distributed network; coordinates represent prefix reference, not physical endpoint",
      };
    } else {
      // Unicast City resolution
      const isCompositeAgreement =
        geoHint &&
        geoHint.countryCode === geoRecord.countryCode &&
        (geoHint.locationName.toLowerCase() === geoRecord.city.toLowerCase() ||
          geoHint.iataCode.toLowerCase() === geoRecord.city.substring(0, 3).toLowerCase());

      const confidence = isCompositeAgreement
        ? "high"
        : deriveConfidence("geoIpLocation", geoRecord.accuracyRadiusKm);

      result = {
        status: "resolved",
        precision: "city",
        distribution: "unicast",
        mapEligible: true,
        country: geoRecord.country,
        countryCode: geoRecord.countryCode,
        city: geoRecord.city,
        latitude: geoRecord.latitude,
        longitude: geoRecord.longitude,
        accuracyRadiusKm: geoRecord.accuracyRadiusKm,
        confidence,
        locationMeaning: "geoIpLocation",
        locationLevel: "city",
        precisionDescription: "city-level estimate",
        source: isCompositeAgreement ? "composite" : "local_database",
        geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
        asn: asnRecord?.asn,
        organization: asnRecord?.asOrg,
        observedHostname: matchedHostnameStr,
        explanation: `Geographic city-level resolution for ${geoRecord.city}, ${geoRecord.countryCode}`,
      };
    }
  } else if (geoRecord) {
    // Country-only record in GeoIP database (no city / coordinates)
    const isCompositeAgreement = Boolean(
      geoHint && geoHint.countryCode.toUpperCase() === geoRecord.countryCode.toUpperCase()
    );
    const limitation: ResolutionLimitation = isAnycast
      ? "anycast_distributed_routing"
      : distribution === "cloud"
      ? "cloud_or_hosting_network"
      : "country_level_only";

    result = {
      status: "unresolved",
      precision: "country",
      distribution,
      mapEligible: false,
      country: geoRecord.country,
      countryCode: geoRecord.countryCode,
      city: null,
      confidence: isCompositeAgreement || Boolean(asnRecord) ? "medium" : "low",
      locationMeaning: "countryOnly",
      locationLevel: "country",
      precisionDescription: "country-level estimate",
      source: isCompositeAgreement || Boolean(asnRecord) ? "composite" : "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      asn: asnRecord?.asn,
      organization: asnRecord?.asOrg,
      observedHostname: matchedHostnameStr,
      limitation,
      reason: isAnycast ? "anycast" : distribution === "cloud" ? "cloud" : "country_only",
      explanation: isAnycast
        ? `Resolved to country ${geoRecord.country} (${geoRecord.countryCode}); distributed Anycast network`
        : distribution === "cloud"
        ? `Resolved to country ${geoRecord.country} (${geoRecord.countryCode}); cloud / hosting infrastructure`
        : `Resolved to country ${geoRecord.country} (${geoRecord.countryCode}); city-level coordinates unavailable`,
    };
  } else if (asnRecord) {
    // No GeoIP record, but ASN matches -> NETWORK resolution
    const hasHostnameCountry = Boolean(geoHint && geoHint.countryCode);
    const countryCode = geoHint?.countryCode;
    const limitation: ResolutionLimitation = isAnycast
      ? "anycast_distributed_routing"
      : distribution === "cloud"
      ? "cloud_or_hosting_network"
      : "physical_location_unavailable";

    result = {
      status: "unresolved",
      precision: "network",
      distribution,
      mapEligible: false,
      country: countryCode,
      countryCode,
      city: null,
      confidence: hasHostnameCountry ? "medium" : "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "network-level estimate",
      source: hasHostnameCountry ? "composite" : "asn",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      asn: asnRecord.asn,
      organization: asnRecord.asOrg,
      observedHostname: matchedHostnameStr,
      limitation,
      reason: isAnycast ? "anycast" : distribution === "cloud" ? "cloud" : "asn_only",
      explanation: isAnycast
        ? (hasHostnameCountry
            ? `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) with hostname hint in ${geoHint!.locationName} (distributed anycast)`
            : `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) (distributed anycast)`)
        : distribution === "cloud"
        ? (hasHostnameCountry
            ? `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) with hostname hint in ${geoHint!.locationName} (cloud / hosting provider)`
            : `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) (cloud / hosting provider)`)
        : (hasHostnameCountry
            ? `Physical coordinates unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) with hostname hint in ${geoHint!.locationName}`
            : `Physical coordinates unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg})`),
    };
  } else if (geoHint) {
    // No GeoIP or ASN record, but observed hostname has a verified token hint
    result = {
      status: "unresolved",
      precision: "unknown",
      distribution: isAnycast ? "anycast" : "unknown",
      mapEligible: false,
      country: geoHint.locationName,
      countryCode: geoHint.countryCode,
      city: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "observed_hostname",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      observedHostname: matchedHostnameStr,
      limitation: "unmapped_public_address",
      reason: "no_match",
      explanation: `Unmapped public address; observed hostname suggests ${geoHint.locationName} (${geoHint.countryCode})`,
    };
  } else {
    // Completely unmapped
    result = {
      status: "unresolved",
      precision: "unknown",
      distribution: isAnycast ? "anycast" : "unknown",
      mapEligible: false,
      city: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "none",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      limitation: "unmapped_public_address",
      reason: "no_match",
      explanation: "No geographic coordinates or network match in local database",
    };
  }

  geoCache.set(cacheKey, result);
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
  const ip = (row.label || "").trim();
  const hostnamesList = Array.isArray(row.hostnames) ? row.hostnames.map((h) => h.name) : [];
  const classification = classifyIpAddress(ip);
  const geo = resolveGeo(ip, hostnamesList);
  const asn = resolveAsn(ip);
  const anycast = resolveAnycast(ip);

  const currentBytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? Math.max(0, row.bytes) : 0;
  const currentFlows = typeof row.flows === "number" && Number.isFinite(row.flows) ? Math.max(0, row.flows) : 0;
  const safeDelta = typeof deltaBytes === "number" && Number.isFinite(deltaBytes) ? Math.max(0, deltaBytes) : 0;
  const safeTs = typeof timestamp === "number" && Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;

  let freshness: TelemetryFreshness = "stale";
  if (safeDelta > 0) freshness = "active";
  else if (currentBytes > 0 || currentFlows > 0) freshness = "recent";

  return {
    ip,
    row,
    classification,
    geo,
    asn,
    anycast,
    hostnames: Array.isArray(row.hostnames) ? row.hostnames : [],
    bytes: currentBytes,
    deltaBytes: safeDelta,
    flows: currentFlows,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    freshness,
    lastSeenTs: safeTs,
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
  defaultSecondaryGeoService.clearCache();
  clearClassifierCache();
}
