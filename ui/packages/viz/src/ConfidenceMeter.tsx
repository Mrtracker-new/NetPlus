import { memo } from "react";
import type { ReactElement } from "react";

export interface ConfidenceMeterProps {
  percent: number;
  qualitative?: string;
}

/** A calibrated-confidence meter. Neutral accent — confidence is not
 *  severity, so it never uses an alarm color; the qualitative word carries meaning
 *  alongside the number. */
export const ConfidenceMeter = memo(function ConfidenceMeter({
  percent,
  qualitative,
}: ConfidenceMeterProps): ReactElement {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="np-viz-conf" role="meter" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <span className="np-viz-conf__track">
        <span className="np-viz-conf__fill" style={{ width: `${p}%` }} />
      </span>
      <span className="np-viz-conf__num">
        {qualitative && <span className="np-viz-conf__qualitative">{qualitative}</span>}
        {qualitative && <span className="np-viz-conf__sep"> · </span>}
        <span className="np-viz-conf__pct">{p}%</span>
      </span>
    </div>
  );
});

ConfidenceMeter.displayName = "ConfidenceMeter";
