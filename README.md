# NetPulse

> **Making the Invisible Internet Visible.**
> A beginner-friendly, production-grade Internet observability platform built in Rust and React/Tauri.

NetPulse reconstructs, explains, and teaches the complete story behind network events on your computer — locally, privately, and beautifully. Instead of showing raw packet bytes first, NetPulse delivers understanding first, keeping raw inspection one click away.

---

## Core Guarantees

- **Observe, don't intervene**: Listens passively. Never blocks, injects, or alters network traffic.
- **Local-first & private**: All parsing, flow reconstruction, and anomaly detection run offline. Single egress boundary in `netpulse-ai`.
- **Honest confidence**: Every security finding carries a calibrated confidence score linked to exact packet/flow evidence.
- **Progressive disclosure**: One rich data model served across three customizable depth levels (Beginner, Intermediate, Expert).

---

## Capabilities

| Capability | Components | Description |
|---|---|---|
| **Capture & Decoding** | `netpulse-capture`, `-decode`, `-flow`, `-storage`, `-platform` | Live Npcap / PCAP / PCAPNG capture, zero-copy protocol decoding (DNS, HTTP, TLS, TCP, UDP), flow assembly, SQLite storage. |
| **Narrative & Presentation** | `netpulse-narrative`, `netpulse-api`, `ui/` | Human narrative feed, real-time bandwidth & latency monitoring, OS process attribution (`GetExtendedTcpTable`), versioned v4 API contract. |
| **Education & Exploration** | `netpulse-learn`, `ui/app` | Grounded interactive lessons, Website Load Journey reconstruction, interactive Protocol Explorer, animated flow visualizers. |
| **Intelligence & AI** | `netpulse-intel`, `netpulse-ai` | Confidence-scored threat detectors (DNS tunneling, port scans), statistical anomaly engine, grounded local AI assistant. |
| **Lifecycle & Plugins** | `netpulse-engine`, `netpulse-plugin`, `plugins/` | Session recording & deterministic replay, PCAPNG import/export, capability-bounded WASM/in-tree plugin system. |

---

## Architecture at a Glance

The crate dependency graph strictly enforces a downward hierarchy. Higher layers depend on lower layers, never the reverse.

```
netpulse-engine (bin) ┐   netpulse-capture-svc (bin) ┐   plugins/* (reference)
        │             │            │                 │
  api  learn  ai  intel  narrative  flow  decode  storage  capture
        │      │    │        │        │      │        │        │
        └──────┴────┴────────┴────────┴──────┴────────┴─── netpulse-platform
                                   │                             │
                              netpulse-core  (shared data model & vocabulary)
```

- **Parser Isolation**: Untrusted packet bytes are dissected inside `netpulse-decode` and fuzzed in isolation (`fuzz/`).
- **Single Egress Boundary**: Network calls are forbidden across all crates except `netpulse-ai`.
- **Platform Isolation**: OS-specific code (`#[cfg(target_os)]`) lives entirely in `netpulse-platform`.
- **Contract Sync**: `netpulse-api` generates `@netpulse/contract` TypeScript types, drift-checked in CI.
- **Privilege Minimization**: Capture capabilities are isolated in `netpulse-capture-svc` (or `netpulse-platform`).

---

## Requirements & Setup

- **Rust 1.96**: Pinned in `rust-toolchain.toml`.
- **Node.js 20+ & pnpm 9**: Frontend workspace tools (`corepack enable`).
- **Tauri CLI v2**: Desktop app shell (`cargo install tauri-cli --version '^2'`).
- **Npcap (Windows)**: Required for live capture (install with *WinPcap API-compatible mode* and set `$env:NPCAP_SDK_PATH`).

---

## Quickstart

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
> Set `NETPULSE_PCAP=fixtures/sample.pcap` before running `cargo tauri dev` to work offline without live capture drivers.

---

## Repository Layout

```
crates/       14 Rust crates — core engine, decode, flow, storage, intel, AI, API
ui/           pnpm workspace — app, contract, design-system, components, viz
src-tauri/    Tauri v2 desktop shell and IPC bridge
plugins/      First-party reference plugins (dissector, detector, enrichment, export)
fixtures/     Deterministic test capture files (.pcap / .pcapng)
fuzz/         cargo-fuzz targets for protocol dissectors
models/       Local ONNX model files and model cards
research/     Offline model training scripts (Python)
scripts/      Cross-platform build and release automation
```

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
