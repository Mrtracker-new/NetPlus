import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton, Input, Button } from "@netpulse/components";
import { useDisclosure } from "../modes/DisclosureContext";
import { useExplorerController } from "../hooks/useExplorerController";
import { ExplorerSummaryKpis } from "./Explorer/ExplorerSummaryKpis";
import { ExplorerFilters } from "./Explorer/ExplorerFilters";
import { ExplorerEntryCard } from "./Explorer/ExplorerEntryCard";

export function Explorer() {
  const { t } = useTranslation(["explorer", "common"]);
  const { depth } = useDisclosure();
  const {
    term,
    setTerm,
    category,
    setCategory,
    filteredEntries,
    loaded,
    notice,
    setNotice,
    metrics,
    selectRelated,
    clearSearch,
    announcement,
    searchInputRef,
  } = useExplorerController();

  // Global Keyboard Shortcuts ('/' to focus search, 'Esc' to clear search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && term) {
        clearSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [term, clearSearch, searchInputRef]);

  return (
    <section className="np-explorer" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.4rem 0", color: "var(--np-text, #e2e8f0)" }}>
        {t("title")}
      </h2>
      <p style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", margin: "0 0 1.25rem 0" }}>
        {t("desc")}
      </p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Search Input Bar */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1.25rem" }}>
        <div style={{ flex: 1 }}>
          <Input
            ref={searchInputRef}
            className="np-explorer__search"
            type="search"
            placeholder={t("search_placeholder")}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label={t("search_placeholder")}
          />
        </div>
        {term && (
          <Button variant="standard" onClick={clearSearch} style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}>
            ✕ {t("clear_search")}
          </Button>
        )}
      </div>

      {/* Summary KPI Scorecards */}
      {loaded && (
        <ExplorerSummaryKpis
          total={metrics.total}
          matching={filteredEntries.length}
          withExamples={metrics.withExamples}
          relatedCount={metrics.relatedCount}
        />
      )}

      {/* Protocol Category Filters */}
      <ExplorerFilters category={category} onCategoryChange={setCategory} />

      {/* Entry Cards List or Loading Skeletons or Empty States */}
      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={110} width="100%" />
          <Skeleton height={110} width="100%" />
          <Skeleton height={110} width="100%" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <EmptyState>
          {category !== "all" ? t("no_filter_matches") : t("empty")}
        </EmptyState>
      ) : (
        filteredEntries.map((entry) => (
          <ExplorerEntryCard
            key={entry.key}
            entry={entry}
            depth={depth}
            onSelectRelated={selectRelated}
          />
        ))
      )}
    </section>
  );
}
