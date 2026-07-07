// The data pump (docs/09 §7). Nothing else feeds the client store, so this hook
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
import { pushCards, setFeed, setMonitor } from "./store";
import { useDisclosure } from "../modes/DisclosureContext";

// Whole-history window; the engine bounds what it returns (docs/09 §7).
const FROM = 0;
const TO = Number.MAX_SAFE_INTEGER;
// A calm cadence — fast enough to feel live, slow enough to stay at 60 fps
// (docs/09 §13). Event deltas cover the gaps when capture is active.
const POLL_MS = 1500;

/** True when running inside the Tauri webview (vs. the plain browser preview),
 *  so we only wire native event listeners where they exist. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function refresh(depth: ProjectionDepth, cancelled: () => boolean): Promise<void> {
  try {
    const res = await query({ kind: "narrativeFeed", from_mono_nanos: FROM, to_mono_nanos: TO, depth });
    if (!cancelled() && res.kind === "narrativeFeed") setFeed(res.cards);
  } catch {
    // Browser preview (no backend) or a transient IPC error — screens keep their
    // honest empty states rather than crashing (docs/02 §11).
  }
  try {
    const res = await query({ kind: "monitorSnapshot", from_mono_nanos: FROM, to_mono_nanos: TO });
    if (!cancelled() && res.kind === "monitorSnapshot") setMonitor(res.snapshot);
  } catch {
    /* see above */
  }
}

/** Mount once near the app root: begins polling and (in Tauri) live event
 *  subscription, re-priming whenever the disclosure depth changes so the feed is
 *  projected at the right level (docs/09 §6.3). */
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
          listen<NarrativeCard[]>("feed-delta", (e) => pushCards(e.payload)).then((u) =>
            unlisten.push(u),
          );
          listen<MonitorSnapshot>("monitor-snapshot", (e) => setMonitor(e.payload)).then((u) =>
            unlisten.push(u),
          );
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
