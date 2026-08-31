import { useState, useCallback, useRef, useEffect } from "react";
import type { PingResult, TracerouteHop, BufferbloatResult } from "@netpulse/contract";
import { query } from "../ipc";
import { executeDiagnosticPipeline, type DiagnosticSession } from "../diagnostic";

export type ProbeStatus = "idle" | "running" | "success" | "error";

export interface ProbeState<T> {
  status: ProbeStatus;
  result?: T;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ExtendedPingResult extends PingResult {
  jitterMs: number;
}

/** Cleanly format milliseconds to max 1 decimal place (e.g. 13.599999 -> "13.6") */
export function formatMs(val: number): string {
  if (isNaN(val) || val === null || val === undefined) return "0";
  const rounded = Math.round(val * 10) / 10;
  return String(rounded);
}

/** Validate & normalize target input (IPv4, IPv6, domain, localhost, URL stripping) */
export function validateAndNormalizeTarget(rawInput: string): { isValid: boolean; normalized: string } {
  if (!rawInput) return { isValid: false, normalized: "" };

  let trimmed = rawInput.trim();
  // Strip protocol schemes if present
  trimmed = trimmed.replace(/^https?:\/\//i, "");

  // Strip path and query parameters
  trimmed = trimmed.split("/")[0]!.split("?")[0]!.trim();

  if (!trimmed) return { isValid: false, normalized: "" };

  let host = trimmed;

  // Handle bracketed IPv6 with optional port: [2001:db8::1]:8080 or [::1]
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    if (endBracket !== -1) {
      host = host.substring(1, endBracket);
    }
  } else {
    // If not bracketed and contains exactly ONE colon, treat as host:port (e.g. example.com:80 or 1.1.1.1:53)
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount === 1) {
      host = host.split(":")[0]!;
    }
  }

  if (host.toLowerCase() === "localhost") {
    return { isValid: true, normalized: "localhost" };
  }

  // IPv4 regex (valid 0-255 octets)
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(host)) {
    return { isValid: true, normalized: host };
  }

  // Standard comprehensive IPv6 regex (supporting :: compression, link-local, full 8 groups)
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:))|(([0-9a-fA-F]{1,4}:){1,6}:)|(([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2})|(([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3})|(([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4})|(([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5})|([0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6}))|(:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
  if (ipv6Regex.test(host)) {
    return { isValid: true, normalized: host };
  }

  // Domain regex (RFC 1123 compliant domain labels)
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (domainRegex.test(host)) {
    return { isValid: true, normalized: host };
  }

  return { isValid: false, normalized: host };
}

export function useDiagnosticsController() {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [target, setTarget] = useState("1.1.1.1");
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [pingProbe, setPingProbe] = useState<ProbeState<ExtendedPingResult>>({ status: "idle" });
  const [traceProbe, setTraceProbe] = useState<ProbeState<TracerouteHop[]>>({ status: "idle" });
  const [bloatProbe, setBloatProbe] = useState<ProbeState<BufferbloatResult>>({ status: "idle" });

  const [deepSession, setDeepSession] = useState<DiagnosticSession | null>(null);
  const [deepStage, setDeepStage] = useState<string | null>(null);
  const [isDeepBusy, setIsDeepBusy] = useState(false);

  const isAnyBusy =
    pingProbe.status === "running" ||
    traceProbe.status === "running" ||
    bloatProbe.status === "running" ||
    isDeepBusy;

  const runPing = useCallback(async () => {
    if (isAnyBusy) return;
    setNotice(null);
    const { isValid, normalized } = validateAndNormalizeTarget(target);
    if (!isValid) {
      setNotice("invalid_target");
      return;
    }

    setPingProbe({ status: "running", startedAt: Date.now() });
    setAnnouncement(`Running ping probe to ${normalized}...`);

    try {
      const res = await query({ kind: "runPing", target: normalized, count: 4 });
      if (!isMountedRef.current) return;
      if (res.kind === "pingResult") {
        const raw = res.result;
        const minRttMs = Number(raw.minRttMs ?? 0);
        const avgRttMs = Number(raw.avgRttMs ?? 0);
        const maxRttMs = Number(raw.maxRttMs ?? 0);
        const lossPct = Number(raw.lossPct ?? 0);
        const jitterMs = Math.round(Math.max(0, maxRttMs - minRttMs) * 10) / 10;

        const extendedResult: ExtendedPingResult = {
          target: raw.target || normalized,
          sent: Number(raw.sent ?? 0),
          received: Number(raw.received ?? 0),
          lossPct,
          minRttMs,
          avgRttMs,
          maxRttMs,
          stddevRttMs: Number(raw.stddevRttMs ?? 0),
          jitterMs,
          source: raw.source,
        };

        setPingProbe({
          status: "success",
          result: extendedResult,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Ping probe completed for ${normalized} with ${lossPct}% loss.`);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const errMsg = e instanceof Error ? e.message : String(e);
      setPingProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Ping probe failed: ${errMsg}`);
    }
  }, [target, isAnyBusy]);

  const runTraceroute = useCallback(async () => {
    if (isAnyBusy) return;
    setNotice(null);
    const { isValid, normalized } = validateAndNormalizeTarget(target);
    if (!isValid) {
      setNotice("invalid_target");
      return;
    }

    setTraceProbe({ status: "running", startedAt: Date.now() });
    setAnnouncement(`Running traceroute to ${normalized}...`);

    try {
      const res = await query({ kind: "runTraceroute", target: normalized, transport: "icmp", max_hops: 30 });
      if (!isMountedRef.current) return;
      if (res.kind === "tracerouteResult") {
        const normalizedHops: TracerouteHop[] = res.hops.map((h: TracerouteHop) => ({
          ttl: Number(h.ttl ?? 0),
          ip: String(h.ip ?? ""),
          hostname: h.hostname || null,
          rttMs: Number(h.rttMs ?? 0),
          status: h.status,
          source: h.source,
        }));

        setTraceProbe({
          status: "success",
          result: normalizedHops,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Traceroute completed for ${normalized} with ${normalizedHops.length} hops.`);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const errMsg = e instanceof Error ? e.message : String(e);
      setTraceProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Traceroute failed: ${errMsg}`);
    }
  }, [target, isAnyBusy]);

  const runBufferbloat = useCallback(async () => {
    if (isAnyBusy) return;
    setNotice(null);
    const { isValid, normalized } = validateAndNormalizeTarget(target);
    if (!isValid) {
      setNotice("invalid_target");
      return;
    }

    setBloatProbe({ status: "running", startedAt: Date.now() });
    setAnnouncement(`Running bufferbloat test against ${normalized}...`);

    try {
      const res = await query({ kind: "runBufferbloatTest", target: normalized });
      if (!isMountedRef.current) return;
      if (res.kind === "bufferbloatResult") {
        const raw = res.result;
        const idleRttMs = Number(raw.idleRttMs ?? 0);
        const loadedRttMs = Number(raw.loadedRttMs ?? 0);
        const deltaRttMs = Number(raw.deltaRttMs ?? 0);

        const normalizedResult: BufferbloatResult = {
          target: String(raw.target || normalized),
          idleRttMs,
          loadedRttMs,
          deltaRttMs,
          grade: String(raw.grade || "A+"),
          source: raw.source,
        };

        setBloatProbe({
          status: "success",
          result: normalizedResult,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Bufferbloat test completed with grade ${normalizedResult.grade}.`);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      const errMsg = e instanceof Error ? e.message : String(e);
      setBloatProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Bufferbloat test failed: ${errMsg}`);
    }
  }, [target, isAnyBusy]);

  const runDeepDiagnostics = useCallback(async () => {
    if (isAnyBusy) return;
    setNotice(null);
    const { isValid, normalized } = validateAndNormalizeTarget(target);
    if (!isValid) {
      setNotice("invalid_target");
      return;
    }

    setIsDeepBusy(true);
    setDeepStage("gateway");
    setAnnouncement(`Initiating full deep diagnostic pipeline for ${normalized}...`);

    try {
      const session = await executeDiagnosticPipeline({
        target: normalized,
        executor: query,
        onProgress: (currentSession) => {
          if (!isMountedRef.current) return;
          setDeepStage(currentSession.currentStep ?? null);
          setDeepSession({ ...currentSession });
        },
      });

      if (!isMountedRef.current) return;
      setDeepSession(session);
      setDeepStage(null);
      setAnnouncement(`Deep diagnostic completed with ${session.diagnoses.length} findings.`);
    } catch (e) {
      if (!isMountedRef.current) return;
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setAnnouncement(`Deep diagnostic pipeline failed: ${errMsg}`);
    } finally {
      if (isMountedRef.current) {
        setIsDeepBusy(false);
      }
    }
  }, [target, isAnyBusy]);

  const clearResults = useCallback(() => {
    setPingProbe({ status: "idle" });
    setTraceProbe({ status: "idle" });
    setBloatProbe({ status: "idle" });
    setDeepSession(null);
    setDeepStage(null);
    setIsDeepBusy(false);
    setNotice(null);
    setAnnouncement("Diagnostic probe results cleared.");
  }, []);

  const hasAnyResults =
    pingProbe.status === "success" ||
    traceProbe.status === "success" ||
    bloatProbe.status === "success" ||
    deepSession !== null;

  return {
    target,
    setTarget,
    notice,
    setNotice,
    announcement,
    probes: {
      ping: pingProbe,
      traceroute: traceProbe,
      bufferbloat: bloatProbe,
    },
    deepSession,
    deepStage,
    busy: {
      ping: pingProbe.status === "running",
      traceroute: traceProbe.status === "running",
      bufferbloat: bloatProbe.status === "running",
      deep: isDeepBusy,
    },
    hasAnyResults,
    isAnyBusy,
    actions: {
      runPing,
      runTraceroute,
      runBufferbloat,
      runDeepDiagnostics,
      clearResults,
    },
  };
}
