import { useState, useEffect, useMemo, useCallback } from "react";
import type { FleetHost } from "@netpulse/contract";
import { query } from "../ipc";

export type FleetStatus = "online" | "degraded" | "offline" | "unknown";

export interface ExtendedFleetHost extends FleetHost {
  normalizedStatus: FleetStatus;
}

export function normalizeFleetStatus(statusStr: string): FleetStatus {
  if (!statusStr) return "unknown";
  const s = statusStr.toLowerCase();
  if (s.includes("online") || s.includes("active") || s.includes("ready")) return "online";
  if (s.includes("degraded") || s.includes("syncing") || s.includes("warning")) return "degraded";
  if (s.includes("offline") || s.includes("error") || s.includes("failed")) return "offline";
  return "unknown";
}

const STATUS_PRIORITY: Record<FleetStatus, number> = {
  offline: 0,
  degraded: 1,
  online: 2,
  unknown: 3,
};

export function useFleetController() {
  const [hosts, setHosts] = useState<ExtendedFleetHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FleetStatus>("all");

  const fetchHosts = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoaded(false);
    } else {
      setRefreshing(true);
    }
    setNotice(null);

    try {
      const res = await query({ kind: "listFleetHosts" });
      if (res.kind === "fleetHosts") {
        const normalized: ExtendedFleetHost[] = res.hosts.map((h) => ({
          ...h,
          normalizedStatus: normalizeFleetStatus(h.status),
        }));
        setHosts(normalized);
        const timeStr = new Date().toLocaleTimeString();
        setLastSyncedTime(timeStr);
        setAnnouncement(`Loaded ${normalized.length} fleet cluster nodes at ${timeStr}.`);
      } else {
        setHosts([]);
        setNotice("Unexpected response kind from backend.");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setHosts([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to fetch fleet hosts: ${errMsg}`);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchHosts(true);
  }, [fetchHosts]);

  // Compute summary metrics (total, online, degraded, offline)
  const summary = useMemo(() => {
    let online = 0;
    let degraded = 0;
    let offline = 0;

    for (const h of hosts) {
      if (h.normalizedStatus === "online") online++;
      else if (h.normalizedStatus === "degraded") degraded++;
      else if (h.normalizedStatus === "offline") offline++;
    }

    return {
      total: hosts.length,
      online,
      degraded,
      offline,
    };
  }, [hosts]);

  // Multi-tier problem-first sorting & search filtering pipeline
  const filteredHosts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return hosts
      .filter((h) => {
        // Status filter match
        if (statusFilter !== "all" && h.normalizedStatus !== statusFilter) {
          return false;
        }

        // Search blob match
        if (!query) return true;
        const searchBlob = [
          h.hostname,
          h.friendlyName || "",
          h.platform,
          h.os,
          h.agentVersion,
          h.hostId,
        ]
          .join(" ")
          .toLowerCase();

        return searchBlob.includes(query);
      })
      .sort((a, b) => {
        // Problem-first sort (offline -> degraded -> online -> unknown)
        const rankDiff = STATUS_PRIORITY[a.normalizedStatus] - STATUS_PRIORITY[b.normalizedStatus];
        if (rankDiff !== 0) return rankDiff;

        // Secondary alphabetical sort
        const nameA = (a.friendlyName || a.hostname).toLowerCase();
        const nameB = (b.friendlyName || b.hostname).toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [hosts, search, statusFilter]);

  const refresh = useCallback(() => {
    void fetchHosts(false);
  }, [fetchHosts]);

  return {
    hosts,
    filteredHosts,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    summary,
    loaded,
    refreshing,
    notice,
    setNotice,
    lastSyncedTime,
    refresh,
    announcement,
  };
}
