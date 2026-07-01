# data/

Local enrichment databases: geo/ASN, CDN IP ranges, OUI (MAC vendor).

**Local-only. No live lookups** (`docs/02` §10.3) — NetPulse never phones home to
resolve a host. Enrichment (`Host.geo`, `Host.asn`, `Host.org`) reads only from
these files.

**Status: empty at foundation stage.** Populated as enrichment lands (`docs/12`).
