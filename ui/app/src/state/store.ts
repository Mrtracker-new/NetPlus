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
  /** Rolling total-bytes-observed samples, one per snapshot, for a throughput
   *  trend (docs/11 §7). Bounded — a sparkline, not a historian. */
  throughput: number[];
}

const MAX_FEED = 1000;
const MAX_SAMPLES = 60;

let state: State = { feed: [], monitor: null, throughput: [] };
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
 *  detects the change. Used by the live event channel (docs/09 §7). */
export function pushCards(cards: NarrativeCard[]): void {
  if (cards.length === 0) return;
  const merged = [...cards, ...state.feed].slice(0, MAX_FEED);
  state = { ...state, feed: merged };
  emit();
}

/** Replace the whole feed with a fresh snapshot (docs/09 §5.3). The pull query
 *  returns the full current feed newest-first, so a poll *replaces* rather than
 *  prepends — otherwise re-polling would duplicate every card. */
export function setFeed(cards: NarrativeCard[]): void {
  state = { ...state, feed: cards.slice(0, MAX_FEED) };
  emit();
}

/** Replace the current monitoring snapshot (docs/11 §7) and append a throughput
 *  sample (total bytes across protocols) to the bounded trend history. */
export function setMonitor(snapshot: MonitorSnapshot): void {
  const total = snapshot.by_protocol.rows.reduce((s, r) => s + r.bytes, 0);
  const throughput = [...state.throughput, total].slice(-MAX_SAMPLES);
  state = { ...state, monitor: snapshot, throughput };
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
  state = { feed: [], monitor: null, throughput: [] };
}
