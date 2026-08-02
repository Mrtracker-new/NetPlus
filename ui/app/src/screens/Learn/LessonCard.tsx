import { useTranslation } from "react-i18next";
import type { LessonOffer } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface LessonCardProps {
  offer: LessonOffer;
}

export function LessonCard({ offer }: LessonCardProps) {
  const { t } = useTranslation(["learn"]);
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <article
      className="np-lesson"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      <header className="np-lesson__title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          {offer.title}
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            className="np-lesson__level"
            style={{
              fontSize: "0.78rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "12px",
              background: "rgba(59, 130, 246, 0.2)",
              color: "#60a5fa",
              fontWeight: 600,
              textTransform: "capitalize",
            }}
          >
            {t(`levels.${offer.level}` as any, { defaultValue: offer.level })}
          </span>

          <span
            className={offer.grounded ? "np-lesson__example np-lesson__example--grounded" : "np-lesson__example"}
            style={{
              fontSize: "0.78rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "12px",
              background: offer.grounded ? "rgba(16, 185, 129, 0.2)" : "rgba(148, 163, 184, 0.2)",
              color: offer.grounded ? "#10b981" : "#94a3b8",
              fontWeight: 600,
            }}
          >
            {offer.grounded ? `🎯 ${t("card.grounded_tag")}` : `📚 ${t("card.example_tag")}`}
          </span>
        </div>
      </header>

      {/* Observed Facts */}
      {offer.grounding && offer.grounding.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", fontWeight: 500 }}>
            {t("card.observed_evidence")}
          </h4>
          <ul className="np-lesson__grounding" style={{ listStyle: "disc", paddingLeft: "1.25rem", margin: 0, fontSize: "0.9rem", color: "var(--np-text, #e2e8f0)", lineHeight: "1.6" }}>
            {offer.grounding.map((fact, i) => (
              <li key={i} style={{ marginBottom: "0.25rem" }}>{fact}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Comprehension Check */}
      {offer.exercise && (
        <details
          className="np-lesson__check"
          style={{
            marginBottom: "1rem",
            fontSize: "0.88rem",
            color: "var(--np-subtext, #94a3b8)",
            background: "var(--np-bg, #0b1019)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-md, 6px)",
            padding: "0.75rem 1rem",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            ❓ {t("card.exercise_title")}: {offer.exercise.prompt}
          </summary>
          <p className="np-lesson__answer" style={{ margin: "0.75rem 0 0 0", padding: "0.6rem 0.85rem", background: "rgba(16, 185, 129, 0.15)", borderLeft: "3px solid #10b981", borderRadius: "4px", color: "#e2e8f0", fontSize: "0.88rem", lineHeight: "1.5" }}>
            💡 {offer.exercise.answer}
          </p>
        </details>
      )}

      {/* Footer Evidence Chips */}
      {offer.evidence && offer.evidence.length > 0 && (
        <footer className="np-lesson__foot" style={{ paddingTop: "0.75rem", borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))" }}>
          <EvidenceChips evidence={offer.evidence} onNavigate={navigateToEvidence} />
        </footer>
      )}
    </article>
  );
}
