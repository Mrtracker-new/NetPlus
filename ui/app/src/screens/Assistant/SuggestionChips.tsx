import { useTranslation } from "react-i18next";
import { Icon } from "../../icons";

export interface SuggestionChipsProps {
  onSelectSuggestion: (promptText: string) => void;
  disabled: boolean;
}

export function SuggestionChips({ onSelectSuggestion, disabled }: SuggestionChipsProps) {
  const { t } = useTranslation(["assistant"]);

  const items = [
    { key: "bandwidth", label: t("suggestions.bandwidth") },
    { key: "protocols", label: t("suggestions.protocols") },
    { key: "latency", label: t("suggestions.latency") },
    { key: "summary", label: t("suggestions.summary") },
  ];

  return (
    <div className="np-assistant__suggestions">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="np-suggestion"
          disabled={disabled}
          onClick={() => onSelectSuggestion(item.label)}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
        >
          <Icon name="sparkles" style={{ width: "13px", height: "13px", color: "var(--np-accent, #2fe0d6)" }} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

