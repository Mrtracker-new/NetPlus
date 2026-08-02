import { useTranslation } from "react-i18next";
import { EmptyState, Notice, Skeleton } from "@netpulse/components";
import { IncidentTimelineViz } from "@netpulse/viz";
import { useSecurityController, getFindingKey } from "../hooks/useSecurityController";
import { SecuritySummaryKpis } from "./Security/SecuritySummaryKpis";
import { SecurityFilters } from "./Security/SecurityFilters";
import { FindingCard } from "./Security/FindingCard";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

export function Security() {
  const { t } = useTranslation(["security", "common"]);
  const { navigateToEvidence } = useEvidenceNavigation();
  const {
    findings,
    filteredFindings,
    loaded,
    notice,
    setNotice,
    category,
    setCategory,
    showExpected,
    toggleShowExpected,
    expectedSet,
    markExpected,
    unmarkExpected,
    summary,
    announcement,
  } = useSecurityController();

  if (!loaded) {
    return (
      <section className="np-security" aria-label="Security findings loading" aria-busy="true">
        <div className="np-kpis" style={{ marginBottom: "1.5rem" }}>
          <Skeleton height={70} width="100%" />
          <Skeleton height={70} width="100%" />
          <Skeleton height={70} width="100%" />
          <Skeleton height={70} width="100%" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Skeleton height={150} width="100%" />
          <Skeleton height={150} width="100%" />
        </div>
      </section>
    );
  }

  return (
    <section className="np-security" aria-label={t("common:navigation.security") || t("title")}>
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

      {findings.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          {/* Summary KPI Cards */}
          <SecuritySummaryKpis
            total={summary.total}
            anomaly={summary.anomaly}
            suspicious={summary.suspicious}
            informational={summary.informational}
          />

          {/* Category & Expected Filters */}
          <SecurityFilters
            category={category}
            onCategoryChange={setCategory}
            showExpected={showExpected}
            onToggleShowExpected={toggleShowExpected}
            expectedCount={summary.expectedCount}
          />

          {/* Incident Timeline Visualizer */}
          {filteredFindings.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <IncidentTimelineViz findings={filteredFindings} onNavigateEvidence={navigateToEvidence} />
            </div>
          )}

          {/* Findings List or Classified Empty States */}
          {filteredFindings.length > 0 ? (
            filteredFindings.map((f) => {
              const key = getFindingKey(f);
              const isExpected = expectedSet.has(key);

              return (
                <FindingCard
                  key={key}
                  finding={f}
                  expected={isExpected}
                  onToggleExpected={() => {
                    if (isExpected) {
                      unmarkExpected(key);
                    } else {
                      markExpected(key);
                    }
                  }}
                />
              );
            })
          ) : (
            <EmptyState>
              {category !== "all" ? t("no_filter_matches") : t("all_suppressed")}
            </EmptyState>
          )}
        </>
      )}
    </section>
  );
}
