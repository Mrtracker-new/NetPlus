import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { useLearnController } from "../hooks/useLearnController";
import { LearnSummaryKpis } from "./Learn/LearnSummaryKpis";
import { LearnFilters } from "./Learn/LearnFilters";
import { LessonCard } from "./Learn/LessonCard";

export function Learn() {
  const { t } = useTranslation(["learn", "common"]);
  const {
    lessons,
    filteredLessons,
    loaded,
    notice,
    setNotice,
    level,
    setLevel,
    groundedOnly,
    toggleGrounded,
    metrics,
    announcement,
  } = useLearnController();

  if (!loaded) {
    return (
      <section className="np-learn" aria-label="Lessons loading" aria-busy="true">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--np-4)" }}>
          <Skeleton height={120} width="100%" />
          <Skeleton height={120} width="100%" />
          <Skeleton height={120} width="100%" />
        </div>
      </section>
    );
  }

  return (
    <section className="np-learn" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="np-learn__header">
        <h2 className="np-learn__title">
          {t("title")}
        </h2>
        <p className="np-learn__desc">
          {t("desc")}
        </p>
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {lessons.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          {/* Summary KPI Cards */}
          <LearnSummaryKpis
            total={metrics.total}
            groundedCount={metrics.groundedCount}
            exampleCount={metrics.exampleCount}
            groundedPct={metrics.groundedPct}
          />

          {/* Level & Grounding Filters */}
          <LearnFilters
            level={level}
            onLevelChange={setLevel}
            groundedOnly={groundedOnly}
            onToggleGrounded={toggleGrounded}
            groundedCount={metrics.groundedCount}
          />

          {/* Lesson Cards List or Filter Empty State */}
          {filteredLessons.length > 0 ? (
            filteredLessons.map((offer) => (
              <LessonCard key={offer.lesson_id} offer={offer} />
            ))
          ) : (
            <EmptyState>
              {level !== "all" ? t("no_filter_matches") : t("empty")}
            </EmptyState>
          )}
        </>
      )}
    </section>
  );
}

