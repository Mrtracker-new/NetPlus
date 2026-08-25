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
  if (!raw || raw.length < 3) return null;

  // Split into domain labels
  const labels = raw.split(".");

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
