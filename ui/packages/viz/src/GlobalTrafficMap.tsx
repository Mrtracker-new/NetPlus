import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import type { BreakdownRow, EvidenceRef } from "@netpulse/contract";
import {
  OTHER_RESOLVED_ENTITY_ID,
  isNodeSelected,
  makeHostEntityId,
  type CityAggregateEntityId,
  type CountryAggregateEntityId,
  type ClusterEntityId,
  type EnrichedHost,
  type GeoAggregateNode,
  type MapRenderPolicy,
  type MapViewTransform,
  type OriginResolution,
  type SelectedEntity,
  type TelemetryFreshness,
} from "./geo/geoTypes";
import { getLocalOrigin } from "./geo/geoDatabase";
import {
  COUNTRY_FEATURES,
  generateGraticulePaths,
  MAP_HEIGHT,
  MAP_WIDTH,
  projectGeo,
} from "./geo/worldGeometry";
import { sampleArcInto, type Point } from "./geo/trafficArcs";
import {
  deriveClusteredMapModel,
  deriveHostEnrichmentSnapshot,
  deriveMapViewModel,
  type HostEnrichmentSnapshot,
  type MapViewModel,
  type MapViewModelInput,
} from "./geo/mapViewModel";
import { humanBytes } from "./utils";

export interface GlobalTrafficMapProps {
  hosts: BreakdownRow[];
  captureSessionId?: string | null;
  snapshotSequence?: number;
  snapshotTimestamp?: number;
  selectedEntity?: SelectedEntity | null;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
  onNavigate?: (ref: EvidenceRef, source?: any) => void;
  origin?: OriginResolution;
  renderPolicy?: MapRenderPolicy;
  snapshotIdentity?: string | number | null;
  className?: string;
}

/** Reactive prefers-reduced-motion hook */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 8.0;

export { isNodeSelected } from "./geo/geoTypes";

export const GlobalTrafficMap = memo(function GlobalTrafficMap({
  hosts,
  captureSessionId,
  snapshotSequence,
  snapshotTimestamp,
  selectedEntity: controlledSelection,
  onSelectEntity,
  onNavigate,
  origin: customOrigin,
  renderPolicy,
  snapshotIdentity,
  className = "",
}: GlobalTrafficMapProps) {
  const baseId = useId().replace(/:/g, "_");
  const gradId = `np-geomap-arcgrad-${baseId}`;
  const origin = useMemo(() => customOrigin ?? getLocalOrigin(), [customOrigin]);
  const reduced = usePrefersReducedMotion();

  const {
    clusterRadiusPx = 26,
    maxVisibleNodes = 120,
    maxVisibleArcs = 48,
    maxVisibleLabels = 24,
    countryAggregationThreshold = 20,
  } = renderPolicy || {};

  // Internal selection state when uncontrolled
  const [internalSelection, setInternalSelection] = useState<SelectedEntity | null>(null);
  const activeSelection = controlledSelection !== undefined ? controlledSelection : internalSelection;

  const handleSetSelection = useCallback(
    (entity: SelectedEntity | null) => {
      if (controlledSelection === undefined) {
        setInternalSelection(entity);
      }
      onSelectEntity?.(entity);
    },
    [controlledSelection, onSelectEntity]
  );

  // Viewport transformation state (Pan & Zoom)
  const [transform, setTransform] = useState<MapViewTransform>({ scale: 1.0, x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number }>({ x: 0, y: 0, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Hover and tooltip state
  const [hoveredNode, setHoveredNode] = useState<GeoAggregateNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // 1. Snapshot-gated host enrichment & delta computation (Invariant 1 & 2)
  const hostEnrichmentRef = useRef<HostEnrichmentSnapshot | null>(null);

  const snapshotModel = useMemo(() => {
    const seq =
      snapshotSequence !== undefined
        ? snapshotSequence
        : typeof snapshotIdentity === "number"
        ? snapshotIdentity
        : 0;

    const session =
      captureSessionId ||
      (typeof snapshotIdentity === "string" ? snapshotIdentity : "default-session");

    const input: MapViewModelInput = {
      hosts,
      captureSessionId: session,
      snapshotSequence: seq,
      snapshotTimestamp,
    };

    const nextSnapshot = deriveHostEnrichmentSnapshot(input, hostEnrichmentRef.current);
    hostEnrichmentRef.current = nextSnapshot;
    return nextSnapshot;
  }, [hosts, captureSessionId, snapshotSequence, snapshotTimestamp, snapshotIdentity]);

  // 2. Authoritative selection resolution IDs
  const selectedEntityId = useMemo(() => {
    if (!activeSelection) return null;
    if ("entityId" in activeSelection && activeSelection.entityId) {
      return activeSelection.entityId;
    }
    if (activeSelection.kind === "endpoint") {
      return makeHostEntityId(activeSelection.ip);
    }
    return null;
  }, [activeSelection]);

  const selectedIp = activeSelection?.kind === "endpoint" ? activeSelection.ip : null;

  // 3. Viewport/zoom-gated spatial clustering, layout, and selection resolution (Invariants 3, 5, 6)
  const viewModelRef = useRef<MapViewModel | null>(null);

  const viewModel = useMemo(() => {
    const nextModel = deriveClusteredMapModel(snapshotModel, viewModelRef.current, {
      zoomScale: transform.scale,
      clusterRadiusPx,
      maxVisibleNodes,
      maxVisibleArcs,
      maxVisibleLabels,
      selectedEntityId,
      selectedIp,
      origin,
      reducedMotion: reduced,
    });

    viewModelRef.current = nextModel;
    return nextModel;
  }, [
    snapshotModel,
    transform.scale,
    clusterRadiusPx,
    maxVisibleNodes,
    maxVisibleArcs,
    maxVisibleLabels,
    selectedEntityId,
    selectedIp,
    origin,
    reduced,
  ]);

  const {
    hostsById,
    aggregateNodes,
    arcModels: baseArcModels,
    labelPlacements,
    coverageStats,
    activeSelection: resolvedActiveSelection,
  } = viewModel;

  const publicResolvedHosts = useMemo(
    () => snapshotModel.enrichedHosts.filter((h) => h.geo.status === "resolved"),
    [snapshotModel.enrichedHosts]
  );
  const unresolvedPublicHosts = useMemo(
    () => snapshotModel.enrichedHosts.filter((h) => h.classification.isPublic && h.geo.status === "unresolved"),
    [snapshotModel.enrichedHosts]
  );
  const localLanHosts = useMemo(
    () => snapshotModel.enrichedHosts.filter((h) => h.classification.isLocalLan),
    [snapshotModel.enrichedHosts]
  );
  const specialHosts = useMemo(
    () => snapshotModel.enrichedHosts.filter((h) => !h.classification.isPublic && !h.classification.isLocalLan),
    [snapshotModel.enrichedHosts]
  );

  // Distinct countries & ASNs for telemetry KPIs
  const { distinctCountries, distinctAsns } = useMemo(() => {
    const countrySet = new Set<string>();
    const asnSet = new Set<number>();
    for (const h of publicResolvedHosts) {
      if (h.geo.status === "resolved") {
        countrySet.add(h.geo.countryCode);
        if (h.asn.status === "resolved") {
          asnSet.add(h.asn.asn);
        }
      }
    }
    return {
      distinctCountries: Array.from(countrySet),
      distinctAsns: Array.from(asnSet),
    };
  }, [publicResolvedHosts]);

  // Max bytes for node radius scaling
  const maxNodeBytes = useMemo(() => {
    return aggregateNodes.reduce((max, n) => Math.max(max, n.totalBytes), 1);
  }, [aggregateNodes]);

  const nodeById = useMemo(() => new Map(aggregateNodes.map((n) => [n.id, n])), [aggregateNodes]);

  // Enhanced Arc Models with Selection Opacity
  const arcModels = useMemo(() => {
    if (origin.status !== "resolved") return [];

    return baseArcModels.map((arc) => {
      const nodeId = arc.id.replace(/^arc-/, "");
      const node = nodeById.get(nodeId);
      const isSelected = isNodeSelected(node, activeSelection, selectedEntityId);
      const opacity = activeSelection ? (isSelected ? 1.0 : 0.25) : arc.opacity;

      return {
        ...arc,
        opacity,
        isSelected,
      };
    });
  }, [origin, baseArcModels, nodeById, activeSelection, selectedEntityId]);

  // 5. Imperative 60fps particle loop mutating SVG circle positions directly
  const particleRefs = useRef<Array<SVGCircleElement | null>>([]);
  const phaseRef = useRef(0);

  // Throttled Screen Reader Announcements (Invariant: only announce on >=5% coverage change)
  const lastAnnouncedCoverage = useRef<number>(-1);
  const [srAnnouncement, setSrAnnouncement] = useState<string>("");

  useEffect(() => {
    const cov = Math.round(coverageStats.coveragePercent);
    if (lastAnnouncedCoverage.current === -1 || Math.abs(cov - lastAnnouncedCoverage.current) >= 5) {
      lastAnnouncedCoverage.current = cov;
      setSrAnnouncement(
        `Map updated: ${coverageStats.resolvedHostsCount} geographically resolved endpoints, ${cov}% coverage across ${coverageStats.totalObservedHosts} total observed hosts.`
      );
    }
  }, [coverageStats.coveragePercent, coverageStats.resolvedHostsCount, coverageStats.totalObservedHosts]);

  // Screen reader announcement for selection & tombstone transitions
  const lastSelectionKey = useRef<string | null>(null);
  useEffect(() => {
    if (!resolvedActiveSelection) {
      if (lastSelectionKey.current !== null) {
        lastSelectionKey.current = null;
        setSrAnnouncement("Selection cleared.");
      }
      return;
    }

    const key = `${resolvedActiveSelection.entityId}-${resolvedActiveSelection.status}-${resolvedActiveSelection.label}`;
    if (lastSelectionKey.current !== key) {
      lastSelectionKey.current = key;
      if (resolvedActiveSelection.status === "tombstone") {
        setSrAnnouncement(`Selection updated: ${resolvedActiveSelection.label} is now inactive.`);
      } else {
        setSrAnnouncement(`Selected: ${resolvedActiveSelection.label}.`);
      }
    }
  }, [resolvedActiveSelection]);

  // Window mouseup listener for pan/drag gestures
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  // Sync particle element refs with current arcModels length
  useEffect(() => {
    particleRefs.current.length = arcModels.length;
  }, [arcModels.length]);

  useEffect(() => {
    if (reduced || arcModels.length === 0) {
      for (let i = 0; i < particleRefs.current.length; i++) {
        const el = particleRefs.current[i];
        if (el) el.setAttribute("opacity", "0");
      }
      return;
    }

    let raf = 0;
    let last = 0;
    const tempPoint: Point = { x: 0, y: 0 };

    const step = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
      last = ts;

      phaseRef.current = (phaseRef.current + dt * 0.45) % 1;

      for (let i = 0; i < arcModels.length; i++) {
        const arc = arcModels[i]!;
        const el = particleRefs.current[i];
        if (el) {
          if (arc.hasParticles) {
            const t = (phaseRef.current + i * 0.15) % 1;
            sampleArcInto(arc.geometry, t, tempPoint);
            el.setAttribute("cx", tempPoint.x.toFixed(1));
            el.setAttribute("cy", tempPoint.y.toFixed(1));
            el.setAttribute("opacity", String(Math.sin(t * Math.PI) * (arc.isSelected ? 1.0 : 0.85)));
          } else {
            el.setAttribute("opacity", "0");
          }
        }
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [arcModels, reduced]);

  // Graticule grid paths
  const graticulePaths = useMemo(() => generateGraticulePaths(), []);

  // Node selection handler
  const handleNodeClick = useCallback(
    (node: GeoAggregateNode) => {
      const sampleIps = node.sampleEndpointIps;

      if (node.nodeKind === "endpoint") {
        const host = hostsById.get(sampleIps[0] || "");
        if (host) {
          handleSetSelection({
            kind: "endpoint",
            ip: host.ip,
            entityId: makeHostEntityId(host.ip),
            host,
          });
          return;
        }
      }

      const members = sampleIps
        .map((ip) => hostsById.get(ip))
        .filter((h): h is EnrichedHost => Boolean(h));
      const memberCount = node.memberCount;
      const isSampled = members.length < memberCount;

      if (node.nodeKind === "cityAggregate") {
        handleSetSelection({
          kind: "cityAggregate",
          cityName: node.label.replace(/\s*\(\d+\)$/, ""),
          countryCode: node.countryCode || undefined,
          entityId: node.entityId as CityAggregateEntityId,
          node,
          memberHosts: members,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        });
        return;
      }

      if (node.nodeKind === "countryAggregate") {
        handleSetSelection({
          kind: "countryAggregate",
          countryCode: node.countryCode || "XX",
          countryName: node.label.replace(/\s*\(\d+\)$/, ""),
          entityId: node.entityId as CountryAggregateEntityId,
          node,
          memberHosts: members,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        });
        return;
      }

      if (node.nodeKind === "cluster") {
        handleSetSelection({
          kind: "cluster",
          clusterId: node.id,
          entityId: node.entityId as ClusterEntityId,
          geoCellId: node.geoCellId,
          label: node.label,
          node,
          memberHosts: members,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        });
        return;
      }

      if (node.nodeKind === "otherResolvedAggregate") {
        handleSetSelection({
          kind: "otherResolvedAggregate",
          title: node.label,
          entityId: OTHER_RESOLVED_ENTITY_ID,
          node,
          memberHosts: members,
          memberCount,
          sampleEndpointIps: sampleIps,
          isSampled,
        });
        return;
      }
    },
    [hostsById, handleSetSelection]
  );

  // Pan & Zoom Gesture Handlers
  const handleWheel = useCallback((e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse to SVG map coordinates (720 x 360 space)
    const svgX = (mouseX / rect.width) * MAP_WIDTH;
    const svgY = (mouseY / rect.height) * MAP_HEIGHT;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setTransform((prev) => {
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale * zoomFactor));
      if (nextScale === prev.scale) return prev;

      // Center zoom around mouse point
      const nextX = svgX - (svgX - prev.x) * (nextScale / prev.scale);
      const nextY = svgY - (svgY - prev.y) * (nextScale / prev.scale);

      // Clamp panning boundaries
      const maxPanX = 0;
      const minPanX = MAP_WIDTH * (1 - nextScale);
      const maxPanY = 0;
      const minPanY = MAP_HEIGHT * (1 - nextScale);

      return {
        scale: nextScale,
        x: Math.max(minPanX, Math.min(maxPanX, nextX)),
        y: Math.max(minPanY, Math.min(maxPanY, nextY)),
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Only primary button
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y,
    };
  }, [transform.x, transform.y]);

  const handleMouseMove = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;
    const dx = (e.clientX - dragStartRef.current.x) * (MAP_WIDTH / (svgRef.current?.clientWidth || MAP_WIDTH));
    const dy = (e.clientY - dragStartRef.current.y) * (MAP_HEIGHT / (svgRef.current?.clientHeight || MAP_HEIGHT));

    const nextX = dragStartRef.current.tx + dx;
    const nextY = dragStartRef.current.ty + dy;

    const maxPanX = 0;
    const minPanX = MAP_WIDTH * (1 - transform.scale);
    const maxPanY = 0;
    const minPanY = MAP_HEIGHT * (1 - transform.scale);

    setTransform((prev) => ({
      ...prev,
      x: Math.max(minPanX, Math.min(maxPanX, nextX)),
      y: Math.max(minPanY, Math.min(maxPanY, nextY)),
    }));
  }, [transform.scale]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleDoubleClick = useCallback((e: MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const svgX = (mouseX / rect.width) * MAP_WIDTH;
    const svgY = (mouseY / rect.height) * MAP_HEIGHT;

    setTransform((prev) => {
      const nextScale = Math.min(MAX_ZOOM, prev.scale * 1.75);
      const nextX = svgX - (svgX - prev.x) * (nextScale / prev.scale);
      const nextY = svgY - (svgY - prev.y) * (nextScale / prev.scale);

      const maxPanX = 0;
      const minPanX = MAP_WIDTH * (1 - nextScale);
      const maxPanY = 0;
      const minPanY = MAP_HEIGHT * (1 - nextScale);

      return {
        scale: nextScale,
        x: Math.max(minPanX, Math.min(maxPanX, nextX)),
        y: Math.max(minPanY, Math.min(maxPanY, nextY)),
      };
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform((prev) => {
      const nextScale = Math.min(MAX_ZOOM, prev.scale * 1.35);
      const cx = MAP_WIDTH / 2;
      const cy = MAP_HEIGHT / 2;
      const nextX = cx - (cx - prev.x) * (nextScale / prev.scale);
      const nextY = cy - (cy - prev.y) * (nextScale / prev.scale);
      return {
        scale: nextScale,
        x: Math.max(MAP_WIDTH * (1 - nextScale), Math.min(0, nextX)),
        y: Math.max(MAP_HEIGHT * (1 - nextScale), Math.min(0, nextY)),
      };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => {
      const nextScale = Math.max(MIN_ZOOM, prev.scale * 0.74);
      if (nextScale <= 1.0) {
        return { scale: 1.0, x: 0, y: 0 };
      }
      const cx = MAP_WIDTH / 2;
      const cy = MAP_HEIGHT / 2;
      const nextX = cx - (cx - prev.x) * (nextScale / prev.scale);
      const nextY = cy - (cy - prev.y) * (nextScale / prev.scale);
      return {
        scale: nextScale,
        x: Math.max(MAP_WIDTH * (1 - nextScale), Math.min(0, nextX)),
        y: Math.max(MAP_HEIGHT * (1 - nextScale), Math.min(0, nextY)),
      };
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setTransform({ scale: 1.0, x: 0, y: 0 });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      if (e.key === "Escape") {
        handleSetSelection(null);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        handleResetZoom();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTransform((prev) => ({ ...prev, x: Math.min(0, prev.x + 30) }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setTransform((prev) => ({ ...prev, x: Math.max(MAP_WIDTH * (1 - prev.scale), prev.x - 30) }));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setTransform((prev) => ({ ...prev, y: Math.min(0, prev.y + 30) }));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setTransform((prev) => ({ ...prev, y: Math.max(MAP_HEIGHT * (1 - prev.scale), prev.y - 30) }));
      }
    },
    [handleSetSelection, handleZoomIn, handleZoomOut, handleResetZoom]
  );

  return (
    <div className={`np-geomap-container ${className}`}>
      {/* 1. Unambiguous Production KPI Header */}
      <header className="np-geomap-hud" aria-label="Global Network Telemetry Summary">
        <div className="np-geomap-hud__item" title="Unique countries represented by successfully GeoIP-resolved public endpoints">
          <span className="np-geomap-hud__label">RESOLVED COUNTRIES</span>
          <span className="np-geomap-hud__val">{distinctCountries.length}</span>
        </div>
        <div className="np-geomap-hud__item" title="Geographically resolved public endpoints out of all observed public destinations">
          <span className="np-geomap-hud__label">RESOLVED ENDPOINTS</span>
          <span className="np-geomap-hud__val">
            {coverageStats.resolvedHostsCount} <span className="np-geomap-hud__sub">/ {coverageStats.publicHostsCount}</span>
          </span>
        </div>
        <div className="np-geomap-hud__item" title="Unique Autonomous System Numbers (ASNs) from resolved public endpoints">
          <span className="np-geomap-hud__label">UNIQUE ASNs</span>
          <span className="np-geomap-hud__val">{distinctAsns.length}</span>
        </div>
        <div className="np-geomap-hud__item" title="Total network traffic volume observed across all public and local hosts">
          <span className="np-geomap-hud__label">TOTAL VOLUME</span>
          <span className="np-geomap-hud__val">{humanBytes(coverageStats.totalBytes)}</span>
        </div>
        <div
          className="np-geomap-hud__item"
          title={`Percentage of observed public destinations with geographic coordinate resolution (${coverageStats.resolvedHostsCount}/${coverageStats.publicHostsCount} endpoints, ${coverageStats.resolvedBytesPercent.toFixed(0)}% bytes). Public IPv6 GeoIP resolution is intentionally deferred.`}
        >
          <span className="np-geomap-hud__label">GEOGRAPHIC COVERAGE</span>
          <span
            className="np-geomap-hud__val"
            style={{
              color:
                coverageStats.coveragePercent > 80
                  ? "var(--np-good, #46c48d)"
                  : coverageStats.coveragePercent > 40
                  ? "var(--np-warning, #f2b64d)"
                  : "var(--np-accent, #2fe0d6)",
            }}
          >
            {Math.round(coverageStats.coveragePercent)}%
            <span className="np-geomap-hud__sub"> ({coverageStats.resolvedBytesPercent.toFixed(0)}% bytes)</span>
          </span>
        </div>
        <div
          className="np-geomap-hud__item np-geomap-hud__origin"
          title={
            origin.status === "resolved"
              ? `Origin location resolved via ${origin.source}`
              : "The local endpoint could not be geographically resolved. Remote endpoint data remains available without synthetic origins."
          }
        >
          <span className="np-geomap-hud__label">LOCAL ORIGIN</span>
          <span
            className="np-geomap-hud__val"
            style={{ color: origin.status === "resolved" ? "var(--np-accent)" : "var(--np-text-mute)" }}
          >
            {origin.status === "resolved" ? origin.label : "Location unavailable"}
          </span>
        </div>
      </header>

      {/* 2. Prominent Coverage & Unresolved Alert Banner */}
      {unresolvedPublicHosts.length > 0 && (
        <div className="np-geomap-coverage-banner" role="status" aria-live="polite">
          <div className="np-geomap-coverage-banner__info">
            <span className="np-geomap-coverage-banner__icon" aria-hidden="true">
              ⚠
            </span>
            <span>
              <strong>{unresolvedPublicHosts.length} public endpoint{unresolvedPublicHosts.length > 1 ? "s" : ""}</strong> have no geographic resolution ({humanBytes(coverageStats.unresolvedBytes)} observed{coverageStats.ipv6DeferredHostsCount && coverageStats.ipv6DeferredHostsCount > 0 ? `, including ${coverageStats.ipv6DeferredHostsCount} IPv6 deferred` : ""})
            </span>
          </div>
          <button
            type="button"
            className="np-btn np-btn--ghost np-btn--sm np-geomap-coverage-banner__btn"
            onClick={() =>
              handleSetSelection({
                kind: "unresolvedGroup",
                title: "Unresolved Public Destinations",
                memberHosts: unresolvedPublicHosts,
              })
            }
          >
            Inspect Unresolved
          </button>
        </div>
      )}

      {/* Screen Reader Live Region (Throttled to >=5% coverage changes) */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {srAnnouncement}
      </div>

      {/* 3. Main SVG World Map Visualization Layer with Vector Pan & Zoom */}
      <div className="np-geomap-canvas-wrapper" style={{ position: "relative", width: "100%", height: "auto" }}>
        <svg
          ref={svgRef}
          className="np-geomap-svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label={`Global Traffic Map: ${distinctCountries.length} active countries, ${coverageStats.resolvedHostsCount} resolved endpoints, ${coverageStats.unresolvedHostsCount} unresolved endpoints, total volume ${humanBytes(coverageStats.totalBytes)}`}
          tabIndex={0}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          style={{ cursor: transform.scale > 1.0 ? (isDraggingRef.current ? "grabbing" : "grab") : "default" }}
        >
          <defs>
            {/* Landmass depth shadow */}
            <filter id={`np-land-shadow-${baseId}`} x="-5%" y="-5%" width="110%" height="110%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.5" />
            </filter>

            {/* Soft glow filter for active nodes */}
            <filter id={`np-glow-${baseId}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Selection halo glow */}
            <filter id={`np-select-glow-${baseId}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Linear gradient for arcs */}
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--np-accent, #2fe0d6)" stopOpacity="0.85" />
              <stop offset="100%" stopColor="var(--np-accent-2, #6f76f5)" stopOpacity="0.95" />
            </linearGradient>
          </defs>

          {/* Background fill (click to clear selection) */}
          <rect
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            fill="var(--np-surface-1, #0b111c)"
            rx="12"
            onClick={() => handleSetSelection(null)}
          />

          {/* Root Pan/Zoom Transformed Group */}
          <g transform={`translate(${transform.x.toFixed(2)}, ${transform.y.toFixed(2)}) scale(${transform.scale.toFixed(4)})`}>
            {/* Layer 1: Graticule Grid & Equator / Prime Meridian */}
            <line x1="0" y1="180" x2={MAP_WIDTH} y2="180" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.75" strokeDasharray="3 3" />
            <line x1="360" y1="0" x2="360" y2={MAP_HEIGHT} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.75" strokeDasharray="3 3" />

            <g className="np-geomap__graticule" stroke="rgba(255, 255, 255, 0.03)" strokeWidth="0.5" strokeDasharray="2 4">
              {graticulePaths.map((p, idx) => (
                <path key={idx} d={p} fill="none" />
              ))}
            </g>

            {/* Layer 2: Sovereign Country Geometries (Natural Earth 1:110m Admin-0) */}
            <g className="np-geomap__countries" filter={`url(#np-land-shadow-${baseId})`}>
              {COUNTRY_FEATURES.map((country) => {
                const isCountrySelected =
                  activeSelection?.kind === "countryAggregate" && activeSelection.countryCode === country.id;

                return (
                  <path
                    key={country.id}
                    d={country.d}
                    className="np-geomap__country"
                    fill={isCountrySelected ? "#1b2838" : "#131a26"}
                    stroke={isCountrySelected ? "var(--np-accent, #2fe0d6)" : "rgba(255, 255, 255, 0.09)"}
                    strokeWidth={isCountrySelected ? 1.2 : 0.65}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  >
                    <title>{country.name}</title>
                  </path>
                );
              })}
            </g>

            {/* Layer 3: Traffic Arcs (Honest: Drawn only when origin is resolved) */}
            {origin.status === "resolved" && (
              <g className="np-geomap__arcs">
                {arcModels.map((arc) => (
                  <path
                    key={arc.id}
                    d={arc.d}
                    fill="none"
                    stroke={`url(#${gradId})`}
                    strokeWidth={arc.strokeWidth}
                    opacity={arc.opacity}
                    strokeLinecap="round"
                  />
                ))}
              </g>
            )}

            {/* Layer 4: Animated Particles on Active Telemetry Deltas */}
            {origin.status === "resolved" && !reduced && (
              <g className="np-geomap__particles">
                {arcModels.map((arc, i) => (
                  <circle
                    key={`p-${arc.id}`}
                    ref={(el) => {
                      particleRefs.current[i] = el;
                    }}
                    r={arc.isSelected ? "3" : "2.2"}
                    fill="var(--np-accent, #2fe0d6)"
                    opacity="0"
                  />
                ))}
              </g>
            )}

            {/* Layer 5: Aggregated Geographic Destination Nodes & Labels */}
            <g className="np-geomap__nodes">
              {aggregateNodes.map((node) => {
                const isSelected = isNodeSelected(node, activeSelection, selectedEntityId);
                const hasSelectionActive = activeSelection !== null;
                const nodeOpacity = hasSelectionActive ? (isSelected ? 1.0 : 0.3) : 1.0;

                const isAggregate =
                  node.nodeKind === "cluster" ||
                  node.nodeKind === "cityAggregate" ||
                  node.nodeKind === "countryAggregate" ||
                  node.nodeKind === "otherResolvedAggregate";
                const baseRadius = isAggregate ? 7 : 4.5;
                const radius = baseRadius + Math.sqrt(node.totalBytes / maxNodeBytes) * 5.5;

                const labelPlacement = labelPlacements.get(node.id);

                return (
                  <g
                    key={node.id}
                    className={`np-geomap__node-group ${isSelected ? "np-geomap__node-group--selected" : ""}`}
                    transform={`translate(${node.x}, ${node.y})`}
                    opacity={nodeOpacity}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeClick(node);
                    }}
                    onMouseEnter={() => {
                      setHoveredNode(node);
                      setTooltipPos({ x: node.x, y: node.y });
                    }}
                    onMouseLeave={() => {
                      setHoveredNode(null);
                      setTooltipPos(null);
                    }}
                    onFocus={() => {
                      setHoveredNode(node);
                      setTooltipPos({ x: node.x, y: node.y });
                    }}
                    onBlur={() => {
                      setHoveredNode(null);
                      setTooltipPos(null);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={
                      node.nodeKind === "otherResolvedAggregate"
                        ? `Other Resolved Traffic. Aggregated traffic containing ${node.memberCount} endpoints across ${node.asns.length} autonomous systems. Total volume ${humanBytes(node.totalBytes)}, ${node.totalFlows} flows. Activate to inspect aggregated endpoints.`
                        : `${node.label}, ${humanBytes(node.totalBytes)}, ${node.totalFlows} flows, ${node.nodeKind}`
                    }
                    aria-pressed={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleNodeClick(node);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {/* Pulse ring for active telemetry bursts */}
                    {node.freshness === "active" && !reduced && (
                      <circle
                        r={radius + 5}
                        fill="none"
                        stroke="var(--np-accent, #2fe0d6)"
                        strokeWidth="1"
                        opacity="0.4"
                        className="np-geomap__pulse-ring"
                      />
                    )}

                    {/* Selection halo */}
                    {isSelected && (
                      <circle
                        r={radius + 6}
                        fill="none"
                        stroke="var(--np-accent, #2fe0d6)"
                        strokeWidth="2"
                        strokeDasharray="3 3"
                        filter={`url(#np-select-glow-${baseId})`}
                      />
                    )}

                    {/* Base Node Circle */}
                    <circle
                      r={radius}
                      fill={
                        isSelected
                          ? "var(--np-accent, #2fe0d6)"
                          : isAggregate
                          ? "var(--np-accent-2, #6f76f5)"
                          : node.freshness === "active"
                          ? "var(--np-accent, #2fe0d6)"
                          : "var(--np-surface-3, #1e293b)"
                      }
                      stroke={isSelected ? "#ffffff" : "var(--np-surface-1, #0b111c)"}
                      strokeWidth={isSelected ? 2 : 1.5}
                      strokeDasharray={node.nodeKind === "otherResolvedAggregate" ? "2 2" : undefined}
                      filter={`url(#np-glow-${baseId})`}
                    />

                    {/* Cluster inner count indicator */}
                    {isAggregate && node.memberCount && node.memberCount > 1 && (
                      <text
                        x={0}
                        y={3}
                        fill="#ffffff"
                        fontSize="8px"
                        fontWeight="bold"
                        textAnchor="middle"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {node.memberCount > 99 ? "99+" : node.memberCount}
                      </text>
                    )}

                    {/* Collision-Free Text Label (if placed) */}
                    {labelPlacement && labelPlacement.visible && (
                      <text
                        x={labelPlacement.x - node.x}
                        y={labelPlacement.y - node.y}
                        textAnchor={labelPlacement.anchor}
                        fill={isSelected ? "var(--np-accent, #2fe0d6)" : "var(--np-text, #e7ebf3)"}
                        fontSize="9px"
                        fontFamily="var(--np-font-mono, monospace)"
                        fontWeight={isSelected ? "bold" : "normal"}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {labelPlacement.text}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Layer 6: Resolved Local Origin Node (Honest representation) */}
            {origin.status === "resolved" && (
              <g transform={`translate(${projectGeo(origin.latitude, origin.longitude).join(",")})`}>
                <circle r="7" fill="var(--np-good, #46c48d)" stroke="#fff" strokeWidth="1.5" />
                <text x="10" y="3" fill="var(--np-good, #46c48d)" fontSize="9px" fontWeight="bold">
                  YOU ({origin.label})
                </text>
              </g>
            )}
          </g>
        </svg>

        {/* Floating Pan/Zoom Control Buttons */}
        <div className="np-geomap-controls" role="group" aria-label="Map zoom and pan controls">
          <button
            type="button"
            className="np-geomap-control-btn"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            +
          </button>
          <button
            type="button"
            className="np-geomap-control-btn"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            title="Zoom out (-)"
          >
            −
          </button>
          <button
            type="button"
            className="np-geomap-control-btn np-geomap-control-btn--reset"
            onClick={handleResetZoom}
            aria-label="Reset to world view"
            title="Reset to world view (0)"
            disabled={transform.scale === 1.0 && transform.x === 0 && transform.y === 0}
          >
            ⟲
          </button>
        </div>

        {/* Floating Compact Legend */}
        <div className="np-geomap-legend" aria-hidden="true">
          <span className="np-geomap-legend__item">
            <span className="np-geomap-legend__dot np-geomap-legend__dot--endpoint" /> Endpoint
          </span>
          <span className="np-geomap-legend__item">
            <span className="np-geomap-legend__dot np-geomap-legend__dot--cluster" /> Cluster
          </span>
          <span className="np-geomap-legend__item">
            <span className="np-geomap-legend__line" /> Observed Traffic
          </span>
          <span className="np-geomap-legend__item">
            <span className="np-geomap-legend__dot np-geomap-legend__dot--selected" /> Selected
          </span>
        </div>

        {/* Floating Hover Tooltip */}
        {hoveredNode && tooltipPos && (
          <div
            className="np-geomap-tooltip"
            role="tooltip"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${((tooltipPos.x * transform.scale + transform.x) / MAP_WIDTH) * 100}%`,
              top: `${((tooltipPos.y * transform.scale + transform.y) / MAP_HEIGHT) * 100}%`,
              transform: "translate(-50%, -125%)",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <div
              className="np-card"
              style={{
                padding: "0.5rem 0.75rem",
                minWidth: "170px",
                background: "var(--np-surface-1, #0b111c)",
                border: "1px solid var(--np-accent-line, #2fe0d6)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--np-accent)" }}>
                {hoveredNode.label}
              </div>
              {hoveredNode.subLabel && (
                <div style={{ fontSize: "0.72rem", color: "var(--np-text-dim)", marginBottom: "4px" }}>
                  {hoveredNode.subLabel}
                </div>
              )}
              <div style={{ fontSize: "0.72rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
                <span style={{ color: "var(--np-text-mute)" }}>Traffic:</span>
                <span style={{ fontWeight: 500 }}>{humanBytes(hoveredNode.totalBytes)}</span>
                <span style={{ color: "var(--np-text-mute)" }}>Flows:</span>
                <span style={{ fontWeight: 500 }}>{hoveredNode.totalFlows}</span>
                <span style={{ color: "var(--np-text-mute)" }}>ASNs:</span>
                <span style={{ fontWeight: 500 }}>
                  {hoveredNode.asns.length > 0 ? hoveredNode.asns.map((a) => `AS${a}`).join(", ") : "None"}
                </span>
                <span style={{ color: "var(--np-text-mute)" }}>Kind:</span>
                <span style={{ fontWeight: 500 }}>
                  {hoveredNode.nodeKind === "otherResolvedAggregate" ? "Aggregate Rollup" : hoveredNode.nodeKind}
                </span>
                {hoveredNode.precisionDescription && (
                  <>
                    <span style={{ color: "var(--np-text-mute)" }}>Precision:</span>
                    <span style={{ fontWeight: 500, fontSize: "0.68rem", color: "var(--np-accent)" }}>
                      {hoveredNode.precisionDescription}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Non-Visual Screen Reader Static Description (aria-live="off" avoids AT flooding on 1.5s polling) */}
      {/* FINDING-006 fix: The first throttled region above the SVG handles coverage-change announcements.
          This region is a static description read on focus, not on every render. */}
      <div className="sr-only" role="note" aria-live="off">
        Global Traffic Map: {coverageStats.publicHostsCount} public endpoints observed.{" "}
        {coverageStats.resolvedHostsCount} geographically resolved, {coverageStats.unresolvedHostsCount} unresolved.{" "}
        {humanBytes(coverageStats.totalBytes)} total observed traffic across {distinctCountries.length} resolved countries and {distinctAsns.length} autonomous systems.
      </div>

      {/* 5. Supplementary Drawers: Local LAN & Special-Use Address Space */}
      <footer className="np-geomap-footer">
        {/* Local Network Activity Tray */}
        {localLanHosts.length > 0 && (
          <div className="np-geomap-tray np-geomap-tray--local">
            <div className="np-geomap-tray__header">
              <span className="np-badge np-badge--accent">
                Local Network ({localLanHosts.length} LAN / Multicast)
              </span>
              <button
                type="button"
                className="np-btn np-btn--ghost np-btn--sm"
                onClick={() =>
                  handleSetSelection({
                    kind: "localNetworkGroup",
                    title: "Local Network Activity",
                    category: "lan",
                    memberHosts: localLanHosts,
                  })
                }
              >
                Inspect LAN ({humanBytes(localLanHosts.reduce((s, h) => s + h.bytes, 0))})
              </button>
            </div>
            <div className="np-geomap-tray__chips">
              {localLanHosts.slice(0, 8).map((h) => (
                <button
                  key={h.ip}
                  type="button"
                  className="np-pill"
                  onClick={() =>
                    handleSetSelection({
                      kind: "endpoint",
                      entityId: makeHostEntityId(h.ip),
                      ip: h.ip,
                      host: h,
                    })
                  }
                >
                  {h.ip} • {h.classification.categoryLabel}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shared Space / Special Addresses Tray */}
        {specialHosts.length > 0 && (
          <div className="np-geomap-tray np-geomap-tray--special">
            <div className="np-geomap-tray__header">
              <span className="np-badge np-badge--neutral">
                Shared Space / Special ({specialHosts.length})
              </span>
              <button
                type="button"
                className="np-btn np-btn--ghost np-btn--sm"
                onClick={() =>
                  handleSetSelection({
                    kind: "localNetworkGroup",
                    title: "Special Address Space Activity",
                    category: "special",
                    memberHosts: specialHosts,
                  })
                }
              >
                Inspect Special ({humanBytes(specialHosts.reduce((s, h) => s + h.bytes, 0))})
              </button>
            </div>
            <div className="np-geomap-tray__chips">
              {specialHosts.slice(0, 8).map((h) => (
                <button
                  key={h.ip}
                  type="button"
                  className="np-pill"
                  onClick={() =>
                    handleSetSelection({
                      kind: "endpoint",
                      entityId: makeHostEntityId(h.ip),
                      ip: h.ip,
                      host: h,
                    })
                  }
                >
                  {h.ip} • {h.classification.categoryLabel}
                </button>
              ))}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
});
