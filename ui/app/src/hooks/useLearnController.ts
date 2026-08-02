import { useState, useEffect, useMemo, useCallback } from "react";
import type { LessonOffer } from "@netpulse/contract";
import { query } from "../ipc";
import { useStore } from "../state/store";
import { useDisclosure } from "../modes/DisclosureContext";

export type LevelFilter = "all" | LessonOffer["level"];

export function sessionIdsFromFeed(feed: ReturnType<typeof useStore>["feed"]): number[] {
  const ids = new Set<number>();
  for (const card of feed) {
    if (card.evidence && Array.isArray(card.evidence)) {
      for (const e of card.evidence) {
        if (e.kind === "session") ids.add(e.id);
      }
    }
  }
  return Array.from(ids);
}

export function useLearnController() {
  const { feed } = useStore();
  const { depth, setDepth } = useDisclosure();

  const [lessons, setLessons] = useState<LessonOffer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [level, setLevelState] = useState<LevelFilter>("all");
  const [groundedOnly, setGroundedOnly] = useState(false);

  // Sync level change with global disclosure depth when specific level selected
  const setLevel = useCallback(
    (lvl: LevelFilter) => {
      setLevelState(lvl);
      if (lvl !== "all") {
        setDepth(lvl);
        setAnnouncement(`Switched view density depth to ${lvl}.`);
      } else {
        setAnnouncement("Showing all progressive disclosure levels.");
      }
    },
    [setDepth]
  );

  // Memoize session IDs as a primitive string key to prevent infinite refresh loops when feed array mutates
  const sessionIdsKey = useMemo(() => sessionIdsFromFeed(feed).join(","), [feed]);

  const fetchLessons = useCallback(async () => {
    setNotice(null);

    const sessionIds = sessionIdsKey
      ? sessionIdsKey.split(",").map((s) => Number.parseInt(s, 10)).filter((n) => !Number.isNaN(n))
      : [];

    // Fallback to baseline session 1 if feed has no sessions
    const targetSessionIds = sessionIds.length > 0 ? sessionIds : [1];

    try {
      const results = await Promise.all(
        targetSessionIds.map(async (sessionId) => {
          try {
            const res = await query({ kind: "lessonOffers", session_id: sessionId, depth });
            return res.kind === "lessonOffers" ? res.offers : [];
          } catch {
            return [];
          }
        })
      );

      const seen = new Set<string>();
      const flat: LessonOffer[] = [];
      for (const list of results) {
        for (const offer of list) {
          if (!seen.has(offer.lesson_id)) {
            seen.add(offer.lesson_id);
            flat.push(offer);
          }
        }
      }

      setLessons(flat);
      setAnnouncement(`Loaded ${flat.length} protocol lessons at ${depth} view density.`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setLessons([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to fetch lessons: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, [sessionIdsKey, depth]);

  useEffect(() => {
    void fetchLessons();
  }, [fetchLessons]);

  const toggleGrounded = useCallback(() => {
    setGroundedOnly((prev) => {
      const next = !prev;
      setAnnouncement(next ? "Showing grounded lessons only." : "Showing all lessons.");
      return next;
    });
  }, []);

  // Summary KPIs (total, groundedCount, exampleCount, groundedPct)
  const metrics = useMemo(() => {
    let groundedCount = 0;
    let exampleCount = 0;

    for (const l of lessons) {
      if (l.grounded) groundedCount++;
      else exampleCount++;
    }

    const total = lessons.length;
    const groundedPct = total > 0 ? Math.round((groundedCount / total) * 100) : 0;

    return {
      total,
      groundedCount,
      exampleCount,
      groundedPct,
    };
  }, [lessons]);

  // Filtering & Sorting Pipeline
  const filteredLessons = useMemo(() => {
    return lessons
      .filter((l) => {
        if (groundedOnly && !l.grounded) {
          return false;
        }
        if (level !== "all") {
          return l.level === level;
        }
        return true;
      })
      .sort((a, b) => {
        // Grounded lessons first
        if (a.grounded && !b.grounded) return -1;
        if (b.grounded && !a.grounded) return 1;
        return 0;
      });
  }, [lessons, level, groundedOnly]);

  return {
    lessons,
    filteredLessons,
    loaded,
    notice,
    setNotice,
    level,
    setLevel,
    groundedOnly,
    toggleGrounded,
    metrics,
    refresh: fetchLessons,
    announcement,
  };
}
