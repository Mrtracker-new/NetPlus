import { memo } from "react";
import type { ReactElement } from "react";

export interface SparklineProps {
  values?: number[];
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** A tiny inline trend line — no axes, no legend (a single series names itself). */
export const Sparkline = memo(function Sparkline({
  values,
  data,
  width = 120,
  height = 28,
  color = "var(--np-accent)",
}: SparklineProps): ReactElement | null {
  const chartValues = values || data || [];
  if (chartValues.length < 2) return null;

  // Add Y padding so strokes do not clip against SVG boundaries on max/min zero bounds
  const paddingY = 3;
  const usableHeight = height - paddingY * 2;
  const max = Math.max(...chartValues, 1);
  const min = Math.min(...chartValues, 0);
  const span = max - min || 1;
  const step = width / (chartValues.length - 1);

  const pts = chartValues
    .map((v, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - paddingY - ((v - min) / span) * usableHeight).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="np-viz-spark"
      aria-hidden="true"
    >
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});

Sparkline.displayName = "Sparkline";
