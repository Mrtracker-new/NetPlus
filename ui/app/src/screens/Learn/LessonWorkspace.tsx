import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LessonDetail } from "@netpulse/contract";
import { Badge, Button, Card, EvidenceChips, Notice } from "@netpulse/components";
import { Icon } from "../../icons";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface LessonWorkspaceProps {
  lesson: LessonDetail;
  onBack: () => void;
  onSubmitChoice: (exerciseId: string, choiceIndex: number) => Promise<void>;
  selectedChoiceIndex: number | null;
  validationOutcome: {
    is_correct: boolean;
    feedback: string;
    explanation: string;
    correct_choice_index: number;
    new_mastery: number;
    status: string;
  } | null;
  isValidating: boolean;
  onNextLesson?: () => void;
}

export function LessonWorkspace({
  lesson,
  onBack,
  onSubmitChoice,
  selectedChoiceIndex,
  validationOutcome,
  isValidating,
  onNextLesson,
}: LessonWorkspaceProps) {
  const { t } = useTranslation(["learn", "common"]);
  const { navigateToEvidence } = useEvidenceNavigation();
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const activeStep = lesson.steps[activeStepIndex] ?? lesson.steps[0];
  const activeExercise = lesson.exercises[0];

  const masteryPct = Math.round((lesson.mastery || 0) * 100);

  return (
    <div className="np-lesson-workspace" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Header with Breadcrumb & Mastery Stats */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid var(--np-border)",
        }}
      >
        <div>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ marginBottom: "0.5rem", padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
            onClick={onBack}
          >
            ← {t("actions.back_to_curriculum", { defaultValue: "Back to Curriculum" })}
          </button>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0", color: "var(--np-text)" }}>
            {lesson.title}
          </h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
            <Badge variant="level">{lesson.level}</Badge>
            <Badge variant="trust">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                {lesson.status === "mastered" ? (
                  <>
                    <Icon name="trophy" style={{ width: "12px", height: "12px", color: "var(--np-notable, #f59e0b)" }} />
                    Mastered
                  </>
                ) : lesson.status === "completed" ? (
                  <>
                    <Icon name="check" style={{ width: "12px", height: "12px", color: "var(--np-good, #10b981)" }} />
                    Completed
                  </>
                ) : lesson.status === "in_progress" ? (
                  <>
                    <Icon name="clock" style={{ width: "12px", height: "12px", color: "var(--np-accent, #2fe0d6)" }} />
                    In Progress
                  </>
                ) : (
                  "Not Started"
                )}
              </span>
            </Badge>
            {lesson.grounding && lesson.grounding.length > 0 && (
              <Badge variant="posture" className="np-lesson__grounded-tag">
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                  <Icon name="target" style={{ width: "12px", height: "12px" }} />
                  {t("card.grounded_tag", { defaultValue: "Grounded in your traffic" })}
                </span>
              </Badge>
            )}
          </div>
        </div>

        {/* Mastery Score Progress */}
        <div style={{ minWidth: "180px", textAlign: "right" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--np-text-mute)", marginBottom: "0.25rem" }}>
            {t("mastery_score", { defaultValue: "Concept Mastery" })}: <strong>{masteryPct}%</strong>
          </div>
          <div style={{ width: "100%", height: "8px", background: "var(--np-surface-3, #333)", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{ width: `${masteryPct}%`, height: "100%", background: "var(--np-accent, #2fe0d6)" }} />
          </div>
        </div>
      </header>

      {/* 2. Learning Objectives */}
      {lesson.objectives && lesson.objectives.length > 0 && (
        <Card style={{ padding: "1rem", background: "var(--np-surface-2)" }}>
          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, margin: "0 0 0.5rem 0", color: "var(--np-accent)", display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <Icon name="target" style={{ width: "14px", height: "14px" }} />
            <span>{t("learning_objectives", { defaultValue: "Learning Objectives" })}</span>
          </h4>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "var(--np-text)" }}>
            {lesson.objectives.map((obj, i) => (
              <li key={i} style={{ marginBottom: "0.25rem" }}>
                {obj}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 3. Steps Walkthrough */}
      {lesson.steps.length > 0 && (
        <section aria-labelledby="steps-heading" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 id="steps-heading" style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Icon name="book" style={{ width: "16px", height: "16px" }} />
              <span>{t("steps_title", { defaultValue: "Interactive Concept Walkthrough" })}</span>
            </h3>
            <div style={{ fontSize: "0.85rem", color: "var(--np-text-mute)" }}>
              Step {activeStepIndex + 1} of {lesson.steps.length}
            </div>
          </div>

          {/* Stepper Tabs */}
          {lesson.steps.length > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
              {lesson.steps.map((step, idx) => (
                <Button
                  key={step.id}
                  variant={idx === activeStepIndex ? "primary" : "standard"}
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem", whiteSpace: "nowrap" }}
                  onClick={() => setActiveStepIndex(idx)}
                >
                  {idx + 1}. {step.title || step.id}
                </Button>
              ))}
            </div>
          )}

          {/* Active Step Content Card */}
          {activeStep && (
            <Card style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", color: "var(--np-accent-strong)" }}>
                  {activeStep.title || activeStep.id}
                </h4>
                <code style={{ fontSize: "0.8rem", color: "var(--np-text-mute)" }}>{activeStep.body_key}</code>
              </div>

              <div
                style={{
                  fontSize: "0.95rem",
                  lineHeight: "1.6",
                  color: "var(--np-text)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {activeStep.content}
              </div>

              {/* Animation visualization badge if present */}
              {activeStep.anim && (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "0.75rem 1rem",
                    background: "var(--np-surface-3, rgba(0,0,0,0.2))",
                    borderRadius: "var(--np-radius-md, 8px)",
                    border: "1px solid var(--np-border)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <Icon name="play" style={{ width: "18px", height: "18px", color: "var(--np-accent)", flexShrink: 0 }} />
                  <div style={{ fontSize: "0.85rem", color: "var(--np-text)" }}>
                    <strong>Interactive Flow Diagram:</strong> Visualizing {activeStep.anim.replace(/_/g, " ")} sequence from live capture.
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Step Navigation Controls */}
          {lesson.steps.length > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Button
                variant="standard"
                disabled={activeStepIndex === 0}
                onClick={() => setActiveStepIndex((prev) => Math.max(0, prev - 1))}
              >
                ← {t("actions.previous", { defaultValue: "Previous Step" })}
              </Button>
              <Button
                variant="standard"
                disabled={activeStepIndex === lesson.steps.length - 1}
                onClick={() => setActiveStepIndex((prev) => Math.min(lesson.steps.length - 1, prev + 1))}
              >
                {t("actions.next", { defaultValue: "Next Step" })} →
              </Button>
            </div>
          )}
        </section>
      )}

      {/* 4. Interactive Comprehension Check */}
      {activeExercise && (
        <section aria-labelledby="exercise-heading" style={{ marginTop: "0.5rem" }}>
          <Card style={{ padding: "1.5rem", border: "1px solid var(--np-accent)" }}>
            <h3 id="exercise-heading" style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.75rem 0", color: "var(--np-accent)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Icon name="help" style={{ width: "16px", height: "16px" }} />
              <span>{t("comprehension_check", { defaultValue: "Comprehension Check" })}</span>
            </h3>

            <p style={{ fontSize: "1rem", fontWeight: 500, margin: "0 0 1rem 0", color: "var(--np-text)" }}>
              {activeExercise.prompt}
            </p>

            {/* Selectable Choices */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
              {activeExercise.choices.map((choice, idx) => {
                const isSelected = selectedChoiceIndex === idx;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={isValidating}
                    aria-pressed={isSelected}
                    aria-disabled={isValidating}
                    onClick={() => onSubmitChoice(activeExercise.id, idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.85rem 1rem",
                      borderRadius: "var(--np-radius-md, 8px)",
                      border: isSelected
                        ? "2px solid var(--np-accent, #2fe0d6)"
                        : "1px solid var(--np-border)",
                      background: isSelected ? "var(--np-surface-3, rgba(47,224,214,0.1))" : "var(--np-surface-2)",
                      color: "var(--np-text)",
                      textAlign: "left",
                      cursor: isValidating ? "not-allowed" : "pointer",
                      opacity: isValidating ? 0.7 : 1,
                      transition: "all 0.15s ease",
                      fontSize: "0.9rem",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        border: isSelected ? "2px solid var(--np-accent)" : "1px solid var(--np-border)",
                        background: isSelected ? "var(--np-accent)" : "transparent",
                        color: isSelected ? "#000" : "var(--np-text-mute)",
                        fontWeight: 700,
                        fontSize: "0.75rem",
                        flexShrink: 0,
                      }}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span style={{ flex: 1 }}>{choice.text}</span>
                  </button>
                );
              })}
            </div>

            {/* Real-time Validation Feedback Notice */}
            {validationOutcome && (
              <div style={{ marginTop: "1rem" }}>
                <Notice level={validationOutcome.is_correct ? "success" : "warning"}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <Icon
                        name={validationOutcome.is_correct ? "checkCircle" : "alertTriangle"}
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span>{validationOutcome.is_correct ? "Correct!" : "Not quite."}</span>
                    </div>
                    <div style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                      {validationOutcome.feedback}
                    </div>
                    {validationOutcome.explanation && (
                      <div
                        style={{
                          fontSize: "0.85rem",
                          borderTop: "1px solid rgba(255,255,255,0.1)",
                          paddingTop: "0.5rem",
                          color: "var(--np-text-mute)",
                        }}
                      >
                        <strong>Technical Detail:</strong> {validationOutcome.explanation}
                      </div>
                    )}
                  </div>
                </Notice>
              </div>
            )}
          </Card>
        </section>
      )}

      {/* 5. Real Grounded Evidence References */}
      {lesson.evidence && lesson.evidence.length > 0 && (
        <footer style={{ marginTop: "0.5rem" }}>
          <h4 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.5rem 0", color: "var(--np-text-mute)", display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <Icon name="search" style={{ width: "13px", height: "13px" }} />
            <span>{t("card.observed_evidence", { defaultValue: "Captured Evidence in Your Data" })}:</span>
          </h4>
          <EvidenceChips evidence={lesson.evidence} onNavigate={navigateToEvidence} />
        </footer>
      )}

      {/* 6. Lesson Navigation Footer */}
      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "1rem",
          borderTop: "1px solid var(--np-border)",
        }}
      >
        <Button variant="standard" onClick={onBack}>
          ← {t("actions.back_to_curriculum", { defaultValue: "Curriculum Map" })}
        </Button>
        {onNextLesson && (
          <Button variant="primary" onClick={onNextLesson}>
            {t("actions.next_lesson", { defaultValue: "Next Recommended Lesson" })} →
          </Button>
        )}
      </footer>
    </div>
  );
}
