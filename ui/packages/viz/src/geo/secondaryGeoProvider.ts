import type { NetworkDistribution } from "./geoTypes";
import { BoundedCache } from "./boundedCache";

/**
 * Raw evidence provided by an external or secondary geographic source.
 * Architectural Invariant:
 *   - The secondary provider returns raw evidence.
 *   - The core resolver decides semantic precision and map eligibility.
 *   - The secondary provider is disabled by default for zero network egress.
 */
export interface SecondaryGeoEvidence {
  countryCode?: string;
  countryName?: string;
  country?: string;
  regionCode?: string;
  regionName?: string;
  region?: string;
  city?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  latitude?: number;
  longitude?: number;
  accuracyRadiusKm?: number;
  confidence?: "high" | "medium" | "low";
  source?: string;
  providerName?: string;
  fetchedAt?: number;
  ttlSeconds?: number;
  asn?: number;
  organization?: string;
  distribution?: NetworkDistribution;
  sourceName?: string;
}

export interface SecondaryGeoProvider {
  readonly name: string;
  lookup?(ip: string): Promise<SecondaryGeoEvidence | null>;
  fetchEvidence?(ip: string): Promise<SecondaryGeoEvidence | null>;
  isEnabled?(): boolean;
}

export interface SecondaryGeoServiceOptions {
  enabled?: boolean;
  positiveTtlMs?: number; // Default: 24 hours
  negativeTtlMs?: number; // Default: 1 hour
  timeoutMs?: number;     // Default: 1500 ms
  maxRequestsPerSecond?: number;
}

interface CacheEntry {
  evidence: SecondaryGeoEvidence | null;
  expiresAt: number;
}

/**
 * External/Secondary Enrichment Manager
 * Fully isolated from the core offline resolution path.
 */
export class SecondaryGeoService {
  private enabled: boolean;
  private positiveTtlMs: number;
  private negativeTtlMs: number;
  private timeoutMs: number;
  private maxRequestsPerSecond: number;
  private requestTimestamps: number[] = [];

  private providers: SecondaryGeoProvider[] = [];
  private cache = new BoundedCache<string, CacheEntry>(32768);
  private inFlightLookups = new Map<string, Promise<SecondaryGeoEvidence | null>>();

  constructor(
    providerOrOptions?: SecondaryGeoProvider | SecondaryGeoServiceOptions,
    options?: SecondaryGeoServiceOptions
  ) {
    const isProvider =
      providerOrOptions &&
      ("lookup" in providerOrOptions || "fetchEvidence" in providerOrOptions);

    const opts = isProvider
      ? options ?? {}
      : (providerOrOptions as SecondaryGeoServiceOptions) ?? {};

    // Zero egress by default: disabled unless explicitly enabled
    this.enabled = opts.enabled ?? false;
    this.positiveTtlMs = opts.positiveTtlMs ?? 24 * 60 * 60 * 1000;
    this.negativeTtlMs = opts.negativeTtlMs ?? 60 * 60 * 1000;
    this.timeoutMs = opts.timeoutMs ?? 1500;
    this.maxRequestsPerSecond = opts.maxRequestsPerSecond ?? 10;

    if (isProvider && providerOrOptions) {
      this.registerProvider(providerOrOptions as SecondaryGeoProvider);
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public registerProvider(provider: SecondaryGeoProvider): void {
    this.providers.push(provider);
  }

  public clearProviders(): void {
    this.providers = [];
  }

  public clearCache(): void {
    this.cache.clear();
    this.inFlightLookups.clear();
    this.requestTimestamps = [];
  }

  /**
   * Performs an asynchronous lookup for an IP address across registered providers.
   * If disabled or offline, returns null synchronously without making network calls.
   */
  public async lookup(ip: string): Promise<SecondaryGeoEvidence | null> {
    if (!this.enabled || this.providers.length === 0) {
      return null;
    }

    const normalizedIp = ip.trim();
    if (!normalizedIp) return null;

    // 1. Check bounded cache (positive & negative)
    const cached = this.cache.get(normalizedIp);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.evidence;
    }

    // 2. Check in-flight promise deduplication
    const inFlight = this.inFlightLookups.get(normalizedIp);
    if (inFlight) {
      return inFlight;
    }

    // 3. Rate limiting check (sliding window)
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < 1000);
    if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
      return null;
    }
    this.requestTimestamps.push(now);

    // 4. Execute provider lookup with timeout protection
    const lookupPromise = (async (): Promise<SecondaryGeoEvidence | null> => {
      try {
        for (const provider of this.providers) {
          if (provider.isEnabled && !provider.isEnabled()) continue;

          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => resolve(null), this.timeoutMs);
          });

          const providerFn = provider.fetchEvidence
            ? provider.fetchEvidence.bind(provider)
            : provider.lookup
            ? provider.lookup.bind(provider)
            : null;

          if (!providerFn) {
            if (timeoutId) clearTimeout(timeoutId);
            continue;
          }

          const result = await Promise.race([
            providerFn(normalizedIp).catch(() => null),
            timeoutPromise,
          ]);

          if (timeoutId) clearTimeout(timeoutId);

          if (result) {
            this.cache.set(normalizedIp, {
              evidence: result,
              expiresAt: Date.now() + this.positiveTtlMs,
            });
            return result;
          }
        }

        // Negative caching on non-match
        this.cache.set(normalizedIp, {
          evidence: null,
          expiresAt: Date.now() + this.negativeTtlMs,
        });
        return null;
      } finally {
        this.inFlightLookups.delete(normalizedIp);
      }
    })();

    this.inFlightLookups.set(normalizedIp, lookupPromise);
    return lookupPromise;
  }

  /**
   * Alias for lookup() to retrieve secondary evidence safely.
   */
  public async resolveEvidence(ip: string): Promise<SecondaryGeoEvidence | null> {
    return this.lookup(ip);
  }
}

/**
 * Global singleton for secondary geo enrichment.
 * Invariant: disabled by default (zero egress).
 */
export const defaultSecondaryGeoService = new SecondaryGeoService({ enabled: false });
