// The data pump. Nothing else feeds the client store, so this hook
// is what turns the static screens into live ones: it pulls the narrative feed
// and the monitoring snapshot from the engine and, when running inside Tauri,
// subscribes to the engine's live delta events so capture updates appear without
// waiting for the next poll.
//
// Two mechanisms, deliberately layered:
//  - **Polling** always works (browser preview included) and is the reliable
//    floor; it *replaces* the feed with the engine's current snapshot.
//  - **Events** (`feed-delta`, `monitor-snapshot`) are emitted by the shell while
//    live capture runs (see src-tauri) for low-latency updates; they *prepend*
//    deltas. Absent Tauri, this is simply skipped.

import { useEffect } from "react";
import type { NarrativeCard, MonitorSnapshot, ProjectionDepth } from "@netpulse/contract";
import { query } from "../ipc";
import { setSnapshotBatch, pushCards, setMonitor, setError } from "./store";
import { useDisclosure } from "../modes/DisclosureContext";
import { getActiveMonitorTimeRange } from "../screens/Monitoring/MonitoringPreferences";

// A calm cadence — fast enough to feel live, slow enough to stay at 60 fps
// Event deltas cover the gaps when capture is active.
const POLL_MS = 1500;

/** True when running inside the Tauri webview (vs. the plain browser preview),
 *  so we only wire native event listeners where they exist. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let isRefreshing = false;
let pendingRefresh = false;
let activeDepth: ProjectionDepth = "beginner";

export function triggerLiveRefresh(): void {
  refresh(activeDepth, () => false);
}

async function refresh(depth: ProjectionDepth, cancelled: () => boolean): Promise<void> {
  activeDepth = depth;
  if (cancelled()) return;
  if (isRefreshing) {
    pendingRefresh = true;
    return;
  }
  isRefreshing = true;

  const time_range = getActiveMonitorTimeRange();

  try {
    const [feedResult, monitorResult] = await Promise.allSettled([
      query({ kind: "narrativeFeed", depth }),
      query({ kind: "monitorSnapshot", time_range }),
    ]);

    if (cancelled()) return;

    let cards: NarrativeCard[] | null = null;
    let snapshot: MonitorSnapshot | null = null;
    let caughtError: string | null = null;

    if (feedResult.status === "fulfilled" && feedResult.value.kind === "narrativeFeed") {
      cards = feedResult.value.cards;
    } else if (feedResult.status === "rejected" && inTauri()) {
      caughtError = String(feedResult.reason);
    }

    if (monitorResult.status === "fulfilled" && monitorResult.value.kind === "monitorSnapshot") {
      snapshot = monitorResult.value.snapshot;
    } else if (monitorResult.status === "rejected" && inTauri()) {
      caughtError = String(monitorResult.reason);
    }

    if (cards != null || snapshot != null) {
      setSnapshotBatch(cards, snapshot, caughtError ?? null);
    } else if (caughtError != null) {
      setError(caughtError);
    }
  } catch (e) {
    if (!cancelled() && inTauri()) {
      setError(String(e));
    }
  } finally {
    isRefreshing = false;
    if (pendingRefresh && !cancelled()) {
      pendingRefresh = false;
      refresh(activeDepth, cancelled);
    }
  }
}

/** Mount once near the app root: begins polling and (in Tauri) live event
 *  subscription, re-priming whenever the disclosure depth changes so the feed is
 *  projected at the right level. */
export function useLiveData(): void {
  const { depth } = useDisclosure();

  useEffect(() => {
    let done = false;
    const cancelled = () => done;

    refresh(depth, cancelled);
    const timer = setInterval(() => refresh(depth, cancelled), POLL_MS);

    // Native live channels — only in Tauri. `listen` is dynamically imported so
    // the browser preview never pulls the native module.
    const unlisten: Array<() => void> = [];
    if (inTauri()) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          if (done) return;
          listen<NarrativeCard[]>("feed-delta", (e) => pushCards(e.payload)).then((u) => {
            if (done) u();
            else unlisten.push(u);
          });
          listen<MonitorSnapshot>("monitor-snapshot", (e) => setMonitor(e.payload)).then((u) => {
            if (done) u();
            else unlisten.push(u);
          });
        })
        .catch(() => {
          /* events unavailable — polling still covers us */
        });
    }

    return () => {
      done = true;
      clearInterval(timer);
      for (const u of unlisten) u();
    };
  }, [depth]);
}
