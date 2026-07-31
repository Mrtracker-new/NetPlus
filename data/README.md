# Local Data & Enrichment Databases (`data/`)

Local offline enrichment databases used by NetPulse for GeoIP mapping, ASN resolution, CDN identification, and MAC vendor lookups.

---

## Privacy Policy

- **Strictly Offline**: NetPulse **never** performs remote DNS or HTTP lookups to enrich host or IP metadata.
- **Local Lookups**: Host geolocation (`Host.geo`), autonomous system numbers (`Host.asn`), and organization names (`Host.org`) are resolved exclusively against local files in this directory.
