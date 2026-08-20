import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  CurriculumLesson,
  CurriculumModule,
  ExerciseValidationOutcome,
  LearningProgress,
  LessonDetail,
  ProjectionDepth,
} from "@netpulse/contract";
import { command, query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";

export type LevelFilter = "all" | ProjectionDepth;

export function useLearnController() {
  const { setDepth } = useDisclosure();

  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [summary, setSummary] = useState<LearningProgress | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeLesson, setActiveLesson] = useState<LessonDetail | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState<number | null>(null);
  const [validationOutcome, setValidationOutcome] = useState<ExerciseValidationOutcome | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [level, setLevelState] = useState<LevelFilter>("all");
  const [groundedOnly, setGroundedOnly] = useState(false);

  // Sync level filter
  const setLevel = useCallback(
    (lvl: LevelFilter) => {
      setLevelState(lvl);
      if (lvl !== "all") {
        setDepth(lvl);
        setAnnouncement(`Switched curriculum disclosure depth to ${lvl}.`);
      } else {
        setAnnouncement("Showing all progressive disclosure levels.");
      }
    },
    [setDepth]
  );

  // Fetch full curriculum and summary
  const fetchCurriculum = useCallback(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "getCurriculum" });
      if (res.kind === "curriculum") {
        setModules(res.modules);
        setSummary(res.summary);
        setAnnouncement(
          `Loaded ${res.modules.length} curriculum modules. Overall mastery: ${res.summary.overall_mastery_pct}%.`
        );
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setAnnouncement(`Failed to load curriculum: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchCurriculum();
  }, [fetchCurriculum]);

  // Load lesson detail when activeLessonId changes
  const fetchLessonDetail = useCallback(
    async (lessonId: string) => {
      try {
        const res = await query({ kind: "getLessonDetail", lesson_id: lessonId });
        if (res.kind === "lessonDetail" && res.lesson.lesson_id === lessonId) {
          setActiveLesson(res.lesson);
          setActiveStepIndex(0);
          setSelectedChoiceIndex(null);
          setValidationOutcome(null);
          setAnnouncement(`Opened lesson: ${res.lesson.title}`);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setNotice(errMsg);
      }
    },
    []
  );

  useEffect(() => {
    setSelectedChoiceIndex(null);
    setValidationOutcome(null);
    if (activeLessonId) {
      void fetchLessonDetail(activeLessonId);
    } else {
      setActiveLesson(null);
    }
  }, [activeLessonId, fetchLessonDetail]);

  // Select / open a lesson
  const selectLesson = useCallback(
    async (lessonId: string | null) => {
      setSelectedChoiceIndex(null);
      setValidationOutcome(null);
      if (lessonId) {
        try {
          await command({ kind: "startLesson", lesson_id: lessonId });
        } catch {
          // ignore start command error in offline mode
        }
      }
      setActiveLessonId(lessonId);
    },
    []
  );

  // Submit exercise choice
  const submitChoice = useCallback(
    async (exerciseId: string, choiceIndex: number) => {
      if (isValidating || !activeLessonId) return;
      setIsValidating(true);
      setSelectedChoiceIndex(choiceIndex);
      try {
        const res = await query({
          kind: "validateExerciseChoice",
          lesson_id: activeLessonId,
          exercise_id: exerciseId,
          choice_index: choiceIndex,
        });
        if (res.kind === "exerciseValidation") {
          setValidationOutcome(res.outcome);
          if (res.outcome.is_correct) {
            setAnnouncement(`Correct! ${res.outcome.feedback}`);
          } else {
            setAnnouncement(`Incorrect. ${res.outcome.feedback}`);
          }
          // Refresh curriculum summary in background
          void fetchCurriculum();
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setNotice(errMsg);
      } finally {
        setIsValidating(false);
      }
    },
    [activeLessonId, isValidating, fetchCurriculum]
  );

  // Reset all learning progress
  const resetProgress = useCallback(async () => {
    try {
      await command({ kind: "resetLearningProgress" });
      setAnnouncement("Learning progress reset to initial state.");
      await fetchCurriculum();
      if (activeLessonId) {
        await fetchLessonDetail(activeLessonId);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
    }
  }, [activeLessonId, fetchCurriculum, fetchLessonDetail]);

  const toggleGrounded = useCallback(() => {
    setGroundedOnly((prev) => {
      const next = !prev;
      setAnnouncement(next ? "Showing grounded lessons only." : "Showing all lessons.");
      return next;
    });
  }, []);

  // Filtered curriculum modules
  const filteredModules = useMemo(() => {
    return modules
      .map((mod) => {
        const filteredLessons = mod.lessons.filter((l) => {
          if (groundedOnly && !l.is_grounded) return false;
          if (level !== "all" && l.level !== level) return false;
          return true;
        });
        return {
          ...mod,
          lessons: filteredLessons,
        };
      })
      .filter((mod) => mod.lessons.length > 0);
  }, [modules, level, groundedOnly]);

  // All flattened lessons across modules
  const allLessons: CurriculumLesson[] = useMemo(() => {
    return modules.flatMap((m) => m.lessons);
  }, [modules]);

  // Summary KPIs
  const metrics = useMemo(() => {
    const total = allLessons.length;
    const groundedCount = allLessons.filter((l) => l.is_grounded).length;
    const exampleCount = total - groundedCount;
    const completedCount = summary?.completed_lessons ?? 0;
    const masteredCount = summary?.mastered_lessons ?? 0;
    const overallMasteryPct = summary?.overall_mastery_pct ?? 0;

    return {
      total,
      groundedCount,
      exampleCount,
      completedCount,
      masteredCount,
      overallMasteryPct,
      groundedPct: total > 0 ? Math.round((groundedCount / total) * 100) : 0,
      nextRecommendedId: summary?.next_recommended_lesson_id ?? null,
    };
  }, [allLessons, summary]);

  return {
    modules,
    filteredModules,
    allLessons,
    summary,
    activeLessonId,
    activeLesson,
    activeStepIndex,
    setActiveStepIndex,
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
    refresh: fetchCurriculum,
  };
}

