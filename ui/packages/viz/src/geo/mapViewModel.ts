import type { BreakdownRow } from "@netpulse/contract";
import {
  OTHER_RESOLVED_ENTITY_ID,
  makeHostEntityId,
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
} from "./geoTypes";
import { enrichHost, getLocalOrigin } from "./geoDatabase";
import { buildSpatialClusters } from "./spatialClustering";
import { calculateArcBezier, getArcOpacity, getArcStrokeWidth, type ArcPathModel } from "./trafficArcs";
import { computeLabelLayout } from "./labelLayout";
import { projectGeo } from "./worldGeometry";

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
  let localLanHostsCount = 0;
  let specialHostsCount = 0;
  let totalBytes = 0;
  let resolvedBytes = 0;
  let unresolvedBytes = 0;

  const effectiveTimestamp =
    snapshotTimestamp !== undefined
      ? snapshotTimestamp
      : 0;

  for (const row of hosts) {
    const rawIp = row.label || "";
    const ip = rawIp.trim();
    if (!ip) continue;

    const currentBytes = row.bytes || 0;
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
    localLanHostsCount,
    specialHostsCount,
    totalBytes,
    resolvedBytes,
    unresolvedBytes,
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

      const isTargetNode = (n: GeoAggregateNode) =>
        n.entityId === targetEntityId ||
        n.id === targetEntityId ||
        (selectedIp != null && selectedIp !== "" && n.endpointIps.includes(selectedIp)) ||
        (targetEntityId.startsWith("entity-host-") &&
          n.endpointIps.includes(targetEntityId.replace("entity-host-", "")));

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

      const hasParticles =
        !reducedMotion && (node.freshness === "active" || node.deltaBytes > 0);

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

  // Deterministic collision label layout
  const labelPlacements = computeLabelLayout(aggregateNodes, {
    maxLabels: maxVisibleLabels,
    zoomScale,
  });

  // Invariant 3, Invariant E, and Invariant F: Authoritative Semantic Selection Resolution & Tombstone Handling
  let activeSelection: ResolvedSelection | null = null;

  if (targetEntityId) {
    if (targetEntityId.startsWith("entity-host-")) {
      const targetIp = targetEntityId.replace("entity-host-", "");
      const host = hostsById.get(targetIp);
      if (host) {
        // Authoritative live host endpoint selection
        activeSelection = {
          entityId: targetEntityId,
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
      } else {
        // Transition host to endpoint tombstone
        const prevSelection = previousModel?.activeSelection;
        if (
          prevSelection &&
          prevSelection.selectedEntity &&
          prevSelection.entityId === targetEntityId
        ) {
          const prev = prevSelection.selectedEntity;
          const lastObservedBytes =
            prev.kind === "endpoint" && prev.host
              ? prev.host.bytes
              : "node" in prev && prev.node
              ? prev.node.totalBytes
              : prev.tombstone?.lastObservedBytes ?? 0;
          const lastObservedFlows =
            prev.kind === "endpoint" && prev.host
              ? prev.host.flows
              : "node" in prev && prev.node
              ? prev.node.totalFlows
              : prev.tombstone?.lastObservedFlows ?? 0;

          const prevTombstoneTs =
            prev.tombstone?.lastObservedTs ??
            prevSelection.tombstoneDetails?.lastObservedTs;
          const baseLabel = prevSelection.label.replace(/\s*\(Inactive\)$/, "");
          const tombstone: TombstoneDetails = {
            isInactive: true,
            lastObservedTs:
              prevTombstoneTs ??
              (previousModel?.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0),
            lastObservedBytes,
            lastObservedFlows,
          };

          activeSelection = {
            entityId: targetEntityId,
            status: "tombstone",
            isSelected: true,
            label: `${baseLabel} (Inactive)`,
            subLabel: "No longer active in live window",
            tombstoneDetails: tombstone,
            selectedEntity: {
              kind: "endpoint",
              ip: targetIp,
              entityId: makeHostEntityId(targetIp),
              tombstone,
            },
          };
        }
      }
    } else if (targetEntityId === OTHER_RESOLVED_ENTITY_ID) {
      const matchingNode = aggregateNodes.find(
        (n) => n.entityId === OTHER_RESOLVED_ENTITY_ID || n.nodeKind === "otherResolvedAggregate"
      );
      if (matchingNode) {
        const memberHosts = matchingNode.endpointIps
          .map((ip) => hostsById.get(ip))
          .filter((h): h is EnrichedHost => Boolean(h));

        activeSelection = {
          entityId: targetEntityId,
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
          },
        };
      } else {
        const prevSelection = previousModel?.activeSelection;
        if (
          prevSelection &&
          prevSelection.selectedEntity &&
          prevSelection.entityId === targetEntityId
        ) {
          const prev = prevSelection.selectedEntity;
          const lastObservedBytes =
            "node" in prev && prev.node ? prev.node.totalBytes : prev.tombstone?.lastObservedBytes ?? 0;
          const lastObservedFlows =
            "node" in prev && prev.node ? prev.node.totalFlows : prev.tombstone?.lastObservedFlows ?? 0;
          const prevTombstoneTs =
            prev.tombstone?.lastObservedTs ?? prevSelection.tombstoneDetails?.lastObservedTs;
          const baseLabel = prevSelection.label.replace(/\s*\(Inactive\)$/, "");
          const tombstone: TombstoneDetails = {
            isInactive: true,
            lastObservedTs:
              prevTombstoneTs ??
              (previousModel?.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0),
            lastObservedBytes,
            lastObservedFlows,
          };

          activeSelection = {
            entityId: targetEntityId,
            status: "tombstone",
            isSelected: true,
            label: `${baseLabel} (Inactive)`,
            subLabel: "No longer active in live window",
            tombstoneDetails: tombstone,
            selectedEntity: {
              kind: "otherResolvedAggregate",
              title: baseLabel,
              entityId: OTHER_RESOLVED_ENTITY_ID,
              memberHosts: [],
              tombstone,
            },
          };
        }
      }
    } else if (targetEntityId.startsWith("entity-city-")) {
      const matchingNode = aggregateNodes.find((n) => n.entityId === targetEntityId);
      if (matchingNode) {
        const memberHosts = matchingNode.endpointIps
          .map((ip) => hostsById.get(ip))
          .filter((h): h is EnrichedHost => Boolean(h));

        activeSelection = {
          entityId: targetEntityId,
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
          },
        };
      } else {
        const prevSelection = previousModel?.activeSelection;
        if (
          prevSelection &&
          prevSelection.selectedEntity &&
          prevSelection.entityId === targetEntityId
        ) {
          const prev = prevSelection.selectedEntity;
          const lastObservedBytes =
            "node" in prev && prev.node ? prev.node.totalBytes : prev.tombstone?.lastObservedBytes ?? 0;
          const lastObservedFlows =
            "node" in prev && prev.node ? prev.node.totalFlows : prev.tombstone?.lastObservedFlows ?? 0;
          const prevTombstoneTs =
            prev.tombstone?.lastObservedTs ?? prevSelection.tombstoneDetails?.lastObservedTs;
          const baseLabel = prevSelection.label.replace(/\s*\(Inactive\)$/, "");
          const tombstone: TombstoneDetails = {
            isInactive: true,
            lastObservedTs:
              prevTombstoneTs ??
              (previousModel?.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0),
            lastObservedBytes,
            lastObservedFlows,
          };

          const prevCity = prev.kind === "cityAggregate" ? prev.cityName : baseLabel;
          const prevCountry = prev.kind === "cityAggregate" ? prev.countryCode : undefined;

          activeSelection = {
            entityId: targetEntityId,
            status: "tombstone",
            isSelected: true,
            label: `${baseLabel} (Inactive)`,
            subLabel: "No longer active in live window",
            tombstoneDetails: tombstone,
            selectedEntity: {
              kind: "cityAggregate",
              cityName: prevCity,
              countryCode: prevCountry,
              entityId: targetEntityId as CityAggregateEntityId,
              memberHosts: [],
              tombstone,
            },
          };
        }
      }
    } else if (targetEntityId.startsWith("entity-country-")) {
      const matchingNode = aggregateNodes.find((n) => n.entityId === targetEntityId);
      if (matchingNode) {
        const memberHosts = matchingNode.endpointIps
          .map((ip) => hostsById.get(ip))
          .filter((h): h is EnrichedHost => Boolean(h));

        activeSelection = {
          entityId: targetEntityId,
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
          },
        };
      } else {
        const prevSelection = previousModel?.activeSelection;
        if (
          prevSelection &&
          prevSelection.selectedEntity &&
          prevSelection.entityId === targetEntityId
        ) {
          const prev = prevSelection.selectedEntity;
          const lastObservedBytes =
            "node" in prev && prev.node ? prev.node.totalBytes : prev.tombstone?.lastObservedBytes ?? 0;
          const lastObservedFlows =
            "node" in prev && prev.node ? prev.node.totalFlows : prev.tombstone?.lastObservedFlows ?? 0;
          const prevTombstoneTs =
            prev.tombstone?.lastObservedTs ?? prevSelection.tombstoneDetails?.lastObservedTs;
          const baseLabel = prevSelection.label.replace(/\s*\(Inactive\)$/, "");
          const tombstone: TombstoneDetails = {
            isInactive: true,
            lastObservedTs:
              prevTombstoneTs ??
              (previousModel?.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0),
            lastObservedBytes,
            lastObservedFlows,
          };

          const prevCc = prev.kind === "countryAggregate" ? prev.countryCode : "XX";
          const prevCn = prev.kind === "countryAggregate" ? prev.countryName : baseLabel;

          activeSelection = {
            entityId: targetEntityId,
            status: "tombstone",
            isSelected: true,
            label: `${baseLabel} (Inactive)`,
            subLabel: "No longer active in live window",
            tombstoneDetails: tombstone,
            selectedEntity: {
              kind: "countryAggregate",
              countryCode: prevCc,
              countryName: prevCn,
              entityId: targetEntityId as CountryAggregateEntityId,
              memberHosts: [],
              tombstone,
            },
          };
        }
      }
    } else {
      // Spatial Cluster Aggregate (entity-cluster-...) or generic aggregate target
      const matchingNode = aggregateNodes.find(
        (n) =>
          n.entityId === targetEntityId ||
          n.id === targetEntityId ||
          n.geoCellId === targetEntityId.replace("entity-cluster-", "")
      );
      if (matchingNode) {
        const memberHosts = matchingNode.endpointIps
          .map((ip) => hostsById.get(ip))
          .filter((h): h is EnrichedHost => Boolean(h));

        if (matchingNode.nodeKind === "cityAggregate") {
          activeSelection = {
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
            },
          };
        } else if (matchingNode.nodeKind === "countryAggregate") {
          activeSelection = {
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
            },
          };
        } else if (matchingNode.nodeKind === "otherResolvedAggregate") {
          activeSelection = {
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
            },
          };
        } else {
          activeSelection = {
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
            },
          };
        }
      } else {
        const prevSelection = previousModel?.activeSelection;
        if (
          prevSelection &&
          prevSelection.selectedEntity &&
          prevSelection.entityId === targetEntityId
        ) {
          const prev = prevSelection.selectedEntity;
          const lastObservedBytes =
            "node" in prev && prev.node ? prev.node.totalBytes : prev.tombstone?.lastObservedBytes ?? 0;
          const lastObservedFlows =
            "node" in prev && prev.node ? prev.node.totalFlows : prev.tombstone?.lastObservedFlows ?? 0;
          const prevTombstoneTs =
            prev.tombstone?.lastObservedTs ?? prevSelection.tombstoneDetails?.lastObservedTs;
          const baseLabel = prevSelection.label.replace(/\s*\(Inactive\)$/, "");
          const tombstone: TombstoneDetails = {
            isInactive: true,
            lastObservedTs:
              prevTombstoneTs ??
              (previousModel?.lastUpdatedTs ?? snapshot.snapshotTimestamp ?? 0),
            lastObservedBytes,
            lastObservedFlows,
          };

          let tombstoneEntity: SelectedEntity;
          if (prev.kind === "endpoint") {
            tombstoneEntity = {
              kind: "endpoint",
              entityId: makeHostEntityId(prev.ip),
              ip: prev.ip,
              tombstone,
            };
          } else if (prev.kind === "cityAggregate") {
            tombstoneEntity = {
              kind: "cityAggregate",
              entityId: prev.entityId,
              cityName: prev.cityName,
              countryCode: prev.countryCode,
              memberHosts: [],
              tombstone,
            };
          } else if (prev.kind === "countryAggregate") {
            tombstoneEntity = {
              kind: "countryAggregate",
              entityId: prev.entityId,
              countryCode: prev.countryCode,
              countryName: prev.countryName,
              memberHosts: [],
              tombstone,
            };
          } else if (prev.kind === "cluster") {
            tombstoneEntity = {
              kind: "cluster",
              entityId: prev.entityId,
              geoCellId: prev.geoCellId,
              clusterId: prev.clusterId,
              label: prev.label,
              memberHosts: [],
              tombstone,
            };
          } else if (prev.kind === "otherResolvedAggregate") {
            tombstoneEntity = {
              kind: "otherResolvedAggregate",
              entityId: OTHER_RESOLVED_ENTITY_ID,
              title: prev.title,
              memberHosts: [],
              tombstone,
            };
          } else {
            tombstoneEntity = {
              ...prev,
              memberHosts: [],
              tombstone,
            };
          }

          activeSelection = {
            entityId: targetEntityId,
            status: "tombstone",
            isSelected: true,
            label: `${baseLabel} (Inactive)`,
            subLabel: "No longer active in live window",
            tombstoneDetails: tombstone,
            selectedEntity: tombstoneEntity,
          };
        }
      }
    }
  }

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
  };
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
