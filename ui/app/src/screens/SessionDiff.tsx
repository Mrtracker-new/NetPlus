import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionDiff } from "@netpulse/contract";
import { Button, Input, Spinner, Notice, EmptyState } from "@netpulse/components";
import { query } from "../ipc";
import { useBusy } from "../hooks/useBusy";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseSessionId(input: string): number {
  const parsed = Number.parseInt(input.trim(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function SessionDiffScreen() {
  const { t } = useTranslation("compare");
  const [sessionA, setSessionA] = useState<number>(1);
  const [sessionB, setSessionB] = useState<number>(2);
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [compareBusy, doCompare] = useBusy(async () => {
    if (sessionA <= 0 || sessionB <= 0) {
      setNotice("Session IDs must be positive integers.");
      return;
    }
    if (sessionA === sessionB) {
      setNotice("Select two different session IDs to compare.");
      return;
    }

    setNotice(null);
    setDiff(null);

    try {
      const res = await query({ kind: "compareSessions", sessionIdA: sessionA, sessionIdB: sessionB });
      if (res.kind === "sessionDiff") {
        setDiff(res.diff);
      } else {
        setNotice("Unexpected response kind from backend.");
      }
    } catch (e) {
      setNotice(toErrorMessage(e));
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doCompare();
  };

  return (
    <section
      className="np-session-diff"
      aria-labelledby="session-diff-title"
      aria-describedby="session-diff-description"
    >
      <h2 id="session-diff-title">{t("title")}</h2>
      <p id="session-diff-description" className="np-session-diff__desc">
        {t("desc")}
      </p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      <form className="np-session-diff__controls" onSubmit={handleSubmit} noValidate>
        <fieldset className="np-session-diff__fieldset" disabled={compareBusy}>
          <Input
            type="number"
            value={sessionA}
            onChange={(e) => setSessionA(parseSessionId(e.target.value))}
            placeholder={t("select_baseline")}
            aria-label={t("select_baseline")}
          />
          <Input
            type="number"
            value={sessionB}
            onChange={(e) => setSessionB(parseSessionId(e.target.value))}
            placeholder={t("select_target")}
            aria-label={t("select_target")}
          />
          <Button type="submit" variant="primary" busy={compareBusy}>
            {t("run_diff")}
          </Button>
        </fieldset>
      </form>

      {compareBusy ? (
        <div role="status" aria-live="polite" aria-busy="true">
          <Spinner label="Comparing sessions…" />
        </div>
      ) : diff ? (
        <article className="np-session-diff__panel">
          <h3>
            Comparison Report (Session #{diff.sessionIdA} vs #{diff.sessionIdB})
          </h3>

          <dl className="np-session-diff__metrics">
            <div>
              <dt className="np-session-diff__metric-label">RTT Δ</dt>
              <dd className="np-session-diff__metric-val np-session-diff__rtt">{diff.rttDeltaMs} ms</dd>
            </div>
            <div>
              <dt className="np-session-diff__metric-label">TTFB Δ</dt>
              <dd className="np-session-diff__metric-val">{diff.ttfbDeltaMs} ms</dd>
            </div>
            <div>
              <dt className="np-session-diff__metric-label">Protocol Shift</dt>
              <dd className="np-session-diff__metric-val">{diff.protocolShift}</dd>
            </div>
            <div>
              <dt className="np-session-diff__metric-label">Confidence</dt>
              <dd className="np-session-diff__metric-val np-session-diff__confidence">{diff.confidence}</dd>
            </div>
          </dl>

          <div className="np-session-diff__explanation">
            <h4>Semantic Explanation</h4>
            <p>{diff.semanticExplanation}</p>
          </div>

          <h3>Supporting Evidence</h3>
          {diff.evidence.length > 0 ? (
            <ul role="list">
              {diff.evidence.map((e, idx) => (
                <li key={idx} role="listitem" className="np-session-diff__evidence">
                  {e}
                </li>
              ))}
            </ul>
          ) : (
            <p className="np-session-diff__evidence">No supporting evidence available.</p>
          )}
        </article>
      ) : (
        <EmptyState>{t("empty")}</EmptyState>
      )}
    </section>
  );
}
