import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton, Input, Button } from "@netpulse/components";
import { Icon } from "../icons";
import { useDisclosure } from "../modes/DisclosureContext";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";
import { useExplorerController } from "../hooks/useExplorerController";
import { ExplorerSummaryKpis } from "./Explorer/ExplorerSummaryKpis";
import { ExplorerFilters } from "./Explorer/ExplorerFilters";
import { ExplorerEntryCard } from "./Explorer/ExplorerEntryCard";

export function Explorer() {
  const { t } = useTranslation(["explorer", "common"]);
  const { depth } = useDisclosure();
  const { setScreen } = useEvidenceNavigation();
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

      <header className="np-explorer__header">
        <h2 className="np-explorer__title">{t("title")}</h2>
        <p className="np-explorer__desc">{t("desc")}</p>
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Inset Search Bar Container */}
      <div className="np-explorer__search-bar">
        <span className="np-explorer__search-icon">
          <Icon name="search" style={{ width: 16, height: 16, color: "var(--np-text-mute)" }} />
        </span>
        <div className="np-explorer__search-input-wrap">
          <Input
            ref={searchInputRef}
            className="np-explorer__search"
            type="search"
            placeholder={t("search_placeholder")}
            value={term}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTerm(e.target.value)}
            aria-label={t("search_placeholder")}
          />
        </div>
        {term && (
          <Button
            variant="standard"
            className="np-explorer__search-clear"
            onClick={clearSearch}
          >
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
        <EmptyState
          icon={<Icon name="explorer" />}
          title="No Protocol Entries Found"
          description={category !== "all" ? t("no_filter_matches") : t("empty")}
          action={
            (category !== "all" || term) ? (
              <Button
                variant="standard"
                onClick={() => {
                  setCategory("all");
                  setTerm("");
                }}
              >
                Reset Filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        filteredEntries.map((entry) => (
          <ExplorerEntryCard
            key={entry.key}
            entry={entry}
            depth={depth}
            onSelectRelated={selectRelated}
            onOpenLesson={() => setScreen("learn")}
          />
        ))
      )}
    </section>
  );
}
