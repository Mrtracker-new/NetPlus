import { useTranslation } from "react-i18next";
import { Notice, Skeleton, EmptyState } from "@netpulse/components";
import { useCompareController } from "../hooks/useCompareController";
import { CompareControls } from "./Compare/CompareControls";
import { CompareScorecards } from "./Compare/CompareScorecards";
import { EvidenceList } from "./Compare/EvidenceList";

export function SessionDiffScreen() {
  const { t } = useTranslation(["compare", "common"]);
  const {
    sessionA,
    setSessionA,
    sessionB,
    setSessionB,
    diff,
    isComparing,
    notice,
    setNotice,
    announcement,
    actions,
  } = useCompareController();

  const localizedNotice = notice
    ? notice.startsWith("errors.")
      ? t(notice as any)
      : notice
    : null;

  return (
    <section
      className="np-session-diff"
      aria-labelledby="session-diff-title"
      aria-describedby="session-diff-description"
    >
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <h2 id="session-diff-title">{t("title")}</h2>
      <p id="session-diff-description" className="np-session-diff__desc" style={{ color: "var(--np-subtext, #94a3b8)", marginBottom: "1.25rem" }}>
        {t("desc")}
      </p>

      {localizedNotice && (
        <Notice message={localizedNotice} level="error" onDismiss={() => setNotice(null)} />
      )}

      {/* Session Controls */}
      <CompareControls
        sessionA={sessionA}
        sessionB={sessionB}
        onSessionAChange={setSessionA}
        onSessionBChange={setSessionB}
        onSwap={actions.swapSessions}
        onCompare={() => void actions.runCompare()}
        isComparing={isComparing}
      />

      {/* Main Results Panel */}
      {isComparing ? (
        <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Skeleton height="100px" />
          <Skeleton height="160px" />
        </div>
      ) : diff ? (
        <article
          className="np-session-diff__panel"
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "1.25rem 1.5rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          }}
        >
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            {t("report_title", { a: diff.sessionIdA, b: diff.sessionIdB })}
          </h3>

          {/* Delta Scorecards */}
          <CompareScorecards diff={diff} />

          {/* Semantic Explanation */}
          <div className="np-session-diff__explanation" style={{ marginBottom: "1.25rem" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "var(--np-subtext, #94a3b8)" }}>
              {t("explanation")}
            </h4>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--np-text, #e2e8f0)", lineHeight: "1.6" }}>
              {diff.semanticExplanation}
            </p>
          </div>

          {/* Supporting Evidence List */}
          <EvidenceList evidence={diff.evidence} />
        </article>
      ) : (
        <EmptyState>{t("empty")}</EmptyState>
      )}
    </section>
  );
}
