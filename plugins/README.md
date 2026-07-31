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
| [`example-export`](example-export/) | Export | `ExportPlugin` | Reference custom export plugin writing structured JSON outputs. |

---

## Security & Capability Boundaries

1. **No Network Egress**: Plugin capability masks strictly forbid outbound network access. No plugin type can request network egress.
2. **Signature Verification**: First-party plugins are cryptographically signed with Ed25519 keys (`netpulse-plugin`).
3. **Audited Isolation**: In-tree and WASM plugins run under restricted runtime environments without arbitrary OS access.
