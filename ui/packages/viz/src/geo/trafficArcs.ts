import type { TelemetryFreshness } from "./geoTypes";

export const EPSILON = 1e-9;
export const LUT_INTERVALS = 16;
export const LUT_SAMPLES = 17; // 16 intervals -> 17 samples [0..16]

export interface Point {
  x: number;
  y: number;
}

export type AntimeridianDirection = "none" | "west" | "east";

export interface ArcSegment {
  start: Point;
  control: Point;
  end: Point;
  length: number;
  lut: number[]; // exactly 17 entries: normalized cumulative length in [0, 1]
}

export interface ArcGeometry {
  d: string;
  segments: ArcSegment[];
  origin: Point;
  destination: Point;
  crossingDirection: AntimeridianDirection;
  crossesAntimeridian: boolean;
  shortestDeltaLng: number;
  splitT?: number;
  particleSplitT?: number;
  totalLength: number;
}

export interface ArcPathModel {
  id: string;
  geometry: ArcGeometry;
  strokeWidth: number;
  opacity: number;
  freshness: TelemetryFreshness;
  hasParticles: boolean;
  deltaBytes: number;
  // Backward compatibility accessors
  d: string;
  crossesAntimeridian: boolean;
  shortestDeltaLng: number;
  splitT?: number;
  particleSplitT?: number;
  segments: ArcSegment[];
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  midX: number;
  midY: number;
  effectiveDx?: number;
}

export interface ArcBezierOptions {
  originLng?: number;
  destLng?: number;
}

export type ArcBezierResult = ArcGeometry;

// ---------------------------------------------------------------------------
// Normalization & Geometry Helpers
// ---------------------------------------------------------------------------

export function normalizeLng(lng: number): number {
  const mod = ((lng + 180) % 360 + 360) % 360 - 180;
  return mod === -180 ? 180 : mod;
}

export function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b;
}

export function lerpPoint(p0: Point, p1: Point, t: number): Point {
  return {
    x: (1 - t) * p0.x + t * p1.x,
    y: (1 - t) * p0.y + t * p1.y,
  };
}

export function clampPoint(p: Point): Point {
  return {
    x: Math.max(0, Math.min(720, p.x)),
    y: Math.max(0, Math.min(360, p.y)),
  };
}

export function wrapX(x: number, direction: AntimeridianDirection): number {
  if (direction === "west") return x + 720;
  if (direction === "east") return x - 720;
  return x;
}

// ---------------------------------------------------------------------------
// Arc-Length Numerical Integration (5-Point Gauss-Legendre Quadrature)
// ---------------------------------------------------------------------------

const GAUSS_WEIGHTS = [
  0.5688888888888889,
  0.4786286704993665,
  0.4786286704993665,
  0.2369268850561891,
  0.2369268850561891,
];

const GAUSS_NODES = [
  0.0,
  0.5384693101056831,
  -0.5384693101056831,
  0.9061798459386640,
  -0.9061798459386640,
];

function quadraticBezierSpeed(p0: Point, p1: Point, p2: Point, t: number): number {
  const ax = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const ay = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
  return Math.sqrt(ax * ax + ay * ay);
}

export function integrateQuadraticBezierLength(p0: Point, p1: Point, p2: Point, tStart: number, tEnd: number): number {
  if (tStart === tEnd) return 0;
  const half = (tEnd - tStart) / 2;
  const mid = (tStart + tEnd) / 2;
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const t = mid + half * GAUSS_NODES[i]!;
    sum += GAUSS_WEIGHTS[i]! * quadraticBezierSpeed(p0, p1, p2, t);
  }
  return half * sum;
}

export function createArcSegment(start: Point, control: Point, end: Point): ArcSegment {
  const totalLength = integrateQuadraticBezierLength(start, control, end, 0, 1);
  const lut: number[] = new Array(LUT_SAMPLES);
  lut[0] = 0.0;

  if (totalLength <= 0 || !Number.isFinite(totalLength)) {
    for (let i = 1; i <= LUT_INTERVALS; i++) {
      lut[i] = i / LUT_INTERVALS;
    }
    return {
      start,
      control,
      end,
      length: 0,
      lut,
    };
  }

  let cumLength = 0;
  for (let i = 1; i <= LUT_INTERVALS; i++) {
    const t0 = (i - 1) / LUT_INTERVALS;
    const t1 = i / LUT_INTERVALS;
    cumLength += integrateQuadraticBezierLength(start, control, end, t0, t1);
    lut[i] = Math.min(1.0, cumLength / totalLength);
  }
  lut[LUT_INTERVALS] = 1.0;

  return {
    start,
    control,
    end,
    length: totalLength,
    lut,
  };
}

export function invertArcLength(segment: ArcSegment, s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  const lut = segment.lut;

  // Bounded binary search over 17 samples (effectively O(1))
  let low = 0;
  let high = LUT_INTERVALS;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lut[mid]! <= s) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const s0 = lut[low]!;
  const s1 = lut[high]!;
  const ds = s1 - s0;
  const frac = ds > 1e-9 ? (s - s0) / ds : 0;
  const t = (low + frac) / LUT_INTERVALS;
  return Math.max(0, Math.min(1, t));
}

// ---------------------------------------------------------------------------
// SVG Serialization (Segments is the Single Source of Truth)
// ---------------------------------------------------------------------------

export function serializeSegmentToSvgD(segment: ArcSegment): string {
  return `M${segment.start.x.toFixed(1)} ${segment.start.y.toFixed(1)} Q${segment.control.x.toFixed(1)} ${segment.control.y.toFixed(1)} ${segment.end.x.toFixed(1)} ${segment.end.y.toFixed(1)}`;
}

export function serializeArcGeometryToSvgD(segments: ArcSegment[]): string {
  return segments.map(serializeSegmentToSvgD).join(" ");
}

// ---------------------------------------------------------------------------
// Visual Policy Decoupled from Seam Mathematics
// ---------------------------------------------------------------------------

export function calculateArcControlPoint(p0: Point, p2Ext: Point): Point {
  const distX = p2Ext.x - p0.x;
  const distY = p2Ext.y - p0.y;
  const dist = Math.sqrt(distX * distX + distY * distY);
  const midX = (p0.x + p2Ext.x) / 2;
  const midY = (p0.y + p2Ext.y) / 2;
  const curveFactor = Math.min(60, Math.max(18, dist * 0.22));
  const cy = Math.max(15, Math.min(345, midY - curveFactor));
  return { x: midX, y: cy };
}

// ---------------------------------------------------------------------------
// Core Arc Bézier Engine
// ---------------------------------------------------------------------------

export function calculateArcBezier(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  options?: ArcBezierOptions
): ArcGeometry {
  const origin: Point = clampPoint({ x: ox, y: oy });
  const destination: Point = clampPoint({ x: dx, y: dy });

  let rawDeltaLng = 0;
  let shortestDeltaLng = 0;
  let crossingDirection: AntimeridianDirection = "none";
  let crossesAntimeridian = false;

  if (options?.originLng !== undefined && options?.destLng !== undefined) {
    const normOrigin = normalizeLng(options.originLng);
    const normDest = normalizeLng(options.destLng);
    rawDeltaLng = normDest - normOrigin;

    if (Math.abs(Math.abs(rawDeltaLng) - 180) <= EPSILON) {
      // Deterministic 180° tie-break: direct non-crossing path
      shortestDeltaLng = rawDeltaLng;
      crossingDirection = "none";
      crossesAntimeridian = false;
    } else if (rawDeltaLng > 180) {
      shortestDeltaLng = rawDeltaLng - 360;
      crossingDirection = "west";
      crossesAntimeridian = true;
    } else if (rawDeltaLng < -180) {
      shortestDeltaLng = rawDeltaLng + 360;
      crossingDirection = "east";
      crossesAntimeridian = true;
    } else {
      shortestDeltaLng = rawDeltaLng;
      crossingDirection = "none";
      crossesAntimeridian = false;
    }
  }

  // Non-crossing path
  if (!crossesAntimeridian || crossingDirection === "none") {
    const control = calculateArcControlPoint(origin, destination);
    const seg = createArcSegment(origin, clampPoint(control), destination);
    const d = serializeArcGeometryToSvgD([seg]);
    return {
      d,
      segments: [seg],
      origin,
      destination,
      crossingDirection: "none",
      crossesAntimeridian: false,
      shortestDeltaLng,
      totalLength: seg.length,
    };
  }

  // Crossing path: extended destination in virtual coordinate space
  const extendedDestinationX =
    crossingDirection === "west"
      ? destination.x - 720
      : destination.x + 720;
  const p2Ext: Point = { x: extendedDestinationX, y: destination.y };

  const p1 = calculateArcControlPoint(origin, p2Ext);

  // Linear X de Casteljau split parameter (mathematically guaranteed 0 < splitT < 1 for crossing routes)
  const splitT =
    crossingDirection === "west"
      ? origin.x / (origin.x - p2Ext.x)
      : (720 - origin.x) / (p2Ext.x - origin.x);

  // Guard against any numerical edge conditions while preserving valid split parameter
  const validSplitT = Number.isFinite(splitT) && splitT > 0 && splitT < 1 ? splitT : 0.5;
  const clampedSplitT = Math.max(0.0001, Math.min(0.9999, validSplitT));

  const leftControl = lerpPoint(origin, p1, clampedSplitT);
  const rightControl = lerpPoint(p1, p2Ext, clampedSplitT);
  const rawSplit = lerpPoint(leftControl, rightControl, clampedSplitT);

  const splitPoint: Point = {
    x: crossingDirection === "west" ? 0 : 720,
    y: Math.max(0, Math.min(360, rawSplit.y)),
  };

  // Segment 1 (Origin -> Antimeridian boundary)
  const seg1 = createArcSegment(origin, clampPoint(leftControl), splitPoint);

  // Segment 2 (Wrapped Antimeridian boundary -> Destination)
  const seg2Start: Point = {
    x: crossingDirection === "west" ? 720 : 0,
    y: splitPoint.y,
  };
  const seg2Control: Point = clampPoint({
    x: wrapX(rightControl.x, crossingDirection),
    y: rightControl.y,
  });
  const seg2 = createArcSegment(seg2Start, seg2Control, destination);

  const totalLength = seg1.length + seg2.length;
  const particleSplitT = totalLength > 0 ? seg1.length / totalLength : 0.5;

  const segments = [seg1, seg2];
  const d = serializeArcGeometryToSvgD(segments);

  return {
    d,
    segments,
    origin,
    destination,
    crossingDirection,
    crossesAntimeridian: true,
    shortestDeltaLng,
    splitT: validSplitT,
    particleSplitT,
    totalLength,
  };
}

// ---------------------------------------------------------------------------
// Particle Sampling (Zero-Allocation sampleArcInto for 60fps Animation)
// ---------------------------------------------------------------------------

export function sampleSegmentPointInto(segment: ArcSegment, t: number, out: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const ut2 = 2 * u * t;

  out.x = uu * segment.start.x + ut2 * segment.control.x + tt * segment.end.x;
  out.y = uu * segment.start.y + ut2 * segment.control.y + tt * segment.end.y;
  return out;
}

export function sampleArcInto(geometry: ArcGeometry, u: number, outPoint: Point): Point {
  const clampedU = Math.max(0, Math.min(1, u));

  if (clampedU <= 0) {
    outPoint.x = geometry.origin.x;
    outPoint.y = geometry.origin.y;
    return outPoint;
  }
  if (clampedU >= 1) {
    outPoint.x = geometry.destination.x;
    outPoint.y = geometry.destination.y;
    return outPoint;
  }

  const segments = geometry.segments;
  if (segments.length === 1 || !geometry.crossesAntimeridian || geometry.particleSplitT === undefined) {
    const seg = segments[0]!;
    const localT = invertArcLength(seg, clampedU);
    return sampleSegmentPointInto(seg, localT, outPoint);
  }

  const pSplit = geometry.particleSplitT;
  const s1 = segments[0]!;
  const s2 = segments[1]!;

  if (clampedU <= pSplit) {
    const sNorm = pSplit > 0 ? clampedU / pSplit : 0;
    const localT = invertArcLength(s1, sNorm);
    return sampleSegmentPointInto(s1, localT, outPoint);
  } else {
    const sNorm = pSplit < 1 ? (clampedU - pSplit) / (1 - pSplit) : 1;
    const localT = invertArcLength(s2, sNorm);
    return sampleSegmentPointInto(s2, localT, outPoint);
  }
}

/** Convenience allocating wrapper (use sampleArcInto for 60fps loops) */
export function sampleArc(geometry: ArcGeometry, u: number): Point {
  const p: Point = { x: 0, y: 0 };
  return sampleArcInto(geometry, u, p);
}

// ---------------------------------------------------------------------------
// Telemetry Styling Helpers
// ---------------------------------------------------------------------------

export function getArcStrokeWidth(bytes: number): number {
  if (bytes <= 0) return 1.0;
  const logVal = Math.log10(bytes);
  return Math.max(1.2, Math.min(4.5, Math.max(0, logVal - 2) * 0.9));
}

export function getArcOpacity(freshness: TelemetryFreshness): number {
  switch (freshness) {
    case "active":
      return 0.85;
    case "recent":
      return 0.55;
    case "stale":
      return 0.25;
    case "expired":
      return 0.1;
  }
}

/** Legacy quadratic bezier sample helper */
export function sampleQuadraticBezier(
  ox: number,
  oy: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  t: number
): [number, number] {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const ut2 = 2 * u * t;

  let x = uu * ox + ut2 * cx + tt * dx;
  let y = uu * oy + ut2 * cy + tt * dy;

  // Viewport clamp for legacy callers
  x = ((x % 720) + 720) % 720;
  return [x, y];
}
