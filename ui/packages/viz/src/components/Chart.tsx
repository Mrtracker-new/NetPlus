import React, { memo, useId, useState } from "react";
import { buildBezierPath, buildBezierAreaPath, type Point } from "../geometry/spline";
import { humanBytes } from "../utils";

export interface ChartSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface ChartProps {
  variant: "throughput" | "gains";
  series: ChartSeries[];
  timestamps?: string[];
  height?: number;
  yMax?: number;
  yTicks?: number[];
  peakBadgeText?: string;
  formatValue?: (val: number) => string;
}

export const Chart = memo(function Chart({
  variant,
  series,
  timestamps = ["12 AM", "06 AM", "12 PM", "06 PM", "12 AM"],
  height = 180,
  yMax,
  yTicks,
  peakBadgeText,
  formatValue,
}: ChartProps) {
  const gradientId1 = useId();
  const gradientId2 = useId();
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const primarySeries = series[0];
  if (!primarySeries || primarySeries.data.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--np-text-mute)",
          fontSize: "0.825rem",
        }}
      >
        Waiting for live telemetry samples…
      </div>
    );
  }

  // Calculate dynamic maximum scale with rounded ceiling (e.g., 338 -> 500, 975 -> 1000)
  const rawMax = Math.max(...series.flatMap((s) => s.data), 10);
  const roundedCeil = Math.ceil((rawMax * 1.2) / 100) * 100 || 100;
  const computedMax = yMax && yMax >= rawMax ? yMax : roundedCeil;
  const computedTicks = yTicks || [0, Math.round(computedMax / 2), computedMax];

  // Clean rate unit formatting (KB/s, MB/s) for Y-axis labels
  const defaultFormatTick = (val: number) => {
    if (formatValue) return formatValue(val);
    if (val === 0) return "0";
    if (val >= 1024 * 1024) return `${(val / (1024 * 1024)).toFixed(1)} MB/s`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)} KB/s`;
    return `${Math.round(val)} B/s`;
  };

  const W = 500;
  const H = height;
  const paddingLeft = 75; // Generous left margin so rate labels (e.g. 500 KB/s) never clip
  const paddingBottom = 28;
  const chartW = W - paddingLeft - 15;
  const chartH = H - paddingBottom - 10;

  // Calculate points strictly per series data length
  const seriesPoints = series.map((s) => {
    const sLen = s.data.length;
    return s.data.map((val, idx): Point => ({
      x: paddingLeft + (idx / Math.max(1, sLen - 1)) * chartW,
      y: 10 + chartH - (Math.min(computedMax, Math.max(0, val)) / computedMax) * chartH,
    }));
  });

  // Calculate peak point for gains variant callout badge
  let peakIdx = 0;
  let peakVal = -1;
  primarySeries.data.forEach((v, i) => {
    if (v > peakVal) {
      peakVal = v;
      peakIdx = i;
    }
  });

  const firstSeriesPts = seriesPoints[0] || [];
  const peakPt = firstSeriesPts[peakIdx] || { x: paddingLeft + chartW / 2, y: 10 + chartH / 2 };
  const hoverPt = hoverIndex !== null ? firstSeriesPts[hoverIndex] : null;

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "100%", display: "block" }}
        role="img"
        aria-label={variant === "throughput" ? "Throughput and Lineage time-series spline chart" : "Throughput burst rate gains spline chart"}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId1} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--np-accent, #2fe0d6)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--np-accent, #2fe0d6)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id={gradientId2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--np-accent-2, #7c83f7)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--np-accent-2, #7c83f7)" stopOpacity="0.0" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={paddingLeft - 2} y={5} width={chartW + 4} height={chartH + 10} />
          </clipPath>
        </defs>

        {/* Dynamic Grid Lines & Axis Ticks */}
        {computedTicks.map((tick, i) => {
          const y = 10 + chartH - (tick / computedMax) * chartH;
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={W - 10}
                y2={y}
                stroke="var(--np-border, rgba(255,255,255,0.06))"
                strokeDasharray="4 4"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                fill="var(--np-text-mute)"
                fontSize="10"
                textAnchor="end"
                fontFamily="var(--np-font-mono)"
              >
                {defaultFormatTick(tick)}
              </text>
            </g>
          );
        })}

        {/* Timestamps X Axis */}
        {timestamps.map((ts, idx) => {
          const x = paddingLeft + (idx / Math.max(1, timestamps.length - 1)) * chartW;
          return (
            <text
              key={idx}
              x={x}
              y={H - 6}
              fill="var(--np-text-mute)"
              fontSize="10"
              textAnchor="middle"
              fontFamily="var(--np-font-mono)"
            >
              {ts}
            </text>
          );
        })}

        {/* Render Spline Series & Gradients inside ClipPath */}
        <g clipPath={`url(#${clipId})`}>
          {seriesPoints.map((pts, sIdx) => {
            const pathD = buildBezierPath(pts);
            const areaD = buildBezierAreaPath(pts, 10 + chartH);
            const seriesColor = series[sIdx]?.color;
            const color =
              seriesColor ||
              (sIdx === 0 ? "var(--np-accent, #2fe0d6)" : "var(--np-accent-2, #7c83f7)");
            const gradId = sIdx === 0 ? gradientId1 : gradientId2;

            return (
              <g key={sIdx}>
                <path d={areaD} fill={`url(#${gradId})`} />
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
        </g>

        {/* Hover Target Overlay Columns */}
        {primarySeries.data.map((_, i) => {
          const pt = firstSeriesPts[i];
          if (!pt) return null;
          return (
            <rect
              key={i}
              x={pt.x - chartW / (firstSeriesPts.length * 2)}
              y={10}
              width={chartW / firstSeriesPts.length}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
            />
          );
        })}

        {/* Hover Crosshair & Tooltip Indicator */}
        {hoverPt && hoverIndex !== null && (
          <g>
            <line
              x1={hoverPt.x}
              y1={10}
              x2={hoverPt.x}
              y2={10 + chartH}
              stroke="var(--np-accent, #2fe0d6)"
              strokeDasharray="2 2"
              opacity={0.7}
            />
            {seriesPoints.map((pts, sIdx) => {
              const pt = pts[hoverIndex];
              if (!pt) return null;
              const seriesColor = series[sIdx]?.color;
              return (
                <circle
                  key={sIdx}
                  cx={pt.x}
                  cy={pt.y}
                  r={4}
                  fill={
                    seriesColor ||
                    (sIdx === 0 ? "var(--np-accent, #2fe0d6)" : "var(--np-accent-2, #7c83f7)")
                  }
                  stroke="var(--np-surface-raised, #fff)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}

        {/* Peak Callout Badge Point for Gains Variant */}
        {variant === "gains" && (
          <g>
            <circle
              cx={peakPt.x}
              cy={peakPt.y}
              r={5}
              fill="var(--np-accent, #2fe0d6)"
              stroke="var(--np-surface-raised, #fff)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Tactile Callout Badge for Peak Gains */}
      {variant === "gains" && peakBadgeText && (
        <div
          style={{
            position: "absolute",
            top: `${(peakPt.y / H) * 100 - 18}%`,
            left: `${(peakPt.x / W) * 100}%`,
            transform: "translate(-50%, -100%)",
            background: "var(--np-surface-raised, var(--np-surface-1))",
            border: "1px solid var(--np-border-strong)",
            color: "var(--np-text)",
            padding: "2px 8px",
            borderRadius: "var(--np-radius-pill)",
            fontSize: "10px",
            fontFamily: "var(--np-font-mono)",
            fontWeight: 700,
            whiteSpace: "nowrap",
            boxShadow: "var(--np-neu-control)",
            pointerEvents: "none",
          }}
        >
          {peakBadgeText}
        </div>
      )}
    </div>
  );
});
