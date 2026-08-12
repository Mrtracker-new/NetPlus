import { useTranslation } from "react-i18next";
import type { LessonOffer } from "@netpulse/contract";
import { Badge, Card, EvidenceChips } from "@netpulse/components";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface LessonCardProps {
  offer: LessonOffer;
}

export function LessonCard({ offer }: LessonCardProps) {
  const { t } = useTranslation(["learn"]);
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <Card className="np-lesson">
      <header className="np-lesson__title-row">
        <h3 className="np-lesson__title">
          {offer.title}
        </h3>

        <div className="np-lesson__badges">
          <Badge
            variant="level"
            className="np-lesson__level"
          >
            {t(`levels.${offer.level}` as any, { defaultValue: offer.level })}
          </Badge>

          <Badge
            variant="posture"
            className={offer.grounded ? "np-lesson__grounded-tag" : "np-lesson__example-tag"}
          >
            {offer.grounded ? `🎯 ${t("card.grounded_tag")}` : `📚 ${t("card.example_tag")}`}
          </Badge>
        </div>
      </header>

      {/* Observed Facts */}
      {offer.grounding && offer.grounding.length > 0 && (
        <div className="np-lesson__grounding-section">
          <h4 className="np-lesson__grounding-title">
            {t("card.observed_evidence")}
          </h4>
          <ul className="np-lesson__grounding">
            {offer.grounding.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Comprehension Check */}
      {offer.exercise && (
        <details className="np-lesson__check">
          <summary>
            ❓ {t("card.exercise_title")}: {offer.exercise.prompt}
          </summary>
          <p className="np-lesson__answer">
            💡 {offer.exercise.answer}
          </p>
        </details>
      )}

      {/* Footer Evidence Chips */}
      {offer.evidence && offer.evidence.length > 0 && (
        <footer className="np-lesson__foot">
          <EvidenceChips evidence={offer.evidence} onNavigate={navigateToEvidence} />
        </footer>
      )}
    </Card>
  );
}

