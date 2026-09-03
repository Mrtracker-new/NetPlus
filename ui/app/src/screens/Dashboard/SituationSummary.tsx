import { memo } from "react";
import type { EvidenceRef } from "@netpulse/contract";
import type { HeroViewModel, SituationSummaryModel, NarrativeCategory, RecommendationItem } from "./viewModels";

interface SituationSummaryProps {
  hero: HeroViewModel;
  summary: SituationSummaryModel;
  onSelectCategory?: (category: NarrativeCategory) => void;
  onNavigateToEvidence?: (ref: EvidenceRef) => void;
  onRecommendationClick?: (rec: RecommendationItem) => void;
}

export const SituationSummary = memo(function SituationSummary({
  hero,
  summary,
  onSelectCategory,
  onNavigateToEvidence,
  onRecommendationClick,
}: SituationSummaryProps) {
  const rec = summary.recommendations[0];
  const recText = rec?.text ?? "";
  const recClass =
    hero.state === "healthy" || hero.state === "idle" || rec?.type === "ignore" || recText.toLowerCase().includes("no action required")
      ? "np-rec-tag--normal"
      : hero.state === "finding" || rec?.type === "investigate"
      ? "np-rec-tag--investigate"
      : "np-rec-tag--caution";

  const handleRecClick = () => {
    if (!rec) return;
    if (onRecommendationClick) {
      onRecommendationClick(rec);
      return;
    }
    // Fallback if onRecommendationClick not provided:
    // Dispatches either evidence navigation or category filter, avoiding conflicting parallel dispatches.
    if (rec.evidenceRef && onNavigateToEvidence) {
      onNavigateToEvidence(rec.evidenceRef);
    } else if (rec.type === "investigate") {
      onSelectCategory?.("findings");
    } else if (rec.type === "monitor") {
      onSelectCategory?.("all");
    }
  };

  return (
    <section className={`np-situation-card np-situation-card--${hero.state}`} aria-label="Situation Summary">
      <div className="np-situation-card__top">
        <div className="np-situation-card__title-group">
          <span className={`np-badge np-badge--${hero.state}`}>
            ● {hero.badgeText}
          </span>
          <h1 className="np-situation-card__headline">{hero.title || summary.headline}</h1>
        </div>

        {rec && hero.state !== "idle" && (
          <div className="np-situation-card__rec">
            {rec.type === "investigate" ? (
              <button
                type="button"
                className={`np-rec-tag ${recClass} np-rec-btn`}
                onClick={handleRecClick}
                aria-label={`Recommendation: ${rec.text}`}
              >
                <span className="np-rec-tag__prefix">Recommendation:</span> {rec.text}
              </button>
            ) : rec.type === "monitor" ? (
              <button
                type="button"
                className={`np-rec-tag ${recClass} np-rec-btn`}
                onClick={handleRecClick}
                aria-label={`Action: ${rec.text}`}
              >
                <span className="np-rec-tag__prefix">Action:</span> {rec.text}
              </button>
            ) : (
              <span className={`np-rec-tag ${recClass}`} role="status">
                <span className="np-rec-tag__prefix">Status:</span> {rec.text}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="np-situation-card__bottom">
        <p className="np-situation-card__paragraph">{hero.subtitle || summary.explanation}</p>
        <div className="np-situation-card__highlights">
          {summary.highlights.map((item, idx) => (
            <span key={idx} className="np-situation-chip">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
});
