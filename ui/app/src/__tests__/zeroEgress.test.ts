import { describe, it, expect, vi } from "vitest";
import { enrichHost, resolveGeo, resolveAsn, clearGeoCaches, classifyIpAddress } from "@netpulse/viz";
import type { BreakdownRow } from "@netpulse/contract";

describe("Zero-Egress Security Invariant Verification in @netpulse/app", () => {
  it("executes IP classification and GeoIP/ASN enrichment with ZERO network egress", () => {
    clearGeoCaches();

    const fetchSpy = vi.fn();
    const xhrOpenSpy = vi.fn();
    const wsSpy = vi.fn();
    const beaconSpy = vi.fn();

    const originalFetch = globalThis.fetch;
    const originalXHR = (globalThis as any).XMLHttpRequest;
    const originalWebSocket = (globalThis as any).WebSocket;
    const originalSendBeacon = typeof navigator !== "undefined" ? navigator.sendBeacon : undefined;

    globalThis.fetch = fetchSpy as any;
    (globalThis as any).XMLHttpRequest = vi.fn().mockImplementation(() => ({
      open: xhrOpenSpy,
      send: vi.fn(),
    }));
    (globalThis as any).WebSocket = wsSpy;
    if (typeof navigator !== "undefined") {
      navigator.sendBeacon = beaconSpy as any;
    }

    try {
      const ips = [
        "1.1.1.1",
        "8.8.8.8",
        "9.9.9.9",
        "13.107.4.50",
        "17.253.144.10",
        "20.190.159.0",
        "31.13.72.36",
        "46.137.0.1",
        "52.95.110.1",
        "104.16.123.96",
        "142.250.190.46",
        "151.101.1.69",
        "173.223.162.139",
        "185.199.108.153",
        "193.0.0.1",
        "208.67.222.222",
        "10.0.0.1",
        "192.168.1.1",
        "172.16.0.1",
        "127.0.0.1",
        "239.255.255.250",
        "169.254.1.1",
        "100.64.1.1",
        "93.184.216.34",
      ];

      for (let i = 0; i < 50; i++) {
        for (const ip of ips) {
          const classification = classifyIpAddress(ip);
          expect(classification).toBeDefined();

          const geo = resolveGeo(ip);
          expect(geo).toBeDefined();

          const asn = resolveAsn(ip);
          expect(asn).toBeDefined();

          const row: BreakdownRow = {
            label: ip,
            bytes: 5000 + i * 10,
            flows: 2,
            hostnames: [],
            evidence: [],
          };
          const enriched = enrichHost(row, 0);
          expect(enriched.ip).toBe(ip);
        }
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy).not.toHaveBeenCalled();
      expect(wsSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as any).XMLHttpRequest = originalXHR;
      (globalThis as any).WebSocket = originalWebSocket;
      if (typeof navigator !== "undefined" && originalSendBeacon) {
        navigator.sendBeacon = originalSendBeacon;
      }
    }
  });
});
