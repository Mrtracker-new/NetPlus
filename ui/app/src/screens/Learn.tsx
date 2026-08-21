import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton, Card, Button, Badge } from "@netpulse/components";
import { Icon } from "../icons";
import { useLearnController } from "../hooks/useLearnController";
import { LearnSummaryKpis } from "./Learn/LearnSummaryKpis";
import { LearnFilters } from "./Learn/LearnFilters";
import { LessonCard } from "./Learn/LessonCard";
import { LessonWorkspace } from "./Learn/LessonWorkspace";

export function Learn() {
  const { t } = useTranslation(["learn", "common"]);
  const {
    filteredModules,
    allLessons,
    activeLessonId,
    activeLesson,
    selectedChoiceIndex,
    validationOutcome,
    isValidating,
    loaded,
    notice,
    setNotice,
    level,
    setLevel,
    groundedOnly,
    toggleGrounded,
    metrics,
    announcement,
    selectLesson,
    submitChoice,
    resetProgress,
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

  // Active Lesson Player Workspace
  if (activeLessonId && activeLesson) {
    return (
      <section className="np-learn" aria-label={activeLesson.title}>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
        {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}
        <LessonWorkspace
          lesson={activeLesson}
          onBack={() => selectLesson(null)}
          onSubmitChoice={submitChoice}
          selectedChoiceIndex={selectedChoiceIndex}
          validationOutcome={validationOutcome}
          isValidating={isValidating}
          onNextLesson={
            metrics.nextRecommendedId && metrics.nextRecommendedId !== activeLessonId
              ? () => selectLesson(metrics.nextRecommendedId)
              : undefined
          }
        />
      </section>
    );
  }

  const nextRecommendedLesson = allLessons.find(
    (l) => l.id === metrics.nextRecommendedId
  );

  return (
    <section className="np-learn" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="np-learn__header" style={{ marginBottom: "1.5rem" }}>
        <h2 className="np-learn__title">{t("title", { defaultValue: "Interactive Network Curriculum" })}</h2>
        <p className="np-learn__desc">
          {t("desc", {
            defaultValue:
              "Master internet protocols step-by-step from DNS to encryption, grounded in your real traffic observations.",
          })}
        </p>
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {allLessons.length === 0 ? (
        <EmptyState
          icon={<Icon name="learn" />}
          title="Interactive Curriculum"
          description={t("empty")}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* 1. Summary KPI Cards */}
          <LearnSummaryKpis
            total={metrics.total}
            completedCount={metrics.completedCount}
            masteredCount={metrics.masteredCount}
            overallMasteryPct={metrics.overallMasteryPct}
            groundedPct={metrics.groundedPct}
            onResetProgress={resetProgress}
          />

          {/* 2. Recommended Next Lesson Banner */}
          {nextRecommendedLesson && (
            <Card
              style={{
                padding: "1.25rem",
                background: "linear-gradient(135deg, var(--np-surface-2), var(--np-surface-3))",
                border: "1px solid var(--np-accent)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--np-accent)", fontWeight: 700, marginBottom: "0.25rem" }}>
                  💡 {t("recommended_next", { defaultValue: "Recommended Next Step" })}
                </div>
                <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.15rem" }}>{nextRecommendedLesson.title}</h3>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <Badge variant="level">{nextRecommendedLesson.level}</Badge>
                  <span style={{ fontSize: "0.85rem", color: "var(--np-text-mute)" }}>
                    Mastery: {Math.round(nextRecommendedLesson.mastery * 100)}%
                  </span>
                </div>
              </div>
              <Button variant="primary" onClick={() => selectLesson(nextRecommendedLesson.id)}>
                {nextRecommendedLesson.status === "in_progress"
                  ? t("actions.continue", { defaultValue: "Continue Lesson" })
                  : t("actions.start", { defaultValue: "Start Lesson" })}{" "}
                →
              </Button>
            </Card>
          )}

          {/* 3. Level & Grounding Filters */}
          <LearnFilters
            level={level}
            onLevelChange={setLevel}
            groundedOnly={groundedOnly}
            onToggleGrounded={toggleGrounded}
            groundedCount={metrics.groundedCount}
          />

          {/* 4. Grouped Modules & Lessons */}
          {filteredModules.length > 0 ? (
            filteredModules.map((module) => (
              <section key={module.id} aria-labelledby={`module-${module.id}`} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <header style={{ borderBottom: "1px solid var(--np-border)", paddingBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <h3 id={`module-${module.id}`} style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
                      {module.title}
                    </h3>
                    <Badge variant="level">{module.level}</Badge>
                  </div>
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", color: "var(--np-text-mute)" }}>
                    {module.description}
                  </p>
                </header>

                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {module.lessons.map((lesson) => (
                    <LessonCard key={lesson.id} lesson={lesson} onSelect={selectLesson} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <EmptyState
              compact
              title="No Matching Lessons"
              description={level !== "all" ? t("no_filter_matches") : t("empty")}
              action={
                (level !== "all" || groundedOnly) ? (
                  <Button
                    variant="standard"
                    onClick={() => {
                      setLevel("all");
                      if (groundedOnly) toggleGrounded();
                    }}
                  >
                    Show All Lessons
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </section>
  );
}


