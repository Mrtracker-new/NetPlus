import { useTranslation } from "react-i18next";
import { Button, Input, Notice } from "@netpulse/components";
import { useAssistantController } from "../hooks/useAssistantController";
import { ConversationTurnCard } from "./Assistant/ConversationTurnCard";
import { SuggestionChips } from "./Assistant/SuggestionChips";

export function Assistant() {
  const { t } = useTranslation(["assistant", "common"]);
  const {
    prompt,
    setPrompt,
    history,
    busy,
    notice,
    setNotice,
    announcement,
    actions,
  } = useAssistantController();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void actions.ask();
  };

  return (
    <section className="np-assistant" aria-label={t("common:navigation.assistant") || t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.4rem 0", color: "var(--np-text, #e2e8f0)" }}>
            {t("title")}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", margin: 0 }}>
            {t("desc")}
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.82rem", padding: "0.35rem 0.75rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
            onClick={actions.clearHistory}
          >
            🗑️ {t("clear_history")}
          </button>
        )}
      </div>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Question Prompt Form */}
      <form className="np-assistant__form" onSubmit={handleSubmit} noValidate style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <Input
              className="np-assistant__input"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              disabled={busy}
            />
          </div>
          <Button type="submit" variant="primary" busy={busy} disabled={busy || !prompt.trim()}>
            {busy ? t("thinking") : t("ask_button")}
          </Button>
        </div>
      </form>

      {/* Suggestion Chips */}
      <SuggestionChips
        disabled={busy}
        onSelectSuggestion={(text) => void actions.askSuggestion(text)}
      />

      {/* Conversation History Thread or Capability Empty State */}
      {history.length > 0 ? (
        <div className="np-assistant__thread" style={{ display: "flex", flexDirection: "column-reverse" }}>
          {history.slice().reverse().map((turn) => (
            <ConversationTurnCard
              key={turn.id}
              turn={turn}
              onRetry={() => void actions.retry(turn.id)}
              onDelete={() => actions.deleteTurn(turn.id)}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px dashed var(--np-surface-2, rgba(255, 255, 255, 0.15))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "2rem",
            textAlign: "center",
            color: "var(--np-subtext, #94a3b8)",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)", margin: "0 0 0.5rem 0" }}>
            🤖 {t("empty.title")}
          </h3>
          <p style={{ fontSize: "0.9rem", margin: 0, maxWidth: "550px", marginLeft: "auto", marginRight: "auto", lineHeight: "1.6" }}>
            {t("empty.subtitle")}
          </p>
        </div>
      )}
    </section>
  );
}
