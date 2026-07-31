import { Fragment, memo } from "react";
import type { ReactElement } from "react";
import type { FanoutNode, JourneyStage, StageKind } from "@netpulse/contract";
import { humanBytes } from "./utils";

export interface JourneyFlowProps {
  stages: JourneyStage[];
  fanout: FanoutNode[];
}

// A short glyph per stage — shape carries meaning alongside color (never
// color-alone). Kept ASCII/simple so it renders without a font dependency.
const STAGE_GLYPH: Record<StageKind, string> = {
  navigation: "⌖",
  dns_resolution: "?",
  connection: "⇄",
  encryption: "🔒",
  request: "↧",
  fan_out: "⋔",
  completion: "✓",
};

/** The signature "what happened after I typed the URL" diagram (docs/14): the
 *  page-load stages as connected nodes with packets traveling the links, then the
 *  CDN/organization fan-out — one visit, many companies made visible (docs/14 §5). */
export const JourneyFlow = memo(function JourneyFlow({
  stages,
  fanout,
}: JourneyFlowProps): ReactElement {
  const topFanout = [...fanout].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  return (
    <div className="np-jflow">
      <div className="np-jflow__track">
        {stages.map((s, i) => (
          <Fragment key={`${s.kind}-${i}`}>
            <div className="np-jflow__node" title={s.narration}>
              <span className="np-jflow__glyph" aria-hidden="true">
                {STAGE_GLYPH[s.kind] ?? "•"}
              </span>
              <span className="np-jflow__label">{s.title}</span>
            </div>
            {i < stages.length - 1 && (
              <div className="np-jflow__link" aria-hidden="true">
                <span className="np-jflow__packet" style={{ animationDelay: `${i * 0.35}s` }} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {topFanout.length > 0 && (
        <div className="np-jflow__fanout" aria-label="Servers contacted">
          <div className="np-jflow__hub" aria-hidden="true">
            {stages.length}
          </div>
          <ul className="np-jflow__dests">
            {topFanout.map((n) => (
              <li className="np-jflow__dest" key={n.label}>
                <span className="np-jflow__dest-label" title={n.label}>
                  {n.label}
                </span>
                <span className="np-jflow__dest-meta">
                  {n.flows} conn · {humanBytes(n.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

JourneyFlow.displayName = "JourneyFlow";
