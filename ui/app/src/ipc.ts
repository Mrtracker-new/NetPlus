// The typed IPC boundary (docs/02 §7, docs/03 §8). Every call from the UI to the
// engine goes through here, so the observe-only, enumerable command surface is
// easy to audit — there is no other path. Queries and commands are typed by the
// generated contract, so a shape mismatch is a compile error, not a runtime bug.

import { invoke } from "@tauri-apps/api/core";
import type { Command, Query, QueryResponse } from "@netpulse/contract";

/** Run a pull query against the engine (docs/02 §7.1). The engine matches on the
 *  `kind` discriminant and returns the corresponding {@link QueryResponse}. */
export async function query(q: Query): Promise<QueryResponse> {
  return invoke<QueryResponse>("query", { query: q });
}

/** Send a control command — the only write path UI→engine (docs/02 §7.1).
 *  Nothing here modifies network traffic (observe-only, docs/01 X1). */
export async function command(c: Command): Promise<void> {
  await invoke("command", { command: c });
}
