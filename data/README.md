# Local Data & Enrichment Databases (`data/`)

Local offline enrichment databases used by NetPulse for GeoIP mapping, ASN resolution, CDN identification, and MAC vendor lookups.

---

## Directory Governance & Status

- **Architectural Status**: Intentionally reserved directory for local offline data assets (`*.mmdb`, `*.csv`, `*.json`).
- **Source Control Policy**: Heavy binary databases (such as MaxMind GeoLite2 `.mmdb` or ASN mappings) are excluded from direct git commits to prevent repository bloat. Git tracks this directory via `README.md`.
- **Population Trigger**: Populated locally or in build/deployment environments when offline enrichment databases are downloaded or generated.

---

## Privacy Policy

- **Strictly Offline**: NetPulse **never** performs remote DNS or HTTP lookups to enrich host or IP metadata.
- **Local Lookups**: Host geolocation (`Host.geo`), autonomous system numbers (`Host.asn`), and organization names (`Host.org`) are resolved exclusively against local files in this directory.

