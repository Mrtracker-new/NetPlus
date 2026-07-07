// The Network Constellation — the Dashboard centerpiece (a you-at-center radial
// map of the hosts NetPulse has *actually observed*). Every figure it shows is
// real: node size = real bytes, arc presence = real flows, hover/expand read the
// real BreakdownRow. There is no geography, no latency, no country and no
// "attack origin" here because the engine has none of those (docs honesty-by-
// construction, contract generated.ts) — inventing them would be a lie.
//
// It is hand-rolled SVG (no three.js / globe.gl) to keep the zero-runtime-dep
// rule, matching the existing viz primitives. A single requestAnimationFrame loop
// mutates SVG attributes through refs so the ambient rotation and traveling
// packets run at 60fps without re-rendering React. Rotation is honestly gated:
// it stops under prefers-reduced-motion, while hovering (so a tooltip stays put),
// while dragging, and when the tab is hidden.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BreakdownRow } from "@netpulse/contract";
import { humanBytes } from "./index";

// viewBox geometry (SVG scales to container width; aspect is fixed so the HTML
// tooltip can map viewBox coords → percentage of the stage box precisely).
const W = 720;
const H = 500;
const CX = W / 2;
const CY = H / 2;
const RINGS = [96, 150, 205]; // inner→outer; heavier hosts sit closer to YOU
const MAX_NODES = 12; // keep the field legible; overflow is disclosed honestly
const YOU_R = 30;

type Status = "active" | "idle";

interface Placed {
  key: string;
  row: BreakdownRow;
  angle: number; // base angle (radians), before ambient rotation
  radius: number;
  size: number; // node dot radius
  status: Status;
  phase: number; // packet travel offset so arcs don't pulse in lockstep
  share: number; // fraction of total observed bytes (real)
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

/** Reactive prefers-reduced-motion — gates the JS animation loop (the global CSS
 *  rule can't stop requestAnimationFrame). */
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

/** Lay hosts out on concentric rings: ranked by bytes (heavier = inner ring),
 *  evenly spaced within each ring, staggered per ring. Deterministic given the
 *  set of hosts, so the field is stable between snapshots. */
function layout(hosts: BreakdownRow[]): Placed[] {
  const ranked = [...hosts].sort((a, b) => b.bytes - a.bytes).slice(0, MAX_NODES);
  const totalBytes = hosts.reduce((s, r) => s + r.bytes, 0) || 1;
  const maxBytes = ranked.reduce((m, r) => Math.max(m, r.bytes), 0) || 1;

  // Bucket ranks into rings: inner ring fills first (the heaviest talkers).
  const perRing = Math.ceil(ranked.length / RINGS.length) || 1;
  const rings: BreakdownRow[][] = RINGS.map(() => []);
  ranked.forEach((row, i) => {
    const ring = Math.min(RINGS.length - 1, Math.floor(i / perRing));
    rings[ring]!.push(row);
  });

  const placed: Placed[] = [];
  rings.forEach((rows, ring) => {
    const n = rows.length;
    // Order within a ring by hash so spacing is stable but not rank-jittery.
    const ordered = [...rows].sort((a, b) => hashStr(a.label) - hashStr(b.label));
    ordered.forEach((row, j) => {
      const angle = (j / Math.max(n, 1)) * Math.PI * 2 + ring * 0.5;
      const size = 7 + Math.sqrt(row.bytes / maxBytes) * 13;
      placed.push({
        key: row.label,
        row,
        angle,
        radius: RINGS[ring]!,
        size,
        status: row.bytes > 0 ? "active" : "idle",
        phase: (hashStr(row.label) % 1000) / 1000,
        share: row.bytes / totalBytes,
      });
    });
  });
  return placed;
}

export function Constellation({
  hosts,
  lossIndicators = 0,
}: {
  hosts: BreakdownRow[];
  lossIndicators?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const placed = useMemo(() => layout(hosts), [hosts]);

  // Imperative animation state (refs → no re-render on each frame).
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const arcRefs = useRef<Array<SVGPathElement | null>>([]);
  const packetRefs = useRef<Array<SVGCircleElement | null>>([]);
  const posRef = useRef<Array<{ x: number; y: number }>>([]);
  const rotationRef = useRef(0);
  const phaseRef = useRef(0);
  const hoveredRef = useRef(false);
  const draggingRef = useRef(false);
  const dragRef = useRef<{ startX: number; startRot: number } | null>(null);

  // React state (only what needs to paint declaratively).
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Reveal: hosts new since the last snapshot animate outward once.
  const prevKeys = useRef<Set<string>>(new Set());
  const revealSet = useMemo(() => {
    const fresh = new Set<string>();
    for (const p of placed) if (!prevKeys.current.has(p.key)) fresh.add(p.key);
    return fresh;
  }, [placed]);
  useEffect(() => {
    prevKeys.current = new Set(placed.map((p) => p.key));
  }, [placed]);

  // Write one node/arc/packet to the DOM at a given global rotation.
  function paint(rot: number, phase: number) {
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
          pk.setAttribute("opacity", String(Math.sin(t * Math.PI) * 0.9));
        } else {
          pk.setAttribute("opacity", "0");
        }
      }
    }
  }

  // Paint once synchronously on layout change (correct first frame, and the only
  // paint under reduced-motion).
  useEffect(() => {
    paint(rotationRef.current, phaseRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, reduced]);

  // The animation loop. Rotation advances only when playing, not hovered, not
  // dragging; packets advance whenever motion is allowed.
  useEffect(() => {
    if (reduced) return; // static field; CSS also freezes decorative animations
    let raf = 0;
    let last = 0;
    const step = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
      last = ts;
      if (playing && !hoveredRef.current && !draggingRef.current) {
        rotationRef.current += dt * 0.06; // ~3.4°/s — a calm drift
      }
      phaseRef.current = (phaseRef.current + dt * 0.5) % 1;
      paint(rotationRef.current, phaseRef.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, reduced, playing]);

  // Pointer-drag to rotate the field (no external lib).
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = true;
    dragRef.current = { startX: e.clientX, startRot: rotationRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    rotationRef.current = dragRef.current.startRot + dx * 0.005;
    if (reduced) paint(rotationRef.current, phaseRef.current);
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = false;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  function host(i: number) {
    hoveredRef.current = true;
    setHovered(i);
  }
  function unhost() {
    hoveredRef.current = false;
    setHovered(null);
  }

  const selectedPlaced = placed.find((p) => p.key === selected) ?? null;
  const tip = hovered != null ? placed[hovered] : null;
  const tipPos = hovered != null ? posRef.current[hovered] : null;

  // Empty / calm-idle: a lone YOU pulse — never a void (docs/09 §11).
  const quiet = placed.length === 0;

  return (
    <div className="np-cons">
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
            <radialGradient id="np-cons-you" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--np-accent-strong)" />
              <stop offset="100%" stopColor="var(--np-accent)" />
            </radialGradient>
          </defs>

          {/* Orbit guide rings. */}
          {!quiet &&
            RINGS.map((r) => <circle key={r} className="np-cons__ring" cx={CX} cy={CY} r={r} />)}

          {/* Arcs first (under nodes). Straight radial links from YOU to each host;
              thickness encodes real flow count. */}
          {placed.map((p, i) => (
            <path
              key={`arc-${p.key}`}
              ref={(el) => {
                arcRefs.current[i] = el;
              }}
              className={`np-cons__arc${p.status === "idle" ? " np-cons__arc--idle" : ""}`}
              strokeWidth={Math.min(1 + p.row.flows * 0.4, 4)}
              d={`M${CX} ${CY} L${CX + Math.cos(p.angle) * p.radius} ${
                CY + Math.sin(p.angle) * p.radius
              }`}
            />
          ))}

          {/* Traveling packets (the live signal). */}
          {placed.map((p, i) => (
            <circle
              key={`pk-${p.key}`}
              ref={(el) => {
                packetRefs.current[i] = el;
              }}
              className="np-cons__packet"
              r={2.6}
              cx={CX}
              cy={CY}
              opacity={0}
            />
          ))}

          {/* Center YOU node with an outward ping. */}
          <g>
            <circle className="np-cons__you-ring" cx={CX} cy={CY} r={YOU_R} />
            <circle className="np-cons__you" cx={CX} cy={CY} r={YOU_R} />
            <text className="np-cons__you-label" x={CX} y={CY + 4}>
              YOU
            </text>
          </g>

          {/* Host nodes. Positioned via transform in the loop; labels stay upright
              because the group only translates (never rotates). */}
          {placed.map((p, i) => {
            const x0 = CX + Math.cos(p.angle) * p.radius;
            const y0 = CY + Math.sin(p.angle) * p.radius;
            const isSel = p.key === selected;
            return (
              <g
                key={`node-${p.key}`}
                ref={(el) => {
                  nodeRefs.current[i] = el;
                }}
                className="np-cons__node"
                transform={`translate(${x0} ${y0})`}
                onMouseEnter={() => host(i)}
                onMouseLeave={unhost}
                onClick={() => setSelected(isSel ? null : p.key)}
              >
                {/* Inner group carries the CSS scale reveal. It MUST be separate
                    from the outer group: the outer group is positioned via the SVG
                    `transform` *attribute* (translate), and a CSS `transform`
                    animation on the same element would override that and collapse
                    the node to the SVG origin. */}
                <g className={revealSet.has(p.key) ? "np-cons__node-in--reveal" : undefined}>
                  <circle
                    className={`np-cons__node-dot np-cons__node-dot--${p.status}`}
                    r={isSel ? p.size + 3 : p.size}
                  />
                  <text className="np-cons__node-label" y={p.size + 13}>
                    {truncate(p.row.label)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Glass tooltip — real figures only. */}
        {tip && tipPos && (
          <div
            className="np-cons__tip"
            style={{ left: `${(tipPos.x / W) * 100}%`, top: `${(tipPos.y / H) * 100}%` }}
          >
            <div className="np-cons__tip-host">{tip.row.label}</div>
            <div className="np-cons__tip-row">
              <span>Traffic</span>
              <b>{humanBytes(tip.row.bytes)}</b>
            </div>
            <div className="np-cons__tip-row">
              <span>Flows</span>
              <b>{tip.row.flows}</b>
            </div>
            <div className="np-cons__tip-row">
              <span
                className={`np-cons__status np-cons__status--${tip.status}`}
              >
                {tip.status === "active" ? "● active" : "○ idle"}
              </span>
              <span>{(tip.share * 100).toFixed(tip.share < 0.01 ? 2 : 0)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Legend + honest controls. */}
      <div className="np-cons__foot">
        <span className="np-cons__legend">
          <i style={{ background: "var(--np-accent)" }} /> active host
        </span>
        <span className="np-cons__legend">
          <i style={{ background: "var(--np-neutral)" }} /> idle
        </span>
        {lossIndicators > 0 && (
          <span className="np-cons__legend" title="Network loss indicators (global, not per-host)">
            <i style={{ background: "var(--np-notable)" }} /> network loss: {lossIndicators}
          </span>
        )}
        {hosts.length > MAX_NODES && (
          <span className="np-cons__legend">showing top {MAX_NODES} of {hosts.length}</span>
        )}
        {!reduced && (
          <button
            className="np-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setPlaying((v) => !v)}
            aria-pressed={!playing}
          >
            {playing ? "Pause" : "Play"}
          </button>
        )}
        <span className="np-cons__hint">drag to rotate · hover a host · click to pin</span>
      </div>

      {/* Pinned detail — real evidence-backed figures, no invented sub-nodes. */}
      {selectedPlaced && (
        <div className="np-loss" style={{ marginTop: "var(--np-3)" }}>
          <span>host: {selectedPlaced.row.label}</span>
          <span>{humanBytes(selectedPlaced.row.bytes)}</span>
          <span>{selectedPlaced.row.flows} flows</span>
          <span>{selectedPlaced.row.evidence.length} evidence</span>
          <span className={`np-cons__status np-cons__status--${selectedPlaced.status}`}>
            {selectedPlaced.status}
          </span>
        </div>
      )}

      {/* Quiet state copy + screen-reader parity. */}
      {quiet && (
        <p className="np-cons__hint" style={{ textAlign: "center", marginTop: "var(--np-2)" }}>
          Quiet — no active hosts yet. Start a capture to see who this device talks to.
        </p>
      )}
      <ul className="np-sr-only">
        {placed.map((p) => (
          <li key={p.key}>
            {p.row.label}: {humanBytes(p.row.bytes)}, {p.row.flows} flows, {p.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
