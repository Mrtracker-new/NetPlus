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
// Quadratic Bézier Seam Crossing Mathematics
// ---------------------------------------------------------------------------

/**
 * Solves B_x(t) = seamX for a quadratic Bézier curve defined by x0, x1, x2 where t in [0, 1].
 *
 * B_x(t) = (1-t)^2 * x0 + 2*(1-t)*t * x1 + t^2 * x2
 *        = t^2 * (x0 - 2*x1 + x2) + t * (2*(x1 - x0)) + x0
 * Standard quadratic form: a*t^2 + b*t + c = 0 where c = x0 - seamX.
 *
 * Employs a numerically stable quadratic root formulation (Citardauq / Numerical Recipes)
 * to prevent catastrophic cancellation, with comprehensive handling of linear degeneracies (a ≈ 0),
 * near-tangential discriminants (D ≈ 0), exact endpoint crossings (t = 0, t = 1), and
 * multi-root trajectory ordering (first crossing encountered along t from 0 to 1).
 */
export function solveQuadraticBezierSeamCrossing(
  x0: number,
  x1: number,
  x2: number,
  seamX: number
): number {
  const a = x0 - 2 * x1 + x2;
  const b = 2 * (x1 - x0);
  const c = x0 - seamX;

  const EPS = 1e-12;

  // Linear degenerate case (e.g. collinear in X or control point is arithmetic midpoint)
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) {
      const t = -c / b;
      return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;
    }
    // Entire curve is constant in X
    return 0.5;
  }

  const discriminant = b * b - 4 * a * c;

  // Handle negative discriminant (including near-tangent precision jitter)
  if (discriminant < 0) {
    if (discriminant >= -1e-9) {
      // Near-tangential contact where D is slightly negative due to floating-point error
      const t = -b / (2 * a);
      return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;
    }
    // No real crossing exists
    return 0.5;
  }

  const sqrtD = Math.sqrt(Math.max(0, discriminant));

  // Numerically stable quadratic root formulation (Citardauq / Numerical Recipes)
  // q = -0.5 * (b + sign(b) * sqrt(D)) to prevent catastrophic cancellation
  const signB = b >= 0 ? 1 : -1;
  const q = -0.5 * (b + signB * sqrtD);

  const roots: number[] = [];

  if (Math.abs(q) > EPS) {
    const t1 = q / a;
    const t2 = c / q;
    if (Number.isFinite(t1)) roots.push(t1);
    if (Number.isFinite(t2)) roots.push(t2);
  } else {
    // Both b and D are near zero -> t = 0
    roots.push(0);
  }

  // Filter roots to candidates within [0, 1] with numerical tolerance
  const rootTolerance = 1e-7;
  const validCandidates: number[] = [];

  for (const r of roots) {
    if (r >= -rootTolerance && r <= 1 + rootTolerance) {
      validCandidates.push(Math.max(0, Math.min(1, r)));
    }
  }

  if (validCandidates.length === 0) {
    return 0.5;
  }

  if (validCandidates.length === 1) {
    return validCandidates[0]!;
  }

  // Two valid candidate roots in [0, 1]:
  // Select the root corresponding to the first actual seam crossing along the curve as t moves 0 -> 1.
  validCandidates.sort((r1, r2) => r1 - r2);
  const [firstRoot, secondRoot] = validCandidates as [number, number];

  // If the first root is at t ≈ 0 (curve starts on the seam), check if there's a subsequent interior crossing
  if (firstRoot <= rootTolerance && secondRoot > rootTolerance) {
    return secondRoot;
  }

  return firstRoot;
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

  // Exact Quadratic Bézier Seam Crossing: solve a*t^2 + b*t + c = seamX
  const seamX = crossingDirection === "west" ? 0 : 720;
  const splitT = solveQuadraticBezierSeamCrossing(origin.x, p1.x, p2Ext.x, seamX);

  // Guard against any numerical edge conditions while preserving valid split parameter
  const validSplitT = Number.isFinite(splitT) && splitT > 0 && splitT < 1 ? splitT : 0.5;
  const clampedSplitT = Math.max(0.0001, Math.min(0.9999, validSplitT));

  // Genuine De Casteljau subdivision at exact seam crossing parameter
  const leftControl = lerpPoint(origin, p1, clampedSplitT);
  const rightControl = lerpPoint(p1, p2Ext, clampedSplitT);
  const rawSplit = lerpPoint(leftControl, rightControl, clampedSplitT);

  const splitPoint: Point = {
    x: seamX,
    y: Math.max(0, Math.min(360, rawSplit.y)),
  };

  // Segment 1 (Origin -> Antimeridian boundary at seamX)
  const seg1 = createArcSegment(origin, clampPoint(leftControl), splitPoint);

  // Segment 2 (Wrapped Antimeridian boundary -> Destination, wrapped by ±720)
  const seg2Start: Point = {
    x: wrapX(seamX, crossingDirection),
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
  }
}

