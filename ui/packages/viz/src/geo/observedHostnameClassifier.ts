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
}

/**
 * Curated dictionary of major global network interchange / metro IATA airport codes.
 */
const IATA_METRO_HUBS: Record<string, MetroHubInfo> = {
  // Europe
  FRA: { locationName: "Frankfurt", countryCode: "DE" },
  AMS: { locationName: "Amsterdam", countryCode: "NL" },
  LHR: { locationName: "London", countryCode: "GB" },
  LGW: { locationName: "London", countryCode: "GB" },
  CDG: { locationName: "Paris", countryCode: "FR" },
  ZRH: { locationName: "Zurich", countryCode: "CH" },
  ARN: { locationName: "Stockholm", countryCode: "SE" },
  CPH: { locationName: "Copenhagen", countryCode: "DK" },
  HEL: { locationName: "Helsinki", countryCode: "FI" },
  MAD: { locationName: "Madrid", countryCode: "ES" },
  BCN: { locationName: "Barcelona", countryCode: "ES" },
  MXP: { locationName: "Milan", countryCode: "IT" },
  VIE: { locationName: "Vienna", countryCode: "AT" },
  DUB: { locationName: "Dublin", countryCode: "IE" },
  WAW: { locationName: "Warsaw", countryCode: "PL" },
  OSL: { locationName: "Oslo", countryCode: "NO" },

  // North America
  IAD: { locationName: "Ashburn / Washington DC", countryCode: "US", regionCode: "VA" },
  DCA: { locationName: "Washington DC", countryCode: "US", regionCode: "DC" },
  SFO: { locationName: "San Francisco", countryCode: "US", regionCode: "CA" },
  SJC: { locationName: "San Jose", countryCode: "US", regionCode: "CA" },
  OAK: { locationName: "Oakland", countryCode: "US", regionCode: "CA" },
  LAX: { locationName: "Los Angeles", countryCode: "US", regionCode: "CA" },
  ORD: { locationName: "Chicago", countryCode: "US", regionCode: "IL" },
  DFW: { locationName: "Dallas", countryCode: "US", regionCode: "TX" },
  JFK: { locationName: "New York", countryCode: "US", regionCode: "NY" },
  EWR: { locationName: "Newark / New York", countryCode: "US", regionCode: "NJ" },
  LGA: { locationName: "New York", countryCode: "US", regionCode: "NY" },
  SEA: { locationName: "Seattle", countryCode: "US", regionCode: "WA" },
  MIA: { locationName: "Miami", countryCode: "US", regionCode: "FL" },
  ATL: { locationName: "Atlanta", countryCode: "US", regionCode: "GA" },
  BOS: { locationName: "Boston", countryCode: "US", regionCode: "MA" },
  DEN: { locationName: "Denver", countryCode: "US", regionCode: "CO" },
  PHX: { locationName: "Phoenix", countryCode: "US", regionCode: "AZ" },
  YYZ: { locationName: "Toronto", countryCode: "CA", regionCode: "ON" },
  YVR: { locationName: "Vancouver", countryCode: "CA", regionCode: "BC" },
  YUL: { locationName: "Montreal", countryCode: "CA", regionCode: "QC" },

  // Asia / Pacific
  NRT: { locationName: "Tokyo", countryCode: "JP" },
  HND: { locationName: "Tokyo", countryCode: "JP" },
  KIX: { locationName: "Osaka", countryCode: "JP" },
  SIN: { locationName: "Singapore", countryCode: "SG" },
  HKG: { locationName: "Hong Kong", countryCode: "HK" },
  TPE: { locationName: "Taipei", countryCode: "TW" },
  ICN: { locationName: "Seoul", countryCode: "KR" },
  SYD: { locationName: "Sydney", countryCode: "AU" },
  MEL: { locationName: "Melbourne", countryCode: "AU" },
  BOM: { locationName: "Mumbai", countryCode: "IN" },
  DEL: { locationName: "Delhi", countryCode: "IN" },
  BLR: { locationName: "Bengaluru", countryCode: "IN" },
  BKK: { locationName: "Bangkok", countryCode: "TH" },

  // Middle East / Africa / Latin America
  DXB: { locationName: "Dubai", countryCode: "AE" },
  JNB: { locationName: "Johannesburg", countryCode: "ZA" },
  GRU: { locationName: "Sao Paulo", countryCode: "BR" },
  GIG: { locationName: "Rio de Janeiro", countryCode: "BR" },
  EZE: { locationName: "Buenos Aires", countryCode: "AR" },
  SCL: { locationName: "Santiago", countryCode: "CL" },
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
