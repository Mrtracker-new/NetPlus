import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ReplayState } from "@netpulse/contract";
import { query, command } from "../ipc";

export type ReplayStatus =
  | "idle"
  | "loading"
  | "paused"
  | "playing"
  | "seeking"
  | "completed"
  | "error";

export function formatDuration(nanos: number): string {
  if (nanos <= 0) return "00:00.000";
  const totalMs = Math.floor(nanos / 1_000_000);
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  const mss = ms.toString().padStart(3, "0");

  return `${mm}:${ss}.${mss}`;
}

export function useReplayController() {
  const [state, setState] = useState<ReplayState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchReplayState = useCallback(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "replayState" });
      if (res.kind === "replayState") {
        setState(res.state);
      } else {
        setState(null);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setState(null);
      setNotice(errMsg);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Smart polling: poll fast (250ms) when playing, slower (2s) when paused
  useEffect(() => {
    void fetchReplayState();
    const intervalMs = state?.playing ? 250 : 2000;
    const timer = setInterval(() => {
      void fetchReplayState();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [fetchReplayState, state?.playing]);

  // Derived Replay Status State Machine
  const status: ReplayStatus = useMemo(() => {
    if (!loaded) return "loading";
    if (!state || state.total_nanos === 0) return "idle";
    if (state.position_nanos >= state.total_nanos && state.total_nanos > 0) return "completed";
    if (state.playing) return "playing";
    return "paused";
  }, [loaded, state]);

  // Transport Control Handlers with Optimistic Updates
  const play = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    setState((prev) => (prev ? { ...prev, playing: true } : prev));
    setAnnouncement("Started playback.");
    try {
      await command({ kind: "replayPlay" });
      await fetchReplayState();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setState((prev) => (prev ? { ...prev, playing: false } : prev));
    } finally {
      setBusy(false);
    }
  }, [fetchReplayState]);

  const pause = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    setState((prev) => (prev ? { ...prev, playing: false } : prev));
    setAnnouncement("Paused playback.");
    try {
      await command({ kind: "replayPause" });
      await fetchReplayState();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
    } finally {
      setBusy(false);
    }
  }, [fetchReplayState]);

  const step = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    setAnnouncement("Stepped to next frame.");
    try {
      await command({ kind: "replayStep" });
      await fetchReplayState();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
    } finally {
      setBusy(false);
    }
  }, [fetchReplayState]);

  const setSpeed = useCallback(
    async (percent: number) => {
      setNotice(null);
      setBusy(true);
      const speedMult = percent / 100;
      setState((prev) => (prev ? { ...prev, speed_percent: percent } : prev));
      setAnnouncement(`Set playback speed to ${speedMult}x.`);
      try {
        await command({ kind: "replaySetSpeed", percent });
        await fetchReplayState();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setNotice(errMsg);
      } finally {
        setBusy(false);
      }
    },
    [fetchReplayState]
  );

  const seek = useCallback(
    (monoNanos: number) => {
      setNotice(null);
      setState((prev) => (prev ? { ...prev, position_nanos: monoNanos } : prev));

      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
      }

      seekTimerRef.current = setTimeout(async () => {
        try {
          await command({ kind: "replaySeek", mono_nanos: monoNanos });
          setAnnouncement(`Seeked to ${formatDuration(monoNanos)}.`);
          await fetchReplayState();
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          setNotice(errMsg);
        }
      }, 150);
    },
    [fetchReplayState]
  );

  // Derived ViewModel
  const viewModel = useMemo(() => {
    const hasRecording = !!state && state.total_nanos > 0;
    const pos = state?.position_nanos ?? 0;
    const tot = state?.total_nanos ?? 0;
    const progressPct = tot > 0 ? Math.min(100, Math.max(0, (pos / tot) * 100)) : 0;
    const speedMult = (state?.speed_percent ?? 100) / 100;

    return {
      hasRecording,
      canPlay: hasRecording && status !== "playing",
      canPause: hasRecording && status === "playing",
      canStep: hasRecording,
      canSeek: hasRecording,
      progressPct: Math.round(progressPct * 10) / 10,
      formattedPosition: formatDuration(pos),
      formattedTotal: formatDuration(tot),
      speedLabel: `${speedMult}×`,
      activeSpeedPercent: state?.speed_percent ?? 100,
      frameIndex: state?.frame_index ?? 0,
      incomplete: state?.incomplete ?? false,
    };
  }, [state, status]);

  return {
    state,
    status,
    viewModel,
    loaded,
    busy,
    notice,
    setNotice,
    play,
    pause,
    step,
    setSpeed,
    seek,
    refresh: fetchReplayState,
    announcement,
  };
}
