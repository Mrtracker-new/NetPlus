import { memo } from "react";
import type { ReactElement } from "react";

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** A tiny inline trend line — no axes, no legend (a single series names itself). */
export const Sparkline = memo(function Sparkline({
  values,
  width = 120,
  height = 28,
  color = "var(--np-accent)",
}: SparklineProps): ReactElement | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="np-viz-spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
});

Sparkline.displayName = "Sparkline";
