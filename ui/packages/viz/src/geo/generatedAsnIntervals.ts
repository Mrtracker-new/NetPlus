// AUTO-GENERATED -- do not edit manually.
// Run `pnpm geoip:update` to regenerate from DB-IP Lite ASN CSV.
// Source: DB-IP Lite ASN (https://db-ip.com) -- CC BY 4.0
import type { IPv4Int } from "./geoTypes";

export interface AsnIntervalRecord {
  asn: number;
  asOrg: string;
  asName: string | null;
}

/** [start, end, record] sorted ascending by start. Non-overlapping. */
export const IPV4_ASN_INTERVALS: [IPv4Int, IPv4Int, AsnIntervalRecord][] = [
  [0x01010100, 0x010101ff, { asn: 13335, asOrg: "Cloudflare, Inc.", asName: "CLOUDFLARENET" }],
  [0x08080400, 0x080804ff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0x08080800, 0x080808ff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0x09090900, 0x090909ff, { asn: 19281, asOrg: "Quad9", asName: "QUAD9" }],
  [0x0d6b0400, 0x0d6b04ff, { asn: 8068, asOrg: "Microsoft Corporation", asName: "MICROSOFT-CORP" }],
  [0x11000000, 0x11ffffff, { asn: 714, asOrg: "Apple Inc.", asName: "APPLE-ENGINEERING" }],
  [0x14be9f00, 0x14be9fff, { asn: 8075, asOrg: "Microsoft Corporation", asName: "MICROSOFT-CORP" }],
  [0x1f000000, 0x1fffffff, { asn: 3320, asOrg: "Deutsche Telekom AG", asName: "DTAG" }],
  [0x2e000000, 0x2effffff, { asn: 1200, asOrg: "Amsterdam Internet Exchange", asName: "AMS-IX" }],
  [0x345f6e00, 0x345f6eff, { asn: 16509, asOrg: "Amazon.com, Inc.", asName: "AMAZON-02" }],
  [0x3e480000, 0x3e48ffff, { asn: 47583, asOrg: "Hostinger Operations, UAB", asName: "HOSTINGER" }],
  [0x68100000, 0x681fffff, { asn: 13335, asOrg: "Cloudflare, Inc.", asName: "CLOUDFLARENET" }],
  [0x8efa0000, 0x8efa1dff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0x8efa1e00, 0x8efa1eff, { asn: 2516, asOrg: "KDDI Corporation", asName: "KDDI" }],
  [0x8efa1f00, 0x8efaffff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0x8efb0000, 0x8efbffff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0x97650000, 0x9765ffff, { asn: 54113, asOrg: "Fastly, Inc.", asName: "FASTLY" }],
  [0xacd90000, 0xacd9ffff, { asn: 15169, asOrg: "Google LLC", asName: "GOOGLE" }],
  [0xaddef000, 0xaddeffff, { asn: 20940, asOrg: "Akamai Technologies, Inc.", asName: "AKAMAI" }],
  [0xb9c76c00, 0xb9c76fff, { asn: 36459, asOrg: "GitHub, Inc.", asName: "GITHUB" }],
  [0xc1000000, 0xc10000ff, { asn: 3333, asOrg: "Reseaux IP Europeens Network Coordination Centre (RIPE NCC)", asName: "RIPE-NCC-END-MNT" }],
  [0xca588000, 0xca58bfff, { asn: 45528, asOrg: "Asianet Satellite Communications Ltd", asName: "ASIANET" }],
];
