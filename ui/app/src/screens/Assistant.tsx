// Assistant — the grounded AI layer (docs/19). It *explains* your captured data
// and never invents it: every answer is grounded in your real evidence and cites
// it (docs/19 §3). The default backend is local, so answering does zero network
// egress — the privacy posture is shown on every answer (docs/19 §4.1). Before
// any opt-in remote use, the exact minimized context that *would* be sent is
// disclosed here — there are no silent uploads (docs/19 §4.3). When the data
// can't support an answer, the assistant says so rather than fabricating one
// (docs/19 §3).

import { useState } from "react";
import type { AssistantAnswer } from "@netpulse/contract";
import { Notice } from "@netpulse/components";
import { query } from "../ipc";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const SUGGESTIONS = [
  "Which host used the most bandwidth?",
  "What protocols am I using?",
  "Why was it slow?",
  "Summarize my traffic",
];

function AnswerView({ answer }: { answer: AssistantAnswer }) {
  return (
    <div className="np-assistant__answer">
      <div className="np-assistant__posture">
        <span className={answer.is_remote ? "np-posture np-posture--remote" : "np-posture np-posture--local"}>
          {answer.is_remote ? "Remote" : "Local"} · {answer.backend_id}
        </span>
        {answer.grounded ? (
          <span className="np-grounded">grounded · {answer.citations.length} citation(s)</span>
        ) : (
          <span className="np-ungrounded">no evidence to cite</span>
        )}
      </div>

      <p className="np-assistant__text" style={{ whiteSpace: "pre-line" }}>
        {answer.text}
      </p>

      <details className="np-assistant__disclosure">
        <summary>What a remote assistant would be sent</summary>
        <pre className="np-assistant__disclosure-body">{answer.disclosure}</pre>
      </details>
    </div>
  );
}

export function Assistant() {
  const [questionText, setQuestionText] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function ask(q: string) {
    if (busy) return;
    const text = q.trim();
    if (!text) return;
    setNotice(null);
    setBusy(true);
    try {
      const res = await query({ kind: "askAssistant", question: text });
      setAnswer(res.kind === "assistantAnswer" ? res.answer : null);
    } catch (e) {
      setNotice(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="np-assistant" aria-label="AI assistant">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      <form
        className="np-assistant__form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(questionText);
        }}
      >
        <input
          className="np-assistant__input"
          type="text"
          value={questionText}
          placeholder="Ask about your captured traffic…"
          aria-label="Ask the assistant a question"
          onChange={(e) => setQuestionText(e.target.value)}
        />
        <button className="np-assistant__ask" type="submit" disabled={busy}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="np-assistant__suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="np-suggestion"
            disabled={busy}
            onClick={() => {
              setQuestionText(s);
              void ask(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {answer && <AnswerView answer={answer} />}
    </section>
  );
}
