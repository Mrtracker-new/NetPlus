// Application Tracking — "which app is using the Internet, and why?" (docs/12).
// Attribution maps a flow to the process that owns it; where the OS gives no
// clear owner, we say "unknown" honestly rather than guess (docs/12 §8), and
// every attribution carries its confidence (docs/12 §5.4).

import { useEffect, useState } from "react";
import type { Attribution, AttributionConfidence } from "@netpulse/contract";
import { EmptyState } from "@netpulse/components";
import { query } from "../ipc";
import { useStore } from "../state/store";

const CONFIDENCE_LABEL: Record<AttributionConfidence, string> = {
  high: "confident",
  low: "tentative",
  unknown: "unknown owner",
};

// Collect the distinct flow ids referenced by the current feed — the flows we
// can ask attribution about.
function flowIdsFromFeed(feed: ReturnType<typeof useStore>["feed"]): number[] {
  const ids = new Set<number>();
  for (const card of feed) {
    for (const e of card.evidence) {
      if (e.kind === "flow") ids.add(e.id);
    }
  }
  return [...ids];
}

export function Apps() {
  const { feed } = useStore();
  const [rows, setRows] = useState<Array<{ flowId: number; attr: Attribution }>>([]);

  useEffect(() => {
    let cancelled = false;
    const flowIds = flowIdsFromFeed(feed);
    Promise.all(
      flowIds.map(async (flowId) => {
        const res = await query({ kind: "attributionOfFlow", flow_id: flowId });
        return res.kind === "attribution" ? { flowId, attr: res.attribution } : null;
      }),
    ).then((results) => {
      if (!cancelled) {
        setRows(results.filter((r): r is { flowId: number; attr: Attribution } => r !== null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [feed]);

  if (rows.length === 0) {
    return <EmptyState>No attributed flows yet.</EmptyState>;
  }

  return (
    <section className="np-apps" aria-label="Applications">
      <table>
        <tbody>
          {rows.map(({ flowId, attr }) => (
            <tr key={flowId}>
              <td>flow #{flowId}</td>
              <td>{attr.process_name ?? "unknown owner"}</td>
              <td>{attr.pid !== null ? `pid ${attr.pid}` : "—"}</td>
              <td>{CONFIDENCE_LABEL[attr.confidence]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
