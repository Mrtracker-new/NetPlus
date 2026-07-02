# plugins/

First-party example plugins — reference implementations for each extension seam
(`docs/24`): dissector, enrichment, detector, view/panel, and export plugins.

Each seam sits at a layer boundary and consumes only that layer's contract,
preserving the strict layering (`docs/02` §4, §15). These examples show
contributors how to extend NetPulse without forking, and they double as living
conformance references (`docs/24` §10) — CI builds and tests them like any crate.

**Status: populated in Phase 5 (`docs/24`).** In-tree Rust plugins are the
simplest, safest starting point (`docs/24` §7); dynamic/WASM loading is a future
path, but the *contracts and capability model* (`crates/netpulse-plugin`) are the
stable, specified part.

| Example | Seam | Implements | Reference for |
|---|---|---|---|
| [`example-dissector`](example-dissector/) | Decode (`docs/07`) | `Dissector` | New protocol parsing + explanations (the flagship seam) |
| [`example-detector`](example-detector/) | Intelligence (`docs/17`) | `Detector` → `Finding` | New signals, structurally forced through the evidence-carrying finding model |
| [`example-enrichment`](example-enrichment/) | Host/Process (`docs/12`) | `Enrichment` | New **local/offline** metadata — never the network |
| [`example-export`](example-export/) | Export (`docs/23`) | `ExportPlugin` | New output formats under the privacy discipline (no implicit egress) |

The **view/panel** seam (`docs/24` §4.4) runs in the webview consuming the
Query/Stream API (the same contract the built-in UI uses); its capability boundary
is modelled by `netpulse_plugin::ViewPlugin` and enforced by the UI sandbox
(`docs/02` §10.2), so it has no standalone Rust example here.

Every seam is capability-bounded by type (`netpulse_plugin::capabilities_for`), and
**no plugin type can acquire network/egress or system capability** — that variant
does not exist in the model (`docs/24` §5). Enabling a non-first-party plugin is
always an explicit, disclosed user choice.
