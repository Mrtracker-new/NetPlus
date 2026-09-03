// The typed IPC boundary. Every call from the UI to the
// engine goes through here, so the observe-only, enumerable command surface is
// easy to audit — there is no other path. Queries and commands are typed by the
// generated contract, so a shape mismatch is a compile error, not a runtime bug.
//
// Dual-Transport Architecture:
// - Mode A (Desktop): Native Tauri IPC (window.__TAURI_INTERNALS__.invoke)
// - Mode B (Browser Dev): HTTP loopback transport over /api (proxied to 127.0.0.1:4040)
// - Mode C (Browser Standalone): Fails closed honestly with IpcError('BACKEND_UNAVAILABLE')

import { invoke } from "@tauri-apps/api/core";
import type { Command, Query, QueryResponse } from "@netpulse/contract";

export type IpcErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "LENGTH_REQUIRED"
  | "PAYLOAD_TOO_LARGE"
  | "BACKEND_ERROR";

export class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly status?: number;

  constructor(message: string, code: IpcErrorCode, status?: number) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, IpcError.prototype);
  }
}

/** True when running inside the Tauri native desktop host */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface BackendHealth {
  status: string;
  version: string;
  capture_running: boolean;
}

/** Probes the backend health endpoint (GET /api/health) or native state */
export async function checkBackendHealth(): Promise<BackendHealth | null> {
  if (inTauri()) {
    try {
      const snap = await query({ kind: "monitorSnapshot" });
      const isCapturing =
        snap.kind === "monitorSnapshot" && snap.snapshot.telemetry_state === "active";
      return { status: "ok", version: "0.1.0", capture_running: isCapturing };
    } catch {
      return null;
    }
  }

  try {
    const res = await fetch("/api/health", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as BackendHealth;
  } catch {
    return null;
  }
}

/** Run a pull query against the engine. The engine matches on the
 *  `kind` discriminant and returns the corresponding {@link QueryResponse}. */
export async function query(q: Query): Promise<QueryResponse> {
  if (inTauri()) {
    return invoke<QueryResponse>("query", { query: q });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(q),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errPayload: any;
      try {
        errPayload = await res.json();
      } catch {
        // Body is not JSON
      }
      const code: IpcErrorCode =
        errPayload?.error?.code ??
        (res.status === 415
          ? "UNSUPPORTED_MEDIA_TYPE"
          : res.status === 411
          ? "LENGTH_REQUIRED"
          : res.status === 413
          ? "PAYLOAD_TOO_LARGE"
          : res.status === 400
          ? "INVALID_REQUEST"
          : "BACKEND_ERROR");
      const message =
        errPayload?.error?.message ??
        errPayload?.error ??
        `HTTP ${res.status}: ${res.statusText}`;
      throw new IpcError(message, code, res.status);
    }

    return (await res.json()) as QueryResponse;
  } catch (err: any) {
    if (err instanceof IpcError) {
      throw err;
    }
    if (err?.name === "AbortError") {
      throw new IpcError("Query request timed out after 5000ms", "TIMEOUT");
    }
    if (err instanceof TypeError) {
      throw new IpcError(
        "NetPulse backend unavailable at /api/query. Ensure netpulse-shell is running.",
        "BACKEND_UNAVAILABLE"
      );
    }
    throw new IpcError(err?.message ?? String(err), "BACKEND_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Send a control command — the only write path UI→engine.
 *  Nothing here modifies network traffic (observe-only). */
export async function command(c: Command): Promise<void> {
  if (inTauri()) {
    await invoke("command", { command: c });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(c),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errPayload: any;
      try {
        errPayload = await res.json();
      } catch {
        // Body is not JSON
      }
      const code: IpcErrorCode =
        errPayload?.error?.code ??
        (res.status === 415
          ? "UNSUPPORTED_MEDIA_TYPE"
          : res.status === 411
          ? "LENGTH_REQUIRED"
          : res.status === 413
          ? "PAYLOAD_TOO_LARGE"
          : res.status === 400
          ? "INVALID_REQUEST"
          : "BACKEND_ERROR");
      const message =
        errPayload?.error?.message ??
        errPayload?.error ??
        `HTTP ${res.status}: ${res.statusText}`;
      throw new IpcError(message, code, res.status);
    }
  } catch (err: any) {
    if (err instanceof IpcError) {
      throw err;
    }
    if (err?.name === "AbortError") {
      throw new IpcError("Command request timed out after 5000ms", "TIMEOUT");
    }
    if (err instanceof TypeError) {
      throw new IpcError(
        "NetPulse backend unavailable at /api/command. Ensure netpulse-shell is running.",
        "BACKEND_UNAVAILABLE"
      );
    }
    throw new IpcError(err?.message ?? String(err), "BACKEND_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}
