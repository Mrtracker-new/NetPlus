import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SecondaryGeoService,
  SecondaryGeoEvidence,
  SecondaryGeoProvider,
} from "../geo/secondaryGeoProvider";

describe("Secondary Geo Provider Abstraction (Zero-Egress & Safe Async Pipeline)", () => {
  it("enforces testable zero-egress guarantee when disabled (default)", async () => {
    const mockFetchEvidence = vi.fn();
    const mockProvider: SecondaryGeoProvider = {
      name: "test-provider",
      fetchEvidence: mockFetchEvidence,
    };

    // Disabled by default
    const service = new SecondaryGeoService(mockProvider, { enabled: false });
    expect(service.isEnabled()).toBe(false);

    const result = await service.resolveEvidence("8.8.8.8");
    expect(result).toBeNull();
    // Zero provider calls
    expect(mockFetchEvidence).not.toHaveBeenCalled();
  });

  it("caches positive results and prevents redundant network egress", async () => {
    const mockEvidence: SecondaryGeoEvidence = {
      ip: "93.184.216.34",
      country: "United States",
      countryCode: "US",
      city: "Norwell",
      latitude: 42.1508,
      longitude: -70.8228,
      accuracyRadiusKm: 50,
      confidence: "medium",
      source: "secondary_provider",
      providerName: "mock-api",
      fetchedAt: Date.now(),
      ttlSeconds: 3600,
    };

    const mockFetchEvidence = vi.fn().mockResolvedValue(mockEvidence);
    const mockProvider: SecondaryGeoProvider = {
      name: "mock-api",
      fetchEvidence: mockFetchEvidence,
    };

    const service = new SecondaryGeoService(mockProvider, { enabled: true });

    // Call 1: network query
    const res1 = await service.resolveEvidence("93.184.216.34");
    expect(res1).toEqual(mockEvidence);
    expect(mockFetchEvidence).toHaveBeenCalledTimes(1);

    // Call 2: served from cache
    const res2 = await service.resolveEvidence("93.184.216.34");
    expect(res2).toEqual(mockEvidence);
    expect(mockFetchEvidence).toHaveBeenCalledTimes(1); // No new network call
  });

  it("deduplicates simultaneous in-flight requests for the same IP", async () => {
    let resolvePromise: (val: SecondaryGeoEvidence | null) => void;
    const pendingPromise = new Promise<SecondaryGeoEvidence | null>((resolve) => {
      resolvePromise = resolve;
    });

    const mockFetchEvidence = vi.fn().mockReturnValue(pendingPromise);
    const mockProvider: SecondaryGeoProvider = {
      name: "dedup-api",
      fetchEvidence: mockFetchEvidence,
    };

    const service = new SecondaryGeoService(mockProvider, { enabled: true });

    // Launch two concurrent requests for same IP
    const p1 = service.resolveEvidence("198.51.100.5");
    const p2 = service.resolveEvidence("198.51.100.5");

    expect(mockFetchEvidence).toHaveBeenCalledTimes(1);

    const mockEvidence: SecondaryGeoEvidence = {
      ip: "198.51.100.5",
      country: "Germany",
      countryCode: "DE",
      confidence: "low",
      source: "secondary_provider",
      providerName: "dedup-api",
      fetchedAt: Date.now(),
      ttlSeconds: 600,
    };
    resolvePromise!(mockEvidence);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toEqual(mockEvidence);
    expect(res2).toEqual(mockEvidence);
  });

  it("enforces negative caching for failed or missing lookups", async () => {
    const mockFetchEvidence = vi.fn().mockResolvedValue(null);
    const mockProvider: SecondaryGeoProvider = {
      name: "empty-api",
      fetchEvidence: mockFetchEvidence,
    };

    const service = new SecondaryGeoService(mockProvider, { enabled: true });

    const res1 = await service.resolveEvidence("198.51.100.99");
    expect(res1).toBeNull();
    expect(mockFetchEvidence).toHaveBeenCalledTimes(1);

    // Subsequent call hits negative cache
    const res2 = await service.resolveEvidence("198.51.100.99");
    expect(res2).toBeNull();
    expect(mockFetchEvidence).toHaveBeenCalledTimes(1);
  });
});
