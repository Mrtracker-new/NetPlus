import { useState, useCallback } from "react";
import type { AssistantAnswer } from "@netpulse/contract";
import { query } from "../ipc";

export interface ConversationTurn {
  id: string;
  question: string;
  answer?: AssistantAnswer;
  timestamp: number;
  status: "pending" | "complete" | "error";
  error?: string;
}

export function useAssistantController() {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const askQuestion = useCallback(async (qText: string, targetTurnId?: string) => {
    const text = qText.trim();
    if (!text) return;

    setNotice(null);
    setBusy(true);

    const turnId = targetTurnId || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    if (!targetTurnId) {
      setHistory((prev) => [
        ...prev,
        {
          id: turnId,
          question: text,
          timestamp: now,
          status: "pending",
        },
      ]);
    } else {
      setHistory((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, status: "pending", error: undefined } : t))
      );
    }

    setAnnouncement(`Asking assistant: "${text}"...`);

    try {
      const res = await query({ kind: "askAssistant", question: text });

      if (res.kind === "assistantAnswer") {
        setHistory((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  answer: res.answer,
                  status: "complete",
                }
              : t
          )
        );
        const citationCount = res.answer.citations ? res.answer.citations.length : 0;
        setAnnouncement(`Assistant responded: grounded with ${citationCount} citation(s).`);
      } else {
        const err = "Unexpected response kind from backend.";
        setHistory((prev) =>
          prev.map((t) => (t.id === turnId ? { ...t, status: "error", error: err } : t))
        );
        setNotice(err);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setHistory((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, status: "error", error: errMsg } : t))
      );
      setNotice(errMsg);
      setAnnouncement(`Assistant query failed: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const ask = useCallback(() => {
    const text = prompt;
    setPrompt("");
    return askQuestion(text);
  }, [askQuestion, prompt]);

  const askSuggestion = useCallback(
    (text: string) => {
      setPrompt("");
      return askQuestion(text);
    },
    [askQuestion]
  );

  const retry = useCallback(
    (turnId: string) => {
      const target = history.find((t) => t.id === turnId);
      if (target) {
        return askQuestion(target.question, turnId);
      }
    },
    [askQuestion, history]
  );

  const deleteTurn = useCallback((turnId: string) => {
    setHistory((prev) => prev.filter((t) => t.id !== turnId));
    setAnnouncement("Deleted conversation turn.");
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setNotice(null);
    setAnnouncement("Cleared conversation history.");
  }, []);

  return {
    prompt,
    setPrompt,
    history,
    busy,
    notice,
    setNotice,
    announcement,
    actions: {
      ask,
      askSuggestion,
      retry,
      deleteTurn,
      clearHistory,
    },
  };
}
