import { useState, useEffect, useMemo, useCallback } from "react";
import type { SecurityFinding } from "@netpulse/contract";
import { query } from "../ipc";

export const STORAGE_KEY = "netpulse.security.expected.v1";

export type FindingCategory = "all" | SecurityFinding["category"];

export function getFindingKey(f: SecurityFinding): string {
  if (!f) return "";
  const evIds = f.evidence && Array.isArray(f.evidence) ? f.evidence.map((e) => e.id).join(",") : "";
  return `${f.kind}:${evIds}`;
}

export function loadExpectedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Ignore localStorage parse errors
  }
  return new Set();
}

export function saveExpectedSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore localStorage save errors
  }
}

export function useSecurityController() {
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [category, setCategory] = useState<FindingCategory>("all");
  const [showExpected, setShowExpected] = useState(false);
  const [expectedSet, setExpectedSet] = useState<Set<string>>(() => loadExpectedSet());

  const fetchFindings = useCallback(async () => {
    setLoaded(false);
    setNotice(null);

    try {
      const res = await query({
        kind: "securityFindings",
        from_mono_nanos: 0,
        to_mono_nanos: Number.MAX_SAFE_INTEGER,
      });

      if (res.kind === "findings") {
        setFindings(res.findings);
        setAnnouncement(`Loaded ${res.findings.length} security findings.`);
      } else {
        setFindings([]);
        setNotice("Unexpected response kind from backend.");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setFindings([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to fetch security findings: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchFindings();
  }, [fetchFindings]);

  const markExpected = useCallback((key: string) => {
    setExpectedSet((prev) => {
      const next = new Set(prev);
      next.add(key);
      saveExpectedSet(next);
      return next;
    });
    setAnnouncement("Marked finding as expected pattern.");
  }, []);

  const unmarkExpected = useCallback((key: string) => {
    setExpectedSet((prev) => {
      const next = new Set(prev);
      next.delete(key);
      saveExpectedSet(next);
      return next;
    });
    setAnnouncement("Unmarked expected finding.");
  }, []);

  const toggleShowExpected = useCallback(() => {
    setShowExpected((prev) => {
      const next = !prev;
      setAnnouncement(next ? "Showing suppressed findings." : "Hiding suppressed findings.");
      return next;
    });
  }, []);

  // Summary KPIs (total, anomaly, suspicious, informational, expected)
  const summary = useMemo(() => {
    let anomaly = 0;
    let suspicious = 0;
    let informational = 0;

    for (const f of findings) {
      if (f.category === "anomaly") anomaly++;
      else if (f.category === "suspicious") suspicious++;
      else if (f.category === "informational") informational++;
    }

    return {
      total: findings.length,
      anomaly,
      suspicious,
      informational,
      expectedCount: expectedSet.size,
    };
  }, [findings, expectedSet]);

  // Risk-first sorting & filtering pipeline
  const filteredFindings = useMemo(() => {
    return findings
      .filter((f) => {
        const key = getFindingKey(f);
        const isMarkedExpected = expectedSet.has(key);

        // Critical threat override rule: high confidence suspicious findings always display!
        const isCriticalThreat = f.category === "suspicious" && f.confidence_percent >= 85;

        // If marked expected and not showing expected, suppress UNLESS it's a critical threat
        if (isMarkedExpected && !showExpected && !isCriticalThreat) {
          return false;
        }

        // Category filter match
        if (category !== "all" && f.category !== category) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // High confidence first
        const confDiff = b.confidence_percent - a.confidence_percent;
        if (confDiff !== 0) return confDiff;

        // Suspicious category first
        if (a.category === "suspicious" && b.category !== "suspicious") return -1;
        if (b.category === "suspicious" && a.category !== "suspicious") return 1;

        return 0;
      });
  }, [findings, category, showExpected, expectedSet]);

  return {
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
    refresh: fetchFindings,
    announcement,
  };
}
