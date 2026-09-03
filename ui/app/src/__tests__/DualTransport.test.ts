import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { query, command, checkBackendHealth, IpcError } from "../ipc";
import type { Query, Command } from "@netpulse/contract";

describe("Dual Transport & IpcError Classification", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends query over /api/query with Content-Type: application/json in browser mode", async () => {
    const mockResponse = {
      kind: "handshake",
      handshake: {
        compatible: true,
        host_version: 6,
        negotiated_version: 6,
        min_supported_version: 5,
        warning_code: null,
        warning: null,
        error_code: null,
        error: null,
      },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchSpy as any;

    const q: Query = { kind: "handshake", client_version: 6 };
    const res = await query(q);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/query",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(q),
      })
    );
    expect(res).toEqual(mockResponse);
  });

  it("sends command over /api/command with Content-Type: application/json in browser mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });
    globalThis.fetch = fetchSpy as any;

    const c: Command = { kind: "startCapture", iface_id: 0 };
    await command(c);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/command",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      })
    );
  });

  it("semantically classifies network-level TypeError as BACKEND_UNAVAILABLE", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const q: Query = { kind: "interfaces" };
    await expect(query(q)).rejects.toThrowError(IpcError);

    try {
      await query(q);
    } catch (e: any) {
      expect(e).toBeInstanceOf(IpcError);
      expect(e.code).toBe("BACKEND_UNAVAILABLE");
    }
  });

  it("semantically classifies AbortError as TIMEOUT", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    const c: Command = { kind: "startCapture", iface_id: 0 };
    try {
      await command(c);
    } catch (e: any) {
      expect(e).toBeInstanceOf(IpcError);
      expect(e.code).toBe("TIMEOUT");
    }
  });

  it("classifies HTTP 415 as UNSUPPORTED_MEDIA_TYPE", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 415,
      statusText: "Unsupported Media Type",
      json: async () => ({
        error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" },
      }),
    });

    try {
      await query({ kind: "interfaces" });
    } catch (e: any) {
      expect(e).toBeInstanceOf(IpcError);
      expect(e.code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(e.status).toBe(415);
    }
  });

  it("classifies HTTP 400 as INVALID_REQUEST", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: { code: "INVALID_REQUEST", message: "Unknown query kind" },
      }),
    });

    try {
      await query({ kind: "interfaces" });
    } catch (e: any) {
      expect(e).toBeInstanceOf(IpcError);
      expect(e.code).toBe("INVALID_REQUEST");
      expect(e.status).toBe(400);
    }
  });

  it("checks backend health via GET /api/health", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", version: "0.1.0", capture_running: false }),
    });

    const health = await checkBackendHealth();
    expect(health).toEqual({ status: "ok", version: "0.1.0", capture_running: false });
  });

  it("returns null on backend health check failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const health = await checkBackendHealth();
    expect(health).toBeNull();
  });
});
