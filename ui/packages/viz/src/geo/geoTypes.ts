import type { BreakdownRow, EvidenceRef, HostName } from "@netpulse/contract";

/**
 * RFC 6890 / 1918 / 4193 / 4291 / 3927 / 6598 / 5737 / 2544
 * Network address category classification.
 */
export type IpCategory =
  | "public"
  | "private"       // LAN (RFC 1918, RFC 4193)
  | "loopback"      // 127.0.0.0/8, ::1
  | "link_local"    // 169.254.0.0/16, fe80::/10
  | "multicast"     // 224.0.0.0/4, ff00::/8
  | "broadcast"     // 255.255.255.255
  | "unspecified"   // 0.0.0.0, ::
  | "shared"        // CGNAT RFC 6598 (100.64.0.0/10)
  | "documentation" // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32
  | "benchmarking"  // 198.18.0.0/15
  | "reserved"      // 240.0.0.0/4
  | "special"       // 192.0.0.0/24, 192.88.99.0/24
  | "invalid";

export interface IpClassification {
  ip: string;
  normalizedIp: string;
  version: 4 | 6 | null;
  category: IpCategory;
  isPublic: boolean;
  isLocalLan: boolean;
  categoryLabel: string;
  description: string;
}

/**
 * Unsigned 32-bit integer representation of an IPv4 address.
 * Invariant: 0 <= value <= 0xFFFFFFFF.
 * Single conversion entry point: parseIpv4ToUint32() in ipClassifier.ts.
 * The geo resolution pipeline must never perform its own IPv4 parsing.
 */
export type IPv4Int = number;

/**
 * 8-Level Semantic Resolution Ladder.
 * Represents the strongest defensible semantic classification of an endpoint.
 */
export type ResolutionLevel =
  | "physical_endpoint"  // Level 1: exact physical endpoint
  | "city_estimate"      // Level 2: city/metro estimate (e.g. DB-IP / MaxMind municipal coordinate)
  | "cloud_region"       // Level 3: cloud region centroid anchor (e.g. AWS us-east-1, GCP us-central1)
  | "observed_pop"       // Level 4: observed serving PoP (terminating edge PoP from telemetry/PTR/headers)
  | "country"            // Level 5: country boundary only (coordinates omitted from map)
  | "network"            // Level 6: network/ASN identity only
  | "anycast"            // Level 7: anycast distributed identity (no single physical pin)
  | "unknown";           // Level 8: unmapped public/special address space

/**
 * Semantic meaning of a coordinate.
 * Invariant: Only 5 valid values. Generic Anycast (Level 7) returns "unresolved".
 */
export type CoordinateMeaning =
  | "physicalEndpoint"     // Exact physical host
  | "geoIpEstimate"        // Municipal/city GeoIP estimate
  | "cloudRegionCentroid"  // Regional visualization centroid anchor for cloud region
  | "observedServingPoP"   // Serving edge PoP where transaction terminated
  | "unresolved";          // No coordinate assigned

/**
 * Visual map anchor representation kind.
 */
export type AnchorKind =
  | "physical_endpoint"
  | "metro_centroid"
  | "cloud_region_centroid"
  | "observed_pop"
  | "none";

/**
 * Semantic meaning of a resolved geographic location (legacy compatibility).
 */
export type LocationMeaning =
  | "geoIpLocation"  // Producer: DB-IP city or country record / cloud region / observed PoP.
  | "anyCastPoP"     // Producer: Anycast classification stage.
  | "countryOnly"    // Producer: DB-IP record where city is absent or empty.
  | "unresolved";    // Producer: any code path with no match.

export type GeoPrecision =
  | "city"
  | "region"
  | "country"
  | "network"
  | "unknown";

export type GeoResolutionSource =
  | "local_database"
  | "secondary_database"
  | "asn"
  | "rdap"
  | "observed_hostname"
  | "cloud_prefix"
  | "response_header"
  | "composite"
  | "none";

export type NetworkDistribution =
  | "unicast"
  | "anycast"
  | "cloud"
  | "multicast"
  | "unknown";

export type ResolutionLimitation =
  | "city_coordinates_unavailable"
  | "country_level_only"
  | "physical_location_unavailable"
  | "anycast_distributed_routing"
  | "cloud_or_hosting_network"
  | "ipv6_database_unavailable"
  | "private_or_special_address"
  | "unmapped_public_address"
  | "geo_sources_disagree"
  | "invalid_address_syntax";

export type PrecisionDescription =
  | "city-level estimate"
  | "region-level estimate"
  | "country-level estimate"
  | "network-level estimate"
  | "anycast reference location"
  | "unresolved";

/**
 * Application-derived confidence heuristic.
 * NOT supplied by the database. Derived from DB-IP data, ASN, cloud feeds, hostname, and locationMeaning.
 * See CONFIDENCE_DERIVATION_RULES in geoDatabase.ts.
 */
export type GeoConfidence = "high" | "medium" | "low" | null;

/**
 * Individual evidence item extracted during the resolution pipeline.
 */
export interface ResolutionEvidenceItem {
  family: "geoip" | "cloud_prefix" | "asn" | "rir" | "hostname" | "response_header" | "anycast_prefix" | "telemetry_pop";
  source: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Provenance metadata tracking compilation sources and dataset versions.
 */
export interface ResolutionProvenance {
  source: "dbip_city" | "dbip_asn" | "aws_ip_ranges" | "gcp_cloud_ranges" | "azure_service_tags" | "bgp_anycast" | "observed_hostname" | "response_header" | "composite" | "none";
  sourceVersion?: string;
  generatedAt?: string;
  corroboratingSignals?: string[];
}

export interface UnicastCityResolution {
  status: "resolved";
  resolutionLevel: "physical_endpoint" | "city_estimate";
  precision: "city";
  distribution: "unicast";
  mapEligible: true;
  anchorKind?: "physical_endpoint" | "metro_centroid";
  coordinateMeaning?: "physicalEndpoint" | "geoIpEstimate";
  country: string;
  countryCode: string;             // ISO 3166-1 alpha-2
  regionCode?: string;
  regionName?: string;
  city: string;
  latitude: number;                // in [-90, 90]
  longitude: number;               // in [-180, 180]
  accuracyRadiusKm: number | null; // From database if available; null otherwise
  confidence: GeoConfidence;       // App-derived -- see CONFIDENCE_DERIVATION_RULES
  locationMeaning: Exclude<LocationMeaning, "unresolved" | "anyCastPoP">;
  locationLevel: "city";
  precisionDescription: "city-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation?: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface AnycastResolution {
  status: "resolved";
  resolutionLevel: "anycast";
  precision: "city" | "region" | "network" | "country";
  distribution: "anycast";
  mapEligible: false;
  anchorKind: "none";
  coordinateMeaning: "unresolved";
  country: string;
  countryCode: string;             // ISO 3166-1 alpha-2
  regionCode?: string;
  regionName?: string;
  city: string | null;
  latitude?: number;                // in [-90, 90]
  longitude?: number;               // in [-180, 180]
  accuracyRadiusKm: number | null;
  confidence: null;
  locationMeaning: "anyCastPoP";
  locationLevel: "city" | "region" | "unresolved";
  precisionDescription: "anycast reference location";
  source: GeoResolutionSource;
  geoDatabaseVersion: string;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation: "anycast_distributed_routing";
  reason?: string;
  explanation: string;
}

export type AnycastCityReference = AnycastResolution;
export type AnycastRegionReference = AnycastResolution;

export interface UnicastRegionResolution {
  status: "resolved";
  resolutionLevel: "city_estimate" | "cloud_region" | "observed_pop";
  precision: "region";
  distribution: "unicast" | "cloud";
  mapEligible: true;
  anchorKind?: "metro_centroid" | "cloud_region_centroid" | "observed_pop";
  coordinateMeaning?: "geoIpEstimate" | "cloudRegionCentroid" | "observedServingPoP";
  country: string;
  countryCode: string;
  regionCode: string;
  regionName: string;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
  confidence: GeoConfidence;
  locationMeaning: Exclude<LocationMeaning, "unresolved" | "anyCastPoP">;
  locationLevel: "region";
  precisionDescription: "region-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation?: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface CloudRegionResolution {
  status: "resolved";
  resolutionLevel: "cloud_region";
  precision: "region";
  distribution: "cloud" | "unicast";
  mapEligible: true;
  anchorKind: "cloud_region_centroid";
  coordinateMeaning: "cloudRegionCentroid";
  country: string;
  countryCode: string;
  regionCode: string;
  regionName: string;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number;
  confidence: "high";
  locationMeaning: "geoIpLocation";
  locationLevel: "region";
  precisionDescription: "region-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string;
  provider: string;
  cloudRegion: string;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation?: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface ObservedPoPResolution {
  status: "resolved";
  resolutionLevel: "observed_pop";
  precision: "city" | "region";
  distribution: NetworkDistribution;
  mapEligible: true;
  anchorKind: "observed_pop";
  coordinateMeaning: "observedServingPoP";
  country: string;
  countryCode: string;
  regionCode?: string;
  regionName?: string;
  city: string | null;
  popCode?: string;
  popName?: string;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
  confidence: "medium";
  locationMeaning: "geoIpLocation";
  locationLevel: "city" | "region";
  precisionDescription: "city-level estimate" | "region-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation?: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface CountryResolution {
  status: "unresolved"; // Non-coordinate level (unmapped on physical SVG map)
  resolutionLevel: "country";
  precision: "country";
  distribution: NetworkDistribution;
  mapEligible: false;
  anchorKind: "none";
  coordinateMeaning: "unresolved";
  country: string;
  countryCode: string;
  regionCode?: string;
  regionName?: string;
  city?: null;
  latitude?: never;
  longitude?: never;
  accuracyRadiusKm?: null;
  confidence: GeoConfidence;
  locationMeaning: "countryOnly";
  locationLevel: "country";
  precisionDescription: "country-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string | null;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface NetworkResolution {
  status: "unresolved"; // Non-coordinate level (unmapped on physical SVG map)
  resolutionLevel: "network";
  precision: "network";
  distribution: NetworkDistribution;
  mapEligible: false;
  anchorKind: "none";
  coordinateMeaning: "unresolved";
  country?: string;
  countryCode?: string;
  regionCode?: string;
  regionName?: string;
  city?: null;
  latitude?: never;
  longitude?: never;
  accuracyRadiusKm?: null;
  confidence: GeoConfidence;
  locationMeaning: "unresolved";
  locationLevel: "unresolved";
  precisionDescription: "network-level estimate";
  source: GeoResolutionSource;
  geoDatabaseVersion: string | null;
  asn?: number;
  organization: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

export interface UnknownResolution {
  status: "unresolved"; // Non-coordinate level (unmapped on physical SVG map)
  resolutionLevel: "unknown";
  precision: "unknown";
  distribution: NetworkDistribution;
  mapEligible: false;
  anchorKind: "none";
  coordinateMeaning: "unresolved";
  country?: string;
  countryCode?: string;
  regionCode?: string;
  regionName?: string;
  city?: null;
  latitude?: never;
  longitude?: never;
  accuracyRadiusKm?: null;
  confidence: GeoConfidence;
  locationMeaning: "unresolved";
  locationLevel: "unresolved";
  precisionDescription: "unresolved";
  source: "none" | "local_database" | GeoResolutionSource;
  geoDatabaseVersion: string | null;
  asn?: number;
  organization?: string;
  observedHostname?: string;
  provenance?: ResolutionProvenance;
  evidence?: ResolutionEvidenceItem[];
  limitation: ResolutionLimitation;
  reason?: string;
  explanation: string;
}

/**
 * Structurally Discriminated GeoResolution model.
 * Strict invariant: No coordinates are populated when precision is not "city" or "region",
 * and mapEligible is true ONLY for unicast city/region/cloud/pop resolutions with verified coordinates.
 */
export type GeoResolution =
  | UnicastCityResolution
  | AnycastResolution
  | UnicastRegionResolution
  | CloudRegionResolution
  | ObservedPoPResolution
  | CountryResolution
  | NetworkResolution
  | UnknownResolution;

/**
 * Discriminated AsnResolution model.
 * Invariant: ASN data is strictly independent of geographic resolution.
 */
export type AsnResolution =
  | {
      status: "resolved";
      asn: number;
      asOrg: string;
      asName: string | null;
      source: "local_database";
      asnDatabaseVersion: string;
    }
  | {
      status: "unresolved";
      reason: "no_database" | "no_match" | "invalid_address";
      source: "none" | "local_database";
      asnDatabaseVersion: string | null;
    };

/**
 * Result of the anycast prefix lookup stage.
 * Completely independent of GeoResolution.
 * Populated from the generated ANYCAST_PREFIXES dataset.
 */
export interface AnycastClassification {
  isAnycast: boolean;
  provider: string | null;   // null only for non-anycast results
  service: string | null;
  prefixCidr: string | null;
  source: string;            // e.g. "generated-anycast-v1"
}

/**
 * Non-authoritative provider hint extracted from observed hostname patterns.
 * Constrained strictly to "low" confidence to avoid elevating hostname patterns
 * to authoritative network ownership.
 */
export interface ProviderHint {
  provider: string;
  distribution?: NetworkDistribution;
  source: "observed_hostname";
  confidence: "low";
  matchedDomain: string;
}

/**
 * Diagnostic trace representing stage-by-stage evaluation of an IP resolution.
 * Derived from resolveGeoCore to guarantee zero logic divergence between
 * production resolution and diagnostic inspection.
 */
export interface GeoResolutionTrace {
  ip: string;
  addressClassification: IpCategory;
  geoIp: {
    status: "match" | "miss";
    precision?: GeoPrecision;
    country?: string;
    countryCode?: string;
    city?: string | null;
  };
  asn: {
    status: "match" | "miss";
    asn?: number;
    organization?: string;
  };
  anycast: {
    status: "match" | "miss";
    provider?: string | null;
  };
  cloud: {
    status: "match" | "miss";
    provider?: string;
  };
  hostname: {
    status: "match" | "miss";
    hint?: {
      locationName: string;
      countryCode: string;
      iataCode?: string;
    };
    providerHint?: ProviderHint;
    matchedHostname?: string;
  };
  finalPrecision: GeoPrecision;
  finalReason?: ResolutionLimitation | string;
  explanation: string;
  mapEligible: boolean;
}

/**
 * Local origin location resolution state.
 */
export type OriginResolution =
  | {
      status: "resolved";
      label: string;
      latitude: number;
      longitude: number;
      source: "configured" | "local_database";
    }
  | {
      status: "unresolved";
      label: "LOCAL ORIGIN (Location unavailable)";
      source: "none";
    };

/**
 * Telemetry freshness state based on observed delta and volume.
 */
export type TelemetryFreshness = "active" | "recent" | "stale";

/**
 * Normalized enriched host entity.
 */
export interface EnrichedHost {
  ip: string;
  row: BreakdownRow;
  classification: IpClassification;
  geo: GeoResolution;
  asn: AsnResolution;
  anycast: AnycastClassification; // always populated; isAnycast: false for non-anycast
  hostnames: HostName[];
  bytes: number;
  deltaBytes: number;
  flows: number;
  evidence: EvidenceRef[];
  freshness: TelemetryFreshness;
  lastSeenTs: number;
}

import { GEO_COUNTRY_FEATURES } from "./geoCountriesData";

/**
 * Stable identifiers for the "Other Resolved Traffic" aggregate node and selection.
 */
export const OTHER_RESOLVED_ENTITY_ID = "entity-aggregate-other-resolved" as const;
export const OTHER_RESOLVED_NODE_ID = "node-other-resolved" as const;
export const OTHER_RESOLVED_GEOCELL_ID = "geocell-other-resolved" as const;

/**
 * Stable identifiers for non-geographic, unresolved, and local network group selections.
 */
export const UNRESOLVED_PUBLIC_ENTITY_ID = "entity-unresolved-public" as const;
export const LOCAL_LAN_ENTITY_ID = "entity-local-network-lan" as const;
export const SPECIAL_SPACE_ENTITY_ID = "entity-special-address-space" as const;

/**
 * Normalized canonical city key used for identity and aggregation grouping.
 */
export type CanonicalCityKey = string;

/**
 * Branded semantic entity ID types ensuring layer separation.
 */
export type HostEntityId = `entity-host-${string}`;
export type CityAggregateEntityId = `entity-city-${string}-${string}`;
export type CountryAggregateEntityId = `entity-country-${string}`;
export type ClusterEntityId = `entity-cluster-${string}`;
export type AsnEntityId = `entity-asn-${number}`;
export type OtherResolvedEntityId = typeof OTHER_RESOLVED_ENTITY_ID;
export type UnresolvedGroupEntityId = typeof UNRESOLVED_PUBLIC_ENTITY_ID | string;
export type LocalNetworkGroupEntityId =
  | typeof LOCAL_LAN_ENTITY_ID
  | typeof SPECIAL_SPACE_ENTITY_ID
  | string;

export type EntityId =
  | HostEntityId
  | CityAggregateEntityId
  | CountryAggregateEntityId
  | ClusterEntityId
  | AsnEntityId
  | OtherResolvedEntityId
  | UnresolvedGroupEntityId
  | LocalNetworkGroupEntityId
  | string;

/**
 * Canonical transformation for city names:
 * NFD normalization, stripping diacritics via Unicode properties, lowercasing,
 * non-alphanumeric replacement with hyphens, collapsing repeated hyphens, and trimming leading/trailing hyphens.
 *
 * Examples:
 *   "  São   Paulo  " -> "sao-paulo"
 *   "---München---"   -> "munchen"
 */
export function makeCanonicalCityKey(cityName: string): CanonicalCityKey {
  if (!cityName) return "";
  return cityName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Authoritative factory functions for semantic EntityId generation.
 */
export function makeHostEntityId(ip: string): HostEntityId {
  return `entity-host-${ip.trim()}`;
}

export function makeCityAggregateEntityId(countryCode: string, canonicalCityKey: CanonicalCityKey): CityAggregateEntityId {
  return `entity-city-${countryCode.trim().toLowerCase()}-${canonicalCityKey.trim().toLowerCase()}`;
}

export function makeCountryAggregateEntityId(countryCode: string): CountryAggregateEntityId {
  return `entity-country-${countryCode.trim().toLowerCase()}`;
}

export function makeClusterEntityId(geoCellId: string): ClusterEntityId {
  return `entity-cluster-${geoCellId.trim()}`;
}

export function makeAsnEntityId(asn: number): AsnEntityId {
  return `entity-asn-${Math.floor(asn)}` as AsnEntityId;
}

/**
 * Authoritative extractor for canonical geoCellId from various entity, node, or cell identifier strings.
 * Handles entity-cluster-*, cluster-*, aggregate-*, and bare geocell-* identifiers, with or without zoom tier suffixes.
 *
 * Examples:
 *   "entity-cluster-geocell-501_86" -> "geocell-501_86"
 *   "cluster-geocell-501_86-z10"    -> "geocell-501_86"
 *   "aggregate-geocell-501_86-10"   -> "geocell-501_86"
 *   "aggregate-geocell-501_86-z10"  -> "geocell-501_86"
 *   "geocell-501_86"                -> "geocell-501_86"
 *   "geocell-501_86-z20"            -> "geocell-501_86"
 */
export function extractGeoCellId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  const raw = trimmed
    .replace(/^entity-cluster-/, "")
    .replace(/^cluster-/, "")
    .replace(/^aggregate-/, "")
    .replace(/-z?\d+$/, "");

  return raw.startsWith("geocell-") ? raw : null;
}

/**
 * Look up canonical country name from ISO-2 country code with fallback.
 */
const COUNTRY_NAME_BY_ISO2 = new Map<string, string>();
for (const feature of GEO_COUNTRY_FEATURES) {
  if (feature.iso2) {
    COUNTRY_NAME_BY_ISO2.set(feature.iso2.toUpperCase(), feature.name);
  }
}

export function getCanonicalCountryName(countryCode: string, fallback = "Country"): string {
  if (!countryCode) return fallback;
  const upper = countryCode.trim().toUpperCase();
  return COUNTRY_NAME_BY_ISO2.get(upper) || fallback;
}

/**
 * Dedicated factory functions for visual RenderNodeId generation.
 */
export function makeEndpointRenderNodeId(ip: string): string {
  return `endpoint-${ip.trim()}`;
}

export function makeAggregateRenderNodeId(geoCellId: string, zoomTier: number): string {
  return `cluster-${geoCellId.trim()}-z${Math.round(zoomTier)}`;
}

export function makeOtherResolvedRenderNodeId(zoomTier: number): string {
  return `${OTHER_RESOLVED_NODE_ID}-z${Math.round(zoomTier)}`;
}

/**
 * Semantic kind of visualization node.
 */
export type NodeKind =
  | "endpoint"
  | "cluster"
  | "cityAggregate"
  | "regionAggregate"
  | "countryAggregate"
  | "otherResolvedAggregate";

/**
 * Aggregated geographic node representing single endpoints, clustered regions, or render-budget overflow aggregates.
 *
 * Invariant A (Namespace Separation):
 *   - `entityId`: Stable semantic domain identity (HostEntityId, CityAggregateEntityId, CountryAggregateEntityId, ClusterEntityId, or OtherResolvedEntityId).
 *   - `geoCellId`: Spatial cell hash of the *current rendered representation*, not part of the semantic identity of city/country aggregates.
 *   - `id`: Ephemeral DOM/SVG rendering identity (RenderNodeId).
 */
export interface GeoAggregateNode {
  /** Ephemeral cluster/node ID for DOM reconciliation */
  id: string;
  /** Primary selectable semantic entity ID */
  entityId: string;
  /** Spatial cell of the current rendered representation */
  geoCellId: string;
  nodeKind: NodeKind;
  label: string;
  subLabel?: string;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  totalBytes: number;
  totalFlows: number;
  /**
   * Bounded representative endpoint sample (at most MAX_CLUSTER_SAMPLE_IPS = 50 items).
   * Never interpreted as complete membership when memberCount > sampleEndpointIps.length.
   */
  sampleEndpointIps: string[];
  /**
   * @deprecated Use sampleEndpointIps.
   * Retained for backward compatibility; contains the same bounded sample array.
   */
  endpointIps: string[];
  asns: number[];
  freshness: TelemetryFreshness;
  deltaBytes: number;
  /**
   * Authoritative total count of endpoints represented by this node.
   * Never derive this from endpointIps; endpointIps is bounded inspection data.
   */
  memberCount: number;
  /**
   * Optional presentation-level selection metadata.
   * Set when an endpoint belonging to this aggregate is selected, ensuring the containing visual node highlights
   * even if the member is ranked outside the bounded sampleEndpointIps inspection sample.
   */
  selectedMemberEntityId?: string | null;
  locationLevel?: "country" | "city" | "region" | "unresolved" | "multiLocation" | "aggregate";
  precisionDescription?: string;
}

/**
 * Configurable visual rendering thresholds and performance safeguards.
 */
export interface MapRenderPolicy {
  clusterRadiusPx?: number;
  maxVisibleNodes?: number;
  maxVisibleArcs?: number;
  maxVisibleLabels?: number;
  countryAggregationThreshold?: number;
}

/**
 * Deterministic label placement metadata computed by the collision layout engine.
 */
export interface LabelPlacement {
  nodeId: string;
  text: string;
  subText?: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  visible: boolean;
  priority: number;
}

/**
 * Geographic coverage and resolution metrics.
 *
 * Tracks the proportion of observed public Internet destinations that are successfully
 * resolved to geographic coordinates in the local offline database.
 *
 * Geographic Coverage Accounting:
 *   Geographic Coverage = IPv4 GeoIP Resolution / Total Observed Public Endpoints (IPv4 + IPv6)
 *
 * NOTE ON IPv6 DEFERRAL:
 *   Public IPv6 addresses are successfully classified by protocol and address scope,
 *   but geographic coordinate resolution is intentionally deferred in v1 (reason: "ipv6_deferred").
 *   Consequently, public IPv6 traffic appears under `publicHostsCount` and `unresolvedHostsCount`,
 *   and is tracked in `ipv6DeferredHostsCount` and `ipv6DeferredBytes`.
 *   Overall geographic coverage represents resolved physical coordinates and must not be
 *   referred to as unqualified "Internet coverage" without clarifying that public IPv6 is deferred.
 */
export interface CoverageStats {
  totalObservedHosts: number;
  publicHostsCount: number;
  /** Count of endpoints with mapEligible === true (legitimate physical coordinates) */
  resolvedHostsCount: number;
  /** Count of endpoints with mapEligible === false (unmapped on physical SVG map) */
  unresolvedHostsCount: number;
  localLanHostsCount: number;
  specialHostsCount: number;
  totalBytes: number;
  /** Bytes from mapEligible endpoints */
  resolvedBytes: number;
  /** Bytes from non-mapEligible endpoints */
  unresolvedBytes: number;
  /** Percentage of public endpoints physically resolved with map coordinates: (resolvedHostsCount / publicHostsCount) * 100 */
  physicalCoveragePercent: number;
  /** @deprecated Retained for backward compatibility; equals physicalCoveragePercent */
  coveragePercent: number;
  /** Percentage of observed public traffic volume with physical coordinates: (resolvedBytes / totalPublicBytes) * 100 */
  resolvedBytesPercent: number;
  /** Percentage of public endpoints with known network identity: (city + region + country + network) / publicHosts * 100 */
  networkIdentityCoveragePercent: number;
  ipv6DeferredHostsCount?: number;
  ipv6DeferredBytes?: number;

  // Progressive resolution breakdown counts
  cityResolvedHostsCount: number;
  regionResolvedHostsCount: number;
  countryResolvedHostsCount: number;
  networkResolvedHostsCount: number;
  unknownHostsCount: number;

  // 8-Level Exact Count Breakdown
  physicalEndpointHostsCount: number;
  cityEstimateHostsCount: number;
  cloudRegionHostsCount: number;
  observedPopHostsCount: number;
  countryHostsCount: number;
  networkHostsCount: number;
  anycastHostsCount: number;

  // Progressive resolution breakdown bytes
  cityResolvedBytes: number;
  regionResolvedBytes: number;
  countryResolvedBytes: number;
  networkResolvedBytes: number;
  unknownBytes: number;

  // 8-Level Exact Byte Breakdown
  captureTotalBytes: number;
  physicalEndpointBytes: number;
  cityEstimateBytes: number;
  cloudRegionBytes: number;
  observedPopBytes: number;
  countryBytes: number;
  networkBytes: number;
  anycastBytes: number;

  // Visual Anchor Coverage (Level 1 + Level 2 + Level 3 + Level 4)
  visualAnchorCoveragePercent: number;
  visualAnchorBytesPercent: number;

  precisionBreakdown: {
    city: number;
    region: number;
    country: number;
    network: number;
    unknown: number;
  };
  bytesBreakdown: {
    city: number;
    region: number;
    country: number;
    network: number;
    unknown: number;
  };
}

/**
 * SVG Viewport pan and zoom transformation state.
 */
export interface MapViewTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Tombstone details when a selected entity is no longer observed in active window.
 */
export interface TombstoneDetails {
  isInactive: boolean;
  lastObservedTs: number;
  lastObservedBytes: number;
  lastObservedFlows: number;
}

/**
 * Discriminated union variants for SelectedEntity with authoritative semantic entityId.
 */
export type SelectedEndpointLive = {
  kind: "endpoint";
  entityId: HostEntityId;
  ip: string;
  host: EnrichedHost;
  tombstone?: undefined;
};

export type SelectedEndpointTombstone = {
  kind: "endpoint";
  entityId: HostEntityId;
  ip: string;
  host?: undefined;
  tombstone: TombstoneDetails;
};

export type SelectedEndpoint = SelectedEndpointLive | SelectedEndpointTombstone;

export type SelectedCityAggregate = {
  kind: "cityAggregate";
  entityId: CityAggregateEntityId;
  cityName: string;
  countryCode?: string;
  node?: GeoAggregateNode;
  memberHosts: EnrichedHost[];
  /**
   * Exact endpoint cardinality represented by the selected node.
   * Never inferred from memberHosts.length when authoritative node data exists.
   */
  memberCount?: number;
  /**
   * Bounded endpoint inspection sample associated with the selection.
   */
  sampleEndpointIps?: string[];
  /**
   * Derived presentation state: memberHosts.length < memberCount.
   */
  isSampled?: boolean;
  tombstone?: TombstoneDetails;
};

export type SelectedCountryAggregate = {
  kind: "countryAggregate";
  entityId: CountryAggregateEntityId;
  countryCode: string;
  countryName: string;
  node?: GeoAggregateNode;
  memberHosts: EnrichedHost[];
  /**
   * Exact endpoint cardinality represented by the selected node.
   * Never inferred from memberHosts.length when authoritative node data exists.
   */
  memberCount?: number;
  /**
   * Bounded endpoint inspection sample associated with the selection.
   */
  sampleEndpointIps?: string[];
  /**
   * Derived presentation state: memberHosts.length < memberCount.
   */
  isSampled?: boolean;
  tombstone?: TombstoneDetails;
};

export type SelectedCluster = {
  kind: "cluster";
  entityId: ClusterEntityId;
  geoCellId?: string;
  clusterId: string;
  label: string;
  node?: GeoAggregateNode;
  memberHosts: EnrichedHost[];
  /**
   * Exact endpoint cardinality represented by the selected node.
   * Never inferred from memberHosts.length when authoritative node data exists.
   */
  memberCount?: number;
  /**
   * Bounded endpoint inspection sample associated with the selection.
   */
  sampleEndpointIps?: string[];
  /**
   * Derived presentation state: memberHosts.length < memberCount.
   */
  isSampled?: boolean;
  tombstone?: TombstoneDetails;
};

/**
 * Presentation aggregate selection for "Other Resolved Traffic" overflow rollup.
 * Note: As a presentation aggregate created by the rendering budget, it does not bear a tombstone.
 */
export type SelectedOtherResolvedAggregate = {
  kind: "otherResolvedAggregate";
  entityId: OtherResolvedEntityId;
  title: string;
  node?: GeoAggregateNode;
  memberHosts: EnrichedHost[];
  /**
   * Exact endpoint cardinality represented by the selected node.
   * Never inferred from memberHosts.length when authoritative node data exists.
   */
  memberCount?: number;
  /**
   * Bounded endpoint inspection sample associated with the selection.
   */
  sampleEndpointIps?: string[];
  /**
   * Derived presentation state: memberHosts.length < memberCount.
   */
  isSampled?: boolean;
  tombstone?: TombstoneDetails;
};

export type SelectedAsn = {
  kind: "asn";
  asn: number;
  asOrg: string;
  entityId?: AsnEntityId | string;
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

export type SelectedUnresolvedGroup = {
  kind: "unresolvedGroup";
  title: string;
  entityId?: UnresolvedGroupEntityId;
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

export type SelectedLocalNetworkGroup = {
  kind: "localNetworkGroup";
  title: string;
  entityId?: LocalNetworkGroupEntityId;
  category: "lan" | "multicast" | "loopback" | "link_local" | "special";
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

/**
 * Polymorphic SelectedEntity for RightRail synchronization.
 */
export type SelectedEntity =
  | SelectedEndpoint
  | SelectedCityAggregate
  | SelectedCountryAggregate
  | SelectedCluster
  | SelectedOtherResolvedAggregate
  | SelectedAsn
  | SelectedUnresolvedGroup
  | SelectedLocalNetworkGroup;

/**
 * Immutable snapshot record of an entity's frozen state upon becoming inactive.
 */
export interface TombstoneRecord {
  readonly entityId: string;
  readonly kind: SelectedEntity["kind"];
  readonly label: string;
  readonly subLabel?: string;
  readonly tombstone: TombstoneDetails;
  readonly selectedEntity: SelectedEntity;
}

/**
 * Pure, authoritative node selection evaluation function.
 * Determines whether a GeoAggregateNode represents or contains the selected entity or target entity ID.
 */
export function isNodeSelected(
  node: GeoAggregateNode | undefined,
  activeSelection: SelectedEntity | null | undefined,
  selectedEntityId?: string | null
): boolean {
  if (!node) return false;

  if (activeSelection) {
    if (activeSelection.kind === "endpoint") {
      if (
        node.sampleEndpointIps.includes(activeSelection.ip) ||
        node.endpointIps.includes(activeSelection.ip) ||
        node.entityId === activeSelection.entityId ||
        (Boolean(node.selectedMemberEntityId) && (
          node.selectedMemberEntityId === activeSelection.entityId ||
          node.selectedMemberEntityId === makeHostEntityId(activeSelection.ip) ||
          node.selectedMemberEntityId === activeSelection.ip
        ))
      ) {
        return true;
      }
    } else if (activeSelection.kind === "cluster") {
      const activeCellId = activeSelection.geoCellId ? extractGeoCellId(activeSelection.geoCellId) : null;
      const nodeCellId = node.geoCellId ? extractGeoCellId(node.geoCellId) : null;

      if (
        node.nodeKind !== "otherResolvedAggregate" && (
          node.entityId === activeSelection.entityId ||
          node.id === activeSelection.clusterId ||
          (activeCellId !== null && nodeCellId === activeCellId) ||
          (activeSelection.node !== undefined && (node.id === activeSelection.node.id || node.entityId === activeSelection.node.entityId)) ||
          (activeCellId !== null && extractGeoCellId(node.entityId) === activeCellId) ||
          (activeCellId !== null && extractGeoCellId(node.id) === activeCellId) ||
          (activeSelection.sampleEndpointIps !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.sampleEndpointIps!.includes(ip))) ||
          (activeSelection.memberHosts !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip)))
        )
      ) {
        return true;
      }
    } else if (activeSelection.kind === "countryAggregate") {
      if (
        node.nodeKind !== "otherResolvedAggregate" && (
          node.entityId === activeSelection.entityId ||
          (activeSelection.node !== undefined && (node.id === activeSelection.node.id || node.entityId === activeSelection.node.entityId)) ||
          (Boolean(node.countryCode) && activeSelection.countryCode.toUpperCase() === node.countryCode!.toUpperCase()) ||
          (activeSelection.sampleEndpointIps !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.sampleEndpointIps!.includes(ip))) ||
          (activeSelection.memberHosts !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip)))
        )
      ) {
        return true;
      }
    } else if (activeSelection.kind === "cityAggregate") {
      if (
        node.nodeKind !== "otherResolvedAggregate" && (
          node.entityId === activeSelection.entityId ||
          (activeSelection.node !== undefined && (node.id === activeSelection.node.id || node.entityId === activeSelection.node.entityId)) ||
          (activeSelection.cityName.toLowerCase() === node.label.replace(/\s*\(\d+\)$/, "").toLowerCase() &&
            (!activeSelection.countryCode || !node.countryCode || activeSelection.countryCode.toUpperCase() === node.countryCode.toUpperCase())) ||
          (activeSelection.sampleEndpointIps !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.sampleEndpointIps!.includes(ip))) ||
          (activeSelection.memberHosts !== undefined &&
            node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip)))
        )
      ) {
        return true;
      }
    } else if (activeSelection.kind === "otherResolvedAggregate") {
      if (
        node.nodeKind === "otherResolvedAggregate" ||
        node.entityId === OTHER_RESOLVED_ENTITY_ID ||
        (activeSelection.node !== undefined && node.id === activeSelection.node.id)
      ) {
        return true;
      }
    } else if (activeSelection.kind === "asn") {
      if (
        node.nodeKind !== "otherResolvedAggregate" && (
          node.asns.includes(activeSelection.asn) ||
          node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip))
        )
      ) {
        return true;
      }
    } else if (
      activeSelection.kind === "unresolvedGroup" ||
      activeSelection.kind === "localNetworkGroup"
    ) {
      if (
        node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip))
      ) {
        return true;
      }
    }
  }

  if (selectedEntityId) {
    const rawId = selectedEntityId.trim();
    const targetCellId = extractGeoCellId(rawId);

    if (
      node.entityId === rawId ||
      node.id === rawId ||
      node.selectedMemberEntityId === rawId ||
      (node.selectedMemberEntityId != null && (
        node.selectedMemberEntityId === rawId ||
        node.selectedMemberEntityId.replace(/^entity-host-/, "") === rawId.replace(/^entity-host-/, "") ||
        node.selectedMemberEntityId === makeHostEntityId(rawId)
      )) ||
      node.sampleEndpointIps.includes(rawId) ||
      node.endpointIps.includes(rawId) ||
      (rawId.startsWith("entity-host-") && (
        node.sampleEndpointIps.includes(rawId.replace("entity-host-", "")) ||
        node.endpointIps.includes(rawId.replace("entity-host-", "")) ||
        node.selectedMemberEntityId === rawId.replace("entity-host-", "")
      )) ||
      (node.nodeKind !== "otherResolvedAggregate" && rawId.startsWith("entity-asn-") && (
        node.asns.includes(Number(rawId.replace("entity-asn-", "")))
      )) ||
      (node.nodeKind !== "otherResolvedAggregate" && rawId.startsWith("entity-country-") && Boolean(node.countryCode) && (
        node.countryCode!.toUpperCase() === rawId.replace("entity-country-", "").trim().toUpperCase()
      )) ||
      (node.nodeKind !== "otherResolvedAggregate" && rawId.startsWith("entity-city-") && (() => {
        const rawCity = rawId.replace("entity-city-", "").trim();
        const dash = rawCity.indexOf("-");
        if (dash > 0) {
          const cc = rawCity.substring(0, dash).toUpperCase();
          const ck = rawCity.substring(dash + 1).toLowerCase();
          return (
            (!node.countryCode || node.countryCode.toUpperCase() === cc) &&
            makeCanonicalCityKey(node.label.replace(/\s*\(\d+\)$/, "")) === ck
          );
        }
        return false;
      })()) ||
      (rawId === OTHER_RESOLVED_ENTITY_ID && node.nodeKind === "otherResolvedAggregate") ||
      (node.nodeKind !== "otherResolvedAggregate" && targetCellId !== null && (
        node.geoCellId === targetCellId ||
        extractGeoCellId(node.geoCellId) === targetCellId ||
        extractGeoCellId(node.entityId) === targetCellId ||
        extractGeoCellId(node.id) === targetCellId
      ))
    ) {
      return true;
    }
  }

  return false;
}


