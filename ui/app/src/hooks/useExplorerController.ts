import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ExplorerEntry } from "@netpulse/contract";
import { query } from "../ipc";

export type ProtocolCategory =
  | "all"
  | "http"
  | "tls"
  | "dns"
  | "tcp"
  | "udp"
  | "quic"
  | "ip"
  | "icmp";

const ipcCache = new Map<string, ExplorerEntry[]>();

export function clearExplorerCache(): void {
  ipcCache.clear();
}

export function normalizeTerm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function calculateRankScore(entry: ExplorerEntry, normTerm: string): number {
  if (!normTerm) return 0;

  const normTitle = entry.title.toLowerCase();
  const normKey = entry.key.toLowerCase();
  const normBeginner = entry.beginner.toLowerCase();

  if (normTitle === normTerm || normKey === normTerm) return 100;
  if (normTitle.includes(normTerm) || normKey.includes(normTerm)) return 90;
  if (normBeginner.includes(normTerm)) return 70;
  if (entry.examples_available) return 60;
  return 40;
}

export function useExplorerController() {
  const [term, setTermState] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [category, setCategory] = useState<ProtocolCategory>("all");

  const [entries, setEntries] = useState<ExplorerEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 250ms debouncing for search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTerm(term);
    }, 250);
    return () => clearTimeout(handler);
  }, [term]);

  const fetchEntries = useCallback(async (searchTerm: string) => {
    const norm = normalizeTerm(searchTerm);
    setNotice(null);

    // Check in-memory cache
    if (ipcCache.has(norm)) {
      const cached = ipcCache.get(norm)!;
      setEntries(cached);
      setLoaded(true);
      setAnnouncement(`Loaded ${cached.length} protocol entries.`);
      return;
    }

    try {
      const q =
        norm.length > 0
          ? ({ kind: "explorerSearch", term: norm } as const)
          : ({ kind: "explorerBrowse" } as const);

      const res = await query(q);

      if (res.kind === "explorerEntries") {
        ipcCache.set(norm, res.entries);
        setEntries(res.entries);
        setAnnouncement(`Found ${res.entries.length} protocol entries matching "${norm}".`);
      } else {
        setEntries([]);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setEntries([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to load protocol entries: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchEntries(debouncedTerm);
  }, [debouncedTerm, fetchEntries]);

  const setTerm = useCallback((newTerm: string) => {
    setTermState(newTerm);
  }, []);

  const selectRelated = useCallback((relatedKey: string) => {
    setTermState(relatedKey);
    setAnnouncement(`Navigated to related topic: ${relatedKey}`);
  }, []);

  const clearSearch = useCallback(() => {
    setTermState("");
    setDebouncedTerm("");
    setCategory("all");
    setAnnouncement("Cleared search filter.");
  }, []);

  // Summary metrics
  const metrics = useMemo(() => {
    const total = entries.length;
    let withExamples = 0;
    let relatedCount = 0;

    for (const e of entries) {
      if (e.examples_available) withExamples++;
      if (e.related) relatedCount += e.related.length;
    }

    return {
      total,
      withExamples,
      relatedCount,
    };
  }, [entries]);

  // Filtering & Rank Sorting Pipeline
  const filteredEntries = useMemo(() => {
    const norm = normalizeTerm(debouncedTerm);

    return entries
      .filter((entry) => {
        if (category === "all") return true;
        const catNorm = category.toLowerCase();
        return (
          entry.key.toLowerCase().includes(catNorm) ||
          entry.title.toLowerCase().includes(catNorm) ||
          entry.beginner.toLowerCase().includes(catNorm)
        );
      })
      .sort((a, b) => {
        const scoreA = calculateRankScore(a, norm);
        const scoreB = calculateRankScore(b, norm);
        return scoreB - scoreA;
      });
  }, [entries, debouncedTerm, category]);

  return {
    term,
    setTerm,
    category,
    setCategory,
    entries,
    filteredEntries,
    loaded,
    notice,
    setNotice,
    metrics,
    selectRelated,
    clearSearch,
    refresh: () => fetchEntries(debouncedTerm),
    announcement,
    searchInputRef,
  };
}
