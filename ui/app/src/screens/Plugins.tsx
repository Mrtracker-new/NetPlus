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

      <header className="np-plugins__header">
        <h2 className="np-plugins__title">{t("title")}</h2>
        <p className="np-plugins__desc">{t("desc")}</p>
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice?.(null)} />}

      <ZeroEgressBadge />

      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
        </div>
      ) : safeTotal === 0 ? (
        <div className="np-plugins__empty">
          <h3 className="np-plugins__empty-title">
            🔌 {t("empty.title")}
          </h3>
          <p className="np-plugins__empty-desc">
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

