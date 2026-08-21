import { memo } from "react";
import type { HeroViewModel, SituationSummaryModel, NarrativeCategory } from "./viewModels";

interface SituationSummaryProps {
  hero: HeroViewModel;
  summary: SituationSummaryModel;
  onSelectCategory?: (category: NarrativeCategory) => void;
}

export const SituationSummary = memo(function SituationSummary({
  hero,
  summary,
  onSelectCategory,
}: SituationSummaryProps) {
  const rec = summary.recommendations[0];
  const recText = rec?.text ?? "";
  const recClass =
    hero.state === "healthy" || recText.toLowerCase().includes("no action required")
      ? "np-rec-tag--normal"
      : hero.state === "finding"
      ? "np-rec-tag--investigate"
      : "np-rec-tag--caution";

  return (
    <section className={`np-situation-card np-situation-card--${hero.state}`} aria-label="Situation Summary">
      <header className="np-situation-card__header">
        <div className="np-situation-card__title-row">
          <span className={`np-badge np-badge--${hero.state}`}>
            ● {hero.badgeText}
          </span>
          <h1 className="np-situation-card__headline">{summary.headline}</h1>
        </div>
        <p className="np-situation-card__paragraph">{summary.explanation}</p>
      </header>

      <div className="np-situation-card__body">
        <div className="np-situation-card__footer">
          <div className="np-situation-card__highlights">
            {summary.highlights.map((item, idx) => (
              <span key={idx} className="np-situation-chip">
                {item}
              </span>
            ))}
          </div>

          {rec && (
            <div className="np-situation-card__rec">
              {rec.type === "investigate" ? (
                <button
                  type="button"
                  className={`np-rec-tag ${recClass} np-rec-btn`}
                  onClick={() => onSelectCategory?.("findings")}
                  aria-label={`Recommendation: ${rec.text}`}
                >
                  <span className="np-rec-tag__prefix">Recommendation:</span> {rec.text}
                </button>
              ) : rec.type === "monitor" ? (
                <button
                  type="button"
                  className={`np-rec-tag ${recClass} np-rec-btn`}
                  onClick={() => onSelectCategory?.("all")}
                  aria-label={`Recommendation: ${rec.text}`}
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
      </div>
    </section>
  );
});
