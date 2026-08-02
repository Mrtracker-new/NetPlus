import { useTranslation } from "react-i18next";
import type { ProtocolCategory } from "../../hooks/useExplorerController";

export interface ExplorerFiltersProps {
  category: ProtocolCategory;
  onCategoryChange: (cat: ProtocolCategory) => void;
}

export function ExplorerFilters({ category, onCategoryChange }: ExplorerFiltersProps) {
  const { t } = useTranslation(["explorer"]);

  const categories: { key: ProtocolCategory; label: string }[] = [
    { key: "all", label: t("categories.all") },
    { key: "http", label: t("categories.http") },
    { key: "tls", label: t("categories.tls") },
    { key: "dns", label: t("categories.dns") },
    { key: "tcp", label: t("categories.tcp") },
    { key: "quic", label: t("categories.quic") },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1.25rem",
        flexWrap: "wrap",
      }}
    >
      {categories.map((cat) => {
        const isActive = category === cat.key;
        return (
          <button
            key={cat.key}
            type="button"
            className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
            style={{
              fontSize: "0.85rem",
              padding: "0.35rem 0.75rem",
              borderRadius: "var(--np-radius-md, 6px)",
            }}
            onClick={() => onCategoryChange(cat.key)}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
