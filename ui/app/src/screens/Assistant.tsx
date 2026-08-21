import { useTranslation } from "react-i18next";
import { Button, Input, Notice, EmptyState } from "@netpulse/components";
import { Icon } from "../icons";
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

      <header className="np-assistant__header">
        <div className="np-assistant__title-group">
          <h2 className="np-assistant__title">
            {t("title")}
          </h2>
          <p className="np-assistant__desc">
            {t("desc")}
          </p>
        </div>

        {history.length > 0 && (
          <Button
            type="button"
            className="np-assistant__clear-btn"
            onClick={actions.clearHistory}
          >
            🗑️ {t("clear_history")}
          </Button>
        )}
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Question Prompt Form */}
      <form className="np-assistant__form" onSubmit={handleSubmit} noValidate>
        <div className="np-assistant__bar">
          <div className="np-assistant__input-wrapper">
            <span className="np-assistant__input-icon" aria-hidden="true">💬</span>
            <Input
              className="np-assistant__input"
              type="text"
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPrompt(e.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              disabled={busy}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            className="np-assistant__ask"
            busy={busy}
            disabled={busy || !prompt.trim()}
          >
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
        <div className="np-assistant__thread">
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
        <EmptyState
          icon={<Icon name="assistant" />}
          title={`🤖 ${t("empty.title")}`}
          description={t("empty.subtitle")}
        />
      )}
    </section>
  );
}

