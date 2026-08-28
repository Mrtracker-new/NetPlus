/**
 * Offline Observed-Hostname / PTR-Result Classifier
 * --------------------------------------------------
 * Privacy & Architecture Invariant:
 *   - The classifier operates 100% offline.
 *   - It NEVER performs network DNS/PTR queries.
 *   - It analyzes only hostnames already observed in telemetry (e.g. from DNS transactions or local hosts file).
 *   - It extracts non-authoritative geographic hints (GeoHint).
 *   - It NEVER manufactures latitude or longitude coordinates.
 */

import type { NetworkDistribution, ProviderHint } from "./geoTypes";

export interface GeoHint {
  locationName: string;
  city?: string;
  countryCode: string;
  regionCode?: string;
  iataCode: string;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number;
  confidence: "medium" | "low";
  source: "observed_hostname";
  matchedToken: string;
  matchKind: "edge_token" | "hostname_label" | "known_suffix";
}

export type { ProviderHint };

interface ProviderDomainRule {
  domain: string;
  provider: string;
  distribution: NetworkDistribution;
}

/**
 * Curated dictionary of major global cloud, CDN, and infrastructure domain suffixes.
 */
const KNOWN_PROVIDER_DOMAINS: ProviderDomainRule[] = [
  // Google
  { domain: "googleapis.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "googlevideo.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "youtube.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "google.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "1e100.net", provider: "Google LLC", distribution: "cloud" },
  { domain: "gstatic.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "googleusercontent.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "ggpht.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "gvt1.com", provider: "Google LLC", distribution: "cloud" },
  { domain: "gvt2.com", provider: "Google LLC", distribution: "cloud" },

  // Amazon / AWS
  { domain: "amazonaws.com", provider: "Amazon.com, Inc.", distribution: "cloud" },
  { domain: "cloudfront.net", provider: "Amazon.com, Inc.", distribution: "cloud" },
  { domain: "aws.amazon.com", provider: "Amazon.com, Inc.", distribution: "cloud" },
  { domain: "amazon.com", provider: "Amazon.com, Inc.", distribution: "cloud" },

  // Microsoft / Azure
  { domain: "azure.com", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "azurewebsites.net", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "trafficmanager.net", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "microsoft.com", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "office.com", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "live.com", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "msn.com", provider: "Microsoft Corporation", distribution: "cloud" },
  { domain: "azureedge.net", provider: "Microsoft Corporation", distribution: "cloud" },

  // Cloudflare
  { domain: "cloudflare.com", provider: "Cloudflare, Inc.", distribution: "cloud" },
  { domain: "cloudflare.net", provider: "Cloudflare, Inc.", distribution: "cloud" },
  { domain: "workers.dev", provider: "Cloudflare, Inc.", distribution: "cloud" },
  { domain: "pages.dev", provider: "Cloudflare, Inc.", distribution: "cloud" },

  // Fastly
  { domain: "fastly.net", provider: "Fastly, Inc.", distribution: "cloud" },
  { domain: "fastlylb.net", provider: "Fastly, Inc.", distribution: "cloud" },

  // Akamai
  { domain: "akamai.net", provider: "Akamai Technologies, Inc.", distribution: "cloud" },
  { domain: "akamaitechnologies.com", provider: "Akamai Technologies, Inc.", distribution: "cloud" },
  { domain: "akamaiedge.net", provider: "Akamai Technologies, Inc.", distribution: "cloud" },
  { domain: "edgesuite.net", provider: "Akamai Technologies, Inc.", distribution: "cloud" },
  { domain: "edgekey.net", provider: "Akamai Technologies, Inc.", distribution: "cloud" },

  // GitHub
  { domain: "github.com", provider: "GitHub, Inc.", distribution: "cloud" },
  { domain: "github.io", provider: "GitHub, Inc.", distribution: "cloud" },
  { domain: "githubusercontent.com", provider: "GitHub, Inc.", distribution: "cloud" },

  // Apple
  { domain: "apple.com", provider: "Apple Inc.", distribution: "cloud" },
  { domain: "icloud.com", provider: "Apple Inc.", distribution: "cloud" },
  { domain: "mzstatic.com", provider: "Apple Inc.", distribution: "cloud" },
  { domain: "apple-dns.net", provider: "Apple Inc.", distribution: "cloud" },

  // Meta
  { domain: "facebook.com", provider: "Meta Platforms, Inc.", distribution: "cloud" },
  { domain: "fbcdn.net", provider: "Meta Platforms, Inc.", distribution: "cloud" },
  { domain: "instagram.com", provider: "Meta Platforms, Inc.", distribution: "cloud" },
  { domain: "whatsapp.net", provider: "Meta Platforms, Inc.", distribution: "cloud" },

  // Hostinger
  { domain: "hostinger.com", provider: "Hostinger Operations, UAB", distribution: "cloud" },
  { domain: "hostinger.io", provider: "Hostinger Operations, UAB", distribution: "cloud" },
  { domain: "hostingermail.com", provider: "Hostinger Operations, UAB", distribution: "cloud" },

  // DigitalOcean
  { domain: "digitalocean.com", provider: "DigitalOcean, LLC", distribution: "cloud" },

  // Hetzner
  { domain: "hetzner.com", provider: "Hetzner Online GmbH", distribution: "cloud" },
  { domain: "your-server.de", provider: "Hetzner Online GmbH", distribution: "cloud" },

  // Vultr / Choopa
  { domain: "vultr.com", provider: "The Constant Company, LLC (Vultr)", distribution: "cloud" },
  { domain: "choopa.net", provider: "The Constant Company, LLC (Vultr)", distribution: "cloud" },

  // Leaseweb
  { domain: "leaseweb.com", provider: "Leaseweb Global B.V.", distribution: "cloud" },
  { domain: "leaseweb.net", provider: "Leaseweb Global B.V.", distribution: "cloud" },

  // Oracle Cloud
  { domain: "oraclecloud.com", provider: "Oracle Corporation", distribution: "cloud" },

  // Alibaba Cloud
  { domain: "alibabacloud.com", provider: "Alibaba Group", distribution: "cloud" },
  { domain: "aliyun.com", provider: "Alibaba Group", distribution: "cloud" },
];

/**
 * Extracts a non-authoritative provider hint from an observed hostname.
 * Requires exact domain match or subdomain boundary (e.g. "ajax.googleapis.com" matches "googleapis.com",
 * but "fakegoogleapis.com" is strictly rejected).
 * Handles trailing FQDN dots (RFC 1035 root dot notation).
 *
 * Invariant: Confidence is always "low" because hostname observation is evidence,
 * not authoritative IP ownership.
 */
export function extractProviderFromHostname(
  hostname: string | null | undefined
): ProviderHint | null {
  if (!hostname || typeof hostname !== "string") return null;
  const raw = hostname.trim().toLowerCase();
  const clean = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (!clean || clean.length < 3) return null;

  for (const entry of KNOWN_PROVIDER_DOMAINS) {
    if (clean === entry.domain || clean.endsWith("." + entry.domain)) {
      return {
        provider: entry.provider,
        distribution: entry.distribution,
        source: "observed_hostname",
        confidence: "low",
        matchedDomain: entry.domain,
      };
    }
  }

  return null;
}

interface MetroHubInfo {
  locationName: string;
  countryCode: string;
  regionCode?: string;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number;
}

/**
 * Curated dictionary of major global network interchange / metro IATA airport codes.
 */
const IATA_METRO_HUBS: Record<string, MetroHubInfo> = {
  // Europe
  FRA: { locationName: "Frankfurt", countryCode: "DE", latitude: 50.1109, longitude: 8.6821, accuracyRadiusKm: 50 },
  AMS: { locationName: "Amsterdam", countryCode: "NL", latitude: 52.3676, longitude: 4.9041, accuracyRadiusKm: 50 },
  LHR: { locationName: "London", countryCode: "GB", latitude: 51.5074, longitude: -0.1278, accuracyRadiusKm: 50 },
  LGW: { locationName: "London", countryCode: "GB", latitude: 51.5074, longitude: -0.1278, accuracyRadiusKm: 50 },
  CDG: { locationName: "Paris", countryCode: "FR", latitude: 48.8566, longitude: 2.3522, accuracyRadiusKm: 50 },
  ZRH: { locationName: "Zurich", countryCode: "CH", latitude: 47.3769, longitude: 8.5417, accuracyRadiusKm: 50 },
  ARN: { locationName: "Stockholm", countryCode: "SE", latitude: 59.3293, longitude: 18.0686, accuracyRadiusKm: 50 },
  CPH: { locationName: "Copenhagen", countryCode: "DK", latitude: 55.6761, longitude: 12.5683, accuracyRadiusKm: 50 },
  HEL: { locationName: "Helsinki", countryCode: "FI", latitude: 60.1699, longitude: 24.9384, accuracyRadiusKm: 50 },
  MAD: { locationName: "Madrid", countryCode: "ES", latitude: 40.4168, longitude: -3.7038, accuracyRadiusKm: 50 },
  BCN: { locationName: "Barcelona", countryCode: "ES", latitude: 41.3879, longitude: 2.1699, accuracyRadiusKm: 50 },
  MXP: { locationName: "Milan", countryCode: "IT", latitude: 45.4642, longitude: 9.1900, accuracyRadiusKm: 50 },
  VIE: { locationName: "Vienna", countryCode: "AT", latitude: 48.2082, longitude: 16.3738, accuracyRadiusKm: 50 },
  DUB: { locationName: "Dublin", countryCode: "IE", latitude: 53.3498, longitude: -6.2603, accuracyRadiusKm: 50 },
  WAW: { locationName: "Warsaw", countryCode: "PL", latitude: 52.2297, longitude: 21.0122, accuracyRadiusKm: 50 },
  OSL: { locationName: "Oslo", countryCode: "NO", latitude: 59.9139, longitude: 10.7522, accuracyRadiusKm: 50 },

  // North America
  IAD: { locationName: "Ashburn / Washington DC", countryCode: "US", regionCode: "VA", latitude: 39.0438, longitude: -77.4874, accuracyRadiusKm: 60 },
  DCA: { locationName: "Washington DC", countryCode: "US", regionCode: "DC", latitude: 38.9072, longitude: -77.0369, accuracyRadiusKm: 50 },
  SFO: { locationName: "San Francisco", countryCode: "US", regionCode: "CA", latitude: 37.7749, longitude: -122.4194, accuracyRadiusKm: 50 },
  SJC: { locationName: "San Jose", countryCode: "US", regionCode: "CA", latitude: 37.3382, longitude: -121.8863, accuracyRadiusKm: 50 },
  OAK: { locationName: "Oakland", countryCode: "US", regionCode: "CA", latitude: 37.8044, longitude: -122.2712, accuracyRadiusKm: 50 },
  LAX: { locationName: "Los Angeles", countryCode: "US", regionCode: "CA", latitude: 34.0522, longitude: -118.2437, accuracyRadiusKm: 50 },
  ORD: { locationName: "Chicago", countryCode: "US", regionCode: "IL", latitude: 41.8781, longitude: -87.6298, accuracyRadiusKm: 50 },
  DFW: { locationName: "Dallas", countryCode: "US", regionCode: "TX", latitude: 32.7767, longitude: -96.7970, accuracyRadiusKm: 50 },
  JFK: { locationName: "New York", countryCode: "US", regionCode: "NY", latitude: 40.7128, longitude: -74.0060, accuracyRadiusKm: 50 },
  EWR: { locationName: "Newark / New York", countryCode: "US", regionCode: "NJ", latitude: 40.7357, longitude: -74.1724, accuracyRadiusKm: 50 },
  LGA: { locationName: "New York", countryCode: "US", regionCode: "NY", latitude: 40.7128, longitude: -74.0060, accuracyRadiusKm: 50 },
  SEA: { locationName: "Seattle", countryCode: "US", regionCode: "WA", latitude: 47.6062, longitude: -122.3321, accuracyRadiusKm: 50 },
  MIA: { locationName: "Miami", countryCode: "US", regionCode: "FL", latitude: 25.7617, longitude: -80.1918, accuracyRadiusKm: 50 },
  ATL: { locationName: "Atlanta", countryCode: "US", regionCode: "GA", latitude: 33.7490, longitude: -84.3880, accuracyRadiusKm: 50 },
  BOS: { locationName: "Boston", countryCode: "US", regionCode: "MA", latitude: 42.3601, longitude: -71.0589, accuracyRadiusKm: 50 },
  DEN: { locationName: "Denver", countryCode: "US", regionCode: "CO", latitude: 39.7392, longitude: -104.9903, accuracyRadiusKm: 50 },
  PHX: { locationName: "Phoenix", countryCode: "US", regionCode: "AZ", latitude: 33.4484, longitude: -112.0740, accuracyRadiusKm: 50 },
  YYZ: { locationName: "Toronto", countryCode: "CA", regionCode: "ON", latitude: 43.6532, longitude: -79.3832, accuracyRadiusKm: 50 },
  YVR: { locationName: "Vancouver", countryCode: "CA", regionCode: "BC", latitude: 49.2827, longitude: -123.1207, accuracyRadiusKm: 50 },
  YUL: { locationName: "Montreal", countryCode: "CA", regionCode: "QC", latitude: 45.5017, longitude: -73.5673, accuracyRadiusKm: 50 },

  // Asia / Pacific
  NRT: { locationName: "Tokyo", countryCode: "JP", latitude: 35.6762, longitude: 139.6503, accuracyRadiusKm: 50 },
  HND: { locationName: "Tokyo", countryCode: "JP", latitude: 35.6762, longitude: 139.6503, accuracyRadiusKm: 50 },
  KIX: { locationName: "Osaka", countryCode: "JP", latitude: 34.6937, longitude: 135.5023, accuracyRadiusKm: 50 },
  SIN: { locationName: "Singapore", countryCode: "SG", latitude: 1.3521, longitude: 103.8198, accuracyRadiusKm: 40 },
  HKG: { locationName: "Hong Kong", countryCode: "HK", latitude: 22.3193, longitude: 114.1694, accuracyRadiusKm: 40 },
  TPE: { locationName: "Taipei", countryCode: "TW", latitude: 25.0330, longitude: 121.5654, accuracyRadiusKm: 40 },
  ICN: { locationName: "Seoul", countryCode: "KR", latitude: 37.5665, longitude: 126.9780, accuracyRadiusKm: 50 },
  SYD: { locationName: "Sydney", countryCode: "AU", latitude: -33.8688, longitude: 151.2093, accuracyRadiusKm: 50 },
  MEL: { locationName: "Melbourne", countryCode: "AU", latitude: -37.8136, longitude: 144.9631, accuracyRadiusKm: 50 },
  BOM: { locationName: "Mumbai", countryCode: "IN", latitude: 19.0760, longitude: 72.8777, accuracyRadiusKm: 50 },
  DEL: { locationName: "Delhi", countryCode: "IN", latitude: 28.7041, longitude: 77.1025, accuracyRadiusKm: 50 },
  BLR: { locationName: "Bengaluru", countryCode: "IN", latitude: 12.9716, longitude: 77.5946, accuracyRadiusKm: 50 },
  BKK: { locationName: "Bangkok", countryCode: "TH", latitude: 13.7563, longitude: 100.5018, accuracyRadiusKm: 50 },

  // Middle East / Africa / Latin America
  DXB: { locationName: "Dubai", countryCode: "AE", latitude: 25.2048, longitude: 55.2708, accuracyRadiusKm: 50 },
  JNB: { locationName: "Johannesburg", countryCode: "ZA", latitude: -26.2041, longitude: 28.0473, accuracyRadiusKm: 50 },
  GRU: { locationName: "Sao Paulo", countryCode: "BR", latitude: -23.5505, longitude: -46.6333, accuracyRadiusKm: 50 },
  GIG: { locationName: "Rio de Janeiro", countryCode: "BR", latitude: -22.9068, longitude: -43.1729, accuracyRadiusKm: 50 },
  EZE: { locationName: "Buenos Aires", countryCode: "AR", latitude: -34.6037, longitude: -58.3816, accuracyRadiusKm: 50 },
  SCL: { locationName: "Santiago", countryCode: "CL", latitude: -33.4489, longitude: -70.6693, accuracyRadiusKm: 50 },
};

/**
 * Validates whether a token string is a valid IATA edge token.
 * Requires whole-token equality or code + digits (e.g. "fra", "fra01", "fra-edge").
 * Rejects substring occurrences within non-network words (e.g. "fraud", "transform", "misfortune").
 */
function matchIataToken(token: string): { code: string; matchKind: "edge_token" | "hostname_label" } | null {
  const clean = token.trim().toUpperCase();
  if (clean.length < 3) return null;

  // 1. Exact 3-letter IATA match (e.g., "fra", "lax")
  if (clean.length === 3 && IATA_METRO_HUBS[clean]) {
    return { code: clean, matchKind: "hostname_label" };
  }

  // 2. IATA code followed only by digits (e.g., "fra01", "lax2", "iad101")
  if (/^[A-Z]{3}\d{1,4}$/.test(clean)) {
    const code = clean.substring(0, 3);
    if (IATA_METRO_HUBS[code]) {
      return { code, matchKind: "edge_token" };
    }
  }

  // 3. Digits followed by IATA code (e.g., "01fra", "1sin")
  if (/^\d{1,4}[A-Z]{3}$/.test(clean)) {
    const code = clean.substring(clean.length - 3);
    if (IATA_METRO_HUBS[code]) {
      return { code, matchKind: "edge_token" };
    }
  }

  return null;
}

/**
 * Extracts a geographic hint from an observed hostname.
 * Conservative token-boundary matching ensures false-positive substrings are rejected.
 *
 * @param hostname Observed hostname from DNS/telemetry.
 * @returns GeoHint if reliable boundary match found; null otherwise.
 */
export function extractLocationFromHostname(hostname: string | null | undefined): GeoHint | null {
  if (!hostname || typeof hostname !== "string") return null;
  const raw = hostname.trim().toLowerCase();
  const clean = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  if (!clean || clean.length < 3) return null;

  // Split into domain labels
  const labels = clean.split(".");

  for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
    const label = labels[labelIndex];
    if (!label) continue;

    // Do not match top-level domain suffix (e.g. .com, .net, .de) as an IATA code
    if (labelIndex === labels.length - 1 && labels.length > 1) {
      continue;
    }

    // Split label into sub-tokens delimited by hyphens, underscores, or slashes
    const tokens = label.split(/[-_/\\]+/);

    for (const token of tokens) {
      if (!token) continue;
      const matched = matchIataToken(token);
      if (matched) {
        const hub = IATA_METRO_HUBS[matched.code];
        if (hub) {
          return {
            locationName: hub.locationName,
            city: hub.locationName,
            countryCode: hub.countryCode,
            regionCode: hub.regionCode,
            iataCode: matched.code,
            latitude: hub.latitude,
            longitude: hub.longitude,
            accuracyRadiusKm: hub.accuracyRadiusKm,
            confidence: matched.matchKind === "hostname_label" ? "medium" : "low",
            source: "observed_hostname",
            matchedToken: token,
            matchKind: matched.matchKind,
          };
        }
      }
    }
  }

  return null;
}
