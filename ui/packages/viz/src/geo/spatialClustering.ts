import {
  OTHER_RESOLVED_ENTITY_ID,
  OTHER_RESOLVED_GEOCELL_ID,
  makeHostEntityId,
  makeCityAggregateEntityId,
  makeCountryAggregateEntityId,
  makeClusterEntityId,
  makeCanonicalCityKey,
  getCanonicalCountryName,
  makeEndpointRenderNodeId,
  makeAggregateRenderNodeId,
  makeOtherResolvedRenderNodeId,
  extractGeoCellId,
  type EnrichedHost,
  type GeoAggregateNode,
  type NodeKind,
  type SelectedEntity,
  type TelemetryFreshness,
} from "./geoTypes";
import { projectGeo, MAP_WIDTH, MAP_HEIGHT } from "./worldGeometry";
import { humanBytes } from "../utils";

export interface ClusterOptions {
  /** Screen space distance threshold in pixels for grouping nodes (default: 26) */
  distanceThreshold?: number;
  /** Current viewport zoom scale (default: 1.0) */
  zoomScale?: number;
  /** Maximum number of aggregated visual nodes to emit (default: 120, must be >= 1) */
  maxNodes?: number;
  /** Specific selected entity instance (pinned from merging if possible) */
  selectedEntity?: SelectedEntity | null;
  /** Specific IP or entity ID that is currently selected (pinned from merging if possible) */
  selectedIp?: string | null;
  selectedEntityId?: string | null;
  /** SVG Map Width (default: MAP_WIDTH = 720) */
  worldWidth?: number;
  /** SVG Map Height (default: MAP_HEIGHT = 360) */
  worldHeight?: number;
}

/**
 * Normalizes longitude into the canonical [-180, 180) interval.
 * Invariant: +180 canonicalizes to -180.
 */
export function normalizeLongitude(lng: number): number {
  let mod = (lng + 180) % 360;
  if (mod < 0) mod += 360;
  let norm = mod - 180;
  if (norm >= 180 || norm <= -180) norm = -180;
  return Object.is(norm, -0) ? 0 : norm;
}

/**
 * Validates and normalizes latitude to [-90, 90] and longitude to canonical [-180, 180).
 * Quarantines non-finite values (NaN, Infinity).
 */
export function normalizeCoordinates(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  
  return { lat, lng: normalizeLongitude(lng) };
}

/**
 * Canonicalizes screen-space X coordinates into [0, worldWidth).
 * Enforces periodic wrapping along the longitude dimension.
 * Invariant: 0 <= normalizeWorldX(x, worldWidth) < worldWidth.
 */
export function normalizeWorldX(x: number, worldWidth = MAP_WIDTH): number {
  let mod = x % worldWidth;
  if (mod < 0) mod += worldWidth;
  if (mod >= worldWidth) mod = 0;
  return Object.is(mod, -0) ? 0 : mod;
}

/**
 * Computes shortest periodic (toroidal) distance along the X dimension.
 * Invariant: distance(x1, x2) = min(|x1 - x2|, worldWidth - |x1 - x2|).
 */
export function toroidalDistanceX(x1: number, x2: number, worldWidth = MAP_WIDTH): number {
  const nx1 = normalizeWorldX(x1, worldWidth);
  const nx2 = normalizeWorldX(x2, worldWidth);
  const raw = Math.abs(nx1 - nx2);
  return Math.min(raw, worldWidth - raw);
}

/**
 * Computes shortest periodic angular distance between two longitudes in degrees [0, 180].
 */
export function angularDistanceLng(lng1: number, lng2: number): number {
  const norm1 = normalizeLongitude(lng1);
  const norm2 = normalizeLongitude(lng2);
  const raw = Math.abs(norm1 - norm2);
  return Math.min(raw, 360 - raw);
}

/**
 * Returns the unwrapped longitude closest to referenceLng (shortest angular displacement).
 * Invariant: delta ∈ [-180, 180], result = referenceLng + delta.
 */
export function unwrapLongitudeAroundReference(lng: number, referenceLng: number): number {
  const normLng = normalizeLongitude(lng);
  const normRef = normalizeLongitude(referenceLng);
  let delta = normLng - normRef;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return normRef + delta;
}

/**
 * Computes deterministic geographic spatial cell identity.
 * Invariant 3: Quantized to 0.1 degree grid resolution.
 */
export function computeGeoCellId(lat: number, lng: number): string {
  const norm = normalizeCoordinates(lat, lng);
  if (!norm) return "geocell-invalid";
  const qLat = Math.floor(norm.lat * 10);
  const qLng = Math.floor(norm.lng * 10);
  return `geocell-${qLat}_${qLng}`;
}

/** Maximum number of sample endpoint IPs stored per aggregate node for inspection */
export const MAX_CLUSTER_SAMPLE_IPS = 50;

export interface ClusterAccumulator {
  geoCellId: string;
  count: number;
  latSum: number;
  unwrappedLngSum: number;
  refLng: number;
  avgLat: number;
  avgLng: number;
  avgX: number;
  avgY: number;
  firstHost: EnrichedHost;
  endpointIps: string[];
  asns: Set<number>;
  totalBytes: number;
  totalFlows: number;
  deltaBytes: number;
  hasSelected: boolean;
  selectedMemberEntityId?: string | null;
  anyActive: boolean;
  anyRecent: boolean;
  canonicalCityKeys: Set<string>;
  normalizedCountryCodes: Set<string>;
  allCityLevel: boolean;
  allCountryLevel: boolean;
  firstResolvedCityName: string | null;
  firstResolvedCountryName: string | null;
}

/**
 * 2D Spatial Grid Index for bounded O(N + C) proximity clustering with periodic (toroidal)
 * antimeridian wrapping on X and Euclidean bounding on Y.
 *
 * Invariants:
 * - X is periodic over [0, worldWidth).
 * - Y is strictly Euclidean / non-periodic over [0, worldHeight].
 * - Grid cells are square with side length cellSize.
 * - Dynamic spatial indexing: When a cluster accumulates new hosts and its centroid moves,
 *   its cell bucket must be updated to maintain spatial locality.
 * - Candidate completeness: For every cluster c where toroidalDistance(c, query) <= threshold,
 *   the grid lookup MUST inspect c's cell.
 * - Memory boundedness: When a bucket becomes empty after cluster relocation or removal,
 *   the bucket key is deleted from the buckets map.
 */
export class SpatialGridIndex {
  private cellSize: number;
  private worldWidth: number;
  private worldHeight: number;
  private numCols: number;
  private numRows: number;
  private buckets = new Map<string, ClusterAccumulator[]>();
  private clusterBuckets = new Map<ClusterAccumulator, string>();

  constructor(cellSize: number, worldWidth = MAP_WIDTH, worldHeight = MAP_HEIGHT) {
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 26;
    this.worldWidth = Number.isFinite(worldWidth) && worldWidth > 0 ? worldWidth : MAP_WIDTH;
    this.worldHeight = Number.isFinite(worldHeight) && worldHeight > 0 ? worldHeight : MAP_HEIGHT;
    this.numCols = Math.max(1, Math.ceil(this.worldWidth / this.cellSize));
    this.numRows = Math.max(1, Math.ceil(this.worldHeight / this.cellSize));
  }

  private computeCellCoords(x: number, y: number): { gx: number; gy: number; key: string } {
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y) ? y : 0;
    const wrappedX = normalizeWorldX(safeX, this.worldWidth);
    const gx = Math.floor(wrappedX / this.cellSize) % this.numCols;
    const clampedY = Math.max(0, Math.min(this.worldHeight, safeY));
    const gy = Math.min(this.numRows - 1, Math.floor(clampedY / this.cellSize));
    return { gx, gy, key: `${gx}_${gy}` };
  }

  private getBucketKey(gx: number, gy: number): string {
    return `${gx}_${gy}`;
  }

  public insert(cluster: ClusterAccumulator, x: number, y: number): void {
    const { key } = this.computeCellCoords(x, y);
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    list.push(cluster);
    this.clusterBuckets.set(cluster, key);
  }

  /**
   * Updates the spatial index bucket location of an existing cluster when its centroid changes.
   * Ensures candidate completeness invariant is maintained as clusters evolve dynamically.
   * If the cluster stays within the same cell bucket, this is an efficient no-op.
   */
  public updatePosition(cluster: ClusterAccumulator, newX: number, newY: number): void {
    const oldKey = this.clusterBuckets.get(cluster);
    const { key: newKey } = this.computeCellCoords(newX, newY);

    if (oldKey === newKey) {
      if (!this.clusterBuckets.has(cluster)) {
        this.clusterBuckets.set(cluster, newKey);
      }
      return;
    }

    if (oldKey) {
      const oldList = this.buckets.get(oldKey);
      if (oldList) {
        const idx = oldList.indexOf(cluster);
        if (idx !== -1) {
          oldList.splice(idx, 1);
          if (oldList.length === 0) {
            this.buckets.delete(oldKey);
          }
        }
      }
    }

    let newList = this.buckets.get(newKey);
    if (!newList) {
      newList = [];
      this.buckets.set(newKey, newList);
    }
    newList.push(cluster);
    this.clusterBuckets.set(cluster, newKey);
  }

  /**
   * Removes a cluster from the spatial index and cleans up empty buckets.
   */
  public remove(cluster: ClusterAccumulator): void {
    const oldKey = this.clusterBuckets.get(cluster);
    if (oldKey) {
      const list = this.buckets.get(oldKey);
      if (list) {
        const idx = list.indexOf(cluster);
        if (idx !== -1) {
          list.splice(idx, 1);
          if (list.length === 0) {
            this.buckets.delete(oldKey);
          }
        }
      }
      this.clusterBuckets.delete(cluster);
    }
  }

  /**
   * Returns the current bucket key assigned to a cluster.
   */
  public getClusterBucketKey(cluster: ClusterAccumulator): string | undefined {
    return this.clusterBuckets.get(cluster);
  }

  /**
   * Clears all buckets and cluster mappings.
   */
  public clear(): void {
    this.buckets.clear();
    this.clusterBuckets.clear();
  }

  /**
   * Returns total number of indexed clusters.
   */
  public size(): number {
    return this.clusterBuckets.size;
  }

  /**
   * Returns number of active non-empty spatial grid buckets.
   */
  public bucketCount(): number {
    return this.buckets.size;
  }

  /**
   * Searches all candidate neighborhood grid cells that can contain a point within threshold.
   * Runs in bounded O(C) operations per query where C <= (2*radiusX + 1) * (2*radiusY + 1) * bucket_density.
   */
  public findNearest(
    hx: number,
    hy: number,
    threshold: number
  ): { targetCluster: ClusterAccumulator | null; closestDistSq: number } {
    if (!Number.isFinite(hx) || !Number.isFinite(hy) || !Number.isFinite(threshold) || threshold <= 0) {
      return { targetCluster: null, closestDistSq: Infinity };
    }

    const thresholdSq = threshold * threshold;
    const { gx, gy } = this.computeCellCoords(hx, hy);

    const cellRadiusX = Math.max(1, Math.ceil(threshold / this.cellSize));
    const cellRadiusY = Math.max(1, Math.ceil(threshold / this.cellSize));

    let targetCluster: ClusterAccumulator | null = null;
    let closestDistSq = Infinity;

    // Collect unique toroidal column indices for candidate search
    const uniqueCols: number[] = [];
    for (let dx = -cellRadiusX; dx <= cellRadiusX; dx++) {
      const col = ((gx + dx) % this.numCols + this.numCols) % this.numCols;
      if (!uniqueCols.includes(col)) {
        uniqueCols.push(col);
      }
    }

    const minGy = Math.max(0, gy - cellRadiusY);
    const maxGy = Math.min(this.numRows - 1, gy + cellRadiusY);

    for (const col of uniqueCols) {
      for (let r = minGy; r <= maxGy; r++) {
        const key = this.getBucketKey(col, r);
        const candidates = this.buckets.get(key);
        if (!candidates) continue;

        for (const c of candidates) {
          const distDx = toroidalDistanceX(hx, c.avgX, this.worldWidth);
          const distDy = Math.abs(hy - c.avgY);
          const distSq = distDx * distDx + distDy * distDy;

          if (distSq <= thresholdSq) {
            if (distSq < closestDistSq) {
              closestDistSq = distSq;
              targetCluster = c;
            } else if (distSq === closestDistSq && targetCluster) {
              // Deterministic tie-breaker for identical distance:
              // 1. Highest totalBytes
              // 2. Lexicographical geoCellId
              // 3. First IP
              if (
                c.totalBytes > targetCluster.totalBytes ||
                (c.totalBytes === targetCluster.totalBytes &&
                  (c.geoCellId < targetCluster.geoCellId ||
                    (c.geoCellId === targetCluster.geoCellId &&
                      (c.firstHost?.ip ?? "").localeCompare(targetCluster.firstHost?.ip ?? "") < 0)))
              ) {
                targetCluster = c;
              }
            }
          }
        }
      }
    }

    return { targetCluster, closestDistSq };
  }
}

function mapClusterToNode(
  c: ClusterAccumulator,
  zoomTier: number,
  worldWidth: number,
  worldHeight: number
): GeoAggregateNode {
  const count = c.count;
  const first = c.firstHost;
  const avgLat = c.avgLat;
  const avgLng = c.avgLng;
  const x = c.avgX;
  const y = c.avgY;
  const geoCellId = c.geoCellId;
  const asns = Array.from(c.asns).sort((a, b) => a - b);

  const freshness: TelemetryFreshness = c.anyActive ? "active" : c.anyRecent ? "recent" : "stale";

  if (count === 1) {
    // Single Endpoint Node
    const primaryName = first.hostnames[0]?.name;
    const label = primaryName || first.ip;
    const locationPart =
      first.geo.status === "resolved"
        ? first.geo.city
          ? `${first.geo.city}, ${first.geo.countryCode}`
          : first.geo.country
        : "";
    const subLabel = primaryName ? `${first.ip} • ${locationPart}` : locationPart;
    const sampleEndpointIps = [first.ip];

    return {
      id: makeEndpointRenderNodeId(first.ip),
      entityId: makeHostEntityId(first.ip),
      geoCellId,
      nodeKind: "endpoint" as NodeKind,
      label,
      subLabel,
      countryCode: first.geo.status === "resolved" ? first.geo.countryCode : null,
      latitude: first.geo.status === "resolved" ? first.geo.latitude : avgLat,
      longitude: first.geo.status === "resolved" ? first.geo.longitude : avgLng,
      x,
      y,
      totalBytes: c.totalBytes,
      totalFlows: c.totalFlows,
      sampleEndpointIps,
      endpointIps: sampleEndpointIps,
      asns,
      freshness,
      deltaBytes: c.deltaBytes,
      memberCount: 1,
      selectedMemberEntityId: c.selectedMemberEntityId || (c.hasSelected ? makeHostEntityId(first.ip) : null),
      locationLevel: first.geo.status === "resolved" ? (first.geo.locationLevel as any) : "unresolved",
      precisionDescription: first.geo.status === "resolved" ? first.geo.precisionDescription : "Unresolved",
    };
  }

  // Multi-Endpoint Node Classification Partition (Mutually Exclusive)
  const hasCountry = c.normalizedCountryCodes.size === 1 && Array.from(c.normalizedCountryCodes)[0] !== "";
  const countryCode = hasCountry ? Array.from(c.normalizedCountryCodes)[0]!.toUpperCase() : null;
  const countryName = countryCode ? getCanonicalCountryName(countryCode, c.firstResolvedCountryName || "Country") : "Region";
  const sampleEndpointIps = [...c.endpointIps];

  // 1. City Aggregate
  if (
    c.allCityLevel &&
    hasCountry &&
    c.canonicalCityKeys.size === 1 &&
    Array.from(c.canonicalCityKeys)[0] !== ""
  ) {
    const canonicalCityKey = Array.from(c.canonicalCityKeys)[0]!;
    const cityName = c.firstResolvedCityName || canonicalCityKey;
    const label = `${cityName} (${count})`;
    const subLabel = `${count} endpoints • ${cityName}, ${countryCode} • ${humanBytes(c.totalBytes)}`;

    return {
      id: makeAggregateRenderNodeId(geoCellId, zoomTier),
      entityId: makeCityAggregateEntityId(countryCode!, canonicalCityKey),
      geoCellId,
      nodeKind: "cityAggregate" as NodeKind,
      label,
      subLabel,
      countryCode,
      latitude: avgLat,
      longitude: avgLng,
      x,
      y,
      totalBytes: c.totalBytes,
      totalFlows: c.totalFlows,
      sampleEndpointIps,
      endpointIps: sampleEndpointIps,
      asns,
      freshness,
      deltaBytes: c.deltaBytes,
      memberCount: count,
      selectedMemberEntityId: c.selectedMemberEntityId || null,
      locationLevel: "city",
      precisionDescription: `${count} endpoints aggregated at ${cityName}, ${countryCode} estimate`,
    };
  }

  // 2. Country Aggregate
  if (c.allCountryLevel && hasCountry) {
    const label = `${countryName} (${count})`;
    const subLabel = `${count} endpoints • ${countryName} (${countryCode}) • ${humanBytes(c.totalBytes)}`;

    return {
      id: makeAggregateRenderNodeId(geoCellId, zoomTier),
      entityId: makeCountryAggregateEntityId(countryCode!),
      geoCellId,
      nodeKind: "countryAggregate" as NodeKind,
      label,
      subLabel,
      countryCode,
      latitude: avgLat,
      longitude: avgLng,
      x,
      y,
      totalBytes: c.totalBytes,
      totalFlows: c.totalFlows,
      sampleEndpointIps,
      endpointIps: sampleEndpointIps,
      asns,
      freshness,
      deltaBytes: c.deltaBytes,
      memberCount: count,
      selectedMemberEntityId: c.selectedMemberEntityId || null,
      locationLevel: "country",
      precisionDescription: `${count} endpoints aggregated at country-level representation for ${countryName}`,
    };
  }

  // 3. Spatial Aggregate (Cluster)
  const label = countryCode && c.firstResolvedCityName
    ? `${c.firstResolvedCityName} Region (${count})`
    : countryCode
    ? `${countryName} Cluster (${count})`
    : `Spatial Cluster (${count})`;
  const subLabel = `${count} endpoints • ${humanBytes(c.totalBytes)}`;

  return {
    id: makeAggregateRenderNodeId(geoCellId, zoomTier),
    entityId: makeClusterEntityId(geoCellId),
    geoCellId,
    nodeKind: "cluster" as NodeKind,
    label,
    subLabel,
    countryCode,
    latitude: avgLat,
    longitude: avgLng,
    x,
    y,
    totalBytes: c.totalBytes,
    totalFlows: c.totalFlows,
    sampleEndpointIps,
    endpointIps: sampleEndpointIps,
    asns,
    freshness,
    deltaBytes: c.deltaBytes,
    memberCount: count,
    selectedMemberEntityId: c.selectedMemberEntityId || null,
    locationLevel: "multiLocation",
    precisionDescription: `${count} endpoints aggregated at spatial grid centroid representation`,
  };
}

function createOtherResolvedAggregate(
  overflowClusters: ClusterAccumulator[],
  zoomTier: number,
  worldWidth: number,
  worldHeight: number
): GeoAggregateNode {
  let totalBytes = 0;
  let totalFlows = 0;
  let deltaBytes = 0;
  let memberCount = 0;
  let anyActive = false;
  let anyRecent = false;

  const sampleEndpointIps: string[] = [];
  const sampleIpSet = new Set<string>();
  const asnSet = new Set<number>();
  const geoCellSet = new Set<string>();
  const countryCodeSet = new Set<string>();

  let totalWeight = 0;
  let weightedLatSum = 0;
  let unitXSum = 0;
  let unitYSum = 0;

  for (const c of overflowClusters) {
    totalBytes += c.totalBytes;
    totalFlows += c.totalFlows;
    deltaBytes += c.deltaBytes;
    memberCount += c.count;
    if (c.anyActive) anyActive = true;
    if (c.anyRecent) anyRecent = true;

    for (const ip of c.endpointIps) {
      if (sampleIpSet.size < MAX_CLUSTER_SAMPLE_IPS && !sampleIpSet.has(ip)) {
        sampleIpSet.add(ip);
        sampleEndpointIps.push(ip);
      }
    }
    for (const asn of c.asns) {
      asnSet.add(asn);
    }
    geoCellSet.add(c.geoCellId);
    const cc = c.firstHost.geo.status === "resolved" ? c.firstHost.geo.countryCode : null;
    if (cc) countryCodeSet.add(cc);

    // Antimeridian-safe weighted circular centroid
    const w = c.totalBytes;
    totalWeight += w;
    weightedLatSum += w * c.avgLat;
    const rad = (c.avgLng * Math.PI) / 180;
    unitXSum += w * Math.cos(rad);
    unitYSum += w * Math.sin(rad);
  }

  let avgLat: number;
  let avgLng: number;

  if (totalWeight > 0) {
    avgLat = weightedLatSum / totalWeight;
    const rawLng = (Math.atan2(unitYSum, unitXSum) * 180) / Math.PI;
    avgLng = normalizeLongitude(rawLng);
  } else {
    // Zero-weight fallback: unweighted arithmetic latitude + unweighted circular mean of longitudes
    let unweightedLatSum = 0;
    let unweightedUx = 0;
    let unweightedUy = 0;
    for (const c of overflowClusters) {
      unweightedLatSum += c.avgLat;
      const rad = (c.avgLng * Math.PI) / 180;
      unweightedUx += Math.cos(rad);
      unweightedUy += Math.sin(rad);
    }
    avgLat = unweightedLatSum / overflowClusters.length;
    if (Math.abs(unweightedUx) < 1e-9 && Math.abs(unweightedUy) < 1e-9) {
      avgLng = 0;
    } else {
      const rawLng = (Math.atan2(unweightedUy, unweightedUx) * 180) / Math.PI;
      avgLng = normalizeLongitude(rawLng);
    }
  }

  const [projX, projY] = projectGeo(avgLat, avgLng, worldWidth, worldHeight);
  const x = normalizeWorldX(projX, worldWidth);
  const y = projY;

  const asns = Array.from(asnSet).sort((a, b) => a - b);
  const locationCount = geoCellSet.size;
  const countryCode = countryCodeSet.size === 1 ? Array.from(countryCodeSet)[0]! : null;

  const freshness: TelemetryFreshness = anyActive ? "active" : anyRecent ? "recent" : "stale";

  const label = `Other Resolved Traffic (${memberCount})`;
  const subLabel = `${memberCount} endpoints • ${humanBytes(totalBytes)}`;

  // Selection metadata follows the rendered aggregate that contains the selected entity
  const selectedMemberEntityId =
    overflowClusters.find((c) => Boolean(c.selectedMemberEntityId))?.selectedMemberEntityId || null;

  return {
    id: makeOtherResolvedRenderNodeId(zoomTier),
    entityId: OTHER_RESOLVED_ENTITY_ID,
    geoCellId: OTHER_RESOLVED_GEOCELL_ID,
    nodeKind: "otherResolvedAggregate" as NodeKind,
    label,
    subLabel,
    countryCode,
    latitude: avgLat,
    longitude: avgLng,
    x,
    y,
    totalBytes,
    totalFlows,
    sampleEndpointIps,
    endpointIps: sampleEndpointIps,
    asns,
    freshness,
    deltaBytes,
    memberCount,
    selectedMemberEntityId: selectedMemberEntityId || undefined,
    locationLevel: "multiLocation",
    precisionDescription: `Aggregated representation of ${memberCount} endpoints across ${locationCount} spatial locations`,
  };
}

/**
 * Deterministic screen-space spatial clustering engine.
 * Expected complexity: O(N + C) with bounded candidate-cell lookup.
 * Enforces Invariants A through F and full 4D conservation:
 * - Accumulates true interval deltaBytes
 * - Assigns primary semantic entityId and stable geoCellId
 * - Antimeridian-aware toroidal longitude proximity and circular mean centroids
 * - Strict conservation of totalBytes, totalFlows, deltaBytes, memberCount, and endpoint cardinality
 */
export function buildSpatialClusters(
  resolvedHosts: EnrichedHost[],
  options: ClusterOptions = {}
): GeoAggregateNode[] {
  if (resolvedHosts.length === 0) return [];

  const {
    distanceThreshold = 26,
    zoomScale = 1.0,
    maxNodes = 120,
    selectedEntity = null,
    selectedIp = null,
    selectedEntityId = null,
    worldWidth = MAP_WIDTH,
    worldHeight = MAP_HEIGHT,
  } = options;

  // Explicit Rendering Budget Contract:
  // - undefined: default (120)
  // - positive number: Math.floor(maxNodes)
  // - 0: valid "render zero nodes" -> returns []
  // - negative / NaN / Infinity: invalid -> normalize to default (120)
  let effectiveMaxNodes = 120;
  if (maxNodes === undefined) {
    effectiveMaxNodes = 120;
  } else if (typeof maxNodes === "number" && Number.isFinite(maxNodes)) {
    if (maxNodes === 0) {
      effectiveMaxNodes = 0;
    } else if (maxNodes > 0) {
      effectiveMaxNodes = Math.floor(maxNodes);
    } else {
      effectiveMaxNodes = 120;
    }
  } else {
    effectiveMaxNodes = 120;
  }

  // If effectiveMaxNodes === 0, render zero visual nodes while preserving domain execution
  if (effectiveMaxNodes === 0) {
    return [];
  }

  // Effective distance threshold in SVG map coordinate space
  const worldDistThreshold = Math.max(0.2, distanceThreshold / zoomScale);

  // Derive canonical target host IP if selectedEntity/selectedEntityId is a host
  const canonicalSelectedHostIp =
    selectedEntity?.kind === "endpoint"
      ? selectedEntity.ip
      : selectedEntityId?.startsWith("entity-host-")
      ? selectedEntityId.replace("entity-host-", "")
      : selectedIp || null;

  const targetGeoCellId =
    (selectedEntity && "geoCellId" in selectedEntity && selectedEntity.geoCellId
      ? extractGeoCellId(selectedEntity.geoCellId)
      : null) || extractGeoCellId(selectedEntityId);

  // Sort hosts by total bytes descending for deterministic cluster seed placement
  const sorted = [...resolvedHosts].sort((a, b) => {
    if (b.bytes !== a.bytes) return b.bytes - a.bytes;
    return a.ip.localeCompare(b.ip);
  });

  const spatialGrid = new SpatialGridIndex(worldDistThreshold, worldWidth, worldHeight);
  const clusters: ClusterAccumulator[] = [];

  for (const host of sorted) {
    if (!host.geo.mapEligible) continue;

    const norm = normalizeCoordinates(host.geo.latitude, host.geo.longitude);
    if (!norm) continue;

    const [hx, hy] = projectGeo(norm.lat, norm.lng, worldWidth, worldHeight);
    const hostGeoCellId = computeGeoCellId(norm.lat, norm.lng);
    const isAsnSelected =
      (selectedEntity?.kind === "asn" && host.asn.status === "resolved" && host.asn.asn === selectedEntity.asn) ||
      (selectedEntityId != null &&
        selectedEntityId.startsWith("entity-asn-") &&
        host.asn.status === "resolved" &&
        host.asn.asn === Number(selectedEntityId.replace("entity-asn-", "")));

    const isSelected =
      isAsnSelected ||
      (canonicalSelectedHostIp != null && canonicalSelectedHostIp !== "" && host.ip === canonicalSelectedHostIp) ||
      (selectedEntityId != null &&
        selectedEntityId !== "" &&
        (selectedEntityId === makeHostEntityId(host.ip) || selectedEntityId === host.ip)) ||
      (selectedEntity?.kind === "endpoint" && selectedEntity.ip === host.ip) ||
      (selectedEntity &&
        "memberHosts" in selectedEntity &&
        Array.isArray(selectedEntity.memberHosts) &&
        selectedEntity.memberHosts.some((h) => h.ip === host.ip)) ||
      (targetGeoCellId !== null && hostGeoCellId === targetGeoCellId);

    const isSelectedHostEndpoint =
      isSelected &&
      Boolean(
        (canonicalSelectedHostIp != null && canonicalSelectedHostIp !== "" && host.ip === canonicalSelectedHostIp) ||
        (selectedEntity?.kind === "endpoint" && selectedEntity.ip === host.ip) ||
        (selectedEntityId != null && (selectedEntityId === makeHostEntityId(host.ip) || selectedEntityId === host.ip))
      );

    const { targetCluster } = spatialGrid.findNearest(hx, hy, worldDistThreshold);

    const isHostCityLevel = ((host.geo.precision as string) === "city" || (host.geo as any).locationLevel === "city") && Boolean(host.geo.city);
    const isHostCountryLevel = (host.geo.precision as string) === "country" || (host.geo as any).locationLevel === "country";
    const hostCountryCode = host.geo.countryCode ? host.geo.countryCode.trim().toLowerCase() : "";
    const hostCityKey = isHostCityLevel && host.geo.city ? makeCanonicalCityKey(host.geo.city) : "";

    if (targetCluster) {
      targetCluster.count++;

      // Unwrap candidate longitude relative to seed reference longitude
      const unwrappedLng = unwrapLongitudeAroundReference(norm.lng, targetCluster.refLng);

      targetCluster.latSum += norm.lat;
      targetCluster.unwrappedLngSum += unwrappedLng;

      // Authoritative angular centroid
      const avgLat = targetCluster.latSum / targetCluster.count;
      const rawAvgLng = targetCluster.unwrappedLngSum / targetCluster.count;
      const canonicalLng = normalizeLongitude(rawAvgLng);

      targetCluster.avgLat = avgLat;
      targetCluster.avgLng = canonicalLng;

      // Derive screen coordinates directly from authoritative geographic centroid
      const [projX, projY] = projectGeo(avgLat, canonicalLng, worldWidth, worldHeight);
      targetCluster.avgX = normalizeWorldX(projX, worldWidth);
      targetCluster.avgY = projY;

      spatialGrid.updatePosition(
        targetCluster,
        targetCluster.avgX,
        targetCluster.avgY
      );

      targetCluster.totalBytes += host.bytes;
      targetCluster.totalFlows += host.flows;
      targetCluster.deltaBytes += host.deltaBytes;
      if (targetCluster.endpointIps.length < MAX_CLUSTER_SAMPLE_IPS) {
        if (!targetCluster.endpointIps.includes(host.ip)) {
          targetCluster.endpointIps.push(host.ip);
        }
      }
      if (host.asn.status === "resolved") {
        targetCluster.asns.add(host.asn.asn);
      }
      if (host.freshness === "active") targetCluster.anyActive = true;
      if (host.freshness === "recent") targetCluster.anyRecent = true;
      if (isSelected) {
        targetCluster.hasSelected = true;
        if (isSelectedHostEndpoint) {
          targetCluster.selectedMemberEntityId = makeHostEntityId(host.ip);
        }
      }

      // Accumulate resolution metadata
      if (hostCityKey) targetCluster.canonicalCityKeys.add(hostCityKey);
      if (hostCountryCode) targetCluster.normalizedCountryCodes.add(hostCountryCode);
      if (!isHostCityLevel) targetCluster.allCityLevel = false;
      if (!isHostCountryLevel) targetCluster.allCountryLevel = false;
      if (!targetCluster.firstResolvedCityName && isHostCityLevel && host.geo.city) {
        targetCluster.firstResolvedCityName = host.geo.city;
      }
      if (!targetCluster.firstResolvedCountryName && host.geo.country) {
        targetCluster.firstResolvedCountryName = host.geo.country;
      }
    } else {
      const initialCityKeys = new Set<string>();
      if (hostCityKey) initialCityKeys.add(hostCityKey);

      const initialCountryCodes = new Set<string>();
      if (hostCountryCode) initialCountryCodes.add(hostCountryCode);

      const newCluster: ClusterAccumulator = {
        geoCellId: hostGeoCellId,
        count: 1,
        latSum: norm.lat,
        unwrappedLngSum: norm.lng,
        refLng: norm.lng,
        avgLat: norm.lat,
        avgLng: norm.lng,
        avgX: normalizeWorldX(hx, worldWidth),
        avgY: hy,
        firstHost: host,
        endpointIps: [host.ip],
        asns: new Set(host.asn.status === "resolved" ? [host.asn.asn] : []),
        totalBytes: host.bytes,
        totalFlows: host.flows,
        deltaBytes: host.deltaBytes,
        hasSelected: isSelected,
        selectedMemberEntityId: isSelectedHostEndpoint ? makeHostEntityId(host.ip) : null,
        anyActive: host.freshness === "active",
        anyRecent: host.freshness === "recent",
        canonicalCityKeys: initialCityKeys,
        normalizedCountryCodes: initialCountryCodes,
        allCityLevel: isHostCityLevel,
        allCountryLevel: isHostCountryLevel,
        firstResolvedCityName: isHostCityLevel && host.geo.city ? host.geo.city : null,
        firstResolvedCountryName: host.geo.country ? host.geo.country : null,
      };
      clusters.push(newCluster);
      spatialGrid.insert(newCluster, hx, hy);
    }
  }

  // Verify aggregate selection if selectedEntity or selectedEntityId matches city/country/cluster entity IDs
  if (selectedEntity || selectedEntityId) {
    for (const c of clusters) {
      if (!c.hasSelected) {
        if (
          (targetGeoCellId !== null && (c.geoCellId === targetGeoCellId || extractGeoCellId(c.geoCellId) === targetGeoCellId)) ||
          (selectedEntityId && (
            selectedEntityId === makeClusterEntityId(c.geoCellId) ||
            selectedEntityId === c.geoCellId ||
            selectedEntityId.startsWith(`cluster-${c.geoCellId}`) ||
            selectedEntityId.startsWith(`aggregate-${c.geoCellId}`)
          ))
        ) {
          c.hasSelected = true;
        } else if (
          (selectedEntityId?.startsWith("entity-city-") || selectedEntity?.kind === "cityAggregate") &&
          c.canonicalCityKeys.size === 1 &&
          c.normalizedCountryCodes.size === 1
        ) {
          const cc = Array.from(c.normalizedCountryCodes)[0]!;
          const ck = Array.from(c.canonicalCityKeys)[0]!;
          if (
            (selectedEntityId && selectedEntityId.toLowerCase() === makeCityAggregateEntityId(cc, ck).toLowerCase()) ||
            (selectedEntity?.kind === "cityAggregate" && selectedEntity.entityId.toLowerCase() === makeCityAggregateEntityId(cc, ck).toLowerCase())
          ) {
            c.hasSelected = true;
          }
        } else if (
          (selectedEntityId?.startsWith("entity-country-") || selectedEntity?.kind === "countryAggregate") &&
          c.normalizedCountryCodes.size === 1
        ) {
          const cc = Array.from(c.normalizedCountryCodes)[0]!;
          if (
            (selectedEntityId && selectedEntityId.toLowerCase() === makeCountryAggregateEntityId(cc).toLowerCase()) ||
            (selectedEntity?.kind === "countryAggregate" && selectedEntity.countryCode.toLowerCase() === cc.toLowerCase())
          ) {
            c.hasSelected = true;
          }
        } else if (
          (selectedEntityId?.startsWith("entity-asn-") || selectedEntity?.kind === "asn")
        ) {
          const targetAsn =
            selectedEntity?.kind === "asn"
              ? selectedEntity.asn
              : Number(selectedEntityId?.replace("entity-asn-", ""));
          if (Number.isFinite(targetAsn) && c.asns.has(targetAsn)) {
            c.hasSelected = true;
          }
        } else if (selectedEntity) {
          if (selectedEntity.kind === "endpoint" && c.endpointIps.includes(selectedEntity.ip)) {
            c.hasSelected = true;
          } else if (
            "sampleEndpointIps" in selectedEntity &&
            Array.isArray(selectedEntity.sampleEndpointIps) &&
            selectedEntity.sampleEndpointIps.some((ip) => c.endpointIps.includes(ip))
          ) {
            c.hasSelected = true;
          } else if (
            "memberHosts" in selectedEntity &&
            Array.isArray(selectedEntity.memberHosts) &&
            selectedEntity.memberHosts.some((h) => c.endpointIps.includes(h.ip))
          ) {
            c.hasSelected = true;
          }
        }
      }
    }
  }

  const zoomTier = Math.round(zoomScale * 10);

  // Deterministic 3-tuple cluster sorting: totalBytes DESC, geoCellId ASC, firstHost.ip ASC
  const clusterComparator = (a: ClusterAccumulator, b: ClusterAccumulator) => {
    if (b.totalBytes !== a.totalBytes) {
      return b.totalBytes - a.totalBytes;
    }
    if (a.geoCellId !== b.geoCellId) {
      return a.geoCellId.localeCompare(b.geoCellId);
    }
    const ipA = a.firstHost?.ip ?? "";
    const ipB = b.firstHost?.ip ?? "";
    return ipA.localeCompare(ipB);
  };

  const sortedClusters = [...clusters].sort(clusterComparator);

  // Apply rendering budget and aggregation without discarding traffic
  if (sortedClusters.length <= effectiveMaxNodes) {
    return sortedClusters.map((c) => mapClusterToNode(c, zoomTier, worldWidth, worldHeight));
  }

  if (effectiveMaxNodes === 1) {
    // maxNodes === 1: All clusters are rolled up into the single "Other Resolved Traffic" aggregate
    const overflowAggregate = createOtherResolvedAggregate(
      sortedClusters,
      zoomTier,
      worldWidth,
      worldHeight
    );
    return [overflowAggregate];
  }

  // General overflow with selection preservation:
  // Visible budget is (effectiveMaxNodes - 1) to reserve 1 slot for "Other Resolved Traffic" aggregate.
  // 1. Selected clusters are preserved first to guarantee focal target visibility.
  // 2. Remaining visible budget is filled by highest-priority (highest byte) unselected clusters.
  // 3. All remaining clusters are combined into 1 "Other Resolved Traffic" aggregate.
  const visibleBudget = effectiveMaxNodes - 1;
  const selectedClusters = sortedClusters.filter((c) => c.hasSelected);
  const unselectedClusters = sortedClusters.filter((c) => !c.hasSelected);

  const visibleSelected = selectedClusters.slice(0, visibleBudget);
  const remainingBudget = Math.max(0, visibleBudget - visibleSelected.length);
  const visibleUnselected = unselectedClusters.slice(0, remainingBudget);

  const overflowSelected = selectedClusters.slice(visibleBudget);
  const overflowUnselected = unselectedClusters.slice(remainingBudget);
  const overflowClusters = [...overflowSelected, ...overflowUnselected];

  const visibleClusters = [...visibleSelected, ...visibleUnselected].sort(clusterComparator);

  const visibleNodes = visibleClusters.map((c) =>
    mapClusterToNode(c, zoomTier, worldWidth, worldHeight)
  );
  const overflowAggregate = createOtherResolvedAggregate(
    overflowClusters,
    zoomTier,
    worldWidth,
    worldHeight
  );

  return [...visibleNodes, overflowAggregate];
}
