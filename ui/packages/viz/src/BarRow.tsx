import { memo } from "react";
import type { ReactElement } from "react";

export interface BarRowProps {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}

/** A horizontal magnitude bar, baseline-anchored, for ranked breakdowns. */
export const BarRow = memo(function BarRow({
  label,
  value,
  max,
  suffix,
}: BarRowProps): ReactElement {
  const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className="np-viz-bar">
      <span className="np-viz-bar__label" title={label}>
        {label}
      </span>
      <span className="np-viz-bar__track">
        <span className="np-viz-bar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="np-viz-bar__val">{suffix}</span>
    </div>
  );
});

BarRow.displayName = "BarRow";
