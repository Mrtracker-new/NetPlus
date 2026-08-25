import type { BreakdownRow } from "@netpulse/contract";
import {
  OTHER_RESOLVED_ENTITY_ID,
  OTHER_RESOLVED_NODE_ID,
  OTHER_RESOLVED_GEOCELL_ID,
  makeHostEntityId,
  makeCityAggregateEntityId,
  makeCountryAggregateEntityId,
  makeClusterEntityId,
  makeAggregateRenderNodeId,
  makeCanonicalCityKey,
  getCanonicalCountryName,
  extractGeoCellId,
  type HostEntityId,
  type CityAggregateEntityId,
  type CountryAggregateEntityId,
  type ClusterEntityId,
  type OtherResolvedEntityId,
  type CoverageStats,
  type EnrichedHost,
  type GeoAggregateNode,
  type LabelPlacement,
  type OriginResolution,
  type SelectedEntity,
  type TelemetryFreshness,
  type TombstoneDetails,
  type TombstoneRecord,
} from "./geoTypes";
import { enrichHost, getLocalOrigin } from "./geoDatabase";
import {
  buildSpatialClusters,
  computeGeoCellId,
  normalizeCoordinates,
  MAX_CLUSTER_SAMPLE_IPS,
} from "./spatialClustering";
import { calculateArcBezier, getArcOpacity, getArcStrokeWidth, type ArcPathModel } from "./trafficArcs";
import { computeLabelLayout } from "./labelLayout";
import { projectGeo } from "./worldGeometry";
import { humanBytes } from "../utils";

export interface MapViewModelInput {
  hosts: BreakdownRow[];
  captureSessionId: string | null;
  snapshotSequence: number;
  snapshotTimestamp?: number;
}

export interface MapViewModelOptions {
  zoomScale?: number;
  clusterRadiusPx?: number;
  maxVisibleNodes?: number;
  maxVisibleArcs?: number;
  maxVisibleLabels?: number;
  selectedEntityId?: string | null;
  selectedIp?: string | null;
  origin?: OriginResolution;
  reducedMotion?: boolean;
}

export interface ResolvedSelection {
  entityId: string;
  status: "active" | "tombstone";
  isSelected: boolean;
  label: string;
  subLabel?: string;
  selectedEntity: SelectedEntity;
  tombstoneDetails?: TombstoneDetails;
}

export interface HostEnrichmentSnapshot {
  captureSessionId: string | null;
  snapshotSequence: number;
  snapshotTimestamp?: number;
  enrichedHosts: EnrichedHost[];
  hostsById: Map<string, EnrichedHost>;
  coverageStats: CoverageStats;
}

export interface MapViewModel {
  captureSessionId: string | null;
  snapshotSequence: number;
  snapshotTimestamp?: number;
  enrichedHosts: EnrichedHost[];
  hostsById: Map<string, EnrichedHost>;
  aggregateNodes: GeoAggregateNode[];
  arcModels: ArcPathModel[];
  labelPlacements: Map<string, LabelPlacement>;
  coverageStats: CoverageStats;
  activeSelection: ResolvedSelection | null;
  lastUpdatedTs: number;
  tombstones: Map<string, TombstoneRecord>;
}

/**
 * Authoritative deterministic telemetry enrichment and delta computation pipeline.
 * Pure state transition function: (input, previousSnapshot) -> nextSnapshot.
 * Caller holds immutable snapshot references; no hidden internal mutable state.
 *
 * Enforces Invariants 1, 2, and 4:
 * - Session baseline priming (S0 -> delta = 0)
 * - Mid-session host arrival baseline priming (delta = 0)
 * - Counter rollover safety (current < prev -> delta = 0)
 * - Stale/duplicate snapshot rejection (seq <= prevSeq in same session -> return prev)
 */
export function deriveHostEnrichmentSnapshot(
  input: MapViewModelInput,
  previousSnapshot: HostEnrichmentSnapshot | MapViewModel | null
): HostEnrichmentSnapshot {
  const { hosts, captureSessionId, snapshotSequence, snapshotTimestamp } = input;

  const sameSession =
    previousSnapshot !== null &&
    previousSnapshot.captureSessionId === captureSessionId;

  // Invariant 1 & 2: Stale or duplicate snapshot rejection in same session
  if (
    sameSession &&
    snapshotSequence <= previousSnapshot.snapshotSequence
  ) {
    return previousSnapshot;
  }

  // Invariant 1: Session change / Capture restart detection (initial session)
  const isSessionRestart = !sameSession;

  // Build previous host byte map if same session
  const prevHostBytes = new Map<string, number>();
  if (sameSession && previousSnapshot) {
    for (const host of previousSnapshot.enrichedHosts) {
      prevHostBytes.set(host.ip, host.bytes);
    }
  }

  // Enrich hosts and compute pure interval deltas (Invariant 1 & 4)
  const enrichedHosts: EnrichedHost[] = [];
  const hostsById = new Map<string, EnrichedHost>();

  let publicHostsCount = 0;
  let resolvedHostsCount = 0;
  let unresolvedHostsCount = 0;
  let ipv6DeferredHostsCount = 0;
  let localLanHostsCount = 0;
  let specialHostsCount = 0;
  let totalBytes = 0;
  let resolvedBytes = 0;
  let unresolvedBytes = 0;
  let ipv6DeferredBytes = 0;

  const effectiveTimestamp =
    snapshotTimestamp !== undefined
      ? snapshotTimestamp
      : 0;

  for (const row of hosts) {
    const rawIp = row.label || "";
    const ip = rawIp.trim();
    if (!ip) continue;

    const currentBytes =
      typeof row.bytes === "number" && Number.isFinite(row.bytes)
        ? Math.max(0, row.bytes)
        : 0;
    totalBytes += currentBytes;

    let deltaBytes = 0;
    if (!isSessionRestart) {
      const prev = prevHostBytes.get(ip);
      if (prev !== undefined) {
        if (currentBytes >= prev) {
          deltaBytes = currentBytes - prev;
        } else {
          // Counter reset / rollover
          deltaBytes = 0;
        }
      } else {
        // Newly observed host in ongoing session: baseline is 0 delta
        deltaBytes = 0;
      }
    } else {
      // Session baseline S0: delta is 0
      deltaBytes = 0;
    }

    const enriched = enrichHost(row, deltaBytes, effectiveTimestamp);
    enrichedHosts.push(enriched);
    hostsById.set(ip, enriched);

    // Coverage telemetry accounting
    if (enriched.classification.isPublic) {
      publicHostsCount++;
      if (enriched.geo.status === "resolved") {
        resolvedHostsCount++;
        resolvedBytes += currentBytes;
      } else {
        unresolvedHostsCount++;
        unresolvedBytes += currentBytes;
        if (enriched.geo.reason === "ipv6_deferred") {
          ipv6DeferredHostsCount++;
          ipv6DeferredBytes += currentBytes;
        }
      }
    } else if (enriched.classification.isLocalLan) {
      localLanHostsCount++;
    } else {
      specialHostsCount++;
    }
  }

  const coveragePercent =
    publicHostsCount > 0 ? (resolvedHostsCount / publicHostsCount) * 100 : 0;

  const totalPublicBytes = resolvedBytes + unresolvedBytes;
  const resolvedBytesPercent =
    totalPublicBytes > 0 ? (resolvedBytes / totalPublicBytes) * 100 : 0;

  const coverageStats: CoverageStats = {
    totalObservedHosts: hosts.length,
    publicHostsCount,
    resolvedHostsCount,
    unresolvedHostsCount,
    ipv6DeferredHostsCount,
    localLanHostsCount,
    specialHostsCount,
    totalBytes,
    resolvedBytes,
    unresolvedBytes,
    ipv6DeferredBytes,
    coveragePercent,
    resolvedBytesPercent,
  };

  return {
    captureSessionId,
    snapshotSequence,
    snapshotTimestamp: effectiveTimestamp,
    enrichedHosts,
    hostsById,
    coverageStats,
  };
}

/**
 * Viewport/zoom-gated derivation pipeline.
 * Computes spatial clustering, traffic arcs, label layout, and active selection.
 *
 * Enforces Invariants 3, 5, and 6.
 */
export function deriveClusteredMapModel(
  snapshot: HostEnrichmentSnapshot,
  previousModel: MapViewModel | null,
  options: MapViewModelOptions = {}
): MapViewModel {
  const {
    zoomScale = 1.0,
    clusterRadiusPx = 26,
    maxVisibleNodes = 120,
    maxVisibleArcs = 48,
    maxVisibleLabels = 24,
    selectedEntityId = null,
    selectedIp = null,
    origin = getLocalOrigin(),
    reducedMotion = false,
  } = options;

  const {
    captureSessionId,
    snapshotSequence,
    enrichedHosts,
    hostsById,
    coverageStats,
  } = snapshot;

  // Build spatial clusters (Invariant 3 & 4: bounded O(N+C) grid indexing, deltaBytes sum)
  const resolvedHosts = enrichedHosts.filter((h) => h.geo.status === "resolved");
  const aggregateNodes = buildSpatialClusters(resolvedHosts, {
    distanceThreshold: clusterRadiusPx,
    zoomScale,
    maxNodes: maxVisibleNodes,
    selectedIp,
    selectedEntityId,
  });

  // Selection identifier for focal target prioritization
  const targetEntityId =
    selectedEntityId || (selectedIp ? `entity-host-${selectedIp}` : null);

  // Generate traffic arcs with focal target preservation (Invariant 5: Pacific antimeridian shortest-path routing)
  // Semantic Integrity: If origin is unresolved, do not fabricate synthetic geographic arcs from (0°,0°) / map centroid
  const arcModels: ArcPathModel[] = [];

  if (origin.status === "resolved") {
    const arcCandidateNodes = (() => {
      if (aggregateNodes.length <= maxVisibleArcs) return aggregateNodes;
      if (!targetEntityId) return aggregateNodes.slice(0, maxVisibleArcs);

      const targetGeoCell = extractGeoCellId(targetEntityId);
      const isTargetNode = (n: GeoAggregateNode) =>
        n.entityId === targetEntityId ||
        n.id === targetEntityId ||
        (selectedIp != null && selectedIp !== "" && (n.sampleEndpointIps.includes(selectedIp) || n.endpointIps.includes(selectedIp))) ||
        (targetEntityId.startsWith("entity-host-") &&
          (n.sampleEndpointIps.includes(targetEntityId.replace("entity-host-", "")) ||
           n.endpointIps.includes(targetEntityId.replace("entity-host-", "")))) ||
        (targetGeoCell !== null && (n.geoCellId === targetGeoCell || extractGeoCellId(n.geoCellId) === targetGeoCell));

      const selectedArcNodes = aggregateNodes.filter(isTargetNode);
      const unselectedArcNodes = aggregateNodes.filter((n) => !isTargetNode(n));
      const remainingArcBudget = Math.max(0, maxVisibleArcs - selectedArcNodes.length);
      return [...selectedArcNodes, ...unselectedArcNodes.slice(0, remainingArcBudget)];
    })();

    const [ox, oy] = projectGeo(origin.latitude, origin.longitude);
    const originLng = origin.longitude;

    for (const node of arcCandidateNodes) {
      const geometry = calculateArcBezier(ox, oy, node.x, node.y, {
        originLng,
        destLng: node.longitude,
      });

      const hasParticles = !reducedMotion && node.deltaBytes > 0;

      const firstSeg = geometry.segments[0]!;

      arcModels.push({
        id: `arc-${node.id}`,
        geometry,
        strokeWidth: getArcStrokeWidth(node.totalBytes),
        opacity: getArcOpacity(node.freshness),
        freshness: node.freshness,
        hasParticles,
        deltaBytes: node.deltaBytes,
        d: geometry.d,
        crossesAntimeridian: geometry.crossesAntimeridian,
        shortestDeltaLng: geometry.shortestDeltaLng,
        splitT: geometry.splitT,
        particleSplitT: geometry.particleSplitT,
        segments: geometry.segments,
        ox: geometry.origin.x,
        oy: geometry.origin.y,
        dx: geometry.destination.x,
        dy: geometry.destination.y,
        midX: firstSeg.control.x,
        midY: firstSeg.control.y,
        effectiveDx: geometry.crossesAntimeridian
          ? geometry.crossingDirection === "west"
            ? geometry.destination.x - 720
            : geometry.destination.x + 720
          : geometry.destination.x,
      });
    }
  }

  // Authoritative entity-keyed tombstone derivation (Invariant 3 & Invariant F: independent of activeSelection)
  const tombstones = deriveTombstonesSnapshot(snapshot, aggregateNodes, previousModel);

  // Authoritative semantic selection resolution
  const zoomTier = Math.round(zoomScale * 10);
  const activeSelection = resolveSelection(targetEntityId, snapshot, aggregateNodes, tombstones, zoomTier);

  // Deterministic collision label layout with focal target selection priority
  const labelPlacements = computeLabelLayout(aggregateNodes, {
    maxLabels: maxVisibleLabels,
    zoomScale,
    selectedEntity: activeSelection ? activeSelection.selectedEntity : null,
    selectedEntityId: targetEntityId,
  });

  return {
    captureSessionId,
    snapshotSequence,
    snapshotTimestamp: snapshot.snapshotTimestamp,
    enrichedHosts,
    hostsById,
    aggregateNodes,
    arcModels,
    labelPlacements,
    coverageStats,
    activeSelection,
    lastUpdatedTs: snapshot.snapshotTimestamp ?? 0,
    tombstones,
  };
}

/**
 * Factory for creating an immutable host TombstoneRecord from a previously live host.
 */
export function createHostTombstone(
  host: EnrichedHost,
  lastObservedTs: number
): TombstoneRecord {
  const hostEntityId = makeHostEntityId(host.ip);
  const tombstone: TombstoneDetails = {
    isInactive: true,
    lastObservedTs,
    lastObservedBytes: host.bytes,
    lastObservedFlows: host.flows,
  };
  const baseLabel = host.hostnames[0]?.name || host.ip;
  return {
    entityId: hostEntityId,
    kind: "endpoint",
    label: baseLabel,
    subLabel: host.ip,
    tombstone,
    selectedEntity: {
      kind: "endpoint",
      ip: host.ip,
      entityId: hostEntityId,
      tombstone,
    },
  };
}

/**
 * Factory for creating an immutable aggregate TombstoneRecord from a previously rendered aggregate node.
 * Bounds and metrics are frozen from the final rendered frame.
 */
export function createAggregateTombstone(
  node: GeoAggregateNode,
  lastObservedTs: number
): TombstoneRecord {
  const tombstone: TombstoneDetails = {
    isInactive: true,
    lastObservedTs,
    lastObservedBytes: node.totalBytes,
    lastObservedFlows: node.totalFlows,
  };
  const baseLabel = node.label.replace(/\s*\(\d+\)$/, "");
  const sampleIps = node.sampleEndpointIps;
  let tombstoneEntity: SelectedEntity;

  if (node.nodeKind === "cityAggregate") {
    tombstoneEntity = {
      kind: "cityAggregate",
      entityId: node.entityId as CityAggregateEntityId,
      cityName: baseLabel,
      countryCode: node.countryCode || undefined,
      memberHosts: [],
      memberCount: node.memberCount,
      sampleEndpointIps: sampleIps,
      isSampled: node.memberCount > 0,
      node,
      tombstone,
    };
  } else if (node.nodeKind === "countryAggregate") {
    tombstoneEntity = {
      kind: "countryAggregate",
      entityId: node.entityId as CountryAggregateEntityId,
      countryCode: node.countryCode || "XX",
      countryName: baseLabel,
      memberHosts: [],
      memberCount: node.memberCount,
      sampleEndpointIps: sampleIps,
      isSampled: node.memberCount > 0,
      node,
      tombstone,
    };
  } else if (node.nodeKind === "cluster") {
    tombstoneEntity = {
      kind: "cluster",
      entityId: node.entityId as ClusterEntityId,
      geoCellId: node.geoCellId,
      clusterId: node.id,
      label: node.label,
      memberHosts: [],
      memberCount: node.memberCount,
      sampleEndpointIps: sampleIps,
      isSampled: node.memberCount > 0,
      node,
      tombstone,
    };
  } else {
    // endpoint nodeKind
    const ip = sampleIps[0] || node.endpointIps[0] || "";
    tombstoneEntity = {
      kind: "endpoint",
      entityId: makeHostEntityId(ip),
      ip,
      tombstone,
    };
  }

  return {
    entityId: node.entityId,
    kind: tombstoneEntity.kind,
    label: baseLabel,
    subLabel: node.subLabel,
    tombstone,
    selectedEntity: tombstoneEntity,
  };
}

/**
 * Derives the authoritative set of live semantic entity IDs from a telemetry snapshot.
 *
 * Invariant: Semantic entity liveness is strictly decoupled from visual node rendering budgets.
 * - Host entities: derived from all enriched hosts
 * - City aggregate entities: derived from all resolved hosts with valid city & country
 * - Country aggregate entities: derived from all resolved hosts with valid country
 * - Cluster entities: derived from all resolved hosts using stable quantized geoCell identity
 * - Currently rendered node entities: included for visual reconciliation
 *
 * (Note: Presentation aggregates like OtherResolved are visual overflow structures and not semantic lifecycle entities.)
 */
export function deriveLiveSemanticEntityIds(
  snapshot: HostEnrichmentSnapshot,
  aggregateNodes: GeoAggregateNode[] = []
): Set<string> {
  const liveEntityIds = new Set<string>();

  for (const host of snapshot.enrichedHosts) {
    // 1. Endpoint entity identity
    liveEntityIds.add(makeHostEntityId(host.ip));
    liveEntityIds.add(host.ip);

    if (host.geo.status === "resolved") {

      // 2. City aggregate entity identity: derived from current resolved hosts
      if (host.geo.countryCode && host.geo.city) {
        const canonicalCityKey = makeCanonicalCityKey(host.geo.city);
        if (canonicalCityKey) {
          liveEntityIds.add(makeCityAggregateEntityId(host.geo.countryCode, canonicalCityKey));
        }
      }

      // 3. Country aggregate entity identity: derived from current resolved hosts
      if (host.geo.countryCode) {
        liveEntityIds.add(makeCountryAggregateEntityId(host.geo.countryCode));
      }

      // 4. Cluster entity identity: derived according to stable geoCell semantics
      const norm = normalizeCoordinates(host.geo.latitude, host.geo.longitude);
      if (norm) {
        const geoCellId = computeGeoCellId(norm.lat, norm.lng);
        liveEntityIds.add(makeClusterEntityId(geoCellId));
        liveEntityIds.add(geoCellId);
        liveEntityIds.add(`cluster-${geoCellId}`);
        liveEntityIds.add(`aggregate-${geoCellId}`);
      }
    }
  }

  // 5. Currently rendered visual aggregate nodes (visual reconciliation)
  for (const node of aggregateNodes) {
    liveEntityIds.add(node.entityId);
    if (node.geoCellId) {
      liveEntityIds.add(makeClusterEntityId(node.geoCellId));
      liveEntityIds.add(node.geoCellId);
      liveEntityIds.add(`cluster-${node.geoCellId}`);
      liveEntityIds.add(`aggregate-${node.geoCellId}`);
    }
    if (node.id) {
      liveEntityIds.add(node.id);
    }
  }

  return liveEntityIds;
}

/**
 * Pure, deterministic derivation of the authoritative tombstone snapshot.
 * Keyed strictly by entityId, independent of activeSelection.
 *
 * Invariants:
 * - E live now => E ∉ tombstones
 * - E dead now and previously observed in this session => E ∈ tombstones
 * - E dead across subsequent frames => tombstones[E] is unchanged (frozen historical metrics & timestamp)
 * - E resurrected => E ∉ tombstones
 * - session changed => previous-session tombstones are cleared
 * - Presentation aggregates (e.g. Other Resolved Traffic) exist solely due to render budget overflow,
 *   not telemetry lifecycle, and therefore NEVER generate tombstones.
 */
export function deriveTombstonesSnapshot(
  snapshot: HostEnrichmentSnapshot,
  aggregateNodes: GeoAggregateNode[],
  previousModel: MapViewModel | null
): Map<string, TombstoneRecord> {
  const sameSession =
    previousModel !== null &&
    previousModel.captureSessionId === snapshot.captureSessionId;

  const previousTombstones = sameSession
    ? previousModel?.tombstones ?? new Map<string, TombstoneRecord>()
    : new Map<string, TombstoneRecord>();

  const nextTombstones = new Map<string, TombstoneRecord>();

  if (!sameSession || !previousModel) {
    return nextTombstones;
  }

  // Authoritative set of currently live semantic entity IDs (separated from rendered node set)
  const liveEntityIds = deriveLiveSemanticEntityIds(snapshot, aggregateNodes);

  // 1. Inherit previously recorded tombstones (frozen state preserved for dead entities)
  for (const [entityId, record] of previousTombstones) {
    if (!liveEntityIds.has(entityId)) {
      nextTombstones.set(entityId, record);
    }
  }

  // 2. Capture newly deceased hosts from previous model
  if (previousModel.enrichedHosts) {
    const lastTs = previousModel.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0;
    for (const prevHost of previousModel.enrichedHosts) {
      const hostEntityId = makeHostEntityId(prevHost.ip);
      if (!liveEntityIds.has(hostEntityId) && !nextTombstones.has(hostEntityId)) {
        nextTombstones.set(hostEntityId, createHostTombstone(prevHost, lastTs));
      }
    }
  }

  // 3. Capture newly deceased aggregates from previous model (frozen at last rendered snapshot)
  if (previousModel.aggregateNodes) {
    const lastTs = previousModel.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0;
    for (const prevNode of previousModel.aggregateNodes) {
      // Presentation aggregates (such as Other Resolved Traffic) exist solely due to render budget overflow.
      // They are not telemetry entities with lifecycle states and must never generate tombstones.
      if (
        prevNode.nodeKind === "otherResolvedAggregate" ||
        prevNode.entityId === OTHER_RESOLVED_ENTITY_ID
      ) {
        continue;
      }

      const aggregateEntityId = prevNode.entityId;

      // Invariant: Render disappearance must not automatically imply tombstone.
      // An aggregate is deceased ONLY if its semantic entityId is not live,
      // its underlying geoCell has no live telemetry, AND none of its constituent member hosts exist in the active snapshot.
      const hasLiveConstituentHost =
        (prevNode.sampleEndpointIps && prevNode.sampleEndpointIps.some((ip) => snapshot.hostsById.has(ip))) ||
        (prevNode.endpointIps && prevNode.endpointIps.some((ip) => snapshot.hostsById.has(ip)));

      const prevGeoCellId = prevNode.geoCellId ? extractGeoCellId(prevNode.geoCellId) : null;
      const isGeoCellLive = prevGeoCellId
        ? liveEntityIds.has(makeClusterEntityId(prevGeoCellId)) || liveEntityIds.has(prevGeoCellId)
        : false;

      const isSemanticEntityLive =
        liveEntityIds.has(aggregateEntityId) ||
        isGeoCellLive ||
        hasLiveConstituentHost;

      if (!isSemanticEntityLive && !nextTombstones.has(aggregateEntityId)) {
        nextTombstones.set(aggregateEntityId, createAggregateTombstone(prevNode, lastTs));
      }
    }
  }

  // 4. Backward-compatibility fallback for legacy activeSelection tombstones
  if (previousModel.activeSelection?.status === "tombstone") {
    const prevSel = previousModel.activeSelection;
    if (
      prevSel.entityId === OTHER_RESOLVED_ENTITY_ID ||
      prevSel.selectedEntity?.kind === "otherResolvedAggregate" ||
      prevSel.selectedEntity?.kind === "otherResolvedGroup"
    ) {
      // Presentation aggregates cannot be tombstones
    } else if (!nextTombstones.has(prevSel.entityId) && !liveEntityIds.has(prevSel.entityId)) {
      const baseLabel = prevSel.label.replace(/\s*\(Inactive\)$/, "");
      const tombstoneDetails: TombstoneDetails = prevSel.tombstoneDetails ||
        prevSel.selectedEntity?.tombstone || {
          isInactive: true,
          lastObservedTs: previousModel.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0,
          lastObservedBytes: 0,
          lastObservedFlows: 0,
        };
      let tombstoneEntity: SelectedEntity;
      if (prevSel.selectedEntity.kind === "endpoint") {
        tombstoneEntity = {
          kind: "endpoint",
          entityId: prevSel.selectedEntity.entityId,
          ip: prevSel.selectedEntity.ip,
          tombstone: tombstoneDetails,
        };
      } else {
        tombstoneEntity = {
          ...prevSel.selectedEntity,
          memberHosts: [],
          tombstone: tombstoneDetails,
        };
      }

      nextTombstones.set(prevSel.entityId, {
        entityId: prevSel.entityId,
        kind: prevSel.selectedEntity.kind,
        label: baseLabel,
        subLabel: prevSel.subLabel,
        tombstone: tombstoneDetails,
        selectedEntity: tombstoneEntity,
      });
    }
  }

  return nextTombstones;
}

export function resolveLiveHostSelection(
  targetEntityId: string,
  hostsById: Map<string, EnrichedHost>
): ResolvedSelection | null {
  const ip = targetEntityId.startsWith("entity-host-")
    ? targetEntityId.replace("entity-host-", "")
    : hostsById.has(targetEntityId)
    ? targetEntityId
    : null;

  if (ip) {
    const host = hostsById.get(ip);
    if (host) {
      return {
        entityId: makeHostEntityId(host.ip),
        status: "active",
        isSelected: true,
        label: host.hostnames[0]?.name || host.ip,
        subLabel: host.ip,
        selectedEntity: {
          kind: "endpoint",
          ip: host.ip,
          entityId: makeHostEntityId(host.ip),
          host,
        },
      };
    }
  }
  return null;
}

export function resolveLiveAggregateSelection(
  targetEntityId: string,
  aggregateNodes: GeoAggregateNode[],
  hostsById: Map<string, EnrichedHost>,
  zoomTier = 10
): ResolvedSelection | null {
  const targetGeoCellId = extractGeoCellId(targetEntityId);

  const matchingNode = aggregateNodes.find((n) => {
    if (n.entityId === targetEntityId || n.id === targetEntityId) return true;
    if (
      targetGeoCellId !== null &&
      (n.geoCellId === targetGeoCellId ||
        extractGeoCellId(n.geoCellId) === targetGeoCellId ||
        extractGeoCellId(n.entityId) === targetGeoCellId ||
        extractGeoCellId(n.id) === targetGeoCellId)
    ) {
      return true;
    }
    if (
      (targetEntityId === OTHER_RESOLVED_ENTITY_ID ||
        targetEntityId === OTHER_RESOLVED_NODE_ID ||
        targetEntityId === OTHER_RESOLVED_GEOCELL_ID) &&
      n.nodeKind === "otherResolvedAggregate"
    ) {
      return true;
    }
    return false;
  });

  if (matchingNode) {
    const sampleIps = matchingNode.sampleEndpointIps;
    const memberHosts = sampleIps
      .map((ip) => hostsById.get(ip))
      .filter((h): h is EnrichedHost => Boolean(h));
    const memberCount = matchingNode.memberCount;
    const isSampled = memberHosts.length < memberCount;

    if (matchingNode.nodeKind === "endpoint") {
      const ip = sampleIps[0] || "";
      const host = hostsById.get(ip);
      return {
        entityId: matchingNode.entityId,
        status: "active",
        isSelected: true,
        label: matchingNode.label,
        subLabel: matchingNode.subLabel,
        selectedEntity: {
          kind: "endpoint",
          ip,
          entityId: makeHostEntityId(ip),
          ...(host ? { host } : {}),
        } as SelectedEntity,
      };
    }

    if (matchingNode.nodeKind === "cityAggregate") {
      return {
        entityId: matchingNode.entityId,
        status: "active",
        isSelected: true,
        label: matchingNode.label,
        subLabel: matchingNode.subLabel,
        selectedEntity: {
          kind: "cityAggregate",
          cityName: matchingNode.label.replace(/\s*\(\d+\)$/, ""),
          countryCode: matchingNode.countryCode || undefined,
          entityId: matchingNode.entityId as CityAggregateEntityId,
          node: matchingNode,
          memberHosts,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        },
      };
    }

    if (matchingNode.nodeKind === "countryAggregate") {
      return {
        entityId: matchingNode.entityId,
        status: "active",
        isSelected: true,
        label: matchingNode.label,
        subLabel: matchingNode.subLabel,
        selectedEntity: {
          kind: "countryAggregate",
          countryCode: matchingNode.countryCode || "XX",
          countryName: matchingNode.label.replace(/\s*\(\d+\)$/, ""),
          entityId: matchingNode.entityId as CountryAggregateEntityId,
          node: matchingNode,
          memberHosts,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        },
      };
    }

    if (matchingNode.nodeKind === "otherResolvedAggregate" || targetEntityId === OTHER_RESOLVED_ENTITY_ID) {
      return {
        entityId: matchingNode.entityId,
        status: "active",
        isSelected: true,
        label: matchingNode.label,
        subLabel: matchingNode.subLabel,
        selectedEntity: {
          kind: "otherResolvedAggregate",
          title: matchingNode.label,
          entityId: OTHER_RESOLVED_ENTITY_ID,
          node: matchingNode,
          memberHosts,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        },
      };
    }

    return {
      entityId: matchingNode.entityId,
      status: "active",
      isSelected: true,
      label: matchingNode.label,
      subLabel: matchingNode.subLabel,
      selectedEntity: {
        kind: "cluster",
        clusterId: matchingNode.id,
        entityId: matchingNode.entityId as ClusterEntityId,
        geoCellId: matchingNode.geoCellId,
        label: matchingNode.label,
        node: matchingNode,
        memberHosts,
        memberCount,
        sampleEndpointIps: sampleIps,
        isSampled,
      },
    };
  }

  // Fallback: Semantic selection resolution for live aggregates not rendered as a single discrete node
  const allHosts = Array.from(hostsById.values());

  const getResolvedCity = (h: EnrichedHost): string | null =>
    h.geo.status === "resolved" ? h.geo.city : null;

  const getResolvedCountry = (h: EnrichedHost): string | null =>
    h.geo.status === "resolved" ? h.geo.country : null;

  // 1. City Aggregate
  if (targetEntityId.startsWith("entity-city-")) {
    const raw = targetEntityId.replace("entity-city-", "");
    const dashIdx = raw.indexOf("-");
    if (dashIdx > 0) {
      const countryCode = raw.substring(0, dashIdx).toLowerCase();
      const cityKey = raw.substring(dashIdx + 1).toLowerCase();

      const memberHosts = allHosts.filter(
        (h) =>
          h.geo.status === "resolved" &&
          h.geo.countryCode?.toLowerCase() === countryCode &&
          makeCanonicalCityKey(h.geo.city || "") === cityKey
      );

      if (memberHosts.length > 0) {
        const firstCity = memberHosts.map(getResolvedCity).find((c): c is string => Boolean(c));
        const cityName = firstCity || cityKey;
        const totalBytes = memberHosts.reduce((s, h) => s + h.bytes, 0);
        const memberCount = memberHosts.length;
        const sampleEndpointIps = memberHosts.slice(0, MAX_CLUSTER_SAMPLE_IPS).map((h) => h.ip);
        const enclosingNode = aggregateNodes.find((n) =>
          n.sampleEndpointIps.some((ip) => memberHosts.some((h) => h.ip === ip))
        );

        return {
          entityId: targetEntityId,
          status: "active",
          isSelected: true,
          label: `${cityName} (${memberCount})`,
          subLabel: `${memberCount} endpoints • ${cityName}, ${countryCode.toUpperCase()} • ${humanBytes(totalBytes)}`,
          selectedEntity: {
            kind: "cityAggregate",
            cityName,
            countryCode: countryCode.toUpperCase(),
            entityId: targetEntityId as CityAggregateEntityId,
            node: enclosingNode,
            memberHosts,
            memberCount,
            sampleEndpointIps,
            isSampled: memberCount > sampleEndpointIps.length,
          },
        };
      }
    }
  }

  // 2. Country Aggregate
  if (targetEntityId.startsWith("entity-country-")) {
    const countryCode = targetEntityId.replace("entity-country-", "").toLowerCase();
    const memberHosts = allHosts.filter(
      (h) => h.geo.status === "resolved" && h.geo.countryCode?.toLowerCase() === countryCode
    );

    if (memberHosts.length > 0) {
      const firstCountry = memberHosts.map(getResolvedCountry).find((c): c is string => Boolean(c));
      const countryName = getCanonicalCountryName(
        countryCode.toUpperCase(),
        firstCountry || "Country"
      );
      const totalBytes = memberHosts.reduce((s, h) => s + h.bytes, 0);
      const memberCount = memberHosts.length;
      const sampleEndpointIps = memberHosts.slice(0, MAX_CLUSTER_SAMPLE_IPS).map((h) => h.ip);
      const enclosingNode = aggregateNodes.find((n) =>
        n.sampleEndpointIps.some((ip) => memberHosts.some((h) => h.ip === ip))
      );

      return {
        entityId: targetEntityId,
        status: "active",
        isSelected: true,
        label: `${countryName} (${memberCount})`,
        subLabel: `${memberCount} endpoints • ${countryName} (${countryCode.toUpperCase()}) • ${humanBytes(totalBytes)}`,
        selectedEntity: {
          kind: "countryAggregate",
          countryCode: countryCode.toUpperCase(),
          countryName,
          entityId: targetEntityId as CountryAggregateEntityId,
          node: enclosingNode,
          memberHosts,
          memberCount,
          sampleEndpointIps,
          isSampled: memberCount > sampleEndpointIps.length,
        },
      };
    }
  }

  // 3. Cluster Aggregate
  if (targetGeoCellId !== null) {
    const geoCellId = targetGeoCellId;

    const memberHosts = allHosts.filter((h) => {
      if (h.geo.status !== "resolved") return false;
      const norm = normalizeCoordinates(h.geo.latitude, h.geo.longitude);
      return norm ? computeGeoCellId(norm.lat, norm.lng) === geoCellId : false;
    });

    if (memberHosts.length > 0) {
      const totalBytes = memberHosts.reduce((s, h) => s + h.bytes, 0);
      const memberCount = memberHosts.length;
      const sampleEndpointIps = memberHosts.slice(0, MAX_CLUSTER_SAMPLE_IPS).map((h) => h.ip);
      const enclosingNode = aggregateNodes.find((n) =>
        n.sampleEndpointIps.some((ip) => memberHosts.some((h) => h.ip === ip))
      );
      const firstCity = memberHosts.map(getResolvedCity).find((c): c is string => Boolean(c));
      const label = firstCity
        ? `${firstCity} Region (${memberCount})`
        : `Spatial Cluster (${memberCount})`;

      return {
        entityId: makeClusterEntityId(geoCellId),
        status: "active",
        isSelected: true,
        label,
        subLabel: `${memberCount} endpoints • ${humanBytes(totalBytes)}`,
        selectedEntity: {
          kind: "cluster",
          clusterId: enclosingNode?.id || makeAggregateRenderNodeId(geoCellId, Math.round(zoomTier)),
          entityId: makeClusterEntityId(geoCellId),
          geoCellId,
          label,
          node: enclosingNode,
          memberHosts,
          memberCount,
          sampleEndpointIps,
          isSampled: memberCount > sampleEndpointIps.length,
        },
      };
    }
  }

  return null;
}

export function resolveSelection(
  targetEntityId: string | null,
  snapshot: HostEnrichmentSnapshot,
  aggregateNodes: GeoAggregateNode[],
  tombstones: Map<string, TombstoneRecord>,
  zoomTier = 10
): ResolvedSelection | null {
  if (!targetEntityId) return null;

  const liveSelection =
    resolveLiveHostSelection(targetEntityId, snapshot.hostsById) ??
    resolveLiveAggregateSelection(targetEntityId, aggregateNodes, snapshot.hostsById, zoomTier);

  if (liveSelection) {
    return liveSelection;
  }

  let tombstone = tombstones.get(targetEntityId);
  if (!tombstone && !targetEntityId.startsWith("entity-host-")) {
    tombstone = tombstones.get(`entity-host-${targetEntityId}`);
  }
  const targetGeoCellId = extractGeoCellId(targetEntityId);
  if (!tombstone && targetGeoCellId !== null) {
    tombstone =
      tombstones.get(makeClusterEntityId(targetGeoCellId)) ||
      tombstones.get(targetGeoCellId) ||
      tombstones.get(`cluster-${targetGeoCellId}`) ||
      tombstones.get(`aggregate-${targetGeoCellId}`);

    if (!tombstone) {
      for (const record of tombstones.values()) {
        if (
          record.kind === "cluster" &&
          "geoCellId" in record.selectedEntity &&
          record.selectedEntity.geoCellId &&
          (record.selectedEntity.geoCellId === targetGeoCellId ||
            extractGeoCellId(record.selectedEntity.geoCellId) === targetGeoCellId)
        ) {
          tombstone = record;
          break;
        }
      }
    }
  }

  if (tombstone) {
    const baseLabel = tombstone.label.replace(/\s*\(Inactive\)$/, "");
    return {
      entityId: tombstone.entityId,
      status: "tombstone",
      isSelected: true,
      label: `${baseLabel} (Inactive)`,
      subLabel: tombstone.subLabel ?? "No longer active in live window",
      selectedEntity: tombstone.selectedEntity,
      tombstoneDetails: tombstone.tombstone,
    };
  }

  return null;
}

/**
 * Pure, deterministic view-model derivation pipeline.
 * Computes all geographic visualizations, deltas, spatial clusters, labels, and selections
 * entirely outside React's render lifecycle.
 *
 * Enforces Invariants 1 through 6.
 */
export function deriveMapViewModel(
  input: MapViewModelInput,
  previousModel: MapViewModel | null,
  options: MapViewModelOptions = {}
): MapViewModel {
  const snapshot = deriveHostEnrichmentSnapshot(input, previousModel);
  return deriveClusteredMapModel(snapshot, previousModel, options);
}
