// AUTO-GENERATED -- do not edit manually.
// Run `pnpm geoip:update` to regenerate from DB-IP Lite CSV.
// Source: DB-IP Lite City (https://db-ip.com) -- CC BY 4.0
import type { IPv4Int } from "./geoTypes";

export interface GeoIntervalRecord {
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyRadiusKm: number | null;
}

/** [start, end, record] sorted ascending by start. Non-overlapping. */
export const IPV4_GEO_INTERVALS: [IPv4Int, IPv4Int, GeoIntervalRecord][] = [
  [0x01010100, 0x010101ff, { country: "United States", countryCode: "US", city: "San Jose", latitude: 37.3382, longitude: -121.8863, accuracyRadiusKm: 10 }],
  [0x08080400, 0x080804ff, { country: "United States", countryCode: "US", city: "Mountain View", latitude: 37.4056, longitude: -122.0775, accuracyRadiusKm: 10 }],
  [0x08080800, 0x080808ff, { country: "United States", countryCode: "US", city: "Mountain View", latitude: 37.4056, longitude: -122.0775, accuracyRadiusKm: 10 }],
  [0x09090900, 0x090909ff, { country: "Switzerland", countryCode: "CH", city: "Zurich", latitude: 47.3769, longitude: 8.5417, accuracyRadiusKm: 10 }],
  [0x0d6b0400, 0x0d6b04ff, { country: "United States", countryCode: "US", city: "Redmond", latitude: 47.6740, longitude: -122.1215, accuracyRadiusKm: 10 }],
  [0x11000000, 0x11ffffff, { country: "United States", countryCode: "US", city: "Cupertino", latitude: 37.3230, longitude: -122.0322, accuracyRadiusKm: 10 }],
  [0x14be9f00, 0x14be9fff, { country: "United States", countryCode: "US", city: "Boydton", latitude: 36.6676, longitude: -78.3875, accuracyRadiusKm: 10 }],
  [0x1f000000, 0x1fffffff, { country: "Germany", countryCode: "DE", city: "Frankfurt am Main", latitude: 50.1109, longitude: 8.6821, accuracyRadiusKm: 10 }],
  [0x2e000000, 0x2effffff, { country: "Netherlands", countryCode: "NL", city: "Amsterdam", latitude: 52.3676, longitude: 4.9041, accuracyRadiusKm: 10 }],
  [0x345f6e00, 0x345f6eff, { country: "United States", countryCode: "US", city: "Seattle", latitude: 47.6062, longitude: -122.3321, accuracyRadiusKm: 10 }],
  [0x68100000, 0x681fffff, { country: "United States", countryCode: "US", city: "San Francisco", latitude: 37.7749, longitude: -122.4194, accuracyRadiusKm: 10 }],
  [0x8efa0000, 0x8efa1dff, { country: "United States", countryCode: "US", city: "Mountain View", latitude: 37.4056, longitude: -122.0775, accuracyRadiusKm: 10 }],
  [0x8efa1e00, 0x8efa1eff, { country: "Japan", countryCode: "JP", city: "Tokyo", latitude: 35.6762, longitude: 139.6503, accuracyRadiusKm: 10 }],
  [0x8efa1f00, 0x8efaffff, { country: "United States", countryCode: "US", city: "Mountain View", latitude: 37.4056, longitude: -122.0775, accuracyRadiusKm: 10 }],
  [0x97650000, 0x9765ffff, { country: "United States", countryCode: "US", city: "San Francisco", latitude: 37.7749, longitude: -122.4194, accuracyRadiusKm: 10 }],
  [0xaddef000, 0xaddeffff, { country: "United States", countryCode: "US", city: "Cambridge", latitude: 42.3736, longitude: -71.1097, accuracyRadiusKm: 10 }],
  [0xb9c76c00, 0xb9c76fff, { country: "United States", countryCode: "US", city: "San Francisco", latitude: 37.7749, longitude: -122.4194, accuracyRadiusKm: 10 }],
  [0xc1000000, 0xc10000ff, { country: "Netherlands", countryCode: "NL", city: "Amsterdam", latitude: 52.3676, longitude: 4.9041, accuracyRadiusKm: 10 }],
];
