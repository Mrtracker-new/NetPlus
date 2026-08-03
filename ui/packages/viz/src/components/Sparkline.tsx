import React, { memo } from "react";
import { buildBezierPath } from "../geometry/spline";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}

export const Sparkline = memo(function Sparkline({
  data,
  width = 60,
  height = 18,
  color = "var(--np-accent, #00f2fe)",
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((val - min) / range) * (height - 4) - 2,
  }));

  const d = buildBezierPath(points);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
