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
 * Semantic meaning of a resolved geographic location.
 * Each value has exactly one defined producer. No value is inferred
 * from organization name or assumed from prefix size.
 */
export type LocationMeaning =
  | "geoIpLocation"  // Producer: DB-IP city or country record.
                     // Meaning: GeoIP-associated location estimate.
                     //          Does NOT mean the address was physically observed here.
  | "anyCastPoP"     // Producer: AnycastClassification stage (curated prefix dataset).
                     // Meaning: address belongs to a known anycast prefix.
                     //          Coordinates are the DB-IP dataset reference for that
                     //          prefix -- NOT the nearest responding PoP, NOT a physical
                     //          endpoint location.
  | "countryOnly"    // Producer: DB-IP record where city is absent or empty.
  | "unresolved";    // Producer: any code path with no match.

export type PrecisionDescription =
  | "city-level estimate"
  | "country-level estimate"
  | "anycast reference location"
  | "unresolved";

/**
 * Application-derived confidence heuristic.
 * NOT supplied by the database. Derived from DB-IP data and locationMeaning.
 * See CONFIDENCE_DERIVATION_RULES in geoDatabase.ts.
 */
export type GeoConfidence = "high" | "medium" | "low" | null;

/**
 * Discriminated GeoResolution model.
 * Strict invariant: No coordinates or city are populated when status is "unresolved".
 */
export type GeoResolution =
  | {
      status: "resolved";
      country: string;
      countryCode: string;             // ISO 3166-1 alpha-2
      city: string | null;
      latitude: number;                // in [-90, 90]
      longitude: number;               // in [-180, 180]
      accuracyRadiusKm: number | null; // From database if available; null otherwise
      confidence: GeoConfidence;       // App-derived -- see CONFIDENCE_DERIVATION_RULES
      locationMeaning: Exclude<LocationMeaning, "unresolved">;
      locationLevel: "city" | "country";
      precisionDescription: Exclude<PrecisionDescription, "unresolved">;
      source: "local_database";
      geoDatabaseVersion: string;
    }
  | {
      status: "unresolved";
      reason: "no_database" | "no_match" | "invalid_address" | "ipv6_deferred";
      locationMeaning: "unresolved";
      locationLevel: "unresolved";
      precisionDescription: "unresolved";
      source: "none" | "local_database";
      geoDatabaseVersion: string | null;
    };

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
export type OtherResolvedEntityId = typeof OTHER_RESOLVED_ENTITY_ID;

export type EntityId =
  | HostEntityId
  | CityAggregateEntityId
  | CountryAggregateEntityId
  | ClusterEntityId
  | OtherResolvedEntityId
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
  locationLevel?: "country" | "city" | "unresolved" | "multiLocation" | "aggregate";
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
 */
export interface CoverageStats {
  totalObservedHosts: number;
  publicHostsCount: number;
  resolvedHostsCount: number;
  unresolvedHostsCount: number;
  localLanHostsCount: number;
  specialHostsCount: number;
  totalBytes: number;
  resolvedBytes: number;
  unresolvedBytes: number;
  coveragePercent: number;
  resolvedBytesPercent: number;
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
  entityId?: string;
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

export type SelectedUnresolvedGroup = {
  kind: "unresolvedGroup";
  title: string;
  entityId?: string;
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

export type SelectedLocalNetworkGroup = {
  kind: "localNetworkGroup";
  title: string;
  entityId?: string;
  category: "lan" | "multicast" | "loopback" | "link_local" | "special";
  memberHosts: EnrichedHost[];
  tombstone?: TombstoneDetails;
};

/** Backward-compatibility alias for otherResolvedGroup */
export type SelectedOtherResolvedGroup = {
  kind: "otherResolvedGroup";
  title: string;
  entityId?: string;
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
 * Polymorphic SelectedEntity for RightRail synchronization.
 */
export type SelectedEntity =
  | SelectedEndpoint
  | SelectedCityAggregate
  | SelectedCountryAggregate
  | SelectedCluster
  | SelectedOtherResolvedAggregate
  | SelectedOtherResolvedGroup
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
        node.entityId === activeSelection.entityId
      ) {
        return true;
      }
    } else if (activeSelection.kind === "cluster") {
      const activeCellId = activeSelection.geoCellId ? extractGeoCellId(activeSelection.geoCellId) : null;
      const nodeCellId = node.geoCellId ? extractGeoCellId(node.geoCellId) : null;

      if (
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
      ) {
        return true;
      }
    } else if (activeSelection.kind === "countryAggregate") {
      if (
        node.entityId === activeSelection.entityId ||
        (activeSelection.node !== undefined && (node.id === activeSelection.node.id || node.entityId === activeSelection.node.entityId)) ||
        (Boolean(node.countryCode) && activeSelection.countryCode.toUpperCase() === node.countryCode!.toUpperCase()) ||
        (activeSelection.sampleEndpointIps !== undefined &&
          node.sampleEndpointIps.some((ip) => activeSelection.sampleEndpointIps!.includes(ip))) ||
        (activeSelection.memberHosts !== undefined &&
          node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip)))
      ) {
        return true;
      }
    } else if (activeSelection.kind === "cityAggregate") {
      if (
        node.entityId === activeSelection.entityId ||
        (activeSelection.node !== undefined && (node.id === activeSelection.node.id || node.entityId === activeSelection.node.entityId)) ||
        (activeSelection.cityName.toLowerCase() === node.label.replace(/\s*\(\d+\)$/, "").toLowerCase() &&
          (!activeSelection.countryCode || !node.countryCode || activeSelection.countryCode.toUpperCase() === node.countryCode.toUpperCase())) ||
        (activeSelection.sampleEndpointIps !== undefined &&
          node.sampleEndpointIps.some((ip) => activeSelection.sampleEndpointIps!.includes(ip))) ||
        (activeSelection.memberHosts !== undefined &&
          node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip)))
      ) {
        return true;
      }
    } else if (
      activeSelection.kind === "otherResolvedAggregate" ||
      activeSelection.kind === "otherResolvedGroup"
    ) {
      if (
        node.nodeKind === "otherResolvedAggregate" ||
        node.entityId === OTHER_RESOLVED_ENTITY_ID ||
        (activeSelection.node !== undefined && node.id === activeSelection.node.id)
      ) {
        return true;
      }
    } else if (activeSelection.kind === "asn") {
      if (
        node.asns.includes(activeSelection.asn) ||
        node.sampleEndpointIps.some((ip) => activeSelection.memberHosts.some((h) => h.ip === ip))
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
      node.sampleEndpointIps.includes(rawId) ||
      node.endpointIps.includes(rawId) ||
      (rawId.startsWith("entity-host-") && (
        node.sampleEndpointIps.includes(rawId.replace("entity-host-", "")) ||
        node.endpointIps.includes(rawId.replace("entity-host-", ""))
      )) ||
      (rawId === OTHER_RESOLVED_ENTITY_ID && node.nodeKind === "otherResolvedAggregate") ||
      (targetCellId !== null && (
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


