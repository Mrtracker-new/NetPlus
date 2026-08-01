import { memo, useId } from "react";
import type { ReactElement } from "react";

export interface AreaChartProps {
  values: number[];
  height?: number;
  format?: (n: number) => string;
  label?: string;
}

/** A single-series area over time (e.g. throughput). One axis; the max is labeled
 *  directly rather than drawing a full scale. Uses React useId() for scoped SVG defs. */
export const AreaChart = memo(function AreaChart({
  values,
  height = 96,
  format = (n: number) => String(Math.round(n)),
  label,
}: AreaChartProps): ReactElement {
  const fillId = useId();
  const W = 100; // viewBox units; SVG scales to container width

  if (values.length < 2) {
    return <div className="np-viz-empty">Not enough samples yet…</div>;
  }

  const max = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const y = (v: number) => height - (v / max) * (height - 6) - 2;
  const line = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,${height} ${line} ${W},${height}`;

  return (
    <figure className="np-viz-area" aria-label={label ? `${label}, peak ${format(max)}` : "Throughput area chart"}>
      {label && (
        <figcaption className="np-viz-cap">
          {label} <span className="np-viz-peak">peak {format(max)}</span>
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="np-viz-area__svg">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--np-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--np-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${fillId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--np-accent)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
});

AreaChart.displayName = "AreaChart";
