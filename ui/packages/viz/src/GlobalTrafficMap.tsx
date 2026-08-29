import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { BreakdownRow, EvidenceRef } from "@netpulse/contract";
import {
  OTHER_RESOLVED_ENTITY_ID,
  UNRESOLVED_PUBLIC_ENTITY_ID,
  LOCAL_LAN_ENTITY_ID,
  SPECIAL_SPACE_ENTITY_ID,
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
import { calculateTooltipPlacement, type TooltipPlacement } from "./geo/tooltipPlacement";

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

  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Canvas wrapper bounding dimensions state
  const [wrapperSize, setWrapperSize] = useState<{ width: number; height: number }>({
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  });

  // Track canvas wrapper resize events (window resize, sidebar toggle, responsive shifts)
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setWrapperSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    }

    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setWrapperSize((prev) => {
            if (Math.abs(prev.width - width) >= 1 || Math.abs(prev.height - height) >= 1) {
              return { width: Math.round(width), height: Math.round(height) };
            }
            return prev;
          });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hover and tooltip state
  const [hoveredNode, setHoveredNode] = useState<GeoAggregateNode | null>(null);
  const [tooltipScreenPos, setTooltipScreenPos] = useState<{ x: number; y: number; radius: number } | null>(null);
  const [measuredTooltipSize, setMeasuredTooltipSize] = useState<{ width: number; height: number }>({
    width: 220,
    height: 140,
  });

  // Dynamically measure actual tooltip dimensions upon render/content change with ResizeObserver
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!hoveredNode || !el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setMeasuredTooltipSize((prev) => {
        if (Math.abs(prev.width - rect.width) >= 1 || Math.abs(prev.height - rect.height) >= 1) {
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }
        return prev;
      });
    }

    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setMeasuredTooltipSize((prev) => {
            if (Math.abs(prev.width - width) >= 1 || Math.abs(prev.height - height) >= 1) {
              return { width: Math.round(width), height: Math.round(height) };
            }
            return prev;
          });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [hoveredNode]);

  // 1. Snapshot-gated host enrichment & delta computation (Invariant 1 & 2)
  const hostEnrichmentRef = useRef<HostEnrichmentSnapshot | null>(null);
  const implicitSequenceRef = useRef<number>(0);

  const snapshotModel = useMemo(() => {
    const isExplicit =
      snapshotSequence !== undefined || typeof snapshotIdentity === "number";

    let seq: number;
    if (isExplicit) {
      seq =
        snapshotSequence !== undefined
          ? snapshotSequence
          : (snapshotIdentity as number);
      // Synchronize implicit counter so future implicit mode transitions remain monotonically ahead
      implicitSequenceRef.current = Math.max(implicitSequenceRef.current, seq);
    } else {
      // In implicit mode, increment internal sequence so that consecutive hosts prop updates
      // are recognized as fresh logical snapshots rather than rejected duplicates.
      implicitSequenceRef.current = Math.max(
        implicitSequenceRef.current + 1,
        (hostEnrichmentRef.current?.snapshotSequence ?? 0) + 1
      );
      seq = implicitSequenceRef.current;
    }

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
      selectedEntity: activeSelection,
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
    activeSelection,
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
    () => snapshotModel.enrichedHosts.filter((h) => h.geo.mapEligible),
    [snapshotModel.enrichedHosts]
  );
  const unresolvedPublicHosts = useMemo(
    () => snapshotModel.enrichedHosts.filter((h) => h.classification.isPublic && !h.geo.mapEligible),
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
      if (h.geo.countryCode) {
        countrySet.add(h.geo.countryCode);
      }
      if (h.asn.status === "resolved") {
        asnSet.add(h.asn.asn);
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

  // Cooperative Gesture: Modifier-key detection for non-hijacking map zoom
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent || navigator.platform || "");
  }, []);
  const modifierLabel = isMac ? "⌘" : "Ctrl";

  const [showScrollHint, setShowScrollHint] = useState(false);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cooperative Gesture Pan & Zoom: Non-passive wheel listener to prevent dual scroll
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onNativeWheel = (e: globalThis.WheelEvent) => {
      // Intentional zoom: Ctrl / Meta held OR trackpad pinch-to-zoom (emits ctrlKey=true)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (hintTimeoutRef.current) {
          clearTimeout(hintTimeoutRef.current);
          setShowScrollHint(false);
        }

        const rect = svg.getBoundingClientRect();
        const width = rect && rect.width > 0 ? rect.width : MAP_WIDTH;
        const height = rect && rect.height > 0 ? rect.height : MAP_HEIGHT;
        const left = rect ? rect.left : 0;
        const top = rect ? rect.top : 0;

        const mouseX = e.clientX - left;
        const mouseY = e.clientY - top;

        const svgX = (mouseX / width) * MAP_WIDTH;
        const svgY = (mouseY / height) * MAP_HEIGHT;

        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
        setTransform((prev) => {
          const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale * zoomFactor));
          if (nextScale === prev.scale) return prev;

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
      } else {
        // Page scrolling: allow natural document scroll without hijacking, show temporary cooperative hint
        setShowScrollHint(true);
        if (hintTimeoutRef.current) {
          clearTimeout(hintTimeoutRef.current);
        }
        hintTimeoutRef.current = setTimeout(() => {
          setShowScrollHint(false);
        }, 1500);
      }
    };

    svg.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onNativeWheel);
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
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
    const width = rect && rect.width > 0 ? rect.width : MAP_WIDTH;
    const height = rect && rect.height > 0 ? rect.height : MAP_HEIGHT;
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;

    const mouseX = e.clientX - left;
    const mouseY = e.clientY - top;
    const svgX = (mouseX / width) * MAP_WIDTH;
    const svgY = (mouseY / height) * MAP_HEIGHT;

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

  // Hover & Tooltip Handlers with screen-space coordinates
  const handleNodeHover = useCallback(
    (node: GeoAggregateNode, radius: number, el?: SVGElement | null) => {
      setHoveredNode(node);
      if (el && canvasWrapperRef.current) {
        const nodeRect = el.getBoundingClientRect();
        const wrapperRect = canvasWrapperRef.current.getBoundingClientRect();
        setTooltipScreenPos({
          x: nodeRect.left + nodeRect.width / 2 - wrapperRect.left,
          y: nodeRect.top + nodeRect.height / 2 - wrapperRect.top,
          radius: Math.max(nodeRect.width, nodeRect.height) / 2 || radius,
        });
      } else {
        const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect();
        const scaleX = (wrapperRect?.width || MAP_WIDTH) / MAP_WIDTH;
        const scaleY = (wrapperRect?.height || MAP_HEIGHT) / MAP_HEIGHT;
        setTooltipScreenPos({
          x: (node.x * transform.scale + transform.x) * scaleX,
          y: (node.y * transform.scale + transform.y) * scaleY,
          radius: radius * scaleX,
        });
      }
    },
    [transform.scale, transform.x, transform.y]
  );

  const handleNodeLeave = useCallback(() => {
    setHoveredNode(null);
    setTooltipScreenPos(null);
  }, []);

  // Synchronize tooltip screen position during zoom / pan transformations
  useEffect(() => {
    if (!hoveredNode) return;
    const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect();
    const scaleX = (wrapperRect?.width || MAP_WIDTH) / MAP_WIDTH;
    const scaleY = (wrapperRect?.height || MAP_HEIGHT) / MAP_HEIGHT;
    const baseRadius = hoveredNode.nodeKind === "endpoint" ? 4.5 : 7;
    const radius = baseRadius + Math.sqrt(hoveredNode.totalBytes / maxNodeBytes) * 5.5;
    setTooltipScreenPos({
      x: (hoveredNode.x * transform.scale + transform.x) * scaleX,
      y: (hoveredNode.y * transform.scale + transform.y) * scaleY,
      radius: radius * scaleX,
    });
  }, [transform.scale, transform.x, transform.y, hoveredNode, maxNodeBytes]);

  // Compute collision-aware pixel-space tooltip placement
  const tooltipPlacement = useMemo((): TooltipPlacement | null => {
    if (!hoveredNode || !tooltipScreenPos) return null;
    return calculateTooltipPlacement({
      nodeX: tooltipScreenPos.x,
      nodeY: tooltipScreenPos.y,
      nodeRadius: tooltipScreenPos.radius,
      wrapperWidth: wrapperSize.width,
      wrapperHeight: wrapperSize.height,
      tooltipWidth: measuredTooltipSize.width,
      tooltipHeight: measuredTooltipSize.height,
      gap: 10,
      padding: 8,
      preferredY: "top",
      pointerInsetLeft: 16,
      pointerInsetRight: 16,
    });
  }, [hoveredNode, tooltipScreenPos, wrapperSize, measuredTooltipSize]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      if (e.key === "Escape") {
        setHoveredNode(null);
        setTooltipScreenPos(null);
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
        <div
          className="np-geomap-hud__item"
          title={`Geographically resolved public destinations (${coverageStats.resolvedHostsCount}/${coverageStats.publicHostsCount} endpoints, ${coverageStats.physicalCoveragePercent.toFixed(0)}% physical coverage)`}
        >
          <span className="np-geomap-hud__label">RESOLVED ENDPOINTS</span>
          <span className="np-geomap-hud__val">
            {coverageStats.resolvedHostsCount}{" "}
            <span className="np-geomap-hud__sub">
              / {coverageStats.publicHostsCount} ({coverageStats.physicalCoveragePercent.toFixed(0)}%)
            </span>
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
          title={`Geographic Traffic Coverage: ${coverageStats.resolvedBytesPercent.toFixed(0)}% volume (${humanBytes(coverageStats.resolvedBytes)} / ${humanBytes(coverageStats.resolvedBytes + coverageStats.unresolvedBytes)}). Progressive Breakdown: City: ${coverageStats.cityResolvedHostsCount} · Region: ${coverageStats.regionResolvedHostsCount} · Country: ${coverageStats.countryResolvedHostsCount} · Network: ${coverageStats.networkResolvedHostsCount} · Unknown: ${coverageStats.unknownHostsCount}`}
        >
          <span className="np-geomap-hud__label">GEOGRAPHIC COVERAGE</span>
          <span
            className="np-geomap-hud__val"
            style={{
              color:
                coverageStats.physicalCoveragePercent > 80
                  ? "var(--np-good, #46c48d)"
                  : coverageStats.physicalCoveragePercent > 40
                  ? "var(--np-warning, #f2b64d)"
                  : "var(--np-accent, #2fe0d6)",
            }}
          >
            {Math.round(coverageStats.physicalCoveragePercent)}%
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

      {/* 2. Prominent Coverage & Resolution Accounting Banner */}
      {unresolvedPublicHosts.length > 0 && (
        <div className="np-geomap-coverage-banner" role="status" aria-live="polite">
          <div className="np-geomap-coverage-banner__info">
            <span className="np-geomap-coverage-banner__icon" aria-hidden="true">
              ℹ
            </span>
            <span>
              <strong>{unresolvedPublicHosts.length} public endpoint{unresolvedPublicHosts.length > 1 ? "s" : ""}</strong> without physical coordinate resolution ({humanBytes(coverageStats.unresolvedBytes)} · {(100 - coverageStats.resolvedBytesPercent).toFixed(0)}% of observed traffic
              {coverageStats.countryHostsCount > 0 ? ` · ${coverageStats.countryHostsCount} country-level` : ""}
              {coverageStats.networkOnlyPresentationHostsCount > 0 ? ` · ${coverageStats.networkOnlyPresentationHostsCount} network-only` : ""}
              {coverageStats.unknownGeographicHostsCount > 0 ? ` · ${coverageStats.unknownGeographicHostsCount} unknown` : ""}
              {coverageStats.ipv6DeferredHostsCount && coverageStats.ipv6DeferredHostsCount > 0 ? ` · ${coverageStats.ipv6DeferredHostsCount} IPv6 deferred` : ""}
              ). 100% traffic accounted with defensible semantic precision; physical coordinates omitted to prevent false precision.
            </span>
          </div>
          <button
            type="button"
            className="np-btn np-btn--ghost np-btn--sm np-geomap-coverage-banner__btn"
            onClick={() =>
              handleSetSelection({
                kind: "unresolvedGroup",
                title: "Unresolved Public Destinations",
                entityId: UNRESOLVED_PUBLIC_ENTITY_ID,
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
      <div ref={canvasWrapperRef} className="np-geomap-canvas-wrapper" style={{ position: "relative", width: "100%", height: "auto" }}>
        <svg
          ref={svgRef}
          className="np-geomap-svg"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          role="img"
          aria-label={`Global Traffic Map: ${distinctCountries.length} active countries, ${coverageStats.resolvedHostsCount} resolved endpoints, ${coverageStats.unresolvedHostsCount} unresolved endpoints, total volume ${humanBytes(coverageStats.totalBytes)}`}
          tabIndex={0}
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
            <line x1="0" y1="180" x2={MAP_WIDTH} y2="180" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.75" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <line x1="360" y1="0" x2="360" y2={MAP_HEIGHT} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="0.75" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />

            <g className="np-geomap__graticule" stroke="rgba(255, 255, 255, 0.03)" strokeWidth="0.5" strokeDasharray="2 4">
              {graticulePaths.map((p, idx) => (
                <path key={idx} d={p} fill="none" vectorEffect="non-scaling-stroke" />
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
                    vectorEffect="non-scaling-stroke"
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
                    vectorEffect="non-scaling-stroke"
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
                    r={(arc.isSelected ? 3 : 2.2) / transform.scale}
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
                const invScale = 1 / transform.scale;

                return (
                  <g
                    key={node.id}
                    className={`np-geomap__node-group ${isSelected ? "np-geomap__node-group--selected" : ""}`}
                    transform={`translate(${node.x}, ${node.y}) scale(${invScale.toFixed(4)})`}
                    opacity={nodeOpacity}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeClick(node);
                    }}
                    onMouseEnter={(e) => {
                      handleNodeHover(node, radius, e.currentTarget);
                    }}
                    onMouseLeave={() => {
                      handleNodeLeave();
                    }}
                    onFocus={(e) => {
                      handleNodeHover(node, radius, e.currentTarget);
                    }}
                    onBlur={() => {
                      handleNodeLeave();
                    }}
                    aria-describedby={hoveredNode?.id === node.id ? `np-geomap-tooltip-${baseId}` : undefined}
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

                    {/* Greedy Collision-Avoidance Text Label (if placed) */}
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
              <g transform={`translate(${projectGeo(origin.latitude, origin.longitude).join(",")}) scale(${(1 / transform.scale).toFixed(4)})`}>
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

        {/* Cooperative Gesture Scroll-to-Zoom Overlay Hint */}
        <div
          className={`np-geomap-scroll-hint${showScrollHint ? " np-geomap-scroll-hint--visible" : ""}`}
          role="status"
          aria-live="polite"
          aria-hidden={!showScrollHint}
        >
          <span>Use <kbd className="np-geomap-scroll-hint__kbd">{modifierLabel}</kbd> + scroll to zoom map</span>
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

        {/* Floating Hover Tooltip with Collision-Aware Positioning and Dynamic Pointer Tracking */}
        {hoveredNode && tooltipPlacement && (
          <div
            ref={tooltipRef}
            className={`np-geomap-tooltip np-geomap-tooltip--${tooltipPlacement.placementY}`}
            role="tooltip"
            id={`np-geomap-tooltip-${baseId}`}
            aria-hidden="true"
            style={
              {
                left: `${tooltipPlacement.left}px`,
                top: `${tooltipPlacement.top}px`,
                "--pointer-x": `${tooltipPlacement.pointerX}px`,
              } as React.CSSProperties
            }
          >
            <div className="np-geomap-tooltip__arrow" />
            <div className="np-geomap-tooltip__header">
              <span
                className={`np-geomap-tooltip__badge ${
                  hoveredNode.nodeKind === "cluster" ? "np-geomap-tooltip__badge--cluster" : ""
                }`}
              >
                {hoveredNode.nodeKind === "cluster"
                  ? `CLUSTER (${hoveredNode.memberCount || 1})`
                  : hoveredNode.nodeKind === "cityAggregate"
                  ? `CITY (${hoveredNode.memberCount || 1})`
                  : hoveredNode.nodeKind === "countryAggregate"
                  ? `COUNTRY (${hoveredNode.memberCount || 1})`
                  : hoveredNode.nodeKind === "otherResolvedAggregate"
                  ? `AGGREGATE (${hoveredNode.memberCount || 1})`
                  : hoveredNode.locationLevel === "region"
                  ? "CLOUD REGION"
                  : "PUBLIC ENDPOINT"}
              </span>
              {hoveredNode.freshness === "active" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "0.62rem",
                    color: "var(--np-accent, #2fe0d6)",
                    fontFamily: "var(--np-font-mono, monospace)",
                    fontWeight: 700,
                  }}
                >
                  <span
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: "var(--np-accent, #2fe0d6)",
                      boxShadow: "0 0 6px var(--np-accent, #2fe0d6)",
                    }}
                  />
                  ACTIVE
                </span>
              )}
            </div>

            <div className="np-geomap-tooltip__title" title={hoveredNode.label}>
              {hoveredNode.label}
            </div>
            {hoveredNode.subLabel && (
              <div className="np-geomap-tooltip__sub" title={hoveredNode.subLabel}>
                {hoveredNode.subLabel}
              </div>
            )}

            <div className="np-geomap-tooltip__grid">
              <span className="np-geomap-tooltip__key">Traffic:</span>
              <span className="np-geomap-tooltip__val">{humanBytes(hoveredNode.totalBytes)}</span>

              <span className="np-geomap-tooltip__key">Flows:</span>
              <span className="np-geomap-tooltip__val">{hoveredNode.totalFlows}</span>

              <span className="np-geomap-tooltip__key">ASNs:</span>
              <span className="np-geomap-tooltip__val">
                {hoveredNode.asns.length > 0 ? hoveredNode.asns.map((a) => `AS${a}`).join(", ") : "None"}
              </span>

              {hoveredNode.countryCode && (
                <>
                  <span className="np-geomap-tooltip__key">Country:</span>
                  <span className="np-geomap-tooltip__val">{hoveredNode.countryCode}</span>
                </>
              )}
            </div>

            {hoveredNode.precisionDescription && (
              <div className="np-geomap-tooltip__precision">
                {hoveredNode.precisionDescription}
              </div>
            )}

            <div className="np-geomap-tooltip__hint">
              <span>Click or press Enter to inspect in Right Rail</span>
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
          <div className="np-geomap-tray np-geomap-tray--local" role="region" aria-label="Local Network Activity">
            <div className="np-geomap-tray__header">
              <span className="np-geomap-tray__badge np-geomap-tray__badge--accent">
                <span className="np-geomap-tray__badge-dot np-geomap-tray__badge-dot--accent" aria-hidden="true" />
                Local Network ({localLanHosts.length} LAN / Multicast)
              </span>
              <button
                type="button"
                className={`np-geomap-tray__inspect-btn${
                  activeSelection?.kind === "localNetworkGroup" && activeSelection.entityId === LOCAL_LAN_ENTITY_ID
                    ? " np-geomap-tray__inspect-btn--selected"
                    : ""
                }`}
                aria-current={
                  activeSelection?.kind === "localNetworkGroup" && activeSelection.entityId === LOCAL_LAN_ENTITY_ID
                    ? "true"
                    : undefined
                }
                onClick={() =>
                  handleSetSelection({
                    kind: "localNetworkGroup",
                    title: "Local Network Activity",
                    entityId: LOCAL_LAN_ENTITY_ID,
                    category: "lan",
                    memberHosts: localLanHosts,
                  })
                }
              >
                Inspect LAN ({humanBytes(localLanHosts.reduce((s, h) => s + h.bytes, 0))})
              </button>
            </div>
            <div className="np-geomap-tray__chips">
              {localLanHosts.slice(0, 8).map((h) => {
                const isSelected = activeSelection?.kind === "endpoint" && activeSelection.ip === h.ip;
                return (
                  <button
                    key={h.ip}
                    type="button"
                    className={`np-geomap-tray__chip${isSelected ? " np-geomap-tray__chip--selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() =>
                      handleSetSelection({
                        kind: "endpoint",
                        entityId: makeHostEntityId(h.ip),
                        ip: h.ip,
                        host: h,
                      })
                    }
                    title={`Inspect ${h.ip} (${h.classification.categoryLabel})`}
                  >
                    <span className="np-geomap-tray__chip-text">
                      {h.ip} • {h.classification.categoryLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Shared Space / Special Addresses Tray */}
        {specialHosts.length > 0 && (
          <div className="np-geomap-tray np-geomap-tray--special" role="region" aria-label="Special Address Space Activity">
            <div className="np-geomap-tray__header">
              <span className="np-geomap-tray__badge np-geomap-tray__badge--neutral">
                <span className="np-geomap-tray__badge-dot np-geomap-tray__badge-dot--neutral" aria-hidden="true" />
                Shared Space / Special ({specialHosts.length})
              </span>
              <button
                type="button"
                className={`np-geomap-tray__inspect-btn${
                  activeSelection?.kind === "localNetworkGroup" && activeSelection.entityId === SPECIAL_SPACE_ENTITY_ID
                    ? " np-geomap-tray__inspect-btn--selected"
                    : ""
                }`}
                aria-current={
                  activeSelection?.kind === "localNetworkGroup" && activeSelection.entityId === SPECIAL_SPACE_ENTITY_ID
                    ? "true"
                    : undefined
                }
                onClick={() =>
                  handleSetSelection({
                    kind: "localNetworkGroup",
                    title: "Special Address Space Activity",
                    entityId: SPECIAL_SPACE_ENTITY_ID,
                    category: "special",
                    memberHosts: specialHosts,
                  })
                }
              >
                Inspect Special ({humanBytes(specialHosts.reduce((s, h) => s + h.bytes, 0))})
              </button>
            </div>
            <div className="np-geomap-tray__chips">
              {specialHosts.slice(0, 8).map((h) => {
                const isSelected = activeSelection?.kind === "endpoint" && activeSelection.ip === h.ip;
                return (
                  <button
                    key={h.ip}
                    type="button"
                    className={`np-geomap-tray__chip${isSelected ? " np-geomap-tray__chip--selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() =>
                      handleSetSelection({
                        kind: "endpoint",
                        entityId: makeHostEntityId(h.ip),
                        ip: h.ip,
                        host: h,
                      })
                    }
                    title={`Inspect ${h.ip} (${h.classification.categoryLabel})`}
                  >
                    <span className="np-geomap-tray__chip-text">
                      {h.ip} • {h.classification.categoryLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </footer>
    </div>
  );
});
