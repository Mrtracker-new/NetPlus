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
  return (
    <section className="np-situation-card" aria-label="Situation Summary">
      <header className="np-situation-card__header">
        <div className="np-situation-card__title-row">
          <span className={`np-badge np-badge--${hero.state}`}>
            ● {hero.badgeText}
          </span>
          <h1 className="np-hero__title">{hero.title}</h1>
        </div>
        <p className="np-hero__sub">{hero.subtitle}</p>
      </header>

      <div className="np-situation-card__body">
        <div className="np-situation-card__narrative">
          <h2 className="np-situation-card__headline">{summary.headline}</h2>
          <p className="np-situation-card__paragraph">{summary.explanation}</p>
        </div>

        <div className="np-situation-card__footer">
          <div className="np-situation-card__highlights">
            {summary.highlights.map((item, idx) => (
              <span key={idx} className="np-situation-chip">
                {item}
              </span>
            ))}
          </div>

          {summary.recommendations.length > 0 && (
            <div className="np-situation-card__rec">
              <button
                type="button"
                className="np-rec-tag np-rec-tag--investigate np-rec-btn"
                onClick={() => onSelectCategory?.("findings")}
                aria-label={`Recommendation: ${summary.recommendations[0]!.text}`}
              >
                Recommendation: {summary.recommendations[0]!.text}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
});
