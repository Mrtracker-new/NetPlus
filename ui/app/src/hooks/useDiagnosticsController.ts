import { useState, useCallback } from "react";
import type { PingResult, TracerouteHop, BufferbloatResult } from "@netpulse/contract";
import { query } from "../ipc";

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

  // Strip protocol schemes if present
  let cleaned = rawInput.trim().replace(/^https?:\/\//i, "").split("/")[0]!.split(":")[0]!.trim();

  if (!cleaned) return { isValid: false, normalized: "" };

  if (cleaned.toLowerCase() === "localhost") {
    return { isValid: true, normalized: "localhost" };
  }

  // IPv4 regex
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (ipv4Regex.test(cleaned)) {
    return { isValid: true, normalized: cleaned };
  }

  // IPv6 regex
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$/;
  if (ipv6Regex.test(cleaned)) {
    return { isValid: true, normalized: cleaned };
  }

  // Domain regex
  const domainRegex = /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
  if (domainRegex.test(cleaned)) {
    return { isValid: true, normalized: cleaned };
  }

  return { isValid: false, normalized: cleaned };
}

export function useDiagnosticsController() {
  const [target, setTarget] = useState("1.1.1.1");
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [pingProbe, setPingProbe] = useState<ProbeState<ExtendedPingResult>>({ status: "idle" });
  const [traceProbe, setTraceProbe] = useState<ProbeState<TracerouteHop[]>>({ status: "idle" });
  const [bloatProbe, setBloatProbe] = useState<ProbeState<BufferbloatResult>>({ status: "idle" });

  const runPing = useCallback(async () => {
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
        };

        setPingProbe({
          status: "success",
          result: extendedResult,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Ping probe completed for ${normalized} with ${lossPct}% loss.`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setPingProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Ping probe failed: ${errMsg}`);
    }
  }, [target]);

  const runTraceroute = useCallback(async () => {
    setNotice(null);
    const { isValid, normalized } = validateAndNormalizeTarget(target);
    if (!isValid) {
      setNotice("invalid_target");
      return;
    }

    setTraceProbe({ status: "running", startedAt: Date.now() });
    setAnnouncement(`Running traceroute to ${normalized}...`);

    try {
      const res = await query({ kind: "runTraceroute", target: normalized, transport: "icmp", max_hops: 10 });
      if (res.kind === "tracerouteResult") {
        const normalizedHops: TracerouteHop[] = res.hops.map((h: TracerouteHop) => ({
          ttl: Number(h.ttl ?? 0),
          ip: String(h.ip ?? ""),
          hostname: h.hostname || null,
          rttMs: Number(h.rttMs ?? 0),
          status: h.status,
        }));

        setTraceProbe({
          status: "success",
          result: normalizedHops,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Traceroute completed for ${normalized} with ${normalizedHops.length} hops.`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setTraceProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Traceroute failed: ${errMsg}`);
    }
  }, [target]);

  const runBufferbloat = useCallback(async () => {
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
        };

        setBloatProbe({
          status: "success",
          result: normalizedResult,
          finishedAt: Date.now(),
        });
        setAnnouncement(`Bufferbloat test completed with grade ${normalizedResult.grade}.`);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setBloatProbe({ status: "error", error: errMsg });
      setNotice(errMsg);
      setAnnouncement(`Bufferbloat test failed: ${errMsg}`);
    }
  }, [target]);

  const clearResults = useCallback(() => {
    setPingProbe({ status: "idle" });
    setTraceProbe({ status: "idle" });
    setBloatProbe({ status: "idle" });
    setNotice(null);
    setAnnouncement("Diagnostic probe results cleared.");
  }, []);

  const hasAnyResults =
    pingProbe.status === "success" ||
    traceProbe.status === "success" ||
    bloatProbe.status === "success";

  const isAnyBusy =
    pingProbe.status === "running" ||
    traceProbe.status === "running" ||
    bloatProbe.status === "running";

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
    busy: {
      ping: pingProbe.status === "running",
      traceroute: traceProbe.status === "running",
      bufferbloat: bloatProbe.status === "running",
    },
    hasAnyResults,
    isAnyBusy,
    actions: {
      runPing,
      runTraceroute,
      runBufferbloat,
      clearResults,
    },
  };
}
