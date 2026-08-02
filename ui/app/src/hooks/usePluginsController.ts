import { useState, useEffect, useMemo, useCallback } from "react";
import type { PluginDescriptor } from "@netpulse/contract";
import { query, command } from "../ipc";

export type PluginFilter = "all" | PluginDescriptor["plugin_type"];

export function usePluginsController() {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [busyName, setBusyName] = useState<string | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fetchPlugins = useCallback(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "listPlugins" });
      if (res && res.kind === "plugins" && Array.isArray(res.plugins)) {
        setPlugins(res.plugins);
        setAnnouncement(`Loaded ${res.plugins.length} plugins.`);
      } else {
        setPlugins([]);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setPlugins([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to load plugins: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  // Optimistic Enable / Disable Mutation with Automatic Rollback
  const togglePlugin = useCallback(
    async (name: string, enable: boolean) => {
      if (busyName !== null) return;
      setNotice(null);
      setBusyName(name);

      // Save previous state for rollback
      let previousEnabledState = false;
      setPlugins((prev) =>
        (prev || []).map((p) => {
          if (p.name === name) {
            previousEnabledState = p.enabled;
            return { ...p, enabled: enable };
          }
          return p;
        })
      );

      setAnnouncement(`${enable ? "Enabled" : "Disabled"} plugin ${name}.`);

      try {
        await command({ kind: enable ? "enablePlugin" : "disablePlugin", name });
        await fetchPlugins();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // Rollback on failure
        setPlugins((prev) =>
          (prev || []).map((p) => (p.name === name ? { ...p, enabled: previousEnabledState } : p))
        );
        setNotice(errMsg);
        setAnnouncement(`Failed to ${enable ? "enable" : "disable"} plugin ${name}: ${errMsg}`);
      } finally {
        setBusyName(null);
      }
    },
    [busyName, fetchPlugins]
  );

  const safePlugins = useMemo(() => (Array.isArray(plugins) ? plugins : []), [plugins]);

  // Derived Filter Counts
  const counts = useMemo(() => {
    const map: Record<PluginFilter, number> = {
      all: safePlugins.length,
      dissector: 0,
      enrichment: 0,
      detector: 0,
      view: 0,
      export: 0,
    };

    for (const p of safePlugins) {
      if (p && p.plugin_type && map[p.plugin_type] !== undefined) {
        map[p.plugin_type]++;
      }
    }

    return map;
  }, [safePlugins]);

  // Derived Summary KPIs
  const summary = useMemo(() => {
    let activeCount = 0;
    let firstPartyCount = 0;
    let compatibleCount = 0;

    for (const p of safePlugins) {
      if (!p) continue;
      if (p.enabled) activeCount++;
      if (p.trust === "first_party") firstPartyCount++;
      if (p.compatible) compatibleCount++;
    }

    return {
      total: safePlugins.length,
      activeCount,
      firstPartyCount,
      compatibleCount,
    };
  }, [safePlugins]);

  // Filtered Plugins List
  const filteredPlugins = useMemo(() => {
    return safePlugins.filter((p) => {
      if (!p) return false;
      if (filter === "all") return true;
      return p.plugin_type === filter;
    });
  }, [safePlugins, filter]);

  return {
    plugins: safePlugins,
    filteredPlugins,
    summary,
    counts,
    filter,
    setFilter,
    busyName,
    loaded,
    notice,
    setNotice,
    togglePlugin,
    refresh: fetchPlugins,
    announcement,
  };
}
