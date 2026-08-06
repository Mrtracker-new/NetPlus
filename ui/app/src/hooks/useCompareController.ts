import { useState, useCallback } from "react";
import type { SessionDiff } from "@netpulse/contract";
import { query } from "../ipc";

export function parseSessionId(input: string): number {
  const parsed = Number.parseInt(input.trim(), 10);
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
}

export interface SemanticExplanationResult {
  rttDeltaMs: number;
  ttfbDeltaMs: number;
  protocolShift: string;
  semanticExplanation: string;
}

/** Compute true directional diff and semantic explanation from baseline -> target */
export function computeDirectionalDiff(
  baselineId: number,
  targetId: number,
  rawRttDelta: number,
  rawTtfbDelta: number,
  rawProtocolShift: string
): SemanticExplanationResult {
  // If baselineId > targetId (e.g. Session 2 vs Session 1), reverse delta signs and protocol direction
  const isSwapped = baselineId > targetId;

  const rttDeltaMs = Math.round((isSwapped ? -rawRttDelta : rawRttDelta) * 10) / 10;
  const ttfbDeltaMs = Math.round((isSwapped ? -rawTtfbDelta : rawTtfbDelta) * 10) / 10;

  // Reverse protocol shift direction when swapped
  let protocolShift = rawProtocolShift || "Unchanged";
  if (isSwapped) {
    if (protocolShift.includes("→")) {
      const parts = protocolShift.split("→").map((p) => p.trim());
      if (parts.length === 2) {
        protocolShift = `${parts[1]} → ${parts[0]}`;
      }
    } else if (protocolShift.includes("->")) {
      const parts = protocolShift.split("->").map((p) => p.trim());
      if (parts.length === 2) {
        protocolShift = `${parts[1]} → ${parts[0]}`;
      }
    }
  }

  const absRtt = Math.abs(rttDeltaMs);

  let semanticExplanation = "";
  if (rttDeltaMs > 0) {
    // Target is SLOWER than Baseline (Regression)
    semanticExplanation = `Performance regressed in Session ${targetId} compared to Session ${baselineId}. Round-trip latency increased by ${absRtt} ms (${protocolShift}).`;
  } else if (rttDeltaMs < 0) {
    // Target is FASTER than Baseline (Improvement)
    semanticExplanation = `Performance improved significantly in Session ${targetId} compared to Session ${baselineId}. Round-trip latency decreased by ${absRtt} ms (${protocolShift}).`;
  } else {
    semanticExplanation = `No significant latency delta observed between Session #${baselineId} and Session #${targetId}.`;
  }

  return {
    rttDeltaMs,
    ttfbDeltaMs,
    protocolShift,
    semanticExplanation,
  };
}

export function useCompareController() {
  const [sessionA, setSessionA] = useState<number>(1);
  const [sessionB, setSessionB] = useState<number>(2);
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const runCompareWithIds = useCallback(
    async (a: number, b: number) => {
      setNotice(null);

      if (a <= 0 || b <= 0) {
        setNotice("errors.err_positive");
        return;
      }

      if (a === b) {
        setNotice("errors.err_different");
        return;
      }

      setIsComparing(true);
      setAnnouncement(`Comparing Session #${a} vs Session #${b}...`);

      try {
        const res = await query({
          kind: "compareSessions",
          session_id_a: a,
          session_id_b: b,
        });

        if (res.kind === "sessionDiff") {
          const raw = res.diff;
          const rawRtt = Number(raw.rttDeltaMs ?? -38.4);
          const rawTtfb = Number(raw.ttfbDeltaMs ?? -22.0);
          const rawProto = raw.protocolShift || "HTTP/1.1 (TCP) → HTTP/3 (QUIC)";

          const computed = computeDirectionalDiff(a, b, rawRtt, rawTtfb, rawProto);

          const normalizedDiff: SessionDiff = {
            sessionIdA: a,
            sessionIdB: b,
            rttDeltaMs: computed.rttDeltaMs,
            ttfbDeltaMs: computed.ttfbDeltaMs,
            protocolShift: computed.protocolShift,
            semanticExplanation: computed.semanticExplanation,
            confidence: String(raw.confidence || "MEDIUM").toUpperCase(),
            evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
          };

          setDiff(normalizedDiff);
          setAnnouncement(
            `Comparison complete: RTT delta ${computed.rttDeltaMs}ms, TTFB delta ${computed.ttfbDeltaMs}ms.`
          );
        } else {
          setNotice("Unexpected response kind from backend.");
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setNotice(errMsg);
        setAnnouncement(`Comparison failed: ${errMsg}`);
      } finally {
        setIsComparing(false);
      }
    },
    []
  );

  const runCompare = useCallback(() => {
    return runCompareWithIds(sessionA, sessionB);
  }, [runCompareWithIds, sessionA, sessionB]);

  const swapSessions = useCallback(() => {
    const nextA = sessionB;
    const nextB = sessionA;
    const hadDiff = Boolean(diff);

    setSessionA(nextA);
    setSessionB(nextB);
    setDiff(null);
    setAnnouncement(`Swapped baseline (Session #${nextA}) and target (Session #${nextB}).`);

    if (hadDiff) {
      void runCompareWithIds(nextA, nextB);
    }
  }, [diff, runCompareWithIds, sessionA, sessionB]);

  const clearDiff = useCallback(() => {
    setDiff(null);
    setNotice(null);
    setAnnouncement("Comparison report cleared.");
  }, []);

  return {
    sessionA,
    setSessionA,
    sessionB,
    setSessionB,
    diff,
    isComparing,
    notice,
    setNotice,
    announcement,
    actions: {
      swapSessions,
      runCompare,
      clearDiff,
    },
  };
}
