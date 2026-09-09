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
  const validValues = series
    .flatMap((s) => s.data)
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
  const rawMax = validValues.reduce((max, v) => (v > max ? v : max), 10);
  const roundedCeil = Math.ceil((rawMax * 1.2) / 100) * 100 || 100;
  const computedMax = yMax && yMax >= rawMax ? yMax : roundedCeil;
  const computedTicks = yTicks || [0, Math.round(computedMax / 2), computedMax];

  // Clean rate unit formatting (KB/s, MB/s, GB/s) for tooltips and Y-axis labels
  const formatRate = (val: number) => {
    if (typeof val !== "number" || isNaN(val)) return "0 B/s";
    if (formatValue) return formatValue(val);
    if (val <= 0) return "0 B/s";
    return `${humanBytes(val * 1024)}/s`;
  };

  const defaultFormatTick = (val: number) => {
    if (typeof val !== "number" || isNaN(val)) return "0";
    if (formatValue) return formatValue(val);
    if (val === 0) return "0";
    return formatRate(val);
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
    return s.data.map((val, idx): Point => {
      const cleanVal = typeof val === "number" && !isNaN(val) ? Math.max(0, val) : 0;
      return {
        x: paddingLeft + (idx / Math.max(1, sLen - 1)) * chartW,
        y: 10 + chartH - (Math.min(computedMax, cleanVal) / computedMax) * chartH,
      };
    });
  });

  // Calculate peak point for gains variant callout badge
  let peakIdx = 0;
  let peakVal = -1;
  primarySeries.data.forEach((v, i) => {
    const cleanV = typeof v === "number" && !isNaN(v) ? v : 0;
    if (cleanV > peakVal) {
      peakVal = cleanV;
      peakIdx = i;
    }
  });

  const firstSeriesPts = seriesPoints[0] || [];
  const peakPt = firstSeriesPts[peakIdx] || { x: paddingLeft + chartW / 2, y: 10 + chartH / 2 };

  // Guard against stale hoverIndex if series length changes dynamically
  const activeHoverIndex =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < primarySeries.data.length
      ? hoverIndex
      : null;
  const hoverPt = activeHoverIndex !== null ? firstSeriesPts[activeHoverIndex] : null;

  // Active tooltip metrics & dynamic positioning
  const numPoints = primarySeries.data.length;
  const fraction = activeHoverIndex !== null ? activeHoverIndex / Math.max(1, numPoints - 1) : 0;
  const tsIdx =
    timestamps && timestamps.length > 0
      ? Math.min(timestamps.length - 1, Math.max(0, Math.round(fraction * (timestamps.length - 1))))
      : -1;
  const timeOffset = tsIdx >= 0 && timestamps ? timestamps[tsIdx] : "";

  const anchorY = hoverPt ? hoverPt.y : 0;
  const leftPct = hoverPt ? (hoverPt.x / W) * 100 : 0;
  const transformX = leftPct < 25 ? "0%" : leftPct > 75 ? "-100%" : "-50%";
  const transformDirection = anchorY < 75 ? "below" : "above";
  const transformY = transformDirection === "below" ? "10px" : "calc(-100% - 10px)";

  return (
    <div
      style={{ position: "relative", width: "100%", height }}
      onMouseLeave={() => setHoverIndex(null)}
    >
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
          const step = chartW / Math.max(1, firstSeriesPts.length - 1);
          return (
            <rect
              key={i}
              data-testid={`chart-hover-col-${i}`}
              x={pt.x - step / 2}
              y={10}
              width={step}
              height={chartH}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseMove={() => setHoverIndex(i)}
            />
          );
        })}

        {/* Hover Crosshair & Tooltip Indicator */}
        {hoverPt && activeHoverIndex !== null && (
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
              const pt = pts[activeHoverIndex];
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
        {variant === "gains" && peakVal > 0 && (
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

      {/* Floating Hover Tooltip */}
      {hoverPt && activeHoverIndex !== null && (
        <div
          role="tooltip"
          className="np-chart-tooltip"
          data-testid="chart-tooltip"
          style={{
            position: "absolute",
            top: `${(anchorY / H) * 100}%`,
            left: `${leftPct}%`,
            transform: `translate(${transformX}, ${transformY})`,
            background: "var(--np-surface-raised, rgba(15, 23, 42, 0.94))",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--np-border-strong, rgba(255, 255, 255, 0.15))",
            borderRadius: "var(--np-radius-md, 8px)",
            padding: "8px 12px",
            boxShadow: "var(--np-neu-floating, 0 10px 25px rgba(0, 0, 0, 0.5))",
            pointerEvents: "none",
            zIndex: 10,
            minWidth: "120px",
            whiteSpace: "nowrap",
          }}
        >
          {timeOffset && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                borderBottom: "1px solid var(--np-border, rgba(255, 255, 255, 0.08))",
                paddingBottom: "4px",
                marginBottom: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--np-text-mute, #64748b)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}
              >
                Time Offset
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--np-text, #fff)",
                  fontFamily: "var(--np-font-mono, monospace)",
                  fontWeight: 600,
                }}
              >
                {timeOffset}
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {series.map((s, sIdx) => {
              const val = s.data[activeHoverIndex] ?? 0;
              const color =
                s.color ||
                (sIdx === 0 ? "var(--np-accent, #2fe0d6)" : "var(--np-accent-2, #7c83f7)");
              return (
                <div
                  key={sIdx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    fontSize: "11px",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "var(--np-text-dim, #94a3b8)" }}>{s.name}</span>
                  </div>
                  <span
                    style={{
                      color: "var(--np-text, #fff)",
                      fontFamily: "var(--np-font-mono, monospace)",
                      fontWeight: 600,
                    }}
                  >
                    {formatRate(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tactile Callout Badge for Peak Gains */}
      {variant === "gains" && peakVal > 0 && peakBadgeText && (
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
