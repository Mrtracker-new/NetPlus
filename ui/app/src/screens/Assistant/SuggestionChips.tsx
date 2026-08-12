import { useTranslation } from "react-i18next";

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
        >
          <span>💡</span> {item.label}
        </button>
      ))}
    </div>
  );
}

