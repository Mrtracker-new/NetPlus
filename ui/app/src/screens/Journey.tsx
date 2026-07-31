// Website Journey — the flagship "what happened after I typed the URL?" view
// (docs/14). It reconstructs the complete page-load story from the session's
// causal graph and narrates it stage by stage (Navigation → DNS → Connection →
// Encryption → Request → Fan-out → Completion, docs/14 §4), then shows the
// CDN/organization fan-out that makes the modern web's reach visible (docs/14
// §5). Each stage carries its evidence (docs/02 §6.3); technical detail is
// disclosed progressively (docs/14 §7) — the engine already gated it by depth.

import { useEffect, useState } from "react";
import type { PageJourney } from "@netpulse/contract";
import { EmptyState, Notice, Spinner } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";
import { useStore } from "../state/store";
import { JourneyFlow } from "@netpulse/viz";

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

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function Journey() {
  const { feed } = useStore();
  const { depth } = useDisclosure();
  const [journey, setJourney] = useState<PageJourney | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sessionId = latestSessionId(feed);
    if (sessionId === null) {
      setJourney(null);
      setLoaded(true);
      return;
    }
    query({ kind: "journeyStagesOfSession", session_id: sessionId, depth })
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
  }, [feed, depth]);

  if (!loaded) {
    return <Spinner />;
  }

  return (
    <section className="np-journey" aria-label="Website journey">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {!journey ? (
        <EmptyState>Visit a website and its journey will appear here.</EmptyState>
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
            <span className="np-evidence-count">{stage.evidence.length} evidence</span>
          </li>
        ))}
      </ol>

      {/* The fan-out: one visit, many companies — the mission in one view
          (docs/14 §5). Labeled by organization from local enrichment. */}
      {journey.fanout.length > 0 && (
        <aside className="np-fanout" aria-label="Servers contacted">
          <h3>Talked to {journey.fanout.length} place(s)</h3>
          <ul>
            {journey.fanout.map((node) => (
              <li key={node.label}>
                <span className="np-fanout__label">{node.label}</span>
                <span className="np-fanout__meta">
                  {node.flows} connection{node.flows === 1 ? "" : "s"} · {humanBytes(node.bytes)}
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
