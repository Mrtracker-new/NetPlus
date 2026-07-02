// The normalized client store (docs/09 §7). The engine pushes *deltas* on the
// live channels; components subscribe and re-render only what changed rather
// than re-fetching snapshots. This is the leading edge of the 60-fps strategy
// (docs/09 §13) — kept deliberately tiny and framework-light so a future viz
// migration never has to touch it (docs/03 §9.1).

import { useSyncExternalStore } from "react";
import type { NarrativeCard, MonitorSnapshot } from "@netpulse/contract";

interface State {
  /** Feed cards, newest first (docs/09 §5.3). Bounded so the store never grows
   *  without limit; virtualization shows only what's on screen (docs/09 §7). */
  feed: NarrativeCard[];
  /** Latest monitoring snapshot, or null before the first arrives. */
  monitor: MonitorSnapshot | null;
}

const MAX_FEED = 1000;

let state: State = { feed: [], monitor: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Apply a batch of new feed cards as a delta (docs/09 §7): prepend newest,
 *  bound the length. Replaces the array identity so `useSyncExternalStore`
 *  detects the change. */
export function pushCards(cards: NarrativeCard[]): void {
  if (cards.length === 0) return;
  const merged = [...cards, ...state.feed].slice(0, MAX_FEED);
  state = { ...state, feed: merged };
  emit();
}

/** Replace the current monitoring snapshot (docs/11 §7). */
export function setMonitor(snapshot: MonitorSnapshot): void {
  state = { ...state, monitor: snapshot };
  emit();
}

function getSnapshot(): State {
  return state;
}

/** Subscribe a component to the whole store. */
export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// Test-only reset; not used by the app at runtime.
export function __resetForTest(): void {
  state = { feed: [], monitor: null };
}
