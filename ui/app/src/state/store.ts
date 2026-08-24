// The normalized client store. The engine pushes *deltas* on the
// live channels; components subscribe and re-render only what changed rather
// than re-fetching snapshots. This is the leading edge of the 60-fps strategy
// — kept deliberately tiny and framework-light so a future viz
// migration never has to touch it.

import { useSyncExternalStore } from "react";
import type { NarrativeCard, MonitorSnapshot } from "@netpulse/contract";

interface State {
 /** Feed cards, newest first. Bounded so the store never grows
   *  without limit; virtualization shows only what's on screen. */
  feed: NarrativeCard[];
  /** Latest monitoring snapshot, or null before the first arrives. */
  monitor: MonitorSnapshot | null;
  /** Authoritative capture session identifier (changes on restart/reconnect). */
  captureSessionId: string | null;
  /** Monotonically increasing snapshot ingestion sequence number. */
  snapshotSequence: number;
  /** Rolling total-bytes-observed samples, one per snapshot, for a throughput
   *  trend. Bounded — a sparkline, not a historian. */
  throughput: number[];
  /** Rolling host count samples for KPI sparkline trends. */
  hostsHistory: number[];
  /** Rolling active flow count samples for KPI sparkline trends. */
  flowsHistory: number[];
  /** Rolling card count samples for KPI sparkline trends. */
  cardsHistory: number[];
  /** Last connection or IPC error, or null when healthy. */
  error: string | null;
}

const MAX_FEED = 1000;
const MAX_SAMPLES = 60;

let state: State = {
  feed: [],
  monitor: null,
  captureSessionId: `session-${Date.now()}`,
  snapshotSequence: 0,
  throughput: [],
  hostsHistory: [],
  flowsHistory: [],
  cardsHistory: [],
  error: null,
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reset capture session lineage on reconnect, restart, or interface change. */
export function resetSession(newSessionId?: string): void {
  state = {
    ...state,
    captureSessionId: newSessionId || `session-${Date.now()}`,
    snapshotSequence: 0,
  };
  emit();
}

/** Apply a batch of new feed cards as a delta: prepend newest,
 *  bound the length. Replaces the array identity so `useSyncExternalStore`
 *  detects the change. Used by the live event channel. */
export function pushCards(cards: NarrativeCard[]): void {
  if (cards.length === 0) return;
  const existingMap = new Map<string, NarrativeCard>();
  for (const c of cards) {
    const key = `${c.at_mono_nanos}-${c.headline}`;
    existingMap.set(key, c);
  }
  for (const c of state.feed) {
    const key = `${c.at_mono_nanos}-${c.headline}`;
    if (!existingMap.has(key)) {
      existingMap.set(key, c);
    }
  }
  const merged = Array.from(existingMap.values())
    .sort((a, b) => b.at_mono_nanos - a.at_mono_nanos)
    .slice(0, MAX_FEED);
  const cardsHistory = [...state.cardsHistory, merged.length].slice(-MAX_SAMPLES);
  state = { ...state, feed: merged, cardsHistory };
  emit();
}

/** Replace the whole feed with a fresh snapshot. The pull query
 *  returns the full current feed newest-first, so a poll *replaces* rather than
 *  prepends — otherwise re-polling would duplicate every card. */
export function setFeed(cards: NarrativeCard[]): void {
  const feed = cards.slice(0, MAX_FEED);
  const cardsHistory = [...state.cardsHistory, feed.length].slice(-MAX_SAMPLES);
  state = { ...state, feed, cardsHistory };
  emit();
}

/** Replace the current monitoring snapshot and append samples
 *  (total bytes, hosts count, flows count) to bounded trend histories.
 *  Assigns authoritative snapshotSequence exactly once upon ingestion. */
export function setMonitor(snapshot: MonitorSnapshot): void {
  const total = snapshot.by_protocol.rows.reduce((s, r) => s + r.bytes, 0);
  const hosts = snapshot.by_host.rows.length;
  const flows = snapshot.by_host.rows.reduce((s, r) => s + r.flows, 0);

  const throughput = [...state.throughput, total].slice(-MAX_SAMPLES);
  const hostsHistory = [...state.hostsHistory, hosts].slice(-MAX_SAMPLES);
  const flowsHistory = [...state.flowsHistory, flows].slice(-MAX_SAMPLES);

  state = {
    ...state,
    monitor: snapshot,
    snapshotSequence: state.snapshotSequence + 1,
    throughput,
    hostsHistory,
    flowsHistory,
  };
  emit();
}

/** Set or clear connection/engine error state. */
export function setError(error: string | null): void {
  if (state.error !== error) {
    state = { ...state, error };
    emit();
  }
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
  state = {
    feed: [],
    monitor: null,
    throughput: [],
    hostsHistory: [],
    flowsHistory: [],
    cardsHistory: [],
    error: null,
    captureSessionId: "default-session",
    snapshotSequence: 0,
  };
}
