import { useEffect, useState } from "react";
import type { Attribution, AttributionConfidence } from "@netpulse/contract";
import { EmptyState, Notice, Spinner } from "@netpulse/components";
import { query } from "../ipc";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

const CONFIDENCE_LABEL: Record<AttributionConfidence, string> = {
  high: "confident",
  low: "tentative",
  unknown: "unknown owner",
};

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
  const { navigationTarget, clearNavigationTarget } = useEvidenceNavigation();
  const [rows, setRows] = useState<Array<{ flowId: number; attr: Attribution }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const targetFlowId = navigationTarget?.screen === "apps" ? navigationTarget.flowId : null;

  useEffect(() => {
    let cancelled = false;
    const flowIdsSet = new Set(flowIdsFromFeed(feed));
    if (targetFlowId !== null) {
      flowIdsSet.add(targetFlowId);
    }
    const flowIds = [...flowIdsSet];

    Promise.all(
      flowIds.map(async (flowId) => {
        const res = await query({ kind: "attributionOfFlow", flow_id: flowId });
        return res.kind === "attribution" ? { flowId, attr: res.attribution } : null;
      }),
    )
      .then((results) => {
        if (!cancelled) {
          setRows(results.filter((r): r is { flowId: number; attr: Attribution } => r !== null));
        }
      })
      .catch((e) => {
        if (!cancelled) setNotice(toErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [feed, targetFlowId]);

  if (!loaded) {
    return <Spinner />;
  }

  const displayedRows = targetFlowId !== null
    ? rows.filter((r) => r.flowId === targetFlowId)
    : rows;

  return (
    <section className="np-apps" aria-label="Applications">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {targetFlowId !== null && (
        <div className="np-filter-banner" style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }} role="status">
          <span>Filtered to flow #{targetFlowId}</span>
          <button className="np-btn np-btn--secondary" onClick={clearNavigationTarget}>
            Show all flows
          </button>
        </div>
      )}
      {displayedRows.length === 0 ? (
        <EmptyState>
          {targetFlowId !== null ? `No flow found for id #${targetFlowId}` : "No attributed flows yet."}
        </EmptyState>
      ) : (
        <table>
          <tbody>
            {displayedRows.map(({ flowId, attr }) => (
              <tr key={flowId}>
                <td>flow #{flowId}</td>
                <td>{attr.process_name ?? "unknown owner"}</td>
                <td>{attr.pid !== null ? `pid ${attr.pid}` : "—"}</td>
                <td>{CONFIDENCE_LABEL[attr.confidence]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

