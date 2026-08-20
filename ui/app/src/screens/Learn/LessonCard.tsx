import { useTranslation } from "react-i18next";
import type { CurriculumLesson, LessonOffer } from "@netpulse/contract";
import { Badge, Button, Card } from "@netpulse/components";

export interface LessonCardProps {
  lesson: CurriculumLesson | LessonOffer;
  onSelect?: (lessonId: string) => void;
}

export function LessonCard({ lesson, onSelect }: LessonCardProps) {
  const { t } = useTranslation(["learn"]);

  const isCurriculumLesson = "status" in lesson;
  const isLocked = isCurriculumLesson ? lesson.is_locked : false;
  const status = isCurriculumLesson ? lesson.status : "not_started";
  const mastery = isCurriculumLesson ? lesson.mastery : 0;
  const isGrounded = isCurriculumLesson ? lesson.is_grounded : lesson.grounded;
  const lessonId = isCurriculumLesson ? lesson.id : lesson.lesson_id;
  const objectives = isCurriculumLesson ? lesson.objectives : [];
  const prerequisites = isCurriculumLesson ? lesson.prerequisites : [];

  const masteryPct = Math.round(mastery * 100);

  return (
    <Card
      className={`np-lesson ${isLocked ? "np-lesson--locked" : ""}`}
      style={{
        opacity: isLocked ? 0.7 : 1,
        border: isLocked ? "1px dashed var(--np-border)" : undefined,
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <header className="np-lesson__title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div>
          <h3 className="np-lesson__title" style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.25rem 0" }}>
            {isLocked && "🔒 "}
            {lesson.title}
          </h3>
          <code style={{ fontSize: "0.75rem", color: "var(--np-text-mute)" }}>{lessonId}</code>
        </div>

        <div className="np-lesson__badges" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <Badge variant="level" className="np-lesson__level">
            {t(`levels.${lesson.level}` as any, { defaultValue: lesson.level })}
          </Badge>

          <Badge variant="trust">
            {status === "mastered"
              ? "🏆 Mastered"
              : status === "completed"
              ? "✓ Completed"
              : status === "in_progress"
              ? "⏳ In Progress"
              : "Not Started"}
          </Badge>

          <Badge
            variant="posture"
            className={isGrounded ? "np-lesson__grounded-tag" : "np-lesson__example-tag"}
          >
            {isGrounded ? `🎯 ${t("card.grounded_tag", { defaultValue: "Grounded" })}` : `📚 ${t("card.example_tag", { defaultValue: "Curated" })}`}
          </Badge>
        </div>
      </header>

      {/* Learning Objectives */}
      {objectives && objectives.length > 0 && (
        <div style={{ fontSize: "0.85rem", color: "var(--np-text)", margin: "0.25rem 0" }}>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {objectives.map((obj, i) => (
              <li key={i} style={{ marginBottom: "0.2rem" }}>
                {obj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prerequisite warning if locked */}
      {isLocked && prerequisites.length > 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--np-accent-2)", fontStyle: "italic" }}>
          Prerequisites required: {prerequisites.join(", ")}
        </div>
      )}

      {/* Mastery Progress Bar & Action Button */}
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--np-border)" }}>
        <div style={{ minWidth: "120px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--np-text-mute)" }}>Mastery:</span>
          <div style={{ width: "80px", height: "6px", background: "var(--np-surface-3, #333)", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{ width: `${masteryPct}%`, height: "100%", background: "var(--np-accent, #2fe0d6)" }} />
          </div>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{masteryPct}%</span>
        </div>

        {onSelect && (
          <Button
            variant={status === "mastered" ? "standard" : status === "in_progress" ? "primary" : "standard"}
            disabled={isLocked}
            onClick={() => onSelect(lessonId)}
            style={{ fontSize: "0.85rem", padding: "0.35rem 0.85rem" }}
          >
            {status === "mastered"
              ? "Review Lesson"
              : status === "completed"
              ? "Practice Again"
              : status === "in_progress"
              ? "Continue →"
              : "Start Lesson →"}
          </Button>
        )}
      </footer>
    </Card>
  );
}


