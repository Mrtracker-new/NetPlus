# fuzz/

`cargo-fuzz` targets — one per dissector in `netpulse-decode`, plus other
hostile-input parsers.

The decode crate is the primary attack surface (bytes controlled by remote
parties). Every dissector gets a fuzz target, and continuous fuzzing gates CI
(`docs/03` §3, `docs/04` §3.4, §7). This is how NetPulse avoids the dissector
memory-safety bug class that dominates C-based analyzers' CVEs.

**Status: empty at foundation stage.** Targets are added with each dissector in
Phase 1 (`docs/07`).
