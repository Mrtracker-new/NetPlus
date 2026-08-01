// Website Journey — the flagship "what happened after I typed the URL?" view
// (docs/14). It reconstructs the complete page-load story from the session's
// causal graph and narrates it stage by stage (Navigation → DNS → Connection →
// Encryption → Request → Fan-out → Completion, docs/14 §4), then shows the
// CDN/organization fan-out that makes the modern web's reach visible (docs/14
// §5). Each stage carries its evidence (docs/02 §6.3); technical detail is
// disclosed progressively (docs/14 §7) — the engine already gated it by depth.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PageJourney } from "@netpulse/contract";
import { EmptyState, Notice, Skeleton, EvidenceChips } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";
import { useStore } from "../state/store";
import { JourneyFlow, humanBytes } from "@netpulse/viz";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The most recent session in the feed — the journey we open by default.
function latestSessionId(feed: ReturnType<typeof useStore>["feed"]): number | null {
  for (const card of feed) {
    for (const e of card.evidence) {
      if (e.kind === "session") return e.id;
    }
  }
  return null;
}

export function Journey() {
  const { t } = useTranslation(["journey", "common"]);
  const { feed } = useStore();
  const { depth } = useDisclosure();
  const { navigationTarget, navigateToEvidence } = useEvidenceNavigation();
  const [journey, setJourney] = useState<PageJourney | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeSessionId =
    navigationTarget?.screen === "journey"
      ? navigationTarget.sessionId
      : latestSessionId(feed);

  useEffect(() => {
    let cancelled = false;
    if (activeSessionId === null) {
      setJourney(null);
      setLoaded(true);
      return;
    }
    query({ kind: "journeyStagesOfSession", session_id: activeSessionId, depth })
      .then((res) => {
        if (!cancelled && res.kind === "pageJourney") setJourney(res.journey);
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
  }, [feed, depth, activeSessionId]);

  if (!loaded) {
    return (
      <section className="np-journey" aria-label="Website journey loading" aria-busy="true">
        <Skeleton height={140} width="100%" style={{ marginBottom: "1.5rem" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Skeleton height={80} width="100%" />
          <Skeleton height={80} width="100%" />
          <Skeleton height={80} width="100%" />
        </div>
      </section>
    );
  }

  return (
    <section className="np-journey" aria-label={t("title")}>
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {activeSessionId !== null && navigationTarget?.screen === "journey" && (
        <div className="np-filter-banner" role="status">
          {t("filter_banner", { sessionId: activeSessionId })}
        </div>
      )}
      {!journey ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          {/* The signature flow diagram: stages with traveling packets + fan-out. */}
          <JourneyFlow stages={journey.stages} fanout={journey.fanout} />

      <ol className="np-journey__stages">
        {journey.stages.map((stage, i) => (
          <li className="np-stage" key={`${stage.kind}-${i}`}>
            <div className="np-stage__title">{stage.title}</div>
            <p className="np-stage__narration">{stage.narration}</p>
            {/* detail is present only at Intermediate+ (engine-gated, docs/14 §7). */}
            {stage.detail && <p className="np-stage__detail">{stage.detail}</p>}
            <EvidenceChips evidence={stage.evidence} onNavigate={navigateToEvidence} />
          </li>
        ))}
      </ol>

      {/* The fan-out: one visit, many companies — the mission in one view
          (docs/14 §5). Labeled by organization from local enrichment. */}
      {journey.fanout.length > 0 && (
        <aside className="np-fanout" aria-label="Servers contacted">
          <h3>{t("fanout.title", { count: journey.fanout.length })}</h3>
          <ul>
            {journey.fanout.map((node) => (
              <li key={node.label}>
                <span className="np-fanout__label">{node.label}</span>
                <span className="np-fanout__meta">
                  {t("fanout.connections", { count: node.flows })} · {humanBytes(node.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}
        </>
      )}
    </section>
  );
}
