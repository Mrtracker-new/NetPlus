import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Learn } from "../screens/Learn";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function LearnTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Learn />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Learn Screen & useLearnController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders full curriculum modules and summary KPIs", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "curriculum",
      modules: [
        {
          id: "mod-1",
          title: "How the web loads",
          description: "Foundational mechanics of modern page loading.",
          level: "beginner",
          lessons: [
            {
              id: "b4.handshake",
              title: "TCP 3-Way Handshake",
              level: "beginner",
              status: "not_started",
              mastery: 0.0,
              is_locked: false,
              is_grounded: true,
              prerequisites: [],
              objectives: ["Understand SYN, SYN-ACK, ACK sequence."],
              related_concepts: ["tcp.flags.syn"],
            },
          ],
        },
      ],
      summary: {
        total_lessons: 1,
        completed_lessons: 0,
        mastered_lessons: 0,
        in_progress_lessons: 0,
        overall_mastery_pct: 0,
        next_recommended_lesson_id: "b4.handshake",
      },
    } as any);

    render(<LearnTestWrapper />);

    expect(await screen.findByText("How the web loads")).toBeInTheDocument();
    expect(screen.getAllByText("TCP 3-Way Handshake")[0]).toBeInTheDocument();
    expect(screen.getByText("Understand SYN, SYN-ACK, ACK sequence.")).toBeInTheDocument();
    expect(screen.getByText("Total Lessons")).toBeInTheDocument();
  });

  it("opens lesson workspace and handles interactive choice submission", async () => {
    const querySpy = vi.spyOn(ipcModule, "query");
    const commandSpy = vi.spyOn(ipcModule, "command").mockResolvedValue(undefined as any);

    querySpy.mockImplementation(async (q: any) => {
      if (q.kind === "getCurriculum") {
        return {
          kind: "curriculum",
          modules: [
            {
              id: "mod-1",
              title: "How the web loads",
              description: "Foundations.",
              level: "beginner",
              lessons: [
                {
                  id: "b4.handshake",
                  title: "TCP 3-Way Handshake",
                  level: "beginner",
                  status: "not_started",
                  mastery: 0.0,
                  is_locked: false,
                  is_grounded: true,
                  prerequisites: [],
                  objectives: ["Understand SYN, SYN-ACK, ACK sequence."],
                  related_concepts: ["tcp.flags.syn"],
                },
              ],
            },
          ],
          summary: {
            total_lessons: 1,
            completed_lessons: 0,
            mastered_lessons: 0,
            in_progress_lessons: 0,
            overall_mastery_pct: 0,
            next_recommended_lesson_id: "b4.handshake",
          },
        };
      }
      if (q.kind === "getLessonDetail") {
        return {
          kind: "lessonDetail",
          lesson: {
            lesson_id: "b4.handshake",
            title: "TCP 3-Way Handshake",
            level: "beginner",
            status: "in_progress",
            mastery: 0.5,
            grounding: ["SYN packet detected."],
            objectives: ["Understand handshake."],
            prerequisites: [],
            related_concepts: ["tcp.flags.syn"],
            steps: [
              {
                id: "step-1",
                title: "Client SYN",
                body_key: "tcp.flags.syn",
                content: "Client sends initial sequence number.",
                anim: "tcp_3way_handshake",
              },
            ],
            exercises: [
              {
                id: "tcp.identify.syn",
                kind: "identify",
                prompt: "Which TCP flag initiates connection establishment?",
                choices: [
                  { id: "c1", text: "SYN" },
                  { id: "c2", text: "ACK" },
                ],
                explanation: "SYN initiates sequence synchronisation.",
              },
            ],
            animation: null,
            evidence: [],
          },
        };
      }
      if (q.kind === "validateExerciseChoice") {
        return {
          kind: "exerciseValidation",
          outcome: {
            is_correct: true,
            feedback: "Correct! SYN establishes sync.",
            explanation: "RFC 9293 section 3.4.",
            correct_choice_index: 0,
            new_mastery: 1.0,
            status: "mastered",
          },
        };
      }
      return { kind: "payloadsUnavailable" } as any;
    });

    render(<LearnTestWrapper />);

    // Click "Start Lesson"
    const startBtns = await screen.findAllByRole("button", { name: /Start Lesson/i });
    const targetBtn = startBtns[0];
    if (!targetBtn) throw new Error("Start Lesson button not found");
    fireEvent.click(targetBtn);

    expect(commandSpy).toHaveBeenCalledWith({ kind: "startLesson", lesson_id: "b4.handshake" });
    expect(await screen.findByText(/Interactive Concept Walkthrough/i)).toBeInTheDocument();
    expect(screen.getByText("Client sends initial sequence number.")).toBeInTheDocument();
    expect(screen.getByText("Which TCP flag initiates connection establishment?")).toBeInTheDocument();

    // Submit choice "SYN"
    const synChoice = screen.getByRole("button", { name: /SYN/i });
    fireEvent.click(synChoice);

    expect(querySpy).toHaveBeenCalledWith({
      kind: "validateExerciseChoice",
      lesson_id: "b4.handshake",
      exercise_id: "tcp.identify.syn",
      choice_index: 0,
    });

    expect(await screen.findByText("Correct! SYN establishes sync.")).toBeInTheDocument();
    expect(screen.getByText("Correct!")).toBeInTheDocument();
  });
});
