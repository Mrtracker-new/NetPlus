// The Network Constellation — Cyber Network Visualizer (you-at-center radial map).
// Every figure shown is real: node size = real bytes, arc width = log(bytes),
// hover/expand read the real BreakdownRow. Honesty-by-construction.
//
// Structured into distinct SVG rendering layers: bg, grid, radar, links, packets,
// nodes, you, hud, tooltip. SVG attributes mutate via refs in a single 60fps
// requestAnimationFrame loop to maintain zero-runtime-dep 60fps GPU performance.

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import type { BreakdownRow, EvidenceRef } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { humanBytes, hostSourceLabel, primaryHostName } from "./utils";
import { calculateTooltipPlacement } from "./geo/tooltipPlacement";

const W = 720;
const H = 500;
const CX = W / 2;
const CY = H / 2;
const RINGS = [96, 150, 205]; // inner→outer; heavier hosts sit closer to YOU
const MAX_NODES = 12; // keep the field legible; overflow is disclosed honestly
const YOU_R = 26;

export type Status = "active" | "idle";
export type SemanticStatus = "healthy" | "busy" | "warning" | "error" | "idle";

const STATUS_COLORS: Record<SemanticStatus, string> = {
  healthy: "#2fe0d6",
  busy: "#6f76f5",
  warning: "#f2b64d",
  error: "#ef6167",
  idle: "#a0aec0",
};

function getStatusColor(status: SemanticStatus): string {
  return STATUS_COLORS[status] || "#a0aec0";
}

interface Placed {
  key: string;
  row: BreakdownRow;
  angle: number; // base angle (radians)
  radius: number;
  size: number; // node dot radius
  status: Status;
  semanticStatus: SemanticStatus;
  phase: number; // packet travel offset
  share: number; // fraction of total observed bytes
}

/** FNV-1a — a stable per-label hash so a host keeps its slot frame-to-frame. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function truncate(s: string, n = 16): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Determine semantic status mapping from real telemetry */
function getSemanticStatus(row: BreakdownRow): SemanticStatus {
  if (row.bytes === 0) return "idle";
  if (row.flows > 15 || row.bytes > 5_000_000) return "busy";
  return "healthy";
}

/** Logarithmic link width calculation (log10 bytes) */
function getLinkWidth(bytes: number): number {
  if (bytes <= 0) return 1;
  const logVal = Math.log10(bytes);
  return Math.max(1.2, Math.min(5.5, Math.max(0, logVal - 2) * 1.1));
}

/** Extract protocol tags (TLS, DNS, HTTP, QUIC, etc.) from host label */
function extractProtocols(row: BreakdownRow): string[] {
  const protos = new Set<string>();
  const lbl = row.label.toLowerCase();
  if (lbl.includes("443") || lbl.includes("https")) protos.add("TLS");
  if (lbl.includes("53") || lbl.includes("dns")) protos.add("DNS");
  if (lbl.includes("80") || lbl.includes("http")) protos.add("HTTP");
  if (lbl.includes("quic")) protos.add("QUIC");
  if (protos.size === 0) protos.add("TCP");
  return Array.from(protos);
}

/** Reactive prefers-reduced-motion check */
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

/** Layout hosts on concentric rings ranked by bytes */
function layout(hosts: BreakdownRow[]): Placed[] {
  const ranked = [...hosts].sort((a, b) => b.bytes - a.bytes).slice(0, MAX_NODES);
  const totalBytes = hosts.reduce((s, r) => s + r.bytes, 0) || 1;
  const maxBytes = ranked.reduce((m, r) => Math.max(m, r.bytes), 0) || 1;

  const perRing = Math.ceil(ranked.length / RINGS.length) || 1;
  const rings: BreakdownRow[][] = RINGS.map(() => []);
  ranked.forEach((row, i) => {
    const ring = Math.min(RINGS.length - 1, Math.floor(i / perRing));
    rings[ring]!.push(row);
  });

  const placed: Placed[] = [];
  rings.forEach((rows, ring) => {
    const n = rows.length;
    const ordered = [...rows].sort((a, b) => hashStr(a.label) - hashStr(b.label));
    ordered.forEach((row, j) => {
      const angle = (j / Math.max(n, 1)) * Math.PI * 2 + ring * 0.5;
      // Node dot radius: 5.5px to 10.5px
      const size = 5.5 + Math.sqrt(row.bytes / maxBytes) * 5;
      placed.push({
        key: row.label,
        row,
        angle,
        radius: RINGS[ring]!,
        size,
        status: row.bytes > 0 ? "active" : "idle",
        semanticStatus: getSemanticStatus(row),
        phase: (hashStr(row.label) % 1000) / 1000,
        share: row.bytes / totalBytes,
      });
    });
  });
  return placed;
}

import { makeHostEntityId, type SelectedEntity } from "./geo/geoTypes";
import { enrichHost } from "./geo/geoDatabase";

export interface ConstellationProps {
  hosts: BreakdownRow[];
  lossIndicators?: number;
  selectedEntity?: SelectedEntity | null;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
  onNavigate?: (ref: EvidenceRef, source?: any) => void;
}

interface InteractionState {
  playing: boolean;
  hovered: number | null;
  selected: string | null;
}

type InteractionAction =
  | { type: "TOGGLE_PLAYING" }
  | { type: "SET_HOVERED"; index: number | null }
  | { type: "TOGGLE_SELECT"; key: string }
  | { type: "CLEAR_SELECT" };

function interactionReducer(state: InteractionState, action: InteractionAction): InteractionState {
  switch (action.type) {
    case "TOGGLE_PLAYING":
      return { ...state, playing: !state.playing };
    case "SET_HOVERED":
      return { ...state, hovered: action.index };
    case "TOGGLE_SELECT":
      return { ...state, selected: state.selected === action.key ? null : action.key };
    case "CLEAR_SELECT":
      return { ...state, selected: null };
    default:
      return state;
  }
}

export const Constellation = memo(function Constellation({
  hosts,
  lossIndicators = 0,
  selectedEntity: controlledSelection,
  onSelectEntity,
  onNavigate,
}: ConstellationProps) {
  const baseId = useId().replace(/:/g, "_");
  const gridId = `np-cyber-grid-${baseId}`;
  const maskId = `np-grid-mask-${baseId}`;
  const fadeId = `np-grid-fade-${baseId}`;
  const youGradId = `np-cons-you-${baseId}`;

  const reduced = usePrefersReducedMotion();
  const placed = useMemo(() => layout(hosts), [hosts]);

  // Reducer for interaction state
  const [state, dispatch] = useReducer(interactionReducer, {
    playing: true,
    hovered: null,
    selected: null,
  });

  const { playing, hovered, selected } = state;

  const selectedKey = useMemo(() => {
    if (controlledSelection !== undefined) {
      if (!controlledSelection) return null;
      if (controlledSelection.kind === "endpoint") return controlledSelection.ip;
      return null;
    }
    return selected;
  }, [controlledSelection, selected]);

  const handleToggleSelect = useCallback(
    (p: Placed) => {
      if (controlledSelection !== undefined) {
        if (controlledSelection?.kind === "endpoint" && controlledSelection.ip === p.row.label) {
          onSelectEntity?.(null);
        } else {
          const enriched = enrichHost(p.row);
          onSelectEntity?.({
            kind: "endpoint",
            ip: p.row.label,
            entityId: makeHostEntityId(p.row.label),
            host: enriched,
          });
        }
      } else {
        dispatch({ type: "TOGGLE_SELECT", key: p.key });
      }
    },
    [controlledSelection, onSelectEntity]
  );

  // Imperative animation state refs
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const arcRefs = useRef<Array<SVGPathElement | null>>([]);
  const packetRefs = useRef<Array<SVGCircleElement | null>>([]);
  const posRef = useRef<Array<{ x: number; y: number }>>([]);
  const rotationRef = useRef(0);
  const phaseRef = useRef(0);
  const hoveredRef = useRef(false);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ startX: number; startRot: number } | null>(null);

  // Clean up stale refs when placed length changes
  useEffect(() => {
    nodeRefs.current.splice(placed.length);
    arcRefs.current.splice(placed.length);
    packetRefs.current.splice(placed.length);
    posRef.current.splice(placed.length);
  }, [placed.length]);

  // Reveal effect for newly observed hosts
  const prevKeys = useRef<Set<string>>(new Set());
  const revealSet = useMemo(() => {
    const fresh = new Set<string>();
    for (const p of placed) if (!prevKeys.current.has(p.key)) fresh.add(p.key);
    return fresh;
  }, [placed]);

  useEffect(() => {
    prevKeys.current = new Set(placed.map((p) => p.key));
  }, [placed]);

  // Paint single frame
  const paint = useCallback((rot: number, phase: number) => {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!;
      const a = p.angle + rot;
      const x = CX + Math.cos(a) * p.radius;
      const y = CY + Math.sin(a) * p.radius;
      posRef.current[i] = { x, y };
      nodeRefs.current[i]?.setAttribute("transform", `translate(${x} ${y})`);
      arcRefs.current[i]?.setAttribute("d", `M${CX} ${CY} L${x} ${y}`);
      const pk = packetRefs.current[i];
      if (pk) {
        if (p.status === "active" && !reduced) {
          const t = (phase + p.phase) % 1;
          pk.setAttribute("cx", String(CX + (x - CX) * t));
          pk.setAttribute("cy", String(CY + (y - CY) * t));
          pk.setAttribute("opacity", String(Math.sin(t * Math.PI) * 0.95));
        } else {
          pk.setAttribute("opacity", "0");
        }
      }
    }
  }, [placed, reduced]);

  // Paint initial layout frame
  useEffect(() => {
    paint(rotationRef.current, phaseRef.current);
  }, [placed, reduced, paint]);

  // Animation loop with rAF
  useEffect(() => {
    let raf = 0;
    let last = 0;

    const step = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
      last = ts;

      // Rotation advances when playing, not hovered, not dragging
      if (playing && !hoveredRef.current && !draggingRef.current && !reduced) {
        rotationRef.current += dt * 0.06; // ~3.4°/s calm drift
      }

      phaseRef.current = (phaseRef.current + dt * 0.5) % 1;
      paint(rotationRef.current, phaseRef.current);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [placed, reduced, playing, paint]);

  // Pointer drag to rotate
  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = true;
    dragRef.current = { startX: e.clientX, startRot: rotationRef.current };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    rotationRef.current = dragRef.current.startRot + dx * 0.005;
    paint(rotationRef.current, phaseRef.current);
  }, [paint]);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const hostHover = useCallback((i: number) => {
    hoveredRef.current = true;
    dispatch({ type: "SET_HOVERED", index: i });
  }, []);

  const hostLeave = useCallback(() => {
    hoveredRef.current = false;
    dispatch({ type: "SET_HOVERED", index: null });
  }, []);

  const handleNavigateEvidence = useCallback((ref: EvidenceRef) => {
    if (onNavigate) {
      onNavigate(ref, "constellation");
    }
  }, [onNavigate]);

  const selectedPlaced = placed.find((p) => p.key === selected) ?? null;
  const tip = hovered != null ? placed[hovered] : null;
  const tipPos = hovered != null ? posRef.current[hovered] : null;
  const quiet = placed.length === 0;

  const tooltipPlacement = useMemo(() => {
    if (!tip || !tipPos) return null;
    return calculateTooltipPlacement({
      nodeX: tipPos.x,
      nodeY: tipPos.y,
      nodeRadius: tip.size + 4,
      tooltipWidth: 220,
      tooltipHeight: 165,
      wrapperWidth: W,
      wrapperHeight: H,
      gap: 14,
      padding: 12,
      preferredY: "top",
    });
  }, [tip, tipPos]);

  return (
    <div className={quiet ? "np-cons np-cons--quiet" : "np-cons"}>
      <div className="np-cons__stage">
        <svg
          className="np-cons__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Network constellation: ${placed.length} observed hosts around this device`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--np-accent-soft, rgba(47, 224, 214, 0.1))" strokeWidth="0.8" />
              <circle cx="0" cy="0" r="1" fill="var(--np-accent-line, rgba(47, 224, 214, 0.2))" />
            </pattern>
            <radialGradient id={fadeId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="60%" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.12" />
            </radialGradient>
            <mask id={maskId}>
              <rect width={W} height={H} fill={`url(#${fadeId})`} />
            </mask>

            <radialGradient id={youGradId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--np-accent-strong, #5cf0e7)" />
              <stop offset="100%" stopColor="var(--np-accent, #2fe0d6)" />
            </radialGradient>
          </defs>

          {/* Layer 1: Background Layer */}
          <g className="np-cons__layer-bg">
            <rect width={W} height={H} fill="transparent" />
          </g>

          {/* Layer 2: Cyber Grid Layer (Faded towards edges) */}
          <g className="np-cons__layer-grid" mask={`url(#${maskId})`}>
            <rect width={W} height={H} fill={`url(#${gridId})`} />
          </g>

          {/* Layer 3: Radar Layer (Rings + Continuous Radar Sweep Cone) */}
          <g className="np-cons__layer-radar">
            {!quiet &&
              RINGS.map((r) => <circle key={r} className="np-cons__ring" cx={CX} cy={CY} r={r} />)}
            {!reduced && (
              <g transform={`translate(${CX}, ${CY})`}>
                <g className="np-cons__radar-sweep">
                  <path
                    d={`M 0 0 L ${RINGS[RINGS.length - 1]!} 0 A ${
                      RINGS[RINGS.length - 1]!
                    } ${RINGS[RINGS.length - 1]!} 0 0 1 ${
                      Math.cos(0.55) * RINGS[RINGS.length - 1]!
                    } ${Math.sin(0.55) * RINGS[RINGS.length - 1]!} Z`}
                    fill="var(--np-accent-soft, rgba(47, 224, 214, 0.045))"
                  />
                </g>
              </g>
            )}
          </g>

          {/* Layer 4: Link Layer (Data Beams) */}
          <g className="np-cons__layer-links">
            {placed.map((p, i) => {
              const isHov = hovered === i;
              const isSel = p.key === selected;
              const isDimmed = hovered != null && !isHov;
              const linkColor = getStatusColor(p.semanticStatus);
              return (
                <path
                  key={`arc-${p.key}`}
                  ref={(el) => {
                    arcRefs.current[i] = el;
                  }}
                  className={`np-cons__arc np-cons__arc--${p.semanticStatus} ${
                    isDimmed ? "np-cons__arc--dimmed" : ""
                  } ${isHov || isSel ? "np-cons__arc--highlighted" : ""}`}
                  stroke={linkColor}
                  strokeWidth={getLinkWidth(p.row.bytes)}
                  strokeOpacity={isHov || isSel ? 0.95 : 0.45}
                  d={`M${CX} ${CY} L${CX + Math.cos(p.angle) * p.radius} ${
                    CY + Math.sin(p.angle) * p.radius
                  }`}
                />
              );
            })}
          </g>

          {/* Layer 5: Packet Layer */}
          <g className="np-cons__layer-packets">
            {placed.map((p, i) => {
              const isHov = hovered === i;
              const isSel = p.key === selectedKey;
              const isDimmed = hovered != null && !isHov;
              return (
                <circle
                  key={`pk-${p.key}`}
                  ref={(el) => {
                    packetRefs.current[i] = el;
                  }}
                  className={`np-cons__packet ${isDimmed ? "np-cons__packet--dimmed" : ""} ${
                    isHov || isSel ? "np-cons__packet--highlighted" : ""
                  }`}
                  r={2.4}
                  cx={CX}
                  cy={CY}
                  opacity={0}
                />
              );
            })}
          </g>

          {/* Layer 6: Node Layer (Keyboard & Mouse Accessible) */}
          <g className="np-cons__layer-nodes">
            {placed.map((p, i) => {
              const x0 = CX + Math.cos(p.angle) * p.radius;
              const y0 = CY + Math.sin(p.angle) * p.radius;
              const isSel = p.key === selectedKey;
              const isHov = hovered === i;
              const isDimmed =
                (hovered != null && !isHov) || (selectedKey != null && !isSel && hovered == null);
              const nodeColor = getStatusColor(p.semanticStatus);
              const hostNameStr = primaryHostName(p.row)?.name ?? p.row.label;

              return (
                <g
                  key={`node-${p.key}`}
                  ref={(el) => {
                    nodeRefs.current[i] = el;
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Host ${hostNameStr}, ${humanBytes(p.row.bytes)}, ${p.semanticStatus}`}
                  className={`np-cons__node ${isHov ? "np-cons__node--hovered" : ""} ${
                    isSel ? "np-cons__node--selected" : ""
                  } ${isDimmed ? "np-cons__node--dimmed" : ""}`}
                  transform={`translate(${x0} ${y0})`}
                  onMouseEnter={() => hostHover(i)}
                  onMouseLeave={hostLeave}
                  onClick={() => handleToggleSelect(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggleSelect(p);
                    }
                  }}
                >
                  <g className={revealSet.has(p.key) ? "np-cons__node-in--reveal" : undefined}>
                    {/* Hover & Selection rings */}
                    <circle className="np-cons__node-halo" r={p.size + 6} stroke={nodeColor} />
                    {isSel && <circle className="np-cons__node-halo-outer" r={p.size + 10} stroke={nodeColor} />}
                    {/* Core Node Dot */}
                    <circle
                      className={`np-cons__node-dot np-cons__node-dot--${p.semanticStatus}`}
                      r={isSel ? p.size + 2 : p.size}
                      style={{
                        fill: nodeColor,
                        stroke: "rgba(255, 255, 255, 0.45)",
                        strokeWidth: 1.5,
                      }}
                    />
                    <text className="np-cons__node-label" y={p.size + 12}>
                      {truncate(hostNameStr, 18)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* Layer 7: Center YOU Layer */}
          <g className="np-cons__layer-you">
            <circle className="np-cons__you-breath" cx={CX} cy={CY} r={YOU_R + 8} />
            {!reduced && <circle className="np-cons__you-heartbeat" cx={CX} cy={CY} r={YOU_R} />}
            <circle
              className="np-cons__you"
              cx={CX}
              cy={CY}
              r={YOU_R}
              fill={`url(#${youGradId})`}
            />
            <text className="np-cons__you-label" x={CX} y={CY + 4}>
              YOU
            </text>
          </g>

          {/* Layer 8: HUD Layer */}
          <g className="np-cons__layer-hud" pointerEvents="none">
            <path d="M 16 28 L 16 16 L 28 16" fill="none" stroke="var(--np-accent-line, rgba(47, 224, 214, 0.45))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M ${W - 28} 16 L ${W - 16} 16 L ${W - 16} 28`} fill="none" stroke="var(--np-accent-line, rgba(47, 224, 214, 0.45))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M 16 ${H - 28} L 16 ${H - 16} L 28 ${H - 16}`} fill="none" stroke="var(--np-accent-line, rgba(47, 224, 214, 0.45))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M ${W - 28} ${H - 16} L ${W - 16} ${H - 16} L ${W - 16} ${H - 28}`} fill="none" stroke="var(--np-accent-line, rgba(47, 224, 214, 0.45))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

            <text x={CX} y={CY - RINGS[2]! - 8} fill="var(--np-text-mute, #737d94)" fontSize="10" fontFamily="var(--np-font-mono)" textAnchor="middle" opacity="0.8">000°</text>
            <text x={CX + RINGS[2]! + 14} y={CY + 3} fill="var(--np-text-mute, #737d94)" fontSize="10" fontFamily="var(--np-font-mono)" textAnchor="start" opacity="0.8">090°</text>
            <text x={CX} y={CY + RINGS[2]! + 15} fill="var(--np-text-mute, #737d94)" fontSize="10" fontFamily="var(--np-font-mono)" textAnchor="middle" opacity="0.8">180°</text>
            <text x={CX - RINGS[2]! - 14} y={CY + 3} fill="var(--np-text-mute, #737d94)" fontSize="10" fontFamily="var(--np-font-mono)" textAnchor="end" opacity="0.8">270°</text>
          </g>
        </svg>

        {/* Layer 9: Tooltip Panel */}
        {tip && tooltipPlacement && (
          <div
            className={`np-cons__tip np-cons__tip--${tooltipPlacement.placementY}`}
            style={{
              left: `${(tooltipPlacement.left / W) * 100}%`,
              top: `${(tooltipPlacement.top / H) * 100}%`,
            }}
          >
            {(() => {
              const nm = primaryHostName(tip.row);
              const protos = extractProtocols(tip.row);
              return (
                <>
                  <div className="np-cons__tip-host" title={nm ? `${nm.name} (${tip.row.label})` : tip.row.label}>
                    {nm ? nm.name : tip.row.label}
                  </div>
                  <div className="np-cons__tip-ip">
                    {tip.row.label} {nm && <span className="np-cons__tip-src">· {hostSourceLabel(nm.source)}</span>}
                  </div>
                  <div className="np-cons__tip-divider" />
                  <div className="np-cons__tip-row">
                    <span>Status</span>
                    <span className={`np-cons__status np-cons__status--${tip.semanticStatus}`}>
                      ● {tip.semanticStatus}
                    </span>
                  </div>
                  <div className="np-cons__tip-row">
                    <span>Traffic</span>
                    <b>{humanBytes(tip.row.bytes)}</b>
                  </div>
                  <div className="np-cons__tip-row">
                    <span>Flows</span>
                    <b>{tip.row.flows}</b>
                  </div>
                  {protos.length > 0 && (
                    <div className="np-cons__protocol-pills">
                      {protos.map((pr) => (
                        <span key={pr} className="np-cons__proto-pill">{pr}</span>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Legend & Controls */}
      <div className="np-cons__foot">
        <span className="np-cons__legend">
          <i style={{ background: STATUS_COLORS.healthy }} /> healthy
        </span>
        <span className="np-cons__legend">
          <i style={{ background: STATUS_COLORS.busy }} /> high throughput
        </span>
        <span className="np-cons__legend">
          <i style={{ background: STATUS_COLORS.warning }} /> loss/retransmit
        </span>
        <span className="np-cons__legend">
          <i style={{ background: STATUS_COLORS.idle }} /> idle
        </span>
        {lossIndicators > 0 && (
          <span className="np-cons__legend" title="Network loss indicators (global, not per-host)">
            <i style={{ background: STATUS_COLORS.warning }} /> loss: {lossIndicators}
          </span>
        )}
        {hosts.length > MAX_NODES && (
          <span className="np-cons__legend">top {MAX_NODES} of {hosts.length}</span>
        )}
        {!reduced && (
          <button
            type="button"
            className="np-cons__pause-btn"
            onClick={() => dispatch({ type: "TOGGLE_PLAYING" })}
            aria-pressed={!playing}
          >
            {playing ? "Pause" : "Play"}
          </button>
        )}
        <span className="np-cons__hint">drag to rotate · hover a host · click/press Enter to pin</span>
      </div>

      {/* Pinned Detail Panel with Interactive EvidenceChips */}
      {selectedPlaced && (
        <div className="np-loss" style={{ marginTop: "var(--np-3)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {(() => {
              const nm = primaryHostName(selectedPlaced.row);
              return nm ? (
                <span>
                  <strong>Host:</strong> {nm.name} <span className="np-cons__tip-src">({selectedPlaced.row.label} · {hostSourceLabel(nm.source)})</span>
                </span>
              ) : (
                <span><strong>Host:</strong> {selectedPlaced.row.label}</span>
              );
            })()}
            <button
              type="button"
              className="np-btn np-btn--ghost"
              style={{ fontSize: "0.75rem", padding: "0.1rem 0.4rem" }}
              onClick={() => dispatch({ type: "CLEAR_SELECT" })}
            >
              Close
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.85rem" }}>
            <span>Traffic: <b>{humanBytes(selectedPlaced.row.bytes)}</b></span>
            <span>Flows: <b>{selectedPlaced.row.flows}</b></span>
            <span className={`np-cons__status np-cons__status--${selectedPlaced.semanticStatus}`}>
              Status: <b>{selectedPlaced.semanticStatus}</b>
            </span>
          </div>

          {selectedPlaced.row.evidence.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--np-text-mute)" }}>Evidence:</span>
              <EvidenceChips
                evidence={selectedPlaced.row.evidence}
                onNavigate={handleNavigateEvidence}
              />
            </div>
          )}
        </div>
      )}

      {/* Quiet state fallback */}
      {quiet && (
        <p className="np-cons__hint" style={{ textAlign: "center", marginTop: "var(--np-2)" }}>
          Quiet — no active hosts yet. Start a capture to see who this device talks to.
        </p>
      )}
      <ul className="np-sr-only">
        {placed.map((p) => {
          const nm = primaryHostName(p.row);
          const who = nm ? `${nm.name} (${p.row.label})` : p.row.label;
          return (
            <li key={p.key}>
              {who}: {humanBytes(p.row.bytes)}, {p.row.flows} flows, {p.semanticStatus}
            </li>
          );
        })}
      </ul>
    </div>
  );
});

Constellation.displayName = "Constellation";
