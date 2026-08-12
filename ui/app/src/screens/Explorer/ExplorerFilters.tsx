import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
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
    <div className="np-explorer__filters">
      {categories.map((cat) => {
        const isActive = category === cat.key;
        return (
          <Button
            key={cat.key}
            type="button"
            className="np-explorer__filter"
            aria-pressed={isActive}
            onClick={() => onCategoryChange(cat.key)}
          >
            {cat.label}
          </Button>
        );
      })}
    </div>
  );
}

