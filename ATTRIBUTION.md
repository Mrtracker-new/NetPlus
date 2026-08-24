# Third-Party Data Attribution

## IP Geolocation Data

This product includes IP geolocation data from **DB-IP**
(https://db-ip.com).

> **IP Geolocation by DB-IP**

The geolocation data is licensed under the
[Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

**Dataset:** DB-IP Lite City + DB-IP Lite ASN
**Provider:** Eris Networks S.A.S, Perros-Guirec, France
**License page:** https://db-ip.com/db/lite/ip-to-city-lite

### Compliance Notes

- The CC BY 4.0 attribution notice above must be retained in any
  distribution of this product or its compiled data tables.
- The generated TypeScript files (`generatedGeoIntervals.ts`,
  `generatedAsnIntervals.ts`, `generatedAnycastPrefixes.ts`,
  `generatedDatabaseMetadata.ts`) embed this attribution notice
  in their file headers.
- DB-IP Lite data is updated monthly. Run `pnpm geoip:update` to
  refresh from the current month'"'"'s release.

---

*This file was last updated: 2026-08-24*
