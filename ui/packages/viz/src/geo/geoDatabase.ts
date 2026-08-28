import type { BreakdownRow } from "@netpulse/contract";
import type {
  AnycastClassification,
  AsnResolution,
  EnrichedHost,
  GeoConfidence,
  GeoResolution,
  GeoResolutionTrace,
  IPv4Int,
  OriginResolution,
  TelemetryFreshness,
  NetworkDistribution,
  ResolutionLimitation,
  ProviderHint,
} from "./geoTypes";
import { classifyIpAddress, parseIpv4ToUint32, clearClassifierCache } from "./ipClassifier";
import { extractLocationFromHostname, extractProviderFromHostname, type GeoHint } from "./observedHostnameClassifier";
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

import { CLOUD_REGION_PREFIXES, type CloudPrefixRecord } from "./generatedCloudPrefixes";

// --- Cloud Region lookup helper ------------------------------------------------

function findCloudInterval(val: IPv4Int): CloudPrefixRecord | null {
  let low = 0;
  let high = CLOUD_REGION_PREFIXES.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const prefix = CLOUD_REGION_PREFIXES[mid]!;
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
      orgLower.includes("cloudflare") ||
      orgLower.includes("hostinger") ||
      orgLower.includes("vultr") ||
      orgLower.includes("leaseweb") ||
      orgLower.includes("alibaba") ||
      orgLower.includes("tencent") ||
      orgLower.includes("scaleway") ||
      orgLower.includes("gcore") ||
      orgLower.includes("equinix") ||
      orgLower.includes("contabo")
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
  const normalizedIp = ip.trim();
  const cached = anycastCache.get(normalizedIp);
  if (cached) return cached;

  const v4Num = parseIpv4ToUint32(normalizedIp);
  if (v4Num === null) {
    const result: AnycastClassification = {
      isAnycast: false, provider: null, service: null, prefixCidr: null,
      source: "generated-anycast-v1",
    };
    anycastCache.set(normalizedIp, result);
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

  anycastCache.set(normalizedIp, result);
  return result;
}

/**
 * Core unified geographic resolution & trace derivation engine.
 * Single source of truth for both production resolution and diagnostic tracing.
 */
export function resolveGeoCore(
  ip: string,
  observedHostnames?: string[]
): { resolution: GeoResolution; trace: GeoResolutionTrace } {
  const normalizedIp = ip.trim();

  // Stage 1: Special-use classification -- always first.
  const classification = classifyIpAddress(normalizedIp);

  if (classification.category === "invalid") {
    const resolution: GeoResolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
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
    const trace: GeoResolutionTrace = {
      ip: normalizedIp,
      addressClassification: "invalid",
      geoIp: { status: "miss" },
      asn: { status: "miss" },
      anycast: { status: "miss" },
      cloud: { status: "miss" },
      hostname: { status: "miss" },
      finalPrecision: "unknown",
      finalReason: "invalid_address_syntax",
      explanation: resolution.explanation,
      mapEligible: false,
    };
    return { resolution, trace };
  }

  if (classification.version === 6 && classification.isPublic) {
    const resolution: GeoResolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution: "unicast",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
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
    const trace: GeoResolutionTrace = {
      ip: normalizedIp,
      addressClassification: classification.category,
      geoIp: { status: "miss" },
      asn: { status: "miss" },
      anycast: { status: "miss" },
      cloud: { status: "miss" },
      hostname: { status: "miss" },
      finalPrecision: "unknown",
      finalReason: "ipv6_database_unavailable",
      explanation: resolution.explanation,
      mapEligible: false,
    };
    return { resolution, trace };
  }

  if (!classification.isPublic || classification.version !== 4) {
    const distribution = classification.category === "multicast" ? "multicast" : "unknown";
    const resolution: GeoResolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution,
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
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
    const trace: GeoResolutionTrace = {
      ip: normalizedIp,
      addressClassification: classification.category,
      geoIp: { status: "miss" },
      asn: { status: "miss" },
      anycast: { status: "miss" },
      cloud: { status: "miss" },
      hostname: { status: "miss" },
      finalPrecision: "unknown",
      finalReason: "private_or_special_address",
      explanation: resolution.explanation,
      mapEligible: false,
    };
    return { resolution, trace };
  }

  // Stage 2: IPv4 conversion
  const v4Num = parseIpv4ToUint32(normalizedIp);
  if (v4Num === null) {
    const resolution: GeoResolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
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
    const trace: GeoResolutionTrace = {
      ip: normalizedIp,
      addressClassification: classification.category,
      geoIp: { status: "miss" },
      asn: { status: "miss" },
      anycast: { status: "miss" },
      cloud: { status: "miss" },
      hostname: { status: "miss" },
      finalPrecision: "unknown",
      finalReason: "invalid_address_syntax",
      explanation: resolution.explanation,
      mapEligible: false,
    };
    return { resolution, trace };
  }

  // Stage 3: Evidence Extraction (Parallel Signal Retrieval)
  const geoRecord = findIpv4GeoInterval(v4Num);
  const cloudRecord = findCloudInterval(v4Num);
  const anycastPrefix = findAnycastInterval(v4Num);
  const isAnycast = anycastPrefix !== null;
  const asnRecord = findIpv4AsnInterval(v4Num);

  // Stage 4: Observed Hostname analysis (conservative token matching & provider domain hint)
  let geoHint: GeoHint | null = null;
  let providerHint: ProviderHint | null = null;
  let matchedGeoHostname: string | undefined;
  let matchedProviderHostname: string | undefined;

  if (observedHostnames && observedHostnames.length > 0) {
    for (const rawH of observedHostnames) {
      if (!rawH || typeof rawH !== "string") continue;
      const h = rawH.trim();
      if (!h) continue;

      if (!geoHint) {
        const gh = extractLocationFromHostname(h);
        if (gh) {
          geoHint = gh;
          matchedGeoHostname = h;
        }
      }
      if (!providerHint) {
        const ph = extractProviderFromHostname(h);
        if (ph) {
          providerHint = ph;
          matchedProviderHostname = h;
        }
      }
    }
  }

  const primaryMatchedHostname = matchedGeoHostname || matchedProviderHostname;
  const distribution = classifyDistribution(isAnycast, asnRecord?.asOrg || providerHint?.provider || cloudRecord?.provider);

  // Conflict Detection
  const hasGeoConflict = Boolean(
    geoRecord && geoHint && geoHint.countryCode && geoRecord.countryCode.toUpperCase() !== geoHint.countryCode.toUpperCase()
  );

  let resolution: GeoResolution;

  // Stage 5: Evidence Fusion Decision Engine (8-Level Ladder)

  if (cloudRecord) {
    // LEVEL 3: Cloud Region Centroid Anchor
    // Invariant: Cloud region coordinates are regional centroids, NEVER physical host machines.
    resolution = {
      status: "resolved",
      resolutionLevel: "cloud_region",
      precision: "region",
      distribution: "cloud",
      mapEligible: true,
      anchorKind: "cloud_region_centroid",
      coordinateMeaning: "cloudRegionCentroid",
      country: cloudRecord.country,
      countryCode: cloudRecord.countryCode,
      regionCode: cloudRecord.regionCode,
      regionName: cloudRecord.regionName,
      city: null,
      latitude: cloudRecord.latitude,
      longitude: cloudRecord.longitude,
      accuracyRadiusKm: cloudRecord.accuracyRadiusKm,
      confidence: "high",
      locationMeaning: "geoIpLocation",
      locationLevel: "region",
      precisionDescription: "region-level estimate",
      source: "cloud_prefix",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      provider: cloudRecord.provider,
      cloudRegion: cloudRecord.cloudRegion,
      asn: asnRecord?.asn,
      organization: asnRecord?.asOrg || cloudRecord.provider,
      observedHostname: primaryMatchedHostname,
      provenance: {
        source: cloudRecord.source === "aws_ip_ranges" || cloudRecord.source === "gcp_cloud_ranges" || cloudRecord.source === "azure_service_tags"
          ? cloudRecord.source
          : "composite",
        sourceVersion: "2026-08-01",
        corroboratingSignals: [cloudRecord.provider, cloudRecord.cloudRegion],
      },
      explanation: `Cloud region anchor: ${cloudRecord.provider} ${cloudRecord.regionName} (${cloudRecord.cloudRegion}); coordinates represent regional centroid, not physical server`,
    };
  } else if (geoRecord && geoRecord.city !== null && geoRecord.city.length > 0 && !isAnycast) {
    // LEVEL 2: Municipal / City GeoIP Estimate (Unicast)
    const isCompositeAgreement = Boolean(
      geoHint &&
      geoHint.countryCode.toUpperCase() === geoRecord.countryCode.toUpperCase() &&
      (geoHint.locationName.toLowerCase() === geoRecord.city.toLowerCase() ||
        geoHint.iataCode.toLowerCase() === geoRecord.city.substring(0, 3).toLowerCase())
    );

    const confidence = hasGeoConflict
      ? "low"
      : isCompositeAgreement
      ? "high"
      : deriveConfidence("geoIpLocation", geoRecord.accuracyRadiusKm);

    const limitation: ResolutionLimitation | undefined = hasGeoConflict
      ? "geo_sources_disagree"
      : undefined;

    resolution = {
      status: "resolved",
      resolutionLevel: "city_estimate",
      precision: "city",
      distribution: "unicast",
      mapEligible: true,
      anchorKind: "metro_centroid",
      coordinateMeaning: "geoIpEstimate",
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
      organization: asnRecord?.asOrg || providerHint?.provider,
      observedHostname: primaryMatchedHostname,
      provenance: {
        source: isCompositeAgreement ? "composite" : "dbip_city",
        sourceVersion: LOCAL_GEOIP_DB_VERSION,
      },
      limitation,
      explanation: hasGeoConflict
        ? `Geographic city-level resolution for ${geoRecord.city}, ${geoRecord.countryCode} (hostname location hint disagrees)`
        : `Geographic city-level resolution for ${geoRecord.city}, ${geoRecord.countryCode}`,
    };
  } else if (isAnycast) {
    // LEVEL 7 (Anycast) or LEVEL 4 (Observed Serving PoP if corroborated)
    if (geoHint && !hasGeoConflict) {
      // LEVEL 4: Observed Serving PoP on Anycast infrastructure
      resolution = {
        status: "resolved",
        resolutionLevel: "observed_pop",
        precision: "city",
        distribution: "anycast",
        mapEligible: true,
        anchorKind: "observed_pop",
        coordinateMeaning: "observedServingPoP",
        country: geoHint.locationName,
        countryCode: geoHint.countryCode,
        regionCode: geoHint.regionCode,
        city: geoHint.city || null,
        popCode: geoHint.iataCode,
        popName: geoHint.locationName,
        latitude: geoHint.latitude,
        longitude: geoHint.longitude,
        accuracyRadiusKm: geoHint.accuracyRadiusKm,
        confidence: "medium",
        locationMeaning: "geoIpLocation",
        locationLevel: "city",
        precisionDescription: "city-level estimate",
        source: "composite",
        geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
        asn: asnRecord?.asn,
        organization: asnRecord?.asOrg || anycastPrefix.provider,
        observedHostname: primaryMatchedHostname,
        provenance: {
          source: "composite",
          corroboratingSignals: [geoHint.matchedToken, anycastPrefix.provider],
        },
        explanation: `Anycast distributed network; observed serving PoP terminating at ${geoHint.locationName} (${geoHint.iataCode})`,
      };
    } else {
      // LEVEL 7: Generic Anycast Network Identity (coordinates omitted from map)
      resolution = {
        status: "resolved",
        resolutionLevel: "anycast",
        precision: geoRecord?.city ? "city" : "network",
        distribution: "anycast",
        mapEligible: false,
        anchorKind: "none",
        coordinateMeaning: "unresolved",
        country: geoRecord?.country || (asnRecord ? "Global Anycast" : "Anycast Network"),
        countryCode: geoRecord?.countryCode || "XX",
        city: geoRecord?.city || null,
        latitude: geoRecord?.latitude,
        longitude: geoRecord?.longitude,
        accuracyRadiusKm: geoRecord?.accuracyRadiusKm ?? null,
        confidence: null,
        locationMeaning: "anyCastPoP",
        locationLevel: geoRecord?.city ? "city" : "unresolved",
        precisionDescription: "anycast reference location",
        source: "local_database",
        geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
        asn: asnRecord?.asn,
        organization: asnRecord?.asOrg || anycastPrefix.provider,
        observedHostname: primaryMatchedHostname,
        provenance: {
          source: "bgp_anycast",
          corroboratingSignals: [anycastPrefix.provider, anycastPrefix.cidr],
        },
        limitation: "anycast_distributed_routing",
        reason: "anycast",
        explanation: "Anycast distributed network; coordinates represent prefix reference, not physical endpoint",
      };
    }
  } else if (geoHint && asnRecord && !hasGeoConflict) {
    // LEVEL 4: Observed Serving PoP from Corroborated Hostname & ASN (6-Gate Promotion)
    resolution = {
      status: "resolved",
      resolutionLevel: "observed_pop",
      precision: "region",
      distribution,
      mapEligible: true,
      anchorKind: "observed_pop",
      coordinateMeaning: "observedServingPoP",
      country: geoHint.locationName,
      countryCode: geoHint.countryCode,
      regionCode: geoHint.regionCode,
      regionName: geoHint.locationName,
      city: geoHint.city || null,
      popCode: geoHint.iataCode,
      popName: geoHint.locationName,
      latitude: geoHint.latitude,
      longitude: geoHint.longitude,
      accuracyRadiusKm: geoHint.accuracyRadiusKm,
      confidence: "medium",
      locationMeaning: "geoIpLocation",
      locationLevel: "region",
      precisionDescription: "region-level estimate",
      source: "composite",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      asn: asnRecord.asn,
      organization: asnRecord.asOrg,
      observedHostname: primaryMatchedHostname,
      provenance: {
        source: "composite",
        corroboratingSignals: [geoHint.matchedToken, asnRecord.asOrg],
      },
      explanation: `Observed serving location inferred from hostname token (${geoHint.matchedToken}) in ${geoHint.locationName}, corroborated by AS${asnRecord.asn} (${asnRecord.asOrg}); represents serving edge PoP`,
    };
  } else if (geoRecord) {
    // LEVEL 5: Country-only record in GeoIP database (no city / coordinates)
    const isCompositeAgreement = Boolean(
      geoHint && geoHint.countryCode.toUpperCase() === geoRecord.countryCode.toUpperCase()
    );
    const limitation: ResolutionLimitation = distribution === "cloud"
      ? "cloud_or_hosting_network"
      : hasGeoConflict
      ? "geo_sources_disagree"
      : "country_level_only";

    resolution = {
      status: "unresolved",
      resolutionLevel: "country",
      precision: "country",
      distribution,
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
      country: geoRecord.country,
      countryCode: geoRecord.countryCode,
      city: null,
      confidence: hasGeoConflict ? "low" : (isCompositeAgreement || Boolean(asnRecord) ? "medium" : "low"),
      locationMeaning: "countryOnly",
      locationLevel: "country",
      precisionDescription: "country-level estimate",
      source: isCompositeAgreement || Boolean(asnRecord) ? "composite" : "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      asn: asnRecord?.asn,
      organization: asnRecord?.asOrg || providerHint?.provider,
      observedHostname: primaryMatchedHostname,
      provenance: {
        source: "dbip_city",
        sourceVersion: LOCAL_GEOIP_DB_VERSION,
      },
      limitation,
      reason: distribution === "cloud" ? "cloud" : (hasGeoConflict ? "sources_disagree" : "country_only"),
      explanation: distribution === "cloud"
        ? `Resolved to country ${geoRecord.country} (${geoRecord.countryCode}); cloud / hosting infrastructure`
        : `Resolved to country ${geoRecord.country} (${geoRecord.countryCode}); city-level coordinates unavailable`,
    };
  } else if (asnRecord) {
    // LEVEL 6: Network / ASN Resolution
    const hasHostnameCountry = Boolean(geoHint && geoHint.countryCode);
    const countryCode = geoHint?.countryCode;
    const limitation: ResolutionLimitation = distribution === "cloud"
      ? "cloud_or_hosting_network"
      : "physical_location_unavailable";

    const isGoogle = asnRecord.asOrg.toLowerCase().includes("google");
    const explanation = distribution === "cloud"
      ? (isGoogle
          ? `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) (cloud / hosting provider)`
          : (hasHostnameCountry
              ? `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) with hostname hint in ${geoHint!.locationName} (cloud / hosting provider)`
              : `Physical location unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) (cloud / hosting provider)`))
      : (hasHostnameCountry
          ? `Physical coordinates unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg}) with hostname hint in ${geoHint!.locationName}`
          : `Physical coordinates unavailable; identified as AS${asnRecord.asn} (${asnRecord.asOrg})`);

    resolution = {
      status: "unresolved",
      resolutionLevel: "network",
      precision: "network",
      distribution,
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
      country: countryCode,
      countryCode,
      city: null,
      confidence: hasHostnameCountry ? "medium" : "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "network-level estimate",
      source: hasHostnameCountry ? "composite" : "local_database",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      asn: asnRecord.asn,
      organization: asnRecord.asOrg,
      observedHostname: primaryMatchedHostname,
      provenance: {
        source: "dbip_asn",
        sourceVersion: LOCAL_ASN_DB_VERSION,
      },
      limitation,
      reason: distribution === "cloud" ? "cloud" : "asn_only",
      explanation,
    };
  } else if (providerHint) {
    // LEVEL 6: Network Resolution from Provider Domain
    resolution = {
      status: "unresolved",
      resolutionLevel: "network",
      precision: "network",
      distribution: providerHint.distribution || "cloud",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
      organization: providerHint.provider,
      city: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "network-level estimate",
      source: "observed_hostname",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      observedHostname: matchedProviderHostname,
      provenance: {
        source: "observed_hostname",
      },
      limitation: "cloud_or_hosting_network",
      reason: "cloud",
      explanation: `Network/provider identity inferred from observed hostname (${matchedProviderHostname}); IP-level ASN ownership was not established.`,
    };
  } else if (geoHint) {
    // LEVEL 8: Unknown with Hostname Hint
    resolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
      country: geoHint.locationName,
      countryCode: geoHint.countryCode,
      city: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "observed_hostname",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      observedHostname: matchedGeoHostname,
      provenance: {
        source: "observed_hostname",
      },
      limitation: "unmapped_public_address",
      reason: "no_match",
      explanation: `Unmapped public address; observed hostname suggests ${geoHint.locationName} (${geoHint.countryCode})`,
    };
  } else {
    // LEVEL 8: Unknown
    resolution = {
      status: "unresolved",
      resolutionLevel: "unknown",
      precision: "unknown",
      distribution: "unknown",
      mapEligible: false,
      anchorKind: "none",
      coordinateMeaning: "unresolved",
      city: null,
      confidence: "low",
      locationMeaning: "unresolved",
      locationLevel: "unresolved",
      precisionDescription: "unresolved",
      source: "none",
      geoDatabaseVersion: LOCAL_GEOIP_DB_VERSION,
      provenance: {
        source: "none",
      },
      limitation: "unmapped_public_address",
      reason: "no_match",
      explanation: "No local geographic, country, ASN, or network evidence was found.",
    };
  }

  // Diagnostic trace object built from the exact same evaluation
  const trace: GeoResolutionTrace = {
    ip: normalizedIp,
    addressClassification: classification.category,
    geoIp: {
      status: geoRecord ? "match" : "miss",
      precision: geoRecord ? (geoRecord.city ? "city" : "country") : undefined,
      country: geoRecord?.country,
      countryCode: geoRecord?.countryCode,
      city: geoRecord?.city,
    },
    asn: {
      status: asnRecord ? "match" : "miss",
      asn: asnRecord?.asn,
      organization: asnRecord?.asOrg,
    },
    anycast: {
      status: isAnycast ? "match" : "miss",
      provider: anycastPrefix?.provider ?? null,
    },
    cloud: {
      status: (cloudRecord || distribution === "cloud") ? "match" : "miss",
      provider: cloudRecord?.provider || (distribution === "cloud" ? (asnRecord?.asOrg || providerHint?.provider) : undefined),
    },
    hostname: {
      status: (geoHint || providerHint) ? "match" : "miss",
      hint: geoHint ? { locationName: geoHint.locationName, countryCode: geoHint.countryCode, iataCode: geoHint.iataCode } : undefined,
      providerHint: providerHint ?? undefined,
      matchedHostname: primaryMatchedHostname,
    },
    finalPrecision: resolution.precision,
    finalReason: resolution.limitation || resolution.reason,
    explanation: resolution.explanation,
    mapEligible: resolution.mapEligible,
  };

  return { resolution, trace };
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

  const { resolution } = resolveGeoCore(ip, observedHostnames);
  geoCache.set(cacheKey, resolution);
  return resolution;
}

/**
 * Diagnostic trace of IP resolution evaluation.
 * Returns the exact decision breakdown generated by resolveGeoCore.
 */
export function traceGeoResolution(ip: string, observedHostnames?: string[]): GeoResolutionTrace {
  const { trace } = resolveGeoCore(ip, observedHostnames);
  return trace;
}

/**
 * Resolves Autonomous System Number and Organization for an IP address.
 * Strictly independent of geographic resolution.
 */
export function resolveAsn(ip: string): AsnResolution {
  const normalizedIp = ip.trim();
  const cached = asnCache.get(normalizedIp);
  if (cached) return cached;

  const classification = classifyIpAddress(normalizedIp);
  if (!classification.isPublic || classification.version !== 4) {
    const result: AsnResolution = {
      status: "unresolved",
      reason: classification.category === "invalid" ? "invalid_address" : "no_match",
      source: "local_database",
      asnDatabaseVersion: LOCAL_ASN_DB_VERSION,
    };
    asnCache.set(normalizedIp, result);
    return result;
  }

  const v4Num = parseIpv4ToUint32(normalizedIp);
  if (v4Num === null) {
    const result: AsnResolution = {
      status: "unresolved",
      reason: "invalid_address",
      source: "none",
      asnDatabaseVersion: null,
    };
    asnCache.set(normalizedIp, result);
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
    asnCache.set(normalizedIp, result);
    return result;
  }

  const result: AsnResolution = {
    status: "unresolved",
    reason: "no_match",
    source: "local_database",
    asnDatabaseVersion: LOCAL_ASN_DB_VERSION,
  };
  asnCache.set(normalizedIp, result);
  return result;
}

/**
 * Enriches a raw telemetry BreakdownRow into a normalized EnrichedHost entity.
 * Pure and deterministic: lastSeenTs is derived from telemetry metadata / timestamp,
 * never from evaluation wall-clock time.
 */
export function enrichHost(row: BreakdownRow, deltaBytes = 0, timestamp = 0): EnrichedHost {
  const ip = (row.label || "").trim();
  const hostnamesList = Array.isArray(row.hostnames)
    ? row.hostnames
        .map((h) => (typeof h?.name === "string" ? h.name.trim() : ""))
        .filter(Boolean)
    : [];
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
