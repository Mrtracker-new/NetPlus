# NetPulse

> **Making the Invisible Internet Visible.**
> A beginner-friendly, production-grade Internet observability platform built in Rust and React/Tauri.

NetPulse reconstructs, explains, and teaches the complete story behind network events on your computer — locally, privately, and beautifully. Instead of showing raw packet bytes first, NetPulse delivers understanding first, keeping deep technical inspection one click away.

---

## Core Guarantees

- **Observe, Don't Intervene**: Listens passively. Never blocks, injects, or alters network traffic.
- **Local-First & Private**: Offline parsing, flow reconstruction, and anomaly detection. Single egress boundary in `netpulse-ai`.
- **Calibrated Confidence**: Every security finding carries an explicit confidence score linked to exact packet/flow evidence.
- **Progressive Disclosure**: One rich data model served across three customizable depth levels (*Beginner*, *Intermediate*, *Expert*).

---

## Capabilities

| Capability | Components | Description |
|---|---|---|
| **Capture & Decoding** | `netpulse-capture`, `-decode`, `-flow`, `-storage`, `-platform` | Live Npcap / PCAP / PCAPNG capture, zero-copy protocol decoding (DNS, HTTP, TLS, TCP, UDP), flow assembly, and SQLite storage. |
| **Narrative & Presentation** | `netpulse-narrative`, `netpulse-api`, `ui/` | Human narrative feed, real-time bandwidth & latency monitoring, OS process attribution (`GetExtendedTcpTable`), versioned v4 API contract. |
| **Education & Exploration** | `netpulse-learn`, `ui/app` | Grounded interactive lessons, Website Load Journey reconstruction, interactive Protocol Explorer, animated flow visualizers. |
| **Intelligence & AI** | `netpulse-intel`, `netpulse-ai` | Confidence-scored threat detectors (DNS tunneling, port scans), statistical anomaly engine, grounded local AI assistant. |
| **Lifecycle & Plugins** | `netpulse-engine`, `netpulse-plugin`, `plugins/` | Session recording & deterministic replay, PCAPNG import/export, capability-bounded WASM/in-tree plugin system. |

---

## Architecture at a Glance

NetPulse separates responsibilities across distinct processes to maintain privilege isolation and system stability. The crate dependency graph strictly enforces a downward hierarchy. Higher layers depend on lower layers, never the reverse.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Desktop User UI                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Vite + React Application                       │  │
│  │     (@netpulse/app, @netpulse/components, @netpulse/viz)         │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    │ IPC (Tauri v2 invoke / events)     │
│  ┌─────────────────────────────────▼─────────────────────────────────┐  │
│  │                    Tauri Desktop Shell (`src-tauri`)               │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │ Query / Command (netpulse-api v4)
┌────────────────────────────────────▼────────────────────────────────────┐
│                        Engine Process (`netpulse-engine`)               │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────┐  │
│  │  narrative   │   │    intel     │   │    learn     │   │    ai    │  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └────┬─────┘  │
│         └──────────────────┼──────────────────┘                │        │
│                            ▼                                   │        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │        │
│  │    storage   │◀──│     flow     │◀──│    decode    │        │        │
│  └──────────────┘   └──────────────┘   └──────┬───────┘        │        │
│                            ▲                  │                │        │
└────────────────────────────┼──────────────────┼────────────────┼────────┘
                             │                  │                │
┌────────────────────────────┼──────────────────┼────────────────┼────────┐
│  Privileged Capture        │                  │                │        │
│  Service (optional)        │                  │                ▼        │
│  ┌─────────────────────────┴─────────┐        │       ┌─────────────────┤
│  │  `netpulse-capture-svc` (bin)     │        │       │  Opt-in Egress  │
│  │  or `netpulse-platform` (Npcap)   │        │       │  AI Assistant   │
│  └───────────────────────────────────┘        │       └─────────────────┘
└───────────────────────────────────────────────┼─────────────────────────┘
                                                ▼
                                    Raw Network Interfaces / PCAP
```

For complete architectural specifications, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Requirements & Quickstart

### Prerequisites
- **Rust 1.96+**: Pinned in `rust-toolchain.toml`.
- **Node.js 20+ & pnpm 9**: Frontend workspace tools (`corepack enable`).
- **Tauri CLI v2**: Desktop app shell (`cargo install tauri-cli --version '^2'`).
- **Npcap (Windows)**: Required for live capture (install with *WinPcap API-compatible mode*).

### Backend Engine (CLI)
```sh
cargo build --workspace
cargo test --workspace
cargo run -p netpulse-engine -- path/to/capture.pcap
```

### Frontend UI (Browser)
```sh
pnpm install
pnpm --filter @netpulse/contract typecheck
pnpm --filter @netpulse/app dev
```

### Desktop Application (Tauri Shell)
```sh
cargo tauri dev
```

---

## Repository Map

```
crates/       14 Rust workspace crates — engine, decode, flow, storage, intel, AI, API
ui/           pnpm workspace — app, contract, design-system, components, viz
src-tauri/    Tauri v2 desktop shell and IPC bridge
plugins/      First-party reference plugins (dissector, detector, enrichment, export)
fixtures/     Deterministic test capture files (.pcap / .pcapng)
fuzz/         cargo-fuzz targets for protocol dissectors
models/       Local ONNX model files and model cards
research/     Offline model training scripts (Python)
scripts/      Cross-platform build and release automation
data/         Local offline enrichment databases (GeoIP, ASN, MAC vendors)
```

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — System design, process model, and crate taxonomy.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Development workflows, quality gates, and codegen.
- [`SECURITY.md`](SECURITY.md) — Security posture, isolation boundaries, and vulnerability reporting.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Community standards and covenant.

---

## Quality Gates

Run local checks before pushing:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm --filter @netpulse/contract typecheck
```

---

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
