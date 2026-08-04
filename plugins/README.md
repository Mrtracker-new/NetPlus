# First-Party Reference Plugins (`plugins/`)

Reference plugin implementations for NetPulse's extension seams.

Each plugin sits at a specific layer boundary, consumes only that layer's versioned contract, and respects strict capability boundaries (`crates/netpulse-plugin`).

---

## Reference Plugins Taxonomy

| Plugin | Extension Seam | Target Trait | Description |
|---|---|---|---|
| [`example-dissector`](example-dissector/) | Protocol Decode | `Dissector` | Reference custom protocol dissector with field explanations. |
| [`example-detector`](example-detector/) | Security Intel | `Detector` | Reference security detector generating evidence-carrying findings. |
| [`example-enrichment`](example-enrichment/) | Host/Process | `Enrichment` | Reference local metadata enrichment plugin (offline IP/ASN mappings). |
| [`example-view`](example-view/) | Presentation | `ViewPlugin` | Reference custom UI view panel declaring read channels over Query/Stream API. |
| [`example-export`](example-export/) | Export | `ExportPlugin` | Reference custom export plugin writing structured JSON outputs. |

---

## View Seam Architectural Specification

```
Packets ──► Dissector ──► Enrichment ──► Detector ──► Engine State
                                                            │
                                                ─────────────────────────
                                                 ViewPlugin (Read Only)
                                                ─────────────────────────
                                                            │
                                                Dashboard / Timeline / UI
```

### Architectural Rationale
*View plugins consume engine state but cannot modify capture, analysis, or export pipelines, ensuring presentation logic remains isolated from packet processing.*

- **Target Trait**: `ViewPlugin` (combined with `Configurable`)
- **Granted Capability**: `Capability::ApiRead` (docs/02 §10.2)
- **Architectural Prohibitions**:
  - MUST NOT parse raw bytes (`Capability::ParseBytes`)
  - MUST NOT emit security findings (`Capability::EmitFindings`)
  - MUST NOT read arbitrary local filesystem data (`Capability::ReadLocalData`)
  - MUST NOT write export files (`Capability::WriteOutput`)
  - MUST NOT perform network egress (no egress capability exists)
- **Typical Use Cases**: Dashboard widgets, Timeline panels, Traffic summary cards, Session graphs.

### Minimal Reference Implementation (`ViewPlugin`)

```rust
use netpulse_plugin::{Configurable, ViewPlugin};

#[derive(Debug, Default)]
pub struct TrafficSummaryView;

impl Configurable for TrafficSummaryView {}

impl ViewPlugin for TrafficSummaryView {
    fn id(&self) -> &'static str {
        "example.traffic-summary"
    }

    fn reads(&self) -> &'static [&'static str] {
        &[
            "query.health_check",
            "query.list_plugins",
            "stream.narrative_feed",
        ]
    }
}
```

---

## Security & Capability Boundaries

1. **No Network Egress**: Plugin capability masks strictly forbid outbound network access. No plugin type can request network egress.
2. **Signature Verification**: First-party plugins are cryptographically signed with Ed25519 keys (`netpulse-plugin`).
3. **Audited Isolation**: In-tree and WASM plugins run under restricted runtime environments without arbitrary OS access.
