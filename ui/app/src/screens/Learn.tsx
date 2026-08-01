// Learn — the Learning Engine surface (docs/13). NetPulse turns the learner's
// *own* traffic into lessons: when a teachable moment occurs (a DNS lookup, a
// TLS handshake), it offers a lesson grounded in that real evidence (docs/13
// §3.2). Offers are calm and dismissible — an invitation, never a nag (docs/13
// §6, docs/01 §7.6). Every grounded claim cites the evidence behind it
// (docs/02 §6.3), and a grounded exercise's answer is derived from the learner's
// data, so it can never be wrong about what they actually did (docs/13 §11).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LessonOffer } from "@netpulse/contract";
import { EmptyState, Notice, Skeleton, EvidenceChips } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";
import { useStore } from "../state/store";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The distinct session ids referenced by the current feed — the sessions we can
// ask for grounded lesson offers.
function sessionIdsFromFeed(feed: ReturnType<typeof useStore>["feed"]): number[] {
  const ids = new Set<number>();
  for (const card of feed) {
    for (const e of card.evidence) {
      if (e.kind === "session") ids.add(e.id);
    }
  }
  return [...ids];
}

function Offer({ offer }: { offer: LessonOffer }) {
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <article className="np-lesson">
      <header className="np-lesson__title">
        {offer.title}
        <span className="np-lesson__level">{offer.level}</span>
        {/* Honesty: a curated example is labeled, never passed off as the
            learner's own capture (docs/13 §4.3). */}
        {!offer.grounded && <span className="np-lesson__example">example</span>}
      </header>

      {/* Grounding: plain facts pulled from the learner's own traffic (docs/13 §4.2). */}
      {offer.grounding.length > 0 && (
        <ul className="np-lesson__grounding">
          {offer.grounding.map((fact, i) => (
            <li key={i}>{fact}</li>
          ))}
        </ul>
      )}

      {/* A comprehension check on the learner's real data; the answer is
          revealed on demand with constructive framing (docs/13 §9). */}
      {offer.exercise && (
        <details className="np-lesson__check">
          <summary>{offer.exercise.prompt}</summary>
          <p className="np-lesson__answer">{offer.exercise.answer}</p>
        </details>
      )}

      <footer className="np-lesson__foot">
        <EvidenceChips evidence={offer.evidence} onNavigate={navigateToEvidence} />
      </footer>
    </article>
  );
}

export function Learn() {
  const { t } = useTranslation(["learn", "common"]);
  const { feed } = useStore();
  const { depth } = useDisclosure();
  const [offers, setOffers] = useState<LessonOffer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sessionIds = sessionIdsFromFeed(feed);
    Promise.all(
      sessionIds.map(async (sessionId) => {
        const res = await query({ kind: "lessonOffers", session_id: sessionId, depth });
        return res.kind === "lessonOffers" ? res.offers : [];
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const flat: LessonOffer[] = [];
        for (const list of results) {
          for (const offer of list) {
            if (!seen.has(offer.lesson_id)) {
              seen.add(offer.lesson_id);
              flat.push(offer);
            }
          }
        }
        setOffers(flat);
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
    return (
      <section className="np-learn" aria-label="Lessons loading" aria-busy="true">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Skeleton height={120} width="100%" />
          <Skeleton height={120} width="100%" />
          <Skeleton height={120} width="100%" />
        </div>
      </section>
    );
  }

  return (
    <section className="np-learn" aria-label={t("title")}>
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {offers.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        offers.map((offer) => <Offer key={offer.lesson_id} offer={offer} />)
      )}
    </section>
  );
}
