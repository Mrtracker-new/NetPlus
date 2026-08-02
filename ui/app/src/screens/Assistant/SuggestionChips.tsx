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
    <div className="np-assistant__suggestions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="np-suggestion np-btn np-btn--ghost"
          disabled={disabled}
          onClick={() => onSelectSuggestion(item.label)}
          style={{
            fontSize: "0.85rem",
            padding: "0.4rem 0.8rem",
            borderRadius: "16px",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
            color: "var(--np-subtext, #94a3b8)",
          }}
        >
          💡 {item.label}
        </button>
      ))}
    </div>
  );
}
