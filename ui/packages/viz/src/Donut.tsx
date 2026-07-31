import { memo } from "react";
import type { ReactElement } from "react";
import type { Slice } from "./types";
import { categoricalColor } from "./utils";

export interface DonutProps {
  slices: Slice[];
  size?: number;
  centerLabel?: string;
  format?: (n: number) => string;
}

/** A categorical donut (e.g. protocol mix by bytes) with a legend + direct labels.
 *  Identity is carried by the legend swatch, never color alone. */
export const Donut = memo(function Donut({
  slices,
  size = 132,
  centerLabel,
  format = (n: number) => String(n),
}: DonutProps): ReactElement {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const stroke = size * 0.16;
  const radius = r - stroke / 2 - 1;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const ranked = [...slices].sort((a, b) => b.value - a.value);

  return (
    <div className="np-viz-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown">
        <g transform={`rotate(-90 ${r} ${r})`}>
          {total > 0 &&
            ranked.map((s, i) => {
              const frac = s.value / total;
              const dash = frac * circ;
              const seg = (
                <circle
                  key={s.label}
                  cx={r}
                  cy={r}
                  r={radius}
                  fill="none"
                  stroke={categoricalColor(i)}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(dash - 2, 0)} ${circ - Math.max(dash - 2, 0)}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return seg;
            })}
          {total === 0 && (
            <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--np-surface-3)" strokeWidth={stroke} />
          )}
        </g>
        <text x={r} y={r - 2} textAnchor="middle" className="np-viz-donut__total">
          {format(total)}
        </text>
        {centerLabel && (
          <text x={r} y={r + 14} textAnchor="middle" className="np-viz-donut__sub">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="np-viz-legend">
        {ranked.map((s, i) => (
          <li key={s.label}>
            <span className="np-viz-legend__dot" style={{ background: categoricalColor(i) }} />
            <span className="np-viz-legend__label">{s.label}</span>
            <span className="np-viz-legend__val">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

Donut.displayName = "Donut";
