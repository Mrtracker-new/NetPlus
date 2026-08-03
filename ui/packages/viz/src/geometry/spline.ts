/**
 * Bezier Spline Geometry Utilities for smooth 60fps SVG chart paths.
 */

export interface Point {
  x: number;
  y: number;
}

function line(a: Point, b: Point): { length: number; angle: number } {
  const lengthX = b.x - a.x;
  const lengthY = b.y - a.y;
  return {
    length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)),
    angle: Math.atan2(lengthY, lengthX),
  };
}

function controlPoint(
  current: Point,
  previous?: Point,
  next?: Point,
  reverse?: boolean
): Point {
  const p = previous || current;
  const n = next || current;
  const smoothing = 0.15;
  const l = line(p, n);
  const angle = l.angle + (reverse ? Math.PI : 0);
  const length = l.length * smoothing;
  const x = current.x + Math.cos(angle) * length;
  const y = current.y + Math.sin(angle) * length;
  return { x, y };
}

export function buildBezierPath(points: Point[]): string {
  if (points.length < 2) return "";

  return points.reduce((acc, point, i, a) => {
    if (i === 0) return `M ${point.x.toFixed(2)},${point.y.toFixed(2)}`;

    const prev = a[i - 1] ?? point;
    const prevPrev = a[i - 2] ?? prev;
    const next = a[i + 1] ?? point;

    const cps = controlPoint(prev, prevPrev, point);
    const cpe = controlPoint(point, prev, next, true);

    return `${acc} C ${cps.x.toFixed(2)},${cps.y.toFixed(2)} ${cpe.x.toFixed(
      2
    )},${cpe.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }, "");
}

export function buildBezierAreaPath(points: Point[], height: number): string {
  if (points.length < 2) return "";
  const bezier = buildBezierPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  return `${bezier} L ${last.x.toFixed(2)},${height} L ${first.x.toFixed(
    2
  )},${height} Z`;
}
