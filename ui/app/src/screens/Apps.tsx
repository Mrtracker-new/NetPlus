import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Attribution, AttributionConfidence } from "@netpulse/contract";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { query } from "../ipc";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

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
  const { t } = useTranslation(["apps", "common"]);
  const { feed } = useStore();
  const { navigationTarget, clearNavigationTarget } = useEvidenceNavigation();
  const [rows, setRows] = useState<Array<{ flowId: number; attr: Attribution }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const confidenceLabel: Record<AttributionConfidence, string> = {
    high: t("table.confident"),
    low: t("table.tentative"),
    unknown: t("table.unknown_owner"),
  };

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
    return (
      <section className="np-apps" aria-label="Applications loading" aria-busy="true">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", width: "100%" }}>
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
          <Skeleton height={42} width="100%" />
        </div>
      </section>
    );
  }

  const displayedRows = targetFlowId !== null
    ? rows.filter((r) => r.flowId === targetFlowId)
    : rows;

  return (
    <section className="np-apps" aria-label={t("title")}>
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {targetFlowId !== null && (
        <div className="np-filter-banner" style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }} role="status">
          <span>{t("filtered_banner", { flowId: targetFlowId })}</span>
          <button className="np-btn np-btn--secondary" onClick={clearNavigationTarget}>
            {t("common:actions.show_all")}
          </button>
        </div>
      )}
      {displayedRows.length === 0 ? (
        <EmptyState>
          {targetFlowId !== null ? t("empty_filtered", { flowId: targetFlowId }) : t("empty_default")}
        </EmptyState>
      ) : (
        <table>
          <tbody>
            {displayedRows.map(({ flowId, attr }) => (
              <tr key={flowId}>
                <td>{t("table.flow", { id: flowId })}</td>
                <td>{attr.process_name ?? t("table.unknown_owner")}</td>
                <td>{attr.pid !== null ? t("table.pid", { pid: attr.pid }) : "—"}</td>
                <td>{confidenceLabel[attr.confidence]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

