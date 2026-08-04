import { useTranslation } from "react-i18next";
import { Notice, Skeleton } from "@netpulse/components";
import { usePluginsController } from "../hooks/usePluginsController";
import { PluginsSummaryKpis } from "./Plugins/PluginsSummaryKpis";
import { PluginsFilters } from "./Plugins/PluginsFilters";
import { ZeroEgressBadge } from "./Plugins/ZeroEgressBadge";
import { PluginCard } from "./Plugins/PluginCard";

export function Plugins() {
  const { t } = useTranslation(["plugins", "common"]);
  const {
    filteredPlugins = [],
    summary = { total: 0, activeCount: 0, firstPartyCount: 0, compatibleCount: 0 },
    counts = { all: 0, dissector: 0, enrichment: 0, detector: 0, view: 0, export: 0 },
    filter = "all",
    setFilter,
    busyName,
    loaded = false,
    notice,
    setNotice,
    togglePlugin,
    configurePlugin,
    resetPlugin,
    announcement = "",
  } = usePluginsController();

  const safePlugins = Array.isArray(filteredPlugins) ? filteredPlugins : [];
  const safeTotal = summary?.total ?? 0;

  return (
    <section className="np-plugins" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.4rem 0", color: "var(--np-text, #e2e8f0)" }}>
          {t("title")}
        </h2>
        <p style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", margin: 0 }}>
          {t("desc")}
        </p>
      </div>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice?.(null)} />}

      <ZeroEgressBadge />

      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
        </div>
      ) : safeTotal === 0 ? (
        <div
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px dashed var(--np-surface-2, rgba(255, 255, 255, 0.15))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            color: "var(--np-subtext, #94a3b8)",
          }}
        >
          <h3 style={{ fontSize: "1.15rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)", margin: "0 0 0.5rem 0" }}>
            🔌 {t("empty.title")}
          </h3>
          <p style={{ fontSize: "0.9rem", margin: 0, maxWidth: "550px", marginLeft: "auto", marginRight: "auto", lineHeight: "1.6" }}>
            {t("empty.subtitle")}
          </p>
        </div>
      ) : (
        <>
          {/* Summary KPI Scorecards */}
          <PluginsSummaryKpis
            total={summary?.total ?? 0}
            activeCount={summary?.activeCount ?? 0}
            firstPartyCount={summary?.firstPartyCount ?? 0}
            compatibleCount={summary?.compatibleCount ?? 0}
          />

          {/* Type Filter Chips with Counts */}
          <PluginsFilters filter={filter} counts={counts} onFilterChange={setFilter} />

          {/* Plugin Descriptor Cards */}
          {safePlugins.map((p, idx) => (
            <PluginCard
              key={p?.name || idx}
              p={p}
              busy={busyName === p?.name}
              onToggle={(enable) => void togglePlugin?.(p?.name, enable)}
              onConfigure={(config) => configurePlugin(p.name, config)}
              onReset={() => resetPlugin(p.name)}
            />
          ))}
        </>
      )}
    </section>
  );
}

