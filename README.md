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

## Implementation Status & Capabilities

NetPulse capabilities are specified, implemented, and executed across three distinct maturity dimensions:
- **Design**: Architecture, specs, contracts, and privacy bounds.
- **Code**: Parsers, data models, state machines, and unit tests.
- **Runtime**: Active execution in standard builds, live OS capture, persistent DB, or GUI integration.

**Status Legend**: ✅ Complete | 🚧 In Progress | 📋 Planned | Single Source of Truth: [`docs/status.yml`](docs/status.yml)

| Capability | Key Crates & Packages | Design | Code | Runtime | Description |
|---|---|:---:|:---:|:---:|---|
| **Capture & Decoding** | `netpulse-capture`, `netpulse-decode`, `netpulse-flow`, `netpulse-storage`, `netpulse-platform` | ✅ Complete | ✅ Complete | ✅ Complete | Zero-copy decoding (Ethernet, IPv4/6, TCP, UDP, DNS, HTTP, TLS), flow assembly, hostile input bounds, PCAP/PCAPNG parsing & replay, live Npcap capture with interface fallback, and durable SQLite storage with restart hydration fully operational. |
| **Narrative & Presentation** | `netpulse-narrative`, `netpulse-api`, `@netpulse/contract`, `@netpulse/components`, `@netpulse/viz`, `@netpulse/design-system` | ✅ Complete | ✅ Complete | ✅ Complete | Session narrative card projection, v6 API DTO contract, real-time bandwidth/latency telemetry streaming, Windows process attribution (`GetExtendedTcpTable`), and progressive disclosure UI components fully operational. |
| **Education & Exploration** | `netpulse-learn`, `@netpulse/app` | ✅ Complete | ✅ Complete | ✅ Complete | Interactive curriculum engine, Website Load Journey synthesizer, Protocol Explorer reference content, persistent local mastery engine, and interactive lesson player UI fully operational. |
| **Intelligence & AI** | `netpulse-intel`, `netpulse-ai` | ✅ Complete | ✅ Complete | 🚧 In Progress | Threat detectors (DNS tunneling, port scans), statistical anomaly engine, grounded retrieval & `LocalTemplateBackend` complete. Local ONNX LLM backend planned. |
| **Lifecycle & Plugins** | `netpulse-engine`, `netpulse-plugin`, `netpulse-capture-svc` | ✅ Complete | 🚧 In Progress | 🚧 In Progress | Session recording & deterministic replay, PCAPNG import/export, plugin seam traits & trust model complete. WASM runtime loader & privileged daemon loop in progress/planned. |

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
plugins/      First-party reference plugins (dissector, detector, enrichment, export, view)
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
python scripts/verify_docs_status.py
pnpm --filter @netpulse/contract typecheck
```

---

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
